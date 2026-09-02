# Test Account Activation Plan

**Document version:** 1.0
**Effective date:** 2026-05-20
**Status:** Phase 1 — REQUIRED before any test account activation
**Owner:** Operator
**Repository path:** `docs/test-phase/test-account-activation-plan.md`
**Related governance:** Client Intelligence Intake Master Document, Service Hub Pages Architecture Specification, A-46 Directory Registration Agent Specification, Asset Hub Feature Specification

---

## Purpose

This document defines how Tarritrix transitions from "shipped agents and infrastructure" to "live production platform serving real businesses with real traffic and real lead generation." Three businesses serve as the activation test cases: Tarritrix itself, E4 Construction & Roofing, and Architectural Flashing Supply.

The test phase serves three strategic functions:

1. **Production validation** — Confirms that platform components built and tested in isolation actually work together against real businesses with real traffic, real Google indexation, and real customer behavior
2. **Demo material generation** — Produces verifiable performance data (indexed pages, rankings, conversions, revenue attribution) that becomes the primary sales asset for external client acquisition and investor conversations
3. **Operator workflow maturation** — Builds the operational muscle memory for everything that will eventually be automated or outsourced (manual directory registration, manual onboarding data entry, manual review workflows) so that the eventual automation specifications reflect actual operational reality

The test phase is intentionally bounded. It is not a soft launch. It is not a beta. It is a controlled production deployment against accounts the operator controls, designed to surface issues before they impact paying clients.

---

## Scope and limitations

### What this document covers

- The three test accounts and their specific configurations
- Infrastructure that must be operational before activation
- Infrastructure that is explicitly deferred until after activation
- Activation sequence and timing
- Success metrics per account
- Test phase exit criteria
- Communication and reporting protocols
- Risk management and rollback procedures

### What this document does not cover

- The specific content of generated pages (handled by A-02 generation logic)
- The technical implementation of any individual agent (handled by per-agent specifications)
- External client onboarding workflows (handled by future documents post-test-phase)
- Billing and subscription mechanics (test accounts are not billed)

---

## The three test accounts

### Account 1: Tarritrix (the platform itself)

**Business type:** B2B SaaS platform for storm-driven trades
**Primary services:** Programmatic local SEO platform, penalty prevention, Answer Engine Optimization, Voice Search Optimization, AI Citation Tracking, Backlink Intelligence
**Primary audience:** Roofing contractors, PDR shops, restoration contractors
**Geographic coverage:** United States (national B2B reach, not local)
**Current state:** Marketing site live at tarritrix.com (already deployed)
**Test phase role:** Validates that the platform can market itself. Generates inbound demo requests from contractor prospects.

**Why Tarritrix goes first:** The operator knows this business completely. There is zero ambiguity about NAP data, services, value proposition, target audience, or competitive positioning. Any platform bug or unexpected behavior surfaces here with the lowest risk to external relationships.

**Specific intake considerations:**
- B2B SaaS, not local services — geographic targeting is national
- Services are software/platform features, not physical contractor work
- "Cities served" model needs to map to "geographic markets where contractors operate" rather than "where Tarritrix does the work"
- Conversion goal is demo requests, not job inquiries

### Account 2: E4 Construction & Roofing

**Business type:** B2C residential roofing and construction contractor
**Primary services:** (to be confirmed from E4 intake data) — likely roof replacement, roof repair, hail damage restoration, storm damage roofing, insurance claim assistance, emergency tarping
**Primary audience:** Homeowners with storm damage, insurance restoration prospects
**Geographic coverage:** (to be confirmed) — likely a defined metro area
**Current state:** Existing business with existing website and likely existing GBP listing
**Test phase role:** Primary validation of the contractor-business use case. Generates leads and conversion data.

**Why E4 goes second:** E4 has been referenced throughout governance as the ground-truth contractor client. The platform has been built with E4 in mind. This is the platform's home audience. Validation against E4 proves that the platform delivers on its core promise for the target market.

**Specific intake considerations:**
- Standard contractor intake applies — all 18 sections of the Client Intelligence Intake Master Document
- Full Storm Intelligence Engine relevance
- Full insurance carrier and manufacturer partnership relevance
- Full Xactimate workflow potential

### Account 3: Architectural Flashing Supply

**Business type:** B2B specialty supply (flashing products for roofing and construction trades)
**Primary services:** Wholesale and direct supply of architectural flashing products, custom fabrication, technical specifications and consulting
**Primary audience:** Roofing contractors, general contractors, building envelope specialists, architects
**Geographic coverage:** (to be confirmed) — likely regional or national distribution
**Current state:** Existing business with existing operations
**Test phase role:** Validates that the platform handles B2B supply businesses, not just B2C contractor services. Exposes assumptions baked into the contractor-services use case.

**Why Architectural Flashing Supply goes third:** This is the highest-learning test case. The platform has been built for B2C contractor services. Architectural Flashing Supply is B2B supply. The differences will surface architectural decisions that must adapt. Going third means E4 has already validated the core flow, and Tarritrix has already shaken out platform bugs.

**Specific intake considerations:**
- B2B supply business model — "service area" becomes "distribution area," "services" become "products"
- Conversion goal is quote requests and product inquiries, not job appointments
- Storm Intelligence Engine relevance is indirect (storms drive demand for flashing products that contractors then buy)
- Insurance carrier relationships not applicable
- Manufacturer partnership patterns invert — Architectural Flashing Supply IS the supplier, so they hold relationships with downstream contractors and architects
- Trade affiliations relevant (building product associations, AIA continuing education sponsorships, etc.)

The intake document Section 2 (Service Portfolio) needs to handle "Product Portfolio" as a variant. Section 15 (Sales Process) needs to handle B2B sales cycles (longer, more stakeholders, request-for-quote rather than instant booking).

---

## Required infrastructure before activation

This is the minimum set of platform components that must be operational before any test account is activated. Each item below is non-negotiable — activation cannot begin until all are functional.

### Schema and data layer

- All currently-shipped agent migrations applied to production database
- Schema baseline audit completed (no detected drift between live schema and governance)
- RLS policies functional and tested for tenant isolation
- Service hub schema additions migrated (per Service Hub Pages Architecture Specification)
- Lead capture schema in place (conversions table with TCPA consent fields)
- Multi-tenant scoping verified (test accounts cannot see each other's data)

### Core agent pipeline

- A-01 Intake Processor — shipped and functional
- A-02 Page Generator — shipped, supporting service-area, service-city, storm-reactive, and service-hub intents
- A-03 Schema Generator — shipped and functional
- A-04 Map Embed Generator — shipped and functional
- A-05 Page Validator — shipped with all 15 gates plus G16 Hub Completeness for hub pages
- A-06 Internal Linker — shipped and enforcing hub-and-spoke pattern
- A-07 Sitemap Generator — shipped and functional
- A-08 Indexation Tracker — shipped and functional (this is the critical gate per locked priorities; without A-08, success cannot be measured)
- CRON-01 Drip Publisher — shipped and functional, with hub page exclusion logic

### Operator tools

- Operator dashboard functional with at minimum:
  - Client list view with three test accounts visible
  - Per-client overview showing pages generated, pages indexed, leads captured
  - Manual onboarding form sufficient to enter all Tier 1 intake data per client
  - Service portfolio entry supporting multiple services per client
  - Cities entry supporting multiple cities per client
  - Hub page review queue with approve/reject/regenerate actions
  - Lead viewing per client with TCPA consent status
  - Operator notes per client

### Lead capture and routing

- Conversion form component embedded on every generated page
- TCPA-compliant consent capture with immutable storage
- Lead routing to per-client designated email address (using SendGrid, Resend, or equivalent transactional email service)
- Phone number last-4 masking enforced
- Lead detail view in operator dashboard

### Hosting and DNS

- Tarritrix hosting infrastructure (Vercel) configured to serve client subdomains
- DNS guidance documentation for each client to add CNAME records pointing their subdomain
- SSL certificate handling for client subdomains (automated via Vercel/Let's Encrypt)

### Compliance

- TCPA-compliant consent language deployed on every form
- Privacy policy live (current placeholder text acceptable for test phase, must be replaced before external clients)
- Terms of service live (same standard as privacy policy)
- Sub-processor disclosure page live

### Verification gates

- Full `pnpm verify:ci` passing including production build and Playwright tests
- Vercel production deployment green
- Schema verification passing
- Contract verification passing
- Multi-tenant isolation test passing (Tier 1 audit completed)
- Idempotency validation passing for all shipped agents
- RBAC audit passing

---

## Explicitly deferred infrastructure

The following components are NOT required for test account activation and are deliberately deferred to Phase 1.5 or post-test-phase Phase 1 work. The test phase proceeds without them.

### Deferred to post-test-phase Phase 1

- Asset Hub (client-facing self-service portal) — test accounts have operator-managed data entry
- Operator Command Center rebuild — current dashboard sufficient for three test accounts
- Basic CRM functionality — leads stored in database with email forwarding, full CRM screens built post-test-phase
- 8-step onboarding wizard polish — manual operator form sufficient for three accounts
- A-09 Conversion Handler full agent — simple email forwarding sufficient
- A-10 Content Profile Builder — not blocking for test accounts
- A-11 Content Refresh Engine — manual operator triggers acceptable
- A-14 Compliance Sentinel — manual compliance review acceptable
- A-18 Storm Intelligence Engine full automation — manual storm-reactive page triggering acceptable
- A-19 Universal Integration Hub — field service software integrations deferred

### Deferred to Phase 1.5

- A-46 Directory Registration Agent — operator manually registers directories for three test accounts
- VA Dashboard — operator handles all VA-tier work directly during test phase
- A-32 through A-39 anti-penalty defensive agents — three low-volume test accounts do not need full defensive moat yet
- A-25, A-26, A-27 AEO/VSO agents — pages generated with current A-02 logic, AEO/VSO enhancement applied later
- Full 8-step onboarding wizard — built when external client onboarding begins

### Deferred to Phase 2

- A-29 Performance Learning Engine
- A-31 Lead Download Engine
- A-40 External Signal Coordination Engine
- A-41 Engagement Quality Monitoring
- A-43, A-44, A-45 advanced intelligence and review velocity agents
- A-47 AI Citation Tracking Engine

### Justification for deferrals

Each deferred component falls into one of three categories:

**Category A — Replaced by manual operator effort during test phase:** Directory registration (A-46), VA tasks (VA Dashboard), client data entry (Asset Hub). These are normal early-stage manual workflows. The operator does this work directly, learns the workflow viscerally, and uses the learning to specify automation accurately later.

**Category B — Not needed at low client volume:** Anti-penalty agents (A-32 through A-39), advanced intelligence engines (A-29, A-31, A-40, A-41), AI citation tracking (A-47). These provide value only at higher client volumes or after sufficient platform tenure. Three test accounts do not trigger their value threshold.

**Category C — Sequenced after test phase learning:** Operator Command Center rebuild, basic CRM, A-10/A-11 content management. These should be designed against real test-phase usage data, not theoretical assumptions. Building them now produces guesswork; building them after test phase produces informed specifications.

---

## Activation sequence

### Pre-activation checklist (operator completes for each account before its activation date)

For each of the three test accounts, the operator must complete the following before activation:

1. **Confirm business identity data** — legal name, DBA, address, phone, email, owner contact
2. **Document service or product portfolio** — for E4 Roofing, full service breakdown; for Architectural Flashing Supply, product portfolio with B2B nuances; for Tarritrix, platform features as services
3. **Define geographic coverage** — cities/regions/markets per business model
4. **Inventory certifications and credentials** — licenses, insurance, manufacturer certifications, industry affiliations
5. **Document insurance carrier and manufacturer relationships** — applicable for E4 Roofing primarily, partially for Architectural Flashing Supply, not applicable for Tarritrix
6. **Capture existing digital footprint** — current website, GBP, social media, existing backlinks
7. **Collect brand assets** — logo files (vector if available, raster acceptable for test phase), brand colors, fonts, brand voice samples
8. **Define lead routing** — designated email address for each business
9. **Confirm DNS access** — operator has account credentials or direct contact with whoever manages each business's DNS
10. **Set up subdomain hosting** — choose subdomain naming convention per business
11. **Document goals and success metrics** — what does success look like for this specific test account at 30/60/90 days

This checklist is operator-completed during a 30-60 minute working session per client. Data is entered directly into the operator dashboard manual onboarding form.

### Activation Day 1: Tarritrix

Time-zero: when the operator completes Tarritrix intake entry and triggers activation.

**Activation sequence:**

1. Tarritrix client record created in `clients` table with full Tier 1 intake data
2. Services and cities seeded (for B2B platform, "services" = platform features marketed as services, "cities" = primary US metros where storm trades concentrate: Dallas, Houston, Atlanta, Denver, Phoenix, Tampa, Orlando, Charlotte, Kansas City, OKC, Birmingham, etc.)
3. A-02 generates location pages for each service-city combination
4. A-02 generates service hub pages for primary platform features
5. A-03 generates schema for all pages
6. A-04 generates static map embeds for all pages
7. A-05 validates all pages against 15 gates + G16 for hubs
8. Operator reviews and approves all hub pages
9. A-07 generates sitemap and robots.txt
10. Subdomain configured (e.g., `pages.tarritrix.com` or integrate into main domain at `/services/[service-slug]`)
11. CRON-01 begins drip publishing approved pages on schedule
12. A-08 begins indexation tracking
13. Conversion forms active on all pages routing to operator email
14. Operator submits sitemap to Google Search Console manually
15. Operator updates main tarritrix.com navigation to link to new service pages

**Day 1 success criteria:**
- All planned pages generated
- All hub pages reviewed and approved
- Site live and accessible
- Forms tested and confirmed routing to email
- Operator dashboard showing accurate state

### Activation Day 3-4: E4 Construction & Roofing

Wait 48-72 hours after Tarritrix activation. During this window, monitor Tarritrix for any unexpected issues, address them, and let lessons inform E4 activation.

**Activation sequence:** Same structural sequence as Tarritrix, with these E4-specific considerations:

- Full contractor intake — all 18 sections relevant
- Cities list reflects E4's actual service area (operator works with E4 to confirm canonical city list)
- Hub pages cover E4's primary services with full editorial depth — operator review per hub is critical because these are the primary sales pages
- Storm Intelligence Engine integration begins for E4's service area
- E4's existing GBP must be NAP-consistent with the platform data — operator verifies and coordinates updates if needed
- Subdomain configured on E4's domain (e.g., `pages.e4roofing.com` or operator's choice)
- E4 walks through DNS change with operator's guidance (5-minute task)
- Conversion forms route to E4's designated business email
- E4 adds link from their main site to new platform pages

**Specific data E4 needs to provide before activation:**
- Confirmed service list with descriptions
- Confirmed city list
- Logo files in best available format
- Insurance carrier preferred contractor letters if applicable
- Manufacturer certifications documentation
- 5+ case studies with photos (operator and E4 work together to assemble)
- DNS access for subdomain setup

### Activation Day 6-7: Architectural Flashing Supply

Wait 48-72 hours after E4 activation. Same window logic — monitor E4, address issues, apply learnings.

**Activation sequence:** Same structural sequence with these B2B-specific adaptations:

- Intake uses B2B variant — Service Portfolio becomes Product Portfolio, Sales Process reflects wholesale/distribution cycles
- Geographic coverage reflects distribution area (may be larger than typical contractor service area)
- Hub pages cover product categories (e.g., "Aluminum Flashing Systems", "Copper Flashing", "Custom Fabricated Flashing", "Counter Flashing", "Step Flashing", "Architectural Sheet Metal")
- Location pages target combinations of products and architect/contractor target audiences in various metros
- Storm Intelligence relevance: storms drive demand for flashing products, so storm-reactive pages target "after-storm building envelope inspection" and similar B2B angles
- Conversion forms request RFQ rather than appointment scheduling
- B2B-specific trust signals (years in supply business, manufacturer relationships, distribution capabilities, technical consulting availability)

**Specific data Architectural Flashing Supply needs to provide before activation:**
- Confirmed product portfolio
- Confirmed distribution territory
- Logo and brand assets
- Manufacturer partnership documentation (which products from which manufacturers they distribute)
- AIA continuing education accreditation if applicable
- Trade publication advertising history if applicable
- Case studies showing notable project supply
- DNS access for subdomain setup
- B2B sales process documentation (lead qualification, RFQ workflow, account management approach)

---

## Per-account success metrics

### Tarritrix success metrics (B2B SaaS)

**30 days post-activation:**
- 20+ pages indexed in Google
- 100+ organic impressions in Google Search Console
- Site infrastructure stable (no penalty signals, no deindexation events)
- Form submissions tested and functional

**60 days post-activation:**
- 40+ pages indexed
- 500+ organic impressions
- 3+ demo request submissions from organic traffic
- Top 50 ranking for at least 1 target B2B SaaS keyword

**90 days post-activation:**
- 60+ pages indexed
- 2,000+ organic impressions
- 8+ demo request submissions cumulatively
- Top 20 ranking for at least 1 target keyword
- At least 1 demo-to-customer conversion (becomes first external paying customer, transitioning out of test phase)

### E4 Construction & Roofing success metrics (B2C contractor)

**30 days post-activation:**
- 30+ pages indexed
- 200+ organic impressions
- Existing site traffic stable (no negative impact from new pages)
- Form submissions tested and functional

**60 days post-activation:**
- 70+ pages indexed
- 1,500+ organic impressions
- 2+ qualified lead submissions
- Top 30 ranking for at least 3 target service+city keywords

**90 days post-activation:**
- 100+ pages indexed
- 5,000+ organic impressions
- 5+ qualified lead submissions cumulatively
- Top 20 ranking for at least 5 target keywords
- At least 1 lead-to-customer conversion with documented revenue
- Zero penalty signals

### Architectural Flashing Supply success metrics (B2B supply)

**30 days post-activation:**
- 20+ pages indexed
- 100+ organic impressions
- Site infrastructure stable
- RFQ form submissions tested and functional

**60 days post-activation:**
- 40+ pages indexed
- 500+ organic impressions
- 1+ RFQ submission
- Top 50 ranking for at least 1 target product+region keyword

**90 days post-activation:**
- 60+ pages indexed
- 1,500+ organic impressions
- 3+ RFQ submissions cumulatively
- Top 30 ranking for at least 3 target keywords
- At least 1 RFQ-to-order conversion with documented revenue

### Aggregate platform success metrics

Across all three test accounts at 90 days:
- 220+ pages indexed total
- 8,500+ organic impressions total
- 16+ qualified lead/RFQ/demo submissions total
- At least 2 of 3 accounts hitting their individual success metrics
- Zero penalty incidents across any account
- Zero security incidents across any account
- Platform uptime above 99.5%

---

## Test phase observation and learning protocol

### Daily monitoring (operator personal review)

Every day during the first 30 days post-activation per account:
- Check Vercel deployment status for any production issues
- Check Supabase database health
- Review any error notifications from Sentry or platform logs
- Scan agent_events table for failed agent invocations
- Check indexation status of new pages via A-08
- Review any lead submissions from previous 24 hours
- Note any unexpected behaviors in a daily log

After 30 days, daily monitoring becomes weekly.

### Weekly observation log

Every Monday during test phase, operator writes a brief log entry covering:
- Pages generated, validated, published this week per account
- Indexation progress per account
- Lead activity per account
- Bugs or edge cases discovered
- Workarounds or manual interventions performed
- Feature requirements emerging from operational experience
- Decisions deferred for future sessions

The log accumulates in `docs/test-phase/weekly-observations/` with one file per week.

### Bi-weekly platform health review

Every other Friday, full platform health check:
- All verification gates re-run (verify:ci including Playwright)
- Vercel deployment audit
- Database schema drift check
- RLS policy verification
- Multi-tenant isolation verification
- Cost analysis (LLM spend, infrastructure costs, attributable revenue)
- Anomaly investigation (any unexpected patterns in agent_events, llm_calls, conversions, tenant_signals)

### Monthly business review (per account)

For each test account at monthly mark:
- Pull comprehensive metrics
- Build visualization of progress (graphs, screenshots)
- Document what is working
- Document what needs adjustment
- Update success metric projections
- Communicate with E4 owner and Architectural Flashing Supply owner

### Edge case and feature requirement tracking

Every edge case discovered during test phase gets logged in `docs/test-phase/discoveries.md`:
- Date discovered
- Account where discovered (Tarritrix, E4, AFS)
- Nature of edge case or feature gap
- Severity (critical, high, medium, low)
- Workaround used during test phase
- Recommended permanent fix
- Phase assignment (Phase 1 backlog, Phase 1.5, Phase 2)

This log becomes the primary input for post-test-phase planning sessions.

---

## Test phase exit criteria

The test phase officially ends and the platform opens for external paying clients when ALL of the following are true:

### Technical exit criteria

- At least 2 of 3 test accounts have hit their 90-day success metrics
- Zero unresolved P0 incidents across all three accounts in trailing 30 days
- Schema baseline still locked (no drift)
- All verification gates passing consistently for 30+ days
- Vercel deployment green for 30+ days
- Multi-tenant isolation verified post-deployment

### Operational exit criteria

- Operator has documented operational workflows for: client onboarding data entry, hub page review, lead handling, directory registration, weekly client communication
- Asset Hub functional (built post-test-phase) for handling external clients who need self-service
- Basic CRM functional for managing external client leads at scale
- Stripe billing flow tested with at least one test transaction
- Legal pages have real content (replaces test-phase placeholder text)
- Operator Command Center rebuilt and functional

### Strategic exit criteria

- At least 5 qualified inbound demo requests from external prospects (proving the platform's marketing works)
- Test phase metrics are presentable as sales material with screenshots and verifiable data
- Investor demo materials prepared incorporating real test-phase data
- Pricing model finalized and tested mentally against the cost data from test phase
- Operator capacity assessed against projected onboarding throughput

When all three criteria sets are satisfied, the operator declares test phase complete via a formal commit to STATE_OF_THE_BUILD.md and the platform opens to external clients.

---

## Risk management

### Identified risks and mitigations

**Risk 1: One or more test accounts get hit by a Google penalty**

Probability: Low (only 4 of 13 anti-penalty agents shipped, but volume is low)
Impact: High (could damage reputation with friend businesses, set back test phase)

Mitigations:
- Penalty monitoring via A-08 indexation tracking from day one
- Drip publishing keeps publish cadence natural
- Hub pages reviewed manually by operator (no autonomous low-quality content)
- Content variation built into A-02 generation (page diversity)
- Conservative initial page volumes (don't generate 1000 pages day one)
- Immediate freeze-on-detection if any deindexation or manual action notice arrives

If a penalty fires:
- Immediately disable CRON-01 publishing for the affected account
- Investigate root cause via A-42 Penalty Pattern Detection (when shipped) or manual analysis
- Document the pattern for platform-wide prevention
- Coordinate with affected client transparently

**Risk 2: Lead routing failures losing real leads**

Probability: Medium (transactional email is generally reliable but edge cases exist)
Impact: High (a lost lead is a lost potential revenue and damages trust with test client)

Mitigations:
- Every lead stored in database before email forwarding (database is source of truth)
- Email forwarding via reputable provider (SendGrid or Resend) with delivery tracking
- Daily operator dashboard review of leads
- Backup secondary email destination per client
- Weekly reconciliation between database leads and what clients confirm receiving

**Risk 3: Site outage affecting client primary business**

Probability: Low (Vercel uptime is high; Supabase generally reliable)
Impact: High if test client perceives platform as risk to their existing business

Mitigations:
- Subdomain hosting isolates platform pages from client's main website
- Client's main website remains independent and unaffected
- Status monitoring with proactive client notification if platform issues arise
- Documented incident response process with operator notification

**Risk 4: Data exposure between test accounts**

Probability: Very Low (RLS policies should prevent this, but human error is possible)
Impact: Critical (any cross-tenant data leak is catastrophic for trust)

Mitigations:
- Multi-tenant isolation audit completed before activation
- Regular RLS verification testing
- Operator dashboard explicitly displays which client is currently selected
- No cross-client query patterns in any agent code
- Audit log captures every operator action

**Risk 5: Test account performance below success metrics**

Probability: Medium (any new SEO play is uncertain)
Impact: Medium (affects sales material, doesn't break platform)

Mitigations:
- Metrics set with realistic ranges, not aspirational ceilings
- Phased measurement (30, 60, 90 days) allows mid-course correction
- Underperformance triggers diagnosis: is it the platform, the keyword selection, the competitive landscape, the content quality?
- Multiple accounts provide redundancy — 2 of 3 hitting metrics is acceptable

**Risk 6: Operator burnout during intensive test phase**

Probability: Medium (the test phase is operationally intensive)
Impact: High (operator is single point of failure)

Mitigations:
- Realistic activation cadence (2-3 day stagger, not all at once)
- Phased operational depth (daily monitoring scales down to weekly after 30 days)
- Documented workflows reduce cognitive load
- Pre-test-phase commitments reduce decision fatigue
- Explicit "stop and think" checkpoints (monthly business reviews)

### Rollback procedures

If activation reveals critical issues that cannot be resolved within 24 hours:

**Subdomain-level rollback:** Remove CNAME record at client's DNS. Subdomain becomes unreachable. Client's main website unaffected. Allows debugging without affecting test client.

**Account-level rollback:** Set client's status to `paused` in database. All agents skip paused clients. Pages remain in database but cease updating. No data loss.

**Platform-level rollback:** Revert last Vercel deployment via Vercel dashboard. Database state remains current. Issue addressed at code level.

**Database-level rollback:** For migration-related issues, restore from most recent backup. Communicate with affected clients about any data loss in the affected window.

---

## Communication protocols

### Internal operator communication (with self)

- Daily journal entry in `docs/test-phase/operator-journal/` during first 30 days
- Decisions log for any architectural or operational decision made during test phase
- Risk log for any concerning signal observed

### Communication with E4 Construction & Roofing

**Pre-activation:**
- 30-60 minute kickoff call to confirm intake data
- Walk through subdomain setup and DNS change
- Set 30/60/90 day expectations
- Confirm lead routing email and notification preferences

**During test phase:**
- Weekly status email: pages published, indexation progress, leads received, what's coming next week
- Monthly business review call: 30 minutes covering metrics, learnings, adjustments
- Immediate notification of any issues affecting their business

**Post-test-phase:**
- Conversion conversation: E4 either becomes first paying customer or remains complimentary access with documented reasoning
- Comprehensive performance report
- Recommendation for ongoing engagement

### Communication with Architectural Flashing Supply

**Pre-activation:**
- 30-60 minute kickoff call addressing B2B-specific considerations
- B2B success metric calibration (different from contractor metrics)
- Walk through subdomain setup
- Confirm RFQ routing email
- Set realistic timeline expectations (B2B SEO maturation is generally slower than B2C local)

**During test phase:**
- Bi-weekly status email (less frequent than E4 due to slower B2B cycles)
- Monthly business review call
- B2B-specific reporting

**Post-test-phase:**
- B2B customer conversion conversation
- Performance report tailored to B2B context
- Recommendation for ongoing engagement

### Communication about Tarritrix itself

Since Tarritrix is the operator's own business, communication is self-directed:
- Demo request tracking in operator dashboard
- Demo request follow-up workflow
- Conversion measurement from demo to paying customer
- Demo material curation from successful platform output

---

## Documentation artifacts to produce during test phase

The test phase is also a documentation generation event. The following artifacts should be created during or immediately after the test phase:

1. **Test phase weekly observation logs** — `docs/test-phase/weekly-observations/`
2. **Edge case and feature requirement log** — `docs/test-phase/discoveries.md`
3. **Per-account performance reports** — `docs/test-phase/account-reports/[account]-[period].md`
4. **Operational workflow documentation** — `docs/operational/` (how to onboard, how to publish, how to review hubs, how to handle leads, etc.)
5. **Investor demo material** — `docs/marketing/test-phase-results.md`
6. **Updated agent specifications informed by real usage** — refinements to existing agent specs based on what was learned
7. **Post-test-phase priority queue** — what gets built next, informed by test phase discoveries

---

## Open questions for operator decision

1. **Subdomain naming convention** — Should each client use the same subdomain pattern (e.g., always `pages.[clientdomain].com`) or choose per-client (one uses `info`, another uses `services`, etc.)?

2. **Tarritrix integration approach** — Tarritrix already has a marketing site at tarritrix.com. Should test phase pages live at `tarritrix.com/services/[service-slug]` (Model B, more SEO benefit) or at a subdomain like `pages.tarritrix.com` (Model A, lower complexity)? The platform is sophisticated enough to handle Model B for itself.

3. **E4 and Architectural Flashing Supply existing website integration** — operator coordinates DNS setup with each, but does operator also coordinate updates to their existing main site navigation (adding link to new pages), or does operator just provide instructions and the business handles it?

4. **Test phase compensation for E4 and AFS** — these are buddies allowing use as test cases. Should there be any consideration: free service permanently, discounted service when test phase ends, equity-style consideration, or pure goodwill?

5. **What happens if a test account doesn't hit success metrics** — does operator extend test period for that account, transition them to paying customer with discounted terms, or end the engagement?

6. **Sharing test phase data publicly** — can performance data from E4 and AFS be used in marketing materials (with their permission obviously) or kept private?

7. **External demo request handling during test phase** — Tarritrix marketing site will generate demo requests during test phase. Does operator take those demos and convert immediately (creating external clients before test phase ends) or queue them until test phase completes?

---

## Cross-references

- **Client Intelligence Intake Master Document** (`docs/onboarding/client-intelligence-intake.md`) — intake data structure used for all three test accounts
- **Service Hub Pages Architecture Specification** (`docs/architecture/service-hub-pages-spec.md`) — hub page generation applies to all three test accounts
- **A-46 Directory Registration Agent Specification** (`docs/agents/a-46-directory-registration-agent.md`) — deferred to Phase 1.5, manual registration during test phase
- **Asset Hub Feature Specification** (`docs/features/asset-hub-spec.md`) — deferred to post-test-phase Phase 1, operator handles data entry directly during test phase
- **STATE_OF_THE_BUILD.md** — to be updated with test phase activation status and ongoing observations

---

**End of document.**
