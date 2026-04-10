import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useListDecisions, useSubmitFeedback, getListDecisionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { CheckCircle, XCircle, ExternalLink, Search, Filter, ArrowDownUp, Bot, Sparkles, User, Keyboard, ChevronDown, ChevronUp } from "lucide-react";
import { SiReddit } from "react-icons/si";

type ContentType = "all" | "posts" | "comments";
type SortBy = "score" | "date";

interface DecisionItem {
  id: number;
  post_id: string;
  subreddit: string;
  author: string;
  title: string;
  score: number;
  reasons: string[];
  flagged: boolean;
  decided_at: number;
  feedback?: string | null;
  content_type?: string;
  ai_score?: number | null;
  ai_summary?: string | null;
  ai_signals?: string[] | null;
  ai_action?: string | null;
}

interface UserProfile {
  author: string;
  total_items: number;
  flagged_items: number;
  avg_score: number;
  subreddits: string[];
  recent_items: DecisionItem[];
  risk_level: "high" | "medium" | "low";
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Queue() {
  const [subreddit, setSubreddit] = useState("");
  const [minScore, setMinScore] = useState<number[]>([0]);
  const [contentType, setContentType] = useState<ContentType>("all");
  const [sortBy, setSortBy] = useState<SortBy>("score");
  const [page, setPage] = useState(1);
  const [accumulatedItems, setAccumulatedItems] = useState<DecisionItem[]>([]);
  const [localFeedback, setLocalFeedback] = useState<Record<string, string>>({});
  const prevPageRef = useRef(1);

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userProfileLoading, setUserProfileLoading] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const queryParams = {
    subreddit: subreddit || undefined,
    min_score: minScore[0] || undefined,
    content_type: contentType === "all" ? ("all" as const) : contentType,
    page,
    limit: 20,
    sort_by: sortBy as "score" | "date",
  };

  const { data, isLoading } = useListDecisions(queryParams, {
    query: { queryKey: getListDecisionsQueryKey(queryParams) },
  });

  useEffect(() => {
    if (!data) return;
    if (page === 1) {
      setAccumulatedItems(data.items as DecisionItem[]);
    } else if (page > prevPageRef.current) {
      setAccumulatedItems((prev) => [...prev, ...(data.items as DecisionItem[])]);
    }
    prevPageRef.current = page;
  }, [data, page]);

  const submitFeedback = useSubmitFeedback();

  const handleFeedback = useCallback(
    (postId: string, verdict: "true_positive" | "false_positive" | "unclear") => {
      setLocalFeedback((prev) => ({ ...prev, [postId]: verdict }));
      submitFeedback.mutate(
        { postId, data: { verdict } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListDecisionsQueryKey(queryParams) });
          },
          onError: () => {
            setLocalFeedback((prev) => {
              const next = { ...prev };
              delete next[postId];
              return next;
            });
          },
        }
      );
    },
    [submitFeedback, queryClient, queryParams]
  );

  const resetFilters = useCallback(() => {
    setPage(1);
    prevPageRef.current = 1;
    setAccumulatedItems([]);
    setSelectedItems(new Set());
    setFocusedIndex(-1);
  }, []);

  const handleLoadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const displayedItems = accumulatedItems.length > 0 ? accumulatedItems : (data?.items as DecisionItem[] ?? []);
  const totalPages = data?.total_pages ?? 1;

  const toggleSelect = useCallback((postId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedItems.size === displayedItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(displayedItems.map((i) => i.post_id)));
    }
  }, [selectedItems.size, displayedItems]);

  const handleBulkAction = useCallback(
    (verdict: "true_positive" | "false_positive") => {
      const items = Array.from(selectedItems);
      if (items.length === 0) return;
      const label = verdict === "true_positive" ? "scam" : "safe";
      items.forEach((postId) => handleFeedback(postId, verdict));
      toast.success(`Marked ${items.length} items as ${label}`);
      setSelectedItems(new Set());
    },
    [selectedItems, handleFeedback]
  );

  const fetchUserProfile = useCallback(async (author: string) => {
    setUserProfileLoading(true);
    setUserPanelOpen(true);
    try {
      const res = await fetch(`${basePath}/api/user-profile/${encodeURIComponent(author)}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUserProfile(data as UserProfile);
      } else {
        const localItems = displayedItems.filter((i) => i.author === author);
        setUserProfile({
          author,
          total_items: localItems.length,
          flagged_items: localItems.filter((i) => i.score >= 50).length,
          avg_score: localItems.length > 0 ? Math.round(localItems.reduce((s, i) => s + i.score, 0) / localItems.length) : 0,
          subreddits: [...new Set(localItems.map((i) => i.subreddit))],
          recent_items: localItems.slice(0, 5),
          risk_level: "medium",
        });
      }
    } catch (err) {
      toast.error("Could not load full user profile — showing local data only");
      const localItems = displayedItems.filter((i) => i.author === author);
      setUserProfile({
        author,
        total_items: localItems.length,
        flagged_items: localItems.filter((i) => i.score >= 50).length,
        avg_score: localItems.length > 0 ? Math.round(localItems.reduce((s, i) => s + i.score, 0) / localItems.length) : 0,
        subreddits: [...new Set(localItems.map((i) => i.subreddit))],
        recent_items: localItems.slice(0, 5),
        risk_level: "medium",
      });
    } finally {
      setUserProfileLoading(false);
    }
  }, [displayedItems]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      switch (e.key) {
        case "j":
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, displayedItems.length - 1));
          break;
        case "k":
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "a":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < displayedItems.length) {
            handleFeedback(displayedItems[focusedIndex].post_id, "false_positive");
            toast.success("Marked as safe");
          }
          break;
        case "s":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < displayedItems.length) {
            handleFeedback(displayedItems[focusedIndex].post_id, "true_positive");
            toast.success("Marked as scam");
          }
          break;
        case "x":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < displayedItems.length) {
            toggleSelect(displayedItems[focusedIndex].post_id);
          }
          break;
        case "Escape":
          e.preventDefault();
          setSelectedItems(new Set());
          setFocusedIndex(-1);
          break;
        case "?":
          e.preventDefault();
          setShowShortcuts((p) => !p);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedIndex, displayedItems, handleFeedback, toggleSelect]);

  useEffect(() => {
    if (focusedIndex >= 0) {
      const el = document.querySelector(`[data-queue-index="${focusedIndex}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [focusedIndex]);

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-red-500 bg-red-500/10 border-red-500/20";
    if (score >= 40) return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    return "text-green-500 bg-green-500/10 border-green-500/20";
  };

  const getAiActionColor = (action: string | null | undefined) => {
    if (action === "remove") return "text-red-500 bg-red-500/10 border-red-500/20";
    if (action === "review") return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    if (action === "approve") return "text-green-500 bg-green-500/10 border-green-500/20";
    return "text-muted-foreground bg-muted/10 border-border/30";
  };

  const getRiskColor = (level: string) => {
    if (level === "high") return "text-red-500";
    if (level === "medium") return "text-amber-500";
    return "text-green-500";
  };

  return (
    <div className="flex flex-col h-full gap-4 md:gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Flagged Queue</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Review flagged content and train the model.</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setShowShortcuts((p) => !p)}
        >
          <Keyboard className="w-4 h-4 mr-1" />
          <span className="hidden sm:inline">Shortcuts</span>
        </Button>
      </div>

      {showShortcuts && (
        <div className="bg-card border border-border rounded-lg p-3 md:p-4 text-xs space-y-2">
          <div className="font-semibold text-foreground mb-2">Keyboard Shortcuts</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div><kbd className="px-1.5 py-0.5 bg-accent rounded text-[10px] font-mono">j</kbd> <span className="text-muted-foreground ml-1">Next item</span></div>
            <div><kbd className="px-1.5 py-0.5 bg-accent rounded text-[10px] font-mono">k</kbd> <span className="text-muted-foreground ml-1">Previous item</span></div>
            <div><kbd className="px-1.5 py-0.5 bg-accent rounded text-[10px] font-mono">a</kbd> <span className="text-muted-foreground ml-1">Mark safe</span></div>
            <div><kbd className="px-1.5 py-0.5 bg-accent rounded text-[10px] font-mono">s</kbd> <span className="text-muted-foreground ml-1">Mark scam</span></div>
            <div><kbd className="px-1.5 py-0.5 bg-accent rounded text-[10px] font-mono">x</kbd> <span className="text-muted-foreground ml-1">Toggle select</span></div>
            <div><kbd className="px-1.5 py-0.5 bg-accent rounded text-[10px] font-mono">Esc</kbd> <span className="text-muted-foreground ml-1">Clear selection</span></div>
            <div><kbd className="px-1.5 py-0.5 bg-accent rounded text-[10px] font-mono">?</kbd> <span className="text-muted-foreground ml-1">Toggle shortcuts</span></div>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-3 md:p-4 flex flex-col gap-3 md:gap-4">
        <div className="flex flex-col sm:flex-row gap-3 md:gap-4 items-stretch sm:items-end">
          <div className="flex-1 w-full space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-2"><Search className="w-3 h-3" /> Subreddit</label>
            <Input
              placeholder="Search subreddit..."
              value={subreddit}
              onChange={(e) => { setSubreddit(e.target.value); resetFilters(); }}
              className="h-10 md:h-9"
              data-testid="input-subreddit"
            />
          </div>
          <div className="w-full sm:w-48 space-y-3">
            <label className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span className="flex items-center gap-2"><Filter className="w-3 h-3" /> Min Score</span>
              <span>{minScore[0]}</span>
            </label>
            <Slider
              value={minScore}
              onValueChange={(v) => { setMinScore(v); resetFilters(); }}
              max={100}
              step={5}
              className="my-2"
              data-testid="slider-min-score"
            />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 md:gap-4 items-stretch sm:items-end">
          <div className="w-full sm:w-auto space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <div className="flex h-10 md:h-9 rounded-md border border-border overflow-hidden">
              {(["all", "posts", "comments"] as ContentType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => { setContentType(type); resetFilters(); }}
                  className={`flex-1 sm:flex-none px-3 text-xs capitalize transition-colors min-h-[44px] md:min-h-0 ${
                    contentType === type
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent/10"
                  }`}
                  data-testid={`toggle-type-${type}`}
                >
                  {type === "all" ? "All" : type === "posts" ? "Posts" : "Comments"}
                </button>
              ))}
            </div>
          </div>
          <div className="w-full sm:w-auto space-y-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-2"><ArrowDownUp className="w-3 h-3" /> Sort</label>
            <div className="flex h-10 md:h-9 rounded-md border border-border overflow-hidden">
              {(["score", "date"] as SortBy[]).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSortBy(s); resetFilters(); }}
                  className={`flex-1 sm:flex-none px-3 text-xs capitalize transition-colors min-h-[44px] md:min-h-0 ${
                    sortBy === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground hover:bg-accent/10"
                  }`}
                  data-testid={`toggle-sort-${s}`}
                >
                  {s === "score" ? "Highest Risk" : "Most Recent"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedItems.size > 0 && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sticky top-0 z-10">
          <span className="text-sm font-medium text-foreground">
            {selectedItems.size} item{selectedItems.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 sm:flex-none h-9 border-green-500/30 text-green-500 hover:bg-green-500/10"
              onClick={() => handleBulkAction("false_positive")}
            >
              <XCircle className="w-4 h-4 mr-1.5" />
              Bulk Safe
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 sm:flex-none h-9 border-red-500/30 text-red-500 hover:bg-red-500/10"
              onClick={() => handleBulkAction("true_positive")}
            >
              <CheckCircle className="w-4 h-4 mr-1.5" />
              Bulk Scam
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 text-muted-foreground"
              onClick={() => setSelectedItems(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <div ref={listRef} className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto pb-8">
        {isLoading && displayedItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Loading queue...</div>
        ) : displayedItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No flagged content found.</div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-1 mb-1">
              <Checkbox
                checked={selectedItems.size === displayedItems.length && displayedItems.length > 0}
                onCheckedChange={selectAll}
                aria-label="Select all"
              />
              <span className="text-xs text-muted-foreground">
                {selectedItems.size === displayedItems.length ? "Deselect all" : "Select all"} ({displayedItems.length})
              </span>
            </div>

            {displayedItems.map((item, index) => {
              const effectiveFeedback = localFeedback[item.post_id] ?? item.feedback;
              const hasAI = item.ai_score != null || item.ai_summary != null;
              const ruleReasons = item.reasons.filter((r) => !r.startsWith("AI:"));
              const aiReasonSignals = (item.ai_signals && item.ai_signals.length > 0) ? item.ai_signals : [];
              const isFocused = focusedIndex === index;
              const isSelected = selectedItems.has(item.post_id);

              return (
                <div
                  key={item.id}
                  data-queue-index={index}
                  className={`bg-card border rounded-lg p-3 md:p-4 transition-all hover:bg-accent/5 ${
                    isFocused ? "ring-2 ring-primary border-primary" : "border-border"
                  } ${isSelected ? "bg-primary/5" : ""}`}
                  data-testid={`card-decision-${item.id}`}
                  onClick={() => setFocusedIndex(index)}
                >
                  <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3 md:gap-4">
                    <div className="flex gap-3 flex-1 min-w-0">
                      <div className="pt-1 shrink-0">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(item.post_id)}
                          aria-label={`Select ${item.title}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge variant="outline" className={`font-mono text-xs ${getScoreColor(item.score)}`}>
                            {item.score} RISK
                          </Badge>
                          {hasAI && item.ai_score != null && (
                            <Badge variant="outline" className={`font-mono text-xs flex items-center gap-1 ${getScoreColor(item.ai_score)}`}>
                              <Bot className="w-3 h-3" />
                              {item.ai_score} AI
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-xs capitalize">
                            {item.content_type || "post"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground mb-2">
                          <span>r/{item.subreddit}</span>
                          <span>·</span>
                          <button
                            className="text-primary hover:text-primary/80 hover:underline flex items-center gap-1 transition-colors"
                            onClick={(e) => { e.stopPropagation(); fetchUserProfile(item.author); }}
                          >
                            <User className="w-3 h-3" />
                            u/{item.author}
                          </button>
                          <span>·</span>
                          <span>{new Date(item.decided_at * 1000).toLocaleString()}</span>
                        </div>
                        <h3 className="font-medium text-foreground text-sm line-clamp-2 leading-relaxed mb-3">
                          {item.title}
                        </h3>

                        {ruleReasons.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {ruleReasons.map((reason, idx) => (
                              <Badge key={idx} variant="outline" className="text-[10px] text-muted-foreground border-border/50 bg-background/50">
                                {reason}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {hasAI && (
                          <div className="mt-3 rounded-md border border-purple-500/20 bg-purple-500/5 p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                              <span className="text-xs font-semibold text-purple-400">AI Analysis</span>
                              {item.ai_action && (
                                <Badge variant="outline" className={`ml-auto text-[10px] ${getAiActionColor(item.ai_action)}`}>
                                  {item.ai_action}
                                </Badge>
                              )}
                            </div>
                            {item.ai_summary && (
                              <p className="text-xs text-muted-foreground leading-relaxed">{item.ai_summary}</p>
                            )}
                            {aiReasonSignals.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {aiReasonSignals.map((signal, idx) => (
                                  <Badge
                                    key={idx}
                                    variant="outline"
                                    className="text-[10px] text-purple-300 border-purple-500/30 bg-purple-500/10"
                                  >
                                    {signal}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-row md:flex-col items-center md:items-end gap-3 shrink-0 pt-1 border-t md:border-t-0 border-border md:pt-0">
                      <a
                        href={`https://reddit.com/comments/${item.post_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors min-h-[44px] md:min-h-0"
                        data-testid={`link-reddit-${item.id}`}
                      >
                        <SiReddit className="w-3 h-3" /> View
                        <ExternalLink className="w-3 h-3" />
                      </a>

                      <div className="flex gap-2 ml-auto md:ml-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-10 md:h-8 px-3 border-green-500/30 text-green-500 hover:bg-green-500/10 hover:text-green-400"
                          onClick={() => handleFeedback(item.post_id, "false_positive")}
                          disabled={effectiveFeedback === "false_positive" || submitFeedback.isPending}
                          data-testid={`btn-false-positive-${item.id}`}
                        >
                          <XCircle className="w-4 h-4 mr-1.5" />
                          Safe
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-10 md:h-8 px-3 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-400"
                          onClick={() => handleFeedback(item.post_id, "true_positive")}
                          disabled={effectiveFeedback === "true_positive" || submitFeedback.isPending}
                          data-testid={`btn-true-positive-${item.id}`}
                        >
                          <CheckCircle className="w-4 h-4 mr-1.5" />
                          Scam
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {page < totalPages && (
              <Button
                variant="outline"
                className="mt-4 w-full min-h-[44px]"
                onClick={handleLoadMore}
                disabled={isLoading}
                data-testid="btn-load-more"
              >
                {isLoading ? "Loading..." : "Load More"}
              </Button>
            )}
          </>
        )}
      </div>

      <Sheet open={userPanelOpen} onOpenChange={setUserPanelOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              User Profile
            </SheetTitle>
            <SheetDescription>Reputation and activity summary</SheetDescription>
          </SheetHeader>

          {userProfileLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading profile...</div>
          ) : userProfile ? (
            <div className="space-y-6 mt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-lg font-bold text-primary">
                  {userProfile.author[0]?.toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-foreground text-lg">u/{userProfile.author}</div>
                  <Badge variant="outline" className={`text-xs ${getRiskColor(userProfile.risk_level)}`}>
                    {userProfile.risk_level.toUpperCase()} RISK
                  </Badge>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-foreground">{userProfile.total_items}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-500">{userProfile.flagged_items}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Flagged</div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${getScoreColor(userProfile.avg_score).split(" ")[0]}`}>{userProfile.avg_score}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Score</div>
                </div>
              </div>

              <Separator />

              {userProfile.subreddits.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">Active Subreddits</div>
                  <div className="flex flex-wrap gap-2">
                    {userProfile.subreddits.map((sub) => (
                      <Badge key={sub} variant="secondary" className="text-xs">r/{sub}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {userProfile.recent_items.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">Recent Activity</div>
                  <div className="space-y-2">
                    {userProfile.recent_items.map((item, idx) => (
                      <div key={idx} className="border border-border rounded-md p-2 text-xs">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className={`font-mono text-[10px] ${getScoreColor(item.score)}`}>
                            {item.score}
                          </Badge>
                          <span className="text-muted-foreground">r/{item.subreddit}</span>
                        </div>
                        <div className="text-foreground line-clamp-1">{item.title}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2">
                <a
                  href={`https://reddit.com/u/${userProfile.author}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <SiReddit className="w-3 h-3" />
                  View on Reddit
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
