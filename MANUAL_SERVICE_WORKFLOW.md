# Manual Service Workflow — Tarritrix Manual Fulfillment

**Purpose:** Operational playbook for delivering paid SEO fulfillment service to roofing contractors who convert from the audit MVP. Use this until automation via revived Tarritrix 9.0 platform is justified by client volume (~10+ active clients).

**Version:** 1.0
**Last updated:** Day 0

---

## 1. Service Tier Definitions

### Starter — $497/month
- 4 service-area pages per month
- 1 monthly performance report (PDF, emailed)
- GBP optimization (one-time at onboarding)
- Lead form forwarding to client email
- Capacity: ~3-5 hours of operator time per month per client

### Growth — $997/month
- 8 service-area pages per month
- Weekly GBP optimization (posts, Q&A monitoring, review responses)
- Competitor monitoring (monthly snapshot of top 5 competitors)
- 1 monthly performance report
- Lead form + phone-call tracking
- Capacity: ~7-10 hours of operator time per month per client

### Authority — $1,997/month
- 16 service-area pages per month
- Daily GBP monitoring
- Storm-event rapid response (within 48 hours of significant local weather)
- Weekly 30-minute strategy call with client
- Custom monthly report with action recommendations
- Capacity: ~12-15 hours of operator time per month per client

---

## 2. Client Onboarding Process (One-Time, Per Client)

Trigger: Client signs up via consultation call after their audit reveals problems.

### Day 1: Contract & Payment
- Send Stripe payment link or PayPal invoice for first month
- Send contract via simple email confirmation (no formal contract management needed at this stage — Stripe receipt + email "agreed to monthly recurring at $X tier" is sufficient)
- Welcome email with link to onboarding intake form

### Day 2: Intake Form Completion
Client fills out the onboarding intake form (see `CLIENT_ONBOARDING_CHECKLIST.md`).

Captures:
- Business name, address, phone, email (exact match to GBP)
- Domain name they own (e.g., `e4roofing.com`)
- Domain registrar (GoDaddy, Namecheap, Google Domains, etc.)
- Existing GBP status (verified / unverified / doesn't exist)
- Service area definition (radius miles OR specific cities/counties they serve)
- Services offered (residential, commercial, repair, replacement, etc.)
- Brand assets: logo (PNG/SVG), brand colors (hex codes), brand voice notes
- Existing photos: link to Dropbox/Google Drive folder with 30+ photos of their work
- Insurance and license information (TX contractor license number, etc.)
- BBB rating, certifications, awards
- Existing GBP reviews (you'll scrape these later, but ask them to send 5-10 of their best)

### Day 3-4: Subdomain Setup
1. Operator chooses subdomain prefix (default: `seo`). If conflict, use `service-areas` or `locations`.
2. Operator adds the subdomain to their multi-tenant Vercel project as a custom domain (e.g., `seo.e4roofing.com`)
3. Vercel provides DNS instructions (typically a CNAME record)
4. Operator emails client the EXACT DNS instructions with screenshots for their specific registrar
5. Client adds the CNAME record
6. DNS propagation: 1-48 hours
7. Operator verifies subdomain resolves to Vercel app
8. Operator confirms SSL certificate provisioned

**If client can't do DNS themselves:** Offer a 15-minute screen-share to walk them through it.

**If subdomain blocked by registrar:** Some legacy registrars have limitations. Migrate them to Cloudflare DNS (free) and proceed from there.

### Day 4-5: GBP Setup or Access Request

**If client has verified GBP:**
1. Client adds you as Manager via their GBP dashboard (Settings → Users → Add Users → your Gmail address)
2. You accept the invitation from your Gmail
3. Confirm Manager access (you can edit but not delete the listing)

**If client has unverified or no GBP:**
1. Schedule 30-60 minute screen-share call
2. Walk client through GBP creation at business.google.com
3. Client must verify via postcard (5-14 days), phone, or video call
4. Once verified, repeat the Manager-access process above
5. **This delays page launch but is non-negotiable. Don't proceed with content without GBP.**

### Day 5-7: Asset Audit & Content Prep
1. Operator reviews client's existing photos (filter for usable ones — well-lit, clear, no people unless they signed release, no copyrighted brand logos visible)
2. Operator creates client-specific content guidelines doc:
   - Brand voice notes (formal vs casual, technical vs accessible)
   - Phrases to use ("storm damage specialists" vs "hail repair pros")
   - Phrases to avoid ("cheap", "lowest price", etc.)
   - Approved service offerings (only mention what they actually do)
3. Operator drafts the first page (see Section 3 below) as a quality benchmark
4. Operator sends draft to client for approval before publishing more

### Day 7-10: First Page Live + Site Skeleton
1. Operator publishes first page to subdomain
2. Operator builds out the subdomain "skeleton":
   - Homepage at `seo.clientdomain.com` (hub page linking to all service-area pages)
   - Each service category as a parent page (e.g., `/storm-damage`, `/residential-roofing`, `/commercial`)
   - Service-area pages as children under categories
3. Operator submits subdomain sitemap to Google Search Console (creates new GSC property for subdomain)
4. Operator requests indexation for first page via GSC URL Inspection

### Day 10+: Production Mode
- Operator generates remaining pages per the client's monthly tier
- Drip publishing: 1 page per day for Starter, 2-3 per day for Growth, 4 per day for Authority
- Each page published, then submitted to GSC for indexation
- Weekly internal review: which pages indexed? Which still pending?

---

## 3. Per-Page Production Process

For each page you produce:

### Step 1: Page Brief
Fill out the `PAGE_CONTENT_BRIEF_TEMPLATE.md` for this specific page. Captures:
- Target keyword (e.g., "storm damage roof repair")
- Target city (e.g., "Georgetown, TX")
- Target neighborhoods (e.g., "Sun City, Wolf Ranch, Cimarron Hills")
- Local landmarks/references to incorporate
- Page slug (e.g., `/storm-damage-roof-repair-georgetown-tx`)
- Specific service angle for this page

### Step 2: Content Drafting (ChatGPT-Assisted)

Open ChatGPT. Use this prompt template (calibrate as needed):

```
You are a senior copywriter for a Texas-based roofing company. Write a 1,800-word service-area landing page targeting the keyword "[keyword]" for customers in [city, state]. 

Brand voice: [voice notes from client guidelines]
Brand details: [business name, license number, years in business]

Page structure required:
1. H1 incorporating the keyword and city naturally
2. Opening paragraph (3-4 sentences) with the keyword in first 50 words
3. Section: "Why [City] Homes Need [Service]" (local references to climate, weather patterns, common housing stock in [city])
4. Section: "Our [Service] Process" (4-6 step description)
5. Section: "Neighborhoods We Serve in [City]" (mention specific neighborhoods: [list])
6. Section: "What Sets [Business Name] Apart" (years in business, license, certifications)
7. Section: "Common Questions About [Service] in [City]" (5 FAQ pairs)
8. Closing call-to-action paragraph

Tone: confident, expert, locally rooted. Avoid generic phrases like "we are the best." Be specific.

Mention these local details:
- [Local landmarks, school districts, common HOAs, neighborhoods]
- [Local weather patterns, storm history, regional building codes]

Do NOT include:
- Stock language like "top-rated," "five-star," "industry-leading"
- Made-up testimonials
- Unverifiable claims about pricing
- Generic stock advice

Return the content as Markdown with H1, H2, H3 tags clearly indicated.
```

Review and edit the output. Add specific local details ChatGPT might not have known. Cut generic filler. Make sure it reads like a human wrote it.

**Quality bar:** If this page sounds like every other contractor's website, kill it and rewrite. Vertical-specific, hyperlocal, expert.

### Step 3: Photo Selection
- 4-6 photos from client's library
- Rename files to descriptive SEO-friendly slugs: `storm-damage-shingle-repair-georgetown-tx.jpg`
- Resize to ~1200px wide max, convert to WebP
- Write descriptive alt text for each (mentioning service + city naturally, never keyword stuffing)

### Step 4: Page Population
Plug content into the page template (see `PAGE_TEMPLATE_SPECIFICATION.md`):
- Title tag, meta description
- H1, body content
- Photo URLs + alt text
- FAQ pairs
- NAP (auto-pulled from client config)
- Embedded GBP map (auto-pulled from client config)
- Schema markup (auto-generated by template based on inputs)

### Step 5: Quality Check
Before publishing, verify:
- [ ] Page loads in under 2.5 seconds
- [ ] Mobile responsive (test on phone or browser dev tools)
- [ ] Title tag is 55-60 characters
- [ ] Meta description is 150-160 characters
- [ ] H1 contains exact target keyword + city
- [ ] Body has 1,500+ words minimum
- [ ] At least 3 local references (neighborhoods, landmarks, etc.)
- [ ] Click-to-call link works
- [ ] Contact form works (submit test, verify email arrives)
- [ ] Schema markup validates (paste page URL into Google's Rich Results Test)
- [ ] No spelling/grammar errors

### Step 6: Publishing & Indexation
1. Publish page (deploy to production)
2. Add URL to subdomain sitemap.xml
3. Submit URL to Google Search Console (URL Inspection → Request Indexing)
4. Add page to internal linking: link to it from related pages (sibling cities, related services)

### Step 7: Tracking
Log in your client tracking spreadsheet:
- Page URL
- Target keyword
- Target city
- Publish date
- Indexation status (check weekly: indexed / pending / not indexed)
- First ranking observed (check after 30 days)
- Lead form submissions

---

## 4. Monthly Operations

### Week 1 of Each Month
- Generate and publish remaining pages for the month per client tier
- GBP posts for Growth + Authority clients (1-2 per week)
- Storm event monitoring (if Authority tier): check NOAA, local news, social media for hail/wind events in client service areas

### Week 2-3
- GBP review responses (within 24-48 hours of new reviews for all tiers)
- GBP Q&A monitoring (answer customer questions on the listing)
- Internal linking updates as new pages publish

### Week 4
- Pull monthly performance data:
  - GSC: impressions, clicks, top queries, top pages
  - GBP Insights: profile views, search queries, calls, direction requests
  - Indexation status of all pages published this month
  - Lead form submissions count
- Generate monthly report (PDF or Google Doc)
- Send report to client via email
- For Authority clients: 30-minute strategy call to review report

---

## 5. Tools & Stack (Manual Phase)

| Purpose | Tool | Cost |
|---|---|---|
| Page hosting | Vercel | Free tier |
| Page template | Next.js project (single repo: `tarritrix-pages`) | Free |
| Database for page content | Supabase | Free tier |
| Content drafting | ChatGPT Plus | $20/month |
| Photo editing | Photopea (free Photoshop alternative) or operator's existing tools | Free |
| Project management | Notion or Google Drive | Free |
| Client tracking | Google Sheets | Free |
| GBP monitoring | Google Business Profile dashboard | Free |
| Performance tracking | Google Search Console + GBP Insights | Free |
| Email/communication | Gmail | Free |
| Time tracking (optional) | Toggl free tier | Free |
| Domain DNS support | Cloudflare DNS (if needed) | Free |

Total recurring tool cost: $20/month (ChatGPT Plus).

---

## 6. Capacity & Burnout Thresholds

| Client Mix | Hours/Week | Status |
|---|---|---|
| 3 Starter | ~5 hrs | Easy |
| 5 Starter | ~8 hrs | Comfortable |
| 5 Starter + 2 Growth | ~14 hrs | Manageable |
| 5 Starter + 3 Growth + 1 Authority | ~22 hrs | Half-time job |
| 8 Starter + 4 Growth + 2 Authority | ~35 hrs | Full-time job, near burnout |
| Beyond | — | Automation required or VA hired |

**Burnout flag:** When weekly hours exceed 30 consistently for 4+ weeks, either:
1. Hire a VA at $5-10/hour for content drafting and GBP management
2. Begin Tarritrix 9.0 platform revival to automate page generation
3. Raise prices and shed lowest-tier clients

---

## 7. Hiring a VA (Threshold: ~$8K MRR sustained)

When the math justifies it, a Filipino or Latin American VA can take over:
- Content drafting via ChatGPT
- Photo selection and editing
- GBP post creation
- Monthly report data compilation

Operator retains:
- Strategy
- Client communication and consultation calls
- Quality control / final review
- New client onboarding
- Storm event monitoring (Authority tier)

VA cost: $400-$800/month for 20 hours/week of solid work. Covers more than the cost of one Starter client.

---

## 8. Transition to Automated Platform

Trigger: $10K MRR sustained for 30 days AND 8+ active clients.

At that point, begin Tarritrix 9.0 platform revival per `BUILD_PLAN.md` (refreshed at that time). Manual workflow continues running in parallel during platform build. Migrate clients from manual to automated platform one at a time as platform reaches feature parity.

Specifically, target these agents/components first in platform revival:
1. Page generation pipeline (A-03, A-04, A-05) — automates Step 2 (Content Drafting) and Step 4 (Page Population)
2. Sitemap generator (A-07) — automates Step 6 (sitemap updates)
3. Indexation tracker (A-08) — automates Step 7 (tracking)
4. Drip publisher (CRON-01) — automates monthly publishing cadence

After those four are working, manual workflow per client drops from ~5 hours to ~1-2 hours. That's the unlock that scales the business past 10 clients without hiring.

---

## 9. Quality Standards (Non-Negotiable)

Regardless of how busy you get, never violate these:
- Never publish a page with under 1,500 words of unique content
- Never use stock photos as primary page images (a few supporting graphics are okay, primary work-photos must be client's actual work)
- Never make unverifiable claims about pricing, time, or guarantees
- Never auto-publish without operator review (until automation is fully tested)
- Never share client GBP credentials between team members or VAs without explicit written permission
- Never request review removal without legitimate violation grounds

A reputation for thin, spammy local SEO work would destroy the entire business model. Quality is the moat.

---

## End of File
