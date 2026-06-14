__BENAVORA__

Agent Definitions v2\.0

15 New Agents \(Agents 15\-29\) | 29 Total

June 13, 2026

# __Existing Agents \(1\-14\) — Unchanged from v1__

Agents 1\-14 remain as defined in AGENTS\.md v1\.0\. This document defines only the new Tier 6 agents\.

# __Tier 6 Agents__

## __Agent 15: Grants\.gov Research Agent__

__Field__

__Value__

Purpose

Polls Grants\.gov API for federal grant opportunities matching search profiles\.

Type

Research \(Scheduled\)

Trigger

Daily CRON or manual trigger

Input

Search profile keywords, funding categories, geographic scope

Model

None \(API client, no AI\)

Est\. Tokens

N/A

Rate Limit

Max 50 API calls per poll cycle

Tier Gate

All tiers \(Grants\.gov is free\)

Process:

- Load all active search profiles for the organization
- For each profile, construct POST request to https://api\.grants\.gov/v1/api/search2
- Parameters: keyword from profile, fundingCategories mapped from funder\_category, rows=25, sortBy=closeDateDesc
- Parse response: extract oppNumber, title, agency, closeDate, awardCeiling, awardFloor, eligibility
- Deduplicate against existing opportunities by matching on oppNumber or title\+agency
- Create new opportunity records with source = 'grants\_gov', status = 'open'
- Auto\-trigger Eligibility Scoring Agent on each new opportunity
- Update search profile last\_run\_at and results\_count

Output: New opportunity records with federal source attribution\. Agent run log with items\_found and items\_processed\.

Error Handling: HTTP timeout: retry 3x with exponential backoff\. Invalid response: log and skip\. Rate limit \(if encountered\): back off 60 seconds\.

## __Agent 16: SAM\.gov Research Agent__

__Field__

__Value__

Purpose

Polls SAM\.gov API for federal contract and grant opportunities\.

Type

Research \(Scheduled\)

Trigger

Weekly CRON or manual trigger

Input

Search profile keywords, SAM\.gov API key from integration\_keys

Model

None \(API client\)

Est\. Tokens

N/A

Rate Limit

1,000 requests/day \(SAM\.gov limit\)

Tier Gate

All tiers \(API key is free, client registers at sam\.gov\)

Process:

- Load SAM\.gov API key from integration\_keys table\. If no key, skip with log message\.
- Load active search profiles
- For each profile, GET https://api\.sam\.gov/prod/opportunities/v2/search with api\_key, keyword, postedFrom, postedTo, limit=25
- Parse response: extract title, type, solicitationNumber, postedDate, responseDeadLine, description
- Filter to grant\-type opportunities \(exclude pure contracts unless search profile includes them\)
- Deduplicate against existing opportunities
- Create new opportunity records with source = 'sam\_gov'
- Auto\-trigger Eligibility Scoring Agent

Output: New opportunity records\. Agent run log\.

Error Handling: Missing API key: log warning, skip\. 403/401: mark key as invalid in integration\_keys\. Rate limit: stop polling, resume next day\.

## __Agent 17: ProPublica 990 Mining Agent__

__Field__

__Value__

Purpose

Searches ProPublica Nonprofit Explorer to build funder database from IRS 990 filings\.

Type

Research \(Scheduled\)

Trigger

Weekly CRON or manual trigger

Input

Search profile keywords, geographic scope, NTEE codes

Model

claude\-sonnet\-4\-6 \(for 990\-PF analysis\)

Est\. Tokens

3,000 input / 1,500 output

Rate Limit

Respectful polling: 1 request per second to ProPublica

Tier Gate

All tiers

Process:

- Load active search profiles with foundation\-related categories
- For each profile, GET https://projects\.propublica\.org/nonprofits/api/v2/search\.json?q=\{keyword\}&state=\{state\}
- Filter results to 501\(c\)\(3\) private foundations \(c\_code filter\)
- For each foundation: extract EIN, name, total\_revenue, total\_assets, city, state
- Check if funder already exists by EIN match\. If not, create new funder record with category='private\_foundation'
- If 990\-PF filing detected: queue for Giving History Extractor \(Agent 22\)
- Rate limit: 1 second delay between API calls

Output: New funder records populated from IRS data\. Queue entries for giving history extraction\.

Error Handling: ProPublica down: retry 3x, log failure\. No results: normal, log 0 found\. Invalid response: skip and log\.

## __Agent 18: State Portal Research Agent__

__Field__

__Value__

Purpose

Scrapes state\-specific grant portals for matching opportunities\.

Type

Research \(Scheduled\)

Trigger

Weekly CRON per state, or manual trigger

Input

State portal config from state\_portals table, search profile keywords

Model

claude\-sonnet\-4\-6 \(for unstructured page analysis\)

Est\. Tokens

4,000 input / 2,000 output

Rate Limit

1 state portal per 5\-minute interval

Tier Gate

Starter: 1 state | Pro: 5 states | Enterprise/Consultant: all

Process:

- Load state\_portals config for target state
- Check tier gate: verify org subscription allows this state count
- Fetch portal URL via server\-side HTTP request
- Send page content to Claude: 'Extract all grant opportunities from this state grant portal page\. For each: title, agency, deadline, amount, eligibility, URL\.'
- Parse structured response
- Deduplicate against existing opportunities by title \+ state
- Create new opportunity records with source = state name
- Update state\_portals\.last\_scraped\_at

Output: New opportunity records from state sources\.

Error Handling: Portal unreachable: increment error\_count, alert if >3 consecutive failures\. Page structure changed: flag for reconfiguration\.

## __Agent 19: Custom API Research Agent__

__Field__

__Value__

Purpose

Polls client\-configured REST API integrations for opportunities\.

Type

Research \(Scheduled per connection\)

Trigger

Per connection poll\_schedule, or manual trigger

Input

custom\_api\_connections config \(URL, auth, field mapping\)

Model

None \(direct API mapping\)

Est\. Tokens

N/A

Rate Limit

Respects target API rate limits\. Default: 100 calls/hour\.

Tier Gate

Pro: 2 connections | Enterprise: 5 | Consultant: unlimited

Process:

- Load active custom\_api\_connections for the organization
- Check tier gate: verify connection count within limit
- For each connection: construct request with auth from auth\_config
- Execute HTTP request to base\_url
- Apply field\_mapping to transform response JSON to opportunity fields
- Deduplicate against existing opportunities
- Create new opportunity records with source = connection name
- Update last\_polled\_at and last\_success\_at

Output: New opportunity records from custom sources\.

Error Handling: Auth failure: mark connection inactive, notify user\. Parse error: log raw response, increment error\_count\. 3\+ failures: auto\-pause connection\.

## __Agent 20: Custom Scrape Research Agent__

__Field__

__Value__

Purpose

AI\-powered scraping of client\-assigned URLs for opportunity discovery\.

Type

Research \(Scheduled\)

Trigger

Per target scrape\_schedule, or manual trigger

Input

scraping\_targets URL \+ description

Model

claude\-sonnet\-4\-6

Est\. Tokens

5,000 input / 2,000 output

Rate Limit

1 target per minute

Tier Gate

Pro: 5 targets | Enterprise: 25 | Consultant: unlimited

Process:

- Load active scraping\_targets for the organization
- Check tier gate: verify target count within limit
- Fetch target URL via server\-side HTTP
- Send page content \+ target description to Claude: 'This page should contain \{description\}\. Extract all funding opportunities\. For each: name, organization offering it, amount, deadline, URL, eligibility requirements\.'
- Parse response, validate extracted data has required fields
- Deduplicate and create opportunity records with source = 'scrape:' \+ target URL
- Update last\_scraped\_at

Output: New opportunity records from scraped sources\.

Error Handling: Fetch failed: increment failure\_count\. 5\+ failures: pause target, notify user\. AI returns no results: may indicate page structure change, flag for review\.

## __Agent 21: Giving History Extractor__

__Field__

__Value__

Purpose

Extracts grant recipient data from 990\-PF Schedule I filings via ProPublica\.

Type

Data Extraction

Trigger

Queued by ProPublica Mining Agent, or manual trigger per funder

Input

Funder EIN, funder\_id, ProPublica filing URL

Model

claude\-sonnet\-4\-6 \(for PDF/filing analysis\)

Est\. Tokens

6,000 input / 3,000 output

Rate Limit

1 filing per 2 seconds \(respectful to ProPublica\)

Tier Gate

All tiers

Process:

- Load funder record and retrieve recent 990\-PF filing URLs from ProPublica
- For each fiscal year \(last 3 years\): fetch filing data
- If structured XML available: parse Schedule I Part II directly \(recipient name, EIN, amount, purpose\)
- If only PDF available: send to Claude for extraction
- Create funder\_giving\_history records for each grant awarded
- Deduplicate: skip if matching \(funder\_id, recipient\_ein, fiscal\_year, amount\) exists
- Calculate aggregate stats: average grant size, total annual giving, geographic distribution
- Update funder record with intelligence data

Output: funder\_giving\_history records\. Updated funder intelligence profile\.

Error Handling: Filing not found: log, try previous year\. PDF parsing failure: flag funder for manual review\. Duplicate filing: skip silently\.

## __Agent 22: Success Probability Agent__

__Field__

__Value__

Purpose

Calculates per\-application probability of funding based on multiple factors\.

Type

Analysis \(Triggered\)

Trigger

After eligibility scoring, or manual trigger, or before queue submission

Input

Application record, opportunity, org profile, giving history, outcomes history

Model

claude\-sonnet\-4\-6

Est\. Tokens

4,000 input / 1,500 output

Rate Limit

100 calculations per hour per org

Tier Gate

Starter: basic \(eligibility only\) | Pro/Enterprise/Consultant: full multi\-factor

Process:

- Load application, opportunity, funder, and org profile
- Factor 1 \- Eligibility Score: normalize to 0\-25 points
- Factor 2 \- Giving History Match: check funder\_giving\_history for grants matching org's mission/geography\. 0\-20 points
- Factor 3 \- Track Record: query outcomes for same funder\_category\. Win rate \* 20 = 0\-20 points
- Factor 4 \- Deadline Proximity: more time = higher score\. 0\-10 points
- Factor 5 \- Competition Density: from competitor\_tracking, estimate competition\. Lower = higher\. 0\-10 points
- Factor 6 \- Narrative Quality: from proven\_narratives availability and effectiveness\_score\. 0\-15 points
- Sum factors, normalize to 0\-100 percentage
- Store in success\_probability\_scores with factors breakdown

Output: success\_probability\_scores record with probability\_score and factors jsonb\.

Error Handling: Insufficient data for any factor: use neutral midpoint score, flag factor as 'estimated' in factors jsonb\.

## __Agent 23: Funder Relationship Agent__

__Field__

__Value__

Purpose

Maintains dynamic relationship scores based on interaction history\.

Type

Analysis \(Event\-Driven\)

Trigger

Triggered by: outreach sent, response received, application submitted, outcome recorded, note added

Input

Event type \+ funder\_id \+ event metadata

Model

None \(deterministic scoring\)

Est\. Tokens

N/A

Rate Limit

N/A \(event\-driven, lightweight\)

Tier Gate

All tiers

Process:

- Load current funder\_relationship\_scores record \(or create if first interaction\)
- Apply event delta: cold\_outreach\_sent \(\+5\), response\_received \(\+15\), application\_submitted \(\+10\), denied\_with\_feedback \(\+5\), denied\_no\_feedback \(\-5\), awarded \(\+25\), renewal\_submitted \(\+10\), 3\+\_consecutive\_denials \(\-15\)
- Append event to events jsonb array with timestamp
- Apply time decay: reduce score by 5% for every 90 days of inactivity
- Calculate trend: 'rising' if last 3 events positive, 'falling' if last 3 negative, 'neutral' otherwise
- Clamp score to 0\-100 range
- Update funder\_relationship\_scores record

Output: Updated relationship score with trend\. No AI needed\.

Error Handling: Missing funder: create score record with 0\. Concurrent events: last\-write\-wins \(acceptable for scoring\)\.

## __Agent 24: Competitor Intelligence Agent__

__Field__

__Value__

Purpose

Identifies organizations competing for the same funding from target funders\.

Type

Analysis \(Scheduled\)

Trigger

Weekly CRON, or triggered after giving history extraction

Input

funder\_giving\_history records, funder\_id

Model

claude\-sonnet\-4\-6

Est\. Tokens

3,000 input / 1,500 output

Rate Limit

50 analyses per day per org

Tier Gate

Enterprise and Consultant tiers only

Process:

- Load funder\_giving\_history for target funder \(last 3 fiscal years\)
- Group recipients by purpose/mission similarity
- For recipients in same geographic area AND similar mission: create competitor\_tracking records
- Send to Claude: 'Given these grant recipients from \{funder\_name\}, identify which are most similar to \{org\_name\} in mission and geography\. For each competitor, note: what they do, how they differ, estimated competitive advantage\.'
- Store analysis in competitor\_tracking
- Flag funders where competition is high \(3\+ similar orgs funded\) vs low

Output: competitor\_tracking records with competitive analysis\.

Error Handling: Insufficient giving history: skip with log\. Analysis ambiguous: store with low confidence flag\.

## __Agent 25: Deadline Prediction Agent__

__Field__

__Value__

Purpose

Predicts future grant deadlines from historical posting patterns\.

Type

Analysis \(Scheduled\)

Trigger

Monthly CRON, or manual trigger per funder

Input

Historical opportunity records for funder, funder\_giving\_history fiscal years

Model

None \(statistical pattern detection\)

Est\. Tokens

N/A

Rate Limit

N/A

Tier Gate

Pro, Enterprise, Consultant tiers

Process:

- Load all historical opportunities for the funder \(closed/expired/awarded\)
- Extract posting\_date and deadline pairs
- If 2\+ years of data: detect annual/quarterly/rolling pattern
- Calculate expected next posting date and deadline with confidence
- Confidence: 90% if 3\+ years consistent pattern, 70% if 2 years, 50% if 1 year
- Create deadline\_predictions record
- If prediction falls within 60 days: auto\-create a projected opportunity for preparation

Output: deadline\_predictions record with confidence score\. Optional projected opportunity\.

Error Handling: No historical data: skip silently\. Irregular pattern: store with low confidence, flag as unreliable\.

## __Agent 26: Application Cloning Agent__

__Field__

__Value__

Purpose

Clones a winning application and adapts it for a different funder with similar priorities\.

Type

Drafting \(Manual Trigger\)

Trigger

User clicks 'Clone for Similar Funder' on an awarded application

Input

Source application \(awarded\), target opportunity, target funder

Model

claude\-sonnet\-4\-6

Est\. Tokens

6,000 input / 4,000 output

Rate Limit

Counts against AI drafts/month limit

Tier Gate

All tiers \(counts against draft limit\)

Process:

- Load source application: draft\_content, budget, document list, outcome narrative\_snapshot
- Load target opportunity: requirements, amount range, eligibility criteria, funder priorities
- Load target funder intelligence \(if available\)
- Send to Claude: 'Adapt this winning grant narrative for a different funder\. Original funder: \{source\}\. New funder: \{target\}\. Key differences: \{diff\}\. Maintain the winning structure and proven language patterns\. Adjust: dollar amounts, funder\-specific priorities, geographic references, program emphasis\.'
- Generate adapted draft with confidence score
- Create new application record linked to target opportunity
- Copy document links from source application\_documents
- Set stage to 'drafting'

Output: New application with adapted draft, copied documents, confidence score\.

Error Handling: Source application has no draft: block with error\. Target opportunity missing key fields: proceed with warnings\.

## __Agent 27: Semantic Funder Matching Agent__

__Field__

__Value__

Purpose

Matches organization mission against funder database using AI semantic similarity\.

Type

Analysis \(Manual Trigger\)

Trigger

User clicks 'Find Matching Funders' or on schedule after new funders added

Input

Organization profile \(mission, programs, service area\), full funder database

Model

claude\-sonnet\-4\-6

Est\. Tokens

5,000 input / 2,000 output

Rate Limit

10 matching runs per day per org

Tier Gate

All tiers

Process:

- Load organization profile: mission\_statement, programs, service\_area, target\_population
- Load all funders with giving\_portal\_url or giving history
- Batch funders into groups of 20 for processing
- Send each batch to Claude: 'Score each funder 0\-100 on alignment with this organization\. Consider: mission overlap, geographic match, funding history relevance, program category fit\. Return sorted by score with reasoning\.'
- Merge and sort all results
- For funders scoring 70\+: create or update opportunity suggestions
- Surface top 10 matches on dashboard

Output: Ranked funder list with alignment scores and reasoning\.

Error Handling: Too many funders: batch and paginate\. AI timeout: retry with smaller batch\. No matches above 70: lower threshold to 50, flag as 'exploratory'\.

## __Agent 28: Follow\-Up Generator Agent__

__Field__

__Value__

Purpose

Auto\-creates post\-submission follow\-up actions across channels\.

Type

Automation \(Event\-Driven\)

Trigger

Triggered when application moves to 'submitted' stage, or outcome recorded

Input

Application record, funder, opportunity, funder intelligence

Model

claude\-sonnet\-4\-6

Est\. Tokens

2,000 input / 1,000 output

Rate Limit

N/A \(event\-driven\)

Tier Gate

Pro, Enterprise, Consultant tiers

Process:

- Detect trigger event: submission, award, denial, or approaching renewal
- If SUBMITTED: schedule check\_in 14 days after deadline via preferred channel
- If AWARDED: schedule thank\_you within 3 days via email, schedule renewal\_prep 90 days before next cycle
- If DENIED: schedule feedback\_request within 7 days if funder accepts feedback inquiries
- Generate content using Claude with funder intelligence context for personalization
- Process through AI Humanizer agent
- Create follow\_up\_sequences records with scheduled\_date and channel
- Notifications sent when actions come due

Output: follow\_up\_sequences records queued for execution\.

Error Handling: No contact info for channel: fall back to email\. Funder intelligence missing: use generic templates\.

## __Agent 29: Automation Worker Agent__

__Field__

__Value__

Purpose

Background process that executes the automation queue: browser sessions, form fills, submissions\.

Type

System \(Continuous\)

Trigger

Runs on 5\-minute polling interval on dedicated VPS

Input

automation\_queue entries with status='queued'

Model

None \(orchestrator, delegates to existing browser automation\)

Est\. Tokens

N/A

Rate Limit

Respects tier limits: daily\_submissions, concurrent\_sessions, batch\_queue\_size

Tier Gate

All tiers \(automation level determines behavior\)

Process:

- Wake on interval, check automation\_queue for next item \(ORDER BY priority DESC, created\_at ASC\)
- If no items: sleep and retry
- Set queue item status='processing', started\_at=now\(\)
- Check daily submission count against tier limit\. If exceeded: skip, status='paused', log reason
- Invoke browser automation pipeline: navigate, detect form, fill, handle challenges
- If CAPTCHA detected AND 2captcha key exists: attempt solve \(3 tries\)\. If no key: pause for human\.
- If automation\_level='supervised': pause for human approval before submit
- If automation\_level='semi\_autonomous': auto\-submit if all fields >90% confidence
- If automation\_level='autonomous': auto\-submit, capture confirmation
- On success: status='completed', capture screenshot, create notification
- On failure: increment retry\_count, append to error\_log, status='failed' if retry\_count >= max\_retries
- Create automation\_notifications record for outcome

Output: Updated queue item status\. Screenshots\. Confirmation numbers\. Notifications\.

Error Handling: Browser crash: restart session, retry\. Portal unreachable: status='failed', error\_log\. Worker crash: restart via process manager, resume from last incomplete item\.

