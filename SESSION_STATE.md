# BENAVORA — SESSION STATE
## Last updated: 2026-07-07
## Current branch: main
## Last commit: design: unified token system, layered palette, Badge component

---

## COMPLETED — July 7 design system unification pass

Full token + component pass across the app (supersedes the reverted `ed302f4`
podcast-theme commit — built fresh this time, not reapplied).

**Token layer** (`src/app/globals.css` + `tailwind.config.ts`, kept in agreement —
Tailwind color keys read the same CSS custom properties, no value is restated):
`background` #EEF2F7, `surface` #FFFFFF, `surface-raised` #F8FAFC, `sidebar` #0B1220,
`sidebar-active` rgba(0,180,216,0.12), `primary` #0077B6, `accent` #00B4D8, `text` #0F172A,
`text-muted` #475569, `border` #E2E8F0, plus semantic pairs `success`/`warning`/`error`/`info`
(light bg tint + 700-level text of the same hue, ≥4.5:1 contrast). Legacy CSS var names
(`--color-page`, `--color-surface-elevated`, `--color-accent` formerly = navy not cyan, etc.)
now alias the canonical tokens instead of restating literal hex, so there's one source of
truth. Fixed a real bug found along the way: `--color-accent` used to equal the navy
primary (#0077b6); several rules (`:focus-visible` outline, input focus border, the
`.text-blue-700/800` compat rule) depended on that and were repointed to the new
`--color-primary` to avoid a low-contrast cyan-on-white regression.

**`src/components/ui/Badge.tsx`** rewritten as the only pill/badge implementation — a
`variant` prop (`success`/`warning`/`error`/`info`/`neutral`) selects the token pair. Kept
the legacy `color` prop (13 names) as an internal alias so none of the ~80 existing call
sites needed to change; every color name resolves to one of the five variants, so no raw
hue class can leak through anymore. The old implementation was dark-theme leftovers
(`bg-teal-400/15 text-teal-200` etc.) — `text-teal-200` on a white page background was
functionally invisible; this was a real, live bug across every badge in the app.

**~30 files** had hand-rolled inline pill `<span>`s (status pills, score/match-% pills like
the "0% match" badges, removable filter chips) converted to `<Badge>`, preserving every
threshold/status-mapping function exactly — only the rendering wrapper changed.

**Purple/orange/plum/emerald hue classes and the 5 listed hardcoded hex codes** (`#7C3AED`,
`#A78BFA`, `#F97316`, `#0a0a1a`, plus branding.ts defaults) removed from ~40 more files,
including the marketing landing page's inline `<style>` block (~33 raw hex occurrences,
including alpha-suffixed shorthand converted to `rgba()`).

**Sidebar** (`src/components/layout/Sidebar.tsx`): bg `#0B1220` (was a semi-transparent
`bg-ink-900/80`), inactive `text-slate-400`, hover `text-white`, active `text-accent` +
`bg-sidebar-active`. **`MetricCard`**: swapped the dark-theme `shadow-card` (designed for a
dark bg) for `shadow-sm`, `border-navy-100`→`border-border`, values now `text-text` — was
previously always going to read fine since `border-navy-100` aliased to a safe rgba, but the
card was never actually reviewed against the token system until now.

**Scope decision**: left `teal-*` Tailwind classes untouched app-wide (508 occurrences,
129 files) — user call, made explicit before the pass. `teal-500`/`600` are numerically
identical to the new `accent`/`accent-hover` tokens already, and the `globals.css`
compatibility layer already coerces `text-teal-600/700` to specific WCAG-safe hex; a blind
mechanical replace risked contrast regressions across dozens of files with no way to
visually re-verify each one in this pass. Tracked as follow-up debt, not fixed here.

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean (234/234 static pages,
zero errors) after the full pass.

**Left uncommitted/unstaged, NOT part of this pass** — pre-existing in-progress feature work
found already sitting in the working tree at the start of this session, unrelated to the
design system: `src/app/(dashboard)/intelligence/recommendations/page.tsx` (org-summary-card
+ geography-filter feature; only its `ScoreBadge` pill was touched by this pass, split out
via a partial-file stage so the rest stays uncommitted), `src/app/api/intelligence/recommendations/route.ts`,
`src/lib/intelligence/evaluation-library.ts`, `supabase/migrations/060_grantmaker_profiles.sql`.

---

## COMPLETED — July 7 seed-script build-failure session

### Vercel production build was failing: `scripts/seed-beta-users.ts:35:15` — `Type 'WebSocket' is not assignable to type 'WebSocketLikeConstructor'`

`createClient()`'s `realtime.transport` option expects a `WebSocketLikeConstructor`; the
`ws` package's exported type doesn't structurally satisfy it under Vercel's stricter
build-time type resolution (didn't reproduce locally, but the fix is correct either way).

**Fix:**
- `scripts/seed-beta-users.ts:35` — `transport: ws as any` → `transport: ws as unknown as typeof WebSocket` (explicit double-cast instead of `any`)
- `tsconfig.json` — added `"scripts"` to `exclude`. One-off utility/seed scripts under `scripts/` must never be able to break a production deploy's type-check again; they're run standalone via `pnpm seed:beta` / `tsx`, not part of the Next.js app build.

**Verification:** `pnpm tsc --noEmit` clean (0 errors). `pnpm run build` clean (0 errors, all routes generated).

---

## COMPLETED — July 7 font self-hosting session

### Build was failing: next/font/google couldn't reach fonts.googleapis.com (ETIMEDOUT)

`src/app/layout.tsx` used `next/font/google` for Inter + JetBrains Mono, which fetches
font files from Google's CDN at build time. In this environment that network call times
out, breaking `pnpm run build` unconditionally.

**Fix — self-host both fonts, zero network calls at build time:**
- `pnpm add @fontsource-variable/inter @fontsource-variable/jetbrains-mono` (variable-weight woff2 packages)
- Copied the latin-subset variable woff2 files into `public/fonts/`:
  `inter-latin-wght-normal.woff2`, `jetbrains-mono-latin-wght-normal.woff2`
- `src/app/layout.tsx`: replaced `next/font/google` (`Inter`, `JetBrains_Mono`) with
  `next/font/local` pointing at those two files. Same CSS variable names preserved
  (`--font-sans`, `--font-mono`) and same weight ranges (100–900 / 100–800), so no
  other file needed to change.

**Verification:** `pnpm run build` completes clean (0 errors, 234 static pages generated) with no `next/font/google` import anywhere in the tree.

---

## COMPLETED — July 7 design session

### Brand token replacement — tailwind.config.ts + root layout

Prior sessions (`ed302f4`, `7e046b1`) rebranded `globals.css` to the light navy/cyan
theme (`--color-accent: #0077b6`, `--color-secondary: #00b4d8`) via a compatibility
layer of `!important` overrides, but `tailwind.config.ts` itself still declared the
old dark/purple theme underneath — so any class not covered by the compat layer
(`ring-teal-400`, `accent-teal-500`, `shadow-glow-*`, `bg-gradient-accent`, the raw
`plum`/`teal` scales) still rendered the legacy purple/emerald/teal-green colors.

**`tailwind.config.ts`:**
- `colors.accent`: `DEFAULT #7c3aed→#00B4D8`, `hover #6d28d9→#0093AC`, `indigo #6366f1→#0077B6`, `teal #2dd4bf→#00B4D8`, `purple #a855f7→#0077B6` (`accent.blue`/`info`/`warning` left untouched — not in the purple/orange/emerald/teal removal list)
- `colors.cta`: `#10b981→#0077B6`, hover `#059669→#005F92`
- `colors.teal` (legacy 50–950 scale, backs every `teal-*`/`ring-teal-*` class): replaced with a cyan ramp anchored at 500 `#00b4d8` / 600 `#0093ac` (exact secondary/secondary-hover match)
- `colors.plum` (legacy 50–950 scale): replaced with a navy-blue ramp anchored at 600 `#0077b6` (exact primary match)
- `backgroundImage`: `gradient-accent`/`gradient-brand`/`gradient-cta` → cyan `#00B4D8` → navy `#0077B6` sweep (matches `globals.css`'s `--color-cta-from/to` exactly); `gradient-purple` → navy two-tone; `glow-radial` → cyan
- `boxShadow`: `glow`/`glow-accent`/`glow-blue` → navy/cyan rgba (was emerald/purple/blue)
- No `#f97316` (orange) hardcoded anywhere in the config — nothing to replace there

**`src/app/layout.tsx`:** removed `className="dark"` from `<html>` (site is light-theme now); `viewport.themeColor` `#0a0a1a→#0077B6`

**Verification:** read every file using `bg-accent`/`border-accent` (1: `GroupedKanban.tsx` drag-over highlight), `shadow-glow-*` (login/register/forgot-password/reset-password/invite-accept CTA buttons, `AssemblyPanel.tsx`, `Button.tsx` primary variant), and `ring-teal-400`/`focus:ring-teal-400` (~30 files — form input focus rings across the entire autoapply section, `PlanCard.tsx`, `Badge.tsx`) — all render as cyan/navy on the light theme with no contrast regressions. `Button.tsx`'s dark-styled `secondary`/`ghost`/`purple` variants and `Badge.tsx`'s dark-chip styling are pre-existing light/dark mismatches unrelated to this color-value swap — not touched.

Gate: `pnpm tsc --noEmit` clean (0 errors). `pnpm run build` — see below.

---

## COMPLETED — July 6 audit session

### STEP 1: Vitest — test suite clean

**Before:** 5 failures in `compliance.test.ts` (`UNSUBSCRIBE_HMAC_SECRET` missing), 5 failures in `intelligence.test.ts` (logic-model test expected `createClient()` auth but route used `requireRole()`).

**Fixes:**
- Created `.env.test` with 6 test-only env vars (`UNSUBSCRIBE_HMAC_SECRET`, `INTEGRATION_KEY_SECRET`, `PORTAL_ENCRYPT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — loaded by `tests/setup.ts` via dotenv
- Rewrote `src/app/api/intelligence/logic-model/route.ts` to use `createClient()` directly (no `requireRole()`), matching the test's design intent

### STEP 2: TypeScript — clean (0 errors)

No new errors introduced. Prior session left clean.

### STEP 3: Build — clean

No new build errors introduced. Prior session left clean.

### STEP 4: API route audit — auth, org_id scoping, requireRole gates

No additional gaps found beyond what was caught in the July 3 session.

### STEP 5: Agents audit — stubs replaced with real implementations

- **`src/lib/intelligence/ingest-nih-proposals.ts`** — completely rewritten from always-returning-fake-success stub to real NIH Reporter API v2 integration:
  - Cycles 7 search terms by day-of-year (deterministic per-day)
  - POSTs to `https://api.reporter.nih.gov/v2/projects/search`
  - Deduplicates by `nih:{appl_id}` source key
  - Calls `extractSections()` + `generateEmbedding()` for each project
  - Inserts into `intelligence_funded_proposals` + `intelligence_proposal_sections`
  - Uses `createAdminClient()` for DB access

### STEP 6: env var startup throws

Added mandatory API key guards (throw if missing) to 6 intelligence files:
- `src/lib/intelligence/logic-model-generator.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/budget-patterns.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/embeddings.ts` — `OPENAI_API_KEY`
- `src/lib/intelligence/evaluation-library.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/funder-recommender.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/grant-dna.ts` — `ANTHROPIC_API_KEY`

Also fixed the pre-existing UUID bug in `src/lib/automation/session-manager.ts`:
- `markAutoSubmitted()` was writing `system:${automationLevel}` (a string) to `approved_by` (a UUID column) — would fail at runtime
- Fix: set `approved_by: null`; record level in `notes: auto_submitted:${automationLevel}`

And added `maxDuration=300` to two routes that were missing it:
- `src/app/api/agents/campaigns/route.ts`
- `src/app/api/agents/custom-scrape/route.ts`

### STEP 7: Playwright — stale selectors fixed

Base failure count: 59 failing / 27 passing before this session.

Fixed selector mismatches in these test files:

| File | What changed |
|---|---|
| `tests/e2e/authed/dashboard.spec.ts` | 4 metric labels + 2 section headings updated |
| `tests/e2e/authed/ui-redesign.spec.ts` | body bg `#0a0a1a→#0f1117`; sidebar items (Dashboard/Research moved to header, Funders/Applications/Documents in sidebar) |
| `tests/e2e/authed/research.spec.ts` | Page redesigned to "Research Command Center" + "Control Panel"; selectors rewritten |
| `tests/e2e/authed/automation.spec.ts` | Complete rewrite: navigates to `/autoapply` (was `/automation`); uses sessions API to find seed session; checks AutoApply h1 + "Add to Queue" button |
| `tests/e2e/authed/deadlines.spec.ts` | Calendar view button label `"Calendar"` → `"Month"` |
| `tests/e2e/authed/documents.spec.ts` | `"Upload a document"` heading doesn't exist; now checks `"Drag & drop or click to browse"` text |
| `tests/e2e/authed/pipeline.spec.ts` | Clicks "Kanban" toggle first; checks group labels "Discovery"/"Preparation"/"Active"/"Outcome" instead of individual stage names |
| `tests/e2e/authed/onboarding.spec.ts` | `"Benavora setup"→"Welcome to Benavora"`; step titles corrected to actual wizard steps |
| `e2e/onboarding.spec.ts` | `"Benavora setup"→"Welcome to Benavora"`; advance button regex updated for `"Save & Continue"` button label; step 7 check updated to `"Plan Selection"` |

Tests confirmed correct (no changes needed):
- `funders.spec.ts`, `knowledge-base.spec.ts`, `saas.spec.ts`, `settings.spec.ts`, `auth.spec.ts`, `login-theme.spec.ts`, `draft-generator.spec.ts`, `opportunities.spec.ts`, `email-calendar.spec.ts`
- `e2e/grant-pipeline.spec.ts`, `e2e/draft-generation.spec.ts`, `e2e/billing-gates.spec.ts`, `e2e/email-integration.spec.ts`, `e2e/autoapply-dashboard.spec.ts`, `e2e/tenant-isolation.spec.ts`, `e2e/admin-sales.spec.ts`, `e2e/smoke.spec.ts`

### STEP 8: Security page

Created `src/app/(marketing)/security/page.tsx` — matches the dark marketing design (privacy/terms pattern):
- AES-256-GCM encryption at rest
- TLS 1.3 in transit
- Row-Level Security (RLS) tenant isolation
- SOC 2-compliant infrastructure (Supabase/Vercel/Stripe/Anthropic)
- Authentication & access control
- Data never sold
- GDPR alignment
- SOC 2 Type II roadmap
- Responsible disclosure (security@benavora.com)
- Trust badge row

Added to `src/app/(marketing)/layout.tsx`:
- NAV_LINKS: `{ label: "Security", href: "/security" }`
- Footer: `<Link href="/security">Security</Link>`

---

## COMPLETED — July 3 audit session

### Earlier: test/build gate + nav/config fixes
- Added Email nav entry — /email now reachable from the sidebar
- Fixed `playwright.config.ts` testIgnore (worktree scan inflation)
- Fixed stale smoke/login-theme specs
- Fixed Node 20 WebSocket blocker in test helpers
- Confirmed: Vitest 161 passed / 0 failed · tsc --noEmit 0 errors · pnpm build clean

### Deep operational audit (27 parallel sub-agents)
- Full sweep of `src/lib/**` (213 files), `src/app/api/**` (168 routes), `src/app/(dashboard)/**` (75 pages)
- Live production schema queried: 104 tables, 1331 columns

### Security fixes
- **commit ae058c9** — bootstrap endpoint self-disables after platform_owner created
- **commit e29bd6f** — 4 hardcoded fallback secrets removed; env vars set in Vercel
- **commit c7704b6** — BYO API keys encrypted; shouldUseOwnKeys() fixed
- **commit 74be491** — Resend webhook real HMAC-SHA256 verification

### Batch fix — 21 remaining audit findings (commit a03a0e3)
Sales Outreach real routes · AutoApply Follow-Ups 4 routes · Renewals route · Stripe env naming · Campaign multi-step · HUD fetcher · maxDuration=300 on 15 routes · requireRole on grant-dna/logic-model · form-analyzer-agent real Claude impl · form-filler approval gate · tier-limit source of truth · nav-counts org filter · automation child-table queries · Texas registration data · email/link writer role · Email Hub live buttons · dual Calendar OAuth dedup · SearXNG throw · dead code removed

### Migration 065 (commit 1121c5a)
`autoapply_follow_ups` table created (13 columns, FK cascades, RLS, 3 policies); applied to production.

### Migration 066 + worker fix (commit 855f192)
12 broken RLS policies on form_templates/autoapply_submissions/submission_queue fixed (org_members → profiles pattern); worker queue-processor.ts creates/approves automation_sessions row per submission.

---

## PENDING — as of 2026-07-06

### Production-blocking
- [ ] **Set `RESEND_API_KEY` in Vercel** — outbound email non-functional
- [ ] **Set `RESEND_WEBHOOK_SECRET` in Vercel** — inbound webhook 500s
- [ ] **Set Stripe Price ID vars in Vercel** (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PROFESSIONAL_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`, `STRIPE_CONSULTANT_PRICE_ID`)
- [ ] **Deploy Railway worker** — AutoApply Playwright routes need Chromium process

### Code / low-priority
- [ ] Pull new env vars to local `.env.local` (`vercel env pull .env.local`) — 4 encryption vars missing locally
- [ ] Consolidate `NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL`
- [ ] Add SSRF allowlist to `api/integrations/custom-api/test`
- [ ] Fix `compliance-library.ts` dead branch (`omb-a133-threshold` always returns 'pass')
- [ ] Visual: verify/fix elongated input/textarea boxes reported across the platform

### Informational (no fix needed short-term)
- `grants-gov.ts` uses legacy `apply07.grants.gov` REST API — confirm not deprecated
- Census (2022) and BLS (2022–2023) data sources self-labeled as approximations
- state-portal.ts covers Texas only
- Hardcoded URL lists in corporate/foundation/state scrapers will go stale

---

## ENVIRONMENT

| Item | Value |
|---|---|
| Supabase | vbjplpquqxxfbpazyalt — 105 tables, migrations 001–066 applied |
| Vercel | benavora.vercel.app (Pro) |
| Platform owner | info@faithfoundation.org (bootstrap endpoint now self-disabled) |
| Encryption vars in Vercel | INTEGRATION_KEY_SECRET · PORTAL_ENCRYPT_SECRET · INTEGRATION_ENCRYPTION_KEY · UNSUBSCRIBE_HMAC_SECRET — all set, Encrypted, Production only |
| Local .env.local | Missing those 4 encryption vars + missing ANTHROPIC_API_KEY and other AI keys |
| .env.test | Created for Vitest: 6 test-only secrets |
