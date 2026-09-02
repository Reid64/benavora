# TARRITRIX 1.0 — AGENTS.md DELTA SPECIFICATION (REVISION 1)

**Document ID:** AGENTS_DELTA
**Version:** 1.1 (REV 1 — Phase 1 shipped-agent status correction)
**Status:** DRAFT — Pending operator approval
**Authored:** 2026-05-23 (REV 1 revision)
**Supersedes:** AGENTS_DELTA.md Version 1.0 (delivered earlier in this session)

**REV 1 change summary (from V1.0):**

During authoring of Document 7 (STATE_OF_THE_BUILD_DELTA), inspection of the actual STATE_OF_THE_BUILD.md revealed that A-01, A-02, A-03, A-04, A-05, A-06, and A-07 are ALL shipped — not just A-01 as the compacted summary stated. REV 1 corrects four locations in the original document:

1. Section 3.2 (lines being replaced in original) — unchanged; still reflects what's in source file
2. Section 3.3 (replacement content) — updated to show all 7 shipped agents with commit references
3. Section 3.3 "Next Priority" guidance — updated to reflect that A-08 is the next available agent build apart from RBAC + A-44
4. Section 3.4 explanatory note — rewritten to acknowledge 7-agent shipped state, not 1-agent

All other content in REV 1 is identical to V1.0. The architectural decisions, contract enforcements, and surgical change inventory are unchanged.

**Authored:** 2026-05-23 (original V1.0)
**Author:** Lead Architect (Claude, acting on operator authorization)
**Operator:** Reid Whitesides
**Scope:** Surgical edits to `AGENTS.md` to propagate A-44 phase relocation, the A-21/A-44 conflict resolution (relocating mis-filed geographic capabilities to A-21 Hyperlocal Geographic Engine where they architecturally belong), Phase 1 agent count and sequence updates, RBAC-aware executor permissions, and Contract 71/72/73 awareness for Claude Code build executors.

**This document is Document 5 of 8 in the governance synchronization series.** AGENTS.md is the file Claude Code reads at the start of every build session. Per Contract 24 (Deep Research Protocol) and Contract 25 (Anti-Hallucination Header), every CC prompt prepends a directive to read AGENTS.md first. Errors in this file propagate to every future build session.

**Source file state at time of authoring:** `/mnt/project/AGENTS.md`, 1,475 lines, last modified per project upload timestamp 2026-05-23 17:32.

**Read every diff before approving.**

---

## 1. SUMMARY OF CHANGES

This delta makes the following changes to AGENTS.md:

| # | Type | Location | Purpose |
|---|---|---|---|
| 1 | INSERT | After line 67 (end of "You are NOT permitted to" list) | Add RBAC-aware executor restrictions (Contract 71 helper requirement, no direct role checks, no A-02 execution without A-44 ingestion verified per Contract 73) |
| 2 | REPLACE | Lines 511–525 (Phase 1 Agents (14) — NOT STARTED list) | Update agent count from 14 to 15; insert A-44 in correct sequence position between A-01 and A-02; update next-priority guidance |
| 3 | REPLACE | Lines 527–531 (CRON Jobs (2) — NOT SCHEDULED list) | Update CRON count from 2 to 3; add CRON-03 a44-quarterly-refresh |
| 4 | REPLACE | Lines 537–554 (A-02 Page Generator spec) | Add Contract 73 dependency note explicitly stating A-02 cannot execute until A-44 produces successful current ingestion version |
| 5 | INSERT | After line 554 (end of A-02 dependencies) | Add new section "A-44: Client Knowledge Ingestion Engine (Phase 1)" in Phase 1 Agent Specifications, with full canonical spec mirroring BLUEPRINT.md Part 10.5 |
| 6 | REPLACE | Lines 611–675 (A-21 Hyperlocal Geographic Engine spec) | Add relocated geographic capability augmentations (parcel-density classification, neighborhood topology classification, municipal context enrichment) that were mis-filed under BLUEPRINT's deleted "A-21 Client Site Ingestion" section |
| 7 | REPLACE | Lines 1320–1370 (existing A-44 spec at Phase 1.5 location) | Replace with cross-reference note pointing to new Phase 1 location (Change 5) |
| 8 | INSERT | After line 504 (end of Activity Formatter section) and before "## PHASE 1 AGENT BUILD STATUS" | Add new section "RBAC AWARENESS FOR BUILD EXECUTORS" that briefs the executor on Contracts 71/72/73 |

**Net effect on AGENTS.md:**
- Lines deleted: approximately 55
- Lines added: approximately 380
- Net line delta: +325 lines, ending file at ~1,800 lines

**Zero changes to:**
- Section "CANONICAL INSTRUCTION (PREPENDED TO EVERY PROMPT)" — required reading list already covers the 5 governance files
- Section "WHAT YOU ARE" / "WHAT YOU ARE NOT" intro (lines 21–38)
- Section "YOUR OPERATIONAL BOUNDARIES — You ARE permitted to" (lines 41–50)
- Decision-making hierarchy (lines 71–82)
- Session start/end protocols (lines 86–121)
- Deep research / failure loops / hallucination / compacting / automation / error handling / phase enforcement sections (lines 122–207)
- Six Laws and Reporting Format sections (lines 208–234)
- Mid-build change protocol (lines 235–283)
- B1/B2/B3 infrastructure completion records (lines 284–503)
- A-05 Page Validator spec (lines 556–571)
- A-06 Internal Linker spec (lines 572–585)
- Vendor Decisions section (lines 586–610)
- Distributed Relevance Maintenance System sections (lines 678–887)
- AEO/Voice/Conversion sections (A-25, A-26, A-27, A-46, A-47)
- Defensive Infrastructure sections (A-38, A-39, A-42)
- Authenticity/Trust/Ingestion intro (line 1205)
- A-40, A-41, A-43, A-45 specs
- A-31 Lead Download Engine deferred slot
- All "Additional capabilities (2026-05-17 augmentation)" blocks except the one being relocated to A-21

---

## 2. CHANGE 1: Add RBAC-Aware Executor Restrictions

### 2.1 Context

The "You are NOT permitted to" list (lines 51–67) defines hard constraints on the Claude Code build executor. Five new constraints are needed to enforce RBAC and A-44 architecture at the executor level.

### 2.2 Insertion location

Insert immediately after line 67 (the line that reads `- Defer any item from MASTER_BUILD_SPEC.md without explicit operator written permission`) and before line 69 (the `---` separator).

### 2.3 Content to insert

```
- Implement any operator-side API route without using `getOperatorContext()` (Contract 70) AND `getUserActiveRole()` + `hasPermission()` from `src/lib/auth/role-context.ts` (Contract 71). Direct role checks via `user.role ===` or `getRole(` are Contract 71 violations and blocked by `scripts/verify-rbac-pattern.ts`.
- Insert a row into `user_actions` without providing all three audit attribution columns (`acting_user_id`, `acting_user_role`, `client_id` where applicable). Contract 72 violations are blocked by `scripts/verify-audit-attribution.ts`.
- Execute A-02 Page Generator for a client without first verifying that `client_ingestion_versions` contains a row with `is_current=TRUE` AND `status='success'` (or `'manually_provided'` per Contract 73 override path) for that client. Contract 73 throw a `ContractViolationError` at A-02 entry if the prerequisite is unmet.
- Use the legacy single-operator RLS pattern `client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid())` on any new table created after 2026-05-23. New tables use Pattern A: `user_has_operator_role(auth.uid())` per SCHEMA_REGISTRY.md RLS Verification section. Pattern C is deprecated and being phased out.
- Write new audit-logged actions to `operator_actions` table. That table is DEPRECATED FOR NEW WRITES as of 2026-05-23. All new audit logging targets `user_actions` (Table 85). Operator_actions is preserved for historical data only.
```

### 2.4 Rationale

The "You are NOT permitted to" list is the executor's constitutional restriction layer. Every constraint here is enforced by a verification script that blocks commits. Adding the RBAC and A-44 constraints to this list ensures that any future CC session building Phase 1 code physically cannot ship code that bypasses Contracts 71/72/73 — the constraints will block at pre-commit hook before they can reach the repository.

The order of constraints in the list is approximately by severity (auth/middleware first, schema mutation rules in the middle, anti-failure/process rules last). The new RBAC/A-44 constraints insert at the end of the existing list as Contract-numbered enforcement adjacent to the existing Contract 22 / Contract 28 / Contract 48 rules.

---

## 3. CHANGE 2: Update Phase 1 Agent Count and Sequence

### 3.1 Context

The "Phase 1 Agents (14) — NOT STARTED" list at lines 511–525 enumerates the Phase 1 build queue. With A-44 relocated to Phase 1, the count becomes 15 and A-44 must appear in correct sequence position. The "Next Priority" guidance at line 531 must also update.

### 3.2 Lines being replaced

Lines 511 through 531 currently read:

```
### Phase 1 Agents (14) — ⏳ NOT STARTED
- A-01 Intake Processor
- A-02 Page Generator
- A-03 Schema Generator
- A-04 Map Embed Generator
- A-05 Page Validator (15 gates)
- A-06 Internal Link Builder
- A-07 Sitemap Generator
- A-08 Indexation Tracker
- A-09 Conversion Handler
- A-10 Content Profile Builder (with heatmap)
- A-11 Content Refresh Engine
- A-14 Review Velocity Engine
- A-18 Job Evidence Ingestion Engine
- A-19 Universal Integration Hub

### CRON Jobs (2) — ⏳ NOT SCHEDULED
- CRON-01 Drip Publisher (3am UTC daily)
- CRON-02 Indexation Runner (6am UTC daily)

**Next Priority:** A-01 Intake Processor (first Phase 1 agent build, depends on B1/B2/B3 foundation)
```

### 3.3 Replacement content

```
### Phase 1 Agents (15) — 7 SHIPPED, 8 REMAINING (verified 2026-05-23 against STATE_OF_THE_BUILD.md)

Listed in execution sequence order per BLUEPRINT.md Section 4.2 Post-Onboarding Pipeline:

- A-01 Intake Processor ✅ SHIPPED 2026-05-18 (commit b4c03d2)
- A-44 Client Knowledge Ingestion Engine — ⏳ NOT STARTED — relocated to Phase 1 per 2026-05-23 governance synchronization (was Phase 1.5)
- A-10 Content Profile Builder (with heatmap) — ⏳ NOT STARTED
- A-02 Page Generator ✅ SHIPPED 2026-05-18 (commit 8b09e21) [6/6 Playwright tests passing] + Service Hub support (2026-05-20)
  ⚠️ Contract 73 enforcement PENDING per P11 work item 8 — A-02 entry point must be updated to verify A-44 prerequisite. Synthetic baseline (Migration N+8) preserves existing E4 page generation until real A-44 scrape runs.
- A-03 Schema Generator ✅ SHIPPED 2026-05-19 (commit 1e67ed5) [5/5 Playwright tests passing]
- A-04 Map Embed Generator ✅ SHIPPED 2026-05-20 (commit eb69b83) [5/5 Playwright tests passing]
- A-05 Page Validator (16 gates) ✅ SHIPPED 2026-05-20 (commit 1123e0d) [8/8 Playwright tests passing] + G16 Hub Completeness (2026-05-20)
- A-06 Internal Link Builder ✅ SHIPPED 2026-05-20 [7/7 Playwright tests passing]
- A-07 Sitemap Generator ✅ SHIPPED 2026-05-19 (commit pending verification) [6/6 Playwright tests TBD]
- A-08 Indexation Tracker — ⏳ NOT STARTED [PRIORITY: gates external client onboarding; can build in parallel with RBAC foundation per P11 exception]
- A-09 Conversion Handler — ⏳ NOT STARTED
- A-11 Content Refresh Engine — ⏳ NOT STARTED
- A-14 Review Velocity Engine — ⏳ NOT STARTED
- A-18 Job Evidence Ingestion Engine — ⏳ NOT STARTED
- A-19 Universal Integration Hub — ⏳ NOT STARTED

**Build order (mandatory sequence per MASTER_BUILD_SPEC.md Section 25 RBAC and A-44 Build Sequence):**

1. RBAC foundation (Migrations N+1 through N+8 from SCHEMA_REGISTRY.md) — schema layer
2. RBAC code layer (permission-matrix.ts, role-context.ts, verification scripts)
3. RBAC UI surfaces (/dashboard/users, /dashboard/audit, /dashboard/clients/[id] Tab 7)
4. A-44 Client Knowledge Ingestion Engine implementation
5. CRON-03 a44-quarterly-refresh scheduling
6. A-02 entry point updated to enforce Contract 73 check (refactors shipped A-02 to add the prerequisite verification)
7. Legacy operator routes refactored route-by-route from Contract 67 pattern to Contract 71 pattern
8. Then remaining Phase 1 agents (A-08, A-09, A-10, A-11, A-14, A-18, A-19) per existing dependency chain

### CRON Jobs (3) — ⏳ NOT SCHEDULED
- CRON-01 Drip Publisher (3am UTC daily)
- CRON-02 Indexation Runner (6am UTC daily)
- CRON-03 a44-quarterly-refresh (daily evaluation, fires per client when `clients.next_ingestion_scheduled_at <= NOW()` with ±7 day jitter)

**Next Priority:** RBAC foundation (Migrations N+1 through N+8 plus permission-matrix.ts + role-context.ts library) — the next agent build is A-44, which depends on RBAC foundation being in place first because A-44 writes to client_ingestion_versions (one of the RBAC migration's new tables). A-08 Indexation Tracker can build in parallel with RBAC foundation per the P11 exception declared in STATE_OF_THE_BUILD.md.
```

### 3.4 Note on shipped agent status (verified 2026-05-23)

Per actual STATE_OF_THE_BUILD.md inspection, the following Phase 1 agents are shipped:

- A-01 Intake Processor (2026-05-18, commit b4c03d2)
- A-02 Page Generator (2026-05-18, commit 8b09e21) — with Service Hub support added 2026-05-20
- A-03 Schema Generator (2026-05-19, commit 1e67ed5)
- A-04 Map Embed Generator (2026-05-20, commit eb69b83)
- A-05 Page Validator with 16 gates (2026-05-20, commit 1123e0d) — G16 Hub Completeness added 2026-05-20
- A-06 Internal Link Builder (2026-05-20)
- A-07 Sitemap Generator (2026-05-19, commit pending verification)

A-02 has a downstream Contract 73 update pending (P11 work item 8) — the entry point will receive a prerequisite check once A-44 ships. The synthetic baseline created by Migration N+8 preserves Contract 73 satisfaction for existing seeded clients during the gap between A-44 shipping and A-02 entry-point refactor.

The original "Phase 1 Agents (14) — NOT STARTED" header in source AGENTS.md was significantly stale at the moment of governance authoring (only A-01 marked shipped; 6 additional agents had shipped between 2026-05-18 and 2026-05-20). REV 1 corrects this to acknowledge all 7 shipped agents AND updates the count from 14 to 15 with A-44 added.

This correction is purely documentary — it does not change any architectural decisions, contract enforcements, or build sequencing locked in this delta. The Phase 1 RBAC + A-44 work items in P11 remain identical regardless of which agents shipped previously.

---

## 4. CHANGE 3: Update CRON Jobs Count

Already incorporated into Change 2 above (lines 527–529 of original file). The CRON count updates from 2 to 3 with CRON-03 added. The "CRON Jobs (3) — ⏳ NOT SCHEDULED" block is the second part of Change 2's replacement content.

---

## 5. CHANGE 4: Update A-02 Spec with Contract 73 Dependency

### 5.1 Context

A-02 Page Generator spec (lines 537–554) currently lists "Dependencies: A-01 (intake), A-05 (validation)" but does not mention A-44. With Contract 73 enforcing A-44 as a prerequisite, the A-02 spec must reflect this.

### 5.2 Lines being replaced

Lines 537 through 554 currently read:

```
### A-02: Page Generator

**Purpose:** Generate city + service SEO landing pages via LLM-powered content generation.

**Status:** Not yet built. Core Phase 1 agent.

**Output Requirements (Visual Discipline):**

Every page A-02 generates MUST place a primary contact affordance in the first viewport on both mobile (375px width) and desktop (1280px width). Acceptable affordances:
1. Phone number CTA (tel: link, large, tap-friendly on mobile)
2. "Get a Quote" form (inline above the fold on desktop, sticky button → modal on mobile)
3. Combination of both

This is non-negotiable. Pages that fail above-the-fold contact card audit MUST not pass A-05 Page Validator. A-05 explicitly checks for this.

**Service Hub Pages (Tier 2 Architecture):** When intent='service-hub', A-02 triggers Opus-based generation with extended context and structural requirements per docs/architecture/service-hub-pages-spec.md. Service hub pages serve as parent pages in the hub-and-spoke hierarchy and require elevated quality standards.

**Dependencies:** A-01 (intake), A-05 (validation)
```

### 5.3 Replacement content

```
### A-02: Page Generator

**Purpose:** Generate city + service SEO landing pages via LLM-powered content generation.

**Status:** Not yet built. Core Phase 1 agent. Blocked from execution per Contract 73 until A-44 produces a successful current ingestion version for the target client.

**Prerequisite Verification (Contract 73 enforcement):**

A-02 entry point MUST perform this check before any LLM call:

```typescript
const ingestionStatus = await supabase
  .from('client_ingestion_versions')
  .select('id, status, approval_status')
  .eq('client_id', clientId)
  .eq('is_current', true)
  .maybeSingle();

if (!ingestionStatus.data ||
    !['success', 'manually_provided'].includes(ingestionStatus.data.status) ||
    !['auto_approved', 'approved', 'manually_provided'].includes(ingestionStatus.data.approval_status)) {
  throw new ContractViolationError('A-02 blocked: Contract 73 requires successful A-44 ingestion for client_id: ' + clientId);
}
```

The check is mandatory. There is no override path at the A-02 layer — overrides happen at the A-44 layer via the master_admin manual asset provision flow per BLUEPRINT.md Part 10.5 Section 10.5.8.

**Reading A-44 Output:**

After Contract 73 prerequisite check passes, A-02 reads from these A-44-populated tables to inform generation:

- `client_brand_voice_model` — tone of voice, terminology preferences, brand vocabulary
- `client_ingested_assets` — logos, manufacturer badges, certifications (current version's assets via `is_current=TRUE` filter and `asset_version` join)
- `client_keyword_gap_analysis` — keywords client should rank for, used to inform topic targeting

A-02 must NOT generate content with placeholder or hallucinated brand voice when client_brand_voice_model is populated for the client. A-02 reads the model and adopts its voice descriptors.

**Output Requirements (Visual Discipline):**

Every page A-02 generates MUST place a primary contact affordance in the first viewport on both mobile (375px width) and desktop (1280px width). Acceptable affordances:
1. Phone number CTA (tel: link, large, tap-friendly on mobile)
2. "Get a Quote" form (inline above the fold on desktop, sticky button → modal on mobile)
3. Combination of both

This is non-negotiable. Pages that fail above-the-fold contact card audit MUST not pass A-05 Page Validator. A-05 explicitly checks for this.

**Service Hub Pages (Tier 2 Architecture):** When intent='service-hub', A-02 triggers Opus-based generation with extended context and structural requirements per docs/architecture/service-hub-pages-spec.md. Service hub pages serve as parent pages in the hub-and-spoke hierarchy and require elevated quality standards.

**Dependencies:**
- A-01 (intake — provides client record)
- A-44 (knowledge ingestion — provides brand voice, badges, certifications, NAP) — **NEW HARD DEPENDENCY per Contract 73**
- A-10 (content profile — provides 4-layer differentiation profile, runs between A-44 and A-02)
- A-05 (validation — runs after A-02 completes)

**Manual Trigger Permission:** Triggering A-02 manually via `/api/agents/a-02/trigger` requires master_admin or senior_admin role per the canonical permission matrix in ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3.3. VAs cannot trigger A-02 (LLM cost-bearing operation).
```

---

## 6. CHANGE 5: Add A-44 Spec at Phase 1 Location

### 6.1 Context

The Phase 1 Agent Specifications section currently contains A-02, A-05, A-06 (lines 537–585). A-44's canonical Phase 1 spec must be added in correct sequence position (after A-01 references in the build queue, alongside A-02 because they are tightly coupled).

### 6.2 Insertion location

Insert immediately after line 585 (end of A-06 Internal Linker spec) and before line 586 (`## VENDOR DECISIONS (LOCKED)` section heading).

The insertion places A-44 within the Phase 1 Agent Specifications section in correct execution-order position (A-02, A-05, A-06 are listed; A-44 follows them as a Phase 1 agent whose specification belongs in this section).

### 6.3 Content to insert

```

### A-44: Client Knowledge Ingestion Engine (RELOCATED TO PHASE 1 — 2026-05-23)

**Phase:** 1 (relocated from Phase 1.5 per operator decision 2026-05-23)
**Status:** ⏳ NOT STARTED — next agent build after RBAC foundation completes
**Purpose:** Capture the client's existing brand voice, terminology, NAP data, certifications, manufacturer badges, customer testimonials, and visual identity assets from their public website so that Tarritrix-generated pages adopt the client's authentic brand voice. Without A-44, generated pages lack brand consistency and authentic trust signals — violating Contract 61 (AEO/Voice/Conversion Discipline) and Contract 18 (Evidence Authenticity HARD).

**Sequence:** A-44 inserts between A-01 and A-10 in the post-onboarding pipeline. A-02 cannot execute for a client until A-44 produces a successful current ingestion version per Contract 73.

**Canonical Specification:** Full A-44 specification with cadence, diff detection, failure handling, override path, and storage model lives in BLUEPRINT.md Part 10.5. This AGENTS.md entry is the executor-facing summary.

**Inputs:**
- Client website URL captured in onboarding Step 2 (`clients.website_url`)
- Client GSC OAuth permission (if granted in onboarding Step 6) — provides ranking keyword data
- Playwright headless crawler with 2-second rate limit per request
- Existing `cities` table for NAP normalization
- LLM router (B2) for tone of voice summarization

**Capture Targets (15 categories):**

1. Brand voice and terminology
2. Existing ranking keywords (via GSC API if available)
3. NAP data (Name/Address/Phone in E.164)
4. Service descriptions verbatim
5. Tone of voice (formal / casual / expert / friendly)
6. Existing claims, certifications, awards
7. Customer testimonials with attribution
8. Case studies and project photos
9. Manufacturer badges (GAF, CertainTeed, Owens Corning, IKO)
10. Trust marks (BBB, Angi, HomeAdvisor)
11. Professional licensing badges
12. Logos (header, footer, alternate marks)
13. Insurance certifications
14. Industry association memberships
15. EXIF data from photos worth importing to evidence_items

**Process:**

1. Verify client_ingestion_versions does not already contain a row with `status='in_progress'` for this client (prevents duplicate runs)
2. Create new row in client_ingestion_versions with status='in_progress', trigger_type per trigger source, triggered_by_user_id, version_number = COALESCE(MAX(version_number), 0) + 1
3. Initiate Playwright crawl respecting robots.txt and 2s rate limit
4. Extract text via DOM parsing
5. Run LLM-assisted summarization for tone/voice (cost ~$0.35–0.55 per scrape)
6. Extract images and classify (logo / badge / photo / other) via deterministic heuristics + LLM classification for ambiguous cases
7. Write captures to client_ingested_assets, client_brand_voice_model, client_keyword_gap_analysis
8. Compute diff_severity vs prior current version (if any) using deterministic hash algorithm per BLUEPRINT.md Part 10.5 Section 10.5.5
9. Determine approval_status based on diff_severity and trigger_type:
   - First-ever scrape: `auto_approved`
   - Subsequent with diff_severity in (none, minor): `auto_approved`
   - Subsequent with diff_severity in (material, breaking): `pending_approval`
10. If `auto_approved`: set `is_current=TRUE`, mark previous current row `is_current=FALSE`, update `clients.current_ingestion_version_id`
11. If `pending_approval`: raise P1 advisory signal; prior version remains current
12. Update `clients.last_ingestion_at`, `clients.next_ingestion_scheduled_at = NOW() + INTERVAL '90 days' + (random_jitter ±7 days)`
13. Mark client_ingestion_versions row `status='success'`, `scrape_completed_at=NOW()`
14. Log to agent_events with cost, latency, version_number

**Three Refresh Triggers:**

Per BLUEPRINT.md Part 10.5 Section 10.5.4:

1. **Onboarding (mandatory, blocking)** — Step 9 of onboarding wizard, automatic platform-executed
2. **Quarterly CRON (CRON-03 a44-quarterly-refresh)** — daily evaluation, ±7 day jitter on next_ingestion_scheduled_at
3. **Manual (master_admin or senior_admin)** — Force Re-scrape button on /dashboard/clients/[id] Tab 7

A fourth signal-driven trigger is deferred to Phase 1.5.

**Failure Handling:**

If scrape fails (site down, robots.txt blocks, parse error):

1. client_ingestion_versions row marked `status='failed'`, `failure_reason` populated
2. Existing current version (if any) remains current; A-02 continues with stale data
3. P2 advisory signal raised
4. Exponential backoff retry: +1 day, +3 days, +7 days
5. After 7 days of consecutive failures, escalate to P1 signal
6. Master_admin can manually block A-44 for a client via `clients.ingestion_blocked=TRUE` with reason

**Override Path (Contract 73):**

Master_admin only can bypass A-44 prerequisite for a client via manual asset provision when client's website is unscrapable. Process documented in BLUEPRINT.md Part 10.5 Section 10.5.8.

**Risk Acknowledgment (carried forward from 2026-05-17 operator decision):**

No preemptive copyright filtering on captured manufacturer badges, certifications, or trust marks. Cease-and-desist is the rare-case recovery path. If C&D received for any specific asset, remove that asset from active rendering and disable client re-display via client_ingested_assets table flag.

**Outputs:**

- client_ingested_assets table populated with per-asset rows
- client_brand_voice_model row updated for the client
- client_keyword_gap_analysis row updated for the client
- evidence_items extended with ingested photo imports
- client_ingestion_versions row created with appropriate status/approval_status
- clients.current_ingestion_version_id pointer updated to is_current row
- clients.last_ingestion_at, next_ingestion_scheduled_at updated
- agent_events log entry with cost, latency, version_number

**Dependencies:**
- A-01 (intake — provides client record with website_url)
- Migrations N+1 through N+8 from SCHEMA_REGISTRY.md (RBAC foundation must exist; client_ingestion_versions table must exist)
- B1 base agent framework
- B2 LLM router (for tone-of-voice summarization)
- Playwright runtime in Edge Function context

**Manual Trigger Permission:** Triggering A-44 manually via `/api/agents/a-44/trigger` requires master_admin or senior_admin role per the canonical permission matrix in ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3.3. VAs cannot trigger A-44 (touches client website, moderate LLM cost, may produce diff requiring approval).

**Contract Enforcement:**

- Contract 73 (Pre-Generation Knowledge Ingestion Requirement) — A-02 entry checks A-44 status
- Contract 71 (RBAC Enforcement) — manual trigger gated by permission matrix
- Contract 72 (Multi-User Audit Attribution) — manual triggers and override actions logged to user_actions
- Contract 61 (AEO/Voice/Conversion Discipline) — A-02 reads client_brand_voice_model output
- Contract 18 (Evidence Authenticity HARD) — A-44 outputs feed A-43 trust signal composer

```

---

## 7. CHANGE 6: Relocate Mis-Filed Geographic Capabilities to A-21

### 7.1 Context

Per Document 2 Change 1, the BLUEPRINT.md "A-21 Client Site Ingestion" section was removed. That section contained three "Additional capabilities (2026-05-17 augmentation)" entries that architecturally belong to A-21 Hyperlocal Geographic Engine (they describe geographic intelligence, not brand ingestion):

- Parcel-density classification
- Neighborhood topology classification
- Municipal context enrichment

The AGENTS.md A-21 Hyperlocal Geographic Engine section (lines 611–675) currently does not contain these capability augmentations. We relocate them here.

### 7.2 Lines being replaced

Lines 670 through 674 currently read:

```
**Architectural Note:** This is structural alignment with already-planned functionality, not a new feature category. Promoted to Phase 1.5 from Phase 2 because Storm Intelligence Engine ZIP-level outputs are blocked from full value without A-21's neighborhood-level page generation.

**Tier 3 Fallback:** Counties without verified free data access default to no hyperlocal page generation. Operator may manually designate target neighborhoods for Tier 3 county clients during onboarding as Authority/Dominance tier benefit.

**Priority:** CRITICAL — alongside A-12 GBP Agent in Phase 1.5 build sequence.
```

### 7.3 Replacement content

```
**Architectural Note:** This is structural alignment with already-planned functionality, not a new feature category. Promoted to Phase 1.5 from Phase 2 because Storm Intelligence Engine ZIP-level outputs are blocked from full value without A-21's neighborhood-level page generation.

**Tier 3 Fallback:** Counties without verified free data access default to no hyperlocal page generation. Operator may manually designate target neighborhoods for Tier 3 county clients during onboarding as Authority/Dominance tier benefit.

**Priority:** CRITICAL — alongside A-12 GBP Agent in Phase 1.5 build sequence.

**Additional capabilities (relocated from prior BLUEPRINT "A-21 Client Site Ingestion" section per 2026-05-23 A-21/A-44 conflict resolution):**

These three capability augmentations were originally filed under "A-21 Client Site Ingestion" in BLUEPRINT.md, which was an incorrect slot assignment. The capabilities describe operations on county GIS data, service area classifications, and municipal context — geographic intelligence concerns that architecturally belong to A-21 Hyperlocal Geographic Engine. Relocated here per operator decision 2026-05-23 (Option 1 conflict resolution).

- **Parcel-density classification** — Per service area, classify residential vs commercial parcel density from public county GIS data. Output drives A-02 content angle (residential roofing focus vs commercial flat-roof focus). Sourced from the same county GIS APIs used for the parcels and county_data_sources tables.

- **Neighborhood topology classification** — Urban / suburban / rural / coastal per service area. Different topology produces different content emphasis (coastal mentions hurricane exposure; rural mentions distance/dispatch; urban mentions zoning constraints; suburban mentions HOA prevalence). Output stored as a per-neighborhood classification feeding A-02 content composition.

- **Municipal context enrichment** — Per service area, capture permitting requirements, HOA prevalence, zoning classifications. Output drives A-25 atomic-fact generation with real-world local specifics ("Round Rock requires roofing permits over $1,500 in valuation," "Cedar Park HOAs typically require architectural review for roof material changes"). Sourced from municipal open-data portals where available; manual operator entry for municipalities without open data.
```

### 7.4 Why this is purely additive, not a removal

The original lines 670–674 are preserved unchanged. We only ADD the relocated capabilities at the bottom of the A-21 spec. This is the inverse of Document 2 Change 1 where the BLUEPRINT.md A-21 entry was deleted — the capabilities did not disappear; they were re-homed to AGENTS.md A-21 where they belong architecturally.

---

## 8. CHANGE 7: Replace Existing Phase 1.5 A-44 Entry with Cross-Reference

### 8.1 Context

A-44 currently has a Phase 1.5 spec at lines 1320–1370. Per Document 1, A-44 relocates to Phase 1. The Phase 1.5 entry must point to the new Phase 1 canonical location (Change 5 above).

### 8.2 Lines being replaced

Lines 1320 through 1370 currently read (the entire A-44 spec block at the Phase 1.5 location):

```
### A-44: Client Knowledge Ingestion Engine

**Phase:** 1.5 (foundational — needed before A-02 page generation can adopt client voice)
**Status:** ⏳ NOT STARTED
**Purpose:** Capture everything from client's existing website so Tarritrix-generated pages match client brand voice, terminology, certifications, and visual assets. Direct capture (no two-step approval gate per operator decision 2026-05-17).

**Capture targets:**

1. Brand voice and terminology (how client describes their services)
2. Existing keywords ranking in Google for client's domain
3. NAP data (Name/Address/Phone) for consistency verification
4. Service descriptions verbatim
5. Tone of voice analysis (formal/casual/expert/friendly)
6. Existing claims, certifications, awards
7. Existing customer testimonials with attribution
8. Existing case studies and project photos
9. Manufacturer badges (GAF, CertainTeed, Owens Corning, etc.)
10. Trust marks (BBB, Angi, HomeAdvisor)
11. Professional licensing badges
12. Logos
13. Insurance certifications
14. Industry association memberships
15. EXIF data from any photos worth importing to evidence_items

**Process:**

1. With client permission (OAuth or explicit consent), crawl client website
2. Respect robots.txt and crawl-delay
3. Extract text via DOM parsing + LLM-assisted summarization for tone/voice
4. Extract images, classify them (logo / badge / photo / other)
5. Direct capture — no two-step approval gate (operator decision 2026-05-17)
6. Store everything in client_ingested_assets table tied to client_id
7. Per-asset metadata: source URL, capture date, asset type, classification confidence
8. Identify keyword gaps (terms client should rank for but doesn't)
9. Build per-client brand voice model used by A-25 (AEO Content Structuring) and A-02 (Page Generator)

**Cadence:** One-time at client onboarding. Quarterly refresh to catch site changes.

**Risk acknowledgment (per operator decision 2026-05-17):**
No preemptive copyright filtering on captured manufacturer badges, certifications, etc. Cease-and-desist is the rare-case recovery path. Manufacturers benefit from product promotion and rarely object to certified-installer displays. If C&D received for any specific asset, remove that asset from active rendering and disable client re-display.

**Outputs:**
- client_ingested_assets table (raw captures)
- client_brand_voice_model per client
- client_keyword_gap_analysis per client
- evidence_items extended with ingested photo imports

**Tables added:** client_ingested_assets, client_brand_voice_model, client_keyword_gap_analysis (extends evidence_items)

**Contract enforcement:** Contract 61 (brand voice consistency requirement).
```

### 8.3 Replacement content

```
### A-44: Client Knowledge Ingestion Engine — RELOCATED TO PHASE 1 (2026-05-23)

**Phase:** 1 (RELOCATED from Phase 1.5 per operator decision 2026-05-23)

**Canonical Specification:** The full A-44 specification is now located in the "PHASE 1 AGENT SPECIFICATIONS" section above (inserted after A-06 Internal Linker per Change 5 of the 2026-05-23 governance synchronization). The historical Phase 1.5 entry is preserved here as a marker indicating the relocation.

**Cross-Reference:**
- AGENTS.md Phase 1 Agent Specifications section — full A-44 spec
- BLUEPRINT.md Part 10.5 — canonical specification (mission, refresh model, diff detection, failure handling, override path, storage model)
- ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 7 — architectural decision context, master_admin override authority, backward compatibility plan for existing seeded clients
- SCHEMA_REGISTRY.md Group 16 — client_ingestion_versions table (Table 87) and the four migrations (N+4, N+5) that establish A-44's storage layer

**Reason for relocation:**

Operator decision 2026-05-23: A-44 cannot remain Phase 1.5 because A-02 Page Generator (Phase 1, core spine of the product) cannot generate brand-consistent pages without A-44 outputs. Pages generated without ingested brand voice produce generic AI-flavored output that fails Contract 61 (AEO/Voice/Conversion Discipline) and Contract 18 (Evidence Authenticity HARD). Contract 73 (Pre-Generation Knowledge Ingestion Requirement) is created in the same synchronization to enforce the prerequisite at the agent layer.

**No content in this Phase 1.5 location is the canonical source going forward.** All A-44 implementation work follows the Phase 1 specification.
```

### 8.4 Why we preserve this entry as a cross-reference rather than deleting

Deleting the entry entirely would create a discontinuity for future Claude Code sessions or operators searching AGENTS.md for "A-44" — they might find no result and assume A-44 doesn't exist. Preserving a cross-reference marker at the former location ensures discoverability and serves as a historical signpost documenting the relocation. This pattern matches how Section 9 "Surface 5: Client Portal Login — DEPRECATED" was handled in MASTER_BUILD_SPEC.md (the route was removed but the section was preserved with deprecation notice).

---

## 9. CHANGE 8: Add RBAC Awareness Section for Build Executors

### 9.1 Context

The "Phase 1 Agent Build Status" section (lines 504–531) is the primary entry point for any new Claude Code session reading AGENTS.md to understand the build queue. Before reading the agent list, the executor should be briefed on RBAC architecture so that every agent implementation incorporates Contracts 71/72/73 from the start, not as an afterthought.

### 9.2 Insertion location

Insert immediately before line 504 (`## PHASE 1 AGENT BUILD STATUS`). This places the RBAC briefing right before the executor encounters the build queue.

### 9.3 Content to insert

```

## RBAC AWARENESS FOR BUILD EXECUTORS (LOCKED 2026-05-23)

Every Phase 1 agent implementation must be RBAC-aware from initial scaffold. The architecture is locked in `docs/architecture/ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` and propagated across all governance files via the 2026-05-23 synchronization.

### What the build executor must know

**1. Three operator-side roles plus client role:**
- `master_admin` — platform owner, top of hierarchy
- `senior_admin` — trusted operational manager
- `va` — virtual assistant
- `client` — existing client portal role, unchanged

**2. Global role scoping:**
Roles are global, not per-client. A user has exactly one active role row in the `user_roles` table.

**3. Required auth helpers for every operator-side route:**

```typescript
import { getOperatorContext } from '@/lib/auth/operator-context';        // Contract 70
import { getUserActiveRole, hasPermission } from '@/lib/auth/role-context'; // Contract 71

export async function POST(request: NextRequest, ...) {
  // Step 1: Contract 70 — auth verification
  const { userId, supabase } = await getOperatorContext(request);

  // Step 2: Contract 71 — role lookup (fresh, not cached)
  const userRole = await getUserActiveRole(supabase, userId);

  // Step 3: Contract 71 — permission check against canonical matrix
  if (!hasPermission(userRole, 'approve_flagged_page')) {
    await logDeniedAction(supabase, userId, userRole, 'approve_flagged_page', clientId);
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Step 4: Contract 67 (amended) — resource ownership/access
  // For master_admin and senior_admin, ownership is satisfied by operator-side role
  // For va, additional per-action checks may apply (see permission matrix)

  // Step 5: Execute action

  // Step 6: Contract 72 — log to user_actions with three-attribute attribution
  await supabase.from('user_actions').insert({
    acting_user_id: userId,
    acting_user_role: userRole,
    client_id: clientId,
    action_type: 'approve_flagged_page',
    result: result.success ? 'success' : 'failed',
    justification: request.justification,
    metadata: { ... }
  });
}
```

**4. Permission matrix as code:**

The canonical permission matrix lives in `src/lib/auth/permission-matrix.ts`. Adding a new protected action requires updating both:
- The TypeScript matrix
- The matrix table in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` Section 3

A verification script (`scripts/verify-permission-matrix-sync.ts`) checks that both stay in sync. Drift blocks the build.

**5. Audit attribution requirements (Contract 72):**

Every audit log row in `user_actions` MUST include:
- `acting_user_id` (NOT NULL)
- `acting_user_role` (NOT NULL — captured at action time, not cached)
- `client_id` (nullable only for platform-level actions like role grants)

Missing any of these in an INSERT statement is blocked by `scripts/verify-audit-attribution.ts` at pre-commit.

**6. A-02 prerequisite check (Contract 73):**

A-02 Page Generator cannot execute for a client unless `client_ingestion_versions` contains a row with:
- `client_id = <target_client_id>`
- `is_current = TRUE`
- `status IN ('success', 'manually_provided')`
- `approval_status IN ('auto_approved', 'approved', 'manually_provided')`

The check happens at A-02 entry. There is no override at the A-02 layer — overrides happen at the A-44 layer via master_admin manual asset provision.

**7. Verification scripts that block commits:**

- `scripts/verify-rbac-pattern.ts` — blocks direct role checks (`user.role ===` or `getRole(` patterns outside the canonical helper)
- `scripts/verify-audit-attribution.ts` — blocks user_actions inserts missing required columns
- `scripts/verify-permission-matrix-sync.ts` — blocks divergence between TypeScript matrix and governance document
- `scripts/verify-operator-auth-pattern.ts` — Contract 70 (existing)
- `scripts/verify-insert-patterns.ts` — Contract 69 (existing)

All five scripts run in `pnpm verify:ci`.

### What this means for new agent implementations

Every Phase 1 agent that exposes a manual trigger API or operator-facing surface must:

1. Use `getOperatorContext()` + `getUserActiveRole()` + `hasPermission()` at the route handler
2. Check the canonical permission matrix for who can trigger this agent
3. Log every trigger attempt to `user_actions` with three-attribute attribution
4. For agents that mutate client state, also log to `user_actions` regardless of success/failure
5. For A-02 specifically: enforce Contract 73 at entry

Agent specifications in this AGENTS.md file include a "Manual Trigger Permission" note specifying which roles can trigger the agent. New agent specifications added going forward must include this note.

### Backward compatibility

- Existing `operator@tarritrix.test` account auto-promoted to `master_admin` via Migration N+2 (`seed_user_roles_from_auth_users.sql`)
- Existing `clients.operator_id` pointers preserved (semantics: "the master_admin or senior_admin ultimately accountable for this client")
- Existing `operator_actions` rows backfilled with `role_at_time_of_action = 'operator_legacy'`; new writes go to `user_actions` table
- Existing seeded clients (E4 Construction & Roofing, others) receive synthetic A-44 baseline rows via Migration N+8 so Contract 73 is satisfied at database constraint level; `clients.ingestion_synthetic_baseline = TRUE` flag marks them for real A-44 scrape at next operator interaction

---

```

---

## 10. VERIFICATION QUERIES FOR THIS DELTA

After CC applies these edits, the following queries MUST pass before the commit is accepted:

### 10.1 Phase 1 agent count check

```bash
grep -E "^### Phase 1 Agents \(15\)" /path/to/AGENTS.md
# Expected: 1 match

grep -E "^### Phase 1 Agents \(14\)" /path/to/AGENTS.md
# Expected: zero matches
```

### 10.2 A-44 Phase 1 placement check

```bash
grep -E "A-44.*Phase 1" /path/to/AGENTS.md | wc -l
# Expected: at least 4 occurrences (Phase 1 spec, build queue, agent build status, RBAC awareness)

grep -E "A-44.*Phase 1\.5.*RELOCATED" /path/to/AGENTS.md
# Expected: 1 match (the cross-reference at former Phase 1.5 location)

# A-44 in Phase 1 Agent Specifications section
grep -B1 "### A-44: Client Knowledge Ingestion Engine \(RELOCATED" /path/to/AGENTS.md
# Expected: present
```

### 10.3 CRON count check

```bash
grep -E "^### CRON Jobs \(3\)" /path/to/AGENTS.md
# Expected: 1 match

grep -E "CRON-03 a44-quarterly-refresh" /path/to/AGENTS.md
# Expected: at least 2 occurrences
```

### 10.4 A-02 Contract 73 dependency check

```bash
grep -E "A-02.*blocked.*Contract 73|Contract 73.*A-02" /path/to/AGENTS.md | wc -l
# Expected: at least 3 occurrences

grep "ContractViolationError.*A-02" /path/to/AGENTS.md
# Expected: 1 match (the inline TypeScript example)
```

### 10.5 Geographic capabilities relocation check

```bash
grep -E "Parcel-density classification|Neighborhood topology classification|Municipal context enrichment" /path/to/AGENTS.md | wc -l
# Expected: 3 occurrences, all in A-21 Hyperlocal Geographic Engine section

# Ensure no occurrences are mislocated
grep -B5 "Parcel-density classification" /path/to/AGENTS.md | grep "A-21"
# Expected: A-21 context present in lines above
```

### 10.6 RBAC awareness section check

```bash
grep -E "^## RBAC AWARENESS FOR BUILD EXECUTORS" /path/to/AGENTS.md
# Expected: 1 match

grep -E "scripts/verify-rbac-pattern|scripts/verify-audit-attribution|scripts/verify-permission-matrix-sync" /path/to/AGENTS.md | wc -l
# Expected: at least 3 occurrences (the three new scripts)
```

### 10.7 RBAC executor restrictions check

```bash
grep -E "Contract 71|Contract 72|Contract 73" /path/to/AGENTS.md | wc -l
# Expected: at least 12 occurrences

grep -E "getUserActiveRole|hasPermission" /path/to/AGENTS.md | wc -l
# Expected: at least 5 occurrences
```

### 10.8 Manual Trigger Permission notes check

```bash
grep -E "Manual Trigger Permission" /path/to/AGENTS.md | wc -l
# Expected: at least 2 occurrences (A-02, A-44)
```

### 10.9 Line count check

```bash
wc -l /path/to/AGENTS.md
# Expected: approximately 1,800 lines (1,475 + 325 net additions)
# Tolerance: ±30 lines for whitespace and formatting normalization
```

### 10.10 Cross-reference integrity check

```bash
# Every reference to ROLE_HIERARCHY_ARCHITECTURE_SPEC.md
grep -E "ROLE_HIERARCHY_ARCHITECTURE_SPEC\.md" /path/to/AGENTS.md | wc -l
# Expected: at least 4 occurrences

# Every reference to canonical Phase 1 A-44 location
grep -E "BLUEPRINT\.md Part 10\.5" /path/to/AGENTS.md | wc -l
# Expected: at least 3 occurrences

# RBAC migration references
grep -E "Migration N\+[1-8]" /path/to/AGENTS.md | wc -l
# Expected: at least 4 occurrences
```

---

## 11. APPROVAL

This REV 1 document supersedes the V1.0 of AGENTS_DELTA.md delivered earlier in this session. Approval here authorizes the corrected delta as the canonical version to be applied in the final atomic governance commit.

**Operator approval format:**

- **"Approved AGENTS_DELTA REV 1"** to confirm the corrected delta is the canonical version for the synchronized commit. (Document 6 BEHAVIORAL_CONTRACTS_DELTA and Document 7 STATE_OF_THE_BUILD_DELTA are already approved; this REV 1 only updates Document 5.)
- **"Edits required: [list]"** to request specific revisions before approval.

After all approvals complete (including this REV 1), the CC prompt that performs the synchronized governance commit will apply this delta to AGENTS.md as one of seven file modifications in a single atomic operation.

---

**End of Document 5 (REV 1) of 8.**
