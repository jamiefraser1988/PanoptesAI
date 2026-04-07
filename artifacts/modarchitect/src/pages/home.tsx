import { Link } from "wouter";
import { Shield, Activity, Settings, ArrowRight, Lock, Zap, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-16 flex items-center justify-between px-6 border-b border-border bg-card/50">
        <div className="flex items-center">
          <Shield className="w-6 h-6 text-primary mr-2" />
          <h1 className="font-bold text-lg tracking-tight">
            <span className="text-primary">MOD</span>Architect
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
            MODArchitect monitors your subreddits in real time, scoring every post and comment
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
