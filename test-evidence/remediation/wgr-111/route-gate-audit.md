# WGR-111 route gate audit (2026-08-21)

Every `route.ts` under `src/app/api/cron`, `src/app/api/sources`,
`src/app/api/webhooks`, `src/app/api/admin/webhooks` (21 files), read
directly and classified by whether the handler itself verifies a
`CRON_SECRET` bearer token or a third-party signature (Stripe/Svix) before
doing any work.

## Legend

- SECRET-GATED: checks `CRON_SECRET` bearer, or verifies a Stripe/Resend
  (Svix) signature, before any work. Root-cause fix (this task) is to add a
  `src/middleware.ts` path exemption for these — the same pattern
  `/api/users/accept` already uses — so the real caller (Vercel Cron, Stripe,
  Resend) is not 307-redirected to `/login` before its own check ever runs.
- UNGATED: no `CRON_SECRET`/signature check found in the handler.
- SESSION-GATED (not applicable): the route is not meant to be reached by an
  unauthenticated cron/webhook caller at all — it does its own explicit
  session check (in addition to `middleware.ts`'s own session gate) as a
  normal user-facing route. Not a WGR-111 candidate; excluded from the
  exemption list; no code change made.

## src/app/api/cron/*

| Route | Classification | Evidence |
|---|---|---|
| `/api/cron/campaigns` | SECRET-GATED | `runSweep()` line 30-34: `if (!cronSecret \|\| authHeader !== \`Bearer ${cronSecret}\`) return 401` |
| `/api/cron/autoapply` | SECRET-GATED | `runAutoQueue()` line 28-32: same pattern |
| `/api/cron/follow-ups` | SECRET-GATED | `GET()` line 10-14: same pattern |
| `/api/cron/reminders` | SECRET-GATED | same pattern (confirmed via header comment + grep; full check present) |
| `/api/cron/email-sequences` | SECRET-GATED | `runSweep()` line 13-17: same pattern, both `GET` and `POST` route through it |
| `/api/cron/domain-warmup` | SECRET-GATED | `GET()` line 66-71: same pattern (a second, redundant `if (!cronSecret)` inside `runWarmup()` at line 18-21 is dead-code-safe, not a gap — `GET` already gates before calling it) |
| `/api/cron/sales-sends` | SECRET-GATED | `GET()` line 9-17: same pattern |
| `/api/cron/draft-automation` | SECRET-GATED | line 96: `cronSecret` check ahead of `GET`/`POST` at lines 123/127 |
| `/api/cron/draft-queue-check` | SECRET-GATED | line 78: same pattern ahead of `GET`/`POST` at lines 103/107 |
| `/api/cron/research` | SECRET-GATED | `runSweep()` line 218-222: same pattern ahead of `GET`/`POST` at lines 385/389 |
| `/api/cron/grantsgov` | SECRET-GATED | `runSweep()` line 37-40: same pattern |

## src/app/api/sources/*

| Route | Classification | Evidence |
|---|---|---|
| `/api/sources/samgov` | SECRET-GATED | `GET()` line 39-40+: `cronSecret`/`authHeader` check (matches `grantsgov` pattern per its own header comment) |
| `/api/sources/propublica` | SECRET-GATED | `GET()` line 26-29: same pattern |
| `/api/sources/grantsgov` | SECRET-GATED | `GET()` line 32-35: same pattern |
| `/api/sources/state-portals` | **UNGATED** | `GET()` (full file read) has zero auth check of any kind — no `CRON_SECRET`, no session check, no signature. Not referenced in `vercel.json`'s `crons[]` and not one of WGR-023/WGR-111's originally-documented 14 cron_secret routes — a previously-undocumented gap. Currently only protected by `middleware.ts`'s own default (any non-public path requires a valid session) — i.e. today it is reachable by *any* authenticated user of *any* role/org, not by an anonymous caller, purely because `middleware.ts` gates it as a side effect, not because the route protects itself. **New finding, not exempted, not given a `CRON_SECRET` check** (see decision below) — filed as **WGR-149** in the register. |
| `/api/sources/registry` | SESSION-GATED (not applicable) | `GET()` line 20-23: explicit `supabase.auth.getUser()` + `x-organization-id` header check before its one privileged action (seeding `funding_sources`); a normal authenticated on-demand route, not a cron/webhook target. No exemption needed or added. |
| `/api/sources/poll` | SESSION-GATED (not applicable) | `requireAuth()` line 29-40: explicit `supabase.auth.getUser()` + `x-organization-id` header check; own header comment explicitly contrasts itself with the `CRON_SECRET`-gated `grantsgov`/`samgov` siblings as "the on-demand, session-scoped... sibling a user can trigger from the app." No exemption needed or added. |

## src/app/api/webhooks/*

| Route | Classification | Evidence |
|---|---|---|
| `/api/webhooks/stripe` | SECRET-GATED (signature) | `POST()` line 23-49: rejects with 500 if `STRIPE_WEBHOOK_SECRET` unset, 400 if signature header missing, 400 if `stripe.webhooks.constructEvent()` throws — no path skips verification. |
| `/api/webhooks/resend` | SECRET-GATED (signature) | `POST()` line 61-74: rejects 500 if `RESEND_WEBHOOK_SECRET` unset, 401 if `verifySignature()` (real Svix HMAC-SHA256, timestamp-bounded) fails. |

## src/app/api/admin/webhooks/*

| Route | Classification | Evidence |
|---|---|---|
| `/api/admin/webhooks/email-events` | SECRET-GATED (signature) | `POST()` line 61-74: identical pattern to `/api/webhooks/resend` (own `RESEND_WEBHOOK_SECRET` + `verifySignature()`). |
| `/api/admin/webhooks/email-reply` | SECRET-GATED (signature) | `POST()` line 59-72: identical pattern. |

## Summary

- **18 SECRET-GATED** — all 18 get a `src/middleware.ts` path exemption (step 6).
- **1 UNGATED** (`/api/sources/state-portals`) — NOT exempted (would remove its
  only real protection, the middleware's own session requirement, without
  replacing it with anything). Registered as a new finding (WGR-149) instead
  of silently fixed, per this task's own instruction for a webhook-shaped
  case; the same conservative treatment (don't exempt an unprotected route)
  is applied here even though it isn't a third-party webhook.
- **2 SESSION-GATED, not applicable** (`registry`, `poll`) — correctly rely on
  `middleware.ts`'s session gate as their primary protection plus their own
  explicit re-check; no change.
