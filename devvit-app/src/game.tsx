import { Devvit } from "@devvit/public-api";

const GRID = 5;
const CENTER = 2;
const MAX_LIVES = 3;
const TICK_MS = 1500;

type ThreatType = "bot" | "phish" | "spam";

interface Threat {
  id: number;
  x: number;
  y: number;
  type: ThreatType;
}

interface LeaderEntry {
  name: string;
  score: number;
}

const THREAT_INFO: Record<ThreatType, { emoji: string; points: number; bg: string }> = {
  bot: { emoji: "\u{1F916}", points: 10, bg: "#6B1010" },
  phish: { emoji: "\u{1F3A3}", points: 15, bg: "#3B1065" },
  spam: { emoji: "\u{1F4E7}", points: 5, bg: "#5E5E10" },
};

const TYPES: ThreatType[] = ["bot", "phish", "spam"];

function pickEdge(): [number, number] {
  const side = Math.floor(Math.random() * 4);
  const pos = Math.floor(Math.random() * GRID);
  if (side === 0) return [pos, 0];
  if (side === 1) return [pos, GRID - 1];
  if (side === 2) return [0, pos];
  return [GRID - 1, pos];
}

function stepToward(x: number, y: number): [number, number] {
  const dx = CENTER - x;
  const dy = CENTER - y;
  if (dx === 0 && dy === 0) return [x, y];
  if (Math.abs(dx) >= Math.abs(dy)) return [x + Math.sign(dx), y];
  return [x, y + Math.sign(dy)];
}

function lbKey(subredditId: string): string {
  return `panoptes:game:lb:${subredditId}`;
}

function bestKey(userId: string, subredditId: string): string {
  return `panoptes:game:best:${subredditId}:${userId}`;
}

Devvit.addCustomPostType({
  name: "PanoptesDefense",
  description: "Eyes of Panoptes \u2014 defend your subreddit!",
  render: (context) => {
    const [phase, setPhase] = context.useState<string>("menu");
    const [threatsStr, setThreatsStr] = context.useState<string>("[]");
    const [score, setScore] = context.useState<number>(0);
    const [wave, setWave] = context.useState<number>(1);
    const [lives, setLives] = context.useState<number>(MAX_LIVES);
    const [nextId, setNextId] = context.useState<number>(1);
    const [spawned, setSpawned] = context.useState<number>(0);
    const [maxSpawn, setMaxSpawn] = context.useState<number>(3);
    const [ticks, setTicks] = context.useState<number>(0);
    const [lbStr, setLbStr] = context.useState<string>("[]");
    const [best, setBest] = context.useState<number>(0);
    const [rank, setRank] = context.useState<number>(0);

    const threats: Threat[] = JSON.parse(threatsStr);
    const lb: LeaderEntry[] = JSON.parse(lbStr);

    const gameLoop = context.useInterval(async () => {
      if (phase !== "playing") return;

      const currentThreats: Threat[] = JSON.parse(threatsStr);
      let currentLives = lives;
      let currentTicks = ticks + 1;
      let currentScore = score;
      let currentWave = wave;
      let currentSpawned = spawned;
      let currentMaxSpawn = maxSpawn;
      let currentNextId = nextId;

      const stepsPerTick = Math.min(1 + Math.floor((currentWave - 1) / 2), 3);
      const moved: Threat[] = [];
      for (const t of currentThreats) {
        let tx = t.x;
        let ty = t.y;
        let reached = false;
        for (let s = 0; s < stepsPerTick; s++) {
          const [nx, ny] = stepToward(tx, ty);
          if (nx === CENTER && ny === CENTER) {
            reached = true;
            break;
          }
          tx = nx;
          ty = ny;
        }
        if (reached) {
          currentLives--;
        } else {
          moved.push({ ...t, x: tx, y: ty });
        }
      }

      let finalThreats = moved;

      if (currentLives <= 0) {
        currentLives = 0;
        setPhase("gameover");
        setLives(0);
        setThreatsStr(JSON.stringify(finalThreats));
        setTicks(currentTicks);
        gameLoop.stop();

        const uid = context.userId;
        const sid = context.subredditId;
        if (uid && sid) {
          const uname = (await context.reddit.getUserById(uid))?.username ?? uid;
          const currentBest = await context.redis.get(bestKey(uid, sid));
          if (!currentBest || currentScore > parseInt(currentBest, 10)) {
            await context.redis.set(bestKey(uid, sid), currentScore.toString());
            setBest(currentScore);
          } else {
            setBest(parseInt(currentBest, 10));
          }
          const existing = await context.redis.zScore(lbKey(sid), uname);
          if (existing === undefined || existing === null || currentScore > existing) {
            await context.redis.zAdd(lbKey(sid), { member: uname, score: currentScore });
          }
          const allEntries = await context.redis.zRange(lbKey(sid), 0, 99, { reverse: true, by: "rank" });
          setLbStr(JSON.stringify(allEntries.slice(0, 10).map((e) => ({ name: e.member, score: e.score }))));
          const playerRank = allEntries.findIndex((e) => e.member === uname) + 1;
          setRank(playerRank > 0 ? playerRank : allEntries.length + 1);
        }
        return;
      }

      if (currentSpawned < currentMaxSpawn && currentTicks % 2 === 0) {
        const [sx, sy] = pickEdge();
        if (!(sx === CENTER && sy === CENTER) && !finalThreats.some((t) => t.x === sx && t.y === sy)) {
          const type = TYPES[Math.floor(Math.random() * TYPES.length)];
          finalThreats = [...finalThreats, { id: currentNextId, x: sx, y: sy, type }];
          currentNextId++;
          currentSpawned++;
        }
      }

      if (currentSpawned >= currentMaxSpawn && finalThreats.length === 0) {
        currentScore += currentWave * 50;
        currentWave++;
        currentMaxSpawn = 2 + currentWave * 2;
        currentSpawned = 0;
        currentTicks = 0;
      }

      setThreatsStr(JSON.stringify(finalThreats));
      setLives(currentLives);
      setTicks(currentTicks);
      setScore(currentScore);
      setWave(currentWave);
      setSpawned(currentSpawned);
      setMaxSpawn(currentMaxSpawn);
      setNextId(currentNextId);
    }, TICK_MS);

    function startGame() {
      setPhase("playing");
      setThreatsStr("[]");
      setScore(0);
      setWave(1);
      setLives(MAX_LIVES);
      setNextId(1);
      setSpawned(0);
      setMaxSpawn(3);
      setTicks(0);
      gameLoop.start();
    }

    function handleTap(x: number, y: number) {
      if (phase !== "playing") return;
      const currentThreats: Threat[] = JSON.parse(threatsStr);
      const idx = currentThreats.findIndex((t) => t.x === x && t.y === y);
      if (idx === -1) return;
      const threat = currentThreats[idx];
      const pts = THREAT_INFO[threat.type].points;
      setThreatsStr(JSON.stringify(currentThreats.filter((_, i) => i !== idx)));
      setScore(score + pts);
    }

    async function showLeaderboard() {
      const sid = context.subredditId;
      if (sid) {
        const entries = await context.redis.zRange(lbKey(sid), 0, 9, { reverse: true, by: "rank" });
        setLbStr(JSON.stringify(entries.map((e) => ({ name: e.member, score: e.score }))));
      }
      const uid = context.userId;
      if (uid && sid) {
        const b = await context.redis.get(bestKey(uid, sid));
        if (b) setBest(parseInt(b, 10));
      }
      setPhase("leaderboard");
    }

    function goMenu() {
      gameLoop.stop();
      setPhase("menu");
      setThreatsStr("[]");
      setScore(0);
      setWave(1);
      setLives(MAX_LIVES);
      setNextId(1);
      setSpawned(0);
      setMaxSpawn(3);
      setTicks(0);
    }

    const hearts = "\u2764\uFE0F".repeat(lives) + "\u{1F5A4}".repeat(MAX_LIVES - lives);

    function renderCell(x: number, y: number) {
      if (x === CENTER && y === CENTER) {
        return (
          <zstack
            width="52px"
            height="52px"
            alignment="center middle"
            cornerRadius="small"
            backgroundColor="#C23A00"
          >
            <text size="xlarge">{"\u{1F441}"}</text>
          </zstack>
        );
      }

      const threat = threats.find((t) => t.x === x && t.y === y);
      if (threat) {
        const info = THREAT_INFO[threat.type];
        return (
          <zstack
            width="52px"
            height="52px"
            alignment="center middle"
            cornerRadius="small"
            backgroundColor={info.bg}
            onPress={() => handleTap(x, y)}
          >
            <text size="xlarge">{info.emoji}</text>
          </zstack>
        );
      }

      return (
        <zstack
          width="52px"
          height="52px"
          cornerRadius="small"
          backgroundColor="#2A2520"
        >
          <text size="small">{" "}</text>
        </zstack>
      );
    }

    if (phase === "menu") {
      return (
        <vstack
          height="100%"
          width="100%"
          alignment="center middle"
          backgroundColor="#1A1714"
          padding="large"
          gap="medium"
        >
          <text size="xxlarge" weight="bold" color="#FF4500">
            {"\u{1F441}"} EYES OF PANOPTES
          </text>
          <text size="medium" color="#999999">
            Defend your subreddit from threats
          </text>
          <spacer size="small" />
          <hstack gap="medium" alignment="center">
            <vstack alignment="center" backgroundColor="#6B1010" padding="small" cornerRadius="small">
              <text size="large">{"\u{1F916}"}</text>
              <text size="xsmall" color="#CCCCCC">Bot 10pts</text>
            </vstack>
            <vstack alignment="center" backgroundColor="#3B1065" padding="small" cornerRadius="small">
              <text size="large">{"\u{1F3A3}"}</text>
              <text size="xsmall" color="#CCCCCC">Phish 15pts</text>
            </vstack>
            <vstack alignment="center" backgroundColor="#5E5E10" padding="small" cornerRadius="small">
              <text size="large">{"\u{1F4E7}"}</text>
              <text size="xsmall" color="#CCCCCC">Spam 5pts</text>
            </vstack>
          </hstack>
          <spacer size="small" />
          <text size="small" color="#777777">
            Tap threats before they reach the center!
          </text>
          <spacer size="medium" />
          <button appearance="primary" onPress={startGame}>Play</button>
          <button appearance="bordered" onPress={showLeaderboard}>Leaderboard</button>
        </vstack>
      );
    }

    if (phase === "playing") {
      return (
        <vstack
          height="100%"
          width="100%"
          backgroundColor="#1A1714"
          padding="medium"
          alignment="center"
          gap="small"
        >
          <hstack width="100%" alignment="center" gap="medium">
            <text size="medium" weight="bold" color="#FF4500">Score: {score}</text>
            <text size="medium" color="#FFFFFF">Wave {wave}</text>
            <text size="medium">{hearts}</text>
          </hstack>
          <spacer size="small" />
          <vstack gap="small" alignment="center">
            {[0, 1, 2, 3, 4].map((y) => (
              <hstack gap="small">
                {[0, 1, 2, 3, 4].map((x) => renderCell(x, y))}
              </hstack>
            ))}
          </vstack>
          <spacer size="small" />
          <text size="xsmall" color="#555555">Tap threats to zap them!</text>
        </vstack>
      );
    }

    if (phase === "gameover") {
      return (
        <vstack
          height="100%"
          width="100%"
          alignment="center middle"
          backgroundColor="#1A1714"
          padding="large"
          gap="medium"
        >
          <text size="xxlarge" weight="bold" color="#FF4500">GAME OVER</text>
          <text size="xlarge" weight="bold" color="#FFFFFF">Score: {score}</text>
          <hstack gap="medium" alignment="center">
            <text size="medium" color="#999999">Wave {wave}</text>
            {rank > 0 && (
              <text size="medium" color="#FF4500">Rank #{rank}</text>
            )}
          </hstack>
          {best > 0 && (
            <text size="small" color="#FF4500">Personal best: {best}</text>
          )}
          <spacer size="small" />
          {lb.length > 0 && (
            <vstack width="100%" backgroundColor="#2A2520" cornerRadius="medium" padding="medium" gap="small">
              <text size="small" weight="bold" color="#FF4500">Top Scores</text>
              {lb.slice(0, 5).map((entry, i) => (
                <hstack width="100%" alignment="center">
                  <text size="small" color="#999999">{i + 1}.</text>
                  <spacer size="small" />
                  <text size="small" color="#FFFFFF" grow>{entry.name}</text>
                  <text size="small" weight="bold" color="#FF4500">{entry.score}</text>
                </hstack>
              ))}
            </vstack>
          )}
          <spacer size="small" />
          <button appearance="primary" onPress={startGame}>Play Again</button>
          <button appearance="bordered" onPress={goMenu}>Menu</button>
          <spacer size="small" />
          <button
            appearance="bordered"
            onPress={() => context.ui.navigateTo("https://workspace-jfwizkid.replit.app")}
          >
            {"\u{1F6E1}"} Protect your real subreddit
          </button>
        </vstack>
      );
    }

    if (phase === "leaderboard") {
      return (
        <vstack
          height="100%"
          width="100%"
          alignment="center middle"
          backgroundColor="#1A1714"
          padding="large"
          gap="medium"
        >
          <text size="xxlarge" weight="bold" color="#FF4500">{"\u{1F3C6}"} LEADERBOARD</text>
          {best > 0 && (
            <text size="small" color="#FF4500">Your best: {best}</text>
          )}
          <spacer size="small" />
          {lb.length === 0 ? (
            <text size="medium" color="#777777">No scores yet. Be the first!</text>
          ) : (
            <vstack width="100%" backgroundColor="#2A2520" cornerRadius="medium" padding="medium" gap="small">
              {lb.map((entry, i) => (
                <hstack width="100%" alignment="center">
                  <text size="small" weight="bold" color={i < 3 ? "#FF4500" : "#999999"}>#{i + 1}</text>
                  <spacer size="small" />
                  <text size="small" color="#FFFFFF" grow>{entry.name}</text>
                  <text size="small" weight="bold" color="#FF4500">{entry.score}</text>
                </hstack>
              ))}
            </vstack>
          )}
          <spacer size="medium" />
          <button appearance="primary" onPress={goMenu}>Back</button>
        </vstack>
      );
    }

    return (
      <vstack alignment="center middle" padding="large">
        <text>Loading...</text>
      </vstack>
    );
  },
});

Devvit.addMenuItem({
  label: "Create Panoptes Defense Game",
  location: "subreddit",
  onPress: async (_event, context) => {
    const sub = await context.reddit.getCurrentSubreddit();
    await context.reddit.submitPost({
      title: "\u{1F441} Eyes of Panoptes \u2014 Defend Your Subreddit!",
      subredditName: sub.name,
      preview: (
        <vstack padding="large" alignment="center middle" backgroundColor="#1A1714" height="100%">
          <text size="xlarge" color="#FF4500" weight="bold">Loading game...</text>
        </vstack>
      ),
    });
    context.ui.showToast("Game post created!");
  },
});
