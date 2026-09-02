# Client Onboarding Checklist

**Purpose:** Standard intake and onboarding procedure for each new manual fulfillment client. Use this from contract signing through first page publication.

**Estimated time:** 5-10 days from contract to first page live (mostly waiting on client + DNS propagation + GBP verification).

**Format:** This is both an internal checklist for the operator AND the structure of an intake form sent to the client.

---

## PART A — Operator Pre-Onboarding (Before sending intake to client)

- [ ] Stripe payment received for first month
- [ ] Operator created client folder in working drive: `clients/{client-slug}/`
- [ ] Operator drafted welcome email
- [ ] Operator scheduled GBP setup call IF client doesn't have verified GBP

---

## PART B — Client-Filled Intake Form

The following sent to the client as a Google Form, Typeform, or simple email questionnaire. Client must complete before any page production begins.

### Section 1: Business Identity (REQUIRED)

- **Legal business name:** _________
- **Doing-business-as (DBA), if different:** _________
- **Primary phone number** (must match GBP exactly): _________
- **Primary email** (for lead form forwarding): _________
- **Business street address** (must match GBP exactly): _________
- **City, state, ZIP:** _________
- **Year business established:** _________

### Section 2: Domain Access (REQUIRED)

- **Main domain you own:** _________ (e.g., e4roofing.com)
- **Domain registrar** (where domain is registered): _________ (e.g., GoDaddy, Namecheap, Google Domains, Cloudflare)
- **Can you access your domain registrar account?** Yes / No / Not Sure
- **Preferred subdomain prefix:** _________ (default: `seo` — alternatives: `service-areas`, `locations`, `pages`)

### Section 3: Google Business Profile (REQUIRED)

- **Do you have a verified Google Business Profile?** Yes / No / Not Sure
- If YES:
  - **GBP URL:** _________ (e.g., https://maps.google.com/...)
  - **Will you add Tarritrix as a Manager?** Yes — instructions provided
- If NO:
  - **Are you the legitimate business owner who can verify the GBP?** Yes / No
  - **Schedule 60-minute setup call** — operator walks you through verification

### Section 4: Service Area (REQUIRED)

- **Primary service area type:**
  - Option A: Radius from business address — Specify radius miles: ___
  - Option B: Specific cities/regions — List: _________
- **All cities you actively serve** (comma-separated): _________
- **Any cities or regions you DO NOT want pages built for** (e.g., outside your license area): _________

### Section 5: Services Offered (REQUIRED)

Check all that apply:
- [ ] Residential roof repair
- [ ] Residential roof replacement
- [ ] Commercial roofing
- [ ] Storm damage repair
- [ ] Hail damage repair
- [ ] Wind damage repair
- [ ] Roof inspection
- [ ] Emergency tarping
- [ ] Insurance claim assistance
- [ ] Metal roofing
- [ ] Tile roofing
- [ ] Flat roofing
- [ ] Gutters
- [ ] Skylights
- [ ] Roof maintenance plans
- [ ] Other: _________

- **Primary service** (the one you most want to be known for): _________

### Section 6: Licensing & Insurance (REQUIRED for trust signals)

- **State contractor license number** (and state): _________
- **License expiration date:** _________
- **General liability insurance amount:** _________
- **Workers comp insurance:** Yes / No
- **Bonded:** Yes / No (if yes, bond amount)
- **BBB accreditation:** Yes / No (if yes, BBB rating)

### Section 7: Certifications & Affiliations

List any of the following you hold (helps with E-E-A-T signals):
- [ ] GAF Master Elite
- [ ] CertainTeed SELECT ShingleMaster
- [ ] Owens Corning Platinum Preferred
- [ ] HAAG Certified Inspector
- [ ] NRCA member
- [ ] Local Chamber of Commerce member
- [ ] Other industry certifications: _________

### Section 8: Brand Assets (REQUIRED)

Provide via Google Drive folder link or direct attachment:
- **Logo file** (PNG with transparent background OR SVG)
- **Brand primary color** (hex code, e.g., #1E40AF): _________
- **Brand secondary/accent color** (hex code): _________
- **Brand voice notes** (one paragraph describing how you want to sound — formal vs casual, etc.): _________

### Section 9: Photo Library (REQUIRED)

Provide via Google Drive or Dropbox folder link to **at least 30 photos** of your actual work. Categorize if possible:
- Before/after pairs
- Process shots (work in progress)
- Finished projects
- Team photos
- Storm damage examples
- Different roof types you've worked on

**Photo requirements:**
- Original photos you took or commissioned (not stock, not copyrighted from suppliers)
- Higher resolution preferred (at least 1500px wide)
- If any photos contain identifiable people (homeowners, etc.), confirm you have permission to use their image

### Section 10: Existing Reviews & Testimonials

- **Approximate Google review count:** _________
- **Approximate average star rating:** _________
- **Top 5 favorite Google reviews to feature** (paste reviewer first name + last initial, star rating, date, and review text):
  1. _________
  2. _________
  3. _________
  4. _________
  5. _________

### Section 11: Operational Details

- **Business hours** (for schema markup):
  - Monday: _________
  - Tuesday: _________
  - Wednesday: _________
  - Thursday: _________
  - Friday: _________
  - Saturday: _________
  - Sunday: _________

- **Emergency service availability?** Yes / No
  - If yes, hours: _________

- **Languages spoken on phone:** English / Spanish / Other: _________

### Section 12: Lead Routing Preference

- **Where should leads be sent?**
  - Email only: _________
  - Email + SMS notification: _________ (phone number for SMS)
  - Email + CRM webhook: _________ (CRM name + webhook URL)

- **Who handles lead follow-up at your business?** _________ (name, role)
- **Target response time to leads:** _________ (minutes/hours)

### Section 13: Communications Preferences

- **Preferred communication channel** for Tarritrix updates: Email / Phone / Slack / Other
- **Frequency of communication preferred:** Weekly / Bi-weekly / Monthly / As-needed
- **Best time of day to reach you:** _________

### Section 14: Goals & Expectations

- **Primary business goal for this service** (what does success look like to you?): _________
- **How are you measuring success?** (calls / form fills / specific revenue target): _________
- **Any specific competitors you want to beat?** _________
- **Any sensitive topics or claims to avoid?** _________

---

## PART C — Operator Onboarding Sequence (After Intake Received)

### Day 1: Initial Setup

- [ ] Insert client row in `clients` table (Supabase)
- [ ] Add client's chosen subdomain to Vercel project as Custom Domain
- [ ] Email client EXACT DNS instructions for their specific registrar:
  - Include the CNAME target Vercel provides
  - Include screenshot of where to add the record in their registrar's UI
  - Include estimated propagation time (1-48 hours)
- [ ] Email client GBP Manager request instructions IF they have verified GBP
- [ ] Schedule GBP setup call IF they don't have verified GBP

### Day 2-3: Wait for DNS & GBP

- [ ] Daily check: has DNS propagated? Use `dig {subdomain}` or DNSChecker.org
- [ ] Daily check: has client granted GBP Manager access?
- [ ] Send reminder if client hasn't completed within 48 hours

### Day 3-4 (or whenever ready): Verification

- [ ] Verify subdomain resolves to Vercel app (HTTPS works, no certificate errors)
- [ ] Verify GBP Manager access (you can edit listing)
- [ ] Verify all required intake fields filled
- [ ] Verify client uploaded at least 30 photos

### Day 4-5: Asset Audit

- [ ] Operator reviews photo library
- [ ] Operator marks photos as usable / needs editing / unusable
- [ ] Operator creates client-specific content guidelines document in client folder
- [ ] Operator scrapes / catalogs existing GBP reviews
- [ ] Operator confirms business hours match GBP

### Day 5-7: Subdomain Skeleton

- [ ] Create homepage at subdomain root (`/`)
- [ ] Create category pages if multi-service client (`/storm-damage`, `/residential`, `/commercial`)
- [ ] Test internal linking
- [ ] Test sitemap.xml generation
- [ ] Test robots.txt
- [ ] Submit subdomain as new property in Google Search Console
- [ ] Submit sitemap to GSC

### Day 7-10: First Page Production

- [ ] Operator fills out `PAGE_CONTENT_BRIEF_TEMPLATE.md` for first page (highest-impact keyword + most important city)
- [ ] Operator drafts content via ChatGPT-assisted workflow
- [ ] Operator reviews and edits draft
- [ ] Operator assembles page in database
- [ ] Operator runs quality checklist
- [ ] Operator publishes
- [ ] Operator submits URL to GSC for indexation
- [ ] Operator sends client an email: "Your first page is live: {url}. We'll continue producing N pages per month per your tier."

### Day 10+: Production Mode

- [ ] Operator schedules remaining pages per tier (4 / 8 / 16 per month)
- [ ] Drip publishing: 1 page per day for Starter, 2-3/day for Growth, 4/day for Authority
- [ ] Each page through same workflow
- [ ] Weekly internal review of indexation status

### Day 30: First Monthly Report

- [ ] Pull GSC data (impressions, clicks, top queries, top pages)
- [ ] Pull GBP Insights (profile views, calls, direction requests)
- [ ] Lead form submission count (from `leads` table)
- [ ] Compile monthly report
- [ ] Send to client via email
- [ ] For Authority clients: schedule 30-minute strategy call

---

## PART D — Red Flags During Onboarding

Stop the onboarding and reassess if any of these come up:

- **Client claims they own a domain but can't access registrar** → without registrar access, no DNS changes possible. Either help them recover access OR walk away.
- **Client claims to be the business owner but GBP verification fails** → likely a fraud risk. Don't proceed.
- **Client refuses to provide license number** → if they don't have a contractor license, they may not be legally operating in their state. Liability risk for you. Decline.
- **Client wants you to make false claims** (e.g., made-up reviews, fake certifications) → decline. This kind of work poisons the entire model.
- **Client's existing reviews are mostly negative or appear fake** → reputation problem you can't fix with SEO. Address this before signing them OR decline.
- **Photo library has obvious copyrighted brand materials** → liability risk. Get them to provide owned-photos before proceeding.

---

## PART E — Client Communication Templates

### Welcome Email (sent after contract + payment)

```
Subject: Welcome to Tarritrix — Let's get your service-area pages started

Hi [client first name],

Thanks for choosing Tarritrix. Here's what happens next:

1. Fill out the onboarding intake form here: [Google Form link]
2. Once we have your info, we'll set up your subdomain (typically 24-48 hours)
3. You'll add one DNS record at your domain registrar (we'll walk you through it)
4. We'll verify Google Business Profile access (if you have one) or schedule a call to set one up (if you don't)
5. First page goes live within 7-10 days of completing the intake

Total time from now to your first page live: about 10 days, mostly waiting on DNS propagation and GBP verification.

If you have any questions, just reply to this email.

— Reid Whitesides, Tarritrix
```

### DNS Setup Email (after intake completed)

```
Subject: One DNS change to add — your subdomain is ready

Hi [client first name],

Your subdomain {chosen_subdomain} is ready to point at our infrastructure. You'll need to add ONE DNS record at your domain registrar ({registrar_name}):

Record type: CNAME
Name/Host: {prefix} (e.g., "seo")
Value/Target: {vercel_cname_target}
TTL: Auto or 3600

Step-by-step for {registrar_name}:
[Screenshot 1: where to find DNS settings]
[Screenshot 2: how to add the record]
[Screenshot 3: how to confirm it saved]

After you save the record, it can take 1-48 hours to propagate. We'll confirm once it's live.

If you'd like help setting this up, reply with "schedule call" and we'll do it together on a 15-minute screen-share.

— Reid Whitesides, Tarritrix
```

### GBP Manager Request Email

```
Subject: Adding Tarritrix as a Google Business Profile Manager

Hi [client first name],

To optimize your Google Business Profile (post updates, respond to reviews, monitor questions, manage photos), we need Manager access. This is different from Owner — you remain the Owner, we just get edit permissions.

Here's how to add us:
1. Go to business.google.com and sign in
2. Click on your business
3. Click "Settings" (gear icon)
4. Click "Users"
5. Click "Add"
6. Enter email: tarritrix@gmail.com (or whatever Gmail you use)
7. Choose role: Manager
8. Click Send

You'll see "Pending" until we accept (we'll accept within a few hours).

If you can't find these settings, send a screenshot and we'll guide you.

— Reid Whitesides, Tarritrix
```

### First Page Live Email

```
Subject: Your first service-area page is live: {page_title}

Hi [client first name],

Your first service-area page is now live: {page_url}

What we've done:
- Built a 1,800-word page targeting "{keyword}" for customers in {city}
- Embedded your Google Business Profile location on the page
- Added schema markup so Google can recognize your business properly
- Submitted the page to Google Search Console for indexation
- Linked it to your sitemap

What happens next:
- Google typically indexes new pages within 3-14 days
- You'll start seeing impressions in Google Search Console within 1-3 weeks
- First leads from this page typically arrive within 30-60 days as rankings improve
- We'll continue producing {N} more pages this month per your {tier} tier

Questions? Reply anytime.

— Reid Whitesides, Tarritrix
```

---

## End of File
