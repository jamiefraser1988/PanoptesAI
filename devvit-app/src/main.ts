import { Devvit, TriggerContext } from "@devvit/public-api";

Devvit.configure({
  redditAPI: true,
  http: true,
  redis: true,
});

const PANOPTES_API_URL = "https://workspace-jfwizkid.replit.app";
const RISK_THRESHOLD = 70;

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
      console.error(`PanoptesAI API returned ${response.status}`);
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
    if (contentType === "post") {
      const post = await context.reddit.getPostById(thingId);
      await post.report({ reason: `PanoptesAI: risk score ${result.score}/100 — ${reasonSummary}` });
    } else {
      const comment = await context.reddit.getCommentById(thingId);
      await comment.report({ reason: `PanoptesAI: risk score ${result.score}/100 — ${reasonSummary}` });
    }
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
    if (!post || !post.author) return;

    const payload: ScanRequest = {
      type: "post",
      reddit_id: post.id,
      subreddit: post.subreddit?.name ?? "",
      author: post.author,
      title: post.title ?? "",
      body: post.selftext ?? "",
      permalink: post.permalink ?? "",
      created_utc: post.createdAt ? Math.floor(post.createdAt / 1000) : Math.floor(Date.now() / 1000),
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
    if (!comment || !comment.author) return;

    const payload: ScanRequest = {
      type: "comment",
      reddit_id: comment.id,
      subreddit: comment.subreddit?.name ?? "",
      author: comment.author,
      title: undefined,
      body: comment.body ?? "",
      permalink: comment.permalink ?? "",
      created_utc: comment.createdAt ? Math.floor(comment.createdAt / 1000) : Math.floor(Date.now() / 1000),
    };

    const result = await sendToApi(payload);
    if (result) {
      await handleResult(context, result, comment.id, "comment");
    }
  },
});

export default Devvit;
