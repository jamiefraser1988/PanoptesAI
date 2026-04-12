import { Devvit, TriggerContext } from "@devvit/public-api";
import "./game.js";

Devvit.configure({
  redditAPI: true,
  http: {
    domains: ["panoptesai.net"],
  },
  redis: true,
});

const PANOPTES_API_URL = "https://panoptesai.net";
const RISK_THRESHOLD = 40;
const MAX_ERROR_BODY_LENGTH = 300;

interface ScanRequest {
  type: "post" | "comment";
  reddit_id: string;
  subreddit: string;
  author: string;
  title?: string;
  body: string;
  permalink: string;
  created_utc: number;
}

interface ScanResponse {
  score: number;
  reasons: string[];
  action: string;
  action_mode?: string;
  ai_summary?: string;
  ai_signals?: string[];
}

function trimString(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function cleanSubredditName(value: string | null | undefined): string {
  return trimString(value).replace(/^r\//i, "");
}

function toCreatedUtc(timestamp: number | null | undefined): number {
  if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0) {
    return Math.floor(timestamp);
  }
  return Math.floor(Date.now() / 1000);
}

function trimLogBody(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_ERROR_BODY_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
}

function logMissingScanFields(
  type: "post" | "comment",
  thingId: string,
  subreddit: string,
  author: string,
): void {
  console.error("[PanoptesAI] Skipping scan due to missing author or subreddit", {
    type,
    thingId,
    subreddit,
    author,
  });
}

async function sendToApi(
  payload: ScanRequest
): Promise<ScanResponse | null> {
  try {
    const url = `${PANOPTES_API_URL}/api/devvit/scan`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const responseBody = trimLogBody(await response.text());
      console.error("[PanoptesAI] Scan request failed", {
        status: response.status,
        body: responseBody,
      });
      return null;
    }

    return (await response.json()) as ScanResponse;
  } catch (err) {
    console.error("Failed to reach PanoptesAI API:", err);
    return null;
  }
}

async function handleResult(
  context: TriggerContext,
  result: ScanResponse,
  thingId: string,
  contentType: "post" | "comment"
) {
  if (result.score < RISK_THRESHOLD) {
    return;
  }

  const isMonitorOnly = result.action_mode === "monitor";

  const reasonSummary = result.reasons.slice(0, 3).join("; ");
  const modeLabel = isMonitorOnly ? "[MONITOR]" : "[ACTIVE]";
  const logMsg = `[PanoptesAI] ${modeLabel} ${contentType} ${thingId} scored ${result.score}/100 — ${reasonSummary}`;
  console.log(logMsg);

  await context.redis.set(
    `panoptes:${thingId}`,
    JSON.stringify({
      score: result.score,
      reasons: result.reasons,
      action: isMonitorOnly ? "log" : result.action,
      action_mode: result.action_mode,
      ai_summary: result.ai_summary,
      timestamp: Date.now(),
    }),
    { expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
  );

  if (isMonitorOnly) {
    console.log(`[PanoptesAI] Monitor mode — no action taken on ${thingId}`);
    return;
  }

  const action = result.action;
  if (action === "report" || action === "review") {
    console.log(`[PanoptesAI] Flagged ${contentType} ${thingId} for review — score ${result.score}/100 — ${reasonSummary}`);
  } else if (action === "remove") {
    if (contentType === "post") {
      const post = await context.reddit.getPostById(thingId);
      await post.remove(false);
    } else {
      const comment = await context.reddit.getCommentById(thingId);
      await comment.remove(false);
    }
  }
}

Devvit.addTrigger({
  event: "PostSubmit",
  onEvent: async (event, context) => {
    const post = event.post;
    if (!post) return;

    const subreddit = cleanSubredditName(event.subreddit?.name ?? context.subredditName);
    const author = trimString(event.author?.name);
    if (!subreddit || !author) {
      logMissingScanFields("post", post.id, subreddit, author);
      return;
    }

    const payload: ScanRequest = {
      type: "post",
      reddit_id: post.id,
      subreddit,
      author,
      title: post.title ?? "",
      body: post.selftext ?? "",
      permalink: post.permalink ?? "",
      created_utc: toCreatedUtc(post.createdAt),
    };

    const result = await sendToApi(payload);
    if (result) {
      await handleResult(context, result, post.id, "post");
    }
  },
});

Devvit.addTrigger({
  event: "CommentSubmit",
  onEvent: async (event, context) => {
    const comment = event.comment;
    if (!comment) return;

    const subreddit = cleanSubredditName(event.subreddit?.name ?? context.subredditName);
    const author = trimString(event.author?.name ?? comment.author);
    if (!subreddit || !author) {
      logMissingScanFields("comment", comment.id, subreddit, author);
      return;
    }

    const payload: ScanRequest = {
      type: "comment",
      reddit_id: comment.id,
      subreddit,
      author,
      title: undefined,
      body: comment.body ?? "",
      permalink: comment.permalink ?? "",
      created_utc: toCreatedUtc(comment.createdAt),
    };

    const result = await sendToApi(payload);
    if (result) {
      await handleResult(context, result, comment.id, "comment");
    }
  },
});

export default Devvit;
