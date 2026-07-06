# BENAVORA — SESSION STATE
## Last updated: 2026-07-06
## Current branch: main
## Last commit: 855f192c4368fecc97429cfcf2e86a5ca68962c8
## Commit message: fix: wire sessionId to form-filler approval gate, fix migration 045 RLS policies

---

## COMPLETED — July 3 audit session

### Earlier in session: test/build gate + nav/config fixes
- Added Email nav entry (`src/components/layout/nav-items.ts`) — /email now reachable from the sidebar
- Fixed `playwright.config.ts` testIgnore to stop scanning `.claude/worktrees/*` (was inflating suite from ~24 real specs to 1110)
- Fixed stale `tests/smoke.spec.ts` and `tests/e2e/public/login-theme.spec.ts` to match current landing copy
- Fixed Node 20 WebSocket blocker — polyfilled `globalThis.WebSocket` with `ws` in `tests/e2e/helpers.ts`
- Confirmed gates: Vitest 161 passed / 0 failed · tsc --noEmit 0 errors · pnpm build clean

### Deep operational audit (27 parallel sub-agents + live schema query)
- Read every file in `src/lib/**` (213 files), `src/app/api/**` (168 routes at the time), `src/app/(dashboard)/**` (75 pages) — zero sampling
- Queried live production schema: 104 tables, 1331 columns confirmed
- Cross-cutting sweep: auth flow, RLS/org-scoping, env vars, encryption, swallowed errors, hardcoded secrets

### Security fixes (committed individually)
- **commit ae058c9** — `api/platform/bootstrap` now self-disables (403) once a platform_owner exists; previously had zero role check
- **commit e29bd6f** — 4 hardcoded fallback encryption/HMAC secrets now throw instead of using weak/known keys; all 4 env vars set in Vercel production
- **commit c7704b6** — BYO API keys encrypted at rest (AES-256-GCM); `shouldUseOwnKeys()` fixed to read the correct table
- **commit 74be491** — Resend webhook now does real Svix-format HMAC-SHA256 verification; fails closed

### Batch fix — 21 remaining audit findings (commit a03a0e3)
1. Sales Outreach page — rewritten to call real `/api/admin/*` routes; suppression CRUD added (GET/POST /api/admin/suppression + import)
2. AutoApply Follow-Ups — 4 missing routes created + `sendSingleFollowUp()` extracted for reuse
3. Renewals route — `GET /api/renewals` created, org-scoped, joined to opportunities/funders/applications
4. Stripe env var naming — aligned code to `.env.local.example` convention
5. Campaign multi-step — `scheduleNextStep()` now advances sequences past step 1
6. HUD homeless-count fetcher — now discovers and parses the real CSV link instead of misparsing HTML
7. maxDuration=300 — added/corrected on 15 AI-calling routes (eligibility, application-cloner, follow-up, learning, outreach, semantic-matching, state-portals, competitor-intel, email-parser, funder-intel; ai/fit-analysis, ai/review, ai/summarize, ai/validate; intelligence/logic-model)
8. requireRole gates — added to `grant-dna` and `logic-model`
9. `form-analyzer-agent.ts` stub — replaced with real Claude-based analyzer logic
10. form-filler approval gate — `fillAndSubmit()` now requires an approved automation_sessions row before submitting
11. Tier-limit conflict — `usage-limiter.ts` derives from `constants.ts`'s `TIER_LIMITS` (one authoritative source)
12. nav-counts org filter — `organization_id` filter added to all 4 count queries
13. `automation/[sessionId]` child-table queries — use the org-validated session's own id (those tables have no `organization_id` column)
14. Texas registration data — `generallyRequired` flag added; TX no longer contradicts its own notes
15. `email/link` role — now requires `writer`, not `viewer`
16. Dead buttons — Email Hub "Link" auto-links thread; "Add to Funders" inserts real funders row
17. Dual Calendar OAuth — HMAC state-signing extracted to shared `oauth-state.ts`; both flows confirmed not true duplicates
18. SearXNG — throws if `SEARXNG_URL` unset; DuckDuckGo fallback unaffected
19. Dead code — deleted `lib/platform/auth.ts`, `lib/platform/role-gate.ts`, `components/auth/RoleGate.tsx`

### Migration 065 — autoapply_follow_ups (commit 1121c5a)
- `autoapply_follow_ups` table did not exist in production (confirmed via live schema query — zero results for the table or anything matching `%follow%`)
- `follow-up-scheduler.ts` had been non-functional in production all along as a result
- Created `supabase/migrations/065_autoapply_follow_ups.sql`: 13 columns, FKs to organizations/autoapply_submissions/funders (ON DELETE CASCADE), status and template_type check constraints, RLS enabled with 3 org-scoped policies using the profiles-derived pattern (NOT organization_members, which doesn't exist in this schema)
- Applied to production via Supabase Management API; verified live (13/13 columns, relrowsecurity=true, 3 policies)
- AutoApply Follow-Ups now fully functional end-to-end

### Migration 066 + worker fix (commit 855f192)
- Discovered all 12 RLS policies on `form_templates`/`autoapply_submissions`/`submission_queue` (from migration 045) referenced a nonexistent `organization_members` table — confirmed live (`to_regclass('public.organization_members')` returns null)
- These 3 tables are queried by real user-facing routes (`GET/POST /api/autoapply/queue`, `POST /api/autoapply/templates/test`, `GET /api/autoapply/profiles`) — all broken for real users
- Created and applied `supabase/migrations/066_fix_autoapply_rls_policies.sql` — drops and recreates all 12 policies using the correct `profiles.organization_id` pattern (matching migration 020)
- Fixed `worker/queue-processor.ts` to create and approve a real `automation_sessions` row per submission before calling `fillAndSubmit()`, and finalize it to `submitted`/`failed` afterward — the approval gate added to `fillAndSubmit()` would have silently disabled the worker's entire autonomous-submission path without this fix
- Found but did NOT fix: `session-manager.ts`'s `markAutoSubmitted()` writes a non-uuid string into the uuid `approved_by` column — pre-existing issue in a separate, already-shipped file; flagged in STATE_OF_THE_BUILD.md

---

## PENDING — as of 2026-07-06

### Production-blocking
- [ ] **Set `RESEND_API_KEY` in Vercel production** — outbound email (campaigns, follow-ups, digests) is non-functional without it
- [ ] **Set `RESEND_WEBHOOK_SECRET` in Vercel production** — inbound webhook 500s on every Resend event without it
- [ ] **Set Stripe Price ID vars in Vercel** (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PROFESSIONAL_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`, `STRIPE_CONSULTANT_PRICE_ID`) — tier billing selection unconfigured
- [ ] **Deploy Railway worker** — AutoApply Playwright routes (form-analyzer, form-filler, templates/test) need a Chromium worker process; none is deployed

### Code / low-priority fixes
- [ ] Fix `session-manager.ts` `markAutoSubmitted()` writing non-uuid to `automation_sessions.approved_by` (uuid column)
- [ ] Pull new env vars to local `.env.local` (`vercel env pull .env.local`) — 4 encryption vars missing locally
- [ ] Consolidate `NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL` (used interchangeably)
- [ ] Add maxDuration to `api/agents/campaigns` and `api/agents/custom-scrape`
- [ ] Add SSRF allowlist or admin-only gate to `api/integrations/custom-api/test`
- [ ] Fix `compliance-library.ts` dead branch: `omb-a133-threshold` check always returns 'pass'
- [ ] Implement `ingest-nih-proposals.ts` (currently a stub returning fake success)
- [ ] Visual: verify/fix elongated input/textarea boxes reported across the platform

### Informational (no fix needed short-term)
- `grants-gov.ts` uses legacy `apply07.grants.gov` REST API — confirm upstream hasn't deprecated it
- Census (2022 vintage) and BLS (2022–2023) data sources are stale; self-labeled as approximations
- state-portal.ts covers Texas only; `PORTAL_REGISTRY` is effectively a single-state registry
- Hardcoded URL lists in corporate-scraper, foundation-finder, state-scrapers will go stale without monitoring

---

## ENVIRONMENT

| Item | Value |
|---|---|
| Supabase | vbjplpquqxxfbpazyalt — 105 tables, migrations 001–066 applied |
| Vercel | benavora.vercel.app (Pro) |
| Platform owner | info@faithfoundation.org (19 permissions) |
| Encryption vars in Vercel | INTEGRATION_KEY_SECRET · PORTAL_ENCRYPT_SECRET · INTEGRATION_ENCRYPTION_KEY · UNSUBSCRIBE_HMAC_SECRET — all set, Encrypted, Production only |
| Local .env.local | Missing those 4 encryption vars; only 6 vars total locally |
