import { Link } from "wouter";
import { Activity, Settings, ArrowRight, Lock, Zap, BarChart3, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useListDecisions } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function getScoreColor(score: number) {
  if (score >= 70) return "text-red-500 bg-red-500/10 border-red-500/20";
  if (score >= 40) return "text-amber-500 bg-amber-500/10 border-amber-500/20";
  return "text-green-500 bg-green-500/10 border-green-500/20";
}

function RecentHighRiskItems() {
  const { data, isLoading } = useListDecisions({ limit: 5, sort_by: "score", page: 1 });

  return (
    <div className="w-full max-w-4xl mt-10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <h2 className="text-lg font-semibold text-foreground">Recent High-Risk Items</h2>
        </div>
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="text-primary text-xs gap-1">
            View Queue <ArrowRight className="w-3 h-3" />
          </Button>
        </Link>
      </div>
      <div className="bg-card border border-border rounded-lg divide-y divide-border">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : !data?.items?.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No flagged items found.</div>
        ) : (
          data.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/5 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <Badge variant="outline" className={`font-mono text-xs shrink-0 ${getScoreColor(item.score)}`}>
                  {item.score}
                </Badge>
                <span className="text-xs text-muted-foreground shrink-0">r/{item.subreddit}</span>
                <span className="text-sm text-foreground truncate">{item.title}</span>
              </div>
              <Link href="/dashboard">
                <span className="text-xs text-primary hover:text-primary/80 shrink-0 cursor-pointer">View &rarr;</span>
              </Link>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function Home({ isSignedIn = false }: { isSignedIn?: boolean }) {
  if (isSignedIn) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <header className="h-16 flex items-center justify-between px-6 border-b border-border bg-card/50">
          <div className="flex items-center gap-2">
            <img src={`${basePath}/logo.png`} alt="PanoptesAI" className="w-7 h-7 object-contain" />
            <h1 className="font-bold text-lg tracking-tight">
              <span className="text-primary">Panoptes</span>AI
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm">Queue</Button>
            </Link>
            <Link href="/analytics">
              <Button variant="ghost" size="sm">Analytics</Button>
            </Link>
            <Link href="/config">
              <Button variant="ghost" size="sm">Config</Button>
            </Link>
          </div>
        </header>
        <main className="flex-1 flex flex-col items-center px-6 py-12">
          <div className="w-full max-w-4xl">
            <h2 className="text-2xl font-bold text-foreground mb-1">Welcome back</h2>
            <p className="text-sm text-muted-foreground mb-8">Here's a snapshot of what's happening across your monitored subreddits.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
              <Link href="/dashboard">
                <div className="p-4 rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors cursor-pointer flex items-center gap-3">
                  <Activity className="w-5 h-5 text-primary" />
                  <div>
                    <div className="text-sm font-semibold">Flagged Queue</div>
                    <div className="text-xs text-muted-foreground">Review flagged content</div>
                  </div>
                </div>
              </Link>
              <Link href="/analytics">
                <div className="p-4 rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors cursor-pointer flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  <div>
                    <div className="text-sm font-semibold">Analytics</div>
                    <div className="text-xs text-muted-foreground">Trends & statistics</div>
                  </div>
                </div>
              </Link>
              <Link href="/config">
                <div className="p-4 rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors cursor-pointer flex items-center gap-3">
                  <Settings className="w-5 h-5 text-primary" />
                  <div>
                    <div className="text-sm font-semibold">Configuration</div>
                    <div className="text-xs text-muted-foreground">Thresholds & subreddits</div>
                  </div>
                </div>
              </Link>
            </div>
            <RecentHighRiskItems />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-16 flex items-center justify-between px-6 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          <img src={`${basePath}/logo.png`} alt="PanoptesAI" className="w-7 h-7 object-contain" />
          <h1 className="font-bold text-lg tracking-tight">
            <span className="text-primary">Panoptes</span>AI
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/sign-in">
            <Button variant="ghost" size="sm">Sign In</Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm">
              Get Started <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-3xl text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
            <Zap className="w-3 h-3" />
            Real-time Reddit Moderation
          </div>

          <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
            Protect your subreddit from{" "}
            <span className="text-primary">scams & bots</span>
          </h2>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            PanoptesAI monitors your subreddits in real time, scoring every post and comment
            for scam risk using advanced rule-based signals. Review flagged content, tune thresholds,
            and keep your community safe.
          </p>

          <div className="flex items-center justify-center gap-4 pt-4">
            <Link href="/sign-up">
              <Button size="lg">
                Start Monitoring <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mt-20">
          <div className="p-6 rounded-lg border border-border bg-card">
            <Lock className="w-8 h-8 text-primary mb-3" />
            <h3 className="font-semibold mb-2">Scam Detection</h3>
            <p className="text-sm text-muted-foreground">
              10+ scoring signals detect crypto scams, phishing links, bot accounts, and
              cross-subreddit spam — instantly.
            </p>
          </div>
          <div className="p-6 rounded-lg border border-border bg-card">
            <BarChart3 className="w-8 h-8 text-primary mb-3" />
            <h3 className="font-semibold mb-2">Analytics Dashboard</h3>
            <p className="text-sm text-muted-foreground">
              Track flagged content trends, scam vectors, and daily activity across all your
              monitored subreddits.
            </p>
          </div>
          <div className="p-6 rounded-lg border border-border bg-card">
            <Settings className="w-8 h-8 text-primary mb-3" />
            <h3 className="font-semibold mb-2">Configurable</h3>
            <p className="text-sm text-muted-foreground">
              Set risk thresholds, manage subreddits, configure webhook alerts for Discord
              or Slack — all from the dashboard.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
