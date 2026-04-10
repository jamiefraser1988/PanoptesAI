import { useState, useMemo } from "react";
import { useGetStats, getGetStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { AlertTriangle, TrendingUp, ShieldAlert, Clock, Globe, Crosshair } from "lucide-react";

type Timeframe = "24h" | "7d" | "30d";

interface DailyActivity {
  date: string;
  subreddit: string;
  count: number;
}

interface SubredditBreakdown {
  subreddit: string;
  total: number;
  flagged: number;
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

  const threatIntelData = useMemo(() => {
    if (!stats?.by_subreddit) return [];
    return (stats.by_subreddit as SubredditBreakdown[])
      .filter((s) => s.flagged > 0)
      .sort((a, b) => b.flagged - a.flagged)
      .slice(0, 8)
      .map((s) => ({
        name: `r/${s.subreddit}`,
        flagged: s.flagged,
        safe: Math.max(0, s.total - s.flagged),
        rate: s.total > 0 ? Math.round((s.flagged / s.total) * 100) : 0,
      }));
  }, [stats?.by_subreddit]);

  const threatBreakdown = useMemo(() => {
    if (!stats?.top_reasons || stats.top_reasons.length === 0) return [];
    return stats.top_reasons.slice(0, 5).map((r) => ({
      name: r.reason,
      value: r.count,
    }));
  }, [stats?.top_reasons]);

  const chartColors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ];

  const pieColors = ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#10b981"];

  return (
    <div className="flex flex-col h-full gap-4 md:gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Stats & Analytics</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">System performance, scam vectors, and threat intelligence.</p>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
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

          <div className="pb-8">
            <div className="flex items-center gap-2 mb-4">
              <Crosshair className="w-5 h-5 text-primary" />
              <h2 className="text-lg md:text-xl font-bold text-foreground">Threat Intelligence</h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <Card className="flex flex-col">
                <CardHeader className="px-3 md:px-6">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" />
                    <CardTitle className="text-sm md:text-base font-semibold">Cross-Subreddit Threat Map</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-3 md:px-6">
                  {threatIntelData.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground text-sm">No threat data available for this timeframe</div>
                  ) : (
                    <div className="space-y-3">
                      {threatIntelData.map((sub) => (
                        <div key={sub.name} className="flex items-center gap-3">
                          <span className="text-xs text-foreground w-28 truncate shrink-0">{sub.name}</span>
                          <div className="flex-1 h-6 bg-accent/30 rounded-full overflow-hidden flex">
                            <div
                              className="h-full bg-red-500/70 rounded-l-full flex items-center justify-end px-1.5 min-w-[20px]"
                              style={{ width: `${Math.max(5, sub.rate)}%` }}
                            >
                              <span className="text-[9px] text-white font-bold">{sub.flagged}</span>
                            </div>
                            <div
                              className="h-full bg-green-500/30 flex items-center px-1.5"
                              style={{ width: `${Math.max(5, 100 - sub.rate)}%` }}
                            >
                              <span className="text-[9px] text-muted-foreground">{sub.safe}</span>
                            </div>
                          </div>
                          <Badge variant="outline" className={`text-[10px] shrink-0 ${sub.rate >= 50 ? "text-red-500 border-red-500/20" : sub.rate >= 20 ? "text-amber-500 border-amber-500/20" : "text-green-500 border-green-500/20"}`}>
                            {sub.rate}%
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="flex flex-col">
                <CardHeader className="px-3 md:px-6">
                  <CardTitle className="text-sm md:text-base font-semibold">Threat Type Distribution</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 min-h-[250px] px-3 md:px-6">
                  {threatBreakdown.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No threat type data available</div>
                  ) : (
                    <div className="flex flex-col md:flex-row items-center gap-4 h-full">
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={threatBreakdown}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {threatBreakdown.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ backgroundColor: "hsl(var(--popover))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap md:flex-col gap-2">
                        {threatBreakdown.map((item, idx) => (
                          <div key={item.name} className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pieColors[idx % pieColors.length] }} />
                            <span className="text-xs text-muted-foreground">{item.name}</span>
                            <span className="text-xs font-medium text-foreground">({item.value})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
