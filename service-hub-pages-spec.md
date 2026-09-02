# Service Hub Pages — Architecture Specification

**Document version:** 1.0
**Effective date:** 2026-05-20
**Status:** Phase 1 — REQUIRED before A-02 service-hub intent ships
**Owner:** Operator
**Repository path:** `docs/architecture/service-hub-pages-spec.md`
**Related governance:** BLUEPRINT.md, AGENTS.md A-02 entry, SCHEMA_REGISTRY.md, MASTER_BUILD_SPEC.md

---

## Purpose

Service Hub Pages are the central authority pages for each service category in a Tarritrix client's site. They sit one architectural level above the programmatic location-specific pages and serve as the editorial spine of the site. Without them, the site reads as a programmatic page mill — a pattern Google's quality algorithms specifically flag. With them, the site reads as a structured service business with coherent information architecture.

This specification defines what a service hub page is, how it differs from other page types, how it is generated, how it is validated, how it is reviewed, and how internal linking distributes authority through it.

This is a Phase 1 architectural addition. It must ship before any client publishes service-area pages at scale. Service area pages generated without their parent hub pages create an orphaned page structure that Google penalizes.

---

## Three-tier site architecture

Every Tarritrix client site follows a three-tier architecture:

**Tier 1 — Homepage**
The root domain. One page per client. Contains overall business overview, primary CTA, top-level navigation to service hubs, geographic coverage summary, primary trust signals.

**Tier 2 — Service Hub Pages**
One page per discrete service in the client's portfolio. Typically 5-10 hub pages per client. Each is a comprehensive authority page for that service category. Examples: `/services/hail-damage-restoration`, `/services/storm-damage-roofing`, `/services/insurance-claim-assistance`, `/services/emergency-tarping`, `/services/paintless-dent-repair`.

**Tier 3 — Location-Specific Pages**
Programmatic pages combining service and city. One page per service per city per intent. Hundreds to thousands per client at scale. Examples: `/services/hail-damage-restoration/dallas-tx`, `/services/hail-damage-restoration/plano-tx`, `/services/storm-damage-roofing/austin-tx`.

This architecture mirrors how real service businesses structure their sites and how Google expects local service business sites to be organized. Programmatic SEO platforms that skip Tier 2 and go directly from homepage to thousands of location pages get flagged for thin-content patterns. Tier 2 is the editorial proof that the site has substance.

---

## What a Service Hub Page IS

A service hub page is a comprehensive, authoritative, professionally-edited page that:

1. Covers one specific service in depth — what it is, when it is needed, how the client performs it, what makes the client qualified, what materials and methods are used, what warranties apply, what the customer can expect
2. Targets primary service keywords without geographic modifiers — "hail damage restoration," "storm damage roofing," "insurance claim assistance" — these are top-of-funnel searches that location pages cannot effectively rank for
3. Demonstrates editorial depth — 2,500 to 3,500 words of substantive content, not filler
4. Includes specific client proof — case studies, certifications, manufacturer partnerships, insurance carrier relationships, team credentials
5. Links DOWN to every relevant location page (the hub-and-spoke pattern)
6. Receives external backlinks — when a journalist or industry publication cites the client, they link to the hub, not to a location page
7. Anchors the brand voice for the service category — every location page borrows tone, key terminology, and structural cues from its parent hub
8. Includes a primary CTA above the fold with the same conversion form architecture as location pages
9. Requires operator review before publication — never auto-publishes via CRON-01

## What a Service Hub Page IS NOT

1. Not a homepage — the homepage covers the business as a whole; the hub covers one service
2. Not a location page — location pages target geographic intent; hubs target service intent
3. Not a blog post — blog posts are time-bounded content; hubs are evergreen authority pages
4. Not a thin landing page — landing pages convert paid traffic; hubs build organic authority
5. Not auto-published — every hub passes through manual operator review

---

## Required content modules

Every service hub page must contain these modules. The composition order can vary, but every module must be present and substantive.

### Module 1: Hero Section

- Service name as H1
- Primary value proposition (one sentence)
- Above-the-fold CTA (phone link, contact form, or both — per G7a static DOM check from A-05)
- Trust signal strip (certifications, years in business, insurance carrier networks)
- Hero imagery or video (real client work, not stock)

### Module 2: Service Overview

- 300-500 words explaining what the service is
- Why customers need this service
- Common situations that trigger this service
- Key terminology the customer should understand
- Cross-references to related services (with internal links to other hubs)

### Module 3: Why Choose This Client

- 400-600 words of client-specific differentiators
- Certifications relevant to this service (from Intake Section 4)
- Manufacturer partnerships relevant to this service (from Intake Section 6)
- Insurance carrier relationships relevant to this service (from Intake Section 5)
- Years of experience specific to this service
- Volume of jobs completed in this service
- Team qualifications and certifications

### Module 4: Our Process

- 500-700 words walking the customer through what to expect
- Step-by-step process from initial inquiry to job completion
- Specific timeframes per step
- What the customer's responsibilities are at each step
- What the client's responsibilities are at each step
- Common questions answered inline

### Module 5: Materials, Methods, and Warranties

- 300-500 words of technical detail
- Materials used (manufacturer brands, product lines)
- Methods and techniques specific to this service
- Workmanship warranty terms
- Manufacturer warranty pass-through terms
- Quality control measures

### Module 6: Case Studies

- 3-5 detailed case studies from the client's portfolio
- Each case study: location, project type, scope, timeline, outcome
- Before and after photos with EXIF-verified geographic data (per A-22)
- Customer testimonial quote per case study where available
- Insurance settlement amount where applicable and customer-permitted

### Module 7: Geographic Coverage

- List of cities served for this service
- Each city is an internal link to the corresponding location page
- Service area map (static map embed per A-04)
- Drive radius statement if applicable
- Expansion target cities noted but marked appropriately

### Module 8: Frequently Asked Questions

- 8-12 questions specific to this service
- Questions sourced from People-Also-Ask data, forum discussions, sales call recordings
- Answers must directly address the question (Answer Engine Optimization compliance per A-25)
- Schema.org FAQ markup applied (per A-03)

### Module 9: Trust Signals and Social Proof

- BBB rating and accreditation
- Google Business Profile rating and review count
- Industry awards and recognitions
- Manufacturer certifications with badge images
- Insurance carrier preferred contractor logos (where permission granted)
- Trade association memberships

### Module 10: Closing CTA Section

- Strong final call to action
- Secondary contact options (phone, form, chat if available)
- Emergency contact if applicable
- Operating hours
- TCPA-compliant consent language on form (per platform TCPA system)

---

## Content generation specifications

### Agent responsible

A-02 Page Generator handles service hub generation, with a new intent value:

- Current intent values: `service-area`, `service-city`, `storm-reactive`
- New intent value required: `service-hub`

This requires:
1. Database migration to extend the `intent` enum on the `pages` table
2. New prompt template in A-02 keyed to `service-hub` intent
3. Different generation parameters (token budget, model selection, validation profile)
4. New field on `pages` table or related table tracking parent hub relationships (`parent_hub_id` foreign key on service-area and service-city pages)

### Token budget and model selection

Service hub pages require significantly more LLM resources than location pages:

| Page Type | Word Target | Model | Estimated Cost |
|---|---|---|---|
| Location page (service-city) | 400-500 | Claude Haiku or Sonnet | $0.01-0.03 |
| Storm-reactive page | 500-700 | Claude Sonnet | $0.03-0.06 |
| Service hub page | 2,500-3,500 | Claude Opus or Sonnet (Opus preferred) | $0.40-0.80 |

The cost differential is intentional and justified. Hub pages are the authority foundation; spending 10-20x more on a hub vs a location page produces output worth 10-20x more in terms of ranking impact and backlink target value.

A-02's cost guard system must accommodate this. Hub generation cannot be blocked by daily LLM cost caps designed for location page volume. Hub generation runs as a manual operator trigger, not as automated batch generation.

### Generation prompt structure

The A-02 service-hub prompt template requires substantially more context than location prompts:

**Required inputs:**
- Client intake data (relevant sections from Client Intelligence Intake)
- Service details from `services` table (must be comprehensive per Section 2 of intake)
- Brand voice baseline from A-21 Client Site Ingestion
- Geographic coverage from `cities` table (used for Module 7)
- Case studies from intake Section 10 (minimum 3 required, 5 preferred)
- Certifications from intake Section 4
- Manufacturer partnerships from intake Section 6 (only those relevant to this service)
- Insurance carrier relationships from intake Section 5 (only those relevant to this service)
- Process documentation from intake Section 15
- Materials and methods from intake Section 2 expanded service details

**Pre-generation gates:**
A-02 must verify the following before generating a hub page:
1. Service exists in `services` table with complete data
2. Client has minimum 3 case studies for this service (intake Section 10)
3. Client has at least 10 verified job photos for this service (intake Section 11)
4. Client's evidence_lock_status is at least Tier 2 for this service
5. Brand voice has been ingested by A-21 (or operator has confirmed voice manually)

If any pre-generation gate fails, A-02 returns a HUB_PREREQUISITES_INCOMPLETE error with detailed gap list. The operator addresses the gaps before retrying.

### Idempotency and regeneration

Unlike location pages where idempotency means "do not generate twice," hub pages are intentionally regenerated periodically:

- Initial generation triggered manually by operator after Tier 2 evidence unlock
- Quarterly refresh suggested (operator-triggered) to incorporate new case studies and evidence
- Material change refresh (when client adds new certification, manufacturer partnership, or insurance carrier relationship)

Each generation creates a new version row in a hub history table (`service_hub_versions`) for audit and rollback. Only the latest version is live; previous versions are retained for diff comparison and operator review history.

---

## Validation specifications

### A-05 Page Validator profile for hubs

A-05 runs all 15 standard gates on hub pages, but with elevated thresholds:

**Gates with raised thresholds for hub pages:**

| Gate | Standard Threshold | Hub Threshold | Rationale |
|---|---|---|---|
| G3 Brand Signature | Score >= 70 | Score >= 90 | Hub is the brand voice anchor; weak brand voice on hub corrupts all child pages |
| G6 Word Count Variance | 400-800 words | 2,500-3,500 words | Hub editorial depth requirement |
| G7 Heading + G7a Contact Card | At least one H1 + contact affordance | One H1 + multiple H2/H3 structure + contact in hero + closing CTA | Hub must demonstrate structural depth |
| G8 Internal Links | >= 2 | >= 10 (links to child location pages) | Hub-and-spoke distribution requirement |
| G14 Performance Baseline | < 2MB | < 1.5MB | Hub is a primary landing target; performance critical |

**New gate for hub pages:**

**G16 Hub Completeness** — verifies presence of all 10 required modules per the content specification above. Each module must be detected via heading parsing and content density check. Missing any module fails the gate.

This gate is HARD (un-overridable) for hub pages. Operator cannot bypass missing modules through soft-gate override.

### Manual operator review

Every hub page generated by A-02 enters the operator review queue. It does not auto-publish via CRON-01 even if all gates pass.

The review queue interface (`/dashboard/hubs/review`) shows:
- Generated hub page rendered as it will appear live
- Diff comparison against previous version if applicable
- A-05 gate results summary
- Per-module quality assessment
- Editor interface for inline edits
- Approve, Reject, or Request Regeneration actions

Operator review checklist:
1. Does the content sound like the client, not like a generic contractor?
2. Are all certifications, partnerships, and credentials accurately represented?
3. Are all case studies real and verified?
4. Are all internal links correct and pointing at live location pages?
5. Is the geographic coverage list accurate?
6. Does the FAQ address questions actually asked by this client's customer base?
7. Are trust signals current and verifiable?
8. Is the CTA prominent and conversion-optimized?
9. Does the page differentiate the client from generic competitors?
10. Would the client themselves be proud to share this page?

Only after operator approval does the hub page publish. CRON-01 specifically excludes hub pages from automated drip publishing; operator approval moves the hub to live status manually.

---

## Internal linking architecture

The hub-and-spoke linking pattern is the architectural reason hubs exist. Without correct internal linking, hubs are wasted effort.

### Linking rules

**From homepage:**
- Homepage links to every service hub via primary navigation
- Homepage may also link to top 2-3 hubs from featured sections in the body content

**From service hub:**
- Hub links DOWN to every location page for that service (Module 7 in content specification)
- Hub links HORIZONTALLY to related service hubs (e.g., hail damage hub links to insurance claim assistance hub) — limit 2-3 horizontal links to prevent dilution
- Hub links UP to homepage in footer and breadcrumb only (not in body content)

**From location page:**
- Location page links UP to its parent service hub (mandatory, in breadcrumb and body content)
- Location page links HORIZONTALLY to other location pages in same city for different services (e.g., hail damage Dallas links to insurance claim assistance Dallas) — limit 3-5 horizontal links
- Location page does NOT link to other service hubs (to prevent authority dilution and keep flow concentrated)

### Implementation responsibility

A-06 Internal Linker (Phase 1 agent) is responsible for enforcing the hub-and-spoke pattern. A-06 reads the page hierarchy from the `pages` table (using the new `parent_hub_id` foreign key) and generates the link graph accordingly.

The link graph must satisfy:
- Every location page has exactly one parent hub link
- Every hub has links to all of its children (subject to volume limits — see below)
- Every hub-to-hub link is intentional and limited

### Volume limits

For hubs with many child location pages (200+ cities), linking to all children from the hub creates a page that is too link-heavy. The platform handles this with:

- Hub links directly to top 30 highest-priority child pages (per intake Section 3 priority designation)
- Remaining children accessible through "View All Locations" link to a paginated archive
- The archive page itself is indexable and links to all children

### Anchor text variation

Per A-36 Internal Link Pattern Shuffler (Phase 1.5), internal link anchor text must vary to prevent over-optimization. Hub-to-location links should not all read "hail damage restoration in [city]". Mix of:

- "Our hail damage restoration team in [city]"
- "[City] hail damage services"
- "[Service] for [city] homeowners"
- "Serving [city] homeowners with [service]"

A-06 generates these variations during link insertion.

---

## Database schema requirements

The current schema requires additions to support service hub pages. These additions must ship as a single migration before any hub page is generated.

### New columns on `pages` table

```
ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS parent_hub_id UUID REFERENCES pages(id),
  ADD COLUMN IF NOT EXISTS is_hub BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hub_review_status TEXT,
  ADD COLUMN IF NOT EXISTS hub_review_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hub_review_operator_id UUID REFERENCES operators(id);

CREATE INDEX IF NOT EXISTS idx_pages_parent_hub ON pages(parent_hub_id);
CREATE INDEX IF NOT EXISTS idx_pages_is_hub ON pages(is_hub) WHERE is_hub = TRUE;
```

### New value on `intent` enum (pages.intent)

```
ALTER TYPE page_intent ADD VALUE IF NOT EXISTS 'service-hub';
```

### New table for hub version history

```
CREATE TABLE IF NOT EXISTS service_hub_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  body_html TEXT NOT NULL,
  meta_description TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by_agent TEXT NOT NULL DEFAULT 'A-02',
  llm_model TEXT,
  llm_cost_usd NUMERIC(10,6),
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  review_status TEXT NOT NULL DEFAULT 'pending',
  operator_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_service_hub_versions_hub ON service_hub_versions(hub_page_id);
CREATE INDEX IF NOT EXISTS idx_service_hub_versions_current ON service_hub_versions(hub_page_id) WHERE is_current = TRUE;
```

### New table for hub review queue

```
CREATE TABLE IF NOT EXISTS hub_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_page_id UUID NOT NULL REFERENCES pages(id),
  hub_version_id UUID NOT NULL REFERENCES service_hub_versions(id),
  client_id UUID NOT NULL REFERENCES clients(id),
  service_id UUID NOT NULL REFERENCES services(id),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  priority INTEGER DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_operator_id UUID REFERENCES operators(id),
  review_started_at TIMESTAMPTZ,
  review_completed_at TIMESTAMPTZ,
  decision TEXT,
  decision_notes TEXT
);
```

---

## Operator workflow

### Initial hub generation per client

1. Client reaches Tier 2 evidence unlock (per Client Intelligence Intake Section 4-6 completion)
2. Operator reviews intake data for completeness per hub prerequisites
3. Operator triggers hub generation for each service in client's portfolio via dashboard action
4. A-02 generates each hub with `intent='service-hub'`
5. Each generation enters `hub_review_queue` automatically
6. Operator reviews each hub in the queue (typical review time: 15-30 minutes per hub)
7. Operator approves, rejects, or requests regeneration
8. Approved hubs publish to live status
9. A-06 generates internal links from new hubs to existing location pages
10. A-08 monitors hub indexation as priority pages

### Ongoing hub maintenance

1. Quarterly review prompt to operator: "Time to refresh hub pages for [client] — last refresh was [date]"
2. Operator decides which hubs to refresh based on what has changed since last generation
3. Operator triggers refresh, A-02 regenerates with current intake data
4. Refreshed version enters review queue
5. Operator reviews diff against current live version
6. Operator approves new version or keeps current

### Material-change triggers

The platform monitors for events that should trigger hub refresh prompts:
- New certification added by client (Intake Section 4 update)
- New manufacturer partnership added (Intake Section 6 update)
- New insurance carrier relationship added (Intake Section 5 update)
- New case study added (Intake Section 10 update with significant new content)
- New service line added (Intake Section 2 expansion)
- A-08 reports declining indexation or ranking for hub-targeted keywords

When any of these fires, operator gets a notification suggesting hub refresh.

---

## Dashboard requirements

### Operator Command Center additions

A new section in the Operator Command Center:

**Hub Pages Overview**
- Per-client hub inventory (which services have hubs, which don't)
- Hub status indicators (live, in review queue, needs refresh, blocked by missing intake)
- Last refresh dates
- A-08 indexation status per hub
- Ranking position for primary hub keywords (when A-08 data available)

**Hub Review Queue**
- All hubs awaiting operator review across all clients
- Sorted by priority and queue age
- Quick actions: open for review, request regeneration, escalate

**Hub Performance**
- Traffic per hub (when A-08 data available)
- Conversion rate per hub
- Backlinks per hub (when A-45 data available)
- Comparison: hub performance vs aggregate location page performance for the same service

### Client portal additions

Clients see (read-only):
- List of their hub pages with status
- Preview of each hub page
- Information about what would unlock additional hub pages (links to Asset Hub for incomplete intake sections)

Clients do NOT see:
- The hub review queue (operator-only)
- Hub version history (operator-only)
- A-05 gate scores or technical details (only operators see this depth)

---

## Failure modes and recovery

### Hub generation fails

**Symptoms:** A-02 returns HUB_PREREQUISITES_INCOMPLETE, HUB_GENERATION_FAILED, or LLM_COST_CAP_EXCEEDED

**Diagnosis:**
- Check `agent_events` for the specific A-02 invocation
- Review which prerequisite failed (intake data missing, evidence tier insufficient, brand voice not ingested)
- Review LLM cost guard status if cost cap fired

**Resolution:**
- For prerequisite failures, complete the missing intake section
- For evidence tier issues, advance client through Tier 2 unlock
- For cost cap issues, operator manually authorizes hub generation budget

### Hub review queue stalls

**Symptoms:** Hubs sit in queue for more than 14 days

**Diagnosis:**
- Check operator capacity
- Check if review queue UI is functional
- Review queued hubs for any that should be deprioritized

**Resolution:**
- If volume problem, add operator capacity or delegate hub review to senior staff
- If individual hub problem, request regeneration or reject and request manual writing

### Hub published but underperforming

**Symptoms:** A-08 reports low indexation, low ranking, low traffic, or A-29 reports low conversion

**Diagnosis:**
- Review content quality against current best practices
- Check if competitors have shipped better hub pages
- Check if internal linking is correct
- Check if backlinks are pointing at hub vs being scattered

**Resolution:**
- Trigger hub refresh to incorporate updated content
- Refocus backlink campaigns on hub pages specifically
- Review internal linking with A-06
- Add additional case studies and evidence to enrich the hub

### Hub-and-spoke linking breaks

**Symptoms:** Location pages have no parent hub link, or hub has missing child links

**Diagnosis:**
- Check `parent_hub_id` foreign key population on pages
- Check A-06 last execution against this client
- Review hub `is_hub=TRUE` flag is correctly set

**Resolution:**
- Re-run A-06 for the affected client
- If A-06 fails, manually populate `parent_hub_id` on affected pages
- Re-validate via A-05 G8 internal link gate

---

## Implementation sequencing

This specification requires the following work, in order:

1. **Schema migration** — add columns, new enum value, new tables (single migration file)
2. **A-02 service-hub intent** — new prompt template, new pre-generation gates, new generation logic
3. **A-05 hub-specific validation profile** — raised thresholds, new G16 Hub Completeness gate
4. **Hub review queue UI** — operator dashboard section for review workflow
5. **A-06 hub-aware linking** — internal linker recognizes hub-and-spoke pattern
6. **CRON-01 hub exclusion** — drip publisher must NOT auto-publish hub pages
7. **Hub version history** — version tracking for refresh workflows
8. **Material-change triggers** — notification system for refresh prompts
9. **Hub performance dashboard** — operator visibility into hub effectiveness
10. **Client portal hub status** — read-only client view

The full implementation is a multi-session build. The minimum viable hub system requires items 1-4 to be operational before any hub page can be generated. Items 5-10 can ship incrementally.

---

## Open questions for operator decision

These questions must be answered by the operator before implementation begins:

1. **Hub URL structure preference** — `/services/[service-slug]` or `/[service-slug]` or `/[service-slug]-services` or something else?
2. **Hub regeneration cadence default** — quarterly by default, or operator-triggered only with no default cadence?
3. **Cost authorization model for hub generation** — operator approves each hub generation individually, or batch-authorize a budget per client per period?
4. **Hub review SLA** — what is the maximum time a hub can sit in the review queue before escalation?
5. **Multi-operator review** — is hub review a single-operator decision, or does it require secondary approval?
6. **Failed hub recovery** — if a hub fails after publish (deindexation, ranking drop, manual penalty), what is the recovery workflow?
7. **Hub deletion policy** — if a service is discontinued by a client, what happens to the hub page (delete, redirect, archive)?

These questions should be resolved in a brief operator session before development begins. Each has implications for the database schema and UI design.

---

## Cross-references

- **Client Intelligence Intake Master Document** (`docs/onboarding/client-intelligence-intake.md`) — Sections 2, 4, 5, 6, 10, 11 are prerequisites for hub generation
- **A-46 Directory Registration Agent Specification** (`docs/agents/a-46-directory-registration-agent.md`) — to be written next; directories often require hub pages as destination URLs
- **Asset Hub Feature Specification** (`docs/features/asset-hub-spec.md`) — to be written; case studies and certifications upload feed hub content
- **A-06 Internal Linker** — Phase 1 agent responsible for hub-and-spoke link enforcement
- **A-05 Page Validator** — must add G16 Hub Completeness gate

---

**End of document.**
