__BENAVORA__

Project Blueprint v2\.0

Complete Platform Architecture

Phases 1\-6: MVP through Full Autonomous Operation

Version 2\.0 | June 13, 2026

# __1\. Product Overview__

Benavora is a fully autonomous nonprofit funding automation platform\. It discovers funding opportunities from verified government databases, foundation 990 filings, corporate giving programs, and client\-configured data sources\. It evaluates eligibility using AI and historical giving data\. It drafts customized applications using verified organizational data and proven winning narratives\. It fills out grant portal forms via browser automation with CAPTCHA solving\. It submits applications, tracks outcomes, learns from results, and continuously improves\.

The platform operates as a continuous autonomous engine\. Once configured with search profiles and organizational data, it runs 24/7: discovering opportunities, scoring eligibility, drafting applications, queuing submissions, executing browser automation, capturing confirmations, scheduling follow\-ups, and flagging items that require human attention\. The human operator reviews, approves edge cases, and records outcomes\. Everything else is automated\.

__Primary Use Case \(In\-House\)__

Operated by Reid's Faith Foundation \(501\(c\)\(3\)\) to automate the discovery, application, and tracking of grants and corporate donations for emergency/transitional housing initiatives in rural Texas\.

__Secondary Use Case \(Licensable SaaS\)__

Multi\-tenant platform sold to nonprofits, churches, and charitable organizations\. Each tenant operates in complete data isolation with their own knowledge base, documents, funders, integrations, and application history\. Tiered pricing controls feature access\. Consultant tier includes white\-label client portal\.

# __2\. Tech Stack__

__Layer__

__Technology__

Framework

Next\.js 14, App Router

Language

TypeScript strict mode

Database

Supabase \(PostgreSQL \+ Auth \+ RLS \+ Realtime \+ Storage\)

Hosting

Vercel \(app\) \+ dedicated VPS \(automation worker\)

Package Manager

pnpm

AI Engine

Anthropic Claude API \(claude\-sonnet\-4\-6\)

Browser Automation

Playwright \(headless Chromium\)

CAPTCHA Solving

2Captcha API \(@2captcha/captcha\-solver\)

Email Integration

Gmail API \(OAuth per client\)

Calendar

Google Calendar API \(OAuth per client\)

Payments

Stripe \(subscriptions \+ metering\)

Email Sending

Resend API \(cold outreach campaigns\)

Federal Grants

Grants\.gov API \+ SAM\.gov API \+ Simpler\.Grants\.gov API

Foundation Data

ProPublica Nonprofit Explorer API \(free, no auth\)

Premium Data

Candid/GuideStar API \(client self\-connect\)

File Storage

Supabase Storage \(buckets per organization\)

Testing

Playwright

Version Control

Git \-> GitHub

# __3\. Verified Data Source Integrations__

Every integration below has been verified against live API documentation as of June 2026\. No endpoints are assumed or fabricated\.

## __3\.1 Grants\.gov API \(Federal Grants\) \- FREE__

Endpoint: POST https://api\.grants\.gov/v1/api/search2

Authentication: None required for public search endpoints\.

Rate Limits: No published limit on public search\.

Data: All federal grant opportunities from 1,000\+ agencies\. Over $700 billion in annual federal funding\. Fields: title, agency, posted date, close date, funding amount, eligibility, CFDA/ALN number, status\.

Search Parameters: keyword, fundingCategories, agencies, oppStatuses, aln, sortBy, rows, startRecord\.

Integration: Scheduled daily poll using client search profile keywords\. Results parsed into opportunity records\. Deduplication against existing opportunities by opportunity ID\. Auto\-triggers eligibility scoring on new discoveries\.

## __3\.2 SAM\.gov API \(Federal Contracts \+ Entity Registration\) \- FREE__

Endpoint: GET https://api\.sam\.gov/prod/opportunities/v2/search

Authentication: API key required \(free, registration takes up to 10 business days at sam\.gov\)\.

Rate Limits: 1,000 requests per day\.

Data: Federal contract opportunities, entity registration data, Federal Assistance Listings \(released February 2026\)\. Search by title, type, NAICS code, posted date range, status\.

Integration: Weekly poll for grant\-type opportunities matching search profile keywords\. Client registers for their own SAM\.gov API key during onboarding\. Key stored encrypted in integration\_keys table\.

## __3\.3 Simpler\.Grants\.gov API \(Modernized Federal Grants\) \- FREE__

Endpoint: POST https://api\.simpler\.grants\.gov/v1/opportunities/search

Authentication: API key required \(free, via X\-API\-Key header\)\.

Data: Same federal grants as Grants\.gov with modernized search and structured JSON\. Supports filtering by applicant\_type, funding\_instrument, agency, opportunity\_status, close\_date ranges\.

Integration: Secondary federal source\. Runs in parallel with Grants\.gov, deduplicates by opportunity ID\.

## __3\.4 ProPublica Nonprofit Explorer API \(IRS 990 Data Mining\) \- FREE__

Endpoint: GET https://projects\.propublica\.org/nonprofits/api/v2/search\.json

Authentication: None required\. No API key needed\.

Data: 1\.8 million nonprofit tax filings\. Revenue, expenses, net assets, officer compensation, mission statements, NTEE codes, filing PDFs\. 990\-PF filings include Schedule I: complete list of every grant a foundation awarded including recipient, amount, and purpose\.

Search Parameters: q \(search term\), state, ntee \(category code\), c\_code \(501c subsection\)\.

Integration: Foundation database builder\. Query by geographic area and NTEE category\. Populate funder database with: org name, EIN, revenue, assets, total grants awarded, contact info, 990 PDF links\. 990\-PF mining extracts giving history to build foundation giving profiles: what they fund, average grant size, geographic preferences, funding patterns\. This data feeds eligibility scoring\.

## __3\.5 Candid/GuideStar API \(Premium \- Client Self\-Connect\)__

Endpoint: https://developer\.candid\.org/ \(multiple endpoints\)

Authentication: API key required \(paid subscription by client\)\.

Data: 1\.9 million organizations, 3 million annual grant transactions, $180 billion in annual grant dollars\. Comprehensive profiles, financials, people, IRS compliance\.

Pricing: Candid Premium starts at $1,199/year\. Small nonprofits under $1M revenue can get free access via Gold Seal of Transparency\.

Integration: Client provides their own API key in Settings > Integrations\. Premium/Enterprise/Consultant tier feature only\.

## __3\.6 State Grant Portals \(Scrapable\)__

Approximately 25 states have centralized grant portals \(California grants\.ca\.gov, Texas, New York, Florida, Illinois, etc\.\)\. These are scrapable on schedule using the research agent framework\. A state\_portals configuration table maps state codes to portal URLs and scraping strategies\. Clients select target states in search profiles\. States without portals are searched via web search agents\.

## __3\.7 Custom API Connector \(Client\-Configured\)__

Clients can connect any REST API that returns JSON\. Settings UI provides: base URL entry, authentication configuration \(API key header, Bearer token, OAuth, or none\), test call with raw JSON preview, visual field mapper to drag API response fields to Benavora fields \(name \-> funder\.name, amount \-> opportunity\.amount\_available, etc\.\), polling schedule \(hourly, daily, weekly\), named integration save\. This enables connection to GrantWatch, Foundation Directory Online, state\-specific databases, internal CRM exports, or any JSON\-returning API without custom development\.

## __3\.8 Custom Scraping Targets \(Client\-Configured\)__

Clients can assign any URL for the research agent to scrape on schedule\. Enter a URL, tell the system what to look for \(grant opportunities, donation programs, RFPs\), and the AI analyzes the page structure and extracts structured data\. Results flow into the opportunity pipeline\. Each target has its own scrape schedule and failure alerting\. If a page structure changes, the system flags it for reconfiguration rather than producing garbage data\.

## __3\.9 CSV Import Wizard__

Bulk import of funder/prospect databases via CSV upload\. Mapping wizard with: template CSV download, column\-to\-field mapping UI, preview of mapped data before import, duplicate detection against existing funders, import progress with error reporting\. Fields supported: company name, contact name, email, phone, website, giving portal URL, category, geographic focus, annual giving budget, notes\.

# __4\. Autonomous Funding Pipeline__

The core differentiator\. Once configured, the pipeline runs continuously without human intervention except for edge\-case approvals and outcome recording\.

## __4\.1 Pipeline Chain \(Fully Automated\)__

Step 1 \- DISCOVER: Research agents poll data sources \(Grants\.gov, SAM\.gov, ProPublica, state portals, custom sources\) on schedule\. New opportunities created automatically with source attribution\.

Step 2 \- EVALUATE: Eligibility scoring agent runs on every new opportunity\. Uses org profile, giving history from 990 data, and historical success patterns\. Produces 0\-100 score with recommendation\.

Step 3 \- PRIORITIZE: Grant Success Probability Score combines eligibility score, funder giving history, org track record with that funder category, deadline proximity, competition density\. High\-probability applications get processed first\.

Step 4 \- DRAFT: AI generates application narrative using Knowledge Base, proven narratives, success patterns, and funder intelligence\. Confidence score calculated\.

Step 5 \- ASSEMBLE: Document assembly engine matches required documents to uploaded files\. Creates submission package with checklist\.

Step 6 \- COMPLIANCE: Pre\-submission compliance check verifies all requirements met, no missing sections, budget totals match, org profile complete\.

Step 7 \- QUEUE: Application enters automation queue with priority based on success probability and deadline urgency\.

Step 8 \- SUBMIT: Browser automation fills portal forms, solves CAPTCHAs via 2Captcha, uploads documents, captures confirmation\. Runs in configured automation level \(supervised/semi\-autonomous/autonomous\)\.

Step 9 \- FOLLOW UP: Auto\-generated follow\-up sequence: check\-in email 2 weeks after deadline, thank\-you on award, feedback request on denial, renewal prep 90 days before next cycle\.

Step 10 \- LEARN: Outcome recorded\. Recursive learning agent analyzes winning vs losing drafts\. Success patterns extracted\. Proven narratives updated\. Effectiveness scores recalculated\. Next cycle starts smarter\.

## __4\.2 Continuous Operation Worker__

A background worker process runs independently of the web app\. It wakes on a configurable interval \(default: every 5 minutes\), checks the automation\_queue for pending items, processes the next item, logs results, and sleeps\. It respects rate limits, max concurrent sessions, and daily submission caps per tier\. If the worker crashes, it restarts automatically and resumes from the last incomplete queue item\. All state is in the database, not in memory\.

## __4\.3 Smart Scheduling Engine__

The system learns optimal submission timing\. Corporate portals have less traffic early morning\. Government deadline crushes happen at 4:59 PM on the due date\. The scheduler staggers submissions: early for competitive grants, during low\-traffic hours for portal reliability, spread across the day to avoid rate limiting\. Configurable per funder based on historical portal response times\.

# __5\. Browser Automation System__

## __5\.1 Automation Levels__

Supervised \(Starter tier\): Current behavior\. Fills form, pauses for human approval before submit\. Every session requires explicit approve/reject\.

Semi\-Autonomous \(Professional tier\): Fills form, auto\-submits if AI confidence on field mapping is above 90% for all fields AND no unsolvable challenges detected\. Pauses only on low\-confidence mappings\. Sends notification on completion\.

Autonomous \(Enterprise/Consultant tier\): Fills and submits without pausing\. Captures confirmation screenshots\. Sends completion notification\. Requires explicit opt\-in checkbox: 'I understand this submits applications without my review\.'

## __5\.2 Batch Processing Queue__

Users select multiple applications from pipeline board or filter by criteria \(funder category, deadline range, amount range, success probability\) and click 'Queue for Automation'\. Each application becomes a queue entry with priority\.

Queue fields: id, organization\_id, application\_id, priority \(1\-5, calculated from success probability\), status \(queued, processing, paused, completed, failed\), automation\_level, created\_at, started\_at, completed\_at, error\_log jsonb, retry\_count\.

Background worker processes queue sequentially\. Configurable delay between sessions \(default 30 seconds\)\. Max concurrent sessions: 1 \(Starter/Professional\), up to 3 \(Enterprise/Consultant\)\.

## __5\.3 CAPTCHA Solving__

Service: 2Captcha \(https://2captcha\.com\)

NPM Package: @2captcha/captcha\-solver

Pricing: $0\.59\-$2\.99 per 1,000 solves\. Standard image: $0\.59/1000\. reCAPTCHA v2: $2\.99/1000\. hCaptcha: $2\.99/1000\.

Integration: Client provides 2Captcha API key in Settings > Integrations\. When challenge detector identifies CAPTCHA, sends to 2Captcha\. Typical solve: 10\-20 seconds\. 3 attempts, then fallback to pause\-for\-human\. If no key configured, reverts to manual pause \(current behavior\)\. Progressive enhancement\.

## __5\.4 Automation Monitor Dashboard__

Real\-time and historical session status\. Categories: Success \(green\), Paused \- Needs Attention \(yellow\), Failed \- Requires Retry \(red\), Failed \- Portal Changed \(orange\)\.

Each failed session stores: last screenshot before failure, step number, error classification \(captcha\_unsolvable, account\_required, form\_changed, timeout, portal\_down, field\_mapping\_failed, unknown\), suggested remediation\.

Retry: individual or batch 'Retry All Failed' for last 24 hours\.

Notifications: email alert on failure/pause\. Configurable: per\-event, hourly digest, daily summary\.

# __6\. Intelligence Features__

## __6\.1 Grant Success Probability Score__

Combines: eligibility score \(0\-100\), funder giving history match \(from 990 data\), org track record with funder category, deadline proximity weight, competition density estimate, narrative quality score from proven patterns\. Single percentage output: 'This application has a 73% chance of being funded\.' Drives batch queue priority\.

## __6\.2 Funder Relationship Scoring__

Dynamic score tracking relationship trajectory: cold outreach sent \(5\), they responded \(15\), first application submitted \(25\), denied but feedback received \(20\), second application submitted \(30\), awarded \(50\), renewal submitted \(55\), multi\-year funder \(70\+\)\. Surfaces funders with momentum\. Flags funders wasting effort after 3\+ denials\.

## __6\.3 Deadline Intelligence__

Pattern detection from historical data\. If Foundation X posts annually in March with June deadline, system creates projected opportunity 60 days before expected posting\. Preparation can begin before announcement\. Uses 990\-PF filing dates and historical opportunity patterns\.

## __6\.4 Competitor Intelligence__

Using 990 data in reverse\. If Foundation X awarded $50K to Organization Y for housing in Texas last year, Y is a competitor\. Track which organizations get funded by target funders\. Analyze what they do differently\. Surface differentiation opportunities\. Dashboard showing competitor funding patterns\.

## __6\.5 Application Cloning and Adaptation__

When a grant is won from Funder A, and Funder B has similar priorities, system auto\-suggests cloning\. Pre\-populates new application with winning structure, budget framework, and narrative\. AI adjusts for new funder's specific requirements, amount range, and stated priorities\.

## __6\.6 AI\-Powered Funder Matching \(Semantic Search\)__

Instead of keyword search, client describes mission in plain language\. AI matches against entire funder database using semantic similarity\. 'We help formerly incarcerated mothers find stable housing in rural Texas' matches funders who fund reentry, housing, women's services, rural development, family support \- even if those exact keywords are absent from funder profiles\.

# __7\. Post\-Submission Automation__

## __7\.1 Auto\-Generated Follow\-Up Sequences__

After submission, system auto\-schedules: check\-in email 2 weeks after deadline, thank\-you note on award, feedback request on denial, renewal preparation 90 days before next cycle\. All templated with AI personalization using funder intelligence data\. Queued in outreach system\.

## __7\.2 Financial Reconciliation__

Track the money end\-to\-end\. Requested vs awarded vs received vs spent\. Budget burn rate per grant\. Reporting deadline compliance tracker\. Grant\-specific expense categorization\. Closes the loop from discovery to expenditure reporting\.

## __7\.3 Compliance Calendar__

Beyond deadlines\. Track grant reporting requirements, spending restrictions, matching fund obligations, regulatory filings \(990\-N, state charity registrations\)\. Auto\-populate from grant award terms\. Alert on approaching obligations\. Dashboard showing compliance status across all active grants\.

## __7\.4 Renewal Tracking__

Recurring grants auto\-create renewal records on award\. Track reporting deadlines, renewal windows, compliance status\. Auto\-generate renewal narratives pre\-loaded with original winning narrative and updated metrics\. Alert 60/30/14 days before reporting deadline\.

# __8\. Multi\-Channel Outreach__

Cold outreach is not email\-only\. The system generates content for each channel and tracks which gets responses from which funder type\.

- Email sequences via Resend API \(current implementation\)
- LinkedIn connection request templates with personalized messages
- Phone call scripts generated from funder intelligence data
- Physical mail templates for old\-school funders who respond to letters
- Follow\-up task assignment with deadline tracking

Each channel tracks: sent, response received, response type, conversion to funder\. Analytics show channel effectiveness by funder category\.

# __9\. Email Intelligence \(Gmail Integration\)__

Each client authorizes their Gmail account via OAuth during onboarding\. Benavora never stores passwords \- only OAuth tokens revocable by the client\.

## __9\.1 Inbox Monitoring__

Gmail API webhook triggers on new email\. Email parser agent classifies: acknowledgment, information request, award notification, rejection, follow\-up, general\. Extracts funder name, opportunity reference, action required, urgency, sentiment\.

## __9\.2 Auto\-Matching__

Matches sender email against funders table and outreach\_contacts\. If matched, creates note on funder with email summary\. If award notification or rejection detected, flags for outcome recording with pre\-populated data\.

## __9\.3 Thread Tracking__

Links email threads to application records\. Full conversation history visible on application detail page\. No more searching through inbox to find correspondence about a specific grant\.

## __9\.4 Calendar Sync__

Deadlines sync bidirectionally with Google Calendar\. Changes in either system reflect in the other\. Meeting invitations from funders auto\-create calendar events and link to the funder record\.

# __10\. SaaS Tier Model__

__Feature__

__Starter $149/mo__

__Professional $299/mo__

__Enterprise $499/mo__

__Consultant $799/mo__

Grants\.gov \+ SAM\.gov

Yes

Yes

Yes

Yes

ProPublica 990 Mining

Yes

Yes

Yes

Yes

State Portal Scraping

1 state

5 states

All states

All states

Custom API Connector

0 slots

2 slots

5 slots

Unlimited

Custom Scraping Targets

0

5

25

Unlimited

Candid/GuideStar API

No

Self\-connect

Self\-connect

Included

Browser Automation

Supervised

Semi\-auto

Autonomous

Autonomous

Batch Queue Size

5

25

100

Unlimited

CAPTCHA Solving

No

Self\-connect

Self\-connect

Included

CSV Import

Yes

Yes

Yes

Yes

Gmail/Calendar

No

Yes

Yes

Yes

Daily Auto\-Submissions

5

25

100

Unlimited

AI Drafts/month

10

50

200

Unlimited

Users

1

5

20

50

Success Probability

Basic

Full

Full

Full

Competitor Intel

No

No

Yes

Yes

Financial Reconciliation

No

Yes

Yes

Yes

White\-Label Portal

No

No

No

Yes

Multi\-Channel Outreach

Email only

Email \+ LinkedIn

All channels

All channels

# __11\. Integration Settings__

Settings > Integrations page with cards for each connectable service\. Each card shows: service name, connection status, last sync timestamp, Configure button\.

__Self\-Connect Services:__

- SAM\.gov API Key \- Free, client registers at sam\.gov
- 2Captcha API Key \- Client creates account, adds funds, provides key
- Candid/GuideStar API Key \- Client subscribes, provides enterprise key
- Google OAuth \(Gmail \+ Calendar\) \- OAuth flow, per\-client authorization
- Resend API Key \- For cold outreach email sending
- Custom API Connections \- Client configures URL, auth, field mapping
- Custom Scraping Targets \- Client adds URLs for scheduled scraping

Platform\-managed \(admin only\): Stripe billing configuration, Grants\.gov polling, ProPublica integration \(no key needed\)\.

# __12\. White\-Label Client Portal \(Consultant Tier\)__

For the Consultant tier at $799/month\. The consultant's clients log into a branded version of Benavora with the consultant's logo, colors, and domain\. The consultant sees all their clients' pipelines in a master dashboard\. Features:

- Custom logo and color scheme per consultant
- Custom domain support \(CNAME mapping\)
- Master dashboard: all clients' pipeline status, deadlines, awards at a glance
- Client switching: one\-click to view any client's full dashboard
- Aggregate analytics: total awards across all clients, success rates, revenue generated
- Client onboarding workflow: consultant invites client, client completes onboarding, consultant reviews and activates

This is the revenue justification for $799/month \- they are running a funding consultancy business powered by Benavora\.

# __13\. New Database Tables \(Tier 6\)__

These tables extend the existing 43\-table schema\. All include organization\_id for RLS tenant isolation\.

__automation\_queue__

Batch processing queue\. Fields: id, organization\_id, application\_id, priority, status \(queued/processing/paused/completed/failed\), automation\_level, retry\_count, max\_retries, error\_log jsonb, created\_at, started\_at, completed\_at\.

__state\_portals__

State grant portal configuration\. Fields: id, state\_code, state\_name, portal\_url, scraping\_strategy jsonb, is\_active, last\_scraped\_at, last\_success\_at, error\_count\.

__funder\_giving\_history__

Extracted from 990\-PF data\. Fields: id, organization\_id, funder\_id, recipient\_name, recipient\_ein, amount, purpose, fiscal\_year, source\_filing\_url, created\_at\.

__integration\_keys__

Encrypted API key storage\. Fields: id, organization\_id, service\_name, encrypted\_key, is\_active, last\_validated\_at, validation\_status, created\_at, updated\_at\.

__automation\_notifications__

Alert records\. Fields: id, organization\_id, session\_id, event\_type, message, is\_read, sent\_via \(in\_app/email\), created\_at\.

__custom\_api\_connections__

Client\-configured API integrations\. Fields: id, organization\_id, name, base\_url, auth\_type \(none/api\_key/bearer/oauth\), auth\_config jsonb, field\_mapping jsonb, poll\_schedule, is\_active, last\_polled\_at, last\_success\_at, created\_at\.

__scraping\_targets__

Client\-assigned URLs for research agent scraping\. Fields: id, organization\_id, url, description, scrape\_schedule, last\_scraped\_at, last\_success\_at, failure\_count, is\_active, created\_at\.

__funder\_relationship\_scores__

Dynamic relationship tracking\. Fields: id, organization\_id, funder\_id, score, events jsonb \(array of scored interactions\), last\_updated\_at, created\_at\.

__success\_probability\_scores__

Per\-application success prediction\. Fields: id, organization\_id, application\_id, probability\_score, factors jsonb \(breakdown of each scoring component\), calculated\_at\.

__competitor\_tracking__

Organizations funded by target funders\. Fields: id, organization\_id, competitor\_name, competitor\_ein, funder\_id, grant\_amount, grant\_purpose, fiscal\_year, source, created\_at\.

__follow\_up\_sequences__

Auto\-generated post\-submission actions\. Fields: id, organization\_id, application\_id, sequence\_type \(check\_in/thank\_you/feedback\_request/renewal\_prep\), scheduled\_date, status \(pending/sent/completed\), content, channel \(email/linkedin/phone/mail\), created\_at\.

__grant\_financials__

Financial reconciliation\. Fields: id, organization\_id, application\_id, amount\_requested, amount\_awarded, amount\_received, amount\_spent, budget\_categories jsonb, reporting\_status, next\_report\_due, created\_at, updated\_at\.

__compliance\_obligations__

Grant compliance tracking\. Fields: id, organization\_id, application\_id, obligation\_type \(reporting/spending\_restriction/matching\_fund/regulatory\), description, due\_date, status \(pending/completed/overdue\), completed\_at, notes, created\_at\.

__deadline\_predictions__

Predicted future deadlines from historical patterns\. Fields: id, organization\_id, funder\_id, predicted\_post\_date, predicted\_deadline, confidence, based\_on\_years jsonb, created\_at\.

__white\_label\_configs__

Consultant branding\. Fields: id, organization\_id, logo\_url, primary\_color, secondary\_color, custom\_domain, favicon\_url, company\_name, is\_active, created\_at\.

# __14\. Phase Breakdown \(Updated\)__

## __Phase 1 \- MVP \(COMPLETE\)__

Auth, Dashboard, CRM, Documents, Knowledge Base, AI Drafting, Pipeline, Deadlines, Notes, Outcomes, Recursive Learning, Search Profiles\. 42/42 prompts passed\.

## __Tiers 1\-3 \(COMPLETE\)__

Draft Persistence, Nav State, KB Details, Humanizer, Categorization, Parallel Research, Analytics, Eligibility Enhancement, Alerts, Multi\-Model Consensus, Budget Generator, Document Assembly, Funder Intelligence, Renewals, Success Patterns, Compliance Pre\-Check, Outreach Sequences, Calendar View, Email Parser, Board Reports\. 23/23 prompts\.

## __Tiers 4\-5 \(COMPLETE\)__

Browser Automation \(form detection, auto\-fill, challenge detection, approval checkpoint, portal credentials, verification, dashboard\)\. Stripe Billing\. Usage Limits\. Onboarding Wizard\. Audit Logs\. 13/13 prompts\.

## Phase 6 — SaaS Data Infrastructure & Grant Intelligence

### Layer 1: Federal APIs (Free, build first)
- Grants.gov API — federal opportunities, agency data, application metadata
- Simpler.Grants.gov API — modern REST replacement, bulk extracts
- SAM.gov Assistance Listings — federal assistance programs, award history
- USAspending.gov — historical awards, recipient intelligence, federal spending records
- EPA Grants API — environment/housing crossover funding
- NIH Reporter — health/recovery program funding data
- NSF Award Search — STEM/community development crossover
- USDA Award Database — rural development, directly relevant to rural Texas mission

### Layer 2: Commercial APIs (Budget required, highest ROI)
- Candid Developer Platform — the most important commercial integration
  Provides: nonprofits, foundations, grants, recipients, funding transactions, IRS 990 data, funder intelligence
  Estimated cost: contact Candid for licensing
  Priority: HIGH — schedule integration for first 10 paying customers milestone
- Foundation Directory Online (Candid) — millions of grants, historical giving, foundation profiles
- GrantWatch — housing, community development, state, foundation, corporate grants

### Layer 3: State Scrapers (Competitive moat, no API alternative)
Build individual collectors for all 50 states. Priority order:
1. Texas — TDHCA, Texas Veterans Commission, Texas Health & Human Services
2. Adjacent states — New Mexico, Oklahoma, Louisiana, Arkansas
3. Large state housing agencies — California HCD, Florida Housing, NY Homes & Community Renewal
4. All remaining 50 state housing finance authorities
Architecture: daily change detection, PDF extraction, deadline extraction, eligibility extraction

### Layer 4: Community Foundation Scrapers (900+ targets)
Over 900 community foundations in the US. None have public APIs.
Build a foundation registry with daily monitoring of:
- Grant calendars
- Grant guidelines
- Award announcements
- Deadline changes
Scraper architecture: rotating user agents, respectful crawl delays, change detection vs prior version

### Layer 5: Corporate Giving Monitors
Target list (priority order):
- Walmart Spark Good
- Home Depot Foundation
- Lowe's Foundation
- Bank of America Charitable Foundation
- JPMorgan Chase Community Programs
- Wells Fargo Foundation
- Truist Foundation
- US Bank Foundation
- Target Foundation
- Microsoft Philanthropies
- Google.org
All require scraping and monitoring — no public APIs exist.

### Layer 6: Intelligence Database (Historical awards, IRS 990)
- USAspending historical award data — who got funded, how much, for what
- IRS 990 analysis — foundation giving patterns, board members, restrictions
- Prior recipient intelligence — if a foundation funded 20 housing nonprofits last year,
  that reveals actual priorities vs stated mission
- Foundation board member tracking — relationship mapping for warm introductions
- Funding trend analysis — which categories are growing, which are declining

### Grant Intelligence Library (Training corpus for recursive learning agent)
Collect and tag funded applications from:
- NIH Sample Applications and Documents (openly published)
- NIAID Sample Applications Library
- University grant proposal libraries (Alaska, UCSB, others)
- FOIA requests for funded HUD, SAMHSA, HHS, DOJ reentry applications
Tag each by: executive summary, need statement, program design, logic model,
outcomes, evaluation, sustainability, partnerships, budget narrative, staffing
Target: 500+ funded applications as training corpus

### FOIA Pipeline
Automated FOIA request tracking for previously funded applications from:
- HUD Continuum of Care
- HUD CDBG
- SAMHSA Recovery programs
- HHS Homelessness Prevention
- DOJ Reentry programs
These reveal exact winning language for the programs Faith Foundation pursues.

### Shared Funder Registry Schema (multi-tenant, not per-org)
Table: funder_registry
- id, funder_name, type (federal/state/foundation/corporate/community)
- website, giving_portal_url, application_method
- geographic_focus, typical_award_range_min, typical_award_range_max
- annual_deadline_pattern, categories[], populations_served[]
- last_verified_at, data_source, is_active
- avg_award_amount (from historical data)
- acceptance_rate (from historical data where available)
- prior_recipients[] (jsonb)

This registry is shared infrastructure — all tenants benefit, one maintenance burden.

# __15\. Risk Assessment__

## __Technical__

Grants\.gov API stability: public endpoint, no published rate limits\. Mitigation: exponential backoff, 24\-hour result caching\.

State portal fragility: sites change without notice\. Mitigation: independent per\-state config, isolated failures, alerts on scrape failures\.

2Captcha reliability: 10\-20 second solve times, occasional failures\. Mitigation: 3 retries, fallback to manual\. Never block queue on single failure\.

Browser automation at scale: corporate portals are all different\. Mitigation: 60\-70% automated target, remaining flagged for manual with specific failure context\.

## __Legal__

Web scraping: generally legal for public grant information\. Respect robots\.txt, reasonable delays, legitimate grant\-seeking purpose\.

Form auto\-submission: authorized by the org itself\. Human approval checkpoint establishes consent\. All submissions logged with screenshots for audit trail\.

## __Business__

Federal grant landscape shifts: 2025 grant pause showed priorities change\. Mitigation: diversified sources \(corporate, foundation, state, federal\)\. Not dependent on any single source\.

