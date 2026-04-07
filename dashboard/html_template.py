"""Inline HTML template for the flagged queue page.

CSS braces are kept in a separate string so they never clash with
Python's str.format() placeholders.  Only the body variables section
uses .format() substitution.
"""

_HTML_HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reddit Scam Sentry &mdash; Mod Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      margin: 0;
      padding: 24px;
    }
    h1 { font-size: 1.4rem; color: #f0f6fc; margin: 0 0 4px 0; }
    .subtitle { color: #8b949e; font-size: 0.875rem; margin-bottom: 24px; }
    .stats-bar {
      display: flex; gap: 16px; margin-bottom: 28px; flex-wrap: wrap;
    }
    .stat-card {
      background: #161b22; border: 1px solid #30363d;
      border-radius: 8px; padding: 16px 24px; min-width: 140px;
    }
    .stat-card .value { font-size: 2rem; font-weight: 700; color: #f0f6fc; }
    .stat-card .label { font-size: 0.8rem; color: #8b949e; margin-top: 2px; }
    .filters {
      display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; align-items: center;
    }
    .filters input, .filters select {
      background: #161b22; border: 1px solid #30363d; border-radius: 6px;
      color: #c9d1d9; padding: 6px 10px; font-size: 0.875rem;
    }
    .filters button {
      background: #238636; border: none; border-radius: 6px;
      color: #fff; padding: 6px 14px; font-size: 0.875rem; cursor: pointer;
    }
    .filters button:hover { background: #2ea043; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th {
      text-align: left; padding: 10px 12px; border-bottom: 1px solid #30363d;
      color: #8b949e; font-weight: 500; white-space: nowrap;
    }
    td { padding: 10px 12px; border-bottom: 1px solid #21262d; vertical-align: top; }
    tr:hover td { background: #161b22; }
    .score-badge {
      display: inline-block; padding: 2px 8px; border-radius: 12px;
      font-weight: 600; font-size: 0.8rem; color: #fff;
    }
    .score-high { background: #da3633; }
    .score-mid  { background: #d29922; color: #0d1117; }
    .score-low  { background: #238636; }
    .reasons { color: #8b949e; font-size: 0.8rem; margin-top: 4px; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .feedback-form { display: flex; gap: 6px; margin-top: 6px; }
    .verdict-btn {
      border: 1px solid #30363d; background: #21262d; border-radius: 5px;
      color: #c9d1d9; padding: 3px 10px; font-size: 0.78rem; cursor: pointer;
    }
    .verdict-btn:hover { background: #30363d; }
    .verdict-btn.active-tp { background: #238636; border-color: #238636; color: #fff; }
    .verdict-btn.active-fp { background: #da3633; border-color: #da3633; color: #fff; }
    .verdict-btn.active-un { background: #6e7681; border-color: #6e7681; color: #fff; }
    .empty { text-align: center; padding: 48px; color: #8b949e; }
    .pagination { display: flex; gap: 10px; margin-top: 16px; align-items: center; }
    .pagination a, .pagination span {
      padding: 5px 12px; border: 1px solid #30363d; border-radius: 6px;
      font-size: 0.875rem;
    }
    .pagination a { color: #58a6ff; }
    .pagination span { color: #8b949e; }
    .api-links { margin-top: 32px; color: #8b949e; font-size: 0.8rem; }
    .api-links a { color: #58a6ff; margin-right: 12px; }
  </style>
</head>
<body>
<h1>&#x1F6E1;&#xFE0F; Reddit Scam Sentry</h1>
<p class="subtitle">Moderator Dashboard &mdash; flagged post queue &amp; feedback</p>
"""

_HTML_FOOT = """
<div class="api-links">
  JSON API:
  <a href="/decisions">/decisions</a>
  <a href="/stats">/stats</a>
  <a href="/docs">/docs (Swagger)</a>
</div>
<script>
async function submitFeedback(postId, verdict) {
  const resp = await fetch('/decisions/' + postId + '/feedback', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({verdict: verdict})
  });
  if (resp.ok) {
    const btns = document.querySelectorAll('[data-post="' + postId + '"]');
    btns.forEach(function(b) {
      b.classList.remove('active-tp', 'active-fp', 'active-un');
      if (b.dataset.verdict === verdict) {
        var cls = verdict === 'true_positive' ? 'active-tp'
                : verdict === 'false_positive' ? 'active-fp' : 'active-un';
        b.classList.add(cls);
      }
    });
  }
}
</script>
</body>
</html>
"""


def build_page(
    *,
    total_posts: int,
    flagged_posts: int,
    flag_rate_pct: float,
    subreddit_options: str,
    sel50: str,
    sel70: str,
    sel90: str,
    table_html: str,
    page: int,
    total_pages: int,
    prev_link: str,
    next_link: str,
) -> str:
    stats_bar = (
        '<div class="stats-bar">'
        '<div class="stat-card"><div class="value">' + str(total_posts) + '</div>'
        '<div class="label">Posts scanned</div></div>'
        '<div class="stat-card"><div class="value">' + str(flagged_posts) + '</div>'
        '<div class="label">Flagged</div></div>'
        '<div class="stat-card"><div class="value">' + str(flag_rate_pct) + '%</div>'
        '<div class="label">Flag rate</div></div>'
        '</div>'
    )

    filters_section = (
        '<div class="filters">'
        '<form method="get" action="/" style="display:contents">'
        '<select name="subreddit">'
        '<option value="">All subreddits</option>'
        + subreddit_options +
        '</select>'
        '<select name="min_score">'
        '<option value="">Any score</option>'
        '<option value="50" ' + sel50 + '>50+</option>'
        '<option value="70" ' + sel70 + '>70+</option>'
        '<option value="90" ' + sel90 + '>90+</option>'
        '</select>'
        '<button type="submit">Filter</button>'
        '<a href="/" style="color:#8b949e;font-size:0.85rem;align-self:center;">Reset</a>'
        '</form>'
        '</div>'
    )

    pagination = (
        '<div class="pagination">'
        + prev_link
        + '<span>Page ' + str(page) + ' of ' + str(total_pages) + '</span>'
        + next_link +
        '</div>'
    )

    return (
        _HTML_HEAD
        + stats_bar
        + filters_section
        + table_html
        + pagination
        + _HTML_FOOT
    )


def build_row(
    *,
    post_id: str,
    title: str,
    subreddit: str,
    author: str,
    score: int,
    score_class: str,
    decided_at: str,
    reasons: str,
    cls_tp: str,
    cls_fp: str,
    cls_un: str,
) -> str:
    return (
        "<tr>"
        "<td>"
        '<a href="https://www.reddit.com/comments/' + post_id + '" target="_blank" rel="noopener">'
        + title +
        "</a>"
        '<div class="reasons">' + reasons + "</div>"
        "</td>"
        "<td>r/" + subreddit + "</td>"
        "<td>u/" + author + "</td>"
        '<td><span class="score-badge ' + score_class + '">' + str(score) + "</span></td>"
        "<td>" + decided_at + "</td>"
        "<td>"
        '<div class="feedback-form">'
        '<button class="verdict-btn ' + cls_tp + '" data-post="' + post_id + '" data-verdict="true_positive"'
        ' onclick="submitFeedback(\'' + post_id + '\',\'true_positive\')">&#x2713; Real</button>'
        '<button class="verdict-btn ' + cls_fp + '" data-post="' + post_id + '" data-verdict="false_positive"'
        ' onclick="submitFeedback(\'' + post_id + '\',\'false_positive\')">&#x2717; False</button>'
        '<button class="verdict-btn ' + cls_un + '" data-post="' + post_id + '" data-verdict="unclear"'
        ' onclick="submitFeedback(\'' + post_id + '\',\'unclear\')">? Unclear</button>'
        "</div>"
        "</td>"
        "</tr>"
    )


EMPTY_TABLE = '<p class="empty">No flagged posts yet. The bot will populate this queue as it runs.</p>'
