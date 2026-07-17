# BENAVORA — Product Requirements Document v2.0
## Supersedes: PRD v1.0
## Date: July 17, 2026
## Status: CANONICAL — All features below are approved build targets.
## Authority: Founder directive. This document governs all FORGE build queues.

---

## Product Vision v2.0

Benavora is an AI-powered nonprofit intelligence operating system. It does not merely help nonprofits manage grants — it actively discovers, pursues, wins, and learns from every funding opportunity across grants, corporate donations, in-kind gifts, and disaster relief. The system operates autonomously between sessions, delivering actionable intelligence every morning and executing outreach campaigns while the nonprofit sleeps.

**Core promise:** A solo nonprofit operator with Benavora outperforms a 10-person development team without it.

---

## Platform Pillars (18 total)

### PILLAR 1: Philanthropic Intelligence Graph
A living graph of all relationships between businesses, foundations, government agencies, board members, nonprofits, universities, and community organizations. Every node is an entity. Every edge is a verified relationship. Used by all other pillars as the relationship layer.

**User Stories:**
- PIG-01: As a user, I can search the relationship graph for any entity and see all connected relationships
- PIG-02: As a user, I can find the shortest path between my org and any target funder
- PIG-03: As a user, I can see when new relationships are discovered involving my watched entities
- PIG-04: As a user, I can export a relationship map as a visual PDF for board presentations
- PIG-05: As an admin, the system continuously discovers new edges nightly without my involvement

### PILLAR 2: AI Opportunity Discovery Engine
Benavora wakes up every morning and delivers discovered opportunities. Users rarely need to search.

**User Stories:**
- OD-01: As a user, I see a morning digest of new opportunities found overnight, pre-scored by probability
- OD-02: As a user, opportunities are personalized to my mission, geography, and historical success patterns
- OD-03: As a user, I can one-click add any discovered opportunity to my pipeline
- OD-04: As a user, I can dismiss opportunities with a reason that improves future personalization
- OD-05: As a user, I receive alerts when known funders post new RFPs
- OD-06: As a user, I receive alerts when FEMA declares disasters in my service area
- OD-07: As a user, I receive alerts when legislation affecting my funding category is introduced
- OD-08: As a user, inactive users receive a weekly email digest of top discoveries

### PILLAR 3: Corporate Giving Intelligence (from Corporate Intelligence Engine v1.0)
Full corporate donor acquisition, enrichment, scoring, and outreach. See CORPORATE_INTELLIGENCE_ARCHITECTURE.md.

### PILLAR 4: Autonomous Relationship Builder
AI development director that maintains relationship memory and recommends exactly when and how to engage each funder.

**User Stories:**
- ARB-01: As a user, the system monitors all my funders for signal events automatically
- ARB-02: As a user, I receive specific engagement recommendations with timing rationale
- ARB-03: As a user, the system remembers every interaction with every funder
- ARB-04: As a user, I can log calls and meetings that become part of relationship memory
- ARB-05: As a user, I see a relationship health score for every funder in my portfolio

### PILLAR 5: Grant Probability Engine
Every opportunity is scored before it appears anywhere. No alphabetical lists. Everything ranked by likelihood of success.

**User Stories:**
- GPE-01: As a user, every opportunity shows a probability score badge (0-100)
- GPE-02: As a user, opportunities default to sort by probability descending
- GPE-03: As a user, I can filter opportunities by minimum probability threshold
- GPE-04: As a user, I can see the full factor breakdown explaining any probability score
- GPE-05: As a user, I see specific improvement suggestions to increase my probability score
- GPE-06: As a user, each opportunity shows estimated ROI and time-to-complete
- GPE-07: As a user, the system recommends apply/consider/skip on every opportunity

### PILLAR 6: Organizational Digital Twin
A structured AI model of my organization that learns and grows. The AI knows us before writing anything.

**User Stories:**
- ODT-01: As a user, the system builds my Digital Twin from my Knowledge Base and 990 filings automatically
- ODT-02: As a user, I can view and edit my Digital Twin profile at any time
- ODT-03: As a user, grant drafts are automatically personalized using my Twin data — no re-entering org info
- ODT-04: As a user, my Twin includes proven narrative patterns from my successful grants
- ODT-05: As a user, my Twin includes board member profiles, program descriptions, and impact metrics
- ODT-06: As a user, the Twin completeness score tells me what's missing and why it matters

### PILLAR 7: Autonomous Proposal Factory (expands existing Draft Generator)
Not just AI writing — full proposal production including budgets, logic models, attachments, and AutoApply submission.

**User Stories:**
- APF-01: As a user, I can generate a complete proposal package (narrative + budget + logic model + timeline) in one click
- APF-02: As a user, generated budgets use my actual financial data from the Digital Twin
- APF-03: As a user, generated logic models follow the W.K. Kellogg Foundation format
- APF-04: As a user, letters of support are drafted using contact data from my CRM
- APF-05: As a user, compliance checklists are auto-generated per funder requirements
- APF-06: As a user, completed proposals route to AutoApply for submission

### PILLAR 8: Corporate Outreach Factory
One click generates a full personalized outreach sequence for any corporate prospect.

**User Stories:**
- COF-01: As a user, I can select any corporate prospect and generate a full outreach sequence
- COF-02: As a user, every email is individualized using the prospect's enrichment data — no templates
- COF-03: As a user, sequences include: initial outreach, follow-up, thank you, stewardship report
- COF-04: As a user, I can review and edit any generated email before sending
- COF-05: As a user, sent emails are tracked and responses trigger follow-up recommendations
- COF-06: As a user, meeting requests include a personalized agenda based on the prospect's giving DNA

### PILLAR 9: Donation Recommendation Marketplace
Amazon-style marketplace where companies list available donations and nonprofits receive AI-matched recommendations.

**User Stories:**
- DRM-01: As a corporate donor, I can list available goods/services/people with category, quantity, and geographic radius
- DRM-02: As a nonprofit, I receive automatic AI-matched donation recommendations weekly
- DRM-03: As a nonprofit, I can one-click request any listed donation
- DRM-04: As a corporate donor, I can approve/decline requests with one click
- DRM-05: As a nonprofit, I can search the marketplace by category and location
- DRM-06: As a user, the system generates an IRS-compliant donation receipt upon completion

### PILLAR 10: National Disaster Response Engine
When FEMA declares a disaster, Benavora automatically deploys a coordinated response within hours.

**User Stories:**
- DRE-01: As a user, I receive instant alerts when FEMA declares disasters in or near my service area
- DRE-02: As a user, relevant emergency funding opportunities are automatically surfaced within 1 hour of a declaration
- DRE-03: As a user, a pre-populated emergency grant application is generated for applicable programs
- DRE-04: As a user, corporate donors with disaster response capability near the affected area are identified automatically
- DRE-05: As a user, a coordinated outreach campaign to corporate disaster responders is launched with one click
- DRE-06: As a user, I see a real-time disaster response dashboard showing all active declarations

### PILLAR 11: Predictive Funding Forecast
Forward-looking funding intelligence. Forecast the future, not just report the past.

**User Stories:**
- PFF-01: As a user, I see a 90-day projected funding range for my pipeline
- PFF-02: As a user, I receive market trend alerts for my primary funding categories
- PFF-03: As a user, I see risk flags when my portfolio has concentration risk or expiring relationships
- PFF-04: As a user, I can generate a 12-month funding forecast for board presentations
- PFF-05: As a user, I see national funding trend data by category (housing, health, education, etc.)

### PILLAR 12: AI Board Advisor
Every board member gets a personal AI assistant for board responsibilities.

**User Stories:**
- ABA-01: As a board member, I receive an auto-generated meeting packet 48 hours before every board meeting
- ABA-02: As a board member, I see financial summaries in plain language — no jargon
- ABA-03: As a board member, I receive voting recommendations with rationale for agenda items
- ABA-04: As a board member, I receive compliance alerts specific to my fiduciary role
- ABA-05: As a board chair, I can see which board members have viewed the meeting packet
- ABA-06: As an ED, I can configure what each board member sees based on their committee role

### PILLAR 13: Community Impact Simulator
What-if modeling for strategic decisions before they're made.

**User Stories:**
- CIS-01: As a user, I can run any what-if scenario and see projected financial, capacity, and impact outcomes
- CIS-02: As a user, scenarios include: receiving/losing grants, opening locations, hiring staff, serving more beneficiaries
- CIS-03: As a user, simulation results include a risk assessment and recommended prerequisites
- CIS-04: As a user, I can save and compare multiple scenarios side-by-side
- CIS-05: As a user, I can share simulation results as a PDF for board or grant narrative use

### PILLAR 14: Funding Gap Analyzer (expands existing eligibility scoring)
AI identifies weaknesses in the org's funding position and recommends fixes.

**User Stories:**
- FGA-01: As a user, I see a funding gap report identifying my weakest narrative areas
- FGA-02: As a user, I see geographic gaps in my funder portfolio
- FGA-03: As a user, I see compliance issues that may be reducing my eligibility scores
- FGA-04: As a user, I receive specific recommendations to close each identified gap
- FGA-05: As a user, gap analysis runs automatically monthly and alerts me to new gaps

### PILLAR 15: Reputation Intelligence
Continuous monitoring of every funder and donor. Warn nonprofits before pursuing problematic relationships.

**User Stories:**
- RI-01: As a user, I am alerted when any funder in my CRM has negative news coverage
- RI-02: As a user, I am alerted when any funder faces regulatory or legal action
- RI-03: As a user, I am alerted when leadership changes at key funders
- RI-04: As a user, I can set monitoring on any funder or corporate prospect
- RI-05: As a user, reputation alerts are color-coded by severity (red/orange/yellow/blue/green)
- RI-06: As a user, I can dismiss alerts with a reason that improves future filtering

### PILLAR 16: Executive Command Center
Palantir-style large-format dashboard for the ED/CEO/Development Director.

**User Stories:**
- ECC-01: As an ED, I can see my entire funding operation on one screen in real time
- ECC-02: As an ED, I can switch to full-screen TV mode for board meetings
- ECC-03: As an ED, I can configure which panels appear and in what layout
- ECC-04: As an ED, I see live AI recommendations for my top 5 priority actions today
- ECC-05: As an ED, I see a donor heat map showing geographic concentration of my funding
- ECC-06: As an ED, panels update in real time via WebSocket — no page refresh needed

### PILLAR 17: Agent Marketplace
Configurable roster of specialized AI agents. Organizations enable only what they need.

**User Stories:**
- AM-01: As a user, I can browse all available agents with descriptions and plan requirements
- AM-02: As a user, I can enable/disable any agent I have access to on my plan
- AM-03: As a user, I can see the last run time, run count, and output summary for each enabled agent
- AM-04: As a user, I can view the full log for any agent run
- AM-05: As a user, I can configure parameters for agents that have configurable settings
- AM-06: As an owner, I can see aggregate agent usage across my organization

### PILLAR 18: Funding Knowledge Engine
The defining competitive advantage. AI trained on millions of historical funding relationships.

**User Stories:**
- FKE-01: As a user, I receive funder-specific intelligence about what gets funded and why
- FKE-02: As a user, I receive narrative pattern recommendations based on successful proposals
- FKE-03: As a user, I receive timing intelligence about when to submit for maximum success
- FKE-04: As a user, I receive competitive intelligence about who else competes for my target grants
- FKE-05: As a user, the knowledge engine improves automatically as more data is ingested
- FKE-06: As a user, I can query the knowledge engine directly: "What narrative elements most often win HRSA grants?"

---

## Technical Requirements

### Performance
- All page loads under 2 seconds
- AI agent responses under 30 seconds (with streaming where applicable)
- Real-time dashboard updates under 500ms latency
- Graph queries under 5 seconds for 3-hop traversals

### Scale
- Support 10,000+ concurrent organizations
- Handle 1M+ corporate prospect records without degradation
- Process 10,000+ enrichment jobs per overnight run
- Store and query 2,000+ funded proposals in Intelligence Library

### Security
- All org data RLS-protected at database level
- No cross-org data leakage (except anonymized aggregate patterns in Knowledge Engine)
- All AI calls use server-side keys only — never exposed to client
- All file uploads virus-scanned before storage

### AI Model Requirements
- All Claude calls use claude-sonnet-4-6
- All routes with AI calls require maxDuration = 300 in Vercel config
- All AI responses include confidence indicators
- No AI fabrication — all generated content sourced from org data or verified external sources

### Integration Requirements
- Supabase: primary database, auth, storage, realtime
- Railway: worker service for long-running jobs and enrichment pipelines
- Vercel: deployment, edge functions
- Resend: transactional email, campaign email
- Stripe: billing and subscription management
- Google Places API: business discovery
- Anthropic API: all AI features
- FEMA API: disaster declarations
- IRS APIs: BMF, 990 data
- SAM.gov API: federal opportunities
- Grants.gov API: federal grants
- Federal Register API: NOFAs
- NIH RePORTER API: health research grants
- NSF Award Search API: science grants
- USASpending API: federal award data
- Congress.gov API: legislative monitoring

---

## Data Architecture Principles

1. Every entity has a single source of truth table — never duplicate across tables
2. All enrichment data stored as jsonb — never add columns per enrichment field
3. All scoring data stored as jsonb — never add columns per score type
4. All relationship data in the pig_edges table — never encode relationships as foreign keys
5. All AI outputs include: model used, tokens consumed, confidence score, generated_at timestamp
6. All background jobs log to agent_runs table with full input/output
7. All financial data in USD cents (integer) — never floating point for money

---

## Pricing & Plan Gates

| Feature | Starter ($49/mo) | Professional ($149/mo) | Enterprise ($499/mo) |
|---|---|---|---|
| Grant Research Agent | ✓ | ✓ | ✓ |
| Draft Generator | ✓ | ✓ | ✓ |
| Impact Measurement Agent | ✓ | ✓ | ✓ |
| Opportunities (max) | 100 | Unlimited | Unlimited |
| AI Opportunity Discovery | — | ✓ | ✓ |
| Grant Probability Engine | — | ✓ | ✓ |
| Corporate Giving Intelligence | — | ✓ | ✓ |
| Reputation Intelligence | — | ✓ | ✓ |
| Board Advisor | — | ✓ | ✓ |
| Forecast Agent | — | ✓ | ✓ |
| Compliance Agent | — | ✓ | ✓ |
| Email Intelligence Agent | — | ✓ | ✓ |
| Relationship Builder | — | ✓ | ✓ |
| Philanthropic Intelligence Graph | — | — | ✓ |
| Executive Command Center | — | — | ✓ |
| Disaster Response Engine | — | ✓ | ✓ |
| Donation Marketplace | — | — | ✓ |
| Impact Simulator | — | — | ✓ |
| Volunteer Agent | — | — | ✓ |
| Legal Intelligence Agent | — | — | ✓ |
| White-label (consultant) | — | — | ✓ |
| Orgs per account | 1 | 1 | Unlimited |
| API access | — | — | ✓ |
