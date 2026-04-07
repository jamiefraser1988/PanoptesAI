import { useState, useCallback, useEffect, useRef } from "react";
import { useListDecisions, useSubmitFeedback, getListDecisionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { CheckCircle, XCircle, ExternalLink, Search, Filter } from "lucide-react";
import { SiReddit } from "react-icons/si";

type ContentType = "all" | "posts" | "comments";

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
}

export default function Queue() {
  const [subreddit, setSubreddit] = useState("");
  const [minScore, setMinScore] = useState<number[]>([0]);
  const [contentType, setContentType] = useState<ContentType>("all");
  const [page, setPage] = useState(1);
  const [accumulatedItems, setAccumulatedItems] = useState<DecisionItem[]>([]);
  const [localFeedback, setLocalFeedback] = useState<Record<string, string>>({});
  const prevPageRef = useRef(1);

  const queryClient = useQueryClient();

  const queryParams = {
    subreddit: subreddit || undefined,
    min_score: minScore[0] || undefined,
    content_type: contentType === "all" ? ("all" as const) : contentType,
    page,
    limit: 20,
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
  }, []);

  const handleLoadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-red-500 bg-red-500/10 border-red-500/20";
    if (score >= 40) return "text-amber-500 bg-amber-500/10 border-amber-500/20";
    return "text-green-500 bg-green-500/10 border-green-500/20";
  };

  const displayedItems = accumulatedItems.length > 0 ? accumulatedItems : (data?.items as DecisionItem[] ?? []);
  const totalPages = data?.total_pages ?? 1;

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Flagged Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Review flagged content and train the model.</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 flex flex-col sm:flex-row gap-4 items-end sm:items-center">
        <div className="flex-1 w-full space-y-2">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-2"><Search className="w-3 h-3" /> Subreddit</label>
          <Input
            placeholder="Search subreddit..."
            value={subreddit}
            onChange={(e) => { setSubreddit(e.target.value); resetFilters(); }}
            className="h-9"
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
        <div className="w-full sm:w-auto space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <div className="flex h-9 rounded-md border border-border overflow-hidden">
            {(["all", "posts", "comments"] as ContentType[]).map((type) => (
              <button
                key={type}
                onClick={() => { setContentType(type); resetFilters(); }}
                className={`px-3 text-xs capitalize transition-colors ${
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
      </div>

      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto pb-8">
        {isLoading && displayedItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Loading queue...</div>
        ) : displayedItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No flagged content found.</div>
        ) : (
          <>
            {displayedItems.map((item) => {
              const effectiveFeedback = localFeedback[item.post_id] ?? item.feedback;
              return (
                <div key={item.id} className="bg-card border border-border rounded-lg p-4 transition-all hover:bg-accent/5" data-testid={`card-decision-${item.id}`}>
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="outline" className={`font-mono text-xs ${getScoreColor(item.score)}`}>
                          {item.score} RISK
                        </Badge>
                        <Badge variant="secondary" className="text-xs capitalize">
                          {item.content_type || "post"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">r/{item.subreddit}</span>
                        <span className="text-xs text-muted-foreground mx-1">•</span>
                        <span className="text-xs text-muted-foreground">u/{item.author}</span>
                        <span className="text-xs text-muted-foreground mx-1">•</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.decided_at * 1000).toLocaleString()}
                        </span>
                      </div>
                      <h3 className="font-medium text-foreground text-sm line-clamp-2 leading-relaxed mb-3">
                        {item.title}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {item.reasons.map((reason, idx) => (
                          <Badge key={idx} variant="outline" className="text-[10px] text-muted-foreground border-border/50 bg-background/50">
                            {reason}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-3 shrink-0">
                      <a
                        href={`https://reddit.com/comments/${item.post_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                        data-testid={`link-reddit-${item.id}`}
                      >
                        <SiReddit className="w-3 h-3" /> View
                        <ExternalLink className="w-3 h-3" />
                      </a>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-green-500/30 text-green-500 hover:bg-green-500/10 hover:text-green-400"
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
                          className="h-8 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-400"
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
                className="mt-4 w-full"
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
    </div>
  );
}
