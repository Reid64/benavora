# BENAVORA — Session State
## Current Session: Deep Operational Audit
## Date: 2026-07-03
## Mode: Manual (Claude Code + Claude.ai)
## Status: Full exhaustive audit complete (456 files, live schema, cross-cutting security sweep) AND all 25 findings from that audit are now FIXED or explicitly resolved — 4 security fixes committed individually, then all 21 remaining findings fixed in one batch. See STATE_OF_THE_BUILD.md for the full report, per-issue detail, and two flagged items needing a follow-up decision (below).

## Completed This Session (2026-07-03)

### Earlier: test/build gate + nav/config fixes
- [x] Ran full test/build gate: vitest (161 passed, 0 failed), tsc --noEmit (0 errors), pnpm build (clean)
- [x] Added Email nav entry (src/components/layout/nav-items.ts) — /email now reachable from the sidebar
- [x] Fixed playwright.config.ts testIgnore (stops scanning .claude/worktrees/*, was inflating suite from ~24 real specs to 1110)
- [x] Fixed stale tests/smoke.spec.ts and tests/e2e/public/login-theme.spec.ts to match current landing copy/theme
- [x] Fixed Node 20 WebSocket blocker — polyfilled globalThis.WebSocket with `ws` in tests/e2e/helpers.ts

### This session: Deep Operational Audit (27 parallel sub-agents + live schema query)
- [x] Read every file in src/lib/** (213 files), src/app/api/** (168 routes), src/app/(dashboard)/** (75 pages) — zero sampling
- [x] Queried live production schema via Supabase Management API: 104 tables, 1331 columns confirmed
- [x] Cross-cutting sweep: auth flow trace, RLS/org-scoping, env var inventory, encryption audit, swallowed-errors sweep, hardcoded-secrets scan
- [x] Full report written to STATE_OF_THE_BUILD.md (replaces prior content) — see that file for the complete file-by-file breakdown, 25 ranked findings, and per-feature readiness ratings

## CRITICAL — FIXED
- [x] **`/api/platform/bootstrap` had zero auth/role check** — fixed 2026-07-03 (commit `ae058c9`): the route now checks for an existing `platform_role='platform_owner'` row first and returns `403 {error: "Bootstrap already completed. Platform owner exists."}` if one exists, before doing anything else. Since the owner (info@faithfoundation.org) was already bootstrapped, the route is now effectively self-disabled in production. Verified via `tsc --noEmit` (0 errors).
- [x] **4 hardcoded fallback encryption/HMAC secrets** — fixed 2026-07-03 (commit `e29bd6f`): `key-encrypt.ts` (INTEGRATION_KEY_SECRET), `portal-credentials.ts` (PORTAL_ENCRYPT_SECRET, dropped the NEXTAUTH_SECRET fallback too — confirmed unused elsewhere), `google/auth.ts` (INTEGRATION_ENCRYPTION_KEY), `admin/compliance.ts` (UNSUBSCRIBE_HMAC_SECRET) now all throw `"Missing required env var: <NAME>..."` instead of silently using a weak/known key. Verified via `tsc --noEmit` (0 errors).
- [x] **All 4 guard env vars now set in Vercel production** — done 2026-07-03: generated 4 independent 32-byte (256-bit) secrets via `[System.Security.Cryptography.RandomNumberGenerator]` (not `Get-Random`, which isn't cryptographically secure) and added each via `vercel env add <NAME> production --value <key> --sensitive --yes`. Confirmed present via `vercel env ls production`: `INTEGRATION_KEY_SECRET`, `PORTAL_ENCRYPT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `UNSUBSCRIBE_HMAC_SECRET` — all `Encrypted`, Production only. Raw values were never echoed to any output/transcript (only confirmation of success was surfaced). **Still outstanding**: these 4 vars are NOT yet in local `.env.local`, so local dev will still throw on Google OAuth connect, portal-credential save, custom API key add, and unsubscribe-link generation until pulled/added locally (e.g. `vercel env pull .env.local` or set manually) — not done this session, wasn't asked for.
- [x] **BYO Anthropic/OpenAI keys were stored plaintext** — fixed 2026-07-03 (commit `c7704b6`): `POST /api/autoapply/usage/keys` now encrypts the key with `encryptKey()` (AES-256-GCM) before storing in `platform_config`; `GET` now decrypts server-side and returns only a masked `****last4` hint (`anthropic_key_hint`/`openai_key_hint`), never the full key. Confirmed via a production read (no values fetched) that no org had actually saved a key yet, so no plaintext-to-encrypted migration was needed. Also fixed `shouldUseOwnKeys()` in `usage-meter.ts`, which was querying the wrong table (`integration_keys`, filtered on enum values that don't exist there) instead of `platform_config` where the route actually writes — the BYO-keys feature was two disconnected code paths before this fix and can now work end-to-end. Verified via `tsc --noEmit` (0 errors).
- [x] **Resend webhook had no real signature verification** — fixed 2026-07-03 (commit `74be491`): `api/webhooks/resend/route.ts` now does real Svix-format HMAC-SHA256 verification (svix-id/svix-timestamp/svix-signature headers, ±300s tolerance, timingSafeEqual comparison), reusing the same manual-HMAC pattern already used in `admin/webhooks/email-events`/`email-reply`. Fails closed: `500` if `RESEND_WEBHOOK_SECRET` is unset, `401` on bad signature — never silently accepts an unsigned payload like the old code did. `svix` npm package is not installed; this uses the equivalent manual algorithm per instruction not to add the dependency. Verified via `tsc --noEmit` (0 errors). **⚠️ Immediate impact**: confirmed via `vercel env ls production` that neither `RESEND_WEBHOOK_SECRET` nor `RESEND_API_KEY` are set in Vercel prod at all — this webhook will 500 on every real event until the secret is set, and Resend outbound sending itself may not be configured in production either (pre-existing gap, not caused by this fix).

## Batch fix — all 21 remaining audit findings (2026-07-03)
Fixed in one pass, verified with `tsc --noEmit` (0 errors) and `pnpm run build` (clean), committed together. Full per-issue detail in STATE_OF_THE_BUILD.md; summary:
- [x] **#2 Sales Outreach page** — rewritten to call the real `/api/admin/*` routes with reconciled response shapes; New Campaign form expanded to collect the real backend's required fields (list ID, sending domains, send window/timezone, first step); prospect CSV import now collects `list_name`; bulk-suppress uses per-prospect PATCH calls (no bulk endpoint exists); added new `GET/POST /api/admin/suppression` + `POST /api/admin/suppression/import` since no admin suppression CRUD existed anywhere.
- [x] **#3 AutoApply Follow-Ups routes** — created all 4 missing routes + extracted `sendSingleFollowUp()` for reuse. The backing `autoapply_follow_ups` table didn't exist in production (confirmed via live schema query) — resolved same day, see "Migration 065" below. Fully functional now.
- [x] **#4 Renewals route** — created `GET /api/renewals`, org-scoped, joined to opportunities/funders/applications.
- [x] **#7 Stripe env var naming** — aligned code to `.env.local.example`'s convention (no live config existed either way, so zero risk either direction).
- [x] **#9 Sales campaign multi-step** — `scheduleNextStep()` now advances sequences past step 1.
- [x] **#10 HUD homeless-count fetcher** — now discovers and parses the real CSV link instead of misparsing the HTML landing page.
- [x] **#11 maxDuration=300** — added/corrected on all 15 flagged AI-calling routes.
- [x] **#12 requireRole gates** — added to `grant-dna` and `logic-model`.
- [x] **#13 form-analyzer-agent.ts stub** — replaced with a real port of the Claude-based analyzer logic.
- [x] **#15 form-filler approval gate** — `fillAndSubmit()` now requires an `approved` automation session before submitting. **Side effect**: `worker/queue-processor.ts`'s existing call site doesn't pass a `sessionId`, so it will now always block until that worker call is updated to supply one.
- [x] **#16 tier-limit conflict** — `usage-limiter.ts`'s `RESOURCE_LIMITS` now derives from `constants.ts`'s `TIER_LIMITS` instead of a second hardcoded (and lower) set.
- [x] **#17 nav-counts org filter** — added `organization_id` filter to all 4 count queries.
- [x] **#18 automation/[sessionId] org cross-check** — child-table queries now use the already org-validated session's own id (confirmed those tables have no organization_id column to filter on directly).
- [x] **#19 Texas registration data** — added a `generallyRequired` flag; TX no longer contradicts its own notes.
- [x] **#20 email/link role** — now requires `writer`, not `viewer`.
- [x] **#21 dead buttons** — Email Hub "Link" now auto-links a thread for real; "Add to Funders" now inserts a real `funders` row.
- [x] **#22 dual Calendar OAuth** — confirmed NOT true duplicates (different data models); extracted only the genuinely-duplicated HMAC state-signing primitive into a shared `oauth-state.ts`.
- [x] **#23 SEARXNG_URL** — throws if unset instead of defaulting to unreachable localhost; DuckDuckGo fallback unaffected.
- [x] **#25 dead code deletion** — deleted `lib/platform/auth.ts`, `lib/platform/role-gate.ts`, `components/auth/RoleGate.tsx` after re-confirming zero real importers.

## Migration 065 — autoapply_follow_ups (2026-07-03, same day follow-up)
- [x] Read all 4 new follow-ups routes + `follow-up-scheduler.ts` to determine the exact expected schema (13 columns, FKs, status/template_type value sets).
- [x] Created `supabase/migrations/065_autoapply_follow_ups.sql`: table + RLS enabled + 3 org-scoped policies (select/insert/update, deriving org membership from the caller's `profiles` row — the same pattern as migration 020, not the `organization_members` table migration 045 assumed, which doesn't exist in this schema) + 4 indexes.
- [x] Applied to production (ref `vbjplpquqxxfbpazyalt`) via `POST /v1/projects/.../database/query` with the Management API PAT. Returned `201 []`.
- [x] Verified live: `information_schema.columns` (13/13 columns, correct types/defaults), `pg_class.relrowsecurity = true`, `pg_policies` (3/3 policies present).
- [x] `tsc --noEmit` re-run clean after the migration file was added (no code changes needed — the routes already assumed this exact schema).
- [x] Committed as `feat: add migration 065 autoapply_follow_ups table`.
- **AutoApply Follow-Ups (audit #3) is now fully resolved** — code and data both in place.

## Still open / needs a decision
- [ ] **Worker update needed**: `worker/queue-processor.ts`'s call to `form-filler-agent.ts`'s `fillAndSubmit()` needs to be updated to pass an approved `sessionId`, or that autonomous-submission path will always be blocked by the new approval gate (#15).
- [ ] Set `RESEND_WEBHOOK_SECRET` and `RESEND_API_KEY` in Vercel production — neither is configured, so Resend email sending and the inbound webhook are both likely non-functional right now (pre-existing gap, unrelated to this session's fixes).
- [ ] Set real Stripe Price ID values in Vercel once they exist — the naming mismatch is fixed, but no Stripe price vars are set at all yet.

## In Progress (carried from prior session)
- [ ] Visual audit — elongated boxes CSS fix (not covered by this code audit)
- [ ] Full damage report — largely superseded by this session's deep audit; see STATE_OF_THE_BUILD.md

## Environment
- Supabase: vbjplpquqxxfbpazyalt (all migrations through 065 applied, 105 tables confirmed live)
- Vercel: benavora.vercel.app (Pro)
- Platform owner: info@faithfoundation.org (19 permissions) — bootstrap endpoint that created this is now locked down (see CRITICAL above)
