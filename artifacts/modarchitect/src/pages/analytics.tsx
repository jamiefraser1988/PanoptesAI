import { useState, useMemo } from "react";
import { useGetStats, getGetStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { AlertTriangle, TrendingUp, ShieldAlert, Clock } from "lucide-react";

type Timeframe = "24h" | "7d" | "30d";

interface DailyActivity {
  date: string;
  subreddit: string;
  count: number;
}

export default function Analytics() {
  const [timeframe, setTimeframe] = useState<Timeframe>("24h");

  const queryParams = { timeframe };
  const { data: stats, isLoading } = useGetStats(
    queryParams,
    { query: { queryKey: getGetStatsQueryKey(queryParams) } }
  );

  const stackedActivityData = useMemo(() => {
    if (!stats?.daily_activity || stats.daily_activity.length === 0) return [];

    const dates = [...new Set((stats.daily_activity as DailyActivity[]).map((d) => d.date))].sort();
    const subreddits = [...new Set((stats.daily_activity as DailyActivity[]).map((d) => d.subreddit))];

    return dates.map((date) => {
      const row: Record<string, string | number> = { date };
      for (const sub of subreddits) {
        const entry = (stats.daily_activity as DailyActivity[]).find(
          (d) => d.date === date && d.subreddit === sub
        );
        row[sub] = entry?.count ?? 0;
      }
      return row;
    });
  }, [stats?.daily_activity]);

  const stackedSubreddits = useMemo(() => {
    if (!stats?.daily_activity) return [];
    return [...new Set((stats.daily_activity as DailyActivity[]).map((d) => d.subreddit))];
  }, [stats?.daily_activity]);

  const chartColors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ];

  return (
    <div className="flex flex-col h-full gap-4 md:gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Stats & Analytics</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">System performance and scam vectors.</p>
        </div>
        <div className="flex h-10 md:h-8 rounded-md border border-border overflow-hidden self-start">
          {(["24h", "7d", "30d"] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-4 md:px-3 text-xs transition-colors min-h-[44px] md:min-h-0 ${
                timeframe === tf
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent/10"
              }`}
              data-testid={`toggle-${tf}`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {!stats || isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading analytics...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 md:px-6 pt-3 md:pt-6">
                <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Total Flagged</CardTitle>
                <AlertTriangle className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
                <div className="text-xl md:text-2xl font-bold text-foreground" data-testid="stat-flagged">{stats.flagged_posts}</div>
                <p className="text-[10px] md:text-xs text-muted-foreground mt-1">{stats.flag_rate_pct.toFixed(1)}% flag rate</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 md:px-6 pt-3 md:pt-6">
                <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Mean Risk</CardTitle>
                <TrendingUp className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
                <div className="text-xl md:text-2xl font-bold text-foreground" data-testid="stat-mean-score">{stats.mean_score.toFixed(1)}</div>
                <p className="text-[10px] md:text-xs text-muted-foreground mt-1">Avg flagged score</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 md:px-6 pt-3 md:pt-6">
                <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">False Pos.</CardTitle>
                <ShieldAlert className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
                <div className="text-xl md:text-2xl font-bold text-foreground" data-testid="stat-false-positives">{stats.false_positive_count}</div>
                <p className="text-[10px] md:text-xs text-muted-foreground mt-1">Confirmed safe</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 px-3 md:px-6 pt-3 md:pt-6">
                <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Pending</CardTitle>
                <Clock className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent className="px-3 md:px-6 pb-3 md:pb-6">
                <div className="text-xl md:text-2xl font-bold text-foreground" data-testid="stat-pending">{stats.pending_review_count}</div>
                <p className="text-[10px] md:text-xs text-muted-foreground mt-1">Awaiting review</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 pb-8">
            <Card className="flex flex-col">
              <CardHeader className="px-3 md:px-6">
                <CardTitle className="text-sm md:text-base font-semibold">Top Scam Vectors</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-[250px] md:min-h-[300px] px-3 md:px-6">
                {stats.top_reasons.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No vector data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.top_reasons} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis
                        dataKey="reason"
                        type="category"
                        width={100}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={10}
                        tickFormatter={(val: string) => val.length > 14 ? val.substring(0, 14) + "..." : val}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
                        itemStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader className="px-3 md:px-6">
                <CardTitle className="text-sm md:text-base font-semibold">Daily Activity by Subreddit</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-[250px] md:min-h-[300px] px-3 md:px-6">
                {stackedActivityData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No activity data available for this timeframe</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stackedActivityData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={10}
                        tickFormatter={(val: string) => val.length > 8 ? val.substring(5) : val}
                      />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} width={30} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
                        itemStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      {stackedSubreddits.map((sub, idx) => (
                        <Bar
                          key={sub}
                          dataKey={sub}
                          stackId="a"
                          fill={chartColors[idx % chartColors.length]}
                          radius={idx === stackedSubreddits.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
