# BENAVORA — Architecture Addendum: Core Tool Systems

## Version: 1.0
## Date: June 18, 2026
## Status: CANONICAL — This document supersedes any conflicting definitions in BLUEPRINT.md, AGENTS.md, or prior governance docs regarding browser automation and application tooling.

---

## 1. Two Distinct High-Level Tools

Benavora is built around two fundamentally different automation systems. They share the same data layer (Supabase), the same Knowledge Base, and the same funder/opportunity database, but they serve different purposes, carry different risk profiles, and operate at different levels of autonomy.

### Tool 1: Grant Application Pipeline (Draft Generator)

**Purpose:** AI-assisted generation of grant narratives, budget narratives, impact statements, letters of inquiry, and full proposals for federal, state, and foundation grant programs.

**Risk Profile:** HIGH. Grant applications are legal documents. Federal grants involve OMB compliance (2 CFR 200), audit requirements, and potential fraud liability for misrepresentation. Errors can result in debarment, clawback of awarded funds, and reputational damage with funders.

**Automation Level:** Semi-autonomous with mandatory human review. The operator manually selects which opportunities to apply for. The system generates drafts using parsed NOFA requirements, Knowledge Base content, and proven narratives. The operator reviews, edits, and approves before submission.

**Flow:**
1. Research agents discover grant opportunities and store them in the opportunities table
2. NOFA Parser downloads and parses PDF/HTML funding announcements, extracting eligibility, requirements, deadlines, amounts, and key priorities
3. Eligibility Scoring Agent evaluates organizational fit (0-100 score with recommendation)
4. Operator reviews scored opportunities and clicks "Apply Now" on selected ones
5. Apply Now routes to the Draft Generator with the opportunity pre-selected
6. Draft Generator auto-loads: opportunity requirements (from NOFA parsing), relevant KB entries, proven narratives matching the funder category, and organizational profile data
7. AI generates a tailored draft with confidence scoring. Drafts below 70% confidence are flagged for additional review
8. Operator reviews, edits, and approves the draft
9. Application enters the pipeline (Drafting → Awaiting Documents → Ready for Review → Submitted)
10. Recursive Learning Agent analyzes outcomes (awarded/denied) to improve future drafts

**Key Components:**
- Draft Generator UI (`/draft-generator`)
- Narrative Drafting Agent (Agent 05)
- Budget Builder Agent (Agent 06)
- Compliance Check Agent (Agent 07)
- Review Agent (Agent 08)
- Final Assembly Agent (Agent 09)
- Recursive Learning Agent (Agent 10)

**Deployment:** Vercel serverless functions with maxDuration = 300 seconds. Adequate for single draft generation.

---

### Tool 2: AutoApply (Browser Automation Engine)

**Purpose:** Fully autonomous browser-based form submission on corporate giving pages, community engagement portals, donation request forms, and sponsorship application pages. This covers ALL non-grant corporate engagement: monetary donations, materials donations, land donations, vehicle donations, in-kind contributions, sponsorships, volunteer partnerships, and any other corporate giving program accessible via a web form.

**Risk Profile:** LOW. Corporate donation request forms are not legal documents. The worst outcome of an automated submission is a rejection or a "not interested" response. There is no regulatory compliance burden, no audit exposure, and no fraud liability. These are the equivalent of submitting a contact form — the corporation reviews and decides.

**Automation Level:** Fully autonomous. No human intervention required during execution. The operator's role is limited to reviewing results after completion.

**Flow:**
1. Research agents discover corporate funders with giving programs and store `giving_portal_url` in the funders table
2. Cold Outreach Agent extracts contact information for companies without giving pages
3. AutoApply Queue Manager populates the submission queue with all eligible funders that have giving portal URLs and have not been contacted
4. Operator can configure automation thresholds (optional): minimum company size, geographic scope, giving categories to target, exclusion list
5. AutoApply Worker (persistent process, NOT serverless) processes the queue:
   a. Playwright opens the `giving_portal_url`
   b. Claude AI analyzes the page HTML and identifies the form structure: field names, field types, required vs optional, file upload inputs, multi-step form navigation
   c. Claude AI generates a field mapping: Benavora KB field → form field (e.g., organization.mission_statement → "Describe your organization's mission")
   d. The field mapping is stored in `form_templates` table for reuse (one-time analysis per funder, reused on subsequent visits)
   e. Playwright fills all mapped fields using KB data, organization profile, and a tailored request description generated by Claude
   f. If file uploads are required, Playwright uploads documents from Supabase Storage (tax exemption letter, 990, program descriptions)
   g. Playwright captures a screenshot before submission
   h. Playwright submits the form
   i. Playwright captures the confirmation page/number
   j. The submission is logged in the `autoapply_submissions` table with status, screenshot URLs, confirmation data, and timestamp
   k. Worker moves to the next item in the queue
6. If a submission fails (CAPTCHA, site down, form changed, login required), the item is marked as failed with the error reason and screenshot. Failed items are surfaced in the dashboard for manual review.
7. Operator reviews results the next morning: successful submissions, failed submissions requiring manual action, and any confirmation responses received

**Automation Modes (configurable per organization):**

| Mode | Description | Human Involvement |
|------|-------------|-------------------|
| Manual | Operator selects individual funders and clicks "Submit" for each | Per-submission approval |
| Batch | Operator bulk-selects funders or uses filters, reviews the queue, clicks "Run All" | Batch approval before run |
| Scheduled | Queue auto-populates based on configured thresholds, runs on schedule (nightly/weekly) | Review after completion only |
| Full Autonomous | New funders auto-added to queue as discovered, submissions run continuously | Review after completion only |

**Queue Processing Capacity:**
- Single form submission: 60-120 seconds (page load + analysis + fill + submit + screenshot)
- Throughput: 30-60 submissions per hour
- Overnight run (8 hours): 240-480 submissions
- Weekly capacity: 1,600-3,360 submissions

**Error Handling:**
- CAPTCHA detected: screenshot captured, item marked as `captcha_blocked`, queued for manual submission or CAPTCHA-solving service integration (Phase 3+)
- Login/account required: item marked as `account_required`, portal login credentials stored in `funder_credentials` table (encrypted), Playwright uses stored credentials on retry
- Form structure changed: existing field mapping invalidated, Claude re-analyzes the page, new mapping stored
- Site down/timeout: item marked as `site_error`, auto-retried after configurable delay (default 24 hours)
- Duplicate submission detected: item skipped, marked as `already_submitted`

**Key Components:**
- AutoApply Queue Manager (new)
- AutoApply Worker (persistent process on Railway/VPS, NOT Vercel)
- Form Template Analyzer (Claude AI + Playwright)
- Form Filler Engine (Playwright)
- Screenshot Capture Service (Playwright)
- CAPTCHA Handler (Phase 3+: integration with solving service or human-in-loop)
- AutoApply Dashboard (`/autoapply` — queue status, submission history, failure review)

---

## 2. Database Schema Additions (AutoApply)

### form_templates
Stores reusable field mappings per funder giving portal. Created once per funder, reused on subsequent submissions.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| organization_id | uuid | FK → organizations |
| funder_id | uuid | FK → funders |
| portal_url | text | The giving portal URL this template maps |
| form_structure | jsonb | Raw form analysis: field names, types, required flags |
| field_mapping | jsonb | Map of Benavora fields → form fields |
| is_multi_step | boolean | Whether the form has multiple pages/steps |
| step_navigation | jsonb | Navigation instructions for multi-step forms |
| requires_login | boolean | Whether the portal requires account creation/login |
| requires_file_upload | boolean | Whether file uploads are part of the form |
| file_upload_fields | jsonb | Which files map to which upload inputs |
| last_verified_at | timestamptz | Last time the form structure was confirmed valid |
| last_used_at | timestamptz | Last successful submission using this template |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### autoapply_submissions
Logs every submission attempt with full audit trail.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| organization_id | uuid | FK → organizations |
| funder_id | uuid | FK → funders |
| form_template_id | uuid | FK → form_templates |
| status | text | queued, in_progress, submitted, failed, captcha_blocked, account_required, site_error, already_submitted |
| request_description | text | The AI-generated donation/sponsorship request text submitted |
| request_type | text | monetary, materials, land, vehicle, in_kind, sponsorship, volunteer, other |
| request_amount | numeric(12,2) | Dollar amount requested (if applicable) |
| pre_submit_screenshot_url | text | Supabase Storage URL of screenshot before submit |
| confirmation_screenshot_url | text | Supabase Storage URL of confirmation page |
| confirmation_number | text | Confirmation/reference number if provided |
| error_message | text | Error details if failed |
| error_screenshot_url | text | Screenshot at point of failure |
| retry_count | integer | Number of retry attempts |
| next_retry_at | timestamptz | Scheduled retry time for failed items |
| submitted_at | timestamptz | When the form was actually submitted |
| created_at | timestamptz | When the queue item was created |

### funder_credentials
Encrypted storage for portal login credentials (funders requiring account creation).

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| organization_id | uuid | FK → organizations |
| funder_id | uuid | FK → funders |
| portal_url | text | |
| username | text | Encrypted |
| password | text | Encrypted |
| requires_mfa | boolean | |
| mfa_method | text | email, sms, authenticator |
| last_login_at | timestamptz | |
| created_at | timestamptz | |

### submission_queue
The active queue that the AutoApply Worker processes.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| organization_id | uuid | FK → organizations |
| funder_id | uuid | FK → funders |
| priority | integer | Queue priority (lower = higher priority) |
| status | text | pending, processing, completed, failed, skipped |
| automation_mode | text | manual, batch, scheduled, full_auto |
| scheduled_for | timestamptz | When this item should be processed (for scheduled mode) |
| started_at | timestamptz | When processing began |
| completed_at | timestamptz | When processing finished |
| submission_id | uuid | FK → autoapply_submissions (created on completion) |
| created_at | timestamptz | |

---

## 3. Deployment Architecture

### Vercel (Existing)
- Next.js application (dashboard, API routes, auth)
- Draft Generator API routes (maxDuration 300s)
- NOFA Parser API routes (maxDuration 300s)
- Research agent API routes

### Dedicated Worker (NEW — Required for AutoApply)
- **Platform:** Railway, Render, or small VPS (NOT Vercel — serverless cannot run persistent Playwright sessions)
- **Runtime:** Node.js + Playwright with Chromium
- **Function:** Polls `submission_queue` table for pending items, processes them sequentially, writes results back
- **Scaling:** Single worker handles 30-60 submissions/hour. Multiple workers can process in parallel for higher throughput.
- **Monitoring:** Worker heartbeat logged to `worker_status` table. Dashboard shows worker health, queue depth, processing rate.
- **Cost:** Railway: ~$5-20/month for a persistent worker. VPS: ~$10-40/month.

### Supabase (Existing)
- All data storage, auth, RLS, Storage buckets
- Realtime subscriptions for queue status updates in the dashboard
- Edge Functions for lightweight scheduled tasks (queue population, retry scheduling)

---

## 4. Pricing Gate by Tool

| Tier | Grant Application Pipeline | AutoApply |
|------|---------------------------|-----------|
| Starter ($249/mo) | Yes — 10 AI drafts/month | No |
| Professional ($599/mo) | Yes — 50 AI drafts/month | No |
| Enterprise ($1,999/mo) | Yes — Unlimited AI drafts | Yes — Manual + Batch modes |
| Consultant ($2,999/mo + $299/client) | Yes — Unlimited AI drafts | Yes — All modes including Full Autonomous |

AutoApply is the highest-value differentiator. No competitor offers it. It is gated behind Enterprise and above.

---

## 5. Build Phases for AutoApply

### Phase 3A: Form Analysis Engine
- Playwright visits funder giving portal URLs
- Claude AI analyzes form HTML and generates field mappings
- Field mappings stored in `form_templates` table
- Manual trigger only (operator clicks "Analyze Form" on a funder)

### Phase 3B: Form Fill + Submit Engine
- Playwright fills forms using stored templates and KB data
- Screenshot capture before and after submission
- Single-submission flow (operator selects one funder, clicks "Submit via AutoApply")
- Results logged to `autoapply_submissions`

### Phase 3C: Queue + Batch Processing
- Submission queue table and queue manager
- Batch selection UI (select multiple funders, click "Queue All")
- Dedicated worker deployment on Railway
- Dashboard showing queue status, success/failure rates

### Phase 3D: Full Autonomous Mode
- Scheduled queue population from research agent discoveries
- Configurable thresholds (minimum company size, categories, geography)
- Continuous processing without operator intervention
- Nightly/weekly run scheduling
- Email/notification digest of results

### Phase 3E: Error Recovery + Intelligence
- CAPTCHA detection and handling (solving service integration or human queue)
- Account creation automation for portals requiring login
- Form change detection and auto-re-analysis
- Retry logic with exponential backoff
- Success rate analytics per funder category

---

## 6. Interaction Between Tools

The two tools share data but operate independently:

- An opportunity discovered by research agents may be relevant to BOTH tools: a corporation might offer a formal grant program (Tool 1) AND have a general giving portal (Tool 2)
- The funders table links both: `giving_portal_url` drives AutoApply, while opportunities linked via `funder_id` drive the Grant Application Pipeline
- The Knowledge Base serves both: Tool 1 uses it for narrative generation, Tool 2 uses it for form field population
- The CRM (funders + contacts) tracks all interactions regardless of which tool initiated them
- Outcomes from both tools feed into analytics and recursive learning

---

## Document Authority

This document is CANONICAL for the AutoApply architecture. Any prior references to "Browser Automation" in BLUEPRINT.md (Phase 3), AGENTS.md (Agent 16), or other governance docs that conflict with this document are superseded. Future FORGE prompts, Claude Code sessions, and architecture decisions regarding AutoApply MUST reference this document.
