# Benavora Codebase Audit — 2026-06-21

Comprehensive health check of the AutoApply worker pipeline, the `src/lib/autoapply/`
module graph, environment configuration, database schema drift, client bundle size,
and the build/typecheck gates. Performed against the repo-root tree (the many
`.claude/worktrees/agent-*` copies were excluded).

**Gate status after fixes:** `pnpm typecheck` (tsc --noEmit) = PASS · `pnpm build` = PASS.

---

## 1. Worker pipeline — `worker/queue-processor.ts`

Read end-to-end (1,052 lines). The processing pipeline is internally consistent:

`dequeue (SELECT → claim UPDATE)` → fetch funder → fetch org → org readiness (cached)
→ load request profile → submission controls (velocity / cross-client / domain throttle)
→ timing score → personalized pitch → optimal ask amount → portal health check →
domain throttle → load/refresh form template → launch StealthBrowser → analyze (if stale)
→ login gating (login or auto-register) → CAPTCHA detect/solve → fill & submit →
parse confirmation → screenshots at each stage → persist `autoapply_submissions` →
back-link queue item + screenshots → receipt / webhooks / error-annotation →
retry scheduling → review-queue escalation after 3 failures.

**Import resolution:** all 22 imports resolve. The 16 symbols pulled from
`../src/lib/autoapply/*` (StealthBrowser, FormAnalyzerAgent, FormFillerAgent,
CaptchaSolver, RegistrationAgent, CredentialManager, ScreenshotManager,
SubmissionValidator, SubmissionControls, parseConfirmationPage + ConfirmationData,
generateReceipt, getOptimalAskAmount, personalizePitch, getTimingScore,
WebhookNotifier, annotateErrorScreenshot) are each exported by their target module.
The 5 worker-local imports (heartbeat, RateLimiter, ProxyManager, quickHealthCheck,
scoreAndReorderQueue) all exist under `worker/`.

**Note:** `worker/` is excluded from `tsconfig.json` (`"exclude": [... "worker", ...]`),
so `pnpm typecheck` does **not** type-check the worker. See Risks §R4.

**Consistency observations (not bugs):**
- `dequeue()` uses a two-step SELECT-then-conditional-UPDATE claim (guarded by
  `.eq('status','pending')`), not `FOR UPDATE SKIP LOCKED`. The code comments
  acknowledge this and flag the RPC upgrade. Safe for a single worker; mild
  double-claim window under many concurrent workers.
- Several `.update()` calls are intentionally unchecked (best-effort): portal status,
  template metadata, error annotation. This is by design but masked the schema drift
  in §4 (the writes failed silently).

---

## 2. `src/lib/autoapply/` module graph

24 modules audited. **No circular dependencies.** Every internal (sibling) import
resolves to a real export:

- `form-filler-agent.ts` → stealth-browser, advanced-field-handler, multi-page-handler,
  document-attacher, document-vault, confirmation-parser ✓
- `document-attacher.ts` → advanced-field-handler, document-vault (re-exports OrgDocument) ✓
- `auto-queue-populator.ts` → compliance-guard, funder-matcher, submission-controls ✓

All other modules depend only on external packages (Supabase, Playwright, Anthropic
SDK, pdf-lib, crypto), so no internal cycles are possible. Each module has a single
clear responsibility and exports its public class/function plus typed interfaces.

**Verdict: clean.** No action required.

---

## 3. Environment variables

Full catalog in the appendix below. Summary:

- **Documented + used:** core infra (Supabase ×3, Anthropic, OpenAI, CRON_SECRET,
  Google OAuth ×3, Stripe ×6, NEXT_PUBLIC_SITE_URL, INTEGRATION_ENCRYPTION_KEY).
- **Used but UNDOCUMENTED in `.env.local.example` (have code fallbacks — non-blocking):**
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, `STORAGE_DOCUMENTS_BUCKET`,
  `STORAGE_REPORTS_BUCKET`, `CREDENTIAL_ENCRYPTION_KEY`, `PORTAL_ENCRYPT_SECRET`,
  `NEXTAUTH_SECRET`, `GEMINI_API_KEY`/`GOOGLE_GENERATIVE_AI_API_KEY`,
  `TWOCAPTCHA_API_KEY`, `AUTOAPPLY_EMAIL`, `AUTOAPPLY_PHONE`, `PROXY_PROVIDER`,
  `PROXY_API_KEY`, `PROXY_LIST`, `INTEGRATION_KEY_SECRET`.
- **Used, UNDOCUMENTED, and NO fallback (highest risk):**
  - `SAM_GOV_API_KEY` — `/api/agents/sam-gov`, `/api/agents/research` (direct use).
  - `BMF_URL` — `src/scripts/import-irs-bmf.ts` (debug override; only the script breaks).
  - `SUPABASE_URL` + `WORKER_ID` — `worker/index.ts` (validated at boot; the worker
    exits if unset, so failure is loud, not silent). Note `worker/index.ts` reads
    `SUPABASE_URL` while the Next app reads `NEXT_PUBLIC_SUPABASE_URL` — reconcile.
- **Documented but unused:** `ANTHROPIC_MODEL`, `ANTHROPIC_MAX_TOKENS` (the model
  `claude-sonnet-4-6` and 8192 tokens are hardcoded in `src/lib/ai/claude.ts`),
  `STRIPE_PUBLISHABLE_KEY` (client-side only / not referenced in scanned source).

---

## 4. Schema drift — columns referenced in code but created by NO migration ⚠️

This is the most serious finding. Cross-referencing `worker/queue-processor.ts` against
`supabase/migrations/*.sql` surfaced **5 missing columns**:

| Table | Column | Code use | Severity |
|-------|--------|----------|----------|
| `funders` | `type` | `.select('… category, type')` (line 294) | **CRITICAL** |
| `organizations` | `contact_email` | `.select('… ein, contact_email')` (line 308) | **HIGH** |
| `funders` | `portal_review_status` | `.update({ portal_review_status })` (line 522) | LOW (guarded) |
| `form_templates` | `auto_generated` | `.update({ auto_generated, … })` (line 532) | MEDIUM |
| `form_templates` | `field_count` | `.update({ field_count, … })` (line 533) | MEDIUM |

Why this matters: a PostgREST `.select()` against a non-existent column returns **HTTP
400**, not null. So:
- **`funders.type`** made `processItem()` throw `funder_fetch_error` for *every* queue
  item → the worker would skip the entire queue.
- **`organizations.contact_email`** made the org-profile fetch error out, silently
  nulling `orgProfile` → no pitch personalization, no EIN/email pre-validation.
- The three `.update()` columns failed silently (unchecked writes) → template metadata
  (`auto_generated`, `field_count`) was never persisted, defeating stale-template
  change-detection.

Existing columns the worker uses are all present: `funders.portal_status` /
`portal_last_checked_at` (migration 050), `autoapply_screenshots.stage` /
`storage_path` / `captured_at` / `metadata` (050), the `request_profiles.*` and
`autoapply_submissions` intelligence columns (`confirmation_data`, `personalized_pitch`,
`optimized_amount`, `timing_score`, `request_profile_id`) (051). Only the 5 above are
missing.

**Fix applied:** new migration `supabase/migrations/053_autoapply_missing_columns.sql`
adds all 5 columns idempotently (`ADD COLUMN IF NOT EXISTS`), backfills
`organizations.contact_email` from `organizations.email`, and documents intent. Safe to
re-run and safe if any column was already applied to prod out-of-band. **This migration
still requires application to prod** (see §Recommended actions).

---

## 5. ESLint — `<img>` elements (fixed)

The recurring `@next/next/no-img-element` warnings (surfaced by `eslint-config-next` in
the IDE; `next build` did not print them because the repo has no `.eslintrc`) were on:

- `settings/branding/page.tsx` — already suppressed before this audit (line 232); also
  note it imports lucide's `Image` icon, so a `next/image` swap there would collide.
- `components/autoapply/SubmissionHistory.tsx` — 2 `<img>` (modal + thumbnail).
- `components/autoapply/ReviewQueue.tsx` — 2 `<img>` (screenshot grid + lightbox).

**Fix applied:** added `// eslint-disable-next-line @next/next/no-img-element` to each of
the 4 unsuppressed tags, and gave the two empty-alt ReviewQueue images meaningful alt
text (`ss.stage`, "Submission screenshot"). `next/image` was deliberately **not** used:
these are remote Supabase Storage URLs and `data:` preview URLs with unknown dimensions,
and `next.config.mjs` ships `images.remotePatterns: []` — `next/image` would 500 at
runtime on the remote hosts until each is whitelisted. The suppress-comment approach
matches the convention already established in the branding page.

---

## 6. Bundle size — `/autoapply` (151 kB route / 422 kB first load)

**Root cause:** the page eagerly imported `SuccessAnalytics`, which statically imports
the entire **recharts** library (Bar, BarChart, ComposedChart, Line, Cell, Legend,
Tooltip, ResponsiveContainer, CartesianGrid, XAxis, YAxis). recharts (~130 kB) is the
single largest contributor; the only other route near this size is `/outcomes/analytics`
(300 kB), which also uses recharts. The other 6 sub-components on the page
(WorkerStatus, QueueMetrics, QueuePreview, QueuePanel, SubmissionHistory, ReviewQueue)
are comparatively small and don't pull charts.

**Fix applied:** `SuccessAnalytics` is now lazy-loaded via `next/dynamic` with
`ssr: false` and a loading placeholder. It renders below the fold (after the queue,
submissions, review queue, and templates), so deferring it to a post-paint client chunk
removes recharts from the route's initial first-load JS.

**Measured impact:** `/autoapply` first-load JS dropped from **422 kB → 315 kB** (−107 kB,
−25%; route-specific JS 151 kB → 150 kB). recharts is now split into a separate chunk
loaded only when the analytics panel mounts. (The `/autoapply/compliance` route grew
5.9 kB → 11.3 kB from bundling the new 41-state dataset — an accepted, isolated cost.)

Further opportunity (not applied — lower ROI, behavior-sensitive): `ReviewQueue` and
`SubmissionHistory` could also be `next/dynamic`'d since they're below the fold, but they
don't carry heavy deps, so the win is marginal.

---

## 7. Build + typecheck

- `pnpm typecheck` (`tsc --noEmit`): **PASS**, zero errors (before and after fixes).
- `pnpm build` (`next build`): **PASS**, compiled successfully, 162 pages generated,
  zero type errors. No code changes were required to make the gates pass — they were
  already green; the audit fixes (img suppressions, dynamic import, new data file,
  compliance UI) preserve green.
- `pnpm lint` standalone is **not runnable** non-interactively: `next lint` prompts to
  scaffold an ESLint config because none exists. See Risks §R3.

---

## 8. New feature — state solicitation registration data + compliance UI

- **`src/lib/autoapply/state-registration-data.ts`** (new): typed dataset of the **41
  jurisdictions** (40 states + DC) that require charitable solicitation registration.
  Each entry: state, abbreviation, agency, registrationFee, registrationPortalUrl,
  renewalFrequency, renewalInfo, exemptionThreshold, notes. Plus `getStateRegistration()`
  lookup, `REGISTRATION_REQUIRED_STATES` set, and a compliance disclaimer constant. The
  10 non-registering states (AZ, DE, ID, IN, IA, MT, NE, SD, VT, WY) are intentionally
  excluded. Agency names + portal URLs are high-confidence; fees/thresholds are reference
  summaries (many are sliding scales) carrying a "verify on the official portal" caveat
  and a `lastReviewed` date.
- **`/autoapply/compliance` page** (enhanced): added a "Registration Requirements by
  State" card with a state dropdown. Selecting a state renders fee, a prominent
  **Register Now** link to the official portal, renewal frequency + detail, exemption
  threshold, notes, and the disclaimer. The existing org-registration table is unchanged.

---

## Remaining risks

- **R1 — Migration 053 not yet applied to prod.** Until applied, the `funders.type` and
  `organizations.contact_email` selects keep breaking the worker read path in any
  environment whose schema lacks those columns. Apply before the next worker run.
- **R2 — Long backlog of unapplied migrations (047–053).** SESSION_STATE lists 047, 048,
  049, 050, 051 as "PENDING MANUAL APPLICATION"; 052 (webhook_configs) and the new 053
  join that list. Verify actual prod state (per project memory, prod ref
  `vbjplpquqxxfbpazyalt` is off-MCP; DDL goes via the Management API + PAT). Code assumes
  these tables/columns exist.
- **R3 — No ESLint config in the repo.** `next build` silently skips linting and
  `next lint` can't run unattended. Warnings only appear in editors. Add a committed
  `.eslintrc.json` (extends `next/core-web-vitals`) so lint is enforced in CI/build.
- **R4 — `worker/` excluded from typecheck.** `tsconfig.json` excludes `worker`, so the
  worker pipeline never gets `tsc` coverage. A separate `worker/tsconfig.json` +
  `typecheck:worker` script would have caught the schema-drift column names at compile
  time (well, the string literals wouldn't, but the worker would at least be type-checked).
- **R5 — Undocumented env vars.** The 16 fallback-having undocumented vars work in dev
  but are invisible to a new operator; `SAM_GOV_API_KEY` has no fallback and isn't
  documented. Add all to `.env.local.example`.
- **R6 — `dequeue()` race window.** SELECT-then-UPDATE claim is safe for one worker;
  add the `FOR UPDATE SKIP LOCKED` RPC before scaling to multiple workers.

---

## Recommended actions before the next phase

1. **Apply migration 053** to prod (and confirm 047–052 are applied). This unblocks the
   worker read path — highest priority.
2. **Commit an `.eslintrc.json`** (`extends: ["next/core-web-vitals"]`) so `next build`
   enforces lint and the img rule actually gates.
3. **Add a worker typecheck** (`worker/tsconfig.json` + `pnpm typecheck:worker`) and run
   it in CI alongside the app typecheck.
4. **Document the undocumented env vars** in `.env.local.example`, especially
   `SAM_GOV_API_KEY`, and reconcile `SUPABASE_URL` (worker) vs `NEXT_PUBLIC_SUPABASE_URL`.
5. **Verify the state registration dataset** against current official portals before
   relying on the fee/threshold figures in client-facing compliance guidance.
6. (Optional) Replace the `dequeue()` claim with a `FOR UPDATE SKIP LOCKED` RPC if more
   than one worker will run concurrently.

---

## Appendix — Environment variable catalog

| Variable | Used in | Code fallback? | In `.env.local.example`? |
|----------|---------|----------------|--------------------------|
| ANTHROPIC_API_KEY | ai/claude, autoapply, intelligence, worker, scripts | No (throws) | Yes |
| NEXT_PUBLIC_SUPABASE_URL | supabase clients, middleware, api, worker, tests | No (throws) | Yes |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | supabase client, middleware | No (throws) | Yes |
| SUPABASE_SERVICE_ROLE_KEY | supabase/admin, worker, scripts | No (throws) | Yes |
| OPENAI_API_KEY | intelligence/embeddings, ingest script | No (throws if used) | Yes |
| CRON_SECRET | cron routes, deadlines/check | No (authz check) | Yes |
| GOOGLE_CLIENT_ID / _SECRET / _REDIRECT_URI | integrations/google/auth | No (throws) | Yes |
| INTEGRATION_ENCRYPTION_KEY | integrations/google/auth | Yes (→ GOOGLE_CLIENT_SECRET) | Yes |
| STRIPE_SECRET_KEY | payments/stripe | Yes (throws in getStripe) | Yes |
| STRIPE_WEBHOOK_SECRET | webhooks/stripe | No | Yes |
| STRIPE_*_PRICE_ID (×3) | payments tier mapping | n/a | Yes |
| STRIPE_PUBLISHABLE_KEY | (unused in scanned source) | n/a | Yes |
| NEXT_PUBLIC_SITE_URL | stripe, api, google, playwright | Yes (localhost/origin) | Yes |
| ANTHROPIC_MODEL / ANTHROPIC_MAX_TOKENS | (unused — hardcoded) | n/a | Yes |
| RESEND_API_KEY | notification-dispatcher, digest-email, outreach/send | Yes (conditional) | **No** |
| RESEND_FROM_EMAIL | notification-dispatcher, digest-email | Yes (default addr) | **No** |
| NEXT_PUBLIC_APP_URL | notification-dispatcher, digest-email, users/invite | Yes | **No** |
| STORAGE_DOCUMENTS_BUCKET / STORAGE_REPORTS_BUCKET | documents/assemble, reports/board | Yes (defaults) | **No** |
| CREDENTIAL_ENCRYPTION_KEY | autoapply/credential-manager | Yes | **No** |
| PORTAL_ENCRYPT_SECRET / NEXTAUTH_SECRET | automation/portal-credentials | Yes (chain + default) | **No** |
| INTEGRATION_KEY_SECRET | crypto/key-encrypt | Yes (padded empty) | **No** |
| GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY | ai/gemini | Yes (one → other) | **No** |
| TWOCAPTCHA_API_KEY | captcha-solver (×2), worker | Yes (Boolean check) | **No** |
| AUTOAPPLY_EMAIL / AUTOAPPLY_PHONE | registration-agent, worker | Yes (defaults) | **No** |
| PROXY_PROVIDER / PROXY_API_KEY / PROXY_LIST | worker proxy-manager | Yes (defaults) | **No** |
| SAM_GOV_API_KEY | agents/sam-gov, agents/research | **No** | **No** |
| SUPABASE_URL | worker/index, scripts | No (validated at boot) | **No** |
| WORKER_ID | worker/index | No (validated at boot) | **No** |
| BMF_URL | scripts/import-irs-bmf | No | **No** |
| CI | playwright.config | Yes | **No** |

---

## Migration status snapshot

Files present: 001–053 (with gaps/duplicate-number quirks: two `002_*`, two `022_*`).
The AutoApply schema is spread across **045** (form_templates, autoapply_submissions,
submission_queue), **050** (funder_credentials, autoapply_screenshots,
autoapply_review_queue, solicitation_registrations, funders.portal_status/_last_checked),
**051** (request_profiles + intelligence columns on autoapply_submissions and
submission_queue.request_profile_id), **052** (webhook_configs), and now **053** (the 5
drift-fix columns). Per project memory, prod is on the Management-API DDL path
(not MCP); confirm 045–053 are all applied there.

---

## Overnight autonomous FORGE chain — results (2026-06-21)

After this audit, the FORGE chain ran **3 queues unattended overnight**. Outcomes
recorded here so the audit reflects the post-run state.

| Queue / Phase | Result |
|---------------|--------|
| Phase 3F — Submission Intelligence | **18 / 18 passed** |
| Phase 3F-GOV (governance) | **10 / 10 passed** |
| Phase 3G + 3H — Multi-channel follow-up + Analytics / Optimization | **12 / 12 passed** |
| Intelligence Library Night 2 | **10 / 13 passed** — `logic-005` FAILED; chain halted, so `logic-006`–`logic-008` never ran |

- **Build:** 175 routes, `npx next build` green.
- **logic-005 failure** was a `GeneratedLogicModel` / `LogicModelData` type mismatch
  (the API nested the five stages under `data` while consumers expected them flat).
  Fixed manually post-chain (commit `2d1bd72`): `GeneratedLogicModel extends
  LogicModelData`, `DraftResult.logicModel` added, and the Intelligence Library /
  draft-generator integration completed. `logic-006`–`logic-008` remain to be run.

### FORGE engine findings
- **Lessons-learned integration (v1.2) shipped** (commit `e34aa3e`). It proved its
  value by **self-correcting `gh-008` on the third attempt** — prior-failure context
  was fed into the retry.
- **Rollback BUG (action item):** the failed-prompt rollback uses `git reset --hard`,
  which does **not** remove untracked files. A failed prompt that created new files
  leaves them behind, polluting the next attempt. **Fix:** add `git clean -fd` to the
  rollback path so it returns to a truly clean tree.

### Schema drift follow-up
- **Migration 053 has been applied to prod** — the 5 drift-fix columns flagged in §4
  (`funders.type`, `organizations.contact_email`, `form_templates.auto_generated`,
  `form_templates.field_count`, `funders.portal_review_status`) are now present. The
  §4 risk is resolved pending a spot-check of the worker `.select()`/`.update()` paths.

### Compliance data
- Solicitation-registration dataset for **41 jurisdictions** (40 states + DC) added to
  `/autoapply/compliance` (`src/lib/autoapply/state-registration-data.ts`).

### Next phase
**Phase 4 — Email / Calendar Integration + Admin Sales Outreach Engine.**
