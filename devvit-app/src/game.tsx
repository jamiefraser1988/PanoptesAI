import { Devvit } from "@devvit/public-api";

const GRID = 5;
const CENTER = 2;
const MAX_LIVES = 3;
const TICK_MS = 1500;
const TILE_SIZE = "42px";
const SCREEN_BG = "#0B1120";
const PANEL_BG = "#152238";
const PANEL_BG_MUTED = "#0F172A";
const EMPTY_CELL_BG = "#111C2E";
const CORE_BG = "#0C4A6E";
const ACCENT = "#38BDF8";
const MUTED_TEXT = "#94A3B8";
const SUBTLE_TEXT = "#64748B";

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
  bot: { emoji: "\u{1F916}", points: 10, bg: "#7F1D1D" },
  phish: { emoji: "\u{1F3A3}", points: 15, bg: "#581C87" },
  spam: { emoji: "\u{1F4E7}", points: 5, bg: "#713F12" },
};

const TYPES: ThreatType[] = ["bot", "phish", "spam"];

function getThreatLabel(type: ThreatType): string {
  if (type === "bot") return "Bot";
  if (type === "phish") return "Phish";
  return "Spam";
}

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
    const threatsRemaining = threats.length + Math.max(0, maxSpawn - spawned);

    function renderStatCard(label: string, value: string, color: string) {
      return (
        <vstack
          backgroundColor={PANEL_BG}
          padding="small"
          cornerRadius="small"
          alignment="center"
        >
          <text size="xsmall" color={SUBTLE_TEXT}>{label}</text>
          <text size="medium" weight="bold" color={color}>{value}</text>
        </vstack>
      );
    }

    function renderThreatChip(type: ThreatType) {
      const info = THREAT_INFO[type];
      return (
        <vstack
          key={type}
          alignment="center"
          backgroundColor={info.bg}
          padding="small"
          cornerRadius="small"
        >
          <text size="large">{info.emoji}</text>
          <text size="xsmall" color="#E2E8F0">
            {getThreatLabel(type)} {info.points}
          </text>
        </vstack>
      );
    }

    function renderCell(x: number, y: number) {
      if (x === CENTER && y === CENTER) {
        return (
          <zstack
            width={TILE_SIZE}
            height={TILE_SIZE}
            alignment="center middle"
            cornerRadius="small"
            backgroundColor={CORE_BG}
          >
            <text size="large">{"\u{1F441}"}</text>
          </zstack>
        );
      }

      const threat = threats.find((t) => t.x === x && t.y === y);
      if (threat) {
        const info = THREAT_INFO[threat.type];
        return (
          <zstack
            width={TILE_SIZE}
            height={TILE_SIZE}
            alignment="center middle"
            cornerRadius="small"
            backgroundColor={info.bg}
            onPress={() => handleTap(x, y)}
          >
            <text size="large">{info.emoji}</text>
          </zstack>
        );
      }

      return (
        <zstack
          width={TILE_SIZE}
          height={TILE_SIZE}
          cornerRadius="small"
          backgroundColor={EMPTY_CELL_BG}
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
          alignment="center"
          backgroundColor={SCREEN_BG}
          padding="medium"
          gap="small"
        >
          <text size="xlarge" weight="bold" color={ACCENT}>
            {"\u{1F441}"} EYES OF PANOPTES
          </text>
          <text size="small" color={MUTED_TEXT}>
            Tap threats before they reach the eye.
          </text>
          <vstack
            width="100%"
            backgroundColor={PANEL_BG}
            cornerRadius="medium"
            padding="medium"
            gap="small"
            alignment="center"
          >
            <text size="small" weight="bold" color={ACCENT}>Threat guide</text>
            <hstack gap="small" alignment="center">
              {TYPES.map((type) => renderThreatChip(type))}
            </hstack>
            <text size="xsmall" color={SUBTLE_TEXT}>
              Clear a wave to bank a bonus. Miss three threats and the eye falls.
            </text>
          </vstack>
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
          backgroundColor={SCREEN_BG}
          padding="small"
          alignment="center"
          gap="small"
        >
          <text size="medium" weight="bold" color={ACCENT}>Defend the eye</text>
          <hstack width="100%" alignment="center" gap="small">
            {renderStatCard("Score", score.toString(), ACCENT)}
            {renderStatCard("Wave", wave.toString(), "#E2E8F0")}
            {renderStatCard("Lives", hearts, "#F87171")}
          </hstack>
          <text size="xsmall" color={SUBTLE_TEXT}>
            {threatsRemaining} threats left in this wave
          </text>
          <vstack
            gap="small"
            alignment="center"
            backgroundColor={PANEL_BG_MUTED}
            padding="small"
            cornerRadius="medium"
          >
            {[0, 1, 2, 3, 4].map((y) => (
              <hstack key={`row-${y}`} gap="small">
                {[0, 1, 2, 3, 4].map((x) => (
                  <vstack key={`cell-${x}-${y}`}>{renderCell(x, y)}</vstack>
                ))}
              </hstack>
            ))}
          </vstack>
          <text size="xsmall" color={SUBTLE_TEXT}>
            Tap fast. The center square must stay clear.
          </text>
        </vstack>
      );
    }

    if (phase === "gameover") {
      return (
        <vstack
          height="100%"
          width="100%"
          alignment="center"
          backgroundColor={SCREEN_BG}
          padding="medium"
          gap="small"
        >
          <text size="xlarge" weight="bold" color={ACCENT}>GAME OVER</text>
          <vstack
            width="100%"
            backgroundColor={PANEL_BG}
            cornerRadius="medium"
            padding="medium"
            gap="small"
            alignment="center"
          >
            <text size="large" weight="bold" color="#FFFFFF">Score: {score}</text>
            <hstack gap="medium" alignment="center">
              <text size="small" color={MUTED_TEXT}>Wave {wave}</text>
              {rank > 0 && (
                <text size="small" color={ACCENT}>Rank #{rank}</text>
              )}
            </hstack>
            {best > 0 && (
              <text size="xsmall" color={ACCENT}>Personal best: {best}</text>
            )}
          </vstack>
          {lb.length > 0 && (
            <vstack width="100%" backgroundColor={PANEL_BG_MUTED} cornerRadius="medium" padding="medium" gap="small">
              <text size="small" weight="bold" color={ACCENT}>Top Scores</text>
              {lb.slice(0, 5).map((entry, i) => (
                <hstack key={`score-${entry.name}-${i}`} width="100%" alignment="center">
                  <text size="small" color={MUTED_TEXT}>{i + 1}.</text>
                  <spacer size="small" />
                  <text size="small" color="#FFFFFF" grow>{entry.name}</text>
                  <text size="small" weight="bold" color={ACCENT}>{entry.score}</text>
                </hstack>
              ))}
            </vstack>
          )}
          <button appearance="primary" onPress={startGame}>Play Again</button>
          <button appearance="bordered" onPress={goMenu}>Menu</button>
          <button
            appearance="bordered"
            onPress={() => context.ui.navigateTo("https://workspace-jfwizkid.replit.app")}
          >
            {"\u{1F6E1}"} Protect your subreddit
          </button>
        </vstack>
      );
    }

    if (phase === "leaderboard") {
      return (
        <vstack
          height="100%"
          width="100%"
          alignment="center"
          backgroundColor={SCREEN_BG}
          padding="medium"
          gap="small"
        >
          <text size="xlarge" weight="bold" color={ACCENT}>{"\u{1F3C6}"} LEADERBOARD</text>
          {best > 0 && (
            <text size="small" color={ACCENT}>Your best: {best}</text>
          )}
          {lb.length === 0 ? (
            <text size="small" color={SUBTLE_TEXT}>No scores yet. Be the first defender.</text>
          ) : (
            <vstack width="100%" backgroundColor={PANEL_BG} cornerRadius="medium" padding="medium" gap="small">
              {lb.map((entry, i) => (
                <hstack key={`leader-${entry.name}-${i}`} width="100%" alignment="center">
                  <text size="small" weight="bold" color={i < 3 ? ACCENT : MUTED_TEXT}>#{i + 1}</text>
                  <spacer size="small" />
                  <text size="small" color="#FFFFFF" grow>{entry.name}</text>
                  <text size="small" weight="bold" color={ACCENT}>{entry.score}</text>
                </hstack>
              ))}
            </vstack>
          )}
          <button appearance="primary" onPress={goMenu}>Back</button>
        </vstack>
      );
    }

    return (
      <vstack alignment="center middle" padding="large" backgroundColor={SCREEN_BG}>
        <text color={MUTED_TEXT}>Loading...</text>
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
        <vstack padding="large" alignment="center middle" backgroundColor={SCREEN_BG} height="100%">
          <text size="xlarge" color={ACCENT} weight="bold">Loading game...</text>
        </vstack>
      ),
    });
    context.ui.showToast("Game post created!");
  },
});
