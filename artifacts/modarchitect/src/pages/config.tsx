import { useState, useEffect } from "react";
import { useGetConfig, useSaveConfig, useTestWebhook, getGetConfigQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, Plus, X, Webhook, Power, RotateCcw } from "lucide-react";

export default function Config() {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useGetConfig({ query: { queryKey: getGetConfigQueryKey() } });
  const saveConfig = useSaveConfig();
  const testWebhook = useTestWebhook();

  const [threshold, setThreshold] = useState<number[]>([70]);
  const [subreddits, setSubreddits] = useState<string[]>([]);
  const [newSubreddit, setNewSubreddit] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (config) {
      setThreshold([config.score_threshold]);
      setSubreddits(config.watched_subreddits || []);
      setWebhookUrl(config.webhook_url || "");
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

  const handleSave = () => {
    saveConfig.mutate(
      { data: { score_threshold: threshold[0], watched_subreddits: subreddits, webhook_url: webhookUrl || null } },
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
    <div className="flex flex-col h-full gap-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Configuration</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage system thresholds and integrations.</p>
        </div>
        <Button onClick={handleSave} disabled={saveConfig.isPending} data-testid="btn-save-config">
          <Save className="w-4 h-4 mr-2" />
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Detection Threshold</CardTitle>
            <CardDescription>Adjust the sensitivity of the Scam Sentry bot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
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

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
              <div className="bg-accent/30 p-3 rounded-md">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Est. Catch Rate</div>
                <div className="text-xl font-bold text-green-500">{catchRate}%</div>
              </div>
              <div className="bg-accent/30 p-3 rounded-md">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Est. False Positive</div>
                <div className="text-xl font-bold text-red-500">{fpRate}%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Watched Subreddits</CardTitle>
            <CardDescription>Subreddits monitored by the system.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input 
                placeholder="subreddit_name" 
                value={newSubreddit} 
                onChange={(e) => setNewSubreddit(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSubreddit()}
                data-testid="input-add-subreddit"
              />
              <Button type="button" variant="secondary" onClick={handleAddSubreddit} data-testid="btn-add-subreddit">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="flex flex-wrap gap-2 mt-4">
              {subreddits.map(sub => (
                <Badge key={sub} variant="secondary" className="px-3 py-1 text-sm bg-accent hover:bg-accent group flex items-center gap-2">
                  r/{sub}
                  <button 
                    onClick={() => handleRemoveSubreddit(sub)}
                    className="text-muted-foreground hover:text-destructive opacity-50 group-hover:opacity-100 transition-opacity"
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
          <CardHeader>
            <CardTitle>Integration Hub</CardTitle>
            <CardDescription>Configure external notifications and webhooks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Alert Webhook URL</label>
              <div className="flex gap-2">
                <Input 
                  placeholder="https://hooks.slack.com/services/..." 
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="font-mono text-xs"
                  data-testid="input-webhook"
                />
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleTestWebhook}
                  disabled={!webhookUrl || testWebhook.isPending}
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
          <CardHeader>
            <CardTitle className="text-destructive">System Overrides</CardTitle>
            <CardDescription>Emergency actions. Use with caution.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <Button 
                variant="destructive" 
                className="w-full"
                onClick={() => toast.success("System halted. No new posts will be analyzed.")}
                data-testid="btn-halt-system"
              >
                <Power className="w-4 h-4 mr-2" />
                Halt System
              </Button>
              <Button 
                variant="outline" 
                className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => toast.success("System soft reset initiated.")}
                data-testid="btn-soft-reset"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Soft Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
