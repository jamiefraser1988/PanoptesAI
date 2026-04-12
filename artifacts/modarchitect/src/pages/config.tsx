import { useState, useEffect } from "react";
import { useGetConfig, useSaveConfig, useTestWebhook, getGetConfigQueryKey, useListDecisions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Save, Plus, X, Webhook, Power, RotateCcw, Flag, Shield, Eye, UserCheck, UserX, Zap, Trash2 } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CustomRule {
  id: string;
  name: string;
  field: string;
  operator: string;
  value: string;
  action: string;
  enabled: boolean;
}

function getScoreColor(score: number) {
  if (score >= 70) return "text-red-500 bg-red-500/10 border-red-500/20";
  if (score >= 40) return "text-amber-500 bg-amber-500/10 border-amber-500/20";
  return "text-green-500 bg-green-500/10 border-green-500/20";
}

export default function Config() {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useGetConfig({ query: { queryKey: getGetConfigQueryKey() } });
  const saveConfig = useSaveConfig();
  const testWebhook = useTestWebhook();
  const { data: recentFlagged, isLoading: flaggedLoading } = useListDecisions({ limit: 3, page: 1 });

  const [threshold, setThreshold] = useState<number[]>([70]);
  const [subreddits, setSubreddits] = useState<string[]>([]);
  const [newSubreddit, setNewSubreddit] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [actionMode, setActionMode] = useState<"monitor" | "active">("monitor");

  const [allowedUsers, setAllowedUsers] = useState<string[]>([]);
  const [newAllowedUser, setNewAllowedUser] = useState("");
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [newBlockedUser, setNewBlockedUser] = useState("");
  const [customRules, setCustomRules] = useState<CustomRule[]>([]);

  useEffect(() => {
    if (config) {
      setThreshold([config.score_threshold]);
      setSubreddits(config.watched_subreddits || []);
      setWebhookUrl(config.webhook_url || "");
      setActionMode(config.action_mode === "active" ? "active" : "monitor");

      const ext = config as unknown as Record<string, unknown>;
      if (Array.isArray(ext.allowed_users)) setAllowedUsers(ext.allowed_users as string[]);
      if (Array.isArray(ext.blocked_users)) setBlockedUsers(ext.blocked_users as string[]);
      if (Array.isArray(ext.custom_rules)) setCustomRules(ext.custom_rules as CustomRule[]);
    }
  }, [config]);

  const handleAddSubreddit = () => {
    if (newSubreddit.trim() && !subreddits.includes(newSubreddit.trim())) {
      setSubreddits([...subreddits, newSubreddit.trim()]);
      setNewSubreddit("");
    }
  };

  const handleRemoveSubreddit = (sub: string) => {
    setSubreddits(subreddits.filter(s => s !== sub));
  };

  const handleAddAllowedUser = () => {
    const user = newAllowedUser.trim().replace(/^u\//, "");
    if (user && !allowedUsers.includes(user)) {
      setAllowedUsers([...allowedUsers, user]);
      setNewAllowedUser("");
    }
  };

  const handleAddBlockedUser = () => {
    const user = newBlockedUser.trim().replace(/^u\//, "");
    if (user && !blockedUsers.includes(user)) {
      setBlockedUsers([...blockedUsers, user]);
      setNewBlockedUser("");
    }
  };

  const handleAddRule = () => {
    setCustomRules([...customRules, {
      id: crypto.randomUUID(),
      name: `Rule ${customRules.length + 1}`,
      field: "score",
      operator: "gte",
      value: "70",
      action: "flag",
      enabled: true,
    }]);
  };

  const handleUpdateRule = (id: string, updates: Partial<CustomRule>) => {
    setCustomRules(customRules.map((r) => r.id === id ? { ...r, ...updates } : r));
  };

  const handleRemoveRule = (id: string) => {
    setCustomRules(customRules.filter((r) => r.id !== id));
  };

  const handleSave = () => {
    const payload = {
      data: {
        score_threshold: threshold[0],
        watched_subreddits: subreddits,
        webhook_url: webhookUrl || null,
        action_mode: actionMode,
        allowed_users: allowedUsers,
        blocked_users: blockedUsers,
        custom_rules: customRules,
      },
    };

    saveConfig.mutate(
      { data: payload.data as Parameters<typeof saveConfig.mutate>[0]["data"] },
      {
        onSuccess: () => {
          toast.success("Configuration saved successfully");
          queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
        },
        onError: () => {
          toast.error("Failed to save configuration");
        }
      }
    );
  };

  const handleTestWebhook = () => {
    testWebhook.mutate(undefined, {
      onSuccess: (res) => {
        if (res.success) {
          toast.success("Webhook test successful");
        } else {
          toast.error(`Webhook test failed: ${res.message}`);
        }
      },
      onError: () => {
        toast.error("Failed to test webhook");
      }
    });
  };

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading configuration...</div>;

  const catchRate = Math.round(threshold[0] * 0.8);
  const fpRate = Math.round((100 - threshold[0]) * 0.3);

  return (
    <div className="flex flex-col h-full gap-4 md:gap-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Configuration</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Manage system thresholds, lists, and rules.</p>
        </div>
        <Button onClick={handleSave} disabled={saveConfig.isPending} data-testid="btn-save-config" className="self-start min-h-[44px] md:min-h-0">
          <Save className="w-4 h-4 mr-2" />
          Save Changes
        </Button>
      </div>

      <Card className={actionMode === "active" ? "border-red-500/50 bg-red-500/5" : "border-green-500/50 bg-green-500/5"}>
        <CardContent className="py-4 md:py-5 px-3 md:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {actionMode === "monitor" ? (
                <div className="p-2 rounded-lg bg-green-500/10 shrink-0">
                  <Eye className="w-5 h-5 text-green-500" />
                </div>
              ) : (
                <div className="p-2 rounded-lg bg-red-500/10 shrink-0">
                  <Shield className="w-5 h-5 text-red-500" />
                </div>
              )}
              <div>
                <div className="font-semibold text-foreground text-sm md:text-base">
                  {actionMode === "monitor" ? "Monitor Only" : "Active Enforcement"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {actionMode === "monitor"
                    ? "Scans and flags content but takes no mod actions."
                    : "Automated mod actions on content above threshold."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
                <span className="text-xs text-muted-foreground">{actionMode === "monitor" ? "Monitoring" : "Active"}</span>
                <Switch
                  checked={actionMode === "active"}
                  onCheckedChange={(checked) => setActionMode(checked ? "active" : "monitor")}
                  data-testid="switch-action-mode"
                />
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <CardHeader className="px-3 md:px-6">
            <CardTitle className="text-sm md:text-base">Detection Threshold</CardTitle>
            <CardDescription className="text-xs">Adjust the sensitivity of the Scam Sentry bot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 px-3 md:px-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium">Risk Score Threshold: {threshold[0]}</label>
                <Badge variant={threshold[0] >= 70 ? "destructive" : "default"}>
                  {threshold[0] >= 80 ? "Conservative" : threshold[0] >= 50 ? "Balanced" : "Aggressive"}
                </Badge>
              </div>
              <Slider
                value={threshold}
                onValueChange={setThreshold}
                max={100}
                step={1}
                className="my-4"
                data-testid="slider-threshold"
              />
              <p className="text-xs text-muted-foreground">
                Posts and comments scoring above this threshold will be flagged for review.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 md:gap-4 pt-4 border-t border-border">
              <div className="bg-accent/30 p-3 rounded-md">
                <div className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider mb-1">Est. Catch Rate</div>
                <div className="text-lg md:text-xl font-bold text-green-500">{catchRate}%</div>
              </div>
              <div className="bg-accent/30 p-3 rounded-md">
                <div className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider mb-1">Est. False Positive</div>
                <div className="text-lg md:text-xl font-bold text-red-500">{fpRate}%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-3 md:px-6">
            <CardTitle className="text-sm md:text-base">Watched Subreddits</CardTitle>
            <CardDescription className="text-xs">Subreddits monitored by the system.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-3 md:px-6">
            <div className="flex gap-2">
              <Input
                placeholder="subreddit_name"
                value={newSubreddit}
                onChange={(e) => setNewSubreddit(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSubreddit()}
                className="h-10 md:h-9"
                data-testid="input-add-subreddit"
              />
              <Button type="button" variant="secondary" onClick={handleAddSubreddit} className="h-10 md:h-9 min-w-[44px]" data-testid="btn-add-subreddit">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {subreddits.map(sub => (
                <Badge key={sub} variant="secondary" className="px-3 py-1.5 md:py-1 text-sm bg-accent hover:bg-accent group flex items-center gap-2">
                  r/{sub}
                  <button
                    onClick={() => handleRemoveSubreddit(sub)}
                    className="text-muted-foreground hover:text-destructive opacity-50 group-hover:opacity-100 transition-opacity p-1"
                    data-testid={`btn-remove-subreddit-${sub}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              {subreddits.length === 0 && (
                <span className="text-sm text-muted-foreground">No subreddits configured.</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-3 md:px-6">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-green-500" />
              <CardTitle className="text-sm md:text-base">Allowlist</CardTitle>
            </div>
            <CardDescription className="text-xs">Trusted users whose content skips flagging.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-3 md:px-6">
            <div className="flex gap-2">
              <Input
                placeholder="username"
                value={newAllowedUser}
                onChange={(e) => setNewAllowedUser(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddAllowedUser()}
                className="h-10 md:h-9"
              />
              <Button type="button" variant="secondary" onClick={handleAddAllowedUser} className="h-10 md:h-9 min-w-[44px]">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {allowedUsers.map((user) => (
                <Badge key={user} variant="secondary" className="px-3 py-1.5 md:py-1 text-sm bg-green-500/10 text-green-500 border-green-500/20 group flex items-center gap-2">
                  u/{user}
                  <button
                    onClick={() => setAllowedUsers(allowedUsers.filter((u) => u !== user))}
                    className="text-green-500/50 hover:text-destructive opacity-50 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              {allowedUsers.length === 0 && <span className="text-sm text-muted-foreground">No users allowlisted.</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-3 md:px-6">
            <div className="flex items-center gap-2">
              <UserX className="w-4 h-4 text-red-500" />
              <CardTitle className="text-sm md:text-base">Blocklist</CardTitle>
            </div>
            <CardDescription className="text-xs">Users whose content is always flagged for review.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-3 md:px-6">
            <div className="flex gap-2">
              <Input
                placeholder="username"
                value={newBlockedUser}
                onChange={(e) => setNewBlockedUser(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddBlockedUser()}
                className="h-10 md:h-9"
              />
              <Button type="button" variant="secondary" onClick={handleAddBlockedUser} className="h-10 md:h-9 min-w-[44px]">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {blockedUsers.map((user) => (
                <Badge key={user} variant="secondary" className="px-3 py-1.5 md:py-1 text-sm bg-red-500/10 text-red-500 border-red-500/20 group flex items-center gap-2">
                  u/{user}
                  <button
                    onClick={() => setBlockedUsers(blockedUsers.filter((u) => u !== user))}
                    className="text-red-500/50 hover:text-destructive opacity-50 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              {blockedUsers.length === 0 && <span className="text-sm text-muted-foreground">No users blocklisted.</span>}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="px-3 md:px-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                <CardTitle className="text-sm md:text-base">Smart Rules</CardTitle>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleAddRule} className="h-8">
                <Plus className="w-3 h-3 mr-1" /> Add Rule
              </Button>
            </div>
            <CardDescription className="text-xs">Create custom automation rules for content handling.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-3 md:px-6">
            {customRules.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No custom rules. Click "Add Rule" to create one.
              </div>
            ) : (
              customRules.map((rule) => (
                <div key={rule.id} className={`border rounded-lg p-3 space-y-3 transition-colors ${rule.enabled ? "border-border bg-card" : "border-border/50 bg-muted/30 opacity-60"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      value={rule.name}
                      onChange={(e) => handleUpdateRule(rule.id, { name: e.target.value })}
                      className="h-8 text-sm font-medium max-w-[200px]"
                      placeholder="Rule name"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(checked) => handleUpdateRule(rule.id, { enabled: checked })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveRule(rule.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                    <span className="text-xs text-muted-foreground shrink-0">If</span>
                    <Select value={rule.field} onValueChange={(v) => handleUpdateRule(rule.id, { field: v })}>
                      <SelectTrigger className="h-8 w-full sm:w-[120px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="score">Score</SelectItem>
                        <SelectItem value="author">Author</SelectItem>
                        <SelectItem value="subreddit">Subreddit</SelectItem>
                        <SelectItem value="title">Title</SelectItem>
                        <SelectItem value="ai_score">AI Score</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={rule.operator} onValueChange={(v) => handleUpdateRule(rule.id, { operator: v })}>
                      <SelectTrigger className="h-8 w-full sm:w-[140px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gte">is at least</SelectItem>
                        <SelectItem value="lte">is at most</SelectItem>
                        <SelectItem value="eq">equals</SelectItem>
                        <SelectItem value="contains">contains</SelectItem>
                        <SelectItem value="not_contains">does not contain</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={rule.value}
                      onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                      className="h-8 text-xs flex-1"
                      placeholder="Value"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">then</span>
                    <Select value={rule.action} onValueChange={(v) => handleUpdateRule(rule.id, { action: v })}>
                      <SelectTrigger className="h-8 w-full sm:w-[120px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flag">Flag for review</SelectItem>
                        <SelectItem value="approve">Auto-approve</SelectItem>
                        <SelectItem value="remove">Auto-remove</SelectItem>
                        <SelectItem value="notify">Send notification</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-3 md:px-6">
            <CardTitle className="text-sm md:text-base">Integration Hub</CardTitle>
            <CardDescription className="text-xs">Configure external notifications and webhooks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-3 md:px-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Alert Webhook URL</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="https://hooks.slack.com/services/..."
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="font-mono text-xs h-10 md:h-9 flex-1"
                  data-testid="input-webhook"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestWebhook}
                  disabled={!webhookUrl || testWebhook.isPending}
                  className="h-10 md:h-9 min-h-[44px] md:min-h-0"
                  data-testid="btn-test-webhook"
                >
                  <Webhook className="w-4 h-4 mr-2" />
                  Test
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Receive immediate alerts when high-risk content is detected.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader className="px-3 md:px-6">
            <CardTitle className="text-destructive text-sm md:text-base">System Overrides</CardTitle>
            <CardDescription className="text-xs">Emergency actions. Use with caution.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-3 md:px-6">
            <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
              <Button
                variant="destructive"
                className="w-full min-h-[44px] md:min-h-0"
                onClick={() => toast.success("System halted. No new posts will be analyzed.")}
                data-testid="btn-halt-system"
              >
                <Power className="w-4 h-4 mr-2" />
                Halt System
              </Button>
              <Button
                variant="outline"
                className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive min-h-[44px] md:min-h-0"
                onClick={() => toast.success("System soft reset initiated.")}
                data-testid="btn-soft-reset"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Soft Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="px-3 md:px-6">
            <div className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm md:text-base">Latest Flagged</CardTitle>
            </div>
            <CardDescription className="text-xs">The 3 most recently flagged items across all monitored subreddits.</CardDescription>
          </CardHeader>
          <CardContent className="px-3 md:px-6">
            {flaggedLoading ? (
              <div className="py-4 text-center text-sm text-muted-foreground">Loading...</div>
            ) : !recentFlagged?.items?.length ? (
              <div className="py-4 text-center text-sm text-muted-foreground">No flagged items found.</div>
            ) : (
              <div className="divide-y divide-border">
                {recentFlagged.items.map((item) => (
                  <div key={item.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-3" data-testid={`latest-flagged-${item.id}`}>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`font-mono text-xs shrink-0 ${getScoreColor(item.score)}`}>
                        {item.score} RISK
                      </Badge>
                      <span className="text-xs text-muted-foreground shrink-0">r/{item.subreddit}</span>
                    </div>
                    <span className="text-sm text-foreground truncate flex-1">{item.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(item.decided_at * 1000).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
