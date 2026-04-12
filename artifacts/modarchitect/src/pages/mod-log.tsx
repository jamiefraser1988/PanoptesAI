import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { resolveApiUrl } from "@/lib/runtime";
import { ScrollText, ChevronLeft, ChevronRight, Shield, CheckCircle, XCircle, HelpCircle, AlertTriangle } from "lucide-react";

interface ModActionItem {
  id: number;
  tenantId: number;
  action: string;
  targetId: string;
  targetType: string;
  author: string | null;
  subreddit: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface ModActionsResponse {
  items: ModActionItem[];
  total: number;
  page: number;
  total_pages: number;
}

const ACTION_LABELS: Record<string, { label: string; color: string; Icon: typeof Shield }> = {
  confirm_scam: { label: "Confirmed Scam", color: "text-red-500 bg-red-500/10 border-red-500/20", Icon: CheckCircle },
  mark_safe: { label: "Marked Safe", color: "text-green-500 bg-green-500/10 border-green-500/20", Icon: XCircle },
  mark_unclear: { label: "Marked Unclear", color: "text-amber-500 bg-amber-500/10 border-amber-500/20", Icon: HelpCircle },
  bulk_safe: { label: "Bulk Marked Safe", color: "text-green-500 bg-green-500/10 border-green-500/20", Icon: XCircle },
  bulk_scam: { label: "Bulk Confirmed Scam", color: "text-red-500 bg-red-500/10 border-red-500/20", Icon: CheckCircle },
  allowlist_add: { label: "Added to Allowlist", color: "text-blue-500 bg-blue-500/10 border-blue-500/20", Icon: Shield },
  blocklist_add: { label: "Added to Blocklist", color: "text-orange-500 bg-orange-500/10 border-orange-500/20", Icon: Shield },
};

type ActionFilter = "all" | "confirm_scam" | "mark_safe" | "mark_unclear";

export default function ModLog() {
  const [actions, setActions] = useState<ModActionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");

  const fetchActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20", action: actionFilter });
      const res = await fetch(resolveApiUrl(`/api/mod-actions?${params}`), { credentials: "include" });
      if (res.ok) {
        setActions(await res.json() as ModActionsResponse);
      } else {
        setError(`Failed to load actions (${res.status})`);
      }
    } catch (err) {
      setError("Failed to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const handleFilterChange = (filter: ActionFilter) => {
    setActionFilter(filter);
    setPage(1);
  };

  return (
    <div className="flex flex-col h-full gap-4 md:gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-primary" />
            Mod Action Log
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Audit trail of all moderation actions.</p>
        </div>
      </div>

      <div className="flex h-10 md:h-8 rounded-md border border-border overflow-hidden self-start">
        {([
          { value: "all", label: "All" },
          { value: "confirm_scam", label: "Scam" },
          { value: "mark_safe", label: "Safe" },
          { value: "mark_unclear", label: "Unclear" },
        ] as { value: ActionFilter; label: string }[]).map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilterChange(f.value)}
            className={`px-4 md:px-3 text-xs transition-colors min-h-[44px] md:min-h-0 ${
              actionFilter === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent/10"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="flex-1">
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading actions...</div>
          ) : error ? (
            <div className="py-12 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={fetchActions}>Retry</Button>
            </div>
          ) : !actions || actions.items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No mod actions recorded yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {actions.items.map((item) => {
                const actionInfo = ACTION_LABELS[item.action] ?? {
                  label: item.action,
                  color: "text-muted-foreground bg-muted/10 border-border/30",
                  Icon: Shield,
                };
                const ActionIcon = actionInfo.Icon;

                return (
                  <div key={item.id} className="flex items-start gap-3 p-4 hover:bg-accent/5 transition-colors">
                    <div className={`p-1.5 rounded-md shrink-0 mt-0.5 ${actionInfo.color.split(" ").slice(1).join(" ")}`}>
                      <ActionIcon className={`w-4 h-4 ${actionInfo.color.split(" ")[0]}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-xs ${actionInfo.color}`}>
                          {actionInfo.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          on {item.targetType} {item.targetId.substring(0, 8)}...
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                        {item.author && <span>u/{item.author}</span>}
                        {item.subreddit && <><span>·</span><span>r/{item.subreddit}</span></>}
                        <span>·</span>
                        <span>{new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {actions && actions.total_pages > 1 && (
        <div className="flex items-center justify-between pb-4">
          <span className="text-xs text-muted-foreground">
            Page {actions.page} of {actions.total_pages} ({actions.total} total)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= actions.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
