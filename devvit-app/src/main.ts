import { Devvit, TriggerContext } from "@devvit/public-api";

Devvit.configure({
  redditAPI: true,
  http: true,
  redis: true,
});

Devvit.addSettings([
  {
    name: "panoptesApiUrl",
    label: "PanoptesAI API URL",
    type: "string",
    scope: "installation",
    defaultValue: "",
    helpText: "The full URL of your PanoptesAI API server (e.g. https://your-app.replit.app)",
  },
  {
    name: "panoptesApiKey",
    label: "PanoptesAI API Key",
    type: "string",
    isSecret: true,
    scope: "installation",
    helpText: "API key for authenticating with PanoptesAI (from your dashboard settings)",
  },
  {
    name: "riskThreshold",
    label: "Risk Score Threshold (0-100)",
    type: "number",
    scope: "installation",
    defaultValue: 70,
    helpText: "Posts/comments scoring at or above this will trigger mod actions",
  },
  {
    name: "actionMode",
    label: "Action Mode",
    type: "select",
    options: [
      { label: "Log only (no mod actions)", value: "log" },
      { label: "Report to mod queue", value: "report" },
      { label: "Remove automatically", value: "remove" },
    ],
    scope: "installation",
    defaultValue: ["log"],
    helpText: "What to do when a post/comment exceeds the risk threshold",
  },
]);

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

async function getAuthorAge(
  context: TriggerContext,
  username: string
): Promise<number | null> {
  try {
    const user = await context.reddit.getUserByUsername(username);
    if (user.createdAt) {
      const ageMs = Date.now() - user.createdAt.getTime();
      return Math.floor(ageMs / (1000 * 60 * 60 * 24));
    }
  } catch {
    // user may be deleted or suspended
  }
  return null;
}

async function sendToApi(
  context: TriggerContext,
  payload: ScanRequest
): Promise<ScanResponse | null> {
  const apiUrl = await context.settings.get<string>("panoptesApiUrl");
  const apiKey = await context.settings.get<string>("panoptesApiKey");

  if (!apiUrl) {
    console.log("PanoptesAI API URL not configured — skipping scan");
    return null;
  }

  try {
    const url = `${apiUrl.replace(/\/$/, "")}/api/devvit/scan`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
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
  const threshold = (await context.settings.get<number>("riskThreshold")) ?? 70;
  const actionModeRaw = await context.settings.get<string[]>("actionMode");
  const actionMode = Array.isArray(actionModeRaw) ? actionModeRaw[0] : actionModeRaw ?? "log";

  if (result.score < threshold) {
    return;
  }

  const serverMode = result.action_mode;
  const isMonitorOnly = serverMode === "monitor";

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
      action_mode: serverMode,
      ai_summary: result.ai_summary,
      timestamp: Date.now(),
    }),
    { expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
  );

  if (isMonitorOnly) {
    console.log(`[PanoptesAI] Monitor mode — no action taken on ${thingId}`);
    return;
  }

  if (actionMode === "report") {
    if (contentType === "post") {
      const post = await context.reddit.getPostById(thingId);
      await post.report({ reason: `PanoptesAI: risk score ${result.score}/100 — ${reasonSummary}` });
    } else {
      const comment = await context.reddit.getCommentById(thingId);
      await comment.report({ reason: `PanoptesAI: risk score ${result.score}/100 — ${reasonSummary}` });
    }
  } else if (actionMode === "remove") {
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

    const authorAge = await getAuthorAge(context, post.author);

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

    const result = await sendToApi(context, payload);
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

    const result = await sendToApi(context, payload);
    if (result) {
      await handleResult(context, result, comment.id, "comment");
    }
  },
});

export default Devvit;
