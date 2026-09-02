# TARRITRIX — SESSION HANDOFF (for next chat)

## Who you are in this chat
Lead architect and build partner for Tarritrix. Brutal honesty, no sycophancy, no
appeasement prompts. Never claim something is done without independent verification —
this session's dominant lesson was that self-reported "done" repeatedly did not match
reality until forced through a real, evidence-based audit.

## What Tarritrix is
Programmatic local-SEO SaaS for storm-driven trades (roofing/PDR). Repo:
`C:\Users\manag\Documents\Tarritrix`. Live at tarritrix.com, Vercel project
`reids-projects-b3405b97/tarritrix`. Supabase project `jhiplicikizdpdsguimg`.

---

## THE CANONICAL UI — what it is and how it got built

Two HTML files, built by Claude Code in a separate session, landed byte-for-byte into
`docs/design/`:
- `tarritrix-command-center.html` — operator dashboard, 12 nav groups, 70 items
- `tarritrix-social-command.html` — social ops dashboard, 9 PRIMARY_NAV + 21 SECONDARY_NAV

These are the **sole UI/IA authority**. `DASHBOARD_DESIGN_SPEC.md` and
`TARRITRIX_DASHBOARD_SYSTEM_SPEC.md` are explicitly superseded — do not reference them.

**`docs/design/REPLICATION_PROTOCOL.md` is mandatory reading before any UI work.** It
codifies the hard-won rule: extract literal canonical markup first, never summarize;
inventory every panel/tab/column before building; never omit structure because data is
incomplete (show honest REAL/PARTIAL/NONE labeling inside the existing layout instead);
verify with a checklist shown pass/fail, not a prose summary.

## Current real state (as of this session, verified via a genuine 91-item Playwright audit)

- **66 items PASS** — real content, real data, functioning as designed
- **19 items THIN** — real data, but the canonical file never designed a bespoke screen
  for that key, so it uses shared Table/Badge/panel components. **This is expected, not
  a bug**, per an explicit operator decision this session.
- **6 items were BROKEN, now fixed** — all one shared root cause: `TechnicalOperationsSection.tsx`
  (crawling/indexation/schema/site-audits/canonicals/page-experience) never wired
  `useClientContext()`, so its two real action buttons always sent an empty request body.
  Fixed, verified live on 2 of 6 pages (crawling, schema) — **verify the other 4** if not
  already confirmed.
- **83 of 91 items have zero enabled write actions beyond disabled-by-design buttons.**
  This is Contract 9's write-restriction policy applied intentionally, confirmed via direct
  source read — not a hidden bug. It does mean the platform today is substantially an
  **honest, accurate, read-only observability layer**, not yet an operational
  workflow center where clicking things triggers real actions.

## Known open items (do not re-discover these — pick up from here)

1. **A-07 sitemap bug**: `A07SitemapGenerator` queries a `clients.slug` column that does
   not exist in the live schema. Confirmed, not yet fixed. Read A-07's actual code to
   determine what it needs — likely `custom_domain` or a computed value, not a new column
   added blindly.
2. **`escalateSignal()` returns 405** — targets an "escalate" concept with no backing
   database column. Needs a **product decision** (what does escalation mean, what changes),
   not a code fix.
3. **Global search** (`GlobalSearch.tsx`, top bar) only indexes `clients` and `pages` —
   the canonical file describes 6 categories (clients, pages, campaigns, cities, keywords,
   tasks) but campaigns/keywords have no real backend anywhere in this codebase. Do not
   fabricate results for those — either build real backend first, or leave as-is.
4. **Contract 9 activation decision** — the big one. Most write actions across the
   platform are correctly disabled by design. The next real "build the operational
   workflow center" work is deciding, deliberately, which of these should become live:
   Launch Center's page-build/map-stacking/indexing triggers are the obvious first
   candidates since A-02/A-04/A-08's real trigger endpoints already exist behind
   currently-disabled buttons.

## Fixes shipped this session (for context, don't redo)

- Test-data pollution cleanup (73 fake clients removed from production)
- A-02/A-08 error-visibility bugs, non-existent-column bugs
- Full codebase reconciliation pass (tsc, build, orphan routes, schema drift)
- CRON-01 (the locked 15/day publish cap) was **completely broken in production** —
  missing A-42 migration — fixed. This was arguably the single most important find of
  the whole session.
- RLS: `tenant_signals` had SELECT-only policy with no write policy, causing a **silent
  no-op** (200 success, nothing actually changed) on the Launch Center dismiss action.
  Audited the other 14 Batch 3 tables — confirmed via `pg_roles.rolbypassrls` that all
  other live writes go through service-role clients, which bypass RLS entirely, so this
  gap doesn't generalize. Logged as a latent risk for any *future* dashboard-side write
  feature against those 14 tables.
- Top bar / global search dropdown both hit the same `.appShell` `z-index: 100` paint-order
  bug — the shell's full-viewport `position:fixed` was covering the client selector and
  later the search dropdown. **Watch for this recurring** on any new UI element added to
  this shell; check z-index against 100 by default.
- `agent_events` enum missing `A-44` — added.
- `user_actions` missing INSERT grant/policy for `authenticated` role — added.
- `ANTHROPIC_API_KEY` was 82 days stale in Vercel env (rotated key never got pushed) —
  rotated, redeployed, confirmed A-44 succeeds live post-fix.

## Standing operational rules, confirmed and hard-won this session

- **GitHub auto-deploy cannot be trusted for this project.** It has silently failed or
  lagged (once by 4 days, once being 2 days stale when believed current) multiple times.
  **Always manually verify with `vercel --prod` after any commit meant to be live**, then
  confirm via `vercel ls --prod` (top entry should be minutes old) before treating
  anything as deployed.
- **FORGE's background orchestrator is unreliable for long unattended runs** — two
  consecutive launches died within seconds on this project. **Use direct foreground
  Claude Code sessions ("chain it" — one prompt, numbered steps, real per-item commits)
  for anything long-running, not FORGE**, until FORGE's reliability is separately
  investigated.
- **Chain-it commits per item, never batches** — this is what makes long sessions
  recoverable if interrupted; nothing is ever lost to a crash.
- **Self-reported "done" is not verification.** Every claim of completion this session
  that wasn't independently checked (screenshot, direct git log, direct Supabase query,
  actual click-through) turned out to need correction at least once. Default to checking.
- **Remote Control** (`/remote-control` in an active CC session) lets the operator monitor
  and steer a running session from the Claude mobile app — useful for long sessions.
- Dev server can degrade under a full day of continuous test traffic and throw
  `ConnectTimeoutError` reaching Supabase — this looks like a hang/bug but is an
  environment issue. Restart the dev server before chasing it as a code bug.

## Recommended next steps, in order

1. Verify the crawl/sitemap fix on the remaining 4 of 6 shared pages (indexation, schema
   already partially checked, site-audits, canonicals, page-experience) if not already
   confirmed.
2. Fix the A-07 `clients.slug` bug (item 1 above) — bounded, known.
3. Confirm the governance doc sync from this session actually landed and is accurate
   (re-read STATE_OF_THE_BUILD.md's latest entry).
4. **Make the Contract 9 activation decision** (item 4 above) — this is the actual next
   phase of "build a functional operational workflow center," distinct from bug-fixing.
   Recommend starting narrow: Launch Center's 3-4 highest-value real triggers, watched,
   verified one at a time, not a broad unattended sweep.
5. Only after 1-4: consider whether any of the 19 THIN items deserve a real bespoke
   design pass (reference the original reference images / preference session from early
   in the prior conversation if picking this back up).
