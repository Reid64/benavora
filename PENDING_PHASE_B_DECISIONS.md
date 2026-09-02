# PENDING PHASE B DECISIONS — TARRITRIX 1.0

**Status:** Decisions approved by operator in Claude.ai architect session 2026-05-06 / 2026-05-07. NOT yet integrated into MASTER_BUILD_SPEC.md, BLUEPRINT.md, SCHEMA_REGISTRY.md, AGENTS.md, BEHAVIORAL_CONTRACTS.md, or PROMPT_EXECUTION_SEQUENCE.md.

**Action required:** Audit Phase B reconciliation prompt must integrate every decision below into the relevant governance files before any Phase 1 build work resumes beyond Sentry verification and audit Phase A6-A12.

**Decision authority:** Operator (Reid) approved each item explicitly via Claude.ai chat. No autonomous architectural drift was introduced — each item was discussed, challenged, and confirmed.

**File destination on commit:** Repo root: `PENDING_PHASE_B_DECISIONS.md`. To be deleted after Phase B reconciliation integrates all sections into permanent governance docs.

---

## SECTION 1 — TIER STRUCTURE REVISION

**Approved tier sizing (replaces current Starter 5 / Growth 45 / Authority 150):**

| Tier | Cities | Services | Max Pages | Setup Fee | Monthly |
|------|--------|----------|-----------|-----------|---------|
| Starter | 10 | 3 | 30 | $997 | $497 |
| Growth | 20 | 5 | 100 | $2,497 | $997 |
| Authority | 35 | 6 | 210 | $4,997 | $1,997 |

**Pricing remains unchanged.** Page counts and city/service combinations changed.

**Approved drip rates (more conservative than original blueprint to defend velocity-throttling moat):**

| Tier | Phase 1 (Days 1-30) | Phase 2 (Days 31-60) | Phase 3 (Days 61+) |
|------|---------------------|----------------------|---------------------|
| Starter | 3/day | 5/day | 7/day |
| Growth | 5/day | 8/day | 12/day |
| Authority | 6/day | 11/day | 16/day |

±20% variance per Contract 15 still applies.

**Files to update in Phase B:**
- MASTER_BUILD_SPEC.md Section 1, Section 5.6 (pricing cards), Section 15 (Stripe products)
- BLUEPRINT.md PART 2 (Business Model)
- supabase/migrations/ — new migration to update pricing_tiers seed data
- src/components/marketing/PricingSection.tsx — update copy
- Stripe products — recreate via API with new tier metadata (page counts, city/service caps)

---

## SECTION 2 — EVIDENCE-JUSTIFIED PAGE PUBLISHING (3-STAGE HYBRID UNLOCK)

**Replaces the prior tier model where page count was a flat ceiling. Now page count is a ceiling unlocked progressively as evidence depth grows.**

**Three stages per tier:**

| Stage | Evidence Threshold | Pages Unlocked |
|-------|--------------------|-----------------|
| Stage 1: Starter Library | Tier minimum (5 photos + 1 case study + 3 claimed facts) | 30% of tier max |
| Stage 2: Core Library | 50% of full evidence threshold | 70% of tier max |
| Stage 3: Full Library | Full evidence threshold | 100% of tier max |

**Concrete examples:**

- Starter (30 pages max): Stage 1 unlocks 9 pages, Stage 2 unlocks 21 pages, Stage 3 unlocks 30 pages
- Growth (100 pages max): Stage 1 unlocks 30 pages, Stage 2 unlocks 70 pages, Stage 3 unlocks 100 pages
- Authority (210 pages max): Stage 1 unlocks 63 pages, Stage 2 unlocks 147 pages, Stage 3 unlocks 210 pages

**Onboarding behavior (NOT a hard block):**

- Wizard completes with Stage 1 minimum evidence (low friction sales motion)
- Operator dashboard surfaces "Client X is at 60% to Stage 2 threshold" as Next Best Action via Recommendations Engine
- Client portal shows progress bar: "You're at Stage 1 — upload 12 more photos to unlock 40 more pages"

**A-05 new Gate 8 — Evidence Sufficiency:**

- A-02 still drafts pages even when locked (no wasted work)
- A-05 Gate 8 sets pages.status = 'evidence_locked' if evidence threshold for the page's required stage is not met
- CRON-01 ignores evidence_locked pages (only publishes status = 'queued')
- When client uploads more evidence, A-10 reruns evidence sufficiency check, A-05 Gate 8 re-evaluates, locks lift in bulk
- Pages enter the publishable queue and drip naturally per tier rates

**Files to update in Phase B:**
- MASTER_BUILD_SPEC.md Section 1 (Agents) and new Section
- BLUEPRINT.md A-05 contract update (add Gate 8)
- BLUEPRINT.md A-10 contract update (evidence-aware drafting)
- AGENTS.md A-05 boundaries (evidence_locked is a permitted status)
- SCHEMA_REGISTRY.md — new column pages.evidence_lock_status (enum: 'unlocked', 'locked_stage_2', 'locked_stage_3')
- SCHEMA_REGISTRY.md — new table client_evidence_progress
- supabase/migrations/ — new migration for the schema additions

---

## SECTION 3 — PER-PAGE ANALYTICS + DASHBOARDS

**Approved as in-scope Phase 1 addition.**

**Components:**

- PostHog wiring on every published page (currently in env, not yet implemented per audit Phase A8)
- New page_metrics rollup table — per-page: page_id, views_total, views_30d, conversions_total, conversion_rate, last_view_at, last_conversion_at, performance_tier (high/median/low)
- Edge Function rolls PostHog events into page_metrics every 5 minutes
- Operator dashboard: Client Detail Pages tab shows analytics view per client
- Client portal: My Pages shows per-page performance, RLS-filtered to client only
- Real-time polling at 30 seconds (consistent with existing architecture)

**New build prompt to add to PROMPT_EXECUTION_SEQUENCE.md:**

- Prompt 9.5 (NEW): "Wire PostHog with per-page tracking. Build page_metrics rollup edge function (CRON every 5 min). Add analytics tabs to Surface 4 (Client Detail Pages tab) and Surface 6 (Client Portal My Pages with metrics)."

**Files to update in Phase B:**
- MASTER_BUILD_SPEC.md new Section 21
- MASTER_BUILD_SPEC.md Section 7 (Operator Command Center) note about Pages tab
- MASTER_BUILD_SPEC.md Section 10 (Client Portal) expand My Pages spec
- MASTER_BUILD_SPEC.md Phase 1 Exit Criteria (add PostHog tracking + page_metrics + dashboards)
- SCHEMA_REGISTRY.md — new table page_metrics
- PROMPT_EXECUTION_SEQUENCE.md — insert Prompt 9.5

---

## SECTION 4 — PERFORMANCE-AWARE CONTENT GENERATION (A-10 / A-11 FEEDBACK LOOP)

**Approved as in-scope Phase 1 addition. Differentiating feature — closed-loop learning system.**

**A-10 (Content Profile Builder) update:**

- Reads page_metrics when building new content profiles for the same client
- Computes weighted preference based on historical conversion rates of profile shapes
- Biases new generation toward winners
- Maintains minimum 30% exploration / 70% exploitation (see Contract 34 below)

**A-11 (Content Refresh Engine) update:**

- Uses page_metrics.conversion_rate as primary input to refresh prioritization
- Replaces simple "last_refreshed_at > 90 days" logic
- Pages with conversion rate < 0.5% get refreshed first
- Pages above median get left alone

**New Contract 34 — Performance Feedback Loop Discipline:**

A-10 must never bias 100% toward winners (would collapse content variety). Maintain at least 30% exploration / 70% exploitation. Variety is a Google penalty defense; pure optimization is a Google penalty risk.

**Files to update in Phase B:**
- BLUEPRINT.md A-10 contract update
- BLUEPRINT.md A-11 contract update
- BEHAVIORAL_CONTRACTS.md add Contract 34
- MASTER_BUILD_SPEC.md Section 11 (Recommendations Engine) add new category: "Performance — pages converting below threshold N days running"

---

## SECTION 5 — GEO-GRID VISUALIZATION (LAYERS 1A + 1B)

**Approved as in-scope Phase 1 addition. Layer 2 (Google ranking data) deferred to Phase 1.5+.**

**Layer 1a — Evidence density geo-grid:**

- Color-coded grid showing EXIF-verified job photos per geographic cell
- Pin colors based on photo density (green = many photos, yellow = few, red = none)
- Click pin → see actual photos with timestamps and GPS
- Powered by service_area_heatmaps table + EXIF data from job_evidence + photos table

**Layer 1b — Page performance geo-grid:**

- Color-coded grid showing Tarritrix-generated pages per cell
- Pin colors based on conversion performance (green = high-converting, yellow = published low engagement, red = locked or no page)
- Click pin → see page status (live/queued/locked), views 30d, conversions, conversion rate

**Side-by-side display:**

- Toggle or split-view to show Layer 1a and Layer 1b simultaneously
- Mobile: stacked layout
- Desktop: side-by-side

**Visible in:**
- Operator dashboard: Client Detail (new sub-tab)
- Client portal: My Pages (new Geographic View sub-tab)
- Marketing demo: prospects see partial preview during demo call (Personalized Demo Engine Tier 2 per Contract 31)

**Layer 2 — Google rank tracking (DEFERRED to Phase 1.5):**

- Powered by SerpAPI, Serper.dev, or DataForSEO (operator confirmed Path A — managed search API, not proprietary scraper)
- Behind feature flag platform_config.enabled = false until Phase 1.5
- Cost will be passed through as cost-of-goods-sold or absorbed in margin
- Provider selection deferred — recommend Serper.dev for cost ($50/mo for 50k searches) but operator decides at Phase 1.5 entry

**Files to update in Phase B:**
- MASTER_BUILD_SPEC.md new Section 22
- SCHEMA_REGISTRY.md — extend service_area_heatmaps for per-grid-cell page assignment + metric overlay
- SCHEMA_REGISTRY.md — possibly new geo_grid_cells table
- New API endpoint: /api/clients/[id]/geo-grid
- New component: src/components/dashboard/GeoGridMap.tsx
- New component: src/components/portal/GeoGridMap.tsx
- PROMPT_EXECUTION_SEQUENCE.md — Prompt 9.5 (or 9.6) extends to include geo-grid
- platform_config seed: add 'geo_grid_layer_2_rankings' = false

---

## SECTION 6 — EXIF-POWERED EVIDENCE PIPELINE

**Approved as in-scope Phase 1 enhancement to A-18.**

**Mobile photo upload flow:**

- New flow in client portal: mobile-friendly photo picker that preserves EXIF metadata
- Native mobile picker preserves EXIF (drag-drop or share-sheet flows often strip)
- Drag-drop also preserves EXIF (browser-side, not via SMS/social)
- Email upload paths must be deprecated for evidence — EXIF gets stripped

**A-18 (Job Evidence Ingestion Engine) enhancement:**

- Mandatory EXIF extraction on every photo upload
- Validation pipeline:
  - Cross-reference EXIF GPS against client's declared service area — flag anomalies
  - Timestamp sanity (not in future, not implausibly old)
  - Camera fingerprint logging for fraud detection
  - Cross-reference storm-related photos against weather data when storm context is claimed
- Anomaly flagging surfaces in operator dashboard for manual review
- EXIF-verified photos count toward client_evidence_progress thresholds (Section 2)

**EXIF accuracy bucketing:**

- Use 200-500m grid cells for geo-grid plotting (account for GPS sensor variance)
- Photos with no GPS data are accepted but do not count toward evidence threshold
- Photos with GPS data > 500m outside service area are flagged but not auto-rejected

**Files to update in Phase B:**
- BLUEPRINT.md A-18 contract update
- SCHEMA_REGISTRY.md — new columns on job_evidence: exif_lat, exif_lng, exif_timestamp, exif_camera, exif_validated_at, exif_anomaly_flag
- New library dep: pnpm add exifr (for EXIF parsing)
- New component: src/components/portal/MobilePhotoUpload.tsx with EXIF preservation guarantees
- AGENTS.md A-18 boundaries (must reject photos without verifiable upload path)

---

## SECTION 7 — NEW BEHAVIORAL CONTRACTS

**Three new contracts to add to BEHAVIORAL_CONTRACTS.md in Phase B:**

### Contract 32 — Prompt Completion Discipline

When mid-prompt, no new work begins until the current prompt is fully executed and the commit hash is reported. No pivots to other phases. No "alternative path" offers. No "which direction?" questions when the direction was already given. The prompt in flight is the only work in scope until its terminal step completes. If blocked at any step, stop and report the blocker — do not freelance to other tasks. Any deviation is a Contract 32 violation and is logged to STATE_OF_THE_BUILD.md.

### Contract 33 — Credential Handling Discipline

Credentials (API keys, tokens, secrets, passwords) must never be passed to CLI commands via stdin echo, command-line flags, or any method that writes the value to terminal history or logs. Use interactive prompts only. If a tool requires non-interactive credential input, use environment variables loaded from .env.local at process start, never inline. Any credential that touches terminal history or session logs is considered exposed and must be rotated.

Public identifiers (org slugs, project names, region names, public DSNs that are explicitly designed to be embedded in client bundles) are not credentials and may use --value flags or echo pipes for convenience.

### Contract 34 — Performance Feedback Loop Discipline

A-10 (Content Profile Builder) must never bias more than 70% toward historical winners when generating new content profiles. Minimum 30% must remain exploratory (new profile shapes, new evidence combinations, new geographic angles). Pure optimization toward proven winners would collapse content variety, which is itself a Google penalty risk. Variety is a moat ingredient, not a quality compromise.

---

## SECTION 8 — pnpm verify ENHANCEMENTS (PHASE C INSTALL)

**Operator approved adding governance linters to the pre-commit gate. To be installed in audit Phase C.**

**New script: scripts/governance-lint.ts**

Called from pnpm verify. Performs:

- **Time-estimate grep:** scans staged commit messages, STATE_OF_THE_BUILD.md, and any modified .md files for forbidden phrases: 'approximately', '~', 'minutes', 'hours', 'days', 'should be done in', 'will take', 'estimated', 'roughly N', 'about N'. Match → commit blocked with Contract 23 reference.
- **Severity-language grep:** scans for 'emergency', 'production incident', 'critical', 'catastrophic', 'disaster' in commits and docs while LAUNCH_STATE env var = 'pre-launch'. Match → commit blocked with reminder that severity language is reserved for actual customer-impacting events.
- **playwright.config.ts env-loading assertion:** confirms webServer block has env spread referencing .env.local. Catches the regression class that broke this session.
- **.env.local sanity check:** confirms no concatenated lines (line 1 corruption from this session), no duplicate keys, all required keys present per .env.example.

**Files to create/update in Phase C:**
- scripts/governance-lint.ts (new)
- scripts/verify-env.ts (new)
- package.json — pnpm verify script extended to call governance-lint and verify-env
- .env.example (new) — documents every required key, Phase D deliverable

---

## SECTION 9 — DEFERRED FEATURES (DOCUMENTED FOR FUTURE PHASES)

**These were discussed and explicitly deferred. Document in BLUEPRINT.md Future Phases section to ensure they are not forgotten.**

- **Visual/template differentiation engine** — Phase 2. Library of 10-20 page templates with randomized component composition. Phase 1 page template must be built modularly so Phase 2 swap is not a rewrite.
- **Layer 3 geo-grid (Google rank tracking)** — Phase 1.5. Behind feature flag. Provider TBD (Serper.dev recommended, operator decides at activation).
- **Enriched lead download ($1/lead pay-per-download)** — Phase 2+. Per existing memory entry. Requires ATTOM API + Stripe per-download flow.
- **Personalized Demo Engine Tier 4 — Social Lead Intelligence with Identity Reconciliation** — Phase 3+. Per existing memory entry. Requires legal review, data licensing, $1k-10k/mo infrastructure.
- **Proprietary rank scraper** (vs SerpAPI rental) — only if Phase 2 unit economics justify. Adds significant scope: residential proxy pools, browser fingerprint randomization, CAPTCHA solving infrastructure, ongoing maintenance burden.

---

## SECTION 10 — PRE-LAUNCH CREDENTIAL ROTATION QUEUE

**Credentials exposed during this session that must be rotated before site goes live to public traffic:**

- SENTRY_AUTH_TOKEN — exposed via PowerShell echo pipe in terminal history during Sentry wiring
- SENTRY_DSN — exposed in same history (DSN is public-safe by design but logged for completeness)

**Process:**

- Operator revokes current values in Sentry settings
- Operator generates new values
- Operator updates .env.local
- Operator runs vercel env rm + vercel env add (interactive prompt, not echo pipe)
- Operator clears PowerShell history: Clear-History
- Operator closes and reopens terminal to clear scrollback

**This applies to any credential that gets exposed in any future Claude Code session. Per Contract 33.**

---

## SECTION 11 — AUDIT PHASE B INTEGRATION CHECKLIST

When audit Phase B prompt is drafted, it must:

- [ ] Update MASTER_BUILD_SPEC.md per Sections 1, 2, 3, 4, 5, 6 above
- [ ] Update BLUEPRINT.md per Sections 1, 2, 4, 6 (A-05, A-10, A-11, A-18 contract updates)
- [ ] Update SCHEMA_REGISTRY.md per Sections 2, 3, 5, 6 (new tables and columns)
- [ ] Update AGENTS.md per Sections 2, 6 (A-05 evidence_locked permitted status, A-18 photo path requirements)
- [ ] Update BEHAVIORAL_CONTRACTS.md per Section 7 (Contracts 32, 33, 34)
- [ ] Update PROMPT_EXECUTION_SEQUENCE.md per Sections 3, 5 (Prompt 9.5 insertion)
- [ ] Write new migration file for schema additions (one migration covering all Section 2/3/5/6 changes)
- [ ] Update Stripe products via API for new tier metadata (Section 1)
- [ ] Document Section 9 deferrals in BLUEPRINT.md Future Phases section
- [ ] Add Section 10 to a new LAUNCH_CHECKLIST.md or to STATE_OF_THE_BUILD.md
- [ ] Implement Section 13 (CI split for E2E)
- [ ] After all updates, delete this PENDING_PHASE_B_DECISIONS.md file (it is a transient bridge document)

---

## SECTION 12 — TEMP-SKIPPED E2E TESTS (SUPERSEDED BY SECTION 13)

**Status:** Original plan to skip 10 failing E2E tests via .skip() annotations is OBSOLETE. Operator approved Section 13 (move E2E from pre-commit to CI-only) which solves the same problem architecturally without skipping individual tests.

**No action required from this section. See Section 13.**

---

## SECTION 13 — MOVE E2E FROM PRE-COMMIT TO CI-ONLY (PHASE B PRIORITY)

**Approved by operator 2026-05-07 after diagnosing repeated pre-commit blockers caused by 10 broken pre-existing E2E tests. This is THE FIRST TASK for fresh Claude Code post-reset, before any other Phase B work.**

**Architectural rationale:**

- Pre-commit hook is appropriate for fast checks (tsc, vitest unit, integration)
- E2E tests are slow, flaky, and high-maintenance — not appropriate for blocking every local commit
- Industry standard: E2E runs in CI on push, blocks deploy via Vercel GitHub integration
- Honors Contract 22 spirit (verification gate exists and is enforced) at the appropriate stage for each test tier
- Fixes the immediate blocker: 10 broken E2E tests no longer prevent committing legitimate WIP

**Implementation:**

1. **Split package.json scripts:**
   - `verify:fast` = `tsc --noEmit && vitest run` (used by pre-commit hook)
   - `verify:full` = `tsc --noEmit && vitest run && playwright test` (used by CI)
   - `verify` aliases to `verify:full` for backward compatibility

2. **Update Husky pre-commit hook:**
   - `.husky/pre-commit` calls `pnpm verify:fast` only

3. **Add GitHub Actions workflow:**
   - `.github/workflows/ci.yml` runs `pnpm verify:full` on every push to master
   - Failed CI blocks Vercel deploy via Vercel's GitHub integration setting

4. **Verify Vercel GitHub integration is set to require CI pass:**
   - Vercel project settings → Git → "Wait for checks" enabled

5. **The 10 broken E2E tests then become Phase D debt** (not Phase B blocker):
   - They still need to be diagnosed and fixed before Phase 1 exit
   - But they no longer block local commits or partial WIP states
   - Diagnostic work happens in dedicated session with fresh context

**Contract 22 amendment to draft for Phase D:**

> Contract 22 verification gate runs appropriate-tier checks at appropriate stages. Pre-commit runs fast checks (tsc, unit, integration). CI runs full suite (E2E, schema drift detector, tenant isolation suite, governance lint). Both layers are mandatory. Neither layer may be bypassed. Pre-commit's `verify:fast` and CI's `verify:full` together enforce the same protection as a single monolithic verify, with appropriate latency for each test tier.

**Files to create/update in Phase B (this is the first task):**
- package.json — split verify scripts
- .husky/pre-commit — call verify:fast
- .github/workflows/ci.yml — new file, runs verify:full on push
- BEHAVIORAL_CONTRACTS.md — Contract 22 amendment per above
- STATE_OF_THE_BUILD.md — document the split

**After Section 13 lands, the original Sentry WIP commit + this PENDING_PHASE_B_DECISIONS.md commit + STATE update can proceed cleanly because pre-commit will pass.**

---

## SECTION 14 — RESUMPTION SEQUENCE FOR FRESH CLAUDE CODE

**This is the order of operations for the fresh Claude Code session post-reset:**

1. Read all 7 governance documents (per AGENTS.md Mandatory Session Start Protocol)
2. Read this PENDING_PHASE_B_DECISIONS.md in full
3. Run `git status` — see uncommitted Sentry config files, playwright.config.ts patch, .env.local additions, sentry-test route, untracked backup files
4. Execute Section 13 (split verify scripts, update Husky, add CI workflow) — this is the FIRST task
5. Once verify:fast passes pre-commit, commit Sentry WIP + Section 13 changes + PENDING_PHASE_B_DECISIONS.md (operator pastes content from saved external copy)
6. Add SENTRY_ORG and SENTRY_PROJECT to Vercel production
7. Update STATE_OF_THE_BUILD.md with Last Compact Summary + Sentry-near-completion + Section 13 implemented
8. Commit STATE update
9. Push everything
10. Restart dev server (rmdir .next then pnpm dev), hit /api/sentry-test, operator verifies test event in Sentry dashboard
11. Once verified, delete sentry-test route, commit, push
12. Then proceed to deep audit Phase A6-A12
13. Then audit Phase B reconciliation prompt — INTEGRATE SECTIONS 1-13 of this document into governance files
14. Then audit Phase C (install verify-schema, tenant-isolation suite, governance-lint, env verify)
15. Then audit Phase D (final report, commit, greenlight)
16. Then Prompt 7 (Operator Command Center Zone 1)

---

**END OF PENDING_PHASE_B_DECISIONS.md**
