# A-46 Directory Registration Agent — Specification

**Document version:** 1.0
**Effective date:** 2026-05-20
**Status:** Phase 1.5 — NOT STARTED
**Agent ID:** A-46
**Owner:** Operator
**Repository path:** `docs/agents/a-46-directory-registration-agent.md`
**Related governance:** AGENTS.md, Contract 60 (Backlink Operations Strict Whitelist), Client Intelligence Intake Master Document

---

## Purpose

A-46 Directory Registration Agent automates and orchestrates the foundational citation work that every new Tarritrix client requires: registering the client business across 30-50 industry directories, citation networks, manufacturer partner pages, insurance carrier directories, and local business listings. This is critical SEO infrastructure work — citation consistency across the web is one of the strongest local SEO ranking factors — but it is also time-intensive when performed entirely manually.

A-46 implements a hybrid automation model: directories that allow API or browser automation are handled programmatically, directories that require human verification are queued to VAs with full context, and directories that prohibit automation are flagged for manual VA execution with templates and tracking.

A-46 strictly complies with Contract 60. It does not create backlinks for SEO manipulation purposes. It submits accurate factual business identity data to legitimate business directories — the same data the business owner would submit manually. The agent automates the data entry, not the citation acquisition strategy.

---

## Why this agent exists

Without A-46, each new client requires 12-15 hours of manual operator or VA labor to complete foundational citation work in the first 30 days of onboarding. At a $6/hour VA rate, that is $72-90 per client in direct labor cost. At scale (50 clients onboarded per year), that is $3,600-4,500 in annual VA labor.

More importantly, manual execution introduces inconsistency. Operators or VAs working through 30+ directory submissions per client make small errors: typos in NAP data, missing phone format conventions, inconsistent business category selection across directories, missing documents on some directories. These inconsistencies are exactly the citation-inconsistency signals Google penalizes. The agent enforces canonical data submission across every directory it touches.

A-46 reduces per-client labor by approximately 60% (from 12-15 hours to 4-6 hours), enforces NAP consistency, and creates a structured workflow that scales with client volume.

---

## Operating principles

### Principle 1: Track A, Track B, Track C classification

Every directory falls into one of three tracks based on automation feasibility and Terms of Service compliance:

**Track A — Full API automation (10-15 directories estimated)**
The directory exposes an authenticated API for business listing submission. A-46 submits via API. No browser automation. No human intervention required for submission. Verification may still require human action (email confirmation, postcard receipt) but submission itself is fully automated.

Examples likely in Track A: Bing Places for Business, Apple Business Connect, Yext network (paid syndication to 60+ sub-directories), Bright Local syndication, Google Business Profile (via Business Profile API), Foursquare for Business.

**Track B — Browser automation with verification handoff (20-25 directories estimated)**
The directory does not expose an API but allows automated form submission (no explicit prohibition in Terms of Service, no aggressive bot detection). A-46 uses Playwright to fill the form, submit it, and stop at the verification step. The agent captures a screenshot of the verification screen, logs the task, and creates a VA task with full context. A human completes the verification (clicks email link, enters SMS code, scans postcard code).

Examples likely in Track B: BBB business profile creation, Yelp business listing, Yellow Pages, Manta, MerchantCircle, Hotfrog, Brownbook, ChamberOfCommerce.com listings, regional Chamber of Commerce directories with standardized forms.

**Track C — Human-only execution (10-15 directories estimated)**
The directory explicitly prohibits automation in Terms of Service, requires underwriter review, requires in-person verification, or uses bot detection sophisticated enough that automation is unreliable. A-46 does NOT attempt automated submission. Instead, the agent creates a VA task with the directory's submission requirements, instructions, deadline, and tracking.

Examples likely in Track C: Manufacturer-certified contractor directories (GAF Master Elite, Owens Corning Platinum) — these require manufacturer underwriter approval; insurance carrier preferred contractor programs (State Farm, Allstate, USAA) — these require carrier-side onboarding; some local chambers requiring in-person meetings; specialized industry associations requiring board review.

### Principle 2: Canonical data enforcement

A-46 reads the client's canonical NAP (Name, Address, Phone) data from the `clients` table and uses it verbatim across every submission. The agent never modifies, reformats, or "improves" the canonical data. If the data is wrong, the operator fixes it in the `clients` table — never in the directory submission.

This ensures that if the client's address ever changes, all directories can be updated by a single canonical change rather than 50 individual edits.

### Principle 3: Submission pacing

A-46 does not fire 50 directory submissions in a single day. Submission pacing follows a 14-21 day distribution per client to mimic organic onboarding behavior. The agent schedules submissions across the distribution window, with higher-priority directories scheduled earlier and lower-priority directories scheduled later.

Pacing also serves a practical purpose: spreading verification flows (email confirmations, postcard receipts) over weeks rather than days prevents VA queue overload and makes verification deadlines more manageable.

### Principle 4: Idempotency and re-verification

Every submission is logged with status tracking. A-46 does not re-submit a directory that has already been successfully registered. The agent supports re-verification (quarterly scan to confirm listings are still live) and update-in-place (when client NAP data changes, A-46 pushes updates to all directories it has access to via API or browser automation).

### Principle 5: Strict Contract 60 compliance

A-46 only submits accurate factual business identity data to legitimate business directories. The agent does not:
- Create backlinks for SEO manipulation purposes
- Submit false or misleading business information
- Submit the same business to a directory multiple times under different identities
- Attempt to circumvent directory verification flows
- Participate in private blog networks, link schemes, or reciprocal link manipulation
- Generate content for placement on third-party domains
- Use automated outreach for link acquisition

Violations of Contract 60 are HARD failures. A-46 cannot be configured to perform these operations; the prohibition is enforced at the code level.

---

## Agent architecture

### Input contract

**Trigger:** Client onboarding completes Tier 1 evidence unlock (per Client Intelligence Intake Master Document)

**Input parameters:**
- `client_id` UUID — the client to register
- `directories_filter` array (optional) — specific directories to submit to, defaults to full tier-appropriate list
- `priority_override` integer (optional) — override default scheduling priority
- `dry_run` boolean (optional) — if true, generate the submission plan without executing

### Per-directory configuration table

A new table `directory_registry` holds the master list of directories the platform knows about. Each row defines:

```
directory_registry columns:
  - id UUID PRIMARY KEY
  - directory_name TEXT NOT NULL (e.g., "Bing Places for Business")
  - directory_url TEXT NOT NULL (the directory's main domain)
  - submission_url TEXT NOT NULL (where the form lives)
  - track TEXT NOT NULL CHECK (track IN ('A', 'B', 'C'))
  - tier INTEGER NOT NULL (1, 2, or 3 — citation tier per Backlink Tier framework)
  - priority INTEGER NOT NULL (1-100, higher = submitted earlier)
  - required_client_data JSONB (which intake sections must be complete)
  - automation_config JSONB (Track A API config or Track B selector config)
  - human_instructions TEXT (Track B and C VA instructions)
  - expected_completion_days INTEGER (typical submission-to-live timeline)
  - verification_method TEXT (email, sms, postcard, document_review, in_person, automatic)
  - directory_category TEXT (general_local, industry_roofing, industry_pdr, manufacturer, insurance, chamber, association)
  - terms_of_service_url TEXT (for compliance audit reference)
  - last_verified_against_tos_at TIMESTAMPTZ (operator updates this when ToS is reviewed)
  - active BOOLEAN NOT NULL DEFAULT TRUE
  - notes TEXT
```

The operator maintains this table. Adding a new directory means inserting a row with full configuration. Removing a directory means setting `active = FALSE`. The table is the single source of truth for which directories A-46 knows about.

### Per-client per-directory state tracking

A new table `client_directory_registrations` tracks the state of every directory submission for every client:

```
client_directory_registrations columns:
  - id UUID PRIMARY KEY
  - client_id UUID REFERENCES clients(id)
  - directory_id UUID REFERENCES directory_registry(id)
  - status TEXT NOT NULL (pending, scheduled, in_progress, awaiting_verification, submitted, verified, live, monitoring, failed, blocked_by_directory, requires_human)
  - scheduled_for TIMESTAMPTZ (when A-46 will execute)
  - executed_at TIMESTAMPTZ
  - submission_outcome TEXT (success, partial, failed)
  - verification_required BOOLEAN
  - verification_method TEXT (inherited from directory_registry but tracked per-submission)
  - verification_completed_at TIMESTAMPTZ
  - live_listing_url TEXT (the URL of the live directory listing once verified)
  - assigned_va_id UUID REFERENCES vas(id) (Track B and C only)
  - va_completed_at TIMESTAMPTZ
  - failure_reason TEXT
  - retry_count INTEGER DEFAULT 0
  - last_attempt_at TIMESTAMPTZ
  - next_attempt_at TIMESTAMPTZ (for retry logic)
  - created_at TIMESTAMPTZ DEFAULT NOW()
  - updated_at TIMESTAMPTZ DEFAULT NOW()
```

### Submission state machine

Each `client_directory_registrations` row moves through a defined state machine:

```
pending → scheduled → in_progress → (branches based on track)

Track A path:
  in_progress → submitted (API success) → verified (auto-verify or manual) → live → monitoring

Track B path:
  in_progress → awaiting_verification (form submitted, awaiting human) → submitted (VA completes verification) → live → monitoring

Track C path:
  in_progress → requires_human (VA assigned task) → submitted (VA submits manually) → awaiting_verification (if applicable) → live → monitoring

Failure paths:
  Any state → failed (retry up to 3 times with exponential backoff)
  Any state → blocked_by_directory (operator intervention required, no auto-retry)
```

### Per-directory automation specifications

Each Track A and Track B directory requires a specification stored in `directory_registry.automation_config`:

**Track A example (Bing Places for Business):**
```
{
  "type": "api",
  "endpoint": "https://api.bingplaces.com/v1/listings",
  "auth_method": "oauth2",
  "auth_credentials_ref": "secrets/bing_places_api_credentials",
  "rate_limit": "1_per_second",
  "request_template": {
    "businessName": "{{client.business_name}}",
    "phoneNumber": "{{client.business_phone}}",
    "address": {
      "addressLine1": "{{client.business_address}}",
      "city": "{{client.primary_city}}",
      "stateOrProvince": "{{client.primary_state}}",
      "postalCode": "{{client.primary_zip}}",
      "country": "US"
    },
    "primaryCategory": "{{directory_mapping.primary_category}}",
    "secondaryCategories": "{{directory_mapping.secondary_categories}}",
    "hours": "{{client.business_hours}}",
    "website": "{{client.website_url}}"
  },
  "success_indicators": ["listing_id", "verification_token"],
  "verification_method": "email_to_business_email"
}
```

**Track B example (Yelp Business):**
```
{
  "type": "browser",
  "engine": "playwright",
  "start_url": "https://biz.yelp.com/signup",
  "selectors": {
    "business_name_input": "input[name='business_name']",
    "phone_input": "input[name='phone']",
    "address_input": "input[name='address1']",
    "city_input": "input[name='city']",
    "state_select": "select[name='state']",
    "zip_input": "input[name='zipcode']",
    "category_input": "input[name='category']",
    "website_input": "input[name='website']",
    "submit_button": "button[type='submit']"
  },
  "verification_screen_selector": "div.verification-prompt",
  "verification_method": "email_to_business_email",
  "stop_after_submission": true,
  "captcha_handling": "fail_to_human",
  "screenshot_on_pause": true
}
```

**Track C example (GAF Master Elite Application):**
```
{
  "type": "human_only",
  "submission_url": "https://www.gaf.com/en-us/why-gaf/become-a-pro/master-elite-contractor",
  "process_description": "Submit GAF Master Elite application via online form. Requires: business identity, certifications, references from 5 completed jobs, license documentation. GAF reviews and underwrites application; approval typically 30-45 days.",
  "required_documents": [
    "business_license",
    "general_liability_insurance",
    "workers_comp_insurance",
    "5_reference_jobs_with_contacts",
    "owner_id"
  ],
  "expected_completion_days": 45,
  "follow_up_cadence_days": 14,
  "verification_method": "manufacturer_review"
}
```

### Selector maintenance

Track B browser automation breaks when directories change their form structure. This is the single biggest operational maintenance burden of A-46. The mitigation strategy:

1. **Selector versioning** — every selector config has a version. When a selector breaks, the operator increments the version and updates the config.
2. **Automated selector verification** — A-46 includes a weekly scheduled job that runs each Track B submission flow in dry-run mode (loads form, verifies all expected selectors are present, does not submit). Selector failures alert the operator before they affect live submissions.
3. **Fallback to Track C** — if a Track B directory's selectors break and cannot be quickly repaired, A-46 temporarily reclassifies it as Track C. VAs handle submissions manually until selectors are fixed.

---

## Per-tier directory recommendations

The actual directory list depends on operator decisions, but here is a recommended starting set organized by citation tier:

### Tier 1 (foundational, submit at onboarding)

These are the citations every legitimate local business has. Their absence is a negative SEO signal. Volume: ~30-35 directories.

**General local citations:**
- Google Business Profile (Track A, mandatory)
- Bing Places for Business (Track A)
- Apple Business Connect (Track A)
- Yelp Business (Track B)
- Yellow Pages (Track B)
- White Pages (Track B)
- BBB Business Profile (Track B)
- Foursquare for Business (Track A)
- Manta (Track B)
- Hotfrog (Track B)
- Brownbook (Track B)
- MerchantCircle (Track B)

**Industry directories — roofing (when applicable):**
- HomeAdvisor (Track B)
- Angi (Track B)
- Thumbtack (Track B)
- Houzz (Track B)
- Porch (Track B)
- HomeStars (Track B)

**Industry directories — PDR (when applicable):**
- PDR Nation (Track C)
- Dent Wizard contractor directory (Track C if PDR-certified)

**Chamber and association directories (varies by location):**
- Local chamber of commerce (Track B or C)
- State contractor association (Track B or C)
- National Association of the Remodeling Industry (NARI) (Track C)
- National Roofing Contractors Association (NRCA) member directory (Track C if member)

**Insurance and review platforms:**
- Insurance.com (Track B if applicable)
- NextDoor business page (Track B)
- TrustPilot (Track B)

### Tier 2 (Authority, submit after 30 days)

Higher-quality citations requiring more documentation. Volume: ~10-15 directories.

- Manufacturer-certified contractor pages (GAF, Owens Corning, CertainTeed, James Hardie) (Track C)
- Insurance carrier preferred contractor directories (where client has approved status) (Track C)
- IICRC certified firms directory (if certified) (Track C)
- HAAG-certified inspector directory (if certified) (Track C)
- State contractor license board public-facing pages (Track C, often auto-listed when license is active)
- Local newspaper business directories (Track B and C)
- Regional industry association member directories (Track C)

### Tier 3 (Dominance, submit after 90 days)

Specialty and high-authority citations. Volume: ~5-10 directories.

- Industry publication contributor directories (Roofing Contractor, Restoration & Remediation) (Track C)
- Trade conference speaker directories (Track C)
- Charity partner pages (Habitat for Humanity contractor lists, etc.) (Track C)
- Veterans Business Enterprise directories (if applicable) (Track C)
- Minority/Women Business Enterprise directories (if applicable) (Track C)
- Local business award directories (Best of [City], etc.) (Track C)

---

## Execution workflow

### Onboarding flow per client

1. **Client reaches Tier 1 evidence unlock** — Intake Sections 1, 2, 3, 8, 15, 16, 17 complete
2. **Operator triggers A-46** via dashboard action, optionally filtering directories or overriding priorities
3. **A-46 generates submission plan** — list of all directories applicable to client, sorted by priority, scheduled across 14-21 day window
4. **Operator reviews plan** (dry run, no submissions yet)
5. **Operator approves plan** — A-46 begins execution per schedule
6. **Track A submissions execute automatically** at scheduled times
7. **Track B submissions execute browser automation** at scheduled times, halt at verification, create VA tasks
8. **Track C submissions create VA tasks** immediately for human execution
9. **VA queue picks up tasks** — VA completes verifications and Track C submissions
10. **State updates** — each registration moves through state machine; operator and VA dashboards reflect current state
11. **Completion notification** — when all directories reach "live" or "blocked" status, operator notified with summary report

### Ongoing maintenance flow

1. **Quarterly re-verification scan** — A-46 verifies each live listing is still accessible at its `live_listing_url`. Failures escalate to operator review.
2. **Annual NAP consistency audit** — A-46 re-checks NAP data on every live directory listing against canonical `clients` data. Discrepancies trigger update tasks.
3. **Client NAP change propagation** — when canonical NAP changes in `clients` table, A-46 generates update tasks for every directory it has access to.
4. **New directory addition** — when operator adds a new directory to `directory_registry`, A-46 generates submission tasks for all existing clients that meet the directory's tier and prerequisites.

---

## VA queue integration

A-46 produces VA tasks at multiple points in the workflow. Each task is a row in the `va_tasks` table:

```
va_tasks columns (relevant fields):
  - id UUID PRIMARY KEY
  - client_id UUID REFERENCES clients(id)
  - source_agent TEXT (e.g., 'A-46')
  - source_record_id UUID (the client_directory_registrations row that spawned this task)
  - task_type TEXT (directory_verification, directory_manual_submission, directory_documentation_upload)
  - directory_id UUID REFERENCES directory_registry(id)
  - priority INTEGER
  - context JSONB (everything the VA needs to complete the task)
  - status TEXT (pending, assigned, in_progress, completed, blocked, escalated)
  - assigned_va_id UUID REFERENCES vas(id)
  - assigned_at TIMESTAMPTZ
  - started_at TIMESTAMPTZ
  - completed_at TIMESTAMPTZ
  - blocked_reason TEXT
  - escalated_to_operator_at TIMESTAMPTZ
  - operator_notes TEXT
  - va_notes TEXT
  - submission_evidence JSONB (screenshots, URLs, confirmation numbers, etc.)
  - created_at TIMESTAMPTZ DEFAULT NOW()
```

The VA dashboard (Document 5) surfaces these tasks as cards with full context. Each card shows what to do, why it matters, what data to use, what to upload as evidence of completion.

---

## Cost model

### Direct platform costs

- **Yext syndication subscription:** ~$60-80/month per client if using Yext network (optional). Covers 60+ sub-directories with single API call.
- **Bright Local subscription:** Alternative to Yext, ~$30-40/month per client. Similar coverage.
- **Proxy infrastructure:** Residential proxy rotation for Track B browser automation, ~$50-100/month platform-wide (not per-client). Required to avoid IP-based blocking.

### VA labor costs

- **Track B verification per directory:** ~5 minutes VA time at $6/hour = $0.50 per verification
- **Track C manual submission per directory:** ~15-30 minutes VA time = $1.50-3.00 per submission
- **Total VA cost per client onboarding:** Approximately $30-50 for full Tier 1 + Tier 2 + Tier 3 directory work

### Combined cost per client

Approximately $90-150 in first 90 days of onboarding (Yext or Bright Local subscription + VA labor + proxy share). This compares favorably to the $300-500 per client that white-label citation services charge for similar coverage.

### Cost-effectiveness threshold

A-46 becomes cost-effective at approximately 5-10 active clients. Below that volume, manual VA execution without the agent infrastructure may be cheaper. The break-even shifts in A-46's favor as client volume grows.

---

## Failure modes and recovery

### Track A API failures

**Symptoms:** API returns 4xx or 5xx errors, authentication failures, rate limit exceeded

**Diagnosis:**
- Check `client_directory_registrations` row for specific failure_reason
- Check directory's API status page
- Check rate limit consumption against allocation

**Resolution:**
- For transient failures (5xx, timeouts), auto-retry with exponential backoff up to 3 attempts
- For authentication failures, alert operator to refresh API credentials
- For rate limit failures, reschedule to next available window
- For persistent failures (3+ retries), reclassify directory temporarily as Track B or C

### Track B selector failures

**Symptoms:** Playwright cannot find expected form elements, form submission times out, captcha appears unexpectedly

**Diagnosis:**
- Compare current page HTML against last successful submission
- Check directory for site redesign announcements
- Review selector verification log for recent failures

**Resolution:**
- Immediate: reclassify directory to Track C temporarily, generate VA task for manual submission
- Short-term: operator updates selector configuration in `directory_registry.automation_config`
- Validate updated selectors via dry-run before re-enabling Track B automation

### Track C VA delays

**Symptoms:** VA tasks sit in queue beyond expected SLA

**Diagnosis:**
- Check VA capacity and task volume
- Check if specific VA is overloaded or unavailable
- Check if task instructions are unclear

**Resolution:**
- Reassign tasks to available VAs
- Clarify task instructions
- Escalate to operator if VA queue is structurally over capacity

### Directory verification failures

**Symptoms:** Submission completed but verification step never completes (email never arrives, postcard lost, etc.)

**Diagnosis:**
- Check email logs for verification email delivery
- Check postcard tracking if applicable
- Check if directory's verification process is functioning

**Resolution:**
- Resend verification (most directories allow re-request)
- Manual outreach to directory support if persistent failures
- Mark as `blocked_by_directory` if directory is unresponsive

### Listing data drift

**Symptoms:** Directory listing shows incorrect NAP data despite canonical data being correct

**Diagnosis:**
- Compare live listing data against canonical `clients` data
- Check if directory was updated manually outside platform
- Check if directory's data sync from API or browser submission failed silently

**Resolution:**
- A-46 generates an update task
- Track A: API update call
- Track B: Browser automation re-submission of corrected data
- Track C: VA task with corrected data and update instructions

---

## Dashboard requirements

### Operator view

**Directory Registration Overview**
- Per-client summary: total directories, submitted, verified, live, blocked
- Aggregate platform view: all clients, all directories, all states
- Filters by status, tier, directory category, track type

**Submission Plan Preview**
- Generated plan for a specific client before approval
- Override priorities and scheduling
- Approve, reject, modify

**Directory Registry Management**
- CRUD interface for `directory_registry` table
- Selector configuration editor for Track B directories
- ToS review reminder system

**Failure and Escalation Queue**
- All registrations in failed or blocked_by_directory state
- Filter by client, by directory, by failure type
- Resolution workflow

### VA view (limited subset)

The VA dashboard (Document 5) shows:
- VA's assigned tasks across all clients they have access to
- Each task is a card with directory name, client name (no other PII beyond what's needed), required action, required data, expected time
- Tools for evidence capture (screenshot upload, confirmation number entry, URL submission)
- Status transitions allowed: start, complete, block (with reason), escalate

### Client view (transparency, no action)

Clients see (read-only) in their client portal:
- List of directories where they are registered
- Status of each (live, in progress, blocked)
- Live listing URLs where applicable
- Estimated completion timeline for in-progress registrations

Clients do NOT see:
- The full directory_registry (which directories exist)
- VA task details
- Submission failure technical details
- Operator notes

---

## Open questions for operator decision

These questions require operator input before implementation begins:

1. **Yext vs Bright Local vs direct API submissions** — Yext syndication is the fastest path to broad citation coverage but adds per-client subscription cost. Direct API submissions are cheaper but require maintaining individual integrations. Which model?

2. **Proxy provider selection** — Residential proxy rotation is required for Track B browser automation at scale. Provider candidates: Bright Data, Oxylabs, Smartproxy. Which?

3. **Initial directory registry seed list** — operator must approve the initial list of 50-60 directories to include in `directory_registry`. Which directories make the cut?

4. **VA SLA targets** — How quickly should Track B verifications complete? Track C submissions? Set internal SLAs.

5. **Captcha handling policy** — When a Track B submission encounters a captcha, options are: fail to human (current spec), use captcha-solving service ($1-3 per solve), or skip the directory. Which?

6. **GAF / Owens Corning / CertainTeed application flow** — These manufacturer programs have complex underwriting flows. Should A-46 manage the application lifecycle (track applications, send follow-ups) or just create the initial VA task and leave lifecycle to manual operator management?

7. **NAP discrepancy escalation policy** — When A-46 detects NAP drift on a directory, should it auto-fix (where possible) or alert operator first?

---

## Cross-references

- **Client Intelligence Intake Master Document** — Sections 1, 2, 3, 4, 5, 6, 7 provide the data A-46 consumes for submissions
- **Service Hub Pages Architecture Specification** — Some directories link to hub pages as destination URLs
- **Asset Hub Feature Specification** (to be written) — VAs upload submission evidence into the Asset Hub
- **VA Dashboard Specification** (to be written) — VA dashboard surfaces all Track B and Track C tasks
- **Contract 60** in BEHAVIORAL_CONTRACTS.md — strict whitelist of permitted operations
- **A-40 External Signal Coordination Engine** — distinct from A-46; A-40 surfaces outreach opportunities while A-46 executes structured submissions

---

**End of document.**
