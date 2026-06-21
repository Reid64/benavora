# BENAVORA — AutoApply Architecture Addendum: Advanced Capabilities

## Version: 2.0
## Date: June 20, 2026
## Status: CANONICAL — Extends AUTOAPPLY_ARCHITECTURE.md with advanced automation capabilities. All items below are approved for implementation.

---

## 1. Infrastructure Layer Enhancements

### 1A. Rotating Residential Proxy Network

**Priority:** CRITICAL — Required before scaling beyond ~50 submissions

**Problem:** All submissions originate from the same Railway IP. WAFs, Cloudflare, and corporate security appliances will flag and block a single IP making form submissions across dozens of corporate portals.

**Solution:**
- Integrate a residential proxy provider (BrightData, Smartproxy, or IPRoyal)
- Each submission routes through a unique residential IP matching the funder's geographic region
- Proxy selection logic: match proxy country/state to funder's headquarters location when possible
- Fallback chain: residential → datacenter → direct (if proxy fails)
- Cost: ~$10-15/GB, estimated $0.02-0.05 per submission (negligible)

**Implementation:**
```
worker/proxy-manager.ts
- Export class ProxyManager
- loadProxies(): fetch proxy list from provider API or config
- getProxy(region?: string): returns a proxy URL, preferring geographic match
- markFailed(proxyUrl: string): removes from active pool temporarily
- rotateForSubmission(): returns fresh proxy, never reuses within same batch
- Integration: StealthBrowser accepts proxy option in launch config
```

**Environment variables:** `PROXY_PROVIDER`, `PROXY_API_KEY`, `PROXY_POOL_SIZE`

**StealthBrowser modification:** Add proxy parameter to launch():
```typescript
async launch(options?: { proxy?: string }) {
  // Pass to Playwright: playwright.chromium.launch({ proxy: { server: options.proxy } })
}
```

### 1B. Multi-Browser Profile Isolation

**Priority:** HIGH

**Problem:** If Playwright reuses browser state between submissions, cookies and local storage from one portal can leak to another, creating detectable fingerprint continuity.

**Solution:**
- Each submission launches a completely fresh browser context (not just a new page)
- No persistent cookies, localStorage, or cache between submissions
- Randomized browser profile per submission: viewport size, timezone, locale, language headers
- Already partially implemented in StealthBrowser — verify full context isolation and add profile randomization

**Implementation:** Enhance StealthBrowser.launch() to create a fresh `browser.newContext()` per submission with randomized:
- viewport (from a pool of common resolutions)
- timezone (matching proxy region)
- locale and language
- geolocation (approximate, matching proxy)

---

## 2. Submission Intelligence Layer

### 2A. Request Amount Optimization

**Priority:** HIGH — Direct impact on conversion rate

**Problem:** Asking a foundation that typically gives $5K grants for $50K is an instant rejection. The FormFillerAgent currently fills a static amount from the org's KB.

**Solution:**
- Before filling the donation amount field, query `funder_giving_history` for the funder's historical giving range
- Calculate optimal ask: median grant amount ± 10% (or configurable multiplier)
- If no giving history: use category average from `intelligence_grantmaker_profiles`
- If no data at all: use org's default ask amount from KB

**Implementation:**
```
src/lib/autoapply/amount-optimizer.ts
- Export function getOptimalAskAmount(funderId: string, supabase: any): Promise<{
    recommended: number,
    min: number,
    max: number,
    confidence: 'high' | 'medium' | 'low',
    source: 'giving_history' | 'category_average' | 'default'
  }>
- Query funder_giving_history for median, min, max of past 3 years
- If insufficient data, fall back to category averages from grantmaker profiles
- FormFillerAgent calls this before filling amount fields
```

### 2B. Submission Content Personalization Per Funder

**Priority:** HIGH — Direct impact on conversion rate

**Problem:** The same mission pitch goes to every funder regardless of their priorities. A tech company cares about STEM, a grocery chain cares about food access, a bank cares about financial literacy.

**Solution:**
- Before filling text fields (mission description, project description, purpose of request), query funder intelligence for their priorities, language, and past funded programs
- Use Claude to rewrite the org's mission pitch tailored to the specific funder's stated interests
- Cache personalized pitches per funder category to avoid redundant API calls

**Implementation:**
```
src/lib/autoapply/pitch-personalizer.ts
- Export async function personalizePitch(params: {
    orgMission: string,
    orgPrograms: string[],
    funderName: string,
    funderPriorities: string[],
    funderLanguage: string,
    funderCategory: string,
    maxLength?: number
  }): Promise<string>
- Calls Claude: "Rewrite this nonprofit's mission description to align with {funder}'s 
  stated priorities: {priorities}. Use language similar to: {funderLanguage}. 
  Keep factual — do not fabricate programs or outcomes."
- Cache result in a pitch_cache table (funder_id + org_id → personalized_pitch, expires 30 days)
```

**Integration:** FormFillerAgent calls personalizePitch() before filling description/mission/purpose fields instead of using the raw KB mission statement.

### 2C. Request Profile System

**Priority:** CRITICAL — Core customization layer for multi-tenant platform

**Problem:** AutoApply assumes every submission is a monetary donation request. Nonprofits have diverse needs: cash, land, in-kind goods, volunteer hours, services, partnerships. Faith Foundation needs land donations for Cornerstone Communities AND cash for operations. A food bank needs produce donations AND cold storage equipment AND volunteer drivers. The current single-mode architecture cannot serve the diversity of nonprofit needs.

**Solution:**
Each organization defines multiple Request Profiles representing distinct needs. The submission engine selects the appropriate profile per funder based on funder capability matching, and personalizes the entire submission accordingly.

**Request Types:**
- `monetary` — Cash grants, donations, sponsorships (current default)
- `land` — Property donations, land grants, easements
- `in_kind` — Physical goods: equipment, materials, supplies, vehicles, food
- `volunteer` — Time commitments: skilled labor, mentoring, event support
- `service` — Pro bono professional services: legal, accounting, consulting, construction
- `partnership` — Co-branded programs, shared initiatives, joint ventures
- `sponsorship` — Event sponsorship, program sponsorship with branding
- `facility` — Office space, warehouse, event venues, storage

**Database Schema:**
```sql
CREATE TABLE IF NOT EXISTS request_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  request_type text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  needs_description text NOT NULL,
  specific_requirements jsonb DEFAULT '{}',
  target_funder_categories text[],
  target_funder_types text[],
  pitch_template text,
  form_field_overrides jsonb DEFAULT '{}',
  success_criteria text,
  min_value numeric(12,2),
  max_value numeric(12,2),
  value_unit text DEFAULT 'usd',
  geographic_requirements jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- Extended KB entries for non-monetary needs
CREATE TABLE IF NOT EXISTS kb_extended_needs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_profile_id uuid REFERENCES request_profiles(id) ON DELETE CASCADE,
  need_type text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz DEFAULT NOW()
);
```

**specific_requirements examples by type:**
- `land`: `{ "min_acreage": 5, "zoning": ["residential", "mixed-use"], "counties": ["Travis", "Williamson"], "access_requirements": "road frontage, utilities within 500ft", "development_plan": "Cornerstone Community: 20-unit affordable housing" }`
- `in_kind`: `{ "items": [{"name": "lumber", "quantity": "5000 board feet"}, {"name": "concrete", "quantity": "50 yards"}], "delivery_location": "123 Main St", "timeline": "Q1 2027" }`
- `volunteer`: `{ "skills_needed": ["carpentry", "electrical", "plumbing"], "hours_per_week": 20, "duration_months": 6, "schedule": "weekdays 8am-4pm" }`
- `service`: `{ "service_type": "legal", "scope": "501(c)(3) compliance review and property title work", "estimated_hours": 40 }`

**Funder Capability Matching:**
```
src/lib/autoapply/funder-matcher.ts
- Export function matchFunderToProfiles(funder: Funder, profiles: RequestProfile[]): MatchResult[]
- Matching logic by funder type:
  - Real estate companies → land, facility profiles
  - Construction companies → in_kind (materials), volunteer (labor), land
  - Law firms → service (legal) profiles
  - Foundations → monetary profiles (primary), in_kind (secondary)
  - Retail/wholesale → in_kind (goods) profiles
  - Corporate giving programs → monetary, sponsorship, volunteer
  - Churches/religious orgs → volunteer, monetary, facility
- Score each match: 0.0-1.0 based on alignment strength
- Return ranked list of (profile, score) pairs
- Only submit if score > 0.5 (configurable threshold)
```

**FormFillerAgent Enhancement:**
When filling forms, the agent checks the request_profile attached to the queue item:
- "Purpose of request" field: uses the profile's needs_description instead of generic mission
- "Amount" field: uses profile's min/max value range (or amount-optimizer for monetary)
- "Description" field: uses profile-specific pitch_template, personalized for the funder
- form_field_overrides: per-profile mapping that overrides default KB-to-form-field mapping

**Auto-Queue Populator Enhancement:**
When populating the queue:
1. Load all active request_profiles for the org
2. For each eligible funder, run funder-matcher to find the best profile match
3. Tag the queue item with request_profile_id
4. If no profile matches above threshold, skip the funder
5. A single funder can be queued multiple times with different profiles (e.g., ask a construction company for both materials AND volunteer labor) — dedup per (funder_id, request_profile_id) pair

**Request Profile Management UI:**
```
/autoapply/profiles — Dashboard page
- List of all request profiles with: name, type, priority, active toggle, target categories
- "Create Profile" wizard:
  Step 1: Select request type from dropdown
  Step 2: Fill type-specific needs form (dynamic fields based on type)
  Step 3: Set targeting criteria (funder categories, geographic scope)
  Step 4: Customize pitch template (pre-filled from type defaults, editable)
  Step 5: Review and activate
- Edit existing profiles
- Duplicate profile (for creating variations)
- Archive/deactivate profiles
- Per-profile analytics: submissions using this profile, success rate, total value received
```

**Example: Faith Foundation Configuration:**
```
Profile 1: "Operating Funds"
  type: monetary, needs: "General operating support for faith-based housing programs"
  target: [private_foundation, corporate_giving, community_foundation]
  amount: $10,000 - $100,000

Profile 2: "Cornerstone Land Acquisition"  
  type: land, needs: "5+ acre parcels for Cornerstone Community affordable housing development"
  target: [real_estate, construction, government, land_trust]
  requirements: { min_acreage: 5, zoning: [residential, mixed-use], counties: [specific list] }
  pitch_template: "Faith Foundation is developing Cornerstone Communities — permanently affordable housing..."

Profile 3: "Construction Materials"
  type: in_kind, needs: "Building materials for 20-unit affordable housing construction"
  target: [construction, building_supply, hardware]
  requirements: { items: [lumber, concrete, roofing, plumbing, electrical], timeline: "2027" }

Profile 4: "Skilled Volunteer Labor"
  type: volunteer, needs: "Licensed contractors and skilled tradespeople for housing builds"
  target: [construction, trade_unions, churches, community_groups]
  requirements: { skills: [carpentry, electrical, plumbing], hours: 20/week, duration: 6 months }
```

### 2D. Batch Intelligence Ordering

**Priority:** MEDIUM-HIGH

**Problem:** Queue processes in FIFO/priority order. If the worker crashes at item 30 of 50, the remaining 20 were random — not the highest-value ones.

**Solution:**
- Before processing a batch, score all pending items using the Success Probability Agent (Agent 22, already architected)
- Sort queue by probability descending — highest-likelihood funders process first
- If the worker crashes or runs out of time, the most valuable submissions were already completed

**Implementation:**
- In queue-processor.ts, before the main loop, run a scoring pass:
  ```
  SELECT * FROM submission_queue WHERE status = 'pending' ORDER BY created_at
  → Score each with success_probability_agent
  → UPDATE priority = (100 - probability_score) so highest probability gets lowest priority number (processed first)
  ```
- Run scoring pass once at worker startup and after each batch replenishment
- Skip scoring if < 5 items in queue (not worth the API cost)

---

## 3. Multi-Channel Submission

### 3A. Email-Based Donation Requests

**Priority:** HIGH — Doubles the addressable funder pool

**Problem:** The current system only submits via web forms. Many foundations and corporate giving programs accept donation requests via email but have no web portal. These funders are currently unreachable.

**Solution:**
- Add an `email` submission channel alongside the existing `web_form` channel
- For funders with an email address but no `giving_portal_url`, generate a personalized donation request email and send via Resend API
- Email uses the same personalized pitch from 2B, formatted as a professional letter of inquiry

**Implementation:**
```
src/lib/autoapply/email-submitter.ts
- Export async function submitViaEmail(params: {
    funderEmail: string,
    funderName: string,
    organizationName: string,
    personalizedPitch: string,
    askAmount: number,
    contactName?: string,
    attachments?: { name: string, content: Buffer }[]
  }): Promise<{ messageId: string, status: string }>
- Uses Resend API to send professional donation request email
- Subject: "Grant/Donation Request from {orgName} — {programName}"
- Body: formatted letter of inquiry with: greeting, mission overview, specific request, 
  program description, amount, contact information
- Tracks in autoapply_submissions with submission_channel = 'email'
```

**Queue processor modification:**
- Check funder: if `giving_portal_url` exists → web_form channel
- If only `email` exists (from funder enrichment) → email channel
- If both exist → prefer web_form (higher proof of submission)

**New field on funders table:** `contact_email` (already may exist from enrichment scripts)

### 3B. Submission Channel Analytics

Track conversion rates per channel to optimize the mix:
- Web form submission rate, confirmation rate, response rate
- Email open rate, reply rate, conversion rate
- Per-funder channel preference (some respond better to email, others to web forms)

---

## 4. Portal & Funder Monitoring

### 4A. Portal Health Monitoring

**Priority:** MEDIUM — Prevents wasted submissions

**Problem:** Giving portal URLs go stale. Sites get redesigned, URLs change, portals shut down. Submitting to dead portals wastes worker time and creates noise in failure metrics.

**Solution:**
- Weekly background job that HEAD-requests all `giving_portal_url` values
- Classify responses: active (200), redirect (301/302 — update URL), dead (404/500/timeout), requires_login (401/403)
- Flag portals that changed status since last check
- Remove dead portals from auto-queue eligibility

**Implementation:**
```
src/scripts/check-portal-health.ts (standalone, runs on secondary machine)
- For each funder with giving_portal_url:
  - HEAD request with 10-second timeout
  - Record status_code, response_time, redirect_url
  - Update funders table: portal_status, portal_last_checked_at, portal_response_time
- Run weekly: npx tsx src/scripts/check-portal-health.ts

worker/portal-health.ts (integrated into worker)
- Before processing a queue item, check portal_last_checked_at
- If > 7 days, do a quick health check before launching full browser
- If dead, skip and mark queue item as 'portal_dead'
```

**New columns on funders table:**
```sql
ALTER TABLE funders ADD COLUMN IF NOT EXISTS portal_status text DEFAULT 'unknown';
ALTER TABLE funders ADD COLUMN IF NOT EXISTS portal_last_checked_at timestamptz;
ALTER TABLE funders ADD COLUMN IF NOT EXISTS portal_response_time_ms integer;
```

### 4B. Form Change Detection

**Priority:** MEDIUM

Already partially covered in 3E architecture. Enhanced version:
- Store a structural hash of the form (sorted field names + types) in form_templates
- On each submission, compare current form hash to stored hash
- If changed: auto-re-analyze, update template, log the change
- If fields were removed that previously held required data: flag for human review
- Track form change frequency per funder to predict when re-analysis is needed

---

## 5. Success Verification & Follow-Up

### 5A. Confirmation Email Monitoring

**Priority:** MEDIUM-HIGH — Connects to Phase 4 Gmail integration

**Problem:** After web form submission, the only proof is a screenshot. Many portals send confirmation emails that provide stronger verification and tracking numbers.

**Solution:**
- Dedicated email address for AutoApply submissions (e.g., apply@benavora.com)
- Use this email in all form submissions' email field
- Gmail API (Phase 4) monitors this inbox
- Match incoming emails to `autoapply_submissions` by: funder name, timing, confirmation keywords
- Update submission record with: confirmation_email_received, confirmation_number (extracted), response_content

**Implementation:**
```
src/lib/autoapply/confirmation-monitor.ts
- Export async function checkForConfirmations(supabase: any, gmail: any): Promise<void>
- Query recent autoapply_submissions (last 48 hours) without confirmation_email_received
- Search Gmail inbox for emails from funder domains or containing org name
- Match by: sender domain matches funder website domain, received within 24h of submission
- Extract confirmation number via Claude: "Extract any confirmation number, reference ID, 
  or tracking number from this email."
- Update autoapply_submissions: confirmation_email_received = true, confirmation_details = extracted data
```

### 5B. Automated Follow-Up Sequences

**Priority:** MEDIUM — Significantly increases conversion

**Problem:** Most corporate giving programs don't respond immediately. A polite follow-up 2-3 weeks after submission significantly increases the chance of a response.

**Solution:**
- After submission, auto-schedule a follow-up sequence:
  - Day 14: "Following up on our donation request submitted on {date}..."
  - Day 30: "Checking in regarding our request — would love to discuss our {program}..."
  - Day 60: Final follow-up with updated impact data
- Skip follow-up if: confirmation received, rejection received, or funder responded
- Send via email (Resend) or via the portal if it supports messaging

**Implementation:**
```
src/lib/autoapply/follow-up-scheduler.ts
- After successful submission, insert rows into follow_up_sequences table:
  - submission_id, scheduled_at (14/30/60 days), template_type, status = 'pending'
- Cron job processes due follow-ups daily
- Each follow-up checks: has funder responded? If yes, cancel remaining sequence.
- Personalize follow-up content using funder intelligence + original submission context
```

**New table:**
```sql
CREATE TABLE IF NOT EXISTS autoapply_follow_ups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid REFERENCES autoapply_submissions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  funder_id uuid NOT NULL,
  sequence_number integer NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  template_type text NOT NULL,
  content text,
  response_received boolean DEFAULT false,
  created_at timestamptz DEFAULT NOW()
);
```

---

## 6. Timing & Compliance

### 6A. Seasonal Timing Optimization

**Priority:** MEDIUM

**Problem:** Uniform submission timing ignores funder budget cycles. Q4 submissions to corporate giving programs convert higher (giving season + budget spend-down). Government fiscal year starts (October) affect state/federal programs.

**Solution:**
- Tag funders with fiscal year information (from 990 data: tax_period field)
- Identify optimal submission windows per funder type:
  - Corporate: Q4 (Oct-Dec) highest conversion, Q1 (Jan-Mar) new budget
  - Government: post-fiscal-year-start (Oct for federal, varies for state)
  - Foundation: varies by board meeting schedule (quarterly)
- Score each queue item with a timing_boost factor
- Cron scheduler weights submissions toward optimal windows

**Implementation:**
```
src/lib/autoapply/timing-optimizer.ts
- Export function getTimingScore(funderType: string, funderFiscalYear?: string): number
  Returns 0.0 to 1.0 — how optimal is NOW for submitting to this funder type
- Queue processor multiplies priority by timing score to reorder
- Dashboard shows "Optimal submission window" indicator per funder
```

### 6B. Charitable Solicitation Compliance Guard

**Priority:** MEDIUM — Legal risk mitigation

**Problem:** Many US states require nonprofits to register before soliciting donations. Submitting donation requests in states where the org isn't registered could create legal exposure.

**Solution:**
- Maintain a table of states where the organization is registered to solicit
- Before queuing a funder, check if the org is registered in the funder's state
- If not registered: flag as 'compliance_hold', do not auto-submit, surface for human review

**Implementation:**
```sql
CREATE TABLE IF NOT EXISTS solicitation_registrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  state text NOT NULL,
  registration_number text,
  registered_at timestamptz,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT NOW()
);
```

- Auto-queue populator checks: funder state IN (org's registered states)
- If not registered: skip with reason 'not_registered_in_state'
- Settings UI: manage registered states

---

## 7. Analytics & Optimization

### 7A. A/B Testing of Submission Approaches

**Priority:** MEDIUM — Long-term conversion optimization

**Problem:** No systematic way to know which pitch style, ask amount range, or program emphasis converts best per funder category.

**Solution:**
- For each funder category, maintain 2-3 pitch variants
- Randomly assign variants to submissions within the same category
- Track conversion rates per variant
- After statistical significance (50+ submissions per variant), promote the winner
- Re-generate new challenger variants periodically

**Implementation:**
```
src/lib/autoapply/ab-testing.ts
- Export function getSubmissionVariant(funderCategory: string): { variantId: string, pitchStyle: string, emphasis: string }
- Track in autoapply_submissions: variant_id field
- Analytics query: conversion rate GROUP BY variant_id, funder_category
- Dashboard: A/B test results panel showing win rates per variant
```

### 7B. Funder Response Time Analytics

**Priority:** LOW-MEDIUM

- Track time between submission and first response per funder
- Predict response windows for funders with history
- Surface "Expected response in X days" on submission detail
- Alert if a funder's response time exceeds their historical pattern (may indicate the request was lost)

### 7C. Success Rate Dashboards

Enhanced analytics beyond the existing submission history:
- Conversion funnel: submitted → confirmed → responded → funded
- Per-category conversion rates with trend lines
- Per-channel (web form vs email) comparison
- Geographic heat map of successful submissions
- ROI calculator: total funded amount / total submission cost (time + proxy + API)

---

## 8. Build Schedule Integration

These enhancements integrate into the existing phase structure:

**Phase 3E (Error Recovery + Advanced Capabilities):**
- CAPTCHA detection and solving (existing plan)
- Account creation automation (existing plan)
- Credential storage (existing plan)
- Proxy rotation network (NEW — 1A)
- Browser profile isolation (NEW — 1B)
- Portal health monitoring (NEW — 4A)
- Form change detection enhancement (NEW — 4B)
- Screenshot audit trail (existing plan)
- Human review queue (existing plan)
- Charitable solicitation compliance guard (NEW — 6B)

**Phase 3F (Submission Intelligence — NEW PHASE):**
- Request Profile System — tables, management UI, profile wizard (NEW — 2C)
- Funder capability matching engine (NEW — 2C)
- FormFillerAgent request-type awareness (NEW — 2C)
- Auto-queue populator profile matching (NEW — 2C)
- Extended KB entries for non-monetary needs (NEW — 2C)
- Request amount optimization (2A)
- Submission content personalization per funder AND per request type (2B)
- Batch intelligence ordering (2D)
- Pitch cache table and management
- Timing optimization (6A)

**Phase 3G (Multi-Channel & Follow-Up — NEW PHASE):**
- Email-based donation requests (3A)
- Submission channel analytics (3B)
- Confirmation email monitoring (5A)
- Automated follow-up sequences (5B)
- Follow-up cron job and management UI

**Phase 3H (Analytics & Optimization — NEW PHASE):**
- A/B testing framework (7A)
- Funder response time analytics (7B)
- Success rate dashboards (7C)
- Conversion funnel visualization
- ROI calculator

---

## Document Authority

This addendum extends AUTOAPPLY_ARCHITECTURE.md. All items are approved for implementation in the specified phase order. Phase 3E incorporates both the original error recovery plan and new infrastructure requirements. Phases 3F, 3G, and 3H are new phases that follow 3E in build order.
