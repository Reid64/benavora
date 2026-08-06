__BENAVORA__

Behavioral Contracts v2\.0

Sections 17\-33 | Tier 6 Additions

June 13, 2026

# __Existing Contracts \(1\-16\) — Unchanged__

Sections 1\-16 remain as defined in BEHAVIORAL\_CONTRACTS\.md v1\.0\. This document adds sections 17\-33 for Tier 6 features\.

# __17\. Grants\.gov Integration Contracts__

- Grants\.gov API requires no authentication for search endpoints
- Poll frequency: maximum once per 24 hours per search profile
- Cache results for 24 hours to avoid redundant API calls
- Deduplication: match by oppNumber \(Grants\.gov opportunity ID\)\. If match exists, update fields but do not create duplicate
- Map Grants\.gov fundingCategories to Benavora funder\_category enum\. Unmappable categories default to 'government\_grant'
- closeDate maps to opportunity\.deadline\. If no closeDate, set status='open' with no deadline
- All new opportunities created with source='grants\_gov' and status='open'
- Failed API calls retry 3x with exponential backoff \(5s, 15s, 45s\)\. After 3 failures, log error and skip until next cycle

# __18\. SAM\.gov Integration Contracts__

- SAM\.gov API key stored encrypted in integration\_keys table, NEVER in environment variables or client\-side code
- If no SAM\.gov key configured: agent skips silently, no error displayed to user
- Respect 1,000 requests/day limit\. Track daily usage in agent\_runs\. Stop if limit approached\.
- Key validation: test with a minimal search on first use\. Store validation\_status = 'valid' or 'invalid'
- Invalid key: mark inactive, notify user via automation\_notifications, do not retry until user updates key
- Map SAM\.gov response fields: title \-> name, responseDeadLine \-> deadline, description \-> description
- Filter to grant\-type opportunities unless search profile explicitly includes contracts

# __19\. ProPublica Integration Contracts__

- ProPublica API requires NO authentication and NO API key
- Rate limit: self\-imposed 1 request per second\. Never burst\.
- Search endpoint returns basic org data\. Filing endpoints return detailed 990 data\.
- 990\-PF filings contain Schedule I \(grants awarded\)\. This is the primary data source for giving history\.
- Store filing source URLs in funder\_giving\_history\.source\_filing\_url for audit trail
- Maximum 3 fiscal years of giving history per funder \(current \+ 2 prior\)
- Giving history extraction is a separate agent \(Agent 21\) triggered after funder creation
- NEVER use ProPublica data for purposes other than grant research\. Respect their terms of service\.

# __20\. Custom API Connector Contracts__

- Client\-configured API connections store auth credentials encrypted in auth\_config jsonb
- Tier enforcement: Starter=0, Pro=2, Enterprise=5, Consultant=unlimited connections
- Test call required before saving: system makes one request and shows raw JSON response
- Field mapping must include at least: name \(maps to opportunity\.name\)\. All other fields optional\.
- If mapped field is missing from API response: skip that field, do not fail the entire import
- 3 consecutive failed polls: auto\-pause connection, notify user
- Connection secrets \(API keys, tokens\) are NEVER exposed in UI after initial save\. Display masked: \*\*\*\*last4
- Custom API results create opportunities with source = connection\.name

# __21\. Custom Scraping Contracts__

- Respect robots\.txt\. If target URL disallows scraping, do not proceed\. Notify user\.
- Minimum 5\-second delay between requests to the same domain
- If page structure changes \(AI returns 0 results 3 consecutive times\): auto\-pause target, flag for reconfiguration
- NEVER scrape login\-protected pages\. Only public\-facing content\.
- Tier enforcement: Starter=0, Pro=5, Enterprise=25, Consultant=unlimited targets
- Results must pass quality validation: extracted opportunities need at minimum a name and either a URL or description
- Failed scrapes increment failure\_count\. 5\+ failures: auto\-pause and notify user\.

# __22\. CSV Import Contracts__

- Maximum file size: 10MB
- Supported encodings: UTF\-8, UTF\-8\-BOM, ASCII\. Other encodings rejected with clear error\.
- Column mapping is required before import\. System suggests mappings based on header names\.
- Preview shows first 10 rows mapped to Benavora fields\. User confirms before import proceeds\.
- Duplicate detection: match by company\_name \+ email\. Duplicates flagged but not auto\-skipped \(user chooses: skip, update, or create anyway\)
- Import is transactional: if >20% of rows fail validation, abort entire import and report errors
- Progress tracking: store import progress in agent\_runs\. Show percentage to user\.
- Imported funders created with source='csv\_import' and the import timestamp

# __23\. Automation Queue Contracts__

- Queue priority: 1 \(lowest\) to 5 \(highest\)\. Calculated from success\_probability\_score\. 80\+ = priority 5, 60\-79 = 4, 40\-59 = 3, 20\-39 = 2, 0\-19 = 1\.
- Processing order: priority DESC, created\_at ASC \(highest priority first, then FIFO within same priority\)
- Only ONE queue item can have status='processing' per organization at a time \(Starter/Pro\)\. Enterprise/Consultant: up to 3 concurrent\.
- Worker sets status='processing' and started\_at atomically \(SELECT FOR UPDATE to prevent race conditions\)
- Maximum processing time per item: 5 minutes\. If exceeded, worker marks as failed with error 'timeout'\.
- Retry logic: on failure, increment retry\_count\. If retry\_count < max\_retries, set status='queued' \(re\-enter queue at same priority\)\. If retry\_count >= max\_retries, set status='failed' permanently\.
- Daily submission cap enforced: count completed items for today\. If >= tier limit, set remaining queued items to status='paused' with reason\.
- Deleting an application CASCADE deletes its queue entries\.

# __24\. CAPTCHA Solving Contracts__ __\(superseded 2026\-08\-06 — see AUTOAPPLY\_ARCHITECTURE\_V2\.md §10B\)__

- __This section supersedes its own prior version in full, not additively__\. Benavora does not build or continue any CAPTCHA\-solving capability\. The retired language below \(3 solve attempts, 60s timeout, cost\-tracking, and the old plain\-CAPTCHA\-vs\-security\-challenge distinction\) no longer describes real system behavior — kept beneath this line for history only, not as guidance\.
- __Every detection pauses, unconditionally__\. Whether `TWOCAPTCHA_API_KEY` is configured no longer matters — there is no auto\-solve path in `worker/queue\-processor\.ts`'s submission pipeline\. The old plain\-CAPTCHA\-vs\-security\-challenge distinction is retired: both signal classes pause the same way, every time, with no exception and no "if the risk score is low enough\."
- Detection is a union of two signals, either one triggers the pause: \(1\) `CaptchaSolver\.detectCaptcha\(page\)` returning a non\-null `type` \(`recaptcha_v2` \| `recaptcha_v3` \| `hcaptcha` \| `turnstile`\), reusing its existing classification verbatim; \(2\) a bounded page\-text keyword heuristic for non\-CAPTCHA verification challenges — `"verify you're human"`, `"unusual activity"`, `"account has been locked"`, `"enter the code sent to"`, `"two\-factor"`, `"one\-time passcode"`, `"security check"`\.
- On detection: the fill pipeline stops immediately \(no retry\-the\-login loop, no attempt to proceed past the challenge\)\. A screenshot is captured and tagged `captcha_detected`\. The `submission_queue` row is updated to `status='paused_verification'` with `pause_reason`, `paused_at`, and `paused_screenshot_path` set; `paused_history` \(jsonb\) accumulates every pause event across resume attempts and `resume_count` tracks how many times a human has resumed\. `createApprovedAutomationSession\(\)` is never reached for a paused item — nothing is "mid\-submission" to roll back\.
- The only way past a detected challenge is a human resolving it out\-of\-band and clicking resume via the Human Review Queue UI \(AUTOAPPLY\_ARCHITECTURE\_V2\.md §10C\)\. Resume means retry from the top \(a fresh page navigation on the next queue pass\), not continuing inside the paused browser session — the original page/context is not kept alive across the pause\.
- __Known residual gap, not closed by this policy change alone__: `src/lib/autoapply/form-filler-agent\.ts`'s own `checkCaptcha\(\)` \(fires after login\-gating, during actual field\-by\-field fill and on every multi\-page navigation — i\.e\. after an `automation_sessions` row has already been approved for that attempt\) still calls `CaptchaSolver\.solveCaptcha\(\)`/`injectSolution\(\)` and will silently solve a CAPTCHA encountered mid\-fill if `TWOCAPTCHA_API_KEY` is configured\. This was out of scope for the 2026\-08\-06 build \(which covered only `queue\-processor\.ts`'s pre\-fill check\) and needs its own follow\-up before this contract's "every detection pauses, unconditionally" claim is true platform\-wide, not just at the pre\-fill checkpoint\. `src/lib/scraper/stealth\-engine\.ts` \(the unrelated Directive\-1 web scraper, not part of AutoApply submissions\) also still calls `solveCaptcha\(\)`/`injectSolution\(\)` and is unaffected by this contract, which governs AutoApply submissions only\.

## Retired language \(superseded 2026\-08\-06 — do not follow\)

- ~~2Captcha API key stored in integration\_keys with service\_name='two\_captcha'~~
- ~~If no key configured: CAPTCHA detection pauses session for human intervention \(existing behavior, no regression\)~~
- ~~Supported types: image CAPTCHA, reCAPTCHA v2, hCaptcha\. reCAPTCHA v3 NOT supported \(requires browser scoring\)\.~~
- ~~3 solve attempts per CAPTCHA\. If all fail: pause for human with screenshot\.~~
- ~~Solve timeout: 60 seconds per attempt\. After timeout, count as failure\.~~
- ~~Cost tracking: log each solve attempt with cost \($0\.00059 for image, $0\.00299 for reCAPTCHA/hCaptcha\) in agent\_runs\.~~
- ~~Never auto\-solve CAPTCHAs that appear to be security challenges \(unusual patterns, account lockout warnings\)\. Pause for human\.~~

# __25\. Success Probability Contracts__

- Score range: 0\-100 \(percentage\)
- Starter tier: basic scoring \(eligibility score only, rescaled 0\-100\)\. Pro/Enterprise/Consultant: full 6\-factor model\.
- Recalculate when: eligibility score changes, new giving history extracted, outcome recorded for same funder category, deadline approaches
- If any factor has insufficient data: use midpoint \(50% of max points for that factor\), mark factor as 'estimated' in factors jsonb
- Display as percentage on application card and detail page\. Color: green 70\+, yellow 40\-69, red below 40\.
- Drives automation queue priority\. Higher probability = higher priority\.
- Minimum 3 historical outcomes needed for Track Record factor\. Below 3: use category average or midpoint\.

# __26\. Funder Relationship Scoring Contracts__

- Score range: 0\-100\. Start at 0 for new funders\.
- Event deltas: cold\_outreach\_sent \(\+5\), response\_received \(\+15\), application\_submitted \(\+10\), awarded \(\+25\), denied\_with\_feedback \(\+5\), denied\_no\_feedback \(\-5\), 3\+\_consecutive\_denials \(\-15\), renewal\_submitted \(\+10\), note\_added \(\+2\)
- Time decay: \-5% of current score every 90 days of no interaction\. Floor at 0\.
- Trend calculation: last 3 events net positive = 'rising', net negative = 'falling', mixed = 'neutral'
- Display on funder detail page with visual indicator \(arrow up/down/flat\)
- Funders with score 0 AND no interaction in 180 days: flagged as 'stale' on funder list
- Events are immutable once recorded\. Score recalculated from full event history on each update\.

# __27\. Competitor Intelligence Contracts__

- Enterprise and Consultant tiers ONLY\. Other tiers: feature hidden\.
- Data source: funder\_giving\_history \(from 990\-PF mining\)\. NEVER from proprietary databases\.
- Competitors identified by: same geographic area \+ similar mission keywords \+ funded by same funders
- Maximum 50 competitors tracked per funder \(prevent data bloat\)
- Competitor data refreshed when giving history is updated \(new fiscal year available\)
- NEVER contact competitors or scrape their websites\. All data from public IRS filings\.
- Display as read\-only dashboard\. No export of competitor contact information\.

# __28\. Follow\-Up Sequence Contracts__

- Auto\-generated follow\-ups require Pro tier or above\. Starter: manual follow\-up only\.
- Timing rules: check\_in scheduled 14 days after opportunity deadline\. thank\_you within 3 days of award\. feedback\_request within 7 days of denial\. renewal\_prep 90 days before next cycle\.
- Channel selection: default to email\. If no email for funder contact, fall back to: linkedin > phone > mail
- Content generated by AI and processed through Humanizer\. NEVER send without humanization\.
- All follow\-ups respect org\-level email sending limits \(50/day\)
- User can edit, reschedule, or cancel any queued follow\-up before it executes
- Executed follow\-ups create notes on the funder record for history tracking

# __29\. Financial Reconciliation Contracts__

- One grant\_financials record per application\. Created when outcome = 'awarded'\.
- amount\_requested and amount\_awarded pre\-populated from application and outcome records
- amount\_received and amount\_spent are manual entry fields \(no bank integration\)
- budget\_categories jsonb matches the budget builder output format for consistency
- reporting\_status options: not\_required, pending, submitted, overdue
- next\_report\_due: set from grant terms\. Creates a compliance\_obligations record when populated\.
- Financial data is owner/admin visible only\. Writers and viewers cannot see dollar amounts\.

# __30\. Compliance Calendar Contracts__

- Obligation types: reporting, spending\_restriction, matching\_fund, regulatory
- Obligations auto\-created when: grant awarded \(reporting\), budget has matching requirement, org has annual filing obligations \(990\-N\)
- Status transitions: pending \-> completed \(manual\), pending \-> overdue \(automatic when due\_date < today\)
- Overdue obligations display red on dashboard and send notification
- Completed obligations require completed\_at timestamp and optional notes
- Calendar view shows obligations alongside deadlines \(different icon/color\)

# __31\. White\-Label Portal Contracts__

- Consultant tier ONLY\. All other tiers: feature hidden and inaccessible\.
- Branding scope: logo, primary/secondary/accent colors, company name, favicon\. Layout and features are NOT customizable\.
- Custom domain via CNAME\. Vercel handles SSL provisioning\.
- Data isolation: white\-label clients are separate organizations\. Consultant sees them via a master dashboard but CANNOT modify their data\.
- Master dashboard: read\-only aggregate view\. Total applications, awards, success rates across all managed orgs\.
- Client switching: consultant selects client org from dropdown, view switches to that org's full dashboard\.
- White\-label configs stored in white\_label\_configs table\. One config per organization\.

# __32\. Notification System Contracts__

- Event types that trigger notifications: automation\_completed, automation\_failed, automation\_paused, deadline\_approaching, agent\_completed, agent\_failed, key\_expired, target\_paused, daily\_limit\_reached
- Channels: in\_app \(always\), email \(configurable per event type\)
- In\-app: stored in automation\_notifications table\. Bell icon shows unread count\. Click marks as read\.
- Email: sent via Resend API if configured\. If no Resend key: in\-app only, no error\.
- Digest options \(user configurable\): per\_event \(immediate\), hourly\_digest, daily\_summary
- Notification retention: 90 days\. Older notifications auto\-deleted by scheduled cleanup\.
- NEVER send notifications about other organizations' data\. Strict org\_id scoping\.

# __33\. Continuous Operation Contracts__

- Worker process runs on dedicated VPS, independent of Vercel web app
- Polling interval: configurable, default 5 minutes\. Range: 1\-60 minutes\.
- Worker reads ALL state from database\. Zero in\-memory state\. Crash\-safe by design\.
- Process manager \(PM2 or systemd\) restarts worker on crash
- Worker responsibilities: process automation\_queue, execute scheduled agent runs, send due follow\-ups, dispatch notifications
- Scheduling matrix: Grants\.gov=daily, SAM\.gov=weekly, ProPublica=weekly, State portals=weekly per state, Custom APIs=per connection config, Custom scraping=per target config, Deadline predictions=monthly, Competitor intel=monthly
- Rate limit coordination: worker tracks API call counts in agent\_runs\. If approaching any service limit, skip until next cycle\.
- Health check endpoint: /api/worker/health returns last heartbeat timestamp\. Alert if >15 minutes stale\.

# __34\. Autonomous Agent Contracts__

### Hard Limits \(absolute — no exceptions, no operator overrides\)

- Autonomous agents NEVER submit applications or forms to external funders without explicit human approval
- Autonomous agents NEVER send emails to external parties without human approval
- Autonomous agents NEVER delete user data of any kind
- Autonomous agents NEVER modify governance files
- Autonomous agents NEVER exceed org max\_auto\_drafts\_per\_night limit
- Autonomous agents NEVER access data outside org scope \(organization\_id isolation enforced equally\)
- All of the above are enforced as TypeScript constants in AUTONOMOUS\_HARD\_LIMITS and as behavioral patterns in every agent class

### Decision Logging Requirements

- Every autonomous decision MUST create an agent\_decisions record BEFORE executing the action
- decision\_type, reasoning, confidence\_score, and action\_taken are required on every record
- Any action with requiredHumanReview=true creates a blocking notification immediately
- Decisions with confidence\_score < 60 automatically set requiredHumanReview=true

### Chain Contract

- Agent chaining is one\-directional: AG\-17 \-> AG\-15 \-> AG\-05 \(never circular\)
- A chained agent only fires if the upstream agent completed successfully
- Maximum chain depth: 3 \(discovery \-> scoring \-> drafting\)
- Chain payload always includes the triggering agent's run\_id for full traceability

### Human Review Gates

- All auto\-generated drafts: auto\_generated=true, pending\_review=true
- A pending\_review=true application cannot advance past 'drafting' stage \(API enforces this\)
- Only owner or admin role can clear pending\_review
- Clearing pending\_review creates a pipeline\_history record: 'Autonomous draft approved by \{user\}'

### Notification Contracts

- Morning digest fires at 7:00 AM CST regardless of pipeline activity
- CRITICAL reputation alerts fire immediately \(not batched\)
- Maximum 1 digest notification per org per day
- All autonomous notifications link to the relevant review page

# __35\. Autonomous Configuration Contracts__

- org\_autonomous\_config created with all flags=false on org creation \(opt\-in default\)
- auto\_draft\_threshold below 50 is blocked by API validation
- Disabling auto\_research\_enabled also disables auto\_score\_enabled and auto\_draft\_enabled
- Only owner role can modify autonomous config
- Config changes take effect at the next nightly pipeline run

