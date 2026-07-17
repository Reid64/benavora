# BENAVORA — PLATFORM VISION ARCHITECTURE
## Master Document: 14 Net-New Platform Pillars
## Version: 1.0 | Date: July 17, 2026
## Authority: Founder directive. All 14 pillars are canonical build targets.
## Status: APPROVED — FORGE queues generated from this document.

---

# PILLAR 1: Philanthropic Intelligence Graph

## Definition
A living, continuously updated graph database of relationships between every entity in the philanthropic ecosystem. Not a table. Not a directory. A graph where every node is an entity and every edge is a verified relationship.

## Node Types
- Businesses (corporate_prospects table)
- Foundations (foundation_directory table)
- Government agencies (opportunities table sources)
- Family offices (new: family_offices table)
- Individual donors (new: individual_donors table)
- Board members (corporate_relationship_people table)
- Nonprofits (organizations table + nonprofits table)
- Universities (new: academic_institutions table)
- Churches and faith organizations (new: faith_organizations table)
- Vendors and suppliers (corporate_prospects)
- Community organizations (nonprofits table)

## Edge/Relationship Types
- previously_donated_to (source, target, amount, year, type)
- serves_on_board_with (person_a, person_b, organization)
- shares_executives (org_a, org_b, person_name)
- funds_similar_missions (org_a, org_b, mission_overlap_score)
- uses_same_suppliers (org_a, org_b, supplier_id)
- same_parent_company (subsidiary, parent)
- geographic_overlap (org_a, org_b, overlap_radius_miles)
- same_political_district (org_a, org_b, district_id)
- tax_incentive_alignment (donor, nonprofit, incentive_type)
- disaster_response_partner (org_a, org_b, disaster_id)
- foundation_of (company_id, foundation_id)
- board_member_of (person_id, organization_id, role, start_date)

## Schema
```sql
CREATE TABLE pig_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_table text NOT NULL,
  label text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(entity_table, entity_id)
);

CREATE TABLE pig_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id uuid REFERENCES pig_nodes(id),
  target_node_id uuid REFERENCES pig_nodes(id),
  relationship_type text NOT NULL,
  weight numeric DEFAULT 1.0,
  evidence text,
  verified boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  discovered_at timestamptz DEFAULT now(),
  UNIQUE(source_node_id, target_node_id, relationship_type)
);

CREATE INDEX idx_pig_edges_source ON pig_edges(source_node_id);
CREATE INDEX idx_pig_edges_target ON pig_edges(target_node_id);
CREATE INDEX idx_pig_edges_type ON pig_edges(relationship_type);
```

## Graph Discovery Engine
- Nightly job traverses all entities and discovers new edges
- Claude agent reads enrichment data and identifies relationship signals
- Confidence scoring on each edge (0.0-1.0)
- Human verification queue for low-confidence edges

## UI: Relationship Explorer
- `/research/graph` — interactive force-directed graph visualization
- Click any node to expand its relationships
- Filter by relationship type, confidence, date discovered
- "Find path between" — shortest path between any two entities
- Export relationship map as PDF for board presentations

---

# PILLAR 2: AI Opportunity Discovery Engine

## Definition
Benavora wakes up every morning and proactively delivers discovered opportunities to each subscriber. Users should rarely need to search. The AI searches for them.

## Discovery Triggers (run nightly at 2AM CST)
- New federal grants posted to Grants.gov, SAM.gov, Federal Register
- Foundation RFP announcements via web monitoring
- CEO/leadership changes at known funders
- New corporate foundation launches (IRS BMF new filings)
- Disaster declarations (FEMA API)
- New legislation mentioning housing, education, health (Congress.gov API)
- ESG announcements from Fortune 500 companies
- Expiring opportunities (deadline in 14 days, not yet in pipeline)
- New community foundation grant cycles
- Major acquisition announcements (acquired company may change giving)

## Personalization Engine
Each subscriber's discovery feed is personalized based on:
- Organization mission (from Digital Twin)
- Historical successful funders (from outcomes table)
- Geographic service area
- NTEE code and program categories
- Grant size range (historical requested_amount)
- Staff capacity signals (from onboarding)

## Daily Digest Delivery
- In-app notification: "47 new opportunities found overnight"
- Each opportunity pre-scored with Grant Probability Engine score
- One-click add to pipeline
- Dismiss with reason (helps personalization)
- Weekly email digest for inactive users

## Schema
```sql
CREATE TABLE discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date date NOT NULL,
  opportunities_found integer DEFAULT 0,
  opportunities_matched integer DEFAULT 0,
  sources_checked text[],
  runtime_seconds integer,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE discovery_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  opportunity_id uuid REFERENCES opportunities(id),
  discovery_run_id uuid REFERENCES discovery_runs(id),
  match_score numeric,
  match_reasons text[],
  status text DEFAULT 'pending',
  actioned_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

---

# PILLAR 4: Autonomous Relationship Builder

## Definition
An AI agent that behaves like a full-time development director. It maintains relationship memory, monitors signals, and tells the nonprofit exactly when and how to engage each funder or donor.

## Memory System
For every funder/donor relationship the AI remembers:
- Last conversation date and summary
- Email thread history (parsed via email integration)
- Phone call notes (manual entry)
- LinkedIn interaction history
- Press releases mentioning the relationship
- Board appointment announcements
- Company anniversary dates
- CEO/ED birthday (when publicly available)
- Previous donation amounts and dates
- Grant application history

## Signal Monitoring (continuous)
- LinkedIn: new posts, job changes, company news
- Google Alerts equivalent: funder name + donation + community
- Press releases: new initiatives, leadership changes
- IRS: new 990 filings with changed giving priorities
- News: acquisitions, expansions, ESG announcements

## Recommendation Engine
When a signal is detected, the AI generates a relationship action:
- "Reach out Tuesday — their CEO just announced a community housing initiative"
- "Send congratulations — XYZ Foundation just awarded their 1000th grant"
- "Schedule a call — their 990 shows 23% increase in giving this year"
- "Don't apply now — leadership transition, wait 90 days"

## Schema
```sql
CREATE TABLE relationship_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  entity_type text NOT NULL,
  memory_type text NOT NULL,
  content text NOT NULL,
  signal_date date,
  actioned boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE relationship_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  entity_type text NOT NULL,
  recommendation_text text NOT NULL,
  urgency text DEFAULT 'normal',
  trigger_signal_id uuid REFERENCES relationship_memory(id),
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);
```

---

# PILLAR 5: Grant Probability Engine

## Definition
Every grant opportunity in Benavora receives a probability score before it appears in any list. No more alphabetical lists. Every view is sorted by likelihood of success.

## Scoring Variables (11 factors)
1. Mission fit score (semantic similarity of org mission to opportunity description) — weight 20%
2. Geographic eligibility (org service area vs funder geography) — weight 10%
3. Budget alignment (requested amount vs funder avg grant size) — weight 10%
4. Organization age vs funder requirements — weight 5%
5. Past awards from same funder — weight 15%
6. Category success rate (org historical win rate for same category) — weight 15%
7. Competition level (estimated applicant pool size) — weight 5%
8. Required staffing capacity vs org size — weight 5%
9. Deadline proximity (enough time to apply well) — weight 5%
10. Knowledge base completeness for this category — weight 5%
11. Digital Twin profile completeness — weight 5%

## Output Per Opportunity
```typescript
interface GrantProbabilityScore {
  overall: number;           // 0-100
  confidence: 'high' | 'medium' | 'low';
  factors: ScoreFactor[];
  recommendation: 'apply' | 'consider' | 'skip';
  estimated_roi: string;     // "High: 3-5x effort return"
  time_to_complete: string;  // "Est. 8-12 hours"
  key_risks: string[];
  key_strengths: string[];
}
```

## UI Integration
- Every opportunity list shows probability badge (color-coded: green 70+, yellow 40-70, red below 40)
- Default sort: probability descending
- Filter: "Show only 60%+ probability"
- Opportunity detail: full factor breakdown with improvement suggestions

---

# PILLAR 6: Organizational Digital Twin

## Definition
A structured AI model of each nonprofit organization that learns and grows over time. The AI knows the organization deeply before writing a single word of any grant.

## Twin Components
```typescript
interface OrganizationalDigitalTwin {
  // Identity
  mission: string;
  vision: string;
  founded_year: number;
  ntee_codes: string[];
  service_areas: string[];
  
  // Programs
  programs: Program[];
  beneficiaries: BeneficiaryProfile[];
  geographic_footprint: string[];
  
  // Financial
  annual_budget: number;
  revenue_sources: RevenueSource[];
  expenses_by_category: ExpenseBreakdown;
  reserves: number;
  
  // People
  staff_count: number;
  board_members: BoardMember[];
  key_staff: StaffMember[];
  volunteers: number;
  
  // Impact
  outcomes: OutcomeMetric[];
  beneficiary_count: number;
  impact_statements: string[];
  evaluation_methods: string[];
  
  // Grant History
  successful_grants: GrantRecord[];
  denied_grants: GrantRecord[];
  success_patterns: string[];
  
  // Compliance
  irs_filings: IRSFiling[];
  audit_status: string;
  compliance_status: string;
  
  // Narrative Assets
  proven_narratives: ProvenNarrative[];
  logic_models: LogicModel[];
  budget_templates: BudgetTemplate[];
}
```

## Learning Mechanism
Twin is updated from:
- Onboarding wizard responses
- Knowledge base entries
- Uploaded IRS 990 filings
- Grant application history
- Outcome tracking entries
- Manual staff updates

## Usage in Proposal Factory
When Draft Generator runs, it reads the Digital Twin first. No questions asked. The AI already knows the org. Proposal is generated with org-specific data, proven narrative patterns, and real impact metrics — not generic filler.

---

# PILLAR 9: Donation Recommendation Marketplace

## Definition
An Amazon-style marketplace where companies list available donations (products, services, equipment, volunteers) and nonprofits receive AI-matched recommendations automatically.

## Donor Side (Companies)
Companies list available donations:
- Physical goods: vehicles, furniture, computers, medical equipment, construction materials, food
- Services: skilled labor, professional services, transportation, warehousing
- People: volunteer hours, board expertise
- Space: real estate, warehouse, office space
- Financial: cash grants, matching programs, scholarships

Each listing includes: item description, quantity, condition, pickup/delivery, availability dates, geographic radius, nonprofit category preference.

## Nonprofit Side (AI Matching)
System automatically matches nonprofit needs to available donations:
- Nonprofit's Digital Twin drives matching (programs + needs + location)
- AI ranks matches by relevance
- One-click request to donor
- Donor approves/declines
- Logistics coordination (pickup scheduling, documentation)

## Schema
```sql
CREATE TABLE marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id uuid REFERENCES corporate_prospects(id),
  listing_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  quantity integer,
  condition text,
  estimated_value numeric,
  pickup_required boolean DEFAULT false,
  delivery_available boolean DEFAULT false,
  geographic_radius_miles integer DEFAULT 50,
  category_preference text[],
  available_from date,
  available_until date,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE marketplace_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid REFERENCES marketplace_listings(id),
  org_id uuid NOT NULL,
  match_score numeric,
  match_reasons text[],
  status text DEFAULT 'pending',
  requested_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

---

# PILLAR 10: National Disaster Response Engine

## Definition
When FEMA declares a disaster, Benavora automatically identifies affected nonprofits, available corporate donors, government funds, and deploys coordinated response campaigns within hours.

## Trigger: FEMA API Integration
Monitor `https://www.fema.gov/api/open/v2/disasterDeclarationsSummaries` continuously.
On new declaration: extract affected counties/states, disaster type, declaration date.

## Automated Response Sequence
1. Identify affected nonprofits (organizations where service_area overlaps affected counties)
2. Notify affected nonprofits: "Disaster funds available in your area"
3. Surface relevant emergency grant opportunities (FEMA BRIC, HUD CDBG-DR, SBA disaster loans)
4. Identify corporate donors with disaster_response_capability=true within 200 miles
5. Match construction/supply companies to housing-focused nonprofits
6. Generate pre-populated emergency grant applications
7. Launch coordinated outreach campaign to corporate donors

## Disaster Fund Database
Maintain a standing database of emergency/disaster funding sources:
- FEMA BRIC grants
- HUD CDBG-DR funds
- SBA disaster loans
- Red Cross partnership programs
- State emergency management funds
- Corporate disaster response programs (Home Depot Foundation, Lowe's, etc.)

## Schema
```sql
CREATE TABLE disaster_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fema_disaster_number text UNIQUE,
  disaster_type text,
  affected_states text[],
  affected_counties text[],
  declaration_date date,
  incident_begin_date date,
  incident_end_date date,
  response_deployed boolean DEFAULT false,
  response_deployed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE disaster_response_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disaster_id uuid REFERENCES disaster_declarations(id),
  org_id uuid NOT NULL,
  campaign_type text,
  opportunities_surfaced integer DEFAULT 0,
  donors_contacted integer DEFAULT 0,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);
```

---

# PILLAR 11: Predictive Funding Forecast

## Definition
Instead of reporting what happened, Benavora forecasts what will happen to each subscriber's funding pipeline over the next 12 months.

## Forecast Models

### Portfolio Forecast
- Total funding likely to be received next quarter/year
- Probability-weighted pipeline value
- "At current trajectory, expect $X-$Y in awarded grants by Q4"

### Market Forecast
- Federal funding trends by category (housing, health, education, etc.)
- "Texas housing grants projected to increase 18% next year based on legislative activity"
- Foundation giving trend analysis (from 990 data patterns)
- Corporate giving sentiment (ESG announcement analysis)

### Risk Forecast
- "3 of your top funders have leadership changes — re-evaluate relationships"
- "Your largest grant expires in 6 months with no replacement in pipeline"
- "Success rate declining in federal category — recommend diversification"

## Data Sources for Forecasting
- Historical 990 data (foundation giving trends)
- Federal budget proposals and appropriations (Congress.gov)
- Legislative activity (new bills, amendments)
- Economic indicators (unemployment, housing starts)
- Org's own historical win rates by category and funder

## Schema
```sql
CREATE TABLE funding_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  forecast_date date NOT NULL,
  forecast_period text NOT NULL,
  projected_min numeric,
  projected_max numeric,
  projected_most_likely numeric,
  confidence numeric,
  methodology text,
  factors jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE market_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  geography text,
  forecast_period text NOT NULL,
  trend_direction text,
  trend_magnitude numeric,
  evidence text[],
  created_at timestamptz DEFAULT now()
);
```

---

# PILLAR 12: AI Board Advisor

## Definition
Every board member of a Benavora-subscribed nonprofit gets a personal AI assistant that prepares them for board responsibilities and keeps them informed.

## Board Member Features
- Personal dashboard at `/board/[member_id]`
- Meeting packet auto-generation before each board meeting
- Financial summary in plain language (no jargon)
- Voting recommendations with rationale
- Compliance alerts (IRS deadlines, audit requirements)
- Fundraising opportunity briefings
- Strategic planning input requests from AI
- Risk assessment reports

## Meeting Packet Contents (auto-generated)
- Executive summary of org performance since last meeting
- Financial dashboard (budget vs actual, cash position)
- Grant pipeline status (submitted, pending, awarded this period)
- Top 3 strategic decisions needed
- Compliance calendar
- Upcoming deadlines
- AI-generated discussion questions

## Schema
```sql
CREATE TABLE board_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  role text,
  committee text[],
  term_start date,
  term_end date,
  expertise text[],
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE board_meeting_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  meeting_date date NOT NULL,
  packet_content jsonb NOT NULL,
  generated_at timestamptz DEFAULT now(),
  viewed_by text[]
);
```

---

# PILLAR 13: Community Impact Simulator

## Definition
What-if modeling for nonprofit strategic decisions. The AI simulates outcomes before decisions are made.

## Simulation Scenarios
- "What happens if we receive $500,000 in new grants?"
- "What if we lose our largest grant?"
- "What if we open a second location?"
- "What if we hire 5 additional staff?"
- "What if we serve 400 more families?"
- "What if we add a transportation program?"
- "What if we merge with another nonprofit?"

## Simulation Outputs
For each scenario the AI models:
- Financial impact (revenue, expenses, reserves)
- Capacity impact (staff hours, volunteer needs)
- Beneficiary impact (families served, outcomes changed)
- Grant eligibility impact (new funders unlocked, existing funders affected)
- Risk assessment (what could go wrong)
- Timeline to achieve scenario
- Recommended prerequisites

## Methodology
Simulations use the Digital Twin as baseline. Claude runs structured reasoning against the twin data plus market data to generate projections. Not statistical models — AI reasoning over structured org data.

## Schema
```sql
CREATE TABLE impact_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  scenario_type text NOT NULL,
  scenario_params jsonb NOT NULL,
  simulation_result jsonb,
  confidence text,
  generated_at timestamptz DEFAULT now(),
  created_by uuid
);
```

---

# PILLAR 15: Reputation Intelligence

## Definition
Continuous monitoring of every funder, donor, and partner in the subscriber's network. Warn nonprofits before pursuing problematic relationships.

## Monitoring Sources
- Google News API: funder name + scandal/lawsuit/controversy
- IRS: revocation of tax-exempt status, penalties
- SEC EDGAR: securities fraud, enforcement actions
- State AG charity registration: complaints, penalties
- BBB: ratings changes
- Social media: negative sentiment spikes
- Leadership changes: executives with problematic histories
- Litigation: public court records

## Alert Types
- RED: Active legal/regulatory action against funder
- ORANGE: Leadership change (new decision-maker, strategy may shift)
- YELLOW: Negative press coverage (reputational risk)
- BLUE: Financial distress signals (reduced giving, layoffs)
- GREEN: Positive signal (expanded giving, new program launch)

## Schema
```sql
CREATE TABLE reputation_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  entity_type text NOT NULL,
  signal_type text NOT NULL,
  severity text NOT NULL,
  headline text NOT NULL,
  summary text,
  source_url text,
  signal_date date,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE reputation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  signal_id uuid REFERENCES reputation_signals(id),
  status text DEFAULT 'unread',
  created_at timestamptz DEFAULT now()
);
```

---

# PILLAR 16: Executive Command Center

## Definition
A Palantir-style large-format dashboard showing live status of the entire funding operation. Built for the ED/CEO/Development Director to see everything at once.

## Dashboard Panels (configurable layout)
1. Live Grant Pipeline — Kanban view with $ value per stage
2. Corporate Donation Pipeline — prospect funnel with conversion rates
3. Proposal Pipeline — drafts in progress, submitted, under review
4. Donor Heat Map — geographic map with donation density
5. Relationship Graph — mini graph visualization
6. Disaster Alerts — active FEMA declarations in service area
7. AI Recommendations — top 5 actions AI recommends today
8. Financial Forecast — 90-day projected funding vs budget
9. National Funding Activity — live feed of federal grant postings
10. Opportunity Score Board — top 10 opportunities by probability score
11. Deadline Countdown — next 30 days of deadlines
12. Team Activity — recent actions by staff members

## Technical Approach
- Full-screen mode (`/command-center`)
- Real-time updates via Supabase Realtime subscriptions
- Configurable panel layout (drag-and-drop)
- TV/projector mode for board meetings
- Role-gated: owner and admin only

---

# PILLAR 17: Agent Marketplace

## Definition
A configurable roster of specialized AI agents that organizations enable based on their needs. Not every agent runs for every org — they choose which to activate.

## Agent Roster

| Agent ID | Name | Function | Plan Requirement |
|---|---|---|---|
| AG-01 | Grant Research Agent | Finds and scores new opportunities | Starter+ |
| AG-02 | Corporate Giving Agent | Discovers and enriches corporate donors | Professional+ |
| AG-03 | Email Intelligence Agent | Parses grant emails, extracts action items | Professional+ |
| AG-04 | Relationship Agent | Monitors funder signals, recommends actions | Professional+ |
| AG-05 | Proposal Agent | Generates full grant narratives | Starter+ |
| AG-06 | Budget Agent | Builds grant budgets from org financial data | Professional+ |
| AG-07 | Compliance Agent | Monitors regulatory requirements and deadlines | Professional+ |
| AG-08 | Volunteer Coordination Agent | Matches volunteer needs to donor volunteer programs | Enterprise |
| AG-09 | Disaster Response Agent | Monitors FEMA, deploys emergency campaigns | Professional+ |
| AG-10 | Legal Intelligence Agent | Monitors funder legal/regulatory status | Enterprise |
| AG-11 | Marketing Intelligence Agent | Tracks funder marketing and ESG campaigns | Enterprise |
| AG-12 | Board Advisor Agent | Generates board packets and recommendations | Professional+ |
| AG-13 | Impact Measurement Agent | Tracks and reports outcome metrics | Starter+ |
| AG-14 | Forecast Agent | Generates funding forecasts | Professional+ |

## Schema
```sql
CREATE TABLE agent_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  agent_id text NOT NULL,
  enabled boolean DEFAULT false,
  config jsonb DEFAULT '{}',
  last_run_at timestamptz,
  run_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, agent_id)
);
```

## UI: Agent Marketplace Page
- `/settings/agents` — grid of all available agents
- Each card: agent name, description, capabilities, plan badge, Enable/Disable toggle
- Enabled agents show last run time and run count
- Agent log viewer per agent
- Configure button for agents with configurable parameters

---

# PILLAR 18: Funding Knowledge Engine

## Definition
Benavora's defining competitive advantage. A continuously learning AI trained on millions of historical funding relationships that tells nonprofits not just WHERE to apply — but WHAT gets funded, WHY, and HOW to maximize their odds.

## Training Corpus (continuous ingestion)
- IRS Form 990s — all 1.8M annual filers (revenue patterns, giving history)
- Foundation annual reports (giving priorities, decision criteria)
- Corporate giving reports (CSR focus areas, donation patterns)
- Award announcements (successful org characteristics)
- Public grant databases (NIH RePORTER, NSF, USASpending — already being ingested)
- Successful proposal examples (Intelligence Library — already being built)
- Rejection patterns (from outcome tracking across all Benavora orgs)
- ESG reports (corporate giving signals)
- Community impact reports (what outcomes funders value)
- Legislative appropriations (where government money flows)

## Knowledge Products

### 1. Funder Decision Intelligence
For every funder in the system:
- "This foundation funds 73% of applications from orgs under 5 years old"
- "Average grant size increased 23% when applicant included a logic model"
- "This foundation has never funded orgs serving more than 3 counties"
- "Applications submitted in September have 40% higher award rate"

### 2. Narrative Pattern Intelligence
- "Need statements citing CDC statistics have 31% higher success rate with federal funders"
- "Budgets with indirect cost rate above 15% are rejected 67% of the time by this foundation"
- "Applications mentioning 'leveraged funding' receive 2.1x larger awards"
- "Third-party evaluation plans increase success rate by 28%"

### 3. Competitive Intelligence
- "Your org competes with 14 similar orgs for this funder's grants"
- "The funded org in 2023 had 3x your annual budget — consider a smaller ask"
- "This funder has never awarded two grants to same org within 24 months"

### 4. Timing Intelligence
- "Federal housing grants peak in October — start applications in August"
- "This foundation's board meets quarterly — submit before March 1 for April decisions"
- "Post-disaster corporate giving spikes 340% in weeks 2-4 after declaration"

## Implementation Architecture
- All knowledge stored as vector embeddings in pgvector
- Retrieval-augmented generation (RAG) for all proposal and research features
- Embeddings updated nightly as new data is ingested
- Per-org personalization layer (org's own history weights outcomes higher)
- Cross-org anonymized learning (aggregate patterns, never org-identifiable data)

## Competitive Moat
This is not a feature that can be replicated quickly. Every day Benavora operates, the knowledge engine gets smarter. Every grant submitted, every outcome recorded, every funder analyzed adds to the corpus. After 12 months of operation with active users, this becomes an insurmountable competitive advantage — the longer competitors wait to build it, the further behind they fall.

---

# BUILD ROADMAP SUMMARY

## Phase 1 (Next 2 overnight runs)
Priority order based on user impact and foundation dependency:

Night 1: Pillars 5 (Grant Probability), 6 (Digital Twin), 17 (Agent Marketplace)
Night 2: Pillars 2 (Opportunity Discovery), 15 (Reputation Intelligence), 18 (Funding Knowledge Engine foundation)

## Phase 2 (Following week)
Night 3: Pillar 1 (Intelligence Graph — schema + discovery engine)
Night 4: Pillar 4 (Autonomous Relationship Builder)
Night 5: Pillar 11 (Predictive Funding Forecast)

## Phase 3 (Following week)
Night 6: Pillar 10 (Disaster Response Engine)
Night 7: Pillar 9 (Donation Marketplace)
Night 8: Pillar 12 (AI Board Advisor)

## Phase 4 (Following week)
Night 9: Pillar 13 (Community Impact Simulator)
Night 10: Pillar 16 (Executive Command Center)

## Ongoing (Parallel with all phases)
- Pillar 18 data ingestion runs nightly
- Pillar 2 discovery engine runs nightly after Night 1
- Pillar 15 reputation monitoring runs nightly after Night 2

---

# GOVERNANCE REQUIREMENTS

Every session building any pillar above must:
1. Update STATE_OF_THE_BUILD.md with pillar completion percentage
2. Update SESSION_STATE.md with what ran and what's next
3. Update SCHEMA_REGISTRY.md with all new tables
4. Never build a shell — every feature ships with full data layer, API layer, and UI layer
5. All new tables require RLS policies where org-scoped
6. All new API routes require authentication via x-organization-id header
7. All new pages require role gating (minimum: authenticated user)
8. No minimalistic implementations — enterprise quality only
