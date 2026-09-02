# TARRITRIX 1.0 — BLUEPRINT.md DELTA SPECIFICATION

**Document ID:** BLUEPRINT_DELTA
**Version:** 1.0
**Status:** DRAFT — Pending operator approval
**Authored:** 2026-05-23
**Author:** Lead Architect (Claude, acting on operator authorization)
**Operator:** Reid Whitesides
**Scope:** Surgical edits to `BLUEPRINT.md` to incorporate role hierarchy architecture, A-44 phase relocation, A-21/A-44 conflict resolution, and propagation of decisions locked in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` (Document 1).

**This document is Document 2 of 8 in the governance synchronization series.** It describes every edit that must be made to `BLUEPRINT.md` and presents each one as an exact before/after diff with line-anchored references. No edits to BLUEPRINT.md occur in the repo until this document is approved.

**Source file state at time of authoring:** `/mnt/project/BLUEPRINT.md`, 4,482 lines, last modified per project upload timestamp 2026-05-23 17:32.

**Read every diff before approving.** Approval of this document authorizes the CC prompt that performs the edits as a single atomic operation.

---

## 1. SUMMARY OF CHANGES

This delta makes the following changes to BLUEPRINT.md:

| # | Type | Location | Purpose |
|---|---|---|---|
| 1 | REPLACE | Lines 4096–4114 | Resolve A-21/A-44 conflict by replacing duplicate "A-21 Client Site Ingestion" section with a cross-reference to A-44 (under its correct slot) and relocating the geographic capability augmentations to where they belong |
| 2 | INSERT | After line 2835 (end of Step 8) | Add Step 9: A-44 Knowledge Ingestion as the new final onboarding step |
| 3 | REPLACE | Lines 2837–2864 (Section 4.2 Post-Onboarding Pipeline) | Update the pipeline diagram to include A-44 between A-01 and A-10 |
| 4 | INSERT | After line 3438 (end of Section 8.6 sidebar nav) | Add Section 8.6.5 "Role Hierarchy and Multi-User Operations" referencing the canonical spec |
| 5 | INSERT | After line 4482 (end of file) | Add Part 11 "RBAC Architecture and A-44 Phase 1 Placement" cross-referencing ROLE_HIERARCHY_ARCHITECTURE_SPEC.md |
| 6 | INSERT | After line 4426 (end of Part 10) | Add Part 10.5 "A-44 Client Knowledge Ingestion (Canonical - Phase 1 Mandatory)" — the full A-44 spec at the canonical phase placement |

**Net effect on BLUEPRINT.md:**
- Lines deleted: 19 (the duplicate A-21 section at 4096–4114)
- Lines added: approximately 480 (Step 9, pipeline rewrite, Section 8.6.5, Part 10.5, Part 11)
- Net line delta: +461 lines, ending file at ~4,943 lines

**Zero changes to:**
- Part 1 through Part 3 (original blueprint sections, preserved verbatim per Contract 26)
- Sections 5.1 through 5.8 (marketing site specification)
- Section 8.6 Zones 1–4 layout (Operator Command Center 4-zone structure remains unchanged — role-aware UI is described in Section 8.6.5, the new subsection)
- Section 8.7 Client Portal (no client-portal changes in this delta)
- Sections 8.8 through 8.15 (color palette, anti-failure protections, table inventory note, Stripe correction, change log)
- Part 9 (Four-Tier Expansion) — fully preserved, no role-hierarchy implications
- A-05 Page Validator 15 gates section (line 4116 onwards)
- All other existing agent specifications

---

## 2. CHANGE 1: Resolve A-21/A-44 Conflict

### 2.1 Context

`BLUEPRINT.md` contains a section titled "A-21 CLIENT SITE INGESTION (Canonical - Phase 1 Mandatory)" at lines 4096–4114. This is a pre-existing governance conflict:

- `AGENTS.md` line 611 consistently uses A-21 to mean "Hyperlocal Geographic Engine" (Phase 1.5)
- `AGENTS.md` separately defines A-44 as "Client Knowledge Ingestion Engine" (Phase 1.5, now moving to Phase 1)
- The BLUEPRINT A-21 "Client Site Ingestion" entry describes the same functionality as A-44 under a wrong slot number

Per operator decision 2026-05-23 (Option 1: Consolidate under A-44), the canonical resolution is:

- **A-21** exclusively refers to "Hyperlocal Geographic Engine" across all files
- **A-44** exclusively refers to "Client Knowledge Ingestion Engine" across all files
- Geographic capability augmentations currently mis-located under the BLUEPRINT A-21 entry get moved to where they belong — under A-21 Hyperlocal Geographic Engine in `AGENTS.md` (handled in Document 5)
- The BLUEPRINT.md A-21 entry gets removed and replaced with a cross-reference to A-44

### 2.2 Lines being removed

Lines 4094 through 4114 currently read (exact text from source file):

```
---

## A-21 CLIENT SITE INGESTION (Canonical - Phase 1 Mandatory)

### Mission
Ingest client site + competitors at onboarding -> produce Brand Identity Signature, evidence library, content profile.

### Extracts
Typography/colors/voice/archetype matched to libraries. Testimonials, photos, bios, certifications with permission flags. SEO patterns, topical coverage.

Playwright crawler, 2s rate limit. LLM cost ~$0.35-0.55 per client (one-time).

Operator review Step 5.5: side-by-side preview, evidence toggles, brand overrides.

**Additional capabilities (2026-05-17 augmentation):**

- **Parcel-density classification** — Per service area, classify residential vs commercial parcel density from public county GIS data. Output drives A-02 content angle (residential roofing focus vs commercial flat-roof focus).
- **Neighborhood topology classification** — Urban / suburban / rural / coastal per service area. Different topology → different content emphasis (coastal mentions hurricane exposure; rural mentions distance/dispatch).
- **Municipal context enrichment** — Per service area, capture permitting requirements, HOA prevalence, zoning classifications. Output drives A-25 atomic-fact generation with real-world local specifics.

---
```

### 2.3 Replacement content

Lines 4094 through 4114 are replaced with:

```
---

## A-44 CLIENT KNOWLEDGE INGESTION ENGINE — CROSS-REFERENCE

The full canonical specification for A-44 Client Knowledge Ingestion Engine appears in this BLUEPRINT.md at Part 10.5 below. A-44 was previously documented in this file under the wrong slot number "A-21" — that entry has been consolidated into A-44 per operator decision 2026-05-23 (Option 1 conflict resolution).

**A-44 is Phase 1 Mandatory** as a prerequisite for A-02 Page Generator. Contract 73 (Pre-Generation Knowledge Ingestion Requirement) enforces this prerequisite at the agent layer.

For full specification including mission, extracts, refresh model (onboarding-mandatory, quarterly CRON with jitter, manual master/senior trigger), diff detection, failure handling, and backward compatibility for existing seeded clients, see Part 10.5 below and `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` Section 7.

**The geographic capability augmentations (parcel-density classification, neighborhood topology classification, municipal context enrichment) that were misfiled under "A-21 Client Site Ingestion" in this file have been relocated to A-21 Hyperlocal Geographic Engine in `AGENTS.md`, which is their architecturally correct location.** These capabilities are geographic intelligence about service areas, not client-website ingestion.

---
```

### 2.4 Why this resolution is correct

The relocated capabilities (parcel density, neighborhood topology, municipal context) describe operations on county GIS data, service area classifications, and municipal context — none of which are client-website ingestion concerns. They were misfiled under "A-21 Client Site Ingestion" likely because the section author conflated A-21 (Hyperlocal Geographic Engine in AGENTS.md) with the unrelated functionality of client-website crawling. The relocation to A-21 Hyperlocal Geographic Engine restores architectural coherence.

---

## 3. CHANGE 2: Add Onboarding Step 9 (A-44 Knowledge Ingestion)

### 3.1 Context

`BLUEPRINT.md` Part 4 Section 4.1 currently documents 8 onboarding steps (lines 2702 through 2835). The final step is "Step 8: Integration Setup (NEW)" which configures field-service software connections.

Per operator decision 2026-05-23, A-44 client website knowledge ingestion is mandatory before A-02 page generation can run. The cleanest architectural placement is as a new Step 9 immediately after Step 8, executed automatically by the platform (not requiring operator data entry) but documented as part of the canonical onboarding workflow.

### 3.2 Insertion location

Insert immediately after the existing end of Step 8 content, before line 2837 (which begins "4.2 Post-Onboarding Pipeline").

The existing end of Step 8 (lines 2830–2835):

```
Custom integrations:
- Webhook URL: https://api.tarritrix.com/webhooks/{client_webhook_token}

Purpose:
- Enable job completion   SEO pipeline automation
- Critical for A-19 Universal Integration Hub
```

### 3.3 Content to insert

After the Step 8 block ends, insert:

```
Step 9: Knowledge Ingestion (Automatic, Platform-Executed)

Triggered automatically by the platform upon completion of Step 7 (Payment & Signature) and propagation of clients.status = 'active'. No operator data entry required for Step 9 — the platform reads the website URL captured in Step 2 and initiates A-44 Client Knowledge Ingestion Engine.

What happens:
- A-44 crawls the client's website using a Playwright headless crawler with 2-second rate limit per request
- Extracts brand voice and terminology, existing keywords ranking for the domain, NAP data, service descriptions verbatim, tone of voice analysis, existing claims, certifications and awards, customer testimonials with attribution, case studies and project photos, manufacturer badges (GAF, CertainTeed, Owens Corning, etc.), trust marks (BBB, Angi, HomeAdvisor), professional licensing badges, logos, insurance certifications, industry association memberships, and EXIF data from photos worth importing to evidence_items
- Persists outputs to client_ingested_assets, client_brand_voice_model, client_keyword_gap_analysis tables (per A-44 canonical spec in Part 10.5)
- Creates client_ingestion_versions row with trigger_type='onboarding', approval_status='auto_approved', is_current=TRUE
- LLM cost: approximately $0.35–0.55 per client (one-time at onboarding)
- Typical duration: 3–7 minutes for sites under 100 pages
- Master_admin or senior_admin can preview captured assets via the new Knowledge Base tab on /dashboard/clients/[id] after completion

Hard requirements (Contract 73):
- A-02 Page Generator cannot execute for this client until Step 9 completes successfully
- If A-44 fails at onboarding (site down, robots.txt blocks crawl, parse error), the client remains in clients.status = 'active' but pages.generation is blocked until master_admin or senior_admin either retries A-44 successfully or uses the master_admin override path to manually provide ingestion assets (see Part 10.5 for override specification)

Backward compatibility note:
For existing seeded clients that were activated before A-44 shipped (e.g., E4 Construction & Roofing), a synthetic baseline row is created via the migration sequence specified in ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 4.6. The synthetic baseline satisfies Contract 73 at the database constraint level while flagging the client for a real A-44 scrape at the next operator interaction. Existing E4 page generation continues without interruption.

Validation:
- A-44 status = 'success' OR override applied
- client_ingestion_versions row exists with is_current = TRUE
- clients.current_ingestion_version_id is populated
```

### 3.4 Why Step 9 is automatic, not operator-driven

The operator already collected the website URL in Step 2. Asking the operator to take additional manual action between Step 8 and the start of page generation introduces friction with no decision value — the platform has everything it needs to initiate the scrape. Failure cases (site down, robots.txt blocks) surface through the advisory signals system rather than blocking the onboarding wizard UI.

---

## 4. CHANGE 3: Update Section 4.2 Post-Onboarding Pipeline Diagram

### 4.1 Context

Section 4.2 (lines 2837–2864) currently shows the post-onboarding pipeline as:

```
Onboarding Complete
     
A-01: Intake Processor (validates all data)
     
clients.status = 'active'
     
A-10: Content Profile Builder (builds 4 layers for all city  service)
     
A-02: Page Generator (generates all pages)
     ...
```

This diagram does not show A-44 in the pipeline. With A-44 now a Phase 1 prerequisite for A-02, the diagram must be updated.

### 4.2 Replacement content

Lines 2837 through 2864 are replaced with:

```
4.2 Post-Onboarding Pipeline

```
Onboarding Complete (Step 9 triggers A-44 automatically)
     │
     ▼
A-01: Intake Processor (validates all data)
     │
     ▼
clients.status = 'active'
     │
     ▼
A-44: Client Knowledge Ingestion Engine (Phase 1, blocking)
     │   - Crawls client website
     │   - Extracts brand voice, badges, certifications, NAP, testimonials
     │   - Persists to client_ingested_assets, client_brand_voice_model
     │   - Creates client_ingestion_versions row (is_current=TRUE)
     │   - Contract 73: A-02 blocked until A-44 success
     │
     ▼
A-10: Content Profile Builder (reads A-44 output, builds 4 layers per city × service)
     │
     ▼
A-02: Page Generator (uses client_brand_voice_model from A-44)
     │
     ▼
A-03: Schema Generator (generates JSON-LD)
     │
     ▼
A-04: Map Embed Generator (generates iframes)
     │
     ▼
A-05: Page Validator (15 gates)
     │
     ├── PASS → pages.status = 'queued'
     │           │
     │           ▼
     │      A-06: Internal Link Builder
     │           │
     │           ▼
     │      A-07: Sitemap Generator
     │           │
     │           ▼
     │      CRON-01: Drip Publisher (daily, begins publishing)
     │
     └── FAIL → pages.status = 'flagged_for_review' (operator review queue, master_admin or senior_admin approves/rejects)
```

A-44 failure handling:
- If A-44 fails at onboarding, A-01 still completes and clients.status = 'active', but A-10 and A-02 cannot execute for this client. P2 advisory signal is raised to the operator queue. Retry available from /dashboard/clients/[id] Knowledge Base tab.
- If A-44 succeeds but later quarterly refresh produces a material diff requiring approval, A-02 continues to use the prior approved version until master_admin or senior_admin approves the new diff.

```

### 4.3 Why this matters

The pipeline diagram is one of the most-referenced sections of BLUEPRINT.md. Many downstream agents reference it during build (A-02 reads it to know its inputs, A-05 reads it to know its prerequisites, etc.). Failing to update the diagram would leave new developers and future Claude sessions believing A-02 runs immediately after A-10 with no upstream brand-ingestion dependency — exactly the architectural blind spot we're closing.

---

## 5. CHANGE 4: Add Section 8.6.5 "Role Hierarchy and Multi-User Operations"

### 5.1 Context

Section 8.6 (Operator Command Center Specification) currently ends at line 3438 with the sidebar navigation list. Section 8.7 (Client Portal) begins at line 3440. Per operator decision 2026-05-23, the Operator Command Center must be role-aware: master_admin, senior_admin, and VA users all access /dashboard, but the UI surfaces conditionally render actions based on the user's role per the permission matrix locked in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md` Section 3.

The 4-zone layout (Sections 8.6 Zones 1–4) does not change. What changes is the rendering logic per zone and the addition of a role badge in the header.

### 5.2 Insertion location

Insert immediately after line 3438 (the "Logout" line ending the sidebar navigation list) and before line 3440 (which begins "8.7 CLIENT PORTAL SPECIFICATION").

### 5.3 Content to insert

```
8.6.5 ROLE HIERARCHY AND MULTI-USER OPERATIONS

Authentication: any of three operator-side roles required (master_admin, senior_admin, va). All three roles route to /dashboard via the unified login flow specified in MASTER_BUILD_SPEC.md Section 6 (as updated per Document 3 of the 2026-05-23 governance synchronization).

Role-aware rendering applies to every protected action in the dashboard. The canonical permission matrix is documented in ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3 and encoded as a TypeScript constant in src/lib/auth/permission-matrix.ts. Contract 71 enforces that every protected handler invokes hasPermission(role, action) before executing the action.

Header additions:
- Role badge to the right of the user email and avatar
  - master_admin: red badge labeled "Master Admin"
  - senior_admin: blue badge labeled "Senior Admin"
  - va: gray badge labeled "VA"
- Tooltip on hover shows the action scope summary for the current role

Sidebar additions:
- "Users" link visible to master_admin only (hidden entirely from senior_admin and VA)
- Links Click → /dashboard/users surface for role grant and revocation per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 9.3

Zone-by-zone rendering rules:

Zone 1 (Top Stat Strip, 6 cards): All three roles see all six cards as read-only displays. No conditional rendering needed.

Zone 2 (Activity Feed): All three roles see the feed. No conditional rendering needed.

Zone 3 (3 Stacked Panels):
- Next Best Actions: VAs see only items where the recommended action is within VA permission scope (e.g., "Upload evidence photos for Client X"). Items requiring master_admin or senior_admin authority are hidden from VAs to avoid creating expectations they cannot fulfill.
- Tenant Health: All roles see the panel.
- Advisory Signals: All roles see signals but VAs can only dismiss P3 (informational) per the permission matrix. P0, P1, P2 dismiss buttons are disabled for VAs with tooltip "Requires senior_admin." P0 dismissal by senior_admin requires justification referencing the resolution commit or migration ID, and flags for master_admin review within 24 hours.

Zone 4 (Charts): All three roles see the charts. No conditional rendering needed.

Action button rendering convention:
- Hide entirely: actions the role concept does not include (e.g., role management UI is invisible to non-master_admin)
- Disable with tooltip: actions the role might expect but lacks permission for (e.g., VA sees a disabled "Approve" button with tooltip "Requires senior_admin")

The hide-vs-disable rationale is documented in ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 9.1. The principle is: disable for action affordances the role might expect to use (so the existence of the action is discoverable and the role understands who to escalate to), hide for entire surfaces the role should not need to know exist.

Flagged pages queue (within /dashboard/clients/[id]/flagged):
- Each flagged page row displays the assigned_reviewer if any, with name and role badge
- "Claim" button claims the page for 30-minute review lease (sets pages.assigned_reviewer_id, pages.assigned_reviewer_at, pages.assigned_reviewer_role)
- VAs can claim flagged pages for triage and note-taking but cannot perform approve or reject actions (still gated by permission matrix at the action level)
- Master_admin can force-reassign an existing claim via dropdown

Audit log access:
- master_admin and senior_admin see /dashboard/audit (new surface, Phase 1) with full user_actions log filterable by acting_user, role, client, action_type, date range
- VAs do not see this surface in the sidebar
- VAs can see their own actions via /dashboard/profile (their own session log)

Knowledge Base tab (new sub-tab on /dashboard/clients/[id]):
- Shows current A-44 ingestion version, last scrape timestamp, asset count
- Displays diff history for prior scrapes
- "Force Re-scrape" button visible to master_admin and senior_admin only (VAs cannot trigger)
- "Approve Diff" / "Reject Diff" buttons surface when client_ingestion_versions has a pending material or breaking diff awaiting review (master_admin and senior_admin only)
- Manual asset upload panel for master_admin override path (Contract 73 escape hatch for unscrapable sites)

The full role permission matrix governing every dashboard action is documented in ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3. That matrix is the single source of truth. Any dashboard action that exposes a protected operation must appear in the matrix or it is an unspecified action and the verification script (scripts/verify-permission-matrix-sync.ts) will block the build.

```

---

## 6. CHANGE 5: Add Part 10.5 "A-44 Client Knowledge Ingestion Engine (Canonical - Phase 1 Mandatory)"

### 6.1 Context

After resolving the A-21/A-44 conflict in Change 1, BLUEPRINT.md needs the canonical A-44 specification at the correct slot. This section provides the full A-44 spec at the canonical Phase 1 placement.

### 6.2 Insertion location

Insert after line 4426 (end of Part 10 "Detailed Specification Cross-References") and before line 4427 onwards (which currently contains "Three-Tier Site Architecture" sub-content of Part 10).

Reviewing again: Part 10 begins at line 4427. The cleanest insertion point is **after Part 10 ends and before the trailing test phase / asset hub sections**. Let me re-verify the structural placement:

Lines 4427 → 4461 contain Part 10 subsections (Three-Tier Site Architecture, Client Intelligence Intake Structure, Test Phase Activation Plan, Asset Hub).

Lines 4470 onwards are the final "Test Phase Activation Plan" and "Asset Hub Feature Overview" subsections that close out Part 10.

The correct insertion location is **after the closing of Part 10's content** (after line 4480) and **before any Part 11 content**. Since Part 11 does not yet exist, Part 10.5 inserts immediately after line 4480 and before Change 6 (which adds Part 11).

### 6.3 Content to insert

```
---

# ============================================================================
# PART 10.5 — A-44 CLIENT KNOWLEDGE INGESTION ENGINE (Canonical - Phase 1 Mandatory)
# ============================================================================

This section is the canonical specification for A-44 Client Knowledge Ingestion Engine following the 2026-05-23 phase relocation from Phase 1.5 to Phase 1 and the A-21/A-44 conflict resolution.

## 10.5.1 Phase Designation

**Phase:** 1 (relocated from Phase 1.5 per operator decision 2026-05-23)

**Sequence:** Inserted between A-01 (Intake Processor) and A-10 (Content Profile Builder) in the post-onboarding pipeline. Blocks A-02 Page Generator per Contract 73.

**Status:** ⏳ NOT STARTED (Phase 1 build pending)

## 10.5.2 Mission

Capture the client's existing brand voice, terminology, NAP data, certifications, manufacturer badges, customer testimonials, and visual identity assets from their public website so that Tarritrix-generated pages adopt the client's authentic brand voice rather than generic AI-flavored output. Without A-44, generated pages lack brand consistency and authentic trust signals — Contract 61 (AEO/Voice/Conversion Discipline) and Contract 18 (Evidence Authenticity HARD) compliance becomes impossible.

## 10.5.3 Capture Targets

A-44 extracts the following from the client's public website:

1. Brand voice and terminology (how the client describes their services in their own words)
2. Existing keywords ranking in Google for the client's domain (from Google Search Console if OAuth granted, otherwise inferred from page content)
3. NAP data (Name, Address, Phone) for consistency verification against intake form
4. Service descriptions verbatim
5. Tone of voice analysis (formal / casual / expert / friendly)
6. Existing claims, certifications, and awards
7. Customer testimonials with attribution
8. Case studies and project photos
9. Manufacturer badges (GAF, CertainTeed, Owens Corning, IKO, and similar)
10. Trust marks (BBB accreditation, Angi membership, HomeAdvisor verified, etc.)
11. Professional licensing badges
12. Logos (header logo, footer logo, alternate-mark variants)
13. Insurance certifications
14. Industry association memberships
15. EXIF data from photos worth importing to evidence_items (timestamp, GPS coordinates, camera model)

## 10.5.4 Refresh Model — Three Triggers

A-44 implements three refresh triggers, all of which write a new row to client_ingestion_versions.

### Trigger 1 — Onboarding (Mandatory, Blocking)

- Fires automatically as Step 9 of the onboarding workflow (see Section 4.1)
- Initiated by the platform immediately after Step 7 payment confirmation transitions clients.status to 'active'
- A-02 Page Generator is blocked from executing for this client until A-44 produces a client_ingestion_versions row with status='success' AND approval_status='auto_approved' AND is_current=TRUE
- LLM cost: approximately $0.35–0.55 per client (one-time)
- Duration: 3–7 minutes for typical client sites under 100 pages

### Trigger 2 — Quarterly CRON (Automatic)

- New CRON job: CRON-03 a44-quarterly-refresh
- Schedule: daily evaluation, fires per client when clients.next_ingestion_scheduled_at <= NOW()
- After successful scrape, computes diff against current version using deterministic hash comparison (no LLM cost for diff classification)
- If diff_severity = 'none' or 'minor': auto-approved, becomes current
- If diff_severity = 'material' or 'breaking': queued for operator approval, P1 advisory signal raised, prior version remains current until master_admin or senior_admin approves
- After scrape completion (success or failure), next_ingestion_scheduled_at is reset to NOW() + 90 days + random ±7 day jitter to prevent quarterly-refresh thundering herd

### Trigger 3 — Manual (master_admin or senior_admin)

- Dashboard affordance: "Force Re-scrape" button on /dashboard/clients/[id] Knowledge Base tab
- Requires justification field (e.g., "Client relaunched site," "New certifications announced," "NAP data correction")
- Triggers A-44 immediately, bypassing the quarterly schedule
- After completion, next_ingestion_scheduled_at is reset to NOW() + 90 days + jitter from the manual scrape completion time
- VAs cannot trigger this — gated by permission matrix per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md Section 3.3

### Trigger 4 — Signal-Driven (Deferred to Phase 1.5)

- Future capability: when A-08 Indexation Tracker detects substantial sitemap changes on the client's domain (sitemap last_modified delta >20%, canonical URL shifts), auto-queue an A-44 re-scrape
- This requires sitemap-change detection logic in A-08 that does not currently exist
- Out of scope for Phase 1 A-44 ship — spec'd here for operator awareness
- Build in Phase 1.5

## 10.5.5 Diff Detection Algorithm

A-44 post-scrape diff computation is deterministic (no LLM cost):

1. Hash the new scrape's critical fields:
   - Logo URL hash
   - Brand name string
   - NAP data (name, address, phone normalized to E.164)
   - License numbers (set comparison)
   - Certification list (set comparison)
   - Manufacturer badge list (set comparison)
   - Industry association list (set comparison)
2. Compare to the current version's hashes
3. Classify:
   - All hashes identical → diff_severity = 'none'
   - Only non-critical fields changed (about-page wording, testimonial copy edits) → diff_severity = 'minor'
   - Critical fields changed (logo, NAP, license, certifications, manufacturer badges added/removed) → diff_severity = 'material'
   - Domain itself changed OR all critical fields differ → diff_severity = 'breaking'
4. Write diff_summary JSONB containing field-by-field deltas for operator review UI

## 10.5.6 Storage Model

All A-44 outputs persist in three existing A-44 tables (declared but not yet migrated):

- client_ingested_assets — raw captures with per-asset metadata (source URL, capture date, asset type, classification confidence, asset_version, is_current)
- client_brand_voice_model — per-client voice and terminology model used by A-02 and A-25
- client_keyword_gap_analysis — keywords client should rank for but doesn't

Plus the new versioning table created per Document 4 (SCHEMA_REGISTRY.md delta):

- client_ingestion_versions — per-scrape version metadata with diff_severity, approval_status, is_current

A-02 always reads from the version pointed to by clients.current_ingestion_version_id. Historical pages do not retroactively change when a new version becomes current — they continue rendering with the assets that were current at their publish time (handled via versioning columns on evidence_items and asset reference tables in a follow-on migration documented in SCHEMA_REGISTRY.md).

## 10.5.7 Failure Handling

If A-44 scrape fails (site down, robots.txt blocks all crawlers, parse error):

- client_ingestion_versions row is created with status='failed' and failure_reason populated
- Existing current version (if any) remains current; A-02 continues with stale data
- P2 advisory signal raised: "Quarterly knowledge ingestion failed for [client name]. Retry scheduled."
- Retry with exponential backoff: +1 day, +3 days, +7 days
- After 7 days of consecutive failures, escalate to P1 signal
- Master_admin can manually block A-44 for a client via clients.ingestion_blocked = TRUE with reason (e.g., "Client requested no automated crawls")

## 10.5.8 Master_Admin Override — Unscrapable Sites

Contract 73 has exactly one override path: a master_admin may bypass the A-44 prerequisite for a specific client by manually providing ingestion assets.

When to use this override:
- Client's website is genuinely unscrapable (down at onboarding, robots.txt blocks all crawlers, no public site exists)
- Client requests no automated crawling of their domain
- Client provides their own brand assets directly (operator uploads them manually)

Process:
1. Master_admin opens /dashboard/clients/[id] Knowledge Base tab
2. Clicks "Manual Asset Provision" button (visible to master_admin only)
3. Required justification field populated with reason
4. Uploads brand voice descriptors, logo files, certification badges, NAP data via form
5. Platform creates client_ingestion_versions row with approval_status='manually_provided', is_current=TRUE
6. Action logged to user_actions with action_type='override_a44_prerequisite' per Contract 72

After the override, A-02 is unblocked for the client. The override is visible in audit logs to all master_admin and senior_admin users.

## 10.5.9 Risk Acknowledgment (Carried Forward from AGENTS.md 2026-05-17 Operator Decision)

No preemptive copyright filtering on captured manufacturer badges, certifications, or similar third-party trust marks. Cease-and-desist is the rare-case recovery path. Manufacturers benefit from product promotion and rarely object to certified-installer displays. If C&D received for any specific asset, remove that asset from active rendering and disable client re-display via the client_ingested_assets table flag.

## 10.5.10 Outputs Summary

- client_ingested_assets table populated with per-asset rows
- client_brand_voice_model row updated for the client
- client_keyword_gap_analysis row updated for the client
- evidence_items table extended with ingested photo imports
- client_ingestion_versions row created with appropriate status and approval_status
- clients.current_ingestion_version_id pointer updated to the new is_current=TRUE row
- clients.last_ingestion_at, next_ingestion_scheduled_at updated

## 10.5.11 Tables Used

A-44 reads from and writes to:

- client_ingested_assets (Phase 1 migration N+X — exact slot reserved at implementation)
- client_brand_voice_model (Phase 1 migration N+X)
- client_keyword_gap_analysis (Phase 1 migration N+X)
- client_ingestion_versions (Phase 1 migration N+4 per ROLE_HIERARCHY_ARCHITECTURE_SPEC.md)
- evidence_items (extended with new columns for ingested photo imports)
- clients (extended with current_ingestion_version_id, last_ingestion_at, next_ingestion_scheduled_at, ingestion_blocked, ingestion_block_reason)

Migration details and exact schema appear in SCHEMA_REGISTRY.md following the Document 4 delta of the 2026-05-23 governance synchronization.

## 10.5.12 Contract Enforcement

- Contract 73 (Pre-Generation Knowledge Ingestion Requirement) — A-02 is blocked until A-44 produces a successful current version for the client
- Contract 61 (AEO/Voice/Conversion Discipline) — A-02 reads client_brand_voice_model output for tone, terminology, and entity references
- Contract 18 (Evidence Authenticity HARD) — A-44 outputs feed A-43 Trust Signal Composer which composes verified trust signals onto each page
- Contract 72 (Multi-User Audit Attribution) — All A-44 manual triggers and override actions log to user_actions with three-attribute attribution
- Contract 71 (RBAC Enforcement) — Manual triggers and override actions gated by permission matrix
- Contract 60 (Backlink Operations Strict Whitelist) — does not apply directly to A-44 but A-45 reads A-44 outputs for unlinked-mention detection, which is Contract 60-bounded

---

```

---

## 7. CHANGE 6: Add Part 11 "RBAC Architecture and A-44 Phase 1 Placement"

### 7.1 Context

BLUEPRINT.md does not currently contain a structural overview of the multi-user role hierarchy. The full canonical specification lives in `ROLE_HIERARCHY_ARCHITECTURE_SPEC.md`. BLUEPRINT.md should contain a cross-reference section that establishes the architectural decision in the master blueprint and points to the canonical spec for detail.

### 7.2 Insertion location

Insert at the end of the file, after line 4482 (the current final line of BLUEPRINT.md, which is the last line of the Asset Hub Feature Overview section).

### 7.3 Content to insert

```
---

# ============================================================================
# PART 11 — 2026-05-23 RBAC ARCHITECTURE LOCK
# ============================================================================

## 11.1 Architectural Decision

On 2026-05-23, the operator authorized a multi-user role hierarchy to replace the prior single-operator architecture. The decision is durably locked per Contract 50 (Architectural Decision Durability).

## 11.2 Role Taxonomy

Three operator-side roles plus the existing client role:

- **master_admin** — platform owner, top of hierarchy, full action scope subject only to constitutional constraints (Contracts 6, 9 hard gates, 18, 45). Typically one user, schema permits more.
- **senior_admin** — trusted operational manager, can execute substantive work on any client including page approval and A-44 manual triggers, cannot make decisions affecting billing, role assignments, or permanent destructive actions.
- **va** — virtual assistant, can execute high-volume low-risk operational tasks including evidence upload, directory registration, backlink advisory operations (Contract 60-bounded), and indexation checks. Cannot trigger expensive operations, approve flagged pages, override quality gates, or modify financial state.
- **client** — existing client portal role, unchanged.

## 11.3 Permission Scoping

Roles are **global**, not per-client. A VA is a VA across all clients. A senior_admin is a senior_admin across all clients. This was the operator decision 2026-05-23 (Wave 1 Issue B answer).

## 11.4 Audit Attribution

Every audit-logged action captures three attributes:
1. Acting user ID
2. Role at time of action (preserved historically, not retroactively updated)
3. Client context (NULL only for platform-level actions like role grants)

This was the operator decision 2026-05-23 (Wave 1 Issue C answer). Contract 72 enforces this.

## 11.5 A-44 Phase Relocation

A-44 Client Knowledge Ingestion Engine is relocated from Phase 1.5 to Phase 1, sequenced immediately after A-01 and before A-10 in the post-onboarding pipeline. A-02 Page Generator cannot execute for a client until A-44 produces a successful current ingestion version. Contract 73 enforces this. Full A-44 specification appears in Part 10.5 above.

## 11.6 Schema Additions

The RBAC architecture introduces four new tables and nine column additions to existing tables. Full schema specification appears in SCHEMA_REGISTRY.md following the Document 4 delta of the 2026-05-23 governance synchronization. Tables added:

- user_roles
- user_actions
- role_grant_audit
- client_ingestion_versions

## 11.7 New Behavioral Contracts

Three new contracts are added per the 2026-05-23 synchronization. Full text in BEHAVIORAL_CONTRACTS.md:

- Contract 71 — Role-Based Access Control (RBAC) Enforcement
- Contract 72 — Multi-User Audit Attribution
- Contract 73 — Pre-Generation Knowledge Ingestion Requirement

Contract 67 (Resource Ownership Verification) is amended rather than replaced to incorporate role-based ownership semantics.

## 11.8 Canonical Specification Reference

The full canonical specification for the role hierarchy, including the complete permission matrix across all 45+ protected actions, RLS policies, migration sequence, UI implications, backward compatibility plan, and risk mitigations, is documented in:

**`docs/architecture/ROLE_HIERARCHY_ARCHITECTURE_SPEC.md`**

This file is the single source of truth for role hierarchy implementation. BLUEPRINT.md cross-references it; SCHEMA_REGISTRY.md derives from it; AGENTS.md sequences from it; BEHAVIORAL_CONTRACTS.md enforces from it; MASTER_BUILD_SPEC.md surfaces from it; STATE_OF_THE_BUILD.md logs from it.

Any discrepancy between this Part 11 summary and ROLE_HIERARCHY_ARCHITECTURE_SPEC.md is resolved in favor of ROLE_HIERARCHY_ARCHITECTURE_SPEC.md.

## 11.9 Backward Compatibility

The existing operator account `operator@tarritrix.test` (auth UUID `aaaaaaaa-0000-0000-0000-000000000001`) is automatically promoted to master_admin via migration N+2 (`seed_user_roles_from_auth_users.sql`). E4 Construction & Roofing client ownership (via `clients.operator_id`) is preserved unchanged — the operator_id continues to point to the now-master_admin account.

Existing seeded clients (E4 and any others) receive synthetic baseline A-44 ingestion version rows via migration N+8 (`seed_a44_baseline_for_existing_clients.sql`) so that Contract 73 is satisfied at the database constraint level and A-02 page generation continues without interruption. The synthetic baseline flag (`clients.ingestion_synthetic_baseline = TRUE`) marks these clients for a real A-44 scrape at the next operator-touched interaction.

## 11.10 Change Log Reference

This Part 11 lock is recorded in STATE_OF_THE_BUILD.md as a session log entry under 2026-05-23. The session log entry includes the commit hash that applied the synchronized governance updates across all 6 files plus the ROLE_HIERARCHY_ARCHITECTURE_SPEC.md addition.

---

**End of BLUEPRINT.md.**
```

---

## 8. VERIFICATION QUERIES FOR THIS DELTA

After CC applies these edits, the following queries MUST pass before the commit is accepted:

### 8.1 Conflict resolution verification

```bash
# A-21 must no longer be paired with "Client Site Ingestion" in BLUEPRINT.md
grep -i "A-21.*Client Site Ingestion" /path/to/BLUEPRINT.md
# Expected: zero matches

# A-44 must be present as the canonical client ingestion slot
grep -i "A-44.*Client Knowledge Ingestion" /path/to/BLUEPRINT.md
# Expected: at least 4 matches (cross-reference section, Part 10.5 heading, Part 11.5, pipeline diagram)
```

### 8.2 Phase relocation verification

```bash
# A-44 must appear with "Phase 1" designation
grep -i "A-44.*Phase 1" /path/to/BLUEPRINT.md
# Expected: at least 2 matches

# No remaining instance of "A-44.*Phase 1.5" in BLUEPRINT
grep -i "A-44.*Phase 1.5" /path/to/BLUEPRINT.md
# Expected: zero matches
```

### 8.3 RBAC content presence

```bash
# Role hierarchy terms must appear in BLUEPRINT
grep -i "master_admin\|senior_admin\|RBAC" /path/to/BLUEPRINT.md | wc -l
# Expected: at least 20 occurrences across Section 8.6.5 and Part 11

# Contract 71, 72, 73 references
grep -E "Contract 7[123]" /path/to/BLUEPRINT.md | wc -l
# Expected: at least 6 occurrences
```

### 8.4 Onboarding step count

```bash
# Step 9 must exist
grep -E "^Step 9:" /path/to/BLUEPRINT.md
# Expected: 1 match (the new Step 9 Knowledge Ingestion)
```

### 8.5 Pipeline diagram verification

```bash
# A-44 must appear in the post-onboarding pipeline diagram
grep -A2 "clients.status = 'active'" /path/to/BLUEPRINT.md | grep -i "A-44"
# Expected: A-44 reference appears in pipeline flow
```

### 8.6 Line count check

```bash
wc -l /path/to/BLUEPRINT.md
# Expected: approximately 4,943 lines (4,482 + 461 net additions)
# Tolerance: ±20 lines for whitespace and formatting normalization
```

---

## 9. APPROVAL

This document requires operator sign-off before BLUEPRINT.md is modified in the repository.

**Operator approval format:**

- **"Approved — proceed to Document 3"** to advance to MASTER_BUILD_SPEC.md delta updates.
- **"Edits required: [list]"** to request specific revisions to this delta before approval.

After all 8 documents are approved, the CC prompt that performs the synchronized governance commit will apply this delta to BLUEPRINT.md as one of seven file modifications in a single atomic operation.

---

**End of Document 2 of 8.**
