# Page Template Specification — Tarritrix Service Area Pages

**Purpose:** Complete technical specification for the Next.js page template used to render all client service-area pages on subdomain hosting. One template, hundreds of generated pages.

**Version:** 1.0
**Last updated:** Day 0

---

## 1. Project Structure (Separate Repo: `tarritrix-pages`)

This is a SEPARATE Next.js project from `tarritrix-audit`. It hosts all client subdomain pages multi-tenant.

```
tarritrix-pages/
├── governance/
│   └── PAGE_TEMPLATE_SPECIFICATION.md (this file)
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                          # Subdomain root (per-client homepage)
│   │   ├── [slug]/
│   │   │   └── page.tsx                      # Dynamic page route — all service-area pages
│   │   ├── sitemap.ts                        # Dynamic sitemap per subdomain
│   │   └── robots.ts                         # Dynamic robots.txt per subdomain
│   ├── components/
│   │   ├── page/
│   │   │   ├── PageHeader.tsx                # Logo, NAP, click-to-call
│   │   │   ├── PageHero.tsx                  # H1, lead-gen primary CTA
│   │   │   ├── BodyContent.tsx               # Markdown rendering
│   │   │   ├── GbpMap.tsx                    # Embedded Google map
│   │   │   ├── ServiceAreas.tsx              # Neighborhoods served
│   │   │   ├── FAQ.tsx                       # FAQ section with FAQ schema
│   │   │   ├── Testimonials.tsx              # Review excerpts
│   │   │   ├── TrustSignals.tsx              # Licenses, certifications, BBB
│   │   │   ├── LeadForm.tsx                  # Contact form
│   │   │   ├── PageFooter.tsx                # NAP, links, social
│   │   │   ├── StickyCallButton.tsx          # Mobile click-to-call
│   │   │   └── Breadcrumbs.tsx               # Breadcrumb nav with schema
│   │   └── schema/
│   │       ├── LocalBusinessSchema.tsx
│   │       ├── ServiceSchema.tsx
│   │       ├── FaqSchema.tsx
│   │       ├── BreadcrumbSchema.tsx
│   │       └── ReviewSchema.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   └── server.ts
│   │   ├── tenant/
│   │   │   └── resolve-tenant.ts             # Resolves subdomain → client config
│   │   ├── content/
│   │   │   └── render-markdown.ts
│   │   └── api/
│   │       └── submit-lead.ts
│   ├── types/
│   │   ├── client.ts
│   │   └── page.ts
│   └── middleware.ts                          # Subdomain detection ONLY, no auth
├── public/
│   └── (favicon defaults — per-client overrides via database)
└── package.json
```

---

## 2. Multi-Tenant Routing Strategy

### How subdomains resolve to clients

The Next.js middleware (Edge runtime, no auth logic) inspects the incoming `Host` header:
- `seo.e4roofing.com` → client_id = `e4-construction-001`
- `service-areas.brightboxhomes.com` → client_id = `bright-box-homes-001`
- `locations.architecturalflashingsupply.com` → client_id = `afs-001`

The middleware adds `x-client-id` to request headers. All page rendering reads this header to fetch the correct client config from Supabase.

### Vercel multi-domain setup

ONE Vercel project handles all client subdomains. Each subdomain added as a "Custom Domain" in Vercel project settings. Vercel handles SSL automatically for each.

### Database tenant table

```sql
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_slug TEXT NOT NULL UNIQUE,            -- e.g., 'e4-construction'
  subdomain TEXT NOT NULL UNIQUE,              -- e.g., 'seo.e4roofing.com'
  business_name TEXT NOT NULL,
  legal_name TEXT,
  primary_phone TEXT NOT NULL,
  primary_email TEXT NOT NULL,
  primary_address JSONB NOT NULL,              -- {street, city, state, zip, country}
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  gbp_place_id TEXT,                            -- Google Maps place ID for embed
  gbp_cid TEXT,                                 -- Google Customer ID for review fetching
  gbp_url TEXT,
  main_domain TEXT NOT NULL,                   -- e.g., 'e4roofing.com'
  logo_url TEXT,
  brand_primary_color TEXT,
  brand_secondary_color TEXT,
  brand_voice_notes TEXT,
  license_number TEXT,
  license_state TEXT,
  insurance_info TEXT,
  bbb_rating TEXT,
  certifications JSONB,                         -- array of {name, badge_url}
  years_in_business INTEGER,
  tier TEXT NOT NULL CHECK (tier IN ('starter', 'growth', 'authority')),
  service_areas JSONB NOT NULL,                -- array of cities/neighborhoods served
  primary_services JSONB NOT NULL,             -- array of services offered
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,                          -- e.g., 'storm-damage-roof-repair-georgetown-tx'
  target_keyword TEXT NOT NULL,
  target_city TEXT NOT NULL,
  target_state TEXT NOT NULL,
  target_neighborhoods JSONB,                  -- array
  page_title TEXT NOT NULL,                    -- meta title tag
  meta_description TEXT NOT NULL,
  h1 TEXT NOT NULL,
  body_markdown TEXT NOT NULL,                 -- full page body in markdown
  hero_image_url TEXT,
  gallery_images JSONB,                        -- array of {url, alt_text}
  faq_items JSONB,                              -- array of {question, answer}
  testimonials JSONB,                          -- array of {name, location, rating, text, date}
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')) DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  indexation_status TEXT CHECK (indexation_status IN ('not_submitted', 'submitted', 'indexed', 'not_indexed')) DEFAULT 'not_submitted',
  indexation_submitted_at TIMESTAMPTZ,
  indexation_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, slug)
);

CREATE INDEX idx_pages_client ON public.pages(client_id);
CREATE INDEX idx_pages_status ON public.pages(status);
```

---

## 3. Page Render Order (Top to Bottom)

Each generated page renders in this exact order:

### 3.1 Document Head
- `<title>` — from `pages.page_title`
- Meta description — from `pages.meta_description`
- Canonical URL — `https://{client.subdomain}/{page.slug}`
- Meta robots: `index, follow`
- Meta viewport (mobile)
- Geo meta tags: `geo.region`, `geo.placename`, `geo.position`
- Open Graph tags: `og:title`, `og:description`, `og:image`, `og:url`, `og:type=website`
- Twitter card meta tags
- Favicon (per-client from `clients.logo_url` or default)

### 3.2 JSON-LD Schema (Inline in `<head>`)
- LocalBusiness or RoofingContractor schema (from client data)
- Service schema (specific to this page's target service)
- FAQPage schema (from `pages.faq_items`)
- BreadcrumbList schema
- Review schema (if testimonials present)

### 3.3 Page Body Components (in order)

**1. Sticky Mobile Call Button (mobile only, fixed position)**
- Phone icon + "Call Now" + phone number
- `<a href="tel:{phone}">` for native dialer

**2. Header**
- Client logo (left)
- NAP block (center): business name, address, phone
- Click-to-call button (right, desktop) — large CTA "Call Now: {phone}"

**3. Breadcrumbs**
- Home > Service Areas > {State} > {City} > {Service}
- Each level linked

**4. Hero Section**
- H1 with target keyword + city (e.g., "Storm Damage Roof Repair in Georgetown, TX")
- Subheadline (one sentence describing the offering)
- Primary CTA button: "Get a Free Estimate"
- Secondary text: "Or call us now: {phone}"
- Hero image (from `pages.hero_image_url` or first gallery image)

**5. Trust Signals Bar**
- Years in business
- License number + state
- Insurance status
- BBB rating (if available)
- Certifications (badges)

**6. Body Content (markdown rendered)**
- Rendered from `pages.body_markdown`
- Markdown supports H2, H3, lists, bold, italic, links, blockquotes
- Auto-inject 2-3 inline gallery images at midpoints
- Auto-inject inline CTA buttons every ~400 words ("Need help with X in {city}? Call us at {phone} or fill out the form below")

**7. Embedded Google Map**
- iframe embed from Google Maps using client's `gbp_place_id`
- Shows business pin
- Allow click-through to GBP

**8. Service Areas Section**
- "Neighborhoods We Serve in {City}"
- List of neighborhoods from `pages.target_neighborhoods`
- Internal links to other service-area pages serving the same neighborhoods if they exist

**9. Photo Gallery**
- 3-6 photos from `pages.gallery_images`
- Lazy-loaded
- Each with descriptive alt text
- Lightbox on click

**10. Testimonials**
- 2-4 reviews from `pages.testimonials` or fetched dynamically from GBP
- Reviewer name (first name + last initial), star rating, review text, date
- Review schema markup for rich snippet eligibility

**11. FAQ Section**
- 5-8 Q&A pairs from `pages.faq_items`
- Each Q is an H3
- Each A is rendered markdown
- FAQPage schema markup

**12. Mid-Page CTA Block**
- "Ready to fix your roof in {city}?"
- Lead form (Name, Phone, Email, Service Needed, Message)
- Submit goes to `/api/leads` → emails client → optional CRM webhook

**13. Related Pages**
- 3-5 internal links to sibling pages (same client, related cities or services)
- Auto-generated based on `client.service_areas`

**14. Footer**
- Logo
- Full NAP
- Quick links (service areas, services, about, contact)
- Link to client's MAIN DOMAIN (critical — passes authority back)
- Social media links (if provided)
- Operating hours
- License + insurance reiterated
- "© {year} {legal_name}. All rights reserved."

---

## 4. Component Specifications

### 4.1 LocalBusinessSchema Component

Renders JSON-LD in head. Output:

```json
{
  "@context": "https://schema.org",
  "@type": "RoofingContractor",
  "name": "{business_name}",
  "image": "{logo_url}",
  "@id": "https://{main_domain}/#organization",
  "url": "https://{main_domain}",
  "telephone": "{primary_phone}",
  "email": "{primary_email}",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "{street}",
    "addressLocality": "{city}",
    "addressRegion": "{state}",
    "postalCode": "{zip}",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": {latitude},
    "longitude": {longitude}
  },
  "openingHoursSpecification": [/* from client config */],
  "sameAs": [/* social URLs */],
  "areaServed": [/* array of cities served */],
  "priceRange": "$$",
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "{avg_rating}",
    "reviewCount": "{review_count}"
  }
}
```

### 4.2 ServiceSchema Component

```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "serviceType": "{target_keyword}",
  "provider": { "@id": "https://{main_domain}/#organization" },
  "areaServed": {
    "@type": "City",
    "name": "{target_city}",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "{target_city}",
      "addressRegion": "{target_state}"
    }
  },
  "description": "{meta_description}"
}
```

### 4.3 FaqSchema Component

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "{question}",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "{answer}"
      }
    }
  ]
}
```

### 4.4 LeadForm Component

Fields:
- Name (required, text)
- Phone (required, tel format)
- Email (required, email format)
- Service Needed (optional dropdown from client's primary_services)
- Brief Message (optional, textarea, 500 char max)
- Submit button

On submit:
- Client-side validation
- POST to `/api/leads` with payload + client_id (from subdomain)
- API route validates + saves to `leads` table + emails client
- Show success message inline (don't redirect — preserves analytics)

### 4.5 GbpMap Component

```html
<iframe
  src="https://www.google.com/maps/embed/v1/place?key={MAPS_EMBED_API_KEY}&q=place_id:{gbp_place_id}"
  width="100%"
  height="400"
  style="border:0;"
  allowfullscreen=""
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
  title="{business_name} on Google Maps"
></iframe>
```

---

## 5. Database Schema for Leads

```sql
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  page_id UUID REFERENCES public.pages(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  service_requested TEXT,
  message TEXT,
  user_agent TEXT,
  ip_hash TEXT,                                -- hashed for privacy
  forwarded_to_client_at TIMESTAMPTZ,
  client_response_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('new', 'forwarded', 'qualified', 'closed_won', 'closed_lost')) DEFAULT 'new',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_client ON public.leads(client_id);
CREATE INDEX idx_leads_status ON public.leads(status);
```

---

## 6. Sitemap Generation

Per-subdomain sitemap.xml automatically generated at `/sitemap.xml`. Includes:
- Homepage (subdomain root)
- All published pages with `<lastmod>` and `<priority>`
- Updated dynamically when new pages publish

```typescript
// src/app/sitemap.ts
import { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant/resolve-tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const headersList = await headers();
  const host = headersList.get('host')!;
  const client = await resolveTenant(host);
  
  const supabase = createServiceRoleClient();
  const { data: pages } = await supabase
    .from('pages')
    .select('slug, updated_at')
    .eq('client_id', client.id)
    .eq('status', 'published');
  
  const base = `https://${client.subdomain}`;
  
  return [
    { url: base, lastModified: new Date(), priority: 1.0 },
    ...pages!.map(p => ({
      url: `${base}/${p.slug}`,
      lastModified: new Date(p.updated_at),
      priority: 0.8
    }))
  ];
}
```

---

## 7. Robots.txt Generation

```typescript
// src/app/robots.ts
import { MetadataRoute } from 'next';
import { headers } from 'next/headers';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers();
  const host = headersList.get('host')!;
  
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `https://${host}/sitemap.xml`
  };
}
```

---

## 8. Indexation Submission

After each page publishes, submit to Google Search Console via URL Inspection API.

Manual phase: operator pastes URL into GSC interface, clicks "Request Indexing".

Automated phase (Tarritrix 9.0 revival): use `googleapis` Node library + service account credentials to programmatically request indexing.

---

## 9. Performance Targets

- LCP (Largest Contentful Paint) < 2.5s on 4G mobile
- INP (Interaction to Next Paint) < 200ms
- CLS (Cumulative Layout Shift) < 0.1
- Total page weight < 1MB (excluding embedded map iframe)
- Time to Interactive < 3.5s

Achieved via:
- Next.js Image component for all images (auto WebP, lazy load, responsive sizes)
- Tailwind CSS purged at build time
- No unnecessary JavaScript on the page (forms use native browser validation + minimal hydration)
- Mapbox/Google Maps iframe lazy-loaded only when scrolled into view
- Font loading optimized (`font-display: swap`)

---

## 10. Mobile Responsiveness Requirements

- Mobile-first design — every component built mobile-first
- Sticky bottom call button on mobile (`position: fixed`)
- Forms full-width on mobile
- Touch targets minimum 44x44px (Apple HIG guideline)
- No horizontal scroll at any viewport
- Tested on iPhone SE viewport (375px wide) as smallest target

---

## 11. SEO Requirements Checklist (Per-Page)

Every published page must satisfy ALL of these. Build a Vitest test that verifies each:

- [ ] H1 exists, contains target keyword
- [ ] Title tag 55-60 characters
- [ ] Meta description 150-160 characters
- [ ] Canonical URL self-referencing
- [ ] LocalBusiness schema present and valid
- [ ] Service schema present and valid
- [ ] FAQ schema present (if FAQ section exists)
- [ ] Breadcrumb schema present
- [ ] All images have alt text
- [ ] All images < 200KB after WebP conversion
- [ ] Internal links to at least 3 sibling pages
- [ ] External link to client's main domain
- [ ] Embedded GBP map present
- [ ] Click-to-call link in header AND footer (mobile + desktop)
- [ ] Lead form present and functional
- [ ] Mobile responsive (auto-test via Playwright at 375px viewport)
- [ ] LCP < 2.5s (auto-test via Lighthouse CI)
- [ ] No broken links (auto-test via link checker)
- [ ] HTTPS only (Vercel automatic)

---

## 12. Manual Phase vs Automated Phase

### Manual Phase (Now Through ~10 Clients)

For each new page:
1. Operator writes a `PAGE_CONTENT_BRIEF` (see separate template file)
2. Operator drafts content via ChatGPT-assisted workflow
3. Operator manually inserts row into `pages` table via Supabase dashboard or admin UI
4. Vercel auto-deploys, page renders from database

### Automated Phase (After Tarritrix 9.0 Revival)

Agents handle Steps 1-3:
- A-03 Schema Generator generates page meta, schema markup, FAQ structure
- A-04 Map Embed pulls GBP place ID, generates iframe config
- A-05 Page Validator runs the 19-point checklist before publish
- CRON-01 Drip Publisher inserts rows on schedule based on client tier

Same page template renders both manual and automated pages. Same database. Same Vercel project.

---

## 13. Build Time Estimate for Page Template Project

This is a separate small Next.js project. Total build time:

- **Day 1:** Project scaffolding + multi-tenant routing + database schema (8-10 hours)
- **Day 2:** All page components + schema generation (8-10 hours)
- **Day 3:** Sitemap, robots, lead form API, indexation submission (6-8 hours)
- **Day 4:** Polish, mobile testing, performance tuning, first client subdomain live (6-8 hours)

**Total: 28-36 hours of focused work (~4 working days).**

This is your "Plan B" if audit MVP conversions are slow — gives you a complete manual fulfillment platform you can sell to anyone.

---

## End of File
