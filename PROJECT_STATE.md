# PROJECT_STATE.md

_Last updated: 2026-05-15_

## Thesis

PanoptesAI is a Reddit scam/bot moderation tool. **Bifurcated as of
2026-05-15** after conclusively proving Reddit will not approve any
custom fetch domain for the Devvit app (tested every permutation incl.
verified account + Firebase domain):

- **v1 (hackathon, ships now):** Devvit app `amunai` calls the Gemini
  API (`generativelanguage.googleapis.com`, globally allowlisted — no
  approval gate) directly for scam scoring + autonomous moderation
  action. Self-contained. No dashboard data.
- **v2 (post office-hours):** the full SaaS — Cloud Run + Cloud SQL +
  React dashboard (queue/analytics/config) — lights up only if/when a
  Reddit admin approves a custom fetch domain via the human review
  channel. The stack is built and working; it's just unreachable from
  Devvit until then.

## What's done

- Dashboard + API + Devvit feature work (queue, analytics, mod-log, config,
  rules, bulk actions, allow/blocklists, multi-tenant) — see WORKLOG.md
- Migrated API from Cloud Run us-east5 → us-central1 (us-east5 didn't
  support custom-domain mappings)
- `api.panoptesai.net` mapped to Cloud Run with managed TLS
- Migrated database from Replit-provisioned Neon (which got disabled when
  detached from Replit) to Cloud SQL Postgres `panoptes-db` in us-central1
- Schema pushed via `pnpm push` (lib/db) to fresh Cloud SQL DB
- Clerk auth fixed end-to-end: bot protection toggled off, hosted-page
  redirect path replaced with embedded `<SignIn>`/`<SignUp>` components,
  Google OAuth client secret refreshed and re-enabled
- DNS records for Clerk (`clerk.www`, `accounts.www`, `clkmail.www`,
  `clk._domainkey.www`, `clk2._domainkey.www`) and Firebase (`www`)
  restored at Replit's DNS panel after they got accidentally wiped
- Devvit app (`panoptesaimod`) updated to call `api.panoptesai.net`,
  v0.0.7 uploaded **and published** to Reddit
- Global agent house rules added to `~/.claude/CLAUDE.md`,
  `~/.codex/AGENTS.md`, `~/.copilot/agents/durable-memory.agent.md`
- **v1 Gemini bot PROVEN working end-to-end (2026-05-15).** App `amunai`
  (modern Devvit Web scaffold at `C:/Users/jamie/amunai`, verified
  account `LopsidedDare5491`). r/amunai_dev live test: scam-bait comment
  → CommentSubmit trigger → Gemini 2.5 Flash → 100/100 with accurate
  reasons, logged in monitor mode. Benign control scored sub-threshold
  (no log). Zero Devvit domain approval needed
  (`generativelanguage.googleapis.com` globally allowlisted).
- **v1 report-with-score + active removal PROVEN (2026-05-16).**
  r/amunai_dev: two scam comments scored 100 & 95 → reported into the
  native modqueue with score+reasons → removed in active mode. Full
  pipeline (detect → surface reasoning in Reddit's own tools → enforce)
  works with no dashboard and no API. Mod log + modqueue ARE the
  zero-infra activity feed.
- **v1 removal-reason note + core value PROVEN (2026-05-16).**
  `addRemovalNote` attaches `Amunai <score>/100: <reasons>` to removed
  items — visibly confirmed in the Removed modqueue/hover (durable,
  survives removal). Thesis validated: a SUBTLE soft-sell scam (no
  keywords/links, "DM me about a mentor's private group") that Reddit's
  native filters miss was caught 90/100 with visible reasoning. Reddit's
  filter only beat Amunai on blatant spam / rapid duplicates (its
  dup-spam heuristic, not semantic detection). Scaffold "Mop comments"
  manual bulk-cleanup tool retained as a complementary mod feature.
- **v1 cost control SHIPPED (2026-05-16).** `shouldScore` prefilter
  (skip short/indicator-free content, ~70-90% fewer Gemini calls) +
  `contentHash` Redis cache (7d, dedupes copy-paste spam). Drops naive
  ~$600/mo busy-sub estimate to ~$60-180/mo. Type-checked + uploaded;
  live prefilter/cache-hit log verification still optional/unrun.
- **amunai repo backed up to private GitHub** `jamiefraser1988/amunai`
  (was local-only — that risk is now closed).

## What's next

1. **Final v1 → hackathon submission** (deadline 2026-05-27).
   (a)(b) DONE — detect/report/remove + cost control shipped & proven.
   (c) REMAINING: optional live prefilter/cache log check; polish
   README; submit to https://mod-tools-migration.devpost.com.
2. **v2 — dashboard live data. ONLY two viable paths (both
   post-hackathon):**
   (a) **Office-hours domain approval** — get a Reddit admin to approve
   a custom fetch domain; then Devvit → Firebase fn → Cloud Run → Cloud
   SQL → dashboard (chain already built/deployed/secret-locked/tested).
   (b) **Rebuild dashboard inside Devvit** as a Devvit Web view reading
   Devvit's own Redis (decisions already stored there as
   `amunai:<thingId>`). No Reddit approval ever needed. Standalone SaaS
   site at panoptesai.net only works via path (a).
   NOTE: Gemini function-calling CANNOT relay data to the backend —
   verified via docs + sequence diagram + SDK sample; execution is
   always client-side (Devvit, which is blocked). Do not reopen.
4. **Apex A record swap** (independent, 60s, dashboard hygiene): at
   Replit DNS panel delete `@ A 34.111.179.208`, add
   `@ A 199.36.158.100`. Firebase has the apex claimed (HOST_MISMATCH).
   Makes `panoptesai.net` (no-www) serve the dashboard.
5. **Stripe / Clerk Billing** — only meaningful once v2 unblocks; the
   dashboard is the monetization surface. Deferred.

## Decision Log

| Date | Decision | Why |
|---|---|---|
| 2026-05-15 | Bifurcate: Gemini-direct v1 (ship now) + dashboard v2 (office-hours-gated) | PROBE CONCLUSIVE. On verified account `LopsidedDare5491`, fresh clean app `amunai`, full metadata: `us-central1-panoptesaimod.cloudfunctions.net` auto-rejected again (Pending→Rejected in <5min). `generativelanguage.googleapis.com` (globally allowlisted) never even generated an exceptions row = no per-app gate = usable now. Every controllable variable disproven (domain format, account verification, app reputation, metadata). Custom fetch domains require human admin approval, full stop. So: v1 calls Gemini directly (no gate), v2 dashboard waits on office-hours domain approval. |
| 2026-05-02 | Enter the Reddit Mod Tools Migration Hackathon (Apr 29–May 27 2026) as the channel to unblock domain rejections | Firebase Functions domain ALSO rejected. Conclusion (later confirmed 2026-05-15): custom fetch domains are human-gated, not config-gated. Hackathon office hours = the warm human channel + $45k prize. |
| 2026-05-02 | Pivot Devvit-facing scoring endpoint to Firebase Cloud Functions (Option E) | Reddit rejected both `api.panoptesai.net` (custom domain) and `panoptes-api-…run.app` (Cloud Run subdomain) for the Devvit http-fetch allowlist. Reddit's http-fetch-policy explicitly approves Firebase domains. Strategy: only the `/devvit/scan` endpoint moves to a Firebase Function (which proxies into the Cloud Run API). Dashboard / queue / analytics / config stay on Cloud Run unchanged. NOTE: this domain was subsequently also rejected — see hackathon row above. |
| 2026-05-02 | Smoke test pass (primary user) | Cloud Run logs clean across full click-through: tenant auto-create, Config GET/POST persisted, queue/analytics/mod-log/stats/healthz all 2xx, ETag caching observed. Multi-tenant + cross-browser still untested. |
| 2026-05-01 | Use Cloud SQL Postgres (us-central1) over fresh Neon | Single-vendor (GCP), terminal-driven via gcloud, no Replit-style middleman risk. Trade-off: ~$10–15/mo vs Neon free. |
| 2026-05-01 | Cloud Run service in us-central1, not us-east5 | us-east5 doesn't support direct domain mappings or Firebase Hosting `run` rewrites. |
| 2026-05-01 | Embedded Clerk `<SignIn>`/`<SignUp>` instead of hosted accounts portal | Hosted portal at accounts.www.panoptesai.net showed "Unable to complete action at this time" banner — instance-wide failure on Clerk's edge after DNS records were briefly missing. Embedded components hit clerk.www directly which works. |
| 2026-05-01 | Disable Clerk Bot sign-up Protection | Cloudflare Turnstile widget wasn't completing on accounts.www subdomain, blocked all sign-ups. Re-enable with custom Turnstile keys before any meaningful traffic. |
| 2026-05-01 | New Cloud SQL DB starts empty | The Replit-provisioned Neon DB was disabled outside our control. ~4 historical signups lost; small enough to email and re-onboard. |

## Known traps and lessons

- **v1 scoring prompt is UNSAFE on victim/discussion subs (MEASURED
  2026-05-16).** Offline replay harness (`amunai/scripts/replay.ts`),
  r/scams, 80 real items: 4/4 flagged were victims/help-seekers, 0
  scammers; 2 got `action=remove` (incl. a post literally titled "Am I
  being scammed by this job offer?" → 90/remove). Root cause: prompt
  scores "is a scam *described* here" not "is the *author* scamming".
  Confidently wrong (flags at 75/90/95/100, nothing 40-69) so threshold
  tuning cannot fix it; needs a forced `authorRole` intent
  classification that caps non-perpetrator content low. Earlier "v1
  PROVEN" was an overclaim — proven only for blatant scammers on a quiet
  test sub; demonstrably unsafe in active mode on any scam/fraud/support
  community. Baseline to beat: flagged 4/80, FP 4/4, auto-remove 2.
  **RESOLVED 2026-05-16 (same day):** added forced `authorRole`
  classification (perpetrator | victim_or_reporting | warning |
  discussion | normal) as a required structured-output field + a code
  backstop in `scoreContent` capping any non-perpetrator to ≤10 / allow
  (the catastrophic outcome is now unrepresentable, not just
  discouraged). Re-measured same sub: r/scams 0/80 flagged (was 4/4 FP,
  2 remove). Discrimination fixtures (`amunai/scripts/tp-check.ts`) 6/6:
  3/3 perpetrators incl. the subtle soft-sell still caught 90-95/remove;
  3/3 victim/warning/normal capped/allow. FP eliminated without killing
  detection. Residual unknown: wild-perpetrator recall AT SCALE — no
  readable perpetrator-dense sub to sample, so comprehensive recall
  stays unverified (representative-fixture recall only).

- **Devvit custom fetch-domain requests are HUMAN-gated and auto-reject
  in ~4 min. No config change fixes this — escalate to a human instead.**
  Conclusively tested 2026-05-02..05-15. Disproven, in order: domain
  format (custom / `*.run.app` / `*.cloudfunctions.net`), account
  verification (unverified→verified `LopsidedDare5491`), app reputation
  (old `panoptesaimod`→fresh `amunai`), metadata (blank→full
  Terms/Privacy/desc). 7+ rejections across every permutation. The
  policy doc's "approved list" (Firebase/Supabase) means *eligible for
  human review*, NOT auto-approved. **Globally-allowlisted domains
  (e.g. `generativelanguage.googleapis.com`, `api.openai.com`) bypass
  the gate entirely — they never generate an exceptions row.** Lesson:
  when an input you can change keeps failing identically, the gate is
  on a variable you can't change — stop iterating, find the human.

- **Replit's DNS panel REPLACES records on certain "save" flows** instead of
  appending. We lost 6 records (www, clerk.www, accounts.www, clkmail.www,
  both DKIMs) when adding new ones. Always screenshot the DNS list before
  saving anything in that panel.
- **Cloud Run domain-mapping requires Search Console Domain property
  verification** (TXT-based), not URL-prefix (HTML-based). HTML
  verification works for Search Console but won't satisfy `gcloud run
  domain-mappings create`. Best path on Replit-locked DNS is the
  registrar-OAuth verification (the "domain provider" flow Search Console
  offers); name.com OAuth was unreliable, CNAME injection via Replit
  worked.
- **Cloud SQL connection from Cloud Run requires `roles/cloudsql.client` on
  the runtime service account.** Without it, queries fail with
  `ECONNREFUSED /cloudsql/PROJECT:REGION:INSTANCE/.s.PGSQL.5432` even with
  `--add-cloudsql-instances` set.
- **`drizzle-kit push` against Cloud SQL needs
  `NODE_TLS_REJECT_UNAUTHORIZED=0`** (or proper CA cert configured) — Cloud
  SQL uses self-signed certs that pg's strict TLS rejects.
- **pnpm Windows shim sometimes fails with "system cannot find the path
  specified"** — invoke vite/drizzle directly via
  `node ./node_modules/<bin>/...` as a workaround.
- **Chrome's per-process DNS cache holds NXDOMAIN for ~hours** even after
  `chrome://net-internals/#dns` clear and incognito. Real fix is to kill all
  Chrome processes (incl. system-tray ones) — or test in Edge.
- **Clerk's `clerk_js_version` env config and the `@clerk/react` SDK
  major can mismatch** without breaking; `display_config.clerk_js_version=5`
  while the dashboard ships v6 from npm is fine.

## Architecture

- Dashboard: React + Vite + wouter + TanStack Query + Clerk React, in
  `artifacts/modarchitect/`. Built to `dist/public/`. Deployed to **Firebase
  Hosting** site `panoptesaimod`. Live at `https://www.panoptesai.net`.
- API: Express + Drizzle ORM + Clerk Express middleware, in
  `artifacts/api-server/`. Runs on **Cloud Run** service `panoptes-api` in
  `us-central1`. Live at `https://api.panoptesai.net`. Connects to Cloud SQL
  via Unix socket `/cloudsql/panoptesaimod:us-central1:panoptes-db` from
  `--add-cloudsql-instances` flag.
- Database: **Cloud SQL Postgres 15** instance `panoptes-db` in
  us-central1, db-f1-micro tier, 10GB SSD, public IP allowlist empty (Cloud
  Run uses socket only). Schema in `lib/db/src/schema/`.
- Auth: **Clerk Production** instance `ins_3CK2oesMpc7Unol12LMR9BgN5dz`,
  primary domain `www.panoptesai.net`. CNAMEs at `clerk.www`, `accounts.www`,
  `clkmail.www`, `clk._domainkey.www`, `clk2._domainkey.www`. Embedded
  components used; hosted accounts portal not used in production currently.
- Devvit app: `panoptesaimod` v0.0.7 (uploaded), code in `devvit-app/`.
- Domain `panoptesai.net`: registered through Replit (name.com partner),
  DNS managed via Replit's domain panel. Cloudflare zone exists but
  pending nameserver switch.

## Out of scope (deliberately)

- Devvit-side payments — Reddit account is "Not eligible". Use Stripe via
  Clerk Billing or direct integration on the dashboard side.
- Migrating off Replit's DNS panel tonight — too risky immediately
  post-recovery; do the Cloudflare nameserver switch when fresh.
- Reclaiming the old Neon DB data — probably owned by Replit org, support
  ticket would take days, and lost data is small.
