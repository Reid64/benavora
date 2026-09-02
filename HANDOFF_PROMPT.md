# BRIGHT BOX HOMES — Session Handoff

You are resuming the Bright Box Homes website build. Read ALL governance files in the project before responding: GOVERNANCE_BRIEF.md, STATE_OF_THE_BUILD.md, BLUEPRINT.md, DESIGN_LANGUAGE.md, ARCHITECTURE.md, BEHAVIORAL_CONTRACTS.md, PRD.md, COMPONENTS.md, SCHEMA_REGISTRY.md.

## Current State

- **Repo:** Reid64/brightbox-homes (private GitHub), auto-deploying from main to Vercel
- **Live URL:** brightboxhomes.com (DNS via Vercel nameservers, SSL active)
- **Bypass URL:** https://brightbox-homes.vercel.app/?x-vercel-protection-bypass=AAGcUwvIWrqJegLoLoAef0nSyGaZ4c8h&x-vercel-set-bypass-cookie=true
- **Vercel project:** prj_GltdOfCFzAbZ7Bi3HfEPJ2Sj5IxX, scope reids-projects-b3405b97, root directory apps/web
- **Stack:** Next.js 15, pnpm monorepo, Tailwind CSS, TypeScript, Vercel
- **Cal.com:** wired via @calcom/embed-react, username reid-whitesides-bcg38n, event slug 30min
- **Email:** info@brightboxhomes.com on Zoho Mail (MX/SPF configured via Vercel DNS, DKIM pending)
- **Local path:** C:\Users\manag\Documents\brightbox-homes
- **Asset folder:** C:\Users\manag\Documents\brightbox-homes\website-products-and-assets\ (gitignored, 289 files)
- **Additional assets:** C:\Users\manag\Documents\BRIGHT BOX HOMES\ (external folder with more product images)
- **All product images at repo root** — hundreds of files uploaded, Claude Code should search here for any images needed

## What's Built

**Pages (27+ routes):**
- Homepage with hero, floating video PiP, product cards, stats bar, marquee, 4-step process, delivered homes, FAITH Foundation, final CTA
- Expandable Homes: overview landing + 4 size pages (20x10, 20x20, 20x30, 20x40) with side nav, floor plans, specs
- Duplex Homes: own top-level route (/products/duplex) with investment copy
- Apple Cabins: side nav, exterior/interior galleries, features (BEIGE cards test — approved at #D4C4A8 with dark container layer)
- Space Capsules: models with pricing from filenames, ad copy integrated
- Assembly Homes: named model showcase (Vantage, Prism, Vertex, Axis, Pavilion) with included features checklists
- Apartments & Office Buildings: separate from Assembly, real photos
- Vending Units: real + concept render gallery
- Emergency Housing (renamed from Foldout Homes): 5 infographics, cleaned-up images
- $5K Challenge: full content, 4-step process, fine print
- FAITH Foundation: full content, partnership details
- Design Your Home: step-by-step journey with red arrows sidebar, tab-switching content, color charts, roof pricing, truss video
- FAQ: 22 questions in 7 accordion categories with schema markup
- Blog: infrastructure built, 6 SEO posts (unrestricted land, true costs, legality, off-grid, vs traditional, what's included)
- About, Legal pages (privacy, terms, returns, warranty) — stubs
- /reserve — placeholder for Stripe deposit checkout

**Components:**
- ProductPageTemplate with sticky side nav (Option B)
- ProductSideNav with scroll-spy
- ImageGallery with lightbox
- ScrollReveal, AnimatedText, AnimatedCounter, TiltCard, ScrollProgress, Marquee
- BookConsultation (Cal.com modal)
- Button (3-tier: primary bb-blue, secondary, ghost + red Reserve variant)
- Header with nested Expandable Homes dropdown
- Footer with trust badges, legal disclosures, FAITH bar
- Favicon wired (pending deployment)

**Trust Badges (4):**
1. FAITH Foundation Partnership (gold/navy shield)
2. $2,500 Donated Per Home (green/gold seal)
3. Exclusive U.S. Distributor of Biogreen (navy/white)
4. American Owned. Globally Sourced. US Delivered. (flag badge)
- Placed: homepage strip, product page sidebars, footer

## Design Decisions Locked

- **Color scheme:** Dark premium with lighter backgrounds (#232B3A charcoal, #2C3546 surface-dark) — operator has been frustrated with "too dark" repeatedly, current values are a compromise
- **Beige feature cards:** #D4C4A8 on a darker container layer (#1A2030) — APPROVED by operator on Apple Cabins, needs to be rolled out to all product pages
- **CTAs:** Three tiers — "Book a Consultation" (bb-blue), "Get a Custom Quote" (bb-blue), "Reserve Your Home — $500" (red-500)
- **Brand colors:** --bb-blue #4A9BD9, --bb-navy #1B2D4F, --bb-blue-light #E8F2FB, --bb-blue-dark #2E6FA3
- **Typography:** Plus Jakarta Sans headings, Inter body, JetBrains Mono specs
- **Side nav:** Option B sticky sidebar on all product pages
- **"Book a Consultation"** removed from header (operator directive)
- **Phone icon:** red (#EF4444)
- **Step numbers:** red
- **Arrows between steps:** solid red SVG arrows
- **Anti-pattern #3 override:** ambient muted looping video allowed (hero, truss video)
- **Product naming:** Assembly Homes models named (Vantage, Prism, Vertex, Axis, Pavilion)
- **Expandable Homes pricing:** 20x10 $35,995 / 20x20 $45,995 / 20x30 $49,995 / 20x40 $59,995 / Duplex $59,995
- **Assembly Homes pricing:** $25,995-$29,995
- **Roof upgrade pricing:** 10' $1,995 / 20' $3,995 / 30' $4,995 / 40' $5,995
- **Carved metal plate exterior:** $1,000 upgrade

## Pending / Not Yet Done (Priority Order)

### HIGH — Operator Has Explicitly Requested These:

1. **Beige card rollout to ALL product pages** — approved on Apple Cabins, needs to be applied to feature cards and "Who It's For" cards on every product page
2. **Side nav STILL too far from left edge** — requested 5+ times, keeps not being fully fixed
3. **Side nav MISSING on Expandable Homes and Duplex pages** — regression, needs restoration
4. **Creative image captions on ALL product pages** — descriptive, marketing-oriented captions under every gallery image (the Cabana, the Shoreline, etc.)
5. **Bold model names in captions** — "**The Cabana** — description here"
6. **All images clickable to enlarge** — lightbox on every image including Assembly showcase cards
7. **Assembly Homes showcase images cut off** — need object-contain or taller containers
8. **Space Capsule fixes:** V9 duplicate → rename last to V5 at $44,995, add skylights mention, resort/investor content, move 2 Apple Cabin interiors out
9. **FAITH Foundation $2,500** — change to text-bb-blue
10. **Duplex page:** hero image too low/cut off, needs to be raised above fold, feature list (metal roof, porch, staircase, mini-splits), CTAs side by side under description not in sidebar
11. **Emergency Housing:** wrong image under "Product details", uneven infographic layout, needs reorganization
12. **Footer trust badges:** need to be max-h-20 (80px)
13. **Assembly Homes:** delete emergency folding home diagram that's incorrectly on the page
14. **Apartments page:** needs same frame/spec imagery as Assembly Homes
15. **Homepage apartment card image:** replace with new uploaded image (apartments-homepage-card.png)
16. **Favicon:** files created, need to be wired into layout.tsx and manifest.json
17. **Blog posts:** 6 written but content quality needs review, backdated "Originally published December 2024"
18. **Product-specific FAQ accordions** on each product page
19. **Upgrade options with images** from Google Sheet — photos didn't transfer (embedded images), Reid needs to re-upload upgrade product photos
20. **Structural framing images** — found and partially added, need verification on all product pages
21. **Homepage "Four Steps" section:** red arrows inconsistent between steps, step 4 text truncated

### MEDIUM — Discussed But Not Started:

22. **Acorn financing logo** — needs to be obtained and placed
23. **About page:** still a stub, needs real content
24. **Legal pages:** stubs, need real content (privacy, terms, returns, warranty)
25. **Stripe integration** for $500 deposit checkout (/reserve route)
26. **More delivered home photos** in the homepage section
27. **Product-specific upgrade specs** from Google Sheet data on every product page
28. **Assembly Homes interior photo** — needs to be found and added
29. **Emergency Housing specs** — old ones deleted, new correct specs needed

### LOW — Planned for Later Phases:

30. **Unrestricted Land Organization** — Series LLC, own website, added to BLUEPRINT.md Section 14
31. **FAITH Foundation website** — domain faithfoundationsf.org pointed to Vercel, no site yet
32. **Phase 1B Configurator** — standalone package, deferred
33. **Supabase integration** — lead capture, not yet built
34. **Stripe Connect** — full payment processing
35. **Rewardful affiliate system**
36. **Analytics** (GA, Clarity)
37. **SEO meta tags** — partial, needs completion across all pages
38. **Sitemap and robots.txt**
39. **Cal.com SMS notifications** — needs Zapier or Cal.com workflow setup
40. **brightboxhomes.com DNS** — working but was intermittent, may need verification

## Operator Working Style (Critical)

- **CONVERSATE FIRST, PROMPT ONLY WHEN ASKED.** Do NOT auto-generate Claude Code prompts. Discuss scope, get alignment, THEN produce one final prompt.
- Voice-to-text input — be tolerant of dictation artifacts
- HATES long explanations, YES MEN, and sycophancy
- Wants honest pushback and innovative ideas
- Gets frustrated when the same issue is requested multiple times without being fixed
- All development runs through Claude Code in Windows PowerShell (not Cursor terminal)
- Prefers full automation — don't ask him to manually move files when Claude Code can do it
- Design authority belongs to the OPERATOR, not governance docs — if he says change something, change it regardless of what DESIGN_LANGUAGE.md says
- Has pushed back on deceptive practices (fake orgs, Made in America badge, BBB badge) and expects honest counsel

## Key File Locations

- All product images: repo root + website-products-and-assets/ + C:\Users\manag\Documents\BRIGHT BOX HOMES\
- Floor plans: repo root (*FLOOR_PLAN*, *BEDROOM*.pdf)
- Color charts: repo root (EXTERIOR_HOUSE_COLORS, METAL_ROOF_COLORS, INTERIOR_HOUSE_COLORS, etc.)
- Structural frames: repo root (*FRAME* files)
- Trust badges: apps/web/public/images/badges/
- Logo: apps/web/public/images/logo.png (cropped transparent version)
- Hero video: apps/web/public/videos/hero-video.mp4
- Truss video: apps/web/public/videos/metal-roof-truss.mp4
- Favicon files: apps/web/public/ (favicon.ico, apple-touch-icon.png, favicon-192.png, favicon-512.png)

## Contact Info (Canonical)

- Phone: 800-259-1745
- Email: info@brightboxhomes.com
- CTA: "Book a Consultation" (exact, never abbreviated)
- Cal.com: reid-whitesides-bcg38n/30min
- Operator phone (notifications): 737-296-7444
- Operator email: reid@repvg.com
