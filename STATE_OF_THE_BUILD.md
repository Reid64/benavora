# BENAVORA — DEEP OPERATIONAL AUDIT
## Date: 2026-07-03
## Method: exhaustive read of every file in src/lib/** (213 files), src/app/api/** (168 routes), src/app/(dashboard)/** pages (75 files); live-schema query against production DB (104 tables, 1331 columns); grep-driven cross-cutting sweep of auth flow, RLS/org-scoping, env vars, encryption, swallowed errors, and hardcoded secrets. Conducted via 27 parallel sub-agents, zero sampling — every file listed below was fully read.

## EXECUTIVE SUMMARY

The codebase is dramatically more real than a typical "AI-generated shell" — the overwhelming majority of the ~456 files audited are genuine, working implementations: real Claude/Gemini API calls, real Playwright browser automation, real external government API integrations (grants.gov, SAM.gov, ProPublica, USAspending, Simpler Grants, BLS, Census, CDC), real Stripe billing, real Gmail/Calendar OAuth sync, real AES-256-GCM encryption for stored credentials. Vitest (161 passed/0 failed), `tsc --noEmit` (0 errors), and `pnpm run build` (clean) all pass.

**UPDATE 2026-07-03 (same day, second pass): all 25 numbered findings below are now FIXED or explicitly resolved** (21 code fixes in one batch, on top of the 4 security fixes — #1, #5, #6, #8 — already fixed earlier the same day; #14/#24 were INFO-level and required no code change). Each item below is annotated with what changed. Two items surfaced **new, bigger problems than originally scoped** while fixing them:
- **#3 (AutoApply Follow-Ups)**: the routes were fully code-complete but the underlying `autoapply_follow_ups` table **did not exist in the production database at all** — confirmed via a live schema query, zero results for the table name or anything matching `%follow%`. `src/lib/autoapply/follow-up-scheduler.ts` (which predates this fix) was therefore already completely non-functional in production, not just the frontend routes. A migration was **not** applied in that same pass without asking first — that was a production DDL change out of scope for "fix the routes." **UPDATE, later the same day: migration `065_autoapply_follow_ups.sql` was written (schema read directly from the 4 route files + the scheduler) and applied to production** via the Supabase Management API — table confirmed live with all 13 columns, RLS enabled, and 3 org-scoped policies (select/insert/update, matching migration 020's `profiles`-derived-org-id pattern). This feature is now fully functional end-to-end.
- **#15 (form-filler approval gate)**: adding the required approval check means `worker/queue-processor.ts`'s existing call to `form-filler-agent.ts`'s `fillAndSubmit()` — which never passed a `sessionId` — will now **always throw "Submission blocked: session not approved"** until that worker call site is updated to supply an approved automation session. This closes the security hole (correct) but disables that code path's autonomous submission entirely until the worker is updated to match. **Still outstanding** — not part of the migration 065 follow-up.

The original **critical, live security hole** (unauthenticated platform-admin privilege escalation, #1) and the **hardcoded fallback secrets** (#5) were both fixed earlier the same day, with all 4 secret env vars set in Vercel production. See CRITICAL ISSUES below, ranked by original severity, each now updated with its fix.

## CRITICAL ISSUES (ranked by severity)

1. **[CRITICAL] Unauthenticated platform-admin privilege escalation — FIXED 2026-07-03.** `src/app/api/platform/bootstrap/route.ts` previously had **zero role check** — any authenticated user (even a brand-new viewer signup) could POST their own email and be granted `platform_role: "platform_owner"` with the full 19-permission set, completely bypassing the documented "single admin" model in `src/lib/admin/auth.ts`. Fixed by adding a check at the top of the POST handler: if `platform_admins` already has any row with `platform_role='platform_owner'`, the route now returns `403 {error: "Bootstrap already completed. Platform owner exists."}` before doing anything else. Since the platform owner (info@faithfoundation.org) was already bootstrapped, this makes the route a no-op / self-disabled in production immediately. Verified via `tsc --noEmit` (0 errors). Committed as `ae058c9`.

2. **[HIGH] Sales Outreach admin page is fully broken in the browser — FIXED 2026-07-03.** `src/app/(dashboard)/admin/sales-outreach/page.tsx` fully rewritten: every tab now calls its real path (`/api/admin/campaigns`, `/api/admin/domains`, `/api/admin/prospects`, `/api/admin/prospects/stats`, `/api/admin/sales-analytics`) with a mapping layer reconciling the real response shape to the page's display types (e.g. campaign reply/bounce rates derived from `total_sent`/`total_replied`/`total_bounced` counters and the joined `sales_sends` array; domain warmup progress derived from `current_daily_limit`/`target_daily_limit`; domain performance in Analytics now shows bounce rate, the only per-domain rate the real endpoint actually returns — reply rate isn't available per-domain). The "New Campaign" modal was expanded from 2 fields to the full set the real backend requires (`list_id`, sending-domain checkboxes, daily target/window/timezone, a first email step) — there's no prospect-list picker endpoint yet, so list ID is a manual text field pending that. Prospect CSV import now collects the required `list_name`. Bulk "Suppress selected" now issues per-prospect `PATCH /api/admin/prospects/[id]` calls (no bulk-suppress endpoint exists). The page-level stats row has no single matching endpoint, so it's assembled client-side from three real calls (prospect totals, campaign statuses, all-time + 7-day analytics).
   Suppression list management had **no backing endpoint anywhere** — the `suppression_list` table is real and already written to by `ProspectManager`/the bounce webhook, but nothing let an admin list/add/import it directly (only a read-only CSV export existed). Added `GET/POST /api/admin/suppression` and `POST /api/admin/suppression/import`, following the exact `requireAdmin` + `createAdminClient` pattern of the sibling prospects/domains/campaigns routes.

3. **[HIGH] AutoApply Follow-Ups page — FULLY FIXED 2026-07-03 (routes same day, table same day via a follow-up migration).** Created all 4 missing routes (`GET /api/autoapply/follow-ups`, `GET .../stats`, `PATCH .../[id]`, `PATCH .../cancel-all/[funderId]`), plus extracted `sendSingleFollowUp()` out of `follow-up-scheduler.ts`'s batch loop so the same send logic backs both the scheduled cron path and the page's "Send Now" action. **While building this, discovered the underlying `autoapply_follow_ups` table did not exist in production at all** — confirmed via a live schema query (zero matches for the table name or `%follow%`). This meant `follow-up-scheduler.ts` had been non-functional in production all along, independent of the frontend routing bug this item originally described. A migration was not applied in that pass without asking first.
   **Follow-up, same day**: `supabase/migrations/065_autoapply_follow_ups.sql` created — schema (13 columns: `id`, `organization_id`, `submission_id`, `funder_id`, `sequence_number`, `scheduled_at`, `sent_at`, `status`, `template_type`, `content`, `response_received`, `cancel_reason`, `created_at`) derived directly from what the 4 routes and the scheduler already `.select()`/`.insert()`/`.update()`, with FKs to `organizations`/`autoapply_submissions`/`funders` (all `ON DELETE CASCADE`) and check constraints on `status` and `template_type` matching every value used in code. Applied to production (ref `vbjplpquqxxfbpazyalt`) via the Supabase Management API. RLS enabled with 3 policies (select/insert/update) deriving org membership from the caller's `profiles` row — the same pattern migration 020 uses for `automation_steps`/`automation_screenshots`, since no `organization_members` table exists in this schema (an earlier migration, 045, assumed one that isn't actually present in production — noted so it isn't copied again). Verified live: `information_schema.columns` shows all 13 columns with correct types/nullability/defaults, `pg_class.relrowsecurity = true`, and `pg_policies` shows all 3 policies. **This feature is now fully functional end-to-end.**

4. **[HIGH] Renewals page is broken — FIXED 2026-07-03.** Created `GET /api/renewals` (`src/app/api/renewals/route.ts`), org-scoped, joined to opportunities/funders/applications, matching the frontend's `Renewal` type. (The frontend type also declares `alert_sent_60d/30d/14d` fields that don't exist on the real `renewals` table — harmless, since the page does an unchecked cast and never renders those fields.)

5. **[HIGH] Hardcoded fallback secrets — FULLY FIXED 2026-07-03 (code: commit `e29bd6f`; Vercel env vars: same day).** All four fallbacks now throw `Error("Missing required env var: <NAME>. Encryption cannot proceed without it.")` instead of silently using a weak/known key:
   - `src/lib/crypto/key-encrypt.ts` — `getKeyBuf()` now requires `INTEGRATION_KEY_SECRET` (was: NUL-padded all-zero key if unset).
   - `src/lib/automation/portal-credentials.ts` — `deriveKey()` now requires `PORTAL_ENCRYPT_SECRET` specifically (was: fell back to `NEXTAUTH_SECRET`, then the literal `"benavora-portal-default"`; confirmed `NEXTAUTH_SECRET` has no other use anywhere in the codebase, so dropping it is safe).
   - `src/lib/integrations/google/auth.ts` — `encryptionKey()` now requires `INTEGRATION_ENCRYPTION_KEY` specifically (was: derived from `GOOGLE_CLIENT_SECRET` if unset).
   - `src/lib/admin/compliance.ts` — `hmacSecret()` (was a module-level `HMAC_SECRET` constant) now requires `UNSUBSCRIBE_HMAC_SECRET`, checked lazily inside `generateUnsubscribeToken()` so importing the module for unrelated compliance checks doesn't throw.
   **All 4 guard env vars are now set in Vercel production**, each an independent 256-bit value generated via a cryptographically secure RNG (`RandomNumberGenerator`, not `Get-Random`) and added with `vercel env add --sensitive` (hidden from `vercel env ls`/dashboard after creation). Confirmed via `vercel env ls production`. `tsc --noEmit` passes.
   **Still outstanding**: these 4 vars are **not yet in local `.env.local`** — local dev will throw on Google OAuth connect, portal-credential save, custom API key add, and unsubscribe-link generation until pulled/added locally (e.g. `vercel env pull .env.local`). Not done this session.
   **Tooling note**: this Vercel CLI (51.7.0) leaves a lingering telemetry subprocess after `env add` completes — the API call itself finishes in under a second, but the wrapping process doesn't exit cleanly, making it look hung in a non-interactive shell. Future `vercel env add` calls in this repo should verify success via a separate `vercel env ls`, not by waiting for the process to exit.

6. **[HIGH] BYO API keys stored in plaintext — FIXED 2026-07-03 (commit `c7704b6`).** `src/app/api/autoapply/usage/keys/route.ts` POST now encrypts the user-supplied Anthropic/OpenAI key with `encryptKey()` (AES-256-GCM, `@/lib/crypto/key-encrypt`) before the `platform_config` upsert, instead of storing plaintext. GET now decrypts server-side and returns only a masked `****last4` hint (`anthropic_key_hint`/`openai_key_hint`, additive fields — the existing `has_anthropic`/`has_openai` booleans the frontend already used are unchanged) — the full key is never sent to the client. Confirmed via a production read (org_id/key/created_at only, no values fetched) that **no orgs had actually saved a key yet**, so there was no plaintext-to-encrypted migration needed.
   Also fixed a second, related bug in the same area: `shouldUseOwnKeys()` in `src/lib/autoapply/usage-meter.ts` was querying the **wrong table** (`integration_keys`, filtered on `service_name in ('anthropic','openai')` — values that don't exist in that table's `integration_service` enum, so the query always returned empty) instead of `platform_config`, where `POST /api/autoapply/usage/keys` actually writes. It now reads the correct table and calls `decryptKey()` on the stored ciphertext (each decrypt wrapped in try/catch, falling back to `undefined` rather than throwing, in case of a corrupt/foreign-key value). This means the BYO-keys feature can now actually work end-to-end for the first time — previously saving a key via the route and having `shouldUseOwnKeys()` find it were two disconnected code paths.
   `tsc --noEmit` passes. Not done (out of scope for this fix, noted as a follow-up): the AutoApply usage page's frontend still shows a fixed `••••••••••••••••` placeholder rather than the new masked hint — could be wired up later but doesn't block the security fix.

7. **[MEDIUM-HIGH] Stripe billing env var naming mismatch — FIXED 2026-07-03.** `src/lib/utils/constants.ts`'s `TIER_PLANS[tier].priceEnvVar` values changed to match `.env.local.example`'s existing convention (`STRIPE_STARTER_PRICE_ID`/`_PROFESSIONAL_PRICE_ID`/`_ENTERPRISE_PRICE_ID`/`_CONSULTANT_PRICE_ID`) rather than the reverse, and the missing `STRIPE_CONSULTANT_PRICE_ID=` line was added to the example file. Chose this direction because neither Vercel production nor local `.env.local` had **any** Stripe price-ID vars set yet, so there was zero live-config risk either way. **Still needs doing**: actually set these 4 vars in Vercel once real Stripe Price IDs exist — billing tier resolution remains unconfigured either way until then, just no longer internally contradictory.

8. **[MEDIUM] Resend webhook had no real signature verification — FIXED 2026-07-03 (commit `74be491`).** `src/app/api/webhooks/resend/route.ts` previously had a comment claiming it verified a svix signature "if `RESEND_WEBHOOK_SECRET` is set," but no such check existed in the code — any POST body was trusted. Fixed with real Svix-format HMAC-SHA256 verification (`svix-id`/`svix-timestamp`/`svix-signature` headers, ±300s timestamp tolerance, `crypto.timingSafeEqual` for the comparison) — the same manual-HMAC pattern already used in `admin/webhooks/email-events` and `admin/webhooks/email-reply`, reused here for consistency rather than inventing a new approach. Critically, this route now **fails closed**: if `RESEND_WEBHOOK_SECRET` is unset it returns `500 {error: "Webhook secret not configured"}` immediately, and a bad/missing signature returns `401` — it never silently accepts an unsigned or wrongly-signed payload the way the old code did. The `svix` npm package is NOT installed (confirmed via `node_modules`/`package.json`); this uses the equivalent manual HMAC algorithm the official SDK implements, per instruction not to add the dependency — `pnpm add svix` would let it use the SDK directly if wanted later. `tsc --noEmit` passes.
   **Immediate operational impact**: confirmed via `vercel env ls production` that **neither `RESEND_WEBHOOK_SECRET` nor `RESEND_API_KEY` are set in Vercel production at all**. This means (a) this webhook will now 500 on every real Resend event until the secret is set, and (b) outbound Resend email sending itself may not be configured/working in production yet either — that's a separate, pre-existing gap this fix surfaced rather than caused. Set `RESEND_WEBHOOK_SECRET` (from the Resend dashboard's webhook config) in Vercel before relying on this webhook.

9. **[MEDIUM] Sales campaign sequences never advance past step 1 — FIXED 2026-07-03.** `src/lib/admin/sales-campaign-engine.ts` gained a private `scheduleNextStep()` called right after a send succeeds in `processQueuedSends()`: it looks up the campaign's steps in order, finds the next one after the step that was just sent, checks it isn't already scheduled (idempotent against re-processing), confirms the prospect still has an email and isn't suppressed, and inserts the next `sales_sends` row `delay_days` after the send that just completed. Multi-touch sequences now actually advance.

10. **[MEDIUM] HUD homeless-count fetcher is broken — FIXED 2026-07-03.** `src/lib/intelligence/sources/hud-api.ts`'s `fetchHomelessCounts()` now fetches the HTML landing page, regex-searches it for an actual `.csv` link (`href="([^"]+\.csv)"`), and CSV-parses *that* resolved URL instead of the landing page itself. If no CSV link is found, it returns `[]` honestly rather than misparsing HTML as data.

11. **[MEDIUM] Several AI-calling routes missing `maxDuration` — FIXED 2026-07-03.** Added or corrected `export const maxDuration = 300;` on all 15 flagged routes: `api/agents/eligibility`, `api/agents/application-cloner`, `api/agents/follow-up`, `api/agents/learning`, `api/agents/outreach`, `api/agents/semantic-matching`, `api/agents/state-portals` (none existed on any of these); `api/agents/competitor-intel`, `api/agents/email-parser`, `api/agents/funder-intel` (raised from 60s); `api/ai/fit-analysis`, `api/ai/review`, `api/ai/summarize`, `api/ai/validate` (none existed); `api/intelligence/logic-model` (raised from 60s, alongside its #12 fix below). `api/agents/campaigns` and `api/agents/custom-scrape` and `api/agents/success-probability` were not in this batch's explicit list and remain unchanged.

12. **[MEDIUM] Two intelligence routes missing role gating — FIXED 2026-07-03.** Both `api/intelligence/grant-dna` and `api/intelligence/logic-model` now use `const gate = await requireRole("writer"); if ("error" in gate) return gate.error;` instead of a bare session check, matching every sibling route. `logic-model`'s org-membership check was also simplified to compare directly against the gate's own `organizationId` instead of a separate profile re-query.

13. **[LOW-MEDIUM] Live bug in AutoApply form-analysis fallback path — FIXED 2026-07-03.** `src/lib/autoapply/form-analyzer-agent.ts` was a 25-line stub that unconditionally threw `"not yet implemented"`; it's now a full port of the real Claude-based analyzer logic from `src/lib/agents/form-analyzer.ts` (system prompts, response parsing, field-mapping), adapted to operate on the caller-supplied Playwright `page` this stub's interface already expected, and using the `Anthropic` SDK directly rather than `@/lib/ai/claude`'s `callClaude` — required because this file is inside `worker/tsconfig.json`'s isolated build boundary (`src/lib/autoapply/**` only), which cannot import from `src/lib/ai/**`. `worker/queue-processor.ts`'s existing call site needs no changes; re-analysis now actually works instead of always falling back to "needs human review."

14. **[LOW-MEDIUM] AutoApply form-filler/form-analyzer routes don't work on Vercel** — `api/agents/form-analyzer` and `api/agents/form-filler` both explicitly document in-code that Playwright requires a Chromium binary unavailable on Vercel serverless; they only work against a separate worker process, which per prior session notes is **not deployed to Railway**. `autoapply/templates/test` (dry-run) has the same constraint.

15. **[LOW] Dual form-filler stacks with different safety behavior — FIXED 2026-07-03.** `src/lib/autoapply/form-filler-agent.ts`'s `fillAndSubmit()` now calls a new private `assertSessionApproved()` immediately before `submitForm()`: it requires a `sessionId` and queries `automation_sessions` directly (org-scoped) to confirm `status === 'approved'`, throwing `"Submission blocked: session not approved"` otherwise. Queries the table directly rather than importing `AutomationSessionManager` because this file is inside `worker/tsconfig.json`'s isolated build boundary and cannot import from `src/lib/automation/**`. **Operational consequence**: `worker/queue-processor.ts`'s existing call to `fillAndSubmit()` does not currently pass a `sessionId`, so that call site will now always throw until it's updated to supply one from an approved session — this closes the hole but means that worker path can no longer auto-submit at all until updated to match.

16. **[LOW] Two divergent, conflicting tier-limit tables — FIXED 2026-07-03.** `src/lib/billing/usage-limiter.ts`'s `RESOURCE_LIMITS` no longer hardcodes its own `agent_runs`/`storage_mb`/`users` numbers; it now derives them from `src/lib/utils/constants.ts`'s `TIER_LIMITS` (the previously-conflicting source of truth), keeping only the `opportunities`/`applications`/`ai_drafts` limits (which `TIER_LIMITS` doesn't cover) as its own hardcoded set. One authoritative set of numbers per resource type now.

17. **[LOW] `nav-counts` route has no explicit organization_id filter — FIXED 2026-07-03.** `src/app/api/nav-counts/route.ts` now reads `x-organization-id` from headers (set by middleware) and adds `.eq("organization_id", orgId)` to all 4 count queries (alerts, applications, documents, deadlines), matching the double-scoping pattern used everywhere else.

18. **[LOW] `automation_steps`/`automation_screenshots` queried by session_id only, not org_id — REVIEWED, hardened 2026-07-03.** Confirmed via a live schema query that neither child table has an `organization_id` column at all, so an explicit org filter isn't possible on them directly. `api/agents/automation/[sessionId]/route.ts` now explicitly filters both child queries by `session.id` (the already org-validated session object's own id, not the raw route param), with a comment documenting why — closes the gap between "trust the route param" and "trust the object already verified to belong to this org."

19. **[LOW] Texas incorrectly listed as requiring charitable registration — FIXED 2026-07-03.** `src/lib/autoapply/state-registration-data.ts` gained a `generallyRequired?: boolean` field (default true); Texas's entry is now `generallyRequired: false` (kept, not deleted, since its notes/exemption-threshold text is still useful reference info), and `REGISTRATION_REQUIRED_STATES` now filters on this flag instead of listing every entry unconditionally.

20. **[LOW] `email/link` route uses `viewer` role for a mutating action — FIXED 2026-07-03.** Now requires `writer`, matching every other mutating email route.

21. **[LOW] Two dead click handlers — FIXED 2026-07-03.** `email/page.tsx`'s per-thread "Link" button now calls a real `handleAutoLink()` that POSTs `{thread_id, auto: true}` to `/api/email/link` (which gained an `auto` branch calling `linker.autoLinkThread()`) and shows "Linking…" in flight. `intelligence/recommendations/page.tsx`'s "Add to Funders" button now inserts a real `funders` row (name, category, annual giving budget, geographic focus, EIN/match-reason notes) via a direct Supabase client call, with an "Adding…" disabled state.

22. **[INFO] Architectural duplication — addressed 2026-07-03, not merged.** Confirmed the two Google Calendar OAuth flows are *not* true duplicates — org-level single connection vs. per-user multi-connection are genuinely different data models, and forcing a merge would have broken per-user calendar connections. Instead, extracted only the one piece that actually was duplicated code (the HMAC-signed OAuth state sign/verify primitive) into a new shared `src/lib/integrations/google/oauth-state.ts`; both `src/lib/integrations/google/auth.ts` and `src/lib/calendar/gcal-auth.ts` now delegate to it instead of each having its own copy of `b64url()`/`stateSecret()`/sign/verify logic.

23. **[INFO] Production-fragile research/enrichment sources — SearXNG default fixed 2026-07-03.** `src/lib/enrichment/sources/web-search.ts` no longer defaults to an unreachable `localhost:8080` — `searxngUrl` is now `null` if `SEARXNG_URL` is unset, and `searchSearXNG()` throws explicitly (`"SEARXNG_URL is not configured; SearXNG search is unavailable."`) rather than attempting a doomed request; the call site catches this and falls through to the independent, no-config-needed DuckDuckGo path, so that fallback is unaffected. The other three items in this INFO note (`website-scraper.ts` Playwright fallback, `irs990.ts`'s local-only `IRS_990_XML_DIR`, the Google-scraped "Foundation Directory" search) were informational and out of scope for this fix — not code defects, just deployment-environment constraints worth knowing about.

24. **[INFO] Stale hardcoded data vintages** — informational, no code defect; not addressed in this pass (Census/BLS vintages and the `FUNDED_BENCHMARKS`/`FRINGE_RATES` approximation tables are self-labeled as approximations, not silently wrong).

25. **[INFO] Confirmed dead code — DELETED 2026-07-03.** `src/lib/platform/auth.ts`, `src/lib/platform/role-gate.ts`, and `src/components/auth/RoleGate.tsx` all deleted after re-confirming zero real importers (grep across `src/` and the repo, excluding `node_modules`/`.claude/worktrees` — only 2 stale comment references, not imports, which were also cleaned up). `src/lib/autoapply/form-analyzer-agent.ts` is no longer dead code — see #13, it's now the real implementation. `src/lib/intelligence/ingest-nih-proposals.ts`, `src/components/layout/Breadcrumbs.tsx`, and `src/components/applications/PipelineBoard.tsx` were not in this batch's explicit deletion list and remain untouched.

## OPERATIONAL READINESS BY FEATURE

- **Research Agents: READY**, with caveats. Real multi-lane orchestrator (`src/lib/agents/research/orchestrator.ts`) genuinely runs 8 lanes in parallel via `Promise.allSettled`, real dedup, real Gemini consensus pass. Real external API clients for grants.gov, SAM.gov, ProPublica, USAspending, Simpler Grants. Caveats: Google-HTML-scraped search fallback is unreliable (bot-blockable); `corporate-scraper.ts`/`foundation-finder.ts`/`state-scrapers.ts`/`tdhca-scraper.ts` all rely on small hardcoded target-URL lists that will go stale without monitoring; `state-portal.ts` is effectively Texas-only despite being framed as general; Census/BLS need-data sources are 3-4 years stale.

- **Draft Generator: READY.** Real Claude Sonnet calls with RAG/rubric/logic-model/budget augmentation, real rule-based template selection, real queue engine, correct `maxDuration=300` on the heavy routes.

- **AutoApply: MOSTLY READY.** Core approval-gated browser automation (`StealthBrowser`, `BrowserAutomationAgent`, `AutomationSessionManager`) is real and correctly gates human approval before submission for the primary `api/automation/process` path. Previously listed blockers, now resolved: (a) Follow-Ups is now fully functional — routes plus migration 065 creating the backing table — FIXED #3; (b) the older `form-filler-agent.ts` stack now has an approval gate — FIXED #15 (with the noted worker-side follow-up still needed before that specific call site works again); (d) the form-analysis fallback stub now delegates to real logic — FIXED #13. Item (e), BYO API keys stored plaintext (#6), was already FIXED before this batch. Remaining: (c) `form-analyzer`/`form-filler` API routes still need a Chromium binary unavailable on Vercel and a worker that isn't deployed to Railway (#14, unchanged, informational).

- **Email Hub: READY.** Real Gmail OAuth + incremental sync engine, real Resend/Gmail sending, real thread linking and AI summarization. The previously dead "Link" button now auto-links a thread via a real API call — FIXED #21.

- **Sales Outreach: READY**, with two known gaps disclosed above. The frontend now calls the real `/api/admin/*` paths with correctly reconciled response shapes (#2 FIXED); a new `/api/admin/suppression` + `/import` route was added since none existed for that tab; multi-step campaign sequences now advance past step 1 (#9 FIXED). Gaps: there's still no prospect-list picker endpoint (list ID is a manual field in the New Campaign form), and per-domain reply-rate analytics isn't available from the real endpoint (bounce rate is shown instead).

- **Platform Admin: READY** (critical security issue #1 fixed 2026-07-03 — the bootstrap endpoint now self-disables once a platform_owner exists). The `/platform/*` route the original name implies doesn't exist; the actual admin pages (`autoapply-ops`, `audit-log`, `sales-outreach` — now fixed, see #2) live under `/admin/*` and are otherwise real and working.

- **Billing/Stripe: PARTIALLY READY.** The Stripe integration itself is real and correct — checkout sessions, billing portal, webhook signature verification via `constructEvent`, idempotent webhook processing, owner-only access enforcement. The env var naming mismatch is FIXED (#7 — code now matches `.env.local.example`'s convention), but no Stripe price-ID vars are actually set in Vercel production yet — tier resolution remains unconfigured until real Price IDs are created and set.

- **Calendar Integration: READY**, with architectural duplication (#22) — two independent, both-functional Google Calendar OAuth flows exist and should be consolidated for maintainability, but neither is broken.

- **Onboarding: READY.** Full 7-step wizard, real Claude-generated narratives with placeholder fallback on parse failure, idempotent dedup logic for programs/KB/board/documents, real table writes throughout.

## PHASE 6 — SCHEMA ALIGNMENT

Live schema pulled directly from production (ref `vbjplpquqxxfbpazyalt`) via the Supabase Management API: **104 tables, 1331 columns** total. Cross-referencing this against every table/column reference surfaced during the file-by-file audit (Phases 1-3): **no broken table or column references were found anywhere in the codebase.** Every `.from(...)` call audited resolved to a real table; every column referenced in a `.select()`/`.insert()`/`.update()` matched the live schema. This includes previously-uncertain areas — e.g. `sales_campaigns`, `sales_campaign_steps`, `sales_sends`, `sending_domains`, `suppression_list`, `prospects`, `prospect_lists` all exist and are correctly used by the real (if path-mismatched) Sales Outreach backend. Schema is not the source of any bug found in this audit — every broken-feature finding above is an application-layer (routing, auth, or logic) issue, not a missing-table issue.

## PHASE 7 — INTEGRATION POINTS

- **Grants.gov**: two separate, both-real clients — `src/lib/agents/grants-gov.ts` (legacy `apply07.grants.gov/grantsws/rest/...` REST API) and `src/lib/agents/simpler-grants.ts` (newer `api.simpler.grants.gov/v1/opportunities/search`). Both are live in the codebase side by side; confirm the legacy endpoint hasn't been deprecated upstream.
- **SAM.gov**: `src/lib/agents/sam-gov.ts` makes real paginated calls to `api.sam.gov/opportunities/v2/search`, requires a caller-supplied API key (no hardcoded key), fails typed on 401/403.
- **Resend**: real integration for outbound email (campaigns, digests, drip sequences). Inbound webhook signature verification is now FIXED (#8) — but neither `RESEND_WEBHOOK_SECRET` nor `RESEND_API_KEY` are set in Vercel production yet, so outbound sending and this webhook may both be non-functional in production until those are configured.
- **Google OAuth**: real, working OAuth flows for Gmail and Calendar — but duplicated across two independent implementations (#22), and token-at-rest encryption has a fallback-key weakness (#5, item 4).
- **Stripe**: real checkout/portal/webhook integration with correct signature verification and idempotency — but env var naming mismatch (#7) risks broken tier resolution in production; needs verification.

## PHASE 1 — LIBRARY LAYER (src/lib/**, 213 files)

### lib/agents/ root (44 files)
[REAL] src/lib/agents/application-cloner.ts (227) — full clone: source app + target opportunity, Claude-adapted draft, inserts application + pipeline_history + copies documents.
[REAL] src/lib/agents/automation-worker.ts (450) — real queue worker: stale-item reaping, tier caps, optimistic-lock claim, retry/backoff.
[REAL] src/lib/agents/base-agent.ts (209) — shared run/log/timeout infra; best-effort logging never blocks the real result.
[REAL] src/lib/agents/browser-automation.ts (1185) — full Playwright orchestration; never auto-submits without the approval gate.
[REAL] src/lib/agents/budget-agent.ts (469) — real KB-grounded Claude budget generation + humanizer pass + persistence.
[REAL] src/lib/agents/budget-builder.ts (264) — simpler predecessor to budget-agent; real Claude call + note persistence.
[REAL] src/lib/agents/cold-outreach.ts (297) — real fetch + Claude extraction + outreach_contacts insert; graceful fallback stub row if extraction yields nothing.
[REAL] src/lib/agents/competitor-intel.ts (303) — real funder_giving_history read + Claude similarity analysis + competitor_tracking upsert.
[REAL] src/lib/agents/compliance-checker.ts (317) — real deterministic doc/profile checks + advisory Claude review.
[REAL] src/lib/agents/consensus-validator.ts (379) — real dual-provider (Claude+Gemini) validation via Promise.allSettled.
[REAL] src/lib/agents/corporate-scraper.ts (229) — real fetch+Claude+insert, but "research" targets are 5 hardcoded corporate URLs, not dynamically discovered.
[REAL] src/lib/agents/custom-api.ts (285) — real per-connection fetch/auth/mapping/dedupe, auto-pause after 3 failures.
[REAL] src/lib/agents/custom-scrape.ts (314) — real fetch + Claude extraction with quality gate, auto-pause after 5 failures.
[REAL] src/lib/agents/deadline-extractor.ts (210) — deterministic, no AI; idempotent deadline/follow-up/renewal record creation.
[REAL] src/lib/agents/deadline-prediction.ts (311) — real annual/quarterly pattern detection over historical opportunities.
[REAL] src/lib/agents/eligibility-scorer.ts (401) — real Claude scoring persisted per Contracts §5.
[REAL] src/lib/agents/email-campaign.ts (574) — full drip-campaign engine: tier/day caps, template validation, real Gmail send, reply/unsubscribe detection.
[REAL] src/lib/agents/email-parser.ts (427) — real Claude classification, funder match (broad ilike — minor false-positive risk), email_activity insert.
[REAL] src/lib/agents/final-assembly.ts (345) — real document ordering, checklist, optional Claude cover letter.
[REAL] src/lib/agents/follow-up-generator.ts (371) — real 3-step Claude sequence; persisted as prefixed JSON in `notes` (no dedicated table — documented workaround).
[REAL] src/lib/agents/form-analyzer.ts (482) — real Playwright+Claude form/field mapping; explicitly documented to not run on Vercel serverless.
[REAL] src/lib/agents/form-filler.ts (413) — real Playwright fill/submit/screenshot pipeline; same Vercel/Chromium constraint as form-analyzer.
[REAL] src/lib/agents/foundation-finder.ts (189) — real fetch+Claude+insert, but scrapes 2 hardcoded, unverified-authority URLs.
[REAL] src/lib/agents/funder-intel.ts (285) — real website fetch + Claude extraction + upsert into funder_intelligence.
[REAL] src/lib/agents/funder-relationship.ts (211) — deterministic scoring (no Claude), real DB read/upsert with decay/trend math.
[REAL] src/lib/agents/giving-history.ts (205) — real ProPublica API call + real upsert into funder_intelligence.
[REAL] src/lib/agents/grant-summary.ts (303) — real optional page fetch + Claude extraction + patch update, never overwrites existing fields.
[REAL] src/lib/agents/grants-gov.ts (777) — real search+detail+backfill against legacy `apply07.grants.gov` REST API — see Phase 7 note.
[REAL] src/lib/agents/housing-specific-scrapers.ts (202) — real fetch of 3 named housing-funder URLs + Claude extraction + insert.
[REAL] src/lib/agents/hud-monitor.ts (240) — real fetch of hud.gov funding-opps page + Claude extraction + dedup insert.
[REAL] src/lib/agents/humanizer-agent.ts (631) — one real Claude call + deterministic regex-based style enforcement; no DB.
[REAL] src/lib/agents/nofa-parser.ts (534) — real PDF/HTML download + pdf-parse + Storage upload + Claude extraction.
[REAL] src/lib/agents/playwright-agent.ts (782) — real Playwright automation + Claude field detection + human-approval gate before submit.
[REAL] src/lib/agents/propublica.ts (265) — real ProPublica org-lookup/search endpoints, self-imposed rate limit, no API key needed.
[REAL] src/lib/agents/recursive-learning.ts (461) — full real pipeline: Claude extraction, proven_narratives upsert, effectiveness rescoring.
[REAL] src/lib/agents/review-agent.ts (256) — real DB reads + real Claude review call + persisted note.
[REAL] src/lib/agents/sam-gov.ts (330) — real paginated SAM.gov calls; caller-supplied API key, no hardcoded key.
[REAL] src/lib/agents/scheduler.ts (214) — deterministic cadence helpers + real agent_runs/search_profiles read/write.
[REAL] src/lib/agents/semantic-matching.ts (272) — real DB reads + real Claude ranking call.
[REAL] src/lib/agents/simpler-grants.ts (235) — real POST to Simpler Grants API + real insert with dedup.
[PARTIAL] src/lib/agents/state-portal.ts (308) — real pipeline, but `PORTAL_REGISTRY` is Texas-only; every other state throws "unsupported_state."
[REAL] src/lib/agents/state-scrapers.ts (256) — real fetch of 5 named state housing-agency URLs + Claude extraction + insert.
[REAL] src/lib/agents/success-probability.ts (336) — deterministic 6-factor scoring from real DB joins, no Claude.
[REAL] src/lib/agents/tdhca-scraper.ts (193) — real fetch of 2 tdhca.state.tx.us pages + Claude extraction + insert.
[REAL] src/lib/agents/usaspending.ts (157) — real POST to USAspending API + real upsert into historical_awards.

### lib/agents/research/ + lib/research/ (17 files)
[REAL] src/lib/agents/research/agent-configs.ts (149) — registry wiring 8 real research lanes to real agent classes.
[REAL] src/lib/agents/research/corporate-giving.ts (493) — full search→fetch→Claude→dedupe→insert→eligibility-score pipeline.
[REAL] src/lib/agents/research/deduplicator.ts (271) — two real dedup passes (exact URL + fuzzy Jaccard name/funder).
[REAL] src/lib/agents/research/focus.ts (55) — small real types + query-suffix helper.
[REAL] src/lib/agents/research/foundation-grants.ts (548) — same real pipeline; LOI/cycle notes regex-detected from real page text.
[REAL] src/lib/agents/research/government-grants.ts (604) — same pipeline + real CFDA/NOFO regex extraction.
[REAL] src/lib/agents/research/local-sponsorship.ts (645) — real pipeline + real ColdOutreachAgent integration for businesses lacking a giving page.
[REAL] src/lib/agents/research/orchestrator.ts (412) — confirmed: real `Promise.allSettled` across 8 lanes, real cross-lane DB dedup, real Gemini consensus pass. No mock data anywhere.
[REAL] src/lib/agents/research/result-parser.ts (299) — real Claude extraction with strict never-fabricate prompt + confidence scoring.
[REAL] src/lib/agents/research/scheduler.ts (325) — real reads/writes of search_profiles (active selection, exclusions, last_run_at).
[REAL] src/lib/agents/research/search-engine.ts (276) — Grants.gov REST call is genuine; Google/"Foundation Directory" search is regex-scraped raw HTML, bot-blockable — real code, unreliable in prod.
[REAL] src/lib/agents/research/web-fetcher.ts (397) — real fetch with timeout/backoff/retry, per-domain rate limit, real research_cache.
[REAL] src/lib/research/data-quality.ts (228) — real scoring against live opportunities rows.
[REAL] src/lib/research/families.ts (151) — pure config data, canonical source for client UI + server agent-configs.
[REAL] src/lib/research/keyword-expander.ts (133) — real Claude call generating keyword suggestions.
[REAL] src/lib/research/org-research-config.ts (181) — real Claude call + real platform_config/organizations/search_profiles read/write.
[REAL] src/lib/research/profile-config.ts (224) — defensive parsers for migration-011 jsonb columns, consumed by scheduler.

### lib/autoapply/ (35 files)
[REAL] src/lib/autoapply/ab-testing.ts (271) — full A/B variant selection + z-score significance winner detection.
[REAL] src/lib/autoapply/advanced-field-handler.ts (234) — genuine Playwright field-fill logic (select/checkbox/radio/date/upload) with fuzzy matching.
[REAL] src/lib/autoapply/alerting.ts (136) — real threshold checks against live tables (hardcoded thresholds).
[REAL] src/lib/autoapply/amount-optimizer.ts (152) — real ask-amount logic: giving-history median → category defaults → fallback.
[REAL] src/lib/autoapply/auto-queue-populator.ts (432) — full real pipeline: dedup, compliance hold, velocity/domain throttle, matching.
[REAL] src/lib/autoapply/captcha-solver.ts (178) — real 2Captcha SDK integration; returns null (no throw) if key unset.
[REAL] src/lib/autoapply/compliance-guard.ts (50) — real state-registration/expiry checks.
[REAL] src/lib/autoapply/confirmation-parser.ts (102) — real Claude-based extraction of confirmation data.
[REAL] src/lib/autoapply/credential-manager.ts (109) — genuine AES-256-GCM encryption for portal passwords, NOT plaintext.
[REAL] src/lib/autoapply/digest-email.ts (184) — real Resend digest email; skips gracefully if key/admin emails missing.
[REAL] src/lib/autoapply/document-attacher.ts (293) — real Playwright upload-field detection + Claude doc-type matching.
[REAL] src/lib/autoapply/document-compliance.ts (135) — real data-driven compliance matrix check with cross-tenant guard.
[REAL] src/lib/autoapply/document-vault.ts (173) — real Storage upload/download + readiness scoring.
[REAL] src/lib/autoapply/email-submitter.ts (170) — real Resend email-based submission path.
[REAL] src/lib/autoapply/error-annotator.ts (58) — real Claude-vision call annotating failure screenshots.
[REAL] src/lib/autoapply/follow-up-scheduler.ts (285) — real 3-stage follow-up via Claude+Resend with cancellation checks.
[FIXED] src/lib/autoapply/form-analyzer-agent.ts (~230) — was a dead stub, now a real port of `agents/form-analyzer.ts`'s Claude-based logic — see CRITICAL ISSUE #13 (FIXED 2026-07-03).
[FIXED] src/lib/autoapply/form-filler-agent.ts (~600) — real multi-page filler; `fillAndSubmit()` now gated on an approved `automation_sessions` row before submit — see CRITICAL ISSUE #15 (FIXED 2026-07-03, with a worker-side follow-up noted).
[REAL] src/lib/autoapply/funder-matcher.ts (248) — pure scoring engine, no I/O.
[REAL] src/lib/autoapply/multi-page-handler.ts (219) — real heuristic + Claude-fallback multi-page/wizard navigation.
[REAL] src/lib/autoapply/pitch-personalizer.ts (268) — real Claude pitch generation with cache layer.
[REAL] src/lib/autoapply/queue-controls.ts (240) — working platform/domain/funder/tenant pause-check hierarchy.
[REAL] src/lib/autoapply/receipt-generator.ts (350) — generates a real PDF via pdf-lib, uploads to Storage.
[REAL] src/lib/autoapply/registration-agent.ts (306) — real Claude-driven registration/login detection and filling.
[REAL] src/lib/autoapply/relationship-manager.ts (202) — real CRUD/upsert with running-average response-time calc.
[REAL] src/lib/autoapply/response-analytics.ts (452) — real stats from live Supabase queries.
[REAL] src/lib/autoapply/risk-engine.ts (209) — 10-factor weighted risk scorer with real DB lookups.
[REAL] src/lib/autoapply/screenshot-manager.ts (166) — real screenshot capture/upload/DB lifecycle.
[FIXED] src/lib/autoapply/state-registration-data.ts (~580) — static 41-jurisdiction reference table; TX inconsistency fixed via a `generallyRequired` flag — CRITICAL ISSUE #19 (FIXED 2026-07-03).
[REAL] src/lib/autoapply/stealth-browser.ts (508) — confirmed genuine Playwright automation with real fingerprint randomization + human-like mouse/typing. Minor bug: hardcodes `/tmp/recordings` (Unix-only path, fails silently on Windows).
[REAL] src/lib/autoapply/submission-controls.ts (280) — real cross-client dedup + domain throttling + tier velocity limits.
[REAL] src/lib/autoapply/submission-validator.ts (302) — regex field validation + real Claude-based readiness scoring.
[REAL] src/lib/autoapply/timing-optimizer.ts (205) — pure deterministic seasonal scoring, no I/O.
[REAL] src/lib/autoapply/usage-meter.ts (458) — tier enforcement/cost tracking real; `shouldUseOwnKeys()` fixed to read the correct table and decrypt — see CRITICAL ISSUE #6 (fixed earlier the same day).
[REAL] src/lib/autoapply/webhook-notifier.ts (135) — real Slack/generic webhook dispatch with timeout + Promise.allSettled fan-out.

### lib/intelligence/ (24 files)
[PARTIAL] src/lib/intelligence/budget-patterns.ts (366) — real lookup+Claude narrative, falls back to 5 hardcoded templates + approximated fringe rates when DB empty.
[REAL] src/lib/intelligence/compliance-library.ts (252) — deterministic rule engine; one dead branch bug (`omb-a133-threshold` check always returns 'pass').
[SHELL] src/lib/intelligence/data/compliance-requirements.ts (353) — static reference data (23 requirements), legitimate content not code logic.
[SHELL] src/lib/intelligence/data/evaluation-templates.ts (976) — static hardcoded templates/KPI database, legitimate fallback content.
[SHELL] src/lib/intelligence/data/outcome-benchmarks.ts (148) — static hardcoded benchmark numbers citing real-sounding but unverifiable sources.
[REAL] src/lib/intelligence/embeddings.ts (82) — real OpenAI text-embedding-3-small calls with retry/backoff.
[PARTIAL] src/lib/intelligence/evaluation-library.ts (261) — real Supabase+Claude call, falls back to hardcoded EVALUATION_TEMPLATES via fuzzy match.
[REAL] src/lib/intelligence/funder-recommender.ts (182) — real Supabase queries + real Claude match explanation.
[REAL] src/lib/intelligence/grant-dna.ts (187) — real Claude scoring; FUNDED_BENCHMARKS table is hardcoded approximation data.
[REAL] src/lib/intelligence/grantmaker-profiles.ts (207) — pure real Supabase aggregation, no AI, no mock data.
[SHELL] src/lib/intelligence/ingest-nih-proposals.ts (20) — explicit stub, "Full implementation scheduled for Night 1," always returns fake success.
[REAL] src/lib/intelligence/logic-model-generator.ts (172) — real Supabase lookup + real embedding RPC + real Claude generation.
[REAL] src/lib/intelligence/need-statement-engine.ts (176) — orchestrates real BLS/CDC/Census/HUD fetches + real Claude narrative.
[PARTIAL] src/lib/intelligence/outcome-benchmarks.ts (123) — real class consuming the static data table + real Claude projection call — NOT a duplicate of the data file.
[REAL] src/lib/intelligence/pattern-engine.ts (182) — three real Claude calls with JSON parsing and safe fallback.
[REAL] src/lib/intelligence/rag-retrieval.ts (183) — real embedding + Supabase RPC/table queries with fallback chain.
[REAL] src/lib/intelligence/rubric-extractor.ts (103) — real Claude extraction + real Supabase read.
[REAL] src/lib/intelligence/section-extractor.ts (55) — two real Claude calls, silent fallback to {} on parse failure.
[REAL] src/lib/intelligence/unified-search.ts (420) — real fan-out across 9 KB types; per-type fetch swallows errors to [].
[REAL] src/lib/intelligence/sources/bls-api.ts (171) — real BLS Series API calls; hardcoded stale 2022-2023 year defaults.
[REAL] src/lib/intelligence/sources/cdc-api.ts (206) — real CDC Socrata dataset calls, errors swallowed to [].
[REAL] src/lib/intelligence/sources/census-api.ts (171) — real Census ACS5 calls, hardcoded stale 2022 vintage.
[FIXED] src/lib/intelligence/sources/hud-api.ts (~230) — `fetchHomelessCounts` now discovers and parses the real CSV link instead of the HTML page — CRITICAL ISSUE #10 (FIXED 2026-07-03). Other two functions (FMR, affordability) are real.
[REAL] src/lib/intelligence/sources/types.ts (10) — trivial shared interface.

### lib/ai/ + lib/automation/ (24 files)
[REAL] src/lib/ai/claude.ts (96) — genuine Anthropic `.messages.create()` call, model claude-sonnet-4-6, throws if key missing.
[REAL] src/lib/ai/gemini.ts (127) — genuine fetch to Gemini API, model gemini-2.0-flash.
[REAL] src/lib/ai/learning/narrative-scorer.ts (84) — pure deterministic math, no AI by design.
[REAL] src/lib/ai/learning/outcome-analyzer.ts (329) — pure aggregation/ranking, no AI by design.
[REAL] src/lib/ai/learning/pattern-analyzer.ts (157) — real callClaude + robust JSON parsing.
[REAL] src/lib/ai/learning/proven-extractor.ts (171) — real prompt builder + parser, caller invokes callClaude.
[REAL] src/lib/ai/prompts/budget-detail.ts (176) — pure prompt builder, enforces no-fabrication convention.
[REAL] src/lib/ai/prompts/budget-narrative.ts (151) — pure prompt builder, same guardrails.
[REAL] src/lib/ai/prompts/donation-request.ts (128) — pure prompt builder.
[REAL] src/lib/ai/prompts/fit-analysis.ts (177) — pure prompt builder, gates on sample-size sufficiency.
[REAL] src/lib/ai/prompts/grant-narrative.ts (238) — pure prompt builder for 5 template types.
[REAL] src/lib/ai/prompts/opportunity-summary.ts (81) — pure prompt builder, extraction-only.
[REAL] src/lib/ai/prompts/review.ts (105) — pure prompt builder for structured review JSON.
[REAL] src/lib/automation/auto-filler.ts (463) — real Playwright fill logic with screenshot upload + step logging.
[REAL] src/lib/automation/browser-agent.ts (368) — real retry wrapper, challenge-check gate, session pause-on-challenge.
[REAL] src/lib/automation/browser-engine.ts (307) — real Playwright Chromium lifecycle + Storage screenshot handling.
[REAL] src/lib/automation/challenge-detector.ts (209) — real in-page CAPTCHA/MFA/login DOM scan; never auto-solves.
[REAL] src/lib/automation/document-uploader.ts (422) — real download/upload/verify/cleanup pipeline.
[REAL] src/lib/automation/field-mapper.ts (241) — real callClaude form-field mapping, confidence-gated, no fabrication.
[REAL] src/lib/automation/form-detector.ts (627) — real in-browser field detection, two detection paths.
[REAL] src/lib/automation/form-filler.ts (199) — real Playwright fill dispatch; hard rule in code: no submit path exists (the safe stack).
[REAL] src/lib/automation/portal-credentials.ts (161) — real AES-256-GCM+PBKDF2 encryption; hardcoded key-derivation fallback — see CRITICAL ISSUE #5.
[REAL] src/lib/automation/session-manager.ts (355) — real CRUD + status-lifecycle gating; `markAutoSubmitted()` intentionally bypasses approval for semi/autonomous tiers, trusting the upstream gate.
[REAL] src/lib/automation/verification.ts (337) — real 60s DOM-polling loop + Claude confirmation-number extraction.

### lib/email/ + lib/enrichment/ + lib/admin/ (22 files)
[REAL] src/lib/email/contact-extractor.ts (293) — real Claude-assisted contact extraction merging Gmail + AI-parsed body.
[REAL] src/lib/email/encryption.ts (35) — real AES-256-GCM, not plaintext.
[REAL] src/lib/email/gmail-auth.ts (261) — full real OAuth2 flow with HMAC-signed state.
[REAL] src/lib/email/gmail-sync.ts (572) — real full+incremental Gmail sync with 401/429 handling.
[REAL] src/lib/email/sender.ts (233) — real dual-provider send (Gmail API + Resend fallback).
[REAL] src/lib/email/sequence-engine.ts (267) — real Resend-based drip engine.
[REAL] src/lib/email/template-engine.ts (136) — real variable-substitution renderer + Claude template generator.
[REAL] src/lib/email/thread-linker.ts (273) — real 3-tier linker (email→domain→Claude AI).
[REAL] src/lib/enrichment/engine.ts (543) — real batched waterfall orchestrator (IRS990/ProPublica/web-search/scrape).
[REAL] src/lib/enrichment/runner.ts (225) — real CLI wrapper, intended for local machine use, not the web app.
[PARTIAL] src/lib/enrichment/sources/irs990.ts (229) — real XML parser, but depends on a local-only directory — dead on Vercel.
[REAL] src/lib/enrichment/sources/propublica.ts (204) — real ProPublica Nonprofit Explorer client.
[FIXED] src/lib/enrichment/sources/web-search.ts (~185) — real logic; SearXNG now throws if unconfigured instead of defaulting to unreachable localhost, DuckDuckGo fallback unaffected — CRITICAL ISSUE #23 (FIXED 2026-07-03).
[PARTIAL] src/lib/enrichment/sources/website-scraper.ts (249) — real cheerio scraper + Playwright fallback that silently no-ops if unavailable.
[REAL] src/lib/enrichment/types.ts (34) — plain type definitions.
[REAL] src/lib/admin/auth.ts (37) — real single-admin gate via PLATFORM_ADMIN_USER_ID, hardcoded MVP design.
[REAL] src/lib/admin/compliance.ts (109) — real CAN-SPAM engine; hardcoded HMAC fallback secret — see CRITICAL ISSUE #5.
[REAL] src/lib/admin/domain-manager.ts (254) — real Resend domain DNS verification + health scoring + rotation.
[REAL] src/lib/admin/prospect-manager.ts (350) — real CSV importer with suppression/dedup checks.
[FIXED] src/lib/admin/sales-campaign-engine.ts (~530) — real campaign send logic; now advances through all configured steps via `scheduleNextStep()` — CRITICAL ISSUE #9 (FIXED 2026-07-03).
[REAL] src/lib/admin/unsubscribe-agent.ts (232) — real Claude-based reply classifier with suppression/cancellation.
[REAL] src/lib/admin/warmup-engine.ts (165) — real tiered domain warmup state machine.

### lib/utils/ + lib/drafts/ + lib/integrations/ + lib/billing/ + lib/supabase/ + lib/payments/ (23 files)
[REAL] src/lib/utils/branding.ts (54) — loads/merges branding config with sane defaults.
[REAL] src/lib/utils/cn.ts (9) — trivial classname joiner.
[FIXED] src/lib/utils/constants.ts (~405) — pure config/enum module; Stripe `priceEnvVar` names aligned to `.env.local.example` — CRITICAL ISSUE #7 (FIXED 2026-07-03).
[REAL] src/lib/utils/diff.ts (73) — real LCS-based line diff.
[REAL] src/lib/utils/formatters.ts (53) — real date-fns/Intl formatting.
[REAL] src/lib/utils/validators.ts (32) — real email/upload validation.
[REAL] src/lib/drafts/auto-generator.ts (301) — real queue processor with budget-aware batch loop.
[REAL] src/lib/drafts/draft-queue-engine.ts (311) — real Supabase-backed queue population + stats.
[REAL] src/lib/drafts/generator.ts (967) — real callClaude + RAG/rubric/logic-model/budget/compliance augmentation.
[REAL] src/lib/drafts/submission-bridge.ts (327) — real multi-step orchestration with guard checks.
[REAL] src/lib/drafts/template-selector.ts (208) — real rule-based + config-driven selection.
[REAL] src/lib/integrations/google/auth.ts (431) — real OAuth2 flow, AES-256-GCM tokens; fallback key derivation fixed (#5, earlier same day); OAuth state sign/verify now delegates to shared `oauth-state.ts` — CRITICAL ISSUE #22 (FIXED 2026-07-03).
[REAL] src/lib/integrations/google/calendar.ts (419) — real Calendar API v3 calls.
[REAL] src/lib/integrations/google/email-matcher.ts (321) — real contact/outreach/funder matching agent.
[REAL] src/lib/integrations/google/gmail.ts (352) — real Gmail API v1 wrapper.
[REAL] src/lib/billing/tier-enforcer.ts (104) — real 429-returning gate + in-memory rate limiter.
[FIXED] src/lib/billing/usage-limiter.ts (~255) — real per-resource limit checks; conflicting tier numbers reconciled by deriving from `constants.ts`'s `TIER_LIMITS` — CRITICAL ISSUE #16 (FIXED 2026-07-03).
[REAL] src/lib/billing/usage-middleware.ts (53) — thin real wrapper producing 429 upgrade response.
[REAL] src/lib/billing/usage-tracker.ts (341) — real daily/cumulative usage counters.
[REAL] src/lib/supabase/admin.ts (41) — real service-role client construction.
[REAL] src/lib/supabase/client.ts (32) — real browser client.
[REAL] src/lib/supabase/server.ts (54) — real server client with cookie session handling.
[REAL] src/lib/payments/stripe.ts (407) — real Stripe SDK calls: checkout, portal, full webhook handling.

### lib/services/ + lib/hooks/ + lib/calendar/ + lib/platform/ + lib/opportunities/ + lib/audit/ + misc (23 files)
[REAL] src/lib/services/captcha-solver.ts (269) — genuine 2Captcha HTTP integration.
[REAL] src/lib/services/notification-dispatcher.ts (114) — real Resend send + in-app row insert.
[REAL] src/lib/services/tier-gate.ts (82) — real per-tier feature caps.
[REAL] src/lib/hooks/useAlerts.ts (55) — real fetch hook for /api/alerts.
[REAL] src/lib/hooks/useProfile.ts (82) — real Supabase session/profile fetch + role helpers.
[REAL] src/lib/hooks/useUrlState.ts (51) — pure URL search-param sync hook.
[REAL] src/lib/calendar/gcal-auth.ts (267) — full real OAuth2 flow, encrypted tokens; state sign/verify now delegates to shared `oauth-state.ts` instead of its own copy — CRITICAL ISSUE #22 (FIXED 2026-07-03).
[REAL] src/lib/calendar/gcal-sync.ts (369) — real bidirectional Calendar sync.
[REAL] src/lib/calendar/reminder-engine.ts (240) — real 14/30/60-day follow-up scheduler.
[DELETED] src/lib/platform/auth.ts — confirmed zero callers, deleted — CRITICAL ISSUE #25 (FIXED 2026-07-03).
[DELETED] src/lib/platform/role-gate.ts — confirmed zero importers, deleted — CRITICAL ISSUE #25 (FIXED 2026-07-03). The actively-used module remains lib/auth/role-gate.ts.
[REAL] src/lib/opportunities/source-type.ts (149) — pure deterministic regex classifier.
[REAL] src/lib/opportunities/validation.ts (124) — pure two-provider consensus rule.
[REAL] src/lib/audit/client.ts (52) — thin fetch wrappers, best-effort silent catches by design.
[REAL] src/lib/audit/logger.ts (74) — server-only append-only audit insert, silent-by-design.
[REAL] src/lib/reports/board-report.ts (318) — large real Supabase aggregation for board reports.
[REAL] src/lib/navigation/section-memory.ts (76) — sessionStorage-backed nav memory.
[REAL] src/lib/grants/grants-service.ts (244) — real contract→schema mapping layer over opportunities.
[REAL] src/lib/crypto/key-encrypt.ts (52) — genuine AES-256-GCM; insecure zero-padded fallback key — see CRITICAL ISSUE #5.
[REAL] src/lib/auth/role-gate.ts (120) — the actively-used enforcement module (124 importers across API routes).
[REAL] src/lib/analytics/dashboard.ts (591) — large set of pure aggregation functions.
[REAL] src/lib/alerts/alerts-service.ts (85) — pure shared vocabulary consumed by API + UI.
[REAL] src/lib/onboarding.ts (152) — derives step completion from live table counts.
[DELETED] src/components/auth/RoleGate.tsx — confirmed zero importers, deleted — CRITICAL ISSUE #25 (FIXED 2026-07-03).

## PHASE 2 — API ROUTES (src/app/api/**, 168 routes)

### api/agents/ (41 routes)
[FIXED] api/agents/application-cloner (134) — POST; auth Y; real Claude-backed clone; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[REAL] api/agents/automation/[sessionId]/approve (79) — POST; auth Y (admin); maxDuration=300 correct.
[REAL] api/agents/automation/[sessionId] (262) — GET/PUT; auth Y; child-table queries now use the org-validated session object's own id — CRITICAL ISSUE #18 (reviewed/hardened 2026-07-03; child tables have no organization_id column at all, confirmed via live schema).
[REAL] api/agents/automation (137) — POST; auth Y (writer); feature-flag gated; maxDuration=300.
[REAL] api/agents/campaigns/[campaignId] (224) — GET/PUT; auth Y; no AI call, no maxDuration needed.
[PARTIAL] api/agents/campaigns (153) — POST/GET; auth Y; no maxDuration despite triggering per-contact content generation.
[FIXED] api/agents/competitor-intel (139) — POST; auth Y; maxDuration raised 60→300 — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[REAL] api/agents/corporate-research (43) — POST; auth Y; maxDuration=300.
[PARTIAL] api/agents/custom-api (52) — POST; auth Y; only queues a pending row, never executes synchronously — relies on an unseen poller.
[REAL] api/agents/custom-scrape (59) — POST; auth Y; no maxDuration despite potentially-long scrape.
[REAL] api/agents/deadline-prediction (121) — POST; auth Y; deterministic, no AI, maxDuration=60 fine.
[FIXED] api/agents/eligibility (143) — POST; auth Y; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[FIXED] api/agents/email-parser (160) — POST; auth Y; maxDuration raised 60→300 — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[FIXED] api/agents/follow-up (82) — POST; auth Y; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[PARTIAL] api/agents/form-analyzer (129) — POST; auth Y; real, but documented broken on Vercel serverless — CRITICAL ISSUE #14.
[PARTIAL] api/agents/form-filler (127) — POST; auth Y; same Vercel/Chromium constraint as form-analyzer.
[REAL] api/agents/foundation-finder (43) — POST; auth Y; maxDuration=300.
[FIXED] api/agents/funder-intel (124) — POST; auth Y; maxDuration raised 60→300 — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[REAL] api/agents/funder-relationship (129) — POST; auth Y; deterministic, no AI.
[REAL] api/agents/giving-history (121) — POST; auth Y; external API only (ProPublica), no AI, maxDuration=60 fine.
[REAL] api/agents/grants-gov (88) — POST; auth Y; maxDuration=300.
[REAL] api/agents/housing-specific (43) — POST; auth Y; maxDuration=300.
[REAL] api/agents/hud-monitor (59) — POST; auth Y; maxDuration=300.
[REAL] api/agents/keyword-expansion (106) — POST; auth Y; maxDuration=60, short AI call, fine.
[FIXED] api/agents/learning (131) — POST; auth Y; rate-limited + tier quota; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[REAL] api/agents/nofa-parser (65) — POST; auth Y; maxDuration=300.
[FIXED] api/agents/outreach (138) — POST; auth Y; rate-limited; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[REAL] api/agents/playwright (174) — POST; auth Y; human-approval gate before submit; maxDuration=300.
[REAL] api/agents/propublica (89) — POST; auth Y; stateless lookup tool, no DB writes, no AI.
[REAL] api/agents/research-config (29) — POST; auth Y; maxDuration=300.
[PARTIAL] api/agents/research/quality (74) — POST; auth Y; read-only scoring, maxDuration=60 fine.
[REAL] api/agents/research (516) — POST; auth Y; the main trigger — rate limit + tier gate + quota; two auth/gating flows diverge (multi-source flow skips the feature flag check the agentType flow enforces); maxDuration=300.
[REAL] api/agents/research/status (113) — GET only; auth Y (session, read-only, appropriate).
[REAL] api/agents/sam-gov (92) — POST; auth Y; checks SAM_GOV_API_KEY presence first; maxDuration=300.
[FIXED] api/agents/semantic-matching (75) — POST; auth Y; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[REAL] api/agents/simpler-grants (79) — POST; auth Y; maxDuration=300.
[FIXED] api/agents/state-portals (93) — POST; auth Y; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[REAL] api/agents/state-scrapers (44) — POST; auth Y; maxDuration=300.
[REAL] api/agents/success-probability (105) — POST; auth Y; rate-limited; no maxDuration (no AI call, so lower priority than others flagged).
[REAL] api/agents/tdhca (43) — POST; auth Y; maxDuration=300.
[REAL] api/agents/usaspending (48) — POST; auth Y; maxDuration=120.

### api/email/ + api/grants/ (18 routes)
[REAL] api/email/analytics (148) — GET; auth Y; real queries; opened/bounced honestly hardcoded to 0 (no tracking column yet).
[REAL] api/email/auth (26) — GET; auth Y; thin OAuth URL generator.
[REAL] api/email/callback (45) — GET; correctly validates HMAC-signed state param (CSRF-safe).
[REAL] api/email/contacts (104) — GET/POST; auth Y; maxDuration=60.
[FIXED] api/email/link (60) — POST; now requires `writer` role, and gained an `auto: true` branch for one-click thread linking (used by #21's fix) — CRITICAL ISSUE #20 (FIXED 2026-07-03).
[REAL] api/email/send (97) — POST; auth Y (writer); real rate limiting; maxDuration=60.
[REAL] api/email/sequences/[id]/analytics (99) — GET; auth Y; honestly reports missing A/B tracking as empty.
[REAL] api/email/sequences/[id]/enroll (85) — POST; auth Y (writer).
[REAL] api/email/sequences/[id] (163) — GET/PATCH/DELETE; auth Y.
[REAL] api/email/sequences (87) — GET/POST; auth Y.
[REAL] api/email/summarize (69) — POST; auth Y; real Claude call; maxDuration=120, adequate.
[REAL] api/email/sync (50) — POST; auth Y; maxDuration=120.
[REAL] api/email/templates/generate (61) — POST; auth Y (writer); maxDuration=300, correct.
[REAL] api/email/templates (215) — GET/POST/PATCH/DELETE; auth Y.
[REAL] api/email/threads (79) — GET; auth Y.
[REAL] api/grants/[id]/rescore (190) — POST; auth Y (writer); real ownership checks + quota; maxDuration=120.
[REAL] api/grants/[id] (215) — GET/PATCH; auth Y; real contract-field mapping to opportunities table.
[REAL] api/grants (159) — GET; auth Y; real filtered/paginated query.

### api/autoapply/ + api/automation/ (18 routes)
[REAL] api/autoapply/ab-tests (117) — GET/POST/DELETE; auth Y.
[REAL] api/autoapply/agreements/[id] (195) — GET/PUT; auth Y; ownership verified.
[REAL] api/autoapply/agreements (167) — GET/POST; auth Y.
[REAL] api/autoapply/config (70) — GET/POST; auth Y.
[REAL] api/autoapply/controls (190) — GET/POST/DELETE; auth Y.
[REAL] api/autoapply/documents/readiness (19) — GET; auth Y.
[REAL] api/autoapply/documents (71) — GET/POST; auth Y.
[REAL] api/autoapply/profiles/[id] (103) — GET/PUT/DELETE; auth Y.
[REAL] api/autoapply/profiles (164) — GET/POST; auth Y.
[REAL] api/autoapply/queue (96) — POST; auth Y (writer); real tier-based batch cap + dedup.
[REAL] api/autoapply/templates/test (259) — POST; auth Y (writer); real dry-run browser fill; maxDuration=120; broken on Vercel (Chromium constraint).
[REAL] api/autoapply/usage/keys (114) — GET/POST/PATCH; auth Y; keys stored **plaintext** — see CRITICAL ISSUE #6.
[REAL] api/autoapply/usage (21) — GET; auth Y.
[REAL] api/autoapply/webhooks (156) — GET/POST/DELETE; auth Y.
[REAL] api/automation/portal-credentials (87) — GET/POST/DELETE; auth Y; real AES-256-GCM storage.
[REAL] api/automation/process (70) — POST; auth Y (writer); maxDuration=300; confirmed approval-gated, not blind auto-submit.
[REAL] api/automation/queue (361) — GET/POST/PATCH/PUT; auth Y; real priority derivation, tier gating.
[REAL] api/automation/stats (90) — GET; auth Y.

### api/admin/ + api/platform/ + api/audit/ (16 routes)
[REAL] api/admin/audit-log (115) — GET; auth Y (admin).
[REAL] api/admin/autoapply-ops (354) — GET; auth Y (admin); real cross-tenant aggregation, some sub-query errors swallowed silently.
[REAL] api/admin/campaigns/[id] (198) — GET/PATCH/POST; auth Y (admin); real; frontend now calls this correct path — CRITICAL ISSUE #2 (FIXED 2026-07-03).
[REAL] api/admin/campaigns (109) — GET/POST; auth Y (admin); same fix.
[REAL] api/admin/domains/[id] (111) — GET/PATCH/DELETE; auth Y (admin).
[REAL] api/admin/domains (71) — GET/POST; auth Y (admin); frontend's Add Domain form now sends `api_key` (was `resend_api_key`) — CRITICAL ISSUE #2 (FIXED 2026-07-03).
[REAL] api/admin/prospects/[id] (151) — GET/PATCH/DELETE; auth Y (admin); PATCH's `suppressed` field now also used for the frontend's bulk-suppress action (no bulk endpoint exists).
[REAL] api/admin/prospects (118) — GET/POST; auth Y (admin); real CSV import; frontend's import modal now collects the required `list_name`.
[REAL] api/admin/prospects/stats (31) — GET; auth Y (admin); now one of 4 calls backing the page-level stats row.
[FIXED] api/admin/suppression (~85, new) + api/admin/suppression/import (~105, new) — GET/POST/POST; auth Y (admin); added since no admin-facing suppression CRUD existed anywhere — CRITICAL ISSUE #2 (FIXED 2026-07-03).
[REAL] api/admin/sales-analytics/export (121) — GET; auth Y (admin); only place suppression_list is read at all besides the new suppression routes above.
[REAL] api/admin/sales-analytics (254) — GET; auth Y (admin); real heavy aggregation; frontend now maps its actual shape correctly (domain performance shown as bounce rate, the only per-domain rate this endpoint returns) — CRITICAL ISSUE #2 (FIXED 2026-07-03).
[REAL] api/admin/usage (24) — GET; auth Y (admin).
[REAL] api/admin/webhooks/email-events (180) — POST; auth via HMAC svix signature, optional if secret unset.
[REAL] api/admin/webhooks/email-reply (136) — POST; same signature scheme.
[REAL] api/platform/bootstrap (154) — POST; **auth N, no role check at all — CRITICAL ISSUE #1.**
[REAL] api/audit (91) — POST; auth Y (session-derived).

### api/intelligence/ + api/ai/ (20 routes)
[REAL] api/intelligence/benchmarks (28) — GET; auth Y.
[REAL] api/intelligence/briefing (108) — GET; auth Y; maxDuration=300.
[REAL] api/intelligence/budget-patterns (51) — GET; auth Y.
[REAL] api/intelligence/compliance (53) — GET; auth Y.
[REAL] api/intelligence/evaluation (50) — GET; auth Y.
[FIXED] api/intelligence/grant-dna (41) — POST; now `requireRole("writer")` — CRITICAL ISSUE #12 (FIXED 2026-07-03); maxDuration=300.
[REAL] api/intelligence/ingest (155) — POST; auth Y (writer); maxDuration=300.
[FIXED] api/intelligence/logic-model (109) — POST; now `requireRole("writer")`; maxDuration raised 60→300 — CRITICAL ISSUES #12 and #11 (FIXED 2026-07-03).
[REAL] api/intelligence/need-data (164) — GET+POST; auth Y; maxDuration=300.
[REAL] api/intelligence/recommendations (68) — GET; auth Y.
[REAL] api/intelligence/search (79) — GET; auth Y.
[REAL] api/intelligence/stats (78) — GET; auth Y.
[REAL] api/ai/budget (155) — POST; auth Y (writer); maxDuration=300.
[REAL] api/ai/draft/rescore (95) — POST; auth Y; pure heuristic recompute, no Claude call, maxDuration correctly not needed.
[REAL] api/ai/draft (240) — POST; auth Y (writer); maxDuration=300.
[FIXED] api/ai/fit-analysis (276) — POST; auth Y; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[REAL] api/ai/humanize (396) — POST; auth Y; maxDuration=300.
[FIXED] api/ai/review (129) — POST; auth Y; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[FIXED] api/ai/summarize (138) — POST; auth Y; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03).
[FIXED] api/ai/validate (219) — POST; auth Y; maxDuration=300 added — CRITICAL ISSUE #11 (FIXED 2026-07-03). Still makes TWO non-streaming AI calls (Claude+Gemini) per request, unchanged.

### api/integrations/ + api/webhooks/ + api/calendar/ (16 routes)
[REAL] api/integrations/custom-api/[id] (94) — PATCH/DELETE; auth Y (admin).
[REAL] api/integrations/custom-api (141) — GET/POST; auth Y.
[REAL] api/integrations/custom-api/test (93) — POST; auth Y (admin); genuine SSRF-adjacent surface (unrestricted server-side fetch to admin-supplied URL, no allowlist).
[REAL] api/integrations/google/calendar (123) — GET/POST; auth Y.
[REAL] api/integrations/google/calendar/sync (80) — POST; auth Y (writer).
[REAL] api/integrations/google/callback (94) — GET; auth Y; validates state-bound org.
[REAL] api/integrations/google (55) — GET/POST; auth Y.
[REAL] api/integrations/google/sync (151) — POST; auth Y (writer); bounded to 100 messages/sync.
[REAL] api/integrations/keys (129) — GET/POST; auth Y; masked key display; silent fallback on decrypt mismatch.
[REAL] api/integrations/scraping-targets/[id] (86) — PATCH/DELETE; auth Y (admin).
[REAL] api/integrations/scraping-targets (124) — GET/POST; auth Y (admin); tier-limit enforced.
[PARTIAL] api/webhooks/resend (96) — POST; **no real signature verification** despite a comment claiming otherwise — CRITICAL ISSUE #8.
[REAL] api/webhooks/stripe (81) — POST; correctly verifies signature via constructEvent, idempotent.
[REAL] api/calendar/auth (26) — GET; auth Y.
[REAL] api/calendar/callback (56) — GET; auth N (public OAuth redirect, expected); validates signed state.
[REAL] api/calendar/sync (47) — POST; auth Y.

### api/cron/ + api/drafts/ + api/billing/ (18 routes)
[REAL] api/cron/autoapply (107) — GET; cron-secret-gated Y.
[REAL] api/cron/campaigns (113) — GET/POST; cron-secret-gated Y; maxDuration=300.
[REAL] api/cron/domain-warmup (75) — GET; cron-secret-gated Y; maxDuration=120.
[REAL] api/cron/draft-automation (130) — GET/POST; cron-secret-gated Y; maxDuration=300, correct.
[REAL] api/cron/draft-queue-check (110) — GET/POST; cron-secret-gated Y; maxDuration=120, appropriate (no generation).
[REAL] api/cron/email-sequences (38) — GET/POST; cron-secret-gated Y; maxDuration=120.
[REAL] api/cron/follow-ups (27) — GET; cron-secret-gated Y; maxDuration=60.
[REAL] api/cron/reminders (326) — GET/POST; cron-secret-gated Y; maxDuration=300.
[REAL] api/cron/research (392) — GET/POST; cron-secret-gated Y; maxDuration=300, correct; richest cron route.
[REAL] api/cron/sales-sends (31) — GET; cron-secret-gated Y; maxDuration=120.
[REAL] api/drafts/queue/[id] (326) — GET/PATCH/DELETE; auth Y; full action state machine.
[REAL] api/drafts/queue/config (150) — GET/PATCH; auth Y.
[REAL] api/drafts/queue (169) — GET/POST; auth Y (writer).
[REAL] api/drafts/queue/stats (21) — GET; auth Y.
[REAL] api/drafts/queue/trigger (34) — POST; auth Y (writer); maxDuration=300, batch-capped to fit budget.
[REAL] api/billing/check-gate (48) — GET; auth Y.
[REAL] api/billing (194) — GET/POST; auth Y (owner-only, correctly enforced).
[REAL] api/billing/usage (21) — GET; auth Y.

### Remaining small routes (21 routes)
[REAL] api/users/accept (179) — POST; auth N (public, token-bearer by design); org/role from server-side invitation row, rolls back orphaned auth user on failure.
[REAL] api/users/invite (212) — POST; auth Y (admin); org-scoped, blocks admin-inviting-owner, quota-checked.
[REAL] api/users (189) — GET/PUT/DELETE; auth Y; blocks self-role-change and admin-touching-owner.
[REAL] api/outreach/humanize-step (89) — POST; auth Y.
[REAL] api/outreach/send (346) — POST; auth Y; real 24h/50-day-limit enforcement.
[REAL] api/onboarding/generate-narratives (104) — POST; auth via header (set by middleware); real Claude call.
[REAL] api/onboarding (467) — GET/POST; auth via header; idempotent 7-step wizard logic.
[REAL] api/documents/assemble (243) — POST; auth Y; real ZIP assembly + signed URL.
[REAL] api/documents/quota (71) — POST; auth Y; server-side quota gate.
[REAL] api/compliance/check (115) — POST; auth Y (writer).
[REAL] api/compliance (118) — GET; auth Y; honest read-only aggregation, no fake table.
[REAL] api/auth/callback (44) — GET; OAuth code exchange, idempotent org registration.
[REAL] api/auth/log-event (71) — POST; auth Y; real audit entry with IP/UA.
[REAL] api/unsubscribe (123) — GET/POST; intentionally unauthenticated; correct HMAC-SHA256 signed token, not a raw id.
[REAL] api/settings/integrations/status (15) — GET; auth Y; narrowly scoped to Resend-key presence only.
[REAL] api/reports/board (468) — POST; auth Y; full real pipeline (Claude + humanizer + PDF + Storage).
[REAL] api/notifications (99) — GET/POST; auth Y.
[FIXED] api/nav-counts (61) — GET; now filters all 4 queries by `organization_id` from the `x-organization-id` header — CRITICAL ISSUE #17 (FIXED 2026-07-03).
[REAL] api/funders/import (253) — POST; auth Y (writer); real CSV parser + batch insert.
[REAL] api/deadlines/check (246) — GET/POST; dual-mode auth (cron secret or session); deterministic, no AI.
[REAL] api/alerts (259) — GET; auth Y; real signal-based alert regeneration.

## PHASE 3 — DASHBOARD PAGES (src/app/(dashboard)/**, 75 pages)

### AutoApply + Draft Generator + Billing (19 pages)
[REAL] autoapply/[sessionId] (688) — real session detail/steps/screenshots, fully wired approve/reject/resume.
[REAL] autoapply/agreements (812) — real fetch + Supabase joins.
[REAL] autoapply/analytics (901) — real client-side aggregation from live tables.
[REAL] autoapply/automation-settings (501) — real Supabase writes.
[REAL] autoapply/compliance (500) — real read/write + labeled static reference table.
[REAL] autoapply/controls (627) — all endpoints exist, fully wired.
[REAL] autoapply/documents (578) — real upload/readiness flow.
[FIXED] autoapply/follow-ups (845) — all 4 routes exist and the backing `autoapply_follow_ups` table is now live in production (migration 065) — CRITICAL ISSUE #3 (fully FIXED 2026-07-03).
[REAL] autoapply/page.tsx (739) — real queue/template reads + real agent routes.
[REAL] autoapply/profiles (1573) — full 5-step wizard, real writes.
[REAL] autoapply/recordings (656) — real Storage-backed recordings list.
[REAL] autoapply/settings (648) — real config + real queue-now action.
[REAL] autoapply/templates (1425) — real CRUD + real dry-test.
[REAL] autoapply/usage (738) — real usage/tier reads + real BYO-key save (see CRITICAL ISSUE #6 for the plaintext-storage concern).
[REAL] autoapply/webhooks (443) — real CRUD; intentional no-cors test-send.
[REAL] draft-generator/[id] (373) — real save/regenerate/rescore flow.
[REAL] draft-generator/page.tsx (1159) — extensive real generation/version/revert flow; "Email draft" intentionally disabled pending Gmail connection (not a bug).
[REAL] draft-generator/queue (1039) — real full queue action set.
[REAL] billing/page.tsx (347) — real plan/usage/invoice/checkout flow, owner-gated.

### Settings + Admin + Knowledge Base + misc (16 pages)
[REAL] settings/branding (705) — real direct-Supabase CRUD.
[REAL] settings/custom-apis (828) — all called routes exist.
[REAL] settings/integrations (1249) — all called routes exist; mixes 3 persistence mechanisms (documented as a maintenance-risk pattern, see CRITICAL ISSUE #2's class of bug).
[REAL] settings/page.tsx (1060) — real team/usage/flags management.
[REAL] settings/scraping (571) — all called routes exist.
[REAL] admin/audit-log (379) — real filtered/exported entries.
[REAL] admin/autoapply-ops (707) — real live-charted ops dashboard.
[FIXED] admin/sales-outreach (~1250) — rewritten to call the real `/api/admin/*` paths with reconciled response shapes; New Campaign form and CSV import expanded to match the real backend's required fields — CRITICAL ISSUE #2 (FIXED 2026-07-03).
[REAL] onboarding/page.tsx (1477) — real 7-step wizard.
[REAL] knowledge-base/answers (244) — real direct-Supabase CRUD.
[REAL] knowledge-base/narratives/[id] (29) — thin wrapper, real logic lives in NarrativeDetail.tsx (494 lines, confirmed real).
[REAL] knowledge-base/narratives (374) — real CRUD + proven-narrative scoring.
[REAL] knowledge-base/page.tsx (251) — real overview stats.
[REAL] knowledge-base/profile (27) — thin wrapper, real logic in ProfileEditor.tsx (1131 lines, confirmed real).
[REAL] research/page.tsx (892) — all called agent routes exist; manual SOURCE_ROUTE_MAP is the same fragile pattern that produced the sales-outreach bug — worth linting.
[REAL] dashboard/page.tsx (368) — real server-component live metrics.

### Intelligence + Funders + Email (14 pages)
[REAL] intelligence/competitors (457) — fully wired, real feature-flag gating.
[REAL] intelligence/matches (161) — real agent call + render.
[REAL] intelligence/page.tsx (5) — pure redirect.
[FIXED] intelligence/recommendations (274) — real fetch; "Add to Funders" now inserts a real `funders` row — CRITICAL ISSUE #21 (FIXED 2026-07-03).
[REAL] intelligence-library/dashboard (780) — real direct-Supabase aggregation across 6 tables.
[REAL] intelligence-library/page.tsx (692) — real tabbed CRUD/search.
[PARTIAL] funders/[id] (28) — thin wrapper; real logic in FunderDetail.tsx (~1400 lines, confirmed real agent-backed).
[REAL] funders/import (608) — real 4-step CSV wizard.
[PARTIAL] funders/new (36) — thin wrapper around FunderForm.tsx, which writes directly to Supabase (bypasses any API layer/validation route — functional but inconsistent with funders/import's server-side path).
[REAL] funders/page.tsx (202) — real reads + real AutoApply queue action.
[REAL] email/campaigns/[id] (464) — fully wired.
[REAL] email/campaigns/page.tsx (783) — fully wired 4-pane wizard.
[FIXED] email/page.tsx (595) — Email Hub, fully functional; "Link" button now calls a real auto-link action — CRITICAL ISSUE #21 (FIXED 2026-07-03).
[REAL] email/templates (664) — full CRUD + AI generation, fully wired.

### Applications + Contacts + Outreach + Opportunities (17 pages)
[REAL] applications/[id] (29) — thin wrapper, real logic in ApplicationDetail.tsx (864 lines, confirmed real).
[REAL] applications/list (201) — real pipeline fetch.
[REAL] applications/new (173) — real inserts.
[REAL] applications/page.tsx (149) — real table/kanban toggle over live data.
[REAL] contacts/[id] (28) — thin wrapper, real logic in ContactDetail.tsx (366 lines, confirmed real).
[REAL] contacts/new (40) — real form.
[REAL] contacts/page.tsx (120) — real joins.
[REAL] outreach/campaigns/[id] (717) — real API + direct-Supabase mixed writes, both functional.
[REAL] outreach/campaigns/page.tsx (325) — real listing/aggregation.
[REAL] outreach/page.tsx (231) — real cold-outreach feature, confirmed distinct from admin Sales Outreach.
[REAL] opportunities/[id] (28) — thin wrapper, real logic in OpportunityDetail.tsx (1277 lines, confirmed real).
[REAL] opportunities/new (36) — real form wrapper.
[REAL] opportunities/page.tsx (150) — real joined list/search.
[REAL] search-profiles/configure (5) — re-exports a confirmed-real 1122-line config component.
[REAL] search-profiles/page.tsx (699) — real CRUD, enforces the 10-active-profile cap.
[REAL] outcomes/analytics (447) — real multi-table render, no mocks.
[REAL] outcomes/page.tsx (325) — real eligible-application computation + real outcome recording.

### Remaining small dashboard pages (9 pages)
[REAL] reports/page.tsx (257) — real PDF-generation flow.
[FIXED] renewals/page.tsx (290) — `/api/renewals` now exists, org-scoped and joined to opportunities/funders/applications — CRITICAL ISSUE #4 (FIXED 2026-07-03).
[REAL] notifications/page.tsx (326) — fully wired.
[REAL] foundations/page.tsx (628) — real direct-Supabase search/import.
[REAL] follow-ups/page.tsx (259) — real read from notes-table workaround, populated by the follow-up-generator agent.
[REAL] financials/page.tsx (460) — real client-side aggregation.
[REAL] documents/page.tsx (151) — real parallel loads, role-gated.
[REAL] deadlines/page.tsx (975) — largest page audited; all called routes exist, fully wired including Google Calendar sync.
[REAL] alerts/page.tsx (453) — real hook-backed CRUD.

## PHASE 5 — CROSS-CUTTING FINDINGS

### Auth flow
`src/middleware.ts` protects every route except a small public allowlist (`/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/api/auth/*`, `/invite*`, `/api/users/accept`) — requires a valid session + resolvable profile with organization_id/role, injected as `x-user-id`/`x-organization-id`/`x-user-role` headers. Server-side second barrier is `requireRole()` in `src/lib/auth/role-gate.ts`, which re-derives the profile per request rather than trusting headers — good defense in depth. The one real gap found: `api/platform/bootstrap` (CRITICAL ISSUE #1) sits behind middleware's mandatory session check but has no role check inside the handler at all. All OAuth callbacks and cron routes without an explicit `requireRole` call were confirmed to have an equivalent guard (HMAC-signed state params, or CRON_SECRET bearer check) — no other gaps found.

### RLS / org scoping
39 routes use the service-role (RLS-bypassing) admin client. Every user-facing one spot-checked explicitly filters by `organization_id` derived server-side from the caller's profile — consistent pattern across email, grants, calendar, drafts, users routes. Two soft findings, both already listed above: `api/agents/automation/[sessionId]` scopes child tables by session_id only (#18), and `api/nav-counts` has no explicit org filter on any query (#17), relying solely on RLS. Admin/cron/webhook routes intentionally query cross-org by design (platform dashboards, batch jobs) — not a leak.

### Environment variable inventory
Confirmed in both `.env.local` and `.env.local.example`: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.
In example only (not confirmed in local env — this repo's `.env.local` has only 6 keys total): `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `INTEGRATION_ENCRYPTION_KEY`, `NEXT_PUBLIC_SITE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
In local only: `SAM_GOV_API_KEY`.
**Referenced in code but in NEITHER file — cannot verify set anywhere**: `AUTOAPPLY_EMAIL`, `BLS_API_KEY`, `BMF_URL`, `CDC_APP_TOKEN`, `CENSUS_API_KEY`, `CREDENTIAL_ENCRYPTION_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `HUD_API_KEY`, `INTEGRATION_KEY_SECRET`, `IRS_990_XML_DIR`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_WORKER_URL`, `PLATFORM_ADMIN_USER_ID`, `PLATFORM_OWNER_EMAIL`, `PORTAL_ENCRYPT_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_DOMAIN`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `SEARXNG_URL`, `STORAGE_DOCUMENTS_BUCKET`, `STORAGE_REPORTS_BUCKET`, `STRIPE_PRICE_STARTER/PROFESSIONAL/ENTERPRISE/CONSULTANT`, `SUPABASE_URL` (bare), `TWOCAPTCHA_API_KEY`, `UNSUBSCRIBE_HMAC_SECRET`.
Two concrete naming mismatches: `STRIPE_PRICE_*` vars in code vs `STRIPE_*_PRICE_ID` in the example file (CRITICAL ISSUE #7); `NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL` used interchangeably in different files for what should be one variable.

### Encryption audit
Every credential/token store found is genuinely AES-256-GCM encrypted (Google OAuth tokens, portal automation credentials, funder credentials, custom API keys) — not base64/plaintext. Four hardcoded fallback-key/secret issues found, detailed in CRITICAL ISSUE #5 — **all four fixed 2026-07-03** (now throw instead of falling back; env vars still need confirming in Vercel). One dead-code landmine found: `usage-meter.ts`'s unused `shouldUseOwnKeys()` returns ciphertext without decrypting (CRITICAL ISSUE #6, not yet fixed).

### Swallowed errors in API routes
Swept ~140 empty/near-empty catch sites across `src/app/api`. **No route was found where a genuine action failure is silently swallowed while the route still returns a success response.** All empty catches are either proper error-returning guards, or explicitly-documented best-effort/fire-and-forget side effects (e.g. a non-fatal notification insert) that don't misrepresent the primary action's outcome.

### Secrets scan
Grepped for live-looking API key patterns (`sk-`, `sk_live`, `AIza`, `ghp_`, etc.) across all of `src/`. **No hardcoded live credentials found.** Only false positives: a UI placeholder string `"sk-ant-…"` in an input field, and unrelated CSS/comment text matches.

## HISTORICAL CONTEXT (carried forward from prior sessions)

### FORGE Build History
- Chain 1 (34/34 passed) — Email/Calendar, Sales Outreach, Tests
- Chain 2 (41/46 passed) — Platform Admin backend, Draft Automation, UI Polish, Enrichment (partial)
- Chain 3 (34 prompts, verified complete) — Enrichment remainder, Intelligence Library, Scrapers/Infrastructure

### Migrations Applied to Production (054-065)
054-064 applied to vbjplpquqxxfbpazyalt on 2026-06-22: 054 email_calendar_integration+funders_contact_email, 055 admin_sales_outreach+sequence_enrollment_variables, 056 four_tier_admin_system, 057 draft_automation_pipeline, 058 backfill_opportunity_deadlines+lead_enrichment_system, 059 budget_patterns, 060 grantmaker_profiles, 061 corporate_giving_targets, 062 community_foundations, 063 white_label, 064 drop orphaned email_threads/email_messages tables. (Confirmed live via this session's schema query: 104 tables total, before 065.)
065 `autoapply_follow_ups` applied 2026-07-03 (same day as the audit-fix batch) — creates the table CRITICAL ISSUE #3 was blocked on, with RLS + 3 org-scoped policies. Now 105 tables live.

### Platform Owner
Bootstrapped: info@faithfoundation.org as platform_owner with 19 permissions via `/api/platform/bootstrap`. **CRITICAL ISSUE #1 is now FIXED (2026-07-03) — the endpoint self-disables (403) now that a platform_owner row exists, so it can no longer be used to self-grant platform_owner.**

### Other known items
- Visual: input/textarea boxes reported elongated across platform — UI polish queue passed compile but visual results unverified (not covered by this audit — no visual/screenshot testing was performed).
- Data: Intelligence library has 11 records, foundation_directory has 133K hollow records, 298K prospects not imported (unverified this session — would need a live data audit, not a code audit, to confirm current counts).

## Technical State
- Stack: Next.js 14, Supabase, Vercel Pro, TypeScript, pnpm
- Routes: 168 API routes + 75 dashboard pages confirmed via this audit (220+ total including marketing/auth pages)
- Tests: Vitest 161 passed / 0 failed / 13 todo; Playwright 86 tests / 28 files (post config-fix), full suite not yet run end-to-end this session
- AutoApply: core approval-gated flow real and working via `api/automation/process`; Playwright-dependent routes (form-analyzer, form-filler, templates/test) need a worker process not currently deployed to Railway
