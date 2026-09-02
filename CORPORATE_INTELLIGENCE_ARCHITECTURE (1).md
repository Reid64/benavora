# BENAVORA --- Corporate Intelligence & Donor Acquisition Engine

## Version: 1.0

## Date: July 17, 2026

## Status: CANONICAL --- Approved by Reid Whitesides. FORGE queues generated from this document.

## Supersedes: DONOR_DISCOVERY_ARCHITECTURE.md §2 (Acquisition Layers) --- this document extends, does not replace.

## 0. Executive Summary

The Corporate Intelligence & Donor Acquisition Engine is a top-level
Benavora platform pillar that transforms the Donor Discovery feature
from a simple company finder into a full-scale AI-powered corporate
intelligence system. It acquires company records from 14+ source types,
enriches each record with 40+ structured fields via specialized AI
agents, scores every company across 10 donation propensity dimensions,
maps corporate relationship networks, and routes enriched prospects
directly into AutoApply or personalized AI-generated email campaigns.

**Scale target:** Tens of millions of company records across all source
types. **Scope:** Benavora platform feature for nonprofit subscribers
only. Not a standalone data product. **Core differentiator:** No other
nonprofit SaaS on the market provides AI-enriched corporate intelligence
at this depth or routes it directly into automated outreach.

## 1. Company Acquisition Layer

### 1A. Source Types (14 categories)

Every source writes to the same normalized `corporate_prospects` table
via a generic adapter interface. New sources are new adapters --- never
new pipelines.

  ----------------------------------------------------------------------------
  Priority          Source Type       Method                 Est. Records
  ----------------- ----------------- ---------------------- -----------------
  1                 Secretary of      State API/scraper per  30M+
                    State business    state                  
                    registrations                            

  2                 Google Business   Places API + Maps API  50M+
                    Profile                                  

  3                 Chamber of        Web scraper per        500K+
                    Commerce          chamber                
                    directories                              

  4                 Industry          Member roster scraper  2M+
                    associations                             

  5                 SBA business      SBA API + SBIR         1M+
                    resources         database               

  6                 Public nonprofit  990 Schedule B data +  500K+
                    donor lists       press releases         

  7                 Vendor            Web scraper            1M+
                    directories                              
                    (ThomasNet,                              
                    Maker's Row)                             

  8                 Manufacturer      Brand website scraper  500K+
                    dealer locators                          

  9                 Construction      API + scraper          2M+
                    suppliers                                
                    (BuildZoom,                              
                    Dodge)                                   

  10                Hospital systems  CMS Provider database  6K systems

  11                Foundations       IRS BMF +              133K
                                      foundation_directory   
                                      (already built)        

  12                Fortune 500 +     SEC EDGAR + Dun &      500K
                    mid-market        Bradstreet public      
                    companies                                

  13                Local businesses  Google Places radius   Unlimited
                                      search (already built) 

  14                SAM.gov federal   SAM.gov API (already   500K+
                    contractors       built)                 
  ----------------------------------------------------------------------------

### 1B. Adapter Interface

Every source adapter implements:

    interface CompanyAcquisitionAdapter {
      source_id: string;
      acquire(params: AcquisitionParams): Promise<RawCompanyRecord[]>;
      normalize(raw: RawCompanyRecord): NormalizedProspect;
      rateLimit: number; // ms between requests
    }

### 1C. corporate_prospects Table Schema

    CREATE TABLE corporate_prospects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Identity
      legal_name text NOT NULL,
      dba_name text,
      ein text,
      duns_number text,
      -- Contact
      website text,
      phone text,
      email text,
      address_street text,
      address_city text,
      address_state text,
      address_zip text,
      address_lat numeric,
      address_lng numeric,
      -- Classification
      naics_code text,
      naics_description text,
      sic_code text,
      industry_category text,
      -- Size indicators
      employee_count_estimate text, -- '1-10','11-50','51-200','201-500','500+'
      revenue_estimate text,        -- '<1M','1M-10M','10M-50M','50M+'
      location_count integer,
      geographic_footprint text[],  -- states of operation
      -- Ownership
      ownership_type text,          -- 'public','private','nonprofit','government'
      is_family_owned boolean,
      is_veteran_owned boolean,
      is_minority_owned boolean,
      is_woman_owned boolean,
      parent_company_id uuid REFERENCES corporate_prospects(id),
      -- Source tracking
      source_adapters text[],
      first_seen_at timestamptz DEFAULT now(),
      last_verified_at timestamptz,
      -- Enrichment (AI-populated)
      enrichment jsonb DEFAULT '{}',
      enrichment_version integer DEFAULT 0,
      enrichment_started_at timestamptz,
      enrichment_completed_at timestamptz,
      -- Scoring
      scores jsonb DEFAULT '{}',
      scores_computed_at timestamptz,
      giving_dna jsonb DEFAULT '{}',
      -- Dedup
      UNIQUE(legal_name, address_city, address_state)
    );

    CREATE INDEX idx_corporate_prospects_naics ON corporate_prospects(naics_code);
    CREATE INDEX idx_corporate_prospects_state ON corporate_prospects(address_state);
    CREATE INDEX idx_corporate_prospects_scores ON corporate_prospects USING gin(scores);
    CREATE INDEX idx_corporate_prospects_enrichment ON corporate_prospects USING gin(enrichment);

## 2. AI Enrichment Engine

### 2A. Enrichment Fields (40+ per company)

All fields stored in `enrichment` jsonb column:

**Contact & People:** - decision_maker_names: string\[\] -
decision_maker_titles: string\[\] - verified_emails: string\[\] -
linkedin_profiles: string\[\] - executive_bios: object\[\] -
board_members: string\[\]

**Business Intelligence:** - founding_year: number -
marketing_budget_estimate: string - fleet_vehicles: boolean -
equipment_inventory_public: boolean - excess_inventory_likelihood:
string - construction_specialties: string\[\] -
disaster_response_capability: boolean - product_categories: string\[\] -
available_services: string\[\]

**Giving History:** - donation_history: object\[\] (year, type,
recipient, amount if known) - foundation_affiliation: string -
foundation_ein: string - sponsorship_activity: object\[\] -
grant_activity: object\[\] - known_donation_types: string\[\]

**ESG & Community:** - esg_initiatives: string\[\] -
community_involvement: string\[\] - religious_affiliation: string \|
null (public statements only) - habitat_for_humanity_partner: boolean -
united_way_partner: boolean - local_causes_supported: string\[\]

**Digital Presence:** - social_media_urls: object - press_release_urls:
string\[\] - csr_page_url: string - giving_portal_url: string -
has_giving_program: boolean - has_donation_form: boolean -
careers_page_url: string

### 2B. Enrichment Agent Architecture

Ten specialized AI agents run sequentially per company. Each agent reads
the company record, performs one focused analysis, and writes structured
output back to `enrichment` jsonb.

  ------------------------------------------------------------------------------------
  Agent ID          Name              Input                Output Fields
  ----------------- ----------------- -------------------- ---------------------------
  EA-01             Corporate Giving  Website homepage +   has_giving_program,
                    Detector          /giving /community   giving_portal_url,
                                      /csr pages           known_donation_types

  EA-02             Community         About page + press   community_involvement,
                    Outreach Detector releases             local_causes_supported,
                                                           habitat_partner,
                                                           united_way_partner

  EA-03             Sponsorship       Website + Google     sponsorship_activity,
                    Detector          search "{company}    marketing_budget_estimate
                                      sponsor"             

  EA-04             Foundation        IRS BMF              foundation_affiliation,
                    Detector          cross-reference +    foundation_ein
                                      website              

  EA-05             Career Page       /careers /jobs page  employee_count_estimate,
                    Analyzer                               company_culture_signals

  EA-06             Press Release     PR page + news       donation_history,
                    Analyzer          search               recent_gifts,
                                                           executive_changes

  EA-07             ESG Analyzer      ESG/sustainability   esg_initiatives,
                                      page                 environmental_commitments

  EA-08             Executive         Leadership page      decision_maker_names,
                    Biography                              decision_maker_titles,
                    Analyzer                               board_members,
                                                           linkedin_profiles

  EA-09             Contact Extractor Contact page +       verified_emails, phone,
                                      footer               address confirmation

  EA-10             Social Media      LinkedIn + Facebook  community_involvement,
                    Analyzer          public pages         recent_donations,
                                                           employee_count_estimate
  ------------------------------------------------------------------------------------

### 2C. Enrichment Pipeline

    corporate_prospects (unenriched)
      → Enrichment Queue (Railway worker)
      → EA-01 through EA-10 run sequentially per company
      → Results merged into enrichment jsonb
      → enrichment_completed_at set
      → Score Engine triggered automatically

Rate limiting: 1 company per 3 seconds to avoid IP blocks. Batch size:
500 companies per Railway worker run. Estimated throughput: \~10,000
companies per 8-hour overnight run.

## 3. Propensity Scoring Engine

### 3A. Ten Donation Probability Scores (0-100 each)

All stored in `scores` jsonb column:

  -----------------------------------------------------------------------
  Score ID                Name                    Key Signals
  ----------------------- ----------------------- -----------------------
  PS-01                   Overall Donation        Weighted aggregate of
                          Likelihood              all other scores

  PS-02                   Cash Donation           Foundation affiliation,
                          Probability             giving portal, donation
                                                  history, revenue
                                                  estimate

  PS-03                   In-Kind Donation        Product categories,
                          Probability             excess inventory
                                                  likelihood, donation
                                                  history type

  PS-04                   Volunteer Probability   Employee count, CSR
                                                  initiatives, community
                                                  involvement

  PS-05                   Equipment Donation      Equipment inventory,
                          Probability             fleet vehicles,
                                                  construction
                                                  specialties

  PS-06                   Housing Compatibility   Construction NAICS
                                                  codes, habitat partner,
                                                  building materials

  PS-07                   Education Compatibility Scholarship history,
                                                  school partnerships,
                                                  education ESG

  PS-08                   Food Compatibility      Food industry NAICS,
                                                  food bank partnerships,
                                                  product categories

  PS-09                   Veteran Compatibility   Veteran-owned flag,
                                                  military partnerships,
                                                  veteran causes

  PS-10                   Disaster Relief         Disaster response
                          Compatibility           capability, emergency
                                                  response history,
                                                  logistics capability
  -----------------------------------------------------------------------

### 3B. Scoring Algorithm

Each score computed by a Claude call with: - Company enrichment record -
Score-specific rubric (defined per PS-XX) - Output: {score: 0-100,
rationale: string, top_factors: string\[\]}

PS-01 (Overall) = weighted average: PS-02×0.3 + PS-03×0.2 + PS-04×0.1 +
PS-05×0.1 + max(PS-06,PS-07,PS-08,PS-09,PS-10)×0.3

### 3C. Auto-Ranking

After scoring, companies are ranked within each subscriber's prospect
list by PS-01 descending. Top 100 are flagged as `priority_prospects`.
Rankings refresh after every enrichment cycle.

## 4. Corporate Giving DNA

### 4A. Giving Style Profile

Every company gets a Giving DNA profile identifying HOW they prefer to
contribute --- not just whether they donate.

    interface GivingDNA {
      primary_style: GivingStyle;
      secondary_styles: GivingStyle[];
      confidence: 'high' | 'medium' | 'low';
      evidence: string[];
      best_ask_type: string;
      best_ask_timing: string;
      preferred_cause_alignment: string[];
    }

    type GivingStyle =
      | 'writes_checks'
      | 'donates_inventory'
      | 'provides_skilled_labor'
      | 'lends_equipment'
      | 'sponsors_events'
      | 'matches_employee_donations'
      | 'funds_scholarships'
      | 'provides_volunteers'
      | 'donates_transportation'
      | 'supports_emergency_response';

### 4B. DNA Matching

When a nonprofit runs a donor search, the engine matches their NEEDS
against company GIVING DNA: - Nonprofit needs: roofing materials → match
companies with giving_style='donates_inventory' + construction NAICS -
Nonprofit needs: volunteers for event → match companies with
giving_style='provides_volunteers' + high PS-04 - Nonprofit needs: cash
grant → match companies with giving_style='writes_checks' + high PS-02

This produces dramatically better match quality than keyword search
alone.

## 5. Relationship Mapping Engine

### 5A. Corporate Relationship Schema

    CREATE TABLE corporate_relationships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_company_id uuid REFERENCES corporate_prospects(id),
      target_company_id uuid REFERENCES corporate_prospects(id),
      relationship_type text NOT NULL,
      -- Types: parent_company, subsidiary, supplier, customer,
      --        board_overlap, foundation_affiliate, partner, competitor
      confidence numeric DEFAULT 0.5,
      evidence text,
      discovered_at timestamptz DEFAULT now()
    );

    CREATE TABLE corporate_relationship_people (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid REFERENCES corporate_prospects(id),
      person_name text NOT NULL,
      person_title text,
      board_memberships text[],
      foundation_roles text[],
      linkedin_url text,
      discovered_at timestamptz DEFAULT now()
    );

### 5B. Relationship Discovery

Agent RA-01 (Relationship Mapper) runs after enrichment: 1.
Cross-references decision_maker_names against other companies'
board_members 2. Matches foundation_ein against IRS BMF to find
corporate foundations 3. Identifies parent_company from Secretary of
State filings 4. Maps supplier relationships from press releases and
vendor pages

Example output:

    ABC Roofing
      → parent: XYZ Holdings (ownership)
      → foundation: XYZ Community Foundation (EIN 12-3456789)
      → board overlap: John Smith also on Regional Hospital board
      → known supplier: ABC Building Supply (supplier relationship)
      → ABC Building Supply has_giving_program: true

One lead surfaces 4 additional opportunities automatically.

## 6. AI Classification Agent Specifications

All agents use claude-sonnet-4-6. All run via Railway worker. All write
to enrichment jsonb.

  ------------------------------------------------------------------------
  Agent             Trigger            Claude Prompt     Rate
                                       Strategy          
  ----------------- ------------------ ----------------- -----------------
  EA-01 Corporate   Post-acquisition   Fetch /giving     1 req/3s
  Giving Detector                      /csr /community   
                                       pages. Extract    
                                       structured giving 
                                       program data.     

  EA-02 Community   Post-acquisition   Fetch about       1 req/3s
  Outreach                             page + search     
                                       news. Identify    
                                       community         
                                       programs.         

  EA-03 Sponsorship Post-EA-01         Search "{company} 1 req/5s
  Detector                             sponsor" + parse  
                                       website sponsor   
                                       pages.            

  EA-04 Foundation  Post-acquisition   Cross-ref IRS BMF 1 req/1s
  Detector                             by company name + 
                                       EIN fuzzy match.  

  EA-05 Career Page Post-acquisition   Fetch /careers.   1 req/3s
                                       Extract headcount 
                                       signals and       
                                       culture.          

  EA-06 Press       Post-EA-02         Fetch /news       1 req/3s
  Release                              /press. Extract   
                                       donation          
                                       announcements.    

  EA-07 ESG         Post-EA-02         Fetch             1 req/3s
  Analyzer                             /sustainability   
                                       /esg. Extract     
                                       commitments.      

  EA-08 Executive   Post-acquisition   Fetch /leadership 1 req/3s
  Bio                                  /about/team.      
                                       Extract names,    
                                       titles, LinkedIn. 

  EA-09 Contact     Post-acquisition   Fetch /contact    1 req/2s
  Extractor                            footer. Extract   
                                       verified emails,  
                                       phone.            

  EA-10 Social      Post-EA-08         Fetch LinkedIn    1 req/5s
  Media                                company page +    
                                       Facebook public   
                                       page.             

  RA-01             Post all EA agents Cross-reference   1 req/10s
  Relationship                         all enrichment    
  Mapper                               data for          
                                       relationships.    
  ------------------------------------------------------------------------

## 7. Automated Personalized Outreach

### 7A. Filter Engine

Subscribers filter corporate_prospects by any combination of: -
Geographic: within X miles of org address - Industry: NAICS code,
industry_category - Size: employee_count_estimate, revenue_estimate -
Giving: known_donation_types, has_giving_program,
giving_dna.primary_style - Compatibility: any PS-XX score above
threshold - Recency: donation_history within N years - Ownership:
is_family_owned, is_veteran_owned, etc.

Results ranked by PS-01 descending.

### 7B. AI-Generated Individualized Outreach

For each filtered prospect, Claude generates a personalized email:

**Input to Claude:** - Nonprofit mission, programs, impact data (from
Knowledge Base) - Company enrichment record (full) - Company giving DNA
profile - Any known donation history - Nonprofit's current needs (from
search filter criteria)

**Output:** Personalized email subject + body referencing specific known
facts about the company. No templates. Every email unique.

**Example:** \> "We noticed XYZ Roofing donated materials after
Hurricane Beryl in 2024. Our affordable housing initiative in Central
Texas serves families who lost homes in that same storm. We'd welcome a
conversation about whether surplus materials from future projects could
support our rebuilding mission."

### 7C. Campaign Routing

-   Company has giving_portal_url → route to AutoApply queue
-   Company has verified_email → route to Resend email campaign
-   Company has no digital contact → route to physical mail merge
    (address on file)

## 8. Continuous Monitoring

### 8A. Re-enrichment Schedule

  -----------------------------------------------------------------------
  Company Tier            Criteria                Re-enrichment Frequency
  ----------------------- ----------------------- -----------------------
  Priority                PS-01 \> 70             Monthly

  Active                  PS-01 40-70             Quarterly

  Standard                PS-01 \< 40             Annually

  Inactive                No website, no contact  Every 2 years
  -----------------------------------------------------------------------

### 8B. Change Detection Signals

Agent CM-01 (Change Monitor) watches for: - New executives (LinkedIn +
press releases) - Acquisitions (SEC EDGAR + news) - New office openings
(Google Places + press) - Community event sponsorships (Facebook
Events + Eventbrite) - New products (website diff) - Donation
announcements (news search) - Foundation launches (IRS BMF new
filings) - Financial growth signals (news + job postings) - Leadership
changes (LinkedIn + press)

On change detection: re-run relevant enrichment agents, update scores,
flag record as `recently_updated` for subscriber notification.

## 9. Database Migration Plan

  -------------------------------------------------------------------------------
  Migration               Table                           Notes
  ----------------------- ------------------------------- -----------------------
  091                     corporate_prospects             Core table, all fields

  092                     corporate_relationships         Relationship mapping

  093                     corporate_relationship_people   People cross-reference

  094                     corporate_enrichment_queue      Job queue for
                                                          enrichment agents

  095                     corporate_outreach_campaigns    Campaign tracking

  096                     corporate_monitoring_events     Change detection log
  -------------------------------------------------------------------------------

## 10. Build Phases

### Phase 1 --- Foundation (Next overnight run)

-   Migration 091-093
-   corporate_prospects table + indexes
-   Google Places adapter (already partially built in donor_discovery)
-   Secretary of State adapter (TX first)
-   SAM.gov adapter (already built --- wire to new table)
-   Enrichment queue worker setup

### Phase 2 --- Enrichment Engine (Following night)

-   EA-01 through EA-05 (first 5 agents)
-   Scoring engine PS-01 through PS-05
-   Giving DNA classifier
-   Basic filter UI

### Phase 3 --- Full Agent Roster (Third night)

-   EA-06 through EA-10
-   RA-01 Relationship Mapper
-   Scores PS-06 through PS-10
-   Relationship visualization UI

### Phase 4 --- Outreach Integration (Fourth night)

-   Filter engine full UI
-   AI personalized email generator
-   AutoApply routing
-   Resend campaign routing

### Phase 5 --- Continuous Monitoring (Fifth night)

-   CM-01 Change Monitor
-   Re-enrichment scheduler
-   Change notification system
-   Monitoring dashboard

## 11. UI Structure

### Nav placement

Donor Discovery → Corporate Intelligence (sub-nav)

### Pages

-   `/donor-discovery/corporate` --- Main search + filter interface
-   `/donor-discovery/corporate/[id]` --- Full company profile (all
    enrichment fields, all scores, DNA profile, relationships)
-   `/donor-discovery/corporate/campaigns` --- Outreach campaign
    management
-   `/donor-discovery/corporate/monitoring` --- Change detection feed
-   `/donor-discovery/corporate/relationships` --- Relationship map
    visualization

## 12. Canonical Rules

1.  Every company record routes through the same pipeline --- no
    per-category custom code
2.  All enrichment writes to `enrichment` jsonb --- never new columns
    per agent
3.  All scores write to `scores` jsonb --- never new columns per score
4.  No enrichment agent blocks the acquisition pipeline --- they run
    async via queue
5.  Rate limits are mandatory --- never bypass them regardless of queue
    depth
6.  Subscriber data is always org-scoped --- corporate_prospects is
    shared, but campaign/outreach records are org-scoped
7.  Giving DNA is computed after all 10 enrichment agents complete ---
    never partial
8.  Re-enrichment never overwrites manually verified fields
