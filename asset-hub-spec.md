# Asset Hub — Feature Specification

**Document version:** 1.0
**Effective date:** 2026-05-20
**Status:** Phase 1 — REQUIRED before scaling client base beyond first 3 clients
**Owner:** Operator
**Repository path:** `docs/features/asset-hub-spec.md`
**Related governance:** Client Intelligence Intake Master Document, Service Hub Pages Architecture Specification, A-46 Directory Registration Agent Specification

---

## Purpose

The Asset Hub is the client-facing self-service portal where clients asynchronously upload documents, fill structured forms, and complete the data collection that drives every Tarritrix platform output. Without it, onboarding is a synchronous bottleneck: every piece of client data has to be captured on phone calls, email threads, or shared Google Drives — none of which scale, and none of which integrate with the platform.

The Asset Hub solves three problems simultaneously:

1. **Data collection scalability** — Clients can complete intake on their own schedule rather than tying up operator time on 4-hour onboarding calls
2. **Data quality and verification** — Structured uploads with required fields prevent the "we'll send that later" black hole that kills most agency onboarding
3. **Evidence-tier unlock automation** — As clients upload more proof, the platform automatically advances them through evidence tiers without operator intervention

This is a Phase 1 feature. Without it, the operator becomes the bottleneck for every client's data collection — and that bottleneck breaks at the third or fourth concurrent client. Building this in Phase 1 is non-negotiable for scaling.

---

## Architecture overview

### Location and access

**URL:** `/portal/assets` (within the client portal)
**Access:** Authenticated client users only, scoped to their own client account via RLS
**Permissions:** Multiple client users per client account possible (per Client Intelligence Intake assumptions); all users can view all assets, upload permissions can be per-user or all-or-nothing per operator policy

### Mobile-first requirement

Contractors will use the Asset Hub from their phones in the field. They will upload job photos from the truck, certifications from the office, and case study photos from their phone gallery. Desktop-only design dies in this audience.

Every upload flow, every form, and every navigation pattern must work on a 375-pixel-wide mobile viewport. Tablet and desktop layouts are progressive enhancements over the mobile baseline.

### Integration with Client Intelligence Intake

The Asset Hub's structure maps directly to the 18 sections of the Client Intelligence Intake Master Document. Each section in the intake becomes a category in the Asset Hub. The Asset Hub UI presents these categories as cards on the main page, each showing completion status, required vs optional, and estimated time to complete.

This 1:1 mapping is deliberate. The operator's sales call worksheet, the onboarding wizard, and the Asset Hub all reference the same canonical intake structure. Clients and operators see the same categories with the same language.

---

## Page structure

### Main Asset Hub page (`/portal/assets`)

**Top section: Overall progress**
- Visual progress bar showing overall completeness percentage
- Current evidence tier (Tier 1, Tier 2, or Tier 3 unlocked)
- Next tier requirements (e.g., "Upload 30 more job photos to unlock Tier 3")
- Estimated time to next tier unlock

**Middle section: Category cards**
- One card per Client Intelligence Intake section (18 cards)
- Each card shows: section name, brief description, completion percentage, status indicator (not started, in progress, complete), estimated time remaining
- Cards sorted by tier requirement (Tier 1 cards first, then Tier 2, then Tier 3)
- Within each tier, sorted by completion status (incomplete first)
- Filter and search to find specific categories

**Bottom section: Recent activity**
- Last 10 uploads with timestamps
- Last 5 operator notes
- Pending operator reviews
- Action items requiring client attention

### Per-category pages (`/portal/assets/[category-slug]`)

Each category has its own page with the structured forms and upload fields specific to that intake section. The forms are dynamic based on what data is required.

**Category page structure:**
- Header: category name, why this matters (1-2 sentence rationale), tier requirement
- Form section: structured fields per the intake spec (text, dropdown, checkbox, multi-select, etc.)
- Upload section: file upload areas with type requirements clearly stated
- Notes section: free-text field for client to add context
- Save and continue / Save for later actions
- Progress indicator: how many fields complete in this category

---

## Category-by-category specifications

### Category 1: Business Identity

**Tier:** 1 (Foundational, required for Tier 1 unlock)
**Estimated time:** 15-20 minutes
**Mobile-friendly:** Yes (text-heavy, minimal uploads)

**Form fields:**
- Legal business name (text, required)
- DBA name (text, optional)
- Business entity type (dropdown: LLC, S-Corp, C-Corp, Sole Proprietorship, Partnership, Other)
- State of incorporation (dropdown of US states)
- EIN (text with validation, optional but encouraged)
- State business license number (text, required)
- State license expiration date (date picker)
- Specialty licenses (multi-row: license type, number, expiration)
- Year founded (number, required)
- Number of employees (number, required)
- Primary business phone (phone format with validation, required)
- Business email (email validation, required)
- Owner / principal name (text, required)
- Owner email (email validation, required)
- Owner direct phone (phone format, optional)
- Primary physical business address (address autocomplete via Google Places API)
- Hours of operation (structured: per-day open/close times, with "24/7" and "By appointment" options)
- After-hours emergency phone (phone format, optional)

**Upload section:**
- State business license (PDF, max 10MB)
- Articles of incorporation (PDF, max 10MB, optional)
- Specialty license documents (PDF, max 10MB each, multiple)
- W-9 form (PDF, max 10MB, optional for some integrations)

**Validation:**
- Required fields enforced before category can be marked complete
- Phone numbers normalized to E.164 format on save
- Address validated against Google Places API
- License numbers checked against state databases where possible (Phase 1.5 enhancement)

### Category 2: Service Portfolio

**Tier:** 1
**Estimated time:** 20-30 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Add Service button (creates new service row)
- Per-service fields:
  - Service name (text, required)
  - Service category (dropdown: roofing, restoration, PDR, gutters, siding, windows, other)
  - Is storm-driven (checkbox)
  - Is insurance-claim-driven (checkbox)
  - Is seasonal (checkbox; if yes, peak months multi-select)
  - Priority for lead generation (1-10 slider)
  - Pricing model (dropdown: flat-rate, time-and-materials, insurance-billed, free-estimate, varies)
  - Workmanship warranty term (text)
  - Service-specific certifications required (text, optional)
  - Service description (textarea, used for hub page content)
  - Service NOT offered notes (textarea, optional)

**Specialty fields:**
- Highest-margin services (multi-select from added services)
- Lowest-margin / loss-leader services (multi-select from added services)
- Service-specific keywords client wants to target (multi-input, optional)

**Validation:**
- Minimum 1 service required for Tier 1 unlock
- Minimum 3 services for Tier 2 unlock (enables service hub page generation)

### Category 3: Geographic Coverage

**Tier:** 1
**Estimated time:** 30-45 minutes
**Mobile-friendly:** Partial (city list may be tedious on mobile; allow CSV upload alternative)

**Form structure:**
- Primary metro area (DMA dropdown)
- Primary city (text with autocomplete)
- Service area definition method (choice: list cities individually, define radius, upload polygon)

**If list cities individually:**
- Add cities and ZIP codes (multi-input or CSV upload)
- Each city: name, state, primary or secondary, ZIP codes served

**If define radius:**
- Radius from primary location (number in miles)
- Cities within radius auto-populated from cities table

**If upload polygon:**
- Upload KML or GeoJSON file with service area boundary
- Cities within polygon auto-populated

**Additional fields:**
- Expansion target cities (multi-input, separate from current service area)
- Service radius limits (number, optional)
- Cities NOT serviced (multi-input, optional)
- Storm corridors and microclimates (multi-row: name, description, optional polygon upload)
- Local landmarks and neighborhoods (per-city: multi-input of notable areas)
- Drive time pricing policy (textarea, optional)

**Validation:**
- Minimum 1 city required for Tier 1 unlock
- Minimum 5 cities for Tier 2 unlock
- Minimum 20 cities for Tier 3 unlock

### Category 4: Certifications and Credentials

**Tier:** 1 partial, Tier 2 expansion
**Estimated time:** 20-30 minutes initially, +5 minutes per addition
**Mobile-friendly:** Yes for forms; uploads work on mobile but easier on desktop

**Form structure:**
- Add Certification button (creates new certification row)
- Per-certification fields:
  - Certification type (dropdown with common options + Other)
  - Issuing organization (text)
  - Certification number (text)
  - Date earned (date picker)
  - Expiration date (date picker, optional for non-expiring)
  - Certified individuals (text, names of staff holding cert)

**Common certification dropdown options:**
- IICRC
- NRCA
- PDR Nation
- NARI
- HAAG Certified Inspector
- RCI / IIBEC
- OSHA 10 Hour
- OSHA 30 Hour
- BBB Accreditation
- Other (text input)

**Insurance and bonding section:**
- General liability insurance carrier (text)
- General liability coverage amount (currency)
- Workers comp carrier (text)
- Workers comp coverage amount (currency)
- Bond amount (currency, optional)
- Bond carrier (text, optional)

**Awards section:**
- Add Award button
- Per-award: award name, issuing organization, year received, URL if applicable, document upload

**Upload section:**
- Certification documents (PDF, multiple, organized by certification)
- Insurance certificates (PDF)
- Award certificates (PDF or images)
- Bond documents (PDF)

### Category 5: Insurance Carrier Relationships

**Tier:** 2 (Authority)
**Estimated time:** 15-30 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Add Carrier Relationship button
- Per-carrier fields:
  - Carrier name (dropdown of major carriers + Other)
  - Relationship status (dropdown: Approved Vendor, Preferred Contractor, Network Member, Tier 1 Vendor, Tier 2 Vendor, Other)
  - Program name (text, e.g., "State Farm Premier Service Program")
  - Date approved (date picker)
  - Approval expiration / renewal date (date picker, optional)
  - Approval letter / documentation (PDF upload)
  - Notes (textarea)

**Common carrier dropdown options:**
- State Farm
- Allstate
- USAA
- Liberty Mutual / Safeco
- Travelers
- Nationwide
- Erie Insurance
- Farmers
- Geico
- Progressive
- American Family
- Auto-Owners
- Other (text input)

**Adjuster relationships section:**
- Independent adjuster relationships (multi-row: name, firm, contact info, notes)
- Public adjuster relationships (same structure, with sensitivity warning)

**Xactimate experience:**
- Years using Xactimate (number)
- Primary Xactimate user(s) on staff (text)
- Xactimate proficiency level (dropdown: Beginner, Intermediate, Advanced, Expert)
- Average scopes written per month (number)
- Xactimate proficiency certification (PDF upload, optional)

**TPA and supplier relationships:**
- TPAs the client works with (multi-input, optional)
- Roofing wholesaler relationships (multi-row: wholesaler name, account level, notes)

**Insurance work volume:**
- Percentage of revenue from insurance-billed work (slider 0-100%)
- Average claim cycle time in days (number)

### Category 6: Manufacturer Partnerships

**Tier:** 1 partial, Tier 2 expansion
**Estimated time:** 15-20 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Add Manufacturer Partnership button
- Per-partnership fields:
  - Manufacturer name (dropdown of major manufacturers + Other)
  - Certification level (dropdown specific to each manufacturer)
  - Certification ID / contractor ID (text)
  - Date earned (date picker)
  - Renewal date (date picker)
  - Certification documentation (PDF upload)
  - Manufacturer-provided logo files (file upload, vector preferred)
  - Manufacturer-provided badge images (file upload)
  - Listed on manufacturer partner directory (yes/no)
  - Manufacturer partner page URL (text, if listed)

**Manufacturer dropdown with certification levels:**
- GAF (Master Elite, Certified, Authorized)
- Owens Corning (Platinum Preferred, Preferred, Authorized)
- CertainTeed (SELECT ShingleMaster, ShingleMaster, Quality Master)
- Atlas (Pro Plus, Pro)
- IKO (Shield Pro Plus)
- Malarkey (Emerald Premium)
- TAMKO (Pro Certified)
- James Hardie (Elite Preferred, Preferred, Remodeler)
- LP SmartSide (Certified Contractor)
- LeafGuard
- LeafFilter
- Gutter Helmet
- Dent Wizard
- Dent Pro
- KECO Body Repair Products
- Other (text input)

**Validation:**
- Partnerships verified manually by operator before publication on hub pages
- Logo files validated for proper licensing before use

### Category 7: Trade and Industry Affiliations

**Tier:** 2
**Estimated time:** 10-15 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Add Affiliation button
- Per-affiliation fields:
  - Organization name (text)
  - Affiliation type (dropdown: National Trade Association, State Trade Association, Local Chamber, Referral Network, Veteran Business, Minority Business, Other)
  - Member ID (text)
  - Member since (date picker)
  - Member directory URL (text, optional)
  - Membership document (PDF upload, optional)

**Common organization dropdown:**
- NRCA
- NARI
- PDR Nation
- RCAT
- SBCA
- BNI
- Other (text input)

**Special affiliations section:**
- Veteran business certifications (VBE, VOSB, SDVOSB) — multi-select with date and documentation
- Minority/Women-owned business certifications (MBE, WBE, DBE) — multi-select with date and documentation

**Trade publications section:**
- Publications subscribed to (multi-input)
- Publications featured in (multi-row: publication name, article title, URL, date, PDF upload of article)

**Trade conferences section:**
- Conferences attended (multi-row: conference name, year, role: attendee/speaker/exhibitor)

### Category 8: Existing Digital Footprint

**Tier:** 1
**Estimated time:** 15-25 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Primary website URL (text with URL validation)
- Domain registration date (date picker, optional, can be auto-detected)
- Current hosting platform (dropdown: WordPress, Squarespace, Wix, Webflow, custom, other)
- Current CMS access details (text, encrypted storage)
- Existing pages count (number, optional)

**Google Business Profile section:**
- GBP URL (text, validation)
- GBP verification status (dropdown: Verified, Pending, Unclaimed, Unknown)
- GBP primary category (text)
- GBP secondary categories (multi-input)

**Social media section:**
- Add Social Account button
- Per-account fields:
  - Platform (dropdown: Facebook, Instagram, YouTube, LinkedIn, TikTok, Nextdoor, Twitter/X, Other)
  - Handle / URL (text)
  - Approximate followers (number)
  - Posting frequency (dropdown: Daily, Weekly, Monthly, Sporadic, Inactive)

**Email marketing section:**
- Email platform (dropdown: Mailchimp, Constant Contact, ActiveCampaign, Klaviyo, HubSpot, Other, None)
- List size (number)
- Send frequency (dropdown)

**Current SEO vendor section:**
- Existing SEO vendor (text, optional)
- Relationship status (dropdown: Active, Transitioning, Ended, Never used)
- Notes (textarea)

**Current advertising section:**
- Active Google Ads account (yes/no)
- Active Facebook Ads account (yes/no)
- Approximate monthly ad spend (currency, optional)

**Review platforms section:**
- Add Review Platform button
- Per-platform: platform name, profile URL, current review count, current rating

### Category 9: Existing Backlinks

**Tier:** 2
**Estimated time:** 15-30 minutes
**Mobile-friendly:** Partial (large CSV uploads easier on desktop)

**Form structure:**
- Backlink data entry method (choice: paste URL list, upload CSV, neither)

**Paste URL list option:**
- Large textarea for one URL per line
- Auto-parsing and validation
- Tagging interface: for each URL, optional tags (manufacturer page, chamber, press, charity, other)

**CSV upload option:**
- File upload (CSV, max 5MB)
- Expected columns: URL, anchor text (optional), context notes (optional)
- Preview before commit
- Mapping interface if columns don't match template

**Press and media section:**
- Add Press Mention button
- Per-mention: publication, article title, URL (even if no link to site), date, notes

**Industry features section:**
- Add Industry Feature button
- Per-feature: publication or platform, type (article, podcast, video, interview), URL, date, notes

**Documents:**
- Upload PR clipping files (PDF, images)
- Upload existing SEO reports if client has them

### Category 10: Case Studies, Testimonials, and Reviews

**Tier:** 2
**Estimated time:** 30-60 minutes initially, ongoing additions
**Mobile-friendly:** Forms yes; photo uploads work on mobile but easier on desktop for organization

**Form structure:**
- Add Case Study button
- Per-case-study fields:
  - Project location (city, state, neighborhood)
  - Project type (dropdown of services from Category 2)
  - Project scope (textarea)
  - Project timeline (start date, completion date)
  - Materials used (multi-input)
  - Outcome description (textarea)
  - Insurance settlement amount (currency, optional)
  - Customer testimonial quote (textarea)
  - Customer permission documented (yes/no)
  - Customer name to use (text, optional, can use "John D." for privacy)

**Per-case-study upload section:**
- Before photos (multi-upload with EXIF preservation)
- After photos (multi-upload with EXIF preservation)
- In-progress photos (multi-upload, optional)
- Video walkthrough (video upload, optional, max 500MB)
- Customer permission documentation (PDF or image upload)

**Aggregate metrics section:**
- Total jobs completed lifetime (number)
- Average customer satisfaction rating (number 1-5)
- NPS score (number, optional)
- Repeat customer percentage (slider 0-100%)

**Notable testimonials section:**
- Add Testimonial button
- Per-testimonial: customer name, location, quote, permission status, date, photo upload (optional)

**Notable clients section:**
- Add Notable Client button (only with permission)
- Per-client: client name, project context, permission documented, photos

### Category 11: Job Photo Library

**Tier:** 2-3
**Estimated time:** Variable (1-5 hours for initial bulk upload)
**Mobile-friendly:** Critical — most photos come from phone

**Upload interface:**
- Bulk upload area (drag-and-drop or select multiple)
- Per-photo metadata form appears for each uploaded photo:
  - Job location (text or auto-detected from EXIF GPS)
  - Service performed (dropdown from Category 2)
  - Date of job (date picker or auto-detected from EXIF)
  - Storm event reference (dropdown of storms in service area, optional)
  - Photo type (dropdown: before, after, in-progress, damage closeup, detail, team, equipment, vehicle)
  - Pair with before/after match (selector to link related photos)
  - Customer permission status (yes/no)

**EXIF handling:**
- Automatic EXIF extraction on upload
- GPS coordinates displayed and verifiable against service area
- Timestamp verification
- Camera fingerprint logged (used by A-22)
- Warning if EXIF stripped (instructs client on how to preserve EXIF when transferring photos)

**Bulk metadata tools:**
- Batch tag photos by date range, service, or location
- Bulk assign to case studies
- Bulk update permission status

**Specialty uploads:**
- Drone footage (video upload, max 1GB)
- Time-lapse videos (video upload, max 1GB)
- Equipment and vehicle shots
- Team photos

**Validation:**
- Tier 1 requires 10+ photos with EXIF intact
- Tier 2 requires 50+ photos with geographic distribution
- Tier 3 requires 200+ photos with multiple service types covered

### Category 12: Press and PR History

**Tier:** 3
**Estimated time:** 15-30 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Add Press Item button
- Per-item fields:
  - Publication or outlet (text)
  - Type (dropdown: news article, magazine feature, blog post, podcast, video interview, TV appearance, radio appearance)
  - Article title or segment title (text)
  - URL (text, optional)
  - Date (date picker)
  - Featured individual (text, e.g., "Owner John Smith")
  - Brief description (textarea)
  - Document upload (PDF or screenshot, optional)

**Journalist relationships section:**
- Add Journalist button
- Per-journalist fields:
  - Name (text)
  - Publication (text)
  - Beat / topics covered (text)
  - Contact info (email, phone, optional)
  - Relationship context (textarea)
  - Last contact date (date picker, optional)

**Speaking engagements section:**
- Add Engagement button
- Per-engagement fields:
  - Event name (text)
  - Event type (dropdown: conference, panel, podcast, webinar, local meeting)
  - Date (date picker)
  - Topic (text)
  - URL if recorded (text, optional)

**Awards from media section:**
- Add Award button
- Per-award fields:
  - Award name (text, e.g., "Best of [City] 2024")
  - Issuing publication (text)
  - Year (year picker)
  - URL (text)
  - Document upload (PDF or image)

### Category 13: Community and Charity Involvement

**Tier:** 3
**Estimated time:** 10-20 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Add Involvement button
- Per-involvement fields:
  - Organization or program name (text)
  - Type (dropdown: charity partnership, school sponsorship, event sponsorship, disaster relief, religious community, youth sports, business roundtable, other)
  - Annual involvement type (dropdown: financial donation, in-kind donation, volunteer time, all of the above)
  - Annual dollar amount or hours (currency or number, optional)
  - Description (textarea)
  - URL if applicable (text, optional)
  - Document upload (sponsor recognition letter, photos, articles)

**Specific programs section:**
- Habitat for Humanity partnership (yes/no, if yes details)
- Veteran discount program (yes/no, if yes details)
- Senior discount program (yes/no, if yes details)
- Free roof or service giveaway programs (yes/no, if yes details)

**Documentation section:**
- Charitable giving documentation (3-year totals if available)
- Sponsorship recognition documents

### Category 14: Field Service Software Integration

**Tier:** 1 partial, Tier 2 full
**Estimated time:** 20-40 minutes (more if API integration setup is part of this)
**Mobile-friendly:** Forms yes; integration setup easier on desktop

**Form structure:**
- Primary field service software (dropdown):
  - ServiceTitan
  - Jobber
  - HousecallPro
  - FieldRoutes
  - Workiz
  - Service Fusion
  - JobNimbus
  - AccuLynx
  - Dataforma
  - Other (text)
  - None / Manual / Spreadsheets
- CRM system if separate (dropdown or text)
- Accounting software (dropdown)
- Estimating software beyond Xactimate (multi-select)
- Phone system / call tracking (text)

**API integration section:**
- Willing to share API credentials for direct integration (yes/no)
- API credentials (encrypted storage, if yes)
- Alternative: Zapier-based integration acceptable (yes/no)
- Webhook destination preferences (multi-input: email, phone, CRM endpoint)

**Lead aggregator subscriptions:**
- Add Subscription button
- Per-subscription: platform name, monthly volume, average lead cost

### Category 15: Sales Process and Lead Routing

**Tier:** 1
**Estimated time:** 15-30 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Primary lead destination (dropdown: Email, SMS, CRM directly, Phone forward, Multiple destinations)
- Lead routing rules (textarea or structured if multiple destinations)
- Response time SLA (dropdown: 5 minutes, 15 minutes, 30 minutes, 1 hour, 4 hours, 24 hours)
- After-hours lead handling (dropdown: on-call staff, answering service, voicemail to queue, no after-hours)
- Sales team structure (dropdown: owner-only, dedicated sales team, technician-to-sales handoff, mixed)
- Lead qualification criteria (textarea)
- Average lead-to-customer conversion rate (slider, optional)
- Average deal size by service (table: service from Category 2, average value)
- Sales cycle length (dropdown: same day, within week, 1-2 weeks, 1 month, longer)
- Common objections and responses (multi-row: objection, response)
- Emergency vs routine lead distinction (yes/no, if yes describe routing differences)

**TCPA consent section:**
- Custom TCPA consent language (textarea, optional, defaults to platform standard)
- SMS opt-in required (yes/no)
- Phone recording disclosure required (yes/no)

### Category 16: Brand Assets

**Tier:** 1
**Estimated time:** 30-60 minutes (varies based on what client has on hand)
**Mobile-friendly:** Forms yes; uploads work but desktop easier for organized brand asset management

**Logo upload section:**
- Primary logo (file upload, vector preferred: SVG, AI, EPS, PDF)
- Reversed logo for dark backgrounds (file upload, vector preferred)
- Icon-only / monogram version (file upload, vector preferred)
- Black and white version (file upload, vector preferred)
- Logo usage guidelines (text or PDF upload)

**Brand color palette section:**
- Primary brand color (color picker + hex code field)
- Secondary brand color (color picker + hex code field)
- Accent color 1 (color picker + hex code field, optional)
- Accent color 2 (color picker + hex code field, optional)
- Text colors (body, headline, link — color pickers)

**Typography section:**
- Heading font name (text)
- Body font name (text)
- Display font name if used (text, optional)
- Font files (file upload, multiple, optional)
- Font licensing documentation (PDF upload, optional)

**Visual style section:**
- Photography style preference (dropdown: bright/aspirational, documentary/real, mixed)
- Iconography style (dropdown: flat, outlined, filled, custom illustrations)
- Slogan or tagline (text)
- Pronunciation guide (text, for voice search optimization)

**Restrictions section:**
- Colors to avoid (text)
- Words or terms to avoid (text)
- Imagery to avoid (text)
- Competitor names to avoid mentioning (text)

**Brand guidelines documents:**
- Existing brand guidelines PDF (upload)
- Style guide PDF (upload, optional)

### Category 17: Compliance and Legal

**Tier:** 1
**Estimated time:** 15-30 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Current privacy policy URL or upload (text or PDF)
- Current terms of service URL or upload (text or PDF)
- TCPA consent capture method on existing site (textarea description)
- GDPR / CPRA exposure (yes/no with detail)
- Data retention policies (textarea, optional)
- Data deletion request handling (textarea, optional)
- Email marketing consent capture method (dropdown: single opt-in, double opt-in, none)
- SMS marketing consent capture method (text, if applicable)
- Call recording disclosure language (textarea, if calls recorded)
- Sub-processor disclosures (yes/no with detail)
- Cookie consent banner in use (yes/no)
- ADA accessibility statement (yes/no with detail)
- DMCA designated agent (text, if applicable)

**Document upload section:**
- Existing privacy policy (PDF)
- Existing terms of service (PDF)
- Existing accessibility statement (PDF, optional)
- Insurance for cyber liability (PDF, optional)

### Category 18: Goals and Success Metrics

**Tier:** 1
**Estimated time:** 20-30 minutes
**Mobile-friendly:** Yes

**Form structure:**
- Primary goal (dropdown: more leads, better quality leads, lower CAC, geographic expansion, brand authority, market dominance, exit preparation, other)
- Current monthly lead volume (number)
- Target monthly lead volume (number)
- Specific revenue target (currency, optional)
- Expansion target markets (multi-input)
- Expansion target services (multi-input)
- Current CAC (currency, optional)
- Current LTV (currency, optional)
- Acceptable lead cost (currency)
- Reporting cadence preference (dropdown: weekly, biweekly, monthly)
- Reporting format preference (dropdown: dashboard self-serve, scheduled email reports, scheduled video calls, in-person reviews)
- 30-day success definition (textarea)
- 90-day success definition (textarea)
- 6-month success definition (textarea)
- 12-month success definition (textarea)
- Failure threshold definition (textarea)
- Decision-maker structure (text)
- Top competitors to beat (multi-input)
- Additional notes for operator (textarea)

---

## Evidence-tier unlock logic

The Asset Hub automatically calculates completion percentages and tier eligibility based on field completion and document upload status. Logic:

**Tier 1 unlock requires:**
- Category 1 (Business Identity): 100% required fields complete
- Category 2 (Service Portfolio): minimum 1 service added with all required fields
- Category 3 (Geographic Coverage): minimum 1 city added
- Category 4 (Certifications): minimum business license and insurance documented
- Category 8 (Existing Digital Footprint): primary website URL captured
- Category 15 (Sales Process): minimum primary lead destination and response time SLA captured
- Category 16 (Brand Assets): primary logo uploaded (any format acceptable)
- Category 17 (Compliance): minimum existing privacy policy and terms (or acknowledgment of needing platform versions)
- Category 18 (Goals): minimum primary goal and reporting cadence captured

**Tier 2 unlock requires:**
- All of Tier 1
- Category 2: minimum 3 services with comprehensive details
- Category 3: minimum 5 cities
- Category 4: all certifications documented with PDFs
- Category 5: at least 1 insurance carrier relationship documented
- Category 6: at least 1 manufacturer partnership documented
- Category 7: at least 1 trade affiliation
- Category 9: existing backlinks list captured (even if "we don't have any")
- Category 10: minimum 3 case studies
- Category 11: minimum 50 job photos with EXIF intact
- Category 14: primary field service software identified and integration path chosen

**Tier 3 unlock requires:**
- All of Tier 2
- Category 3: minimum 20 cities
- Category 10: minimum 5 case studies
- Category 11: minimum 200 job photos with geographic distribution
- Category 12: press history captured (even if "we have none yet")
- Category 13: community involvement captured (even if minimal)

---

## Operator-side workflow

### Operator visibility into client uploads

Operators see, per client:
- Real-time upload activity (new uploads in last 24 hours)
- Per-category completion percentages
- Evidence-tier status and gap-to-next-tier
- Pending operator review items (uploaded documents that need verification)

### Operator review workflow

Certain uploads require operator verification before being trusted by the platform:
- License documents
- Certification documents
- Insurance documents
- Manufacturer partnership documents
- Insurance carrier approval documents

For these, an "Operator Review" queue surfaces uploads with:
- Document preview
- Client metadata (what they said this document is)
- Verification actions (Verify, Reject with reason, Request resubmission)
- Verification notes field

Verified documents update the client's `evidence_tier_status` calculations.

### Operator tagging system

For case studies, photos, and other content, operators can tag uploads with:
- "Use for Tier 3 PR campaign"
- "Use for service hub page generation"
- "Use for manufacturer partner application"
- "Verify with VA before use"
- "Hold for quarterly refresh"
- Custom tag

Tagged uploads surface in relevant agent workflows (A-02 reads photos tagged for hub generation, A-46 reads documents tagged for directory submission, etc.).

### Operator notes per client

Free-form operator notes per client, with:
- Timestamp and operator attribution
- Visibility setting (operator-only, share with VA, share with client)
- Pinned vs chronological view
- Search

---

## Notification and reminder system

### Client-facing reminders

**Email reminders sent automatically:**
- Day 3 after onboarding: "Welcome to Tarritrix — here's what to upload first"
- Day 7: "You're [X%] through onboarding — let's complete Tier 1 unlock"
- Day 14: "Tier 1 unlocked! Here's what to add next for Tier 2"
- Day 30: "30-day check-in — incomplete sections"
- Day 60: "60-day check-in — Tier 3 opportunities"
- Day 90: "90-day milestone — what's still pending"
- Monthly after day 90: "Monthly Asset Hub update reminder"

**In-app reminders:**
- Banner notification when client logs in if incomplete sections exist
- Tooltip prompts on category cards explaining next required action
- Progress celebration when tiers unlock

**Customizable:**
- Client can opt out of certain reminder types
- Client can request increased reminder frequency for accountability
- Operator can manually trigger reminder for specific category

### Operator-facing notifications

**Real-time notifications:**
- New upload to client account (configurable per client priority)
- New tier unlock achieved
- Operator review queue items added
- Completion of high-priority categories

**Daily digest email:**
- Summary of client upload activity in last 24 hours
- Pending operator review queue
- Clients approaching reminder thresholds

**Weekly summary:**
- Per-client progress reports
- Aggregate platform completion metrics

---

## Technical implementation requirements

### File storage

- Supabase Storage for all uploaded files
- Per-client bucket isolation (RLS enforces no cross-client access)
- File size limits per type (PDFs 10MB, images 20MB, videos 1GB)
- Automatic virus scanning on upload (Phase 1.5 enhancement)
- Automatic EXIF extraction for image uploads
- Original file preservation (no automatic compression for case study photos)

### Database tables required

```
client_intake_categories (master list of 18 categories)
  - id, slug, name, description, tier_required, estimated_time_minutes, sort_order

client_intake_completion (per-client per-category)
  - id, client_id, category_id, completion_percentage, last_updated_at, completed_by_user_id

client_intake_field_values (structured form data)
  - id, client_id, category_id, field_key, field_value (JSONB), updated_at

client_intake_uploads (file uploads with metadata)
  - id, client_id, category_id, file_path, file_type, file_size, uploaded_at, uploaded_by_user_id, exif_data (JSONB), tags (array), operator_verified, operator_verified_at, operator_verified_by

operator_notes_per_client
  - id, client_id, note_text, visibility, pinned, created_at, created_by_operator_id

operator_review_queue
  - id, upload_id, status (pending, verified, rejected), verified_at, verified_by, notes
```

### API endpoints

```
GET /api/portal/assets — Asset Hub main page data (categories, progress)
GET /api/portal/assets/[category_slug] — Per-category page data
POST /api/portal/assets/[category_slug]/fields — Save form field values
POST /api/portal/assets/[category_slug]/upload — Upload file
GET /api/portal/assets/[category_slug]/uploads — List uploads in category
DELETE /api/portal/assets/uploads/[upload_id] — Delete upload
GET /api/portal/assets/progress — Overall completion and tier status

Operator-only endpoints:
GET /api/operator/clients/[client_id]/intake — Full client intake view
POST /api/operator/uploads/[upload_id]/verify — Mark upload verified
POST /api/operator/uploads/[upload_id]/tag — Add tag
POST /api/operator/clients/[client_id]/notes — Add operator note
```

### Mobile-specific considerations

- Camera access for direct upload from phone camera roll
- HEIC/HEIF support (Apple iPhone format) with auto-conversion to JPEG
- Background upload with retry logic (handles spotty mobile connections)
- Offline draft support (form data saves locally, syncs when online)
- Reduced data mode option (compress uploads automatically on cellular)

---

## Open questions for operator decision

1. **Client user management** — Should multiple users per client account require approval workflows, or can the primary account holder add users freely?

2. **Document verification SLA** — How quickly should operator-required verifications be completed? Same day, 24 hours, 48 hours?

3. **Mobile photo upload from camera** — Should the Asset Hub include direct camera capture from mobile (vs only camera roll selection)?

4. **Required vs optional in real terms** — Some fields are listed as "required" but the platform can technically function without them. Should "required" be enforced (block tier unlock) or guided (strong prompt, but allow proceeding)?

5. **Document AI extraction** — Should the platform attempt to auto-extract data from uploaded documents (e.g., reading EIN from a tax document, license number from license PDF)? This is Phase 1.5 capability question but architecture decision now.

6. **Client portal branding** — Should the Asset Hub be fully white-labeled to match the client's brand, or always display the Tarritrix brand?

7. **Asset export for client** — Should clients be able to download all their uploaded assets in a single archive (for portability or backup)?

---

## Cross-references

- **Client Intelligence Intake Master Document** — defines the 18 categories and their data requirements
- **Service Hub Pages Architecture Specification** — case studies, certifications, and brand assets feed hub page generation
- **A-46 Directory Registration Agent Specification** — directory submissions consume documents uploaded via Asset Hub
- **VA Dashboard Specification** (to be written next) — VA verification tasks reference Asset Hub uploads
- **A-22 Job Evidence Ingestion** — consumes job photos from Asset Hub Category 11

---

**End of document.**
