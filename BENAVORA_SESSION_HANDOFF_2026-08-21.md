# Benavora — Session Handoff (2026-08-21)

**Purpose of this document:** a complete state snapshot for a fresh assistant session with zero prior context. Read this before touching anything — it tells you what's actually done, what's actually broken, and where the traps are.

---

## 1. Audit program status

The PT-00 through PT-15 audit program (16 phases) is **complete**. The single source of truth for "is X currently working" is:

**`test-evidence/_register/WIRING_GAP_REGISTER.md`** — 153 findings (WGR-001 through WGR-153, plus WGR-154 added this session), each with a severity, real evidence path under `test-evidence/`, and a reproduction command.

Closing verdict: **`test-evidence/pt-15/GO-NO-GO.md` = NO-GO.** At audit close: 16 open P0, 66 open P1, 28 open P2, 8 open P3. The ranked fix plan is `test-evidence/pt-15/REMEDIATION-BACKLOG.md` (Wave 0→3).

Do not trust "BUILT — VERIFIED" claims in `FEATURE_REGISTRY_v2.md` or narrative session logs (`SESSION_STATE.md`'s older entries) without re-checking the register or re-running the cited reproduction command — this audit found multiple previously-"BUILT" features that 500'd on every real call due to unapplied migrations.

---

## 2. P0 remediation status (16 total)

### Resolved this cycle (real commits, live-reverified before being marked RESOLVED)

| WGR | Finding | Commit | Notes |
|---|---|---|---|
| WGR-012 / WGR-017 | `/donor-discovery/prospects/[id]` blank-render crash | `d5500cd` | |
| WGR-029 / WGR-030 / WGR-031 / WGR-032 | 4 API routes silently truncated at PostgREST's 1000-row cap | `5c747ee` | New shared `src/lib/supabase/select-all-pages.ts` pagination helper |
| WGR-138 | Grants.gov dead endpoint + wrong response shape | `cde8cd9` | Live-verified 100 real records |
| WGR-108 / WGR-109 / WGR-110 | 3 P0 SSRF findings | `6dd5f32` | One new shared guard, `src/lib/security/ssrf-guard.ts`; live DNS-based verification, 0 hits on a real local listener, 30 unit tests |
| WGR-129 | `POST /api/ai/draft` could 200 while persisting zero `draft_versions` rows | `fc8d0fe` | Root cause was a caught-and-swallowed persist error, not schema drift; fixed by making the insert throw |
| WGR-154 | "Explore the platform first" onboarding bypass — API-route middleware over-redirect + client-router stale-cache risk | `48216d3` (**reverted** by `96ed8d0`, see §2a below) | See below — status is nuanced, not a clean RESOLVED |
| *(this session)* | Marketing page hydration mismatch blanking `/` on every load | `ce545fe` | See §3 |

**Fix applied, branch-verified, NOT yet applied to production (deliberate, separate step):**

| WGR | Finding | Commit | Notes |
|---|---|---|---|
| WGR-130 / WGR-131 | Application stage-transition state machine bypassable via a raw `.update({stage:...})` | `9b8982e` | New DB trigger, `supabase/migrations/141_application_stage_transition_trigger.sql`; exhaustively verified (144-pair parity + the exact WGR-131 exploit shape) against a real local Postgres instance (`.pt05-local-stack`). Bundled into the migration-drift remediation batch (§4) rather than applied standalone. |

### §2a — WGR-154 nuance (read this before touching onboarding/middleware code again)

A prior session (2026-08-20) found the "Explore the platform first" bypass button's *reported* symptom did not reproduce in 5/5 live tests against the code as it stood — but found and fixed two real, 100%-reproducible defects in the same path: (1) `src/middleware.ts`'s onboarding gate was redirecting `/api/*` polling routes to the onboarding HTML page instead of JSON while a user was legitimately on `/onboarding`; (2) the click handler used Next's client-side router (`router.push`), which can theoretically serve a stale prefetched response. Both were fixed in commit `48216d3`.

**Reid then reverted that commit** (`96ed8d0`, a clean `git revert`, both commits are in `git log`) before this session started. The revert is intentional and preserved in history — do not re-apply `48216d3`'s changes without checking with Reid first. This session (2026-08-21) live-verified that the **current (reverted) code still works correctly**: the bypass button reaches `/dashboard`, and `/draft-generator` and `/opportunities` are both reachable afterward with zero hydration or redirect errors (see `test-evidence/remediation/hydration-fix/session3-verification.txt`, 9/9 PASS). So as of right now, WGR-154's underlying user-facing flow is not broken — but the two defensive fixes from `48216d3` are NOT currently live. If the original symptom (stuck-on-onboarding, silent) resurfaces, `48216d3`'s diff is the known-good starting point.

### Pending P0s (not yet resolved)

| WGR | Finding | Status |
|---|---|---|
| WGR-139 / WGR-142 / WGR-143 | SAM.gov ×3 (missing mandatory date-range params, invalid `activeDate` param, wrong awardee nesting path) | **Code-fixed** (commit `cde8cd9`, same commit as the Grants.gov fix). Live verification blocked by SAM.gov's real per-key daily quota, exhausted mid-audit. **Next session: re-run `npx tsx scripts/audit/int-fix-live-after.mjs`** once the quota window has reset, and flip these three to RESOLVED once confirmed. |
| WGR-133 | Password reset flow | Open — not investigated/fixed yet |
| WGR-074 | Impersonation | Open — not investigated/fixed yet |
| WGR-111 | Middleware availability (webhooks/cron routes redirected to `/login` before their own signature/`CRON_SECRET` check ever runs — Stripe, Resend, and all 5 real Vercel Cron jobs are structurally indistinguishable from an unauthenticated attacker to this middleware) | Open — root cause is `src/middleware.ts`'s `PUBLIC_PATHS`/`isPublicPath()` having no exemption for `/api/cron/*`, `/api/sources/*`, `/api/webhooks/*`, `/api/admin/webhooks/*`. Confirmed live in production too (PT-14-003). Fix shape: add an explicit exemption for these paths, verified instead via their own signature/secret check (same pattern `/api/users/accept` already uses). |
| WGR-004 | `/documents` hang | Open — not investigated/fixed yet |
| WGR-099 | Safari 0% (a real browser-compat failure, not a flaky test — see the register entry for detail) | Open — not investigated/fixed yet |

**Priority order for next session's P0 sweep:** WGR-111 (middleware, real production billing/cron impact) → WGR-133 (password reset, auth-critical) → WGR-074 (impersonation, security-sensitive) → WGR-004 (`/documents` hang) → WGR-099 (Safari). Re-run the SAM.gov verification (WGR-139/142/143) opportunistically whenever the quota window allows — it's a 5-minute check, not a fix.

---

## 3. This session's work (2026-08-21)

### Part 1 — Hydration fix (already committed by a prior session this same day, verified again here)

`src/app/(marketing)/MarketingPageClient.tsx`'s `BenavoraMarketing` component had an inline `<style>{...}</style>` block containing a static `@import url('https://fonts.googleapis.com/css2?...');`. React's server renderer HTML-entity-escapes `'`/`&` in a `<style>` tag's text children, but `<style>` is an HTML "raw text" element the browser parser never entity-decodes — a genuine SSR-vs-client text mismatch, not a false positive. Traced via `git log -S` to commit `f43da58` (2026-07-19) — over a month old, unrelated to any recent commit. Fixed (commit `ce545fe`, already on `origin/main` before this session started) by moving font loading to `next/font/google` and deleting the `@import` line. Re-verified this session: 0 hydration errors across the landing page, dashboard, draft generator, and opportunities pages, reached via a real authenticated user going through the "Explore the platform first" bypass. See `test-evidence/remediation/hydration-fix/` (`session3-*.png`, `session3-verification.txt`, 9/9 PASS).

### Part 2 — Queued UI color work (this session)

All colors are literal inline hex — this app's `globals.css` compatibility layer (`!important` rules) overrides Tailwind color classes and CSS vars, confirmed repeatedly this session and prior ones.

- **Dashboard flip-cards** (prior session, `53cc358`): header-band + tinted-body treatment, per-card accent hex, explicit "Back" flip-to-front control.
- **Research page** (prior session, `f95eae5`): 6 bronze/gold buttons recolored to teal `#2E6B66`.
- **Opportunities page** (prior session, `d4b2f2b`): action buttons → slate blue `#4F6D8F`; "Add Opportunity" → olive `#5C6935`; 4 stat numbers → navy/teal/plum/slate-blue.
- **AutoApply page** (this session): the top-four stat cards (Sessions Today, Success Rate, Avg Fill Time, Forms Queued — `src/app/(dashboard)/autoapply/page.tsx`) converted from a thin `borderTop` stripe to the dashboard's header-band treatment, four distinct hexes: teal `#2E6B66`, plum `#7A5980`, slate blue `#4F6D8F`, amber `#C17817`.
- **Donor Discovery page** (this session, `src/app/(dashboard)/donor-discovery/page.tsx`): "Discover Prospects" button → royal violet `#5B21B6`; the 6-stage Pipeline Funnel boxes → one of six action colors each (teal/plum/slate/amber/rust/olive, `#2E6B66`/`#7A5980`/`#4F6D8F`/`#C17817`/`#A3492F`/`#5C6935`), both the frame and the value-number text; the "Featured Prospect" and "Top Prospects" review buttons → rust `#A3492F`; the previously-all-bronze `DarkStatCard` row (Active Requests / Avg Score / New & Reviewing / Contacted This Month) → 4 distinct hexes; 2 more bronze stat numbers in the top row (Prospects Identified, Active Campaigns) → teal/plum.

Live-verified via `getComputedStyle()` against the real pages, logged in as Faith Foundation (a real onboarded org with real data): 17/17 automated assertions pass. Screenshots + full dump in `test-evidence/remediation/ui-autoapply/` and `test-evidence/remediation/ui-donor-discovery/`.

`pnpm run build` exit 0. `pnpm run build:worker` exit 0.

---

## 4. Largest P1 cluster: migration drift (68 of 108 migrations unapplied to prod)

This is the single highest-leverage fix available — one systemic root cause behind roughly 21 separate register rows (missing tables, missing columns, missing FKs — several of which turned out to be the real cause of features that looked "BUILT" but 500'd on every call, e.g. the notifications and eligibility-scoring bugs found in an earlier smoke test).

**Blocker:** the Supabase CLI on this machine cannot currently see the production project (`vbjplpquqxxfbpazyalt`) — it's logged into a different account that only has `tarritrix`-prefixed projects. The Supabase **access token works fine via direct API calls** (used throughout this session's audits for `execute_sql`-equivalent DDL work via `psql`/`DATABASE_URL`), so this is specifically a **CLI login/account mismatch**, not a broken credential. The token to use is the one named `BENAVORA` in whatever secret store you're pulling from — do not use a `tarritrix`-scoped token for this project.

**Recommended sequence:**
1. Resolve the CLI account access (`supabase login` with the correct account, or find/generate a token scoped correctly and re-auth the CLI — `supabase projects list` should show `vbjplpquqxxfbpazyalt` when this is fixed).
2. Do NOT apply the 68 missing migrations directly to prod. Create a Supabase branch first, apply the full batch there, and re-run the audit's schema-drift checks against the branch to confirm no migration in the batch conflicts with data that's accumulated in prod since the migration was written (a real risk after this many unapplied migrations — some may assume a table state that no longer matches).
3. Bundle WGR-130/131's stage-transition trigger migration (`141_application_stage_transition_trigger.sql`, already branch-verified, see §2) into this same batch/apply pass rather than applying it standalone.
4. After applying to prod, re-run the audit's migration-drift check (find the exact script name in `test-evidence/pt-*/` — it was part of the original PT phases; grep the register for "migration" to find the citing row and its reproduction command) to confirm all 68 are now applied and no new drift was introduced.

---

## 5. Known environment facts (read before doing anything on this machine)

- **Shell:** PowerShell 5.1 by default in this harness. No `&&` — use `;` to chain, or `if ($?) { ... }` for conditional chaining. (The Bash tool, when available, is real Git Bash — use POSIX syntax there instead.)
- **FORGE orchestrator:** `C:/Users/manag/Documents/FORGE`. Has a completion-ledger (`completed-queues.json`, SHA256-keyed) and archive-on-completion hardening added 2026-08-18 specifically to stop already-shipped queues from being silently re-run after a manual status-field reset. See `STATE_OF_THE_BUILD.md`'s "FORGE Orchestrator Hardening" section for the full mechanism.
- **Claude Code version pin:** MUST stay on **2.1.236** with `DISABLE_AUTOUPDATER=1` set. **2.1.237 has no Windows binary and breaks everything** — do not let it auto-update past 2.1.236 on this machine.
- **Vercel auto-deploy is broken.** Pushing to `main` does NOT trigger a production deploy on its own. Deploy manually: `npx vercel deploy --prod`. (Multiple past sessions have shipped a fix, confirmed the build passes, and declared victory without actually deploying — always verify the live site, not just the build, before calling something shipped.)
- **Supabase access:** the PAT to use for this project is the one named **`BENAVORA`** — not a `tarritrix`-scoped one. See §4 for the CLI-specific account mismatch.
- **Multi-worktree memory contention is real and expected.** This session and prior ones repeatedly observed `pnpm run build` (both the direct one and the git pre-push hook's own rebuild) taking 10-15+ minutes and occasionally crashing with exit code `3221225794` (STATUS_ACCESS_VIOLATION) when multiple `.claude/worktrees/agent-*` sessions are building concurrently on this same checkout — `next.config.mjs` already sets `experimental.cpus: 1` to reduce peak memory per build, and `PT_AUDIT_DIST_DIR` env var isolates a build's output dir from a concurrently-running one sharing the default `.next/`. If a build crashes with that exact exit code, just retry — it is not a code defect.
- **`git push` here runs a pre-push hook that reruns the full `pnpm run build`.** Always background a push with a long timeout, never a foreground call with the default 60s timeout — it will get killed mid-build and you'll misread that as a failure.
- **The globals.css `!important` compatibility layer overrides Tailwind color classes and CSS variables.** Every UI color fix this session and prior ones used literal inline `style={{}}` hex — Tailwind color classes silently render as unstyled/default. This has been re-confirmed on every color-pass task this session; treat it as a standing constraint for any future UI work on this app, not something to re-litigate per task.
- **Test org for un-onboarded-user flows:** `beta2@benavora-test.com` / org `09a1fc24-bf00-43ec-a545-63d1c0302d09` ("Beta Org 2"), `onboarding_completed: false`. Real data, real onboarded org for everything else: `info@faithfoundationsf.org` (Faith Foundation, org `b1ab7402-dfc2-4712-869f-70ea3566cc1d` — there are two "FAITH Foundation" orgs in prod, `bed3e621-...` is an abandoned dev-pass duplicate; the `b1ab7402-...` one is the real one this email uses). Both reachable via the magic-link-login Playwright technique used throughout this session's verification scripts (`admin.auth.admin.generateLink` + `@supabase/ssr`'s `setSession` + cookie injection — see any `scripts/verify-*-2026-08-*.mjs` file for the exact pattern).

---

## 6. Recommended next steps, in priority order

1. **Finish the remaining open P0s**, in this order: WGR-111 (middleware/cron/webhook availability — real production billing impact) → WGR-133 (password reset) → WGR-074 (impersonation) → WGR-004 (`/documents` hang) → WGR-099 (Safari). Re-verify WGR-139/142/143 (SAM.gov) whenever the quota window allows.
2. **Resolve the Supabase CLI account access** (§4) — this blocks the single highest-leverage remaining fix.
3. **Apply the migration-drift batch to prod**, branch-first (§4), bundling WGR-130/131's trigger migration into the same pass.
4. **Re-run the audit's PENDING-SCOPE checks at full fidelity** — several register rows were graded `PENDING-SCOPE` (real gap found, but whether it's in-scope for a fix vs. a separate product decision wasn't resolved) or left with an explicit caveat (e.g., WGR-147's Google Calendar OAuth credentials never configured, WGR-153's rate-limiting posture gaps). Grep the register for `PENDING-SCOPE` to get the current list and decide, per row, whether it's now in scope.
5. Deploy to production (`npx vercel deploy --prod`, since auto-deploy is broken) once the above P0s are closed, and do a real live smoke test against `https://www.benavora.com` — not just a passing local build — before declaring any of this session's or a future session's fixes actually shipped.

---

*Handoff written 2026-08-21. Supersedes nothing — read alongside `STATE_OF_THE_BUILD.md` and `SESSION_STATE.md` for the full narrative history, and `test-evidence/_register/WIRING_GAP_REGISTER.md` for the authoritative per-finding status.*
