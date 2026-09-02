# SPEC_HOMEPAGE.md
## AFS — Homepage
**Phase 3**
**Route:** `/`

---

## 1. STRATEGIC PURPOSE

Four audiences land on the homepage. Each must be qualified within 3 seconds:

1. **Roofing contractor** — "I can submit a quote request without calling"
2. **Architect / specifier** — "I can get spec language and CAD details here"
3. **Project manager / GC** — "I can track orders and schedule deliveries here"
4. **First-time visitor** — "This is a precision fabricator I can trust"

Every section either advances one of these goals or does not belong on the page.

---

## 2. PAGE SECTIONS (IN ORDER)

```
1.  NavBar (fixed, 64px)
2.  HeroSection
3.  TrustBar
4.  ThreePillarsSection
5.  AIQuoteTeaser
6.  HowItWorksSection
7.  StatSection
8.  ProductCategoryGrid
9.  ArchitectCTASection
10. ProjectGallery
11. TestimonialsSection
12. FinalCTASection
13. Footer
```

---

## 3. SECTION SPECIFICATIONS

### HeroSection

```
Layout: Full viewport height (min-h-screen)
Background: bg-afs-bg-base
Diagonal line pattern (CSS, no image file):
  background-image: repeating-linear-gradient(
    -12deg, transparent, transparent 40px,
    rgba(107,122,148,0.04) 40px, rgba(107,122,148,0.04) 41px
  );
Two-column desktop (60/40): stacked mobile

LEFT COLUMN:
  Eyebrow: font-label text-afs-crimson text-sm tracking-widest uppercase
    "CUSTOM SHEET METAL FABRICATION"

  H1: font-display text-[7rem] leading-none text-afs-chrome-high
    "PRECISION FLASHING."
    "BUILT TO SPEC."
    (forced line break between lines)

  Subheadline: font-body text-xl text-afs-chrome-mid max-w-lg mt-6
    "Upload your blueprint and get a formal quote from AFS.
     No phone calls. No waiting. Exact specifications every time."

  CTA group (mt-10 flex gap-4 flex-wrap):
    Primary: "Upload Your Drawing" → /upload
      Crimson, metal-edge-red, shadow-crimson, px-8 py-4
    Secondary: "Request a Quote" → /quote
      Border border-[var(--afs-border)] text-afs-chrome-mid px-8 py-4

  Microcopy below CTAs:
    font-body text-sm text-afs-chrome-base
    "DWG · DXF · PDF · Images accepted"

RIGHT COLUMN (desktop only):
  HeroVisual.tsx — animated CSS mockup
  NO external images required
  Shows: simplified TakeoffResultsTable preview with 3–4 sample rows
  Rows animate in with staggered fade-up (150ms between each)
  Chrome border frame — metal-edge treatment
  "AFS-QR-2026-00001 · Quote request submitted" confirmation badge
```

### TrustBar

```
Full-width band: bg-afs-bg-raised border-y border-[var(--afs-border)]
Height: 56px
Content (separator-divided, centered):
  "SMACNA Standards Compliant"  |  "Custom In-House Fabrication"
  |  "Ships Nationwide"  |  "AI-Powered Quoting"
Font: font-label text-sm text-afs-chrome-dim
Horizontal scroll on mobile
BLOCKED: Industry certifications (checklist #8) added when received
```

### ThreePillarsSection

```
bg-afs-bg-surface py-24
Three PillarCard in equal-width row (desktop), stacked (mobile)

PillarCard 1 — Quote Without Calling:
  Icon: blueprint/drawing SVG (inline, afs-chrome-base)
  Heading: font-heading text-3xl text-afs-chrome-high "Quote Without Calling"
  Body: "Upload blueprints, configure custom profiles, and submit specifications
         — all without picking up the phone. Our team responds with a formal quote."
  CTA: "Submit a Drawing →" → /upload

PillarCard 2 — The Architect's Platform:
  Icon: specification document SVG
  Heading: "The Architect's Platform"
  Body: "CSI Division 07 spec sections written by AI, AutoCAD fabrication details,
         and Revit families for every profile we make."
  CTA: "Enter Architect Portal →" → /architects
  Accent: copper border-l-2 border-afs-copper (copper, not crimson)

PillarCard 3 — Full Visibility, Every Order:
  Icon: production timeline SVG
  Heading: "Full Visibility, Every Order"
  Body: "Track your order from fabrication queue through delivery.
         See every production stage. Know exactly when your material ships."
  CTA: "See How Tracking Works →" → /account (if auth) or /register

Card styling: bg-afs-bg-raised border border-[var(--afs-border)] rounded p-8 metal-edge
Hover: border-afs-chrome-dim transition-colors duration-200
```

### AIQuoteTeaser

```
bg-afs-bg-base py-24
Two-column alternating: text left, visual right

LEFT (text):
  Eyebrow: "AI-POWERED TAKEOFF"
  H2: font-display text-6xl text-afs-chrome-high "Your Blueprint Becomes a Quote"
  Body: "Our AI reads DWG, DXF, and PDF drawings — identifying every coping cap,
         base flashing, counter flashing, and drip edge. Quantities extracted.
         Dimensions verified. Quote request submitted in under two minutes."
  Feature list (4 items, crimson check icons):
    "Supports DWG, DXF, PDF, and image uploads"
    "Identifies profile types, materials, and dimensions automatically"
    "AI flags low-confidence items for your review"
    "Converts directly to an AFS quote request — no re-entry"
  CTA: "Upload a Drawing" → /upload

RIGHT (visual):
  Static CSS representation of ProcessingStatusPanel
  Stage 3 (calculating) shown as active — pulsing
  metal-edge frame
```

### HowItWorksSection

```
bg-afs-bg-surface py-20
Section header:
  font-display text-5xl text-afs-chrome-high centered "HOW IT WORKS"
  font-body text-afs-chrome-mid centered mt-3
  "From drawing to delivered — four steps."

Four HowItWorksStep components:
  Horizontal desktop with connector lines
  Vertical stacked mobile

Step 1 — Upload Your Drawing
  "01" — font-display text-7xl text-afs-crimson/20 (background watermark)
  Icon: upload arrow SVG
  Title: font-heading text-xl text-afs-chrome-high
  Body: "DWG, DXF, PDF, or a photo. Any format works."

Step 2 — AI Reads Your Plans
  "02"
  Title: "AI Reads Your Plans"
  Body: "Identifies every flashing profile, dimension, and quantity automatically."

Step 3 — AFS Quotes You
  "03"
  Title: "AFS Quotes You"
  Body: "Our team reviews your specification and sends a formal quote to your account."

Step 4 — Order and Track
  "04"
  Title: "Order and Track"
  Body: "Approve the quote, place your order, and watch fabrication in real time."

Connector between steps: 1px horizontal line in afs-border (desktop only)
```

### StatSection

```
bg-afs-bg-base py-16
Three StatBlock centered in a row

Stat 1: "48HR" / "Standard Lead Time"
Stat 2: "2MIN" / "AI Quote Turnaround"
Stat 3: "50+" / "Profile Types Fabricated"

StatBlock:
  Number: font-display text-8xl text-afs-chrome-high
  Label: font-label text-sm text-afs-chrome-base tracking-widest uppercase mt-2
```

### ProductCategoryGrid

```
bg-afs-bg-surface py-20
Section header: font-display text-5xl text-afs-chrome-high "WHAT WE FABRICATE"
3×2 grid desktop, 2×3 tablet, 1 column mobile

Six CategoryCard:
  Coping Caps → /products/coping-caps
  Base & Counter Flashing → /products/base-flashing
  Step & Valley Flashing → /products/step-flashing
  Drip Edge & Gravel Stop → /products/drip-edge
  Expansion Joints → /products/expansion-joints
  Custom Profiles → /configure

CategoryCard:
  aspect-ratio: 4/3
  CSS gradient background (no photography required):
    Each category has unique gradient from afs-bg-raised tones
  Dark gradient overlay: bg-gradient-to-t from-afs-bg-dim/90 to-transparent
  Category name: font-display text-3xl text-afs-chrome-high absolute bottom-6 left-6
  Arrow: afs-crimson absolute bottom-6 right-6
  metal-edge treatment
  Hover: scale-[1.02] transition-transform border-afs-chrome-dim
```

### ArchitectCTASection

```
bg-afs-bg-raised py-20 border-y border-[var(--afs-border)]

Content container: border-l-4 border-afs-copper pl-8

Eyebrow: font-label text-afs-copper text-sm tracking-widest "FOR ARCHITECTS & SPECIFIERS"
H2: font-display text-6xl text-afs-chrome-high "Specify AFS. Get the Details You Need."
Body: font-body text-afs-chrome-mid text-lg max-w-2xl
  "AI-generated CSI Division 07 spec sections. AutoCAD fabrication details.
   Revit families for every profile. Everything an architect needs to specify AFS
   products — available for download."

CTA group:
  Primary: "Enter Architect Portal" → /architects
    bg-afs-copper hover:bg-afs-copper-hover (copper, not crimson — architect section)
  Secondary: "Generate a Spec Section" → /architects/spec-writer
    border border-[var(--afs-border)] text-afs-chrome-mid
```

### ProjectGallery

```
bg-afs-bg-base py-20

Section header:
  font-display text-5xl text-afs-chrome-high "BUILT WITH AFS"
  font-body text-afs-chrome-base "Projects across Texas and the nation"

Masonry-style grid, 3 columns desktop
Photography: BLOCKED (checklist #9)
Current: afs-bg-surface colored blocks at various aspect ratios
Each block has hover overlay with placeholder project type text

When photography received: images replace CSS blocks
Hover overlay: bg-afs-bg-dim/70 backdrop-blur-sm
  Project type: font-label text-sm text-afs-chrome-high
  Location: font-body text-xs text-afs-chrome-mid
```

### TestimonialsSection

```
bg-afs-bg-surface py-20

Three TestimonialCard in equal-width row

Placeholder testimonials until real quotes received (checklist #67):
  Card 1: Roofing Contractor — Dallas, TX
    "We used to wait three days for a quote. Now I upload the drawings at 7am
     and have pricing before my 10am client meeting."
  Card 2: Architect — Austin, TX
    "The CSI spec generator saved me two hours on a Division 07 section.
     I edited maybe 10 percent of what it produced."
  Card 3: General Contractor — Houston, TX
    "Real-time fabrication tracking changed how we schedule crews.
     We know exactly when to show up."

TestimonialCard:
  bg-afs-bg-raised border border-[var(--afs-border)] rounded p-8
  Opening quote mark: font-display text-6xl text-afs-crimson leading-none
  Quote: font-body text-afs-chrome-mid italic
  Attribution: font-label text-sm text-afs-chrome-base mt-4
```

### FinalCTASection

```
bg-afs-crimson py-20 metal-edge metal-edge-red (on section borders)

Centered content:
  H2: font-display text-6xl text-white "READY TO GET STARTED?"
  Body: font-body text-white/80 text-lg
    "Submit a drawing or request a quote manually. No account required to start."

CTA group (centered, gap-4):
  Primary: "Upload a Drawing" → /upload
    bg-white text-afs-crimson hover:bg-afs-chrome-high font-label font-semibold
  Secondary: "Request a Quote" → /quote
    border-2 border-white text-white hover:bg-white/10 font-label font-semibold
```

---

## 4. PLACEHOLDER CONTENT POLICY

These sections render correct structure and styling with placeholder content.
Content replaces when real data arrives. Nothing shows broken or empty.

| Section | Placeholder | Unlocked by |
|---|---|---|
| TrustBar certifications | 4 static trust signals | Checklist #8 |
| ProductCategoryGrid images | CSS gradient backgrounds | Checklist #9 |
| ProjectGallery | Colored CSS blocks | Checklist #9 |
| Testimonials | Generic contractor/architect quotes | Checklist #67 |
| Stats | Hard-coded positioning claims | N/A — never changes |

---

## 5. PERFORMANCE

- No external images — all CSS placeholders until photography delivered
- LCP target: < 2.5 seconds
- CLS: 0 — fonts loaded via next/font swap, no layout shift
- No third-party scripts on homepage
- Hero visual: pure CSS animation, no JavaScript required for initial paint
- `prefers-reduced-motion` respected — animations disabled

---

## 6. METADATA

```typescript
export const metadata: Metadata = {
  title: 'AFS — Architectural Flashing Supply | Custom Sheet Metal Fabrication',
  description: 'Upload your blueprint and receive a formal AFS quote. Custom coping caps, base flashing, drip edge, and more — fabricated to exact specification.',
};
```

---

## 7. PLAYWRIGHT TESTS

```typescript
test('homepage renders H1', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
});

test('Upload Drawing CTA navigates to /upload', async ({ page }) => {
  await page.goto('/');
  await page.click('text=Upload Your Drawing');
  await expect(page).toHaveURL('/upload');
});

test('Request a Quote CTA navigates to /quote', async ({ page }) => {
  await page.goto('/');
  await page.click('text=Request a Quote');
  await expect(page).toHaveURL('/quote');
});

test('Architect Portal CTA navigates to /architects', async ({ page }) => {
  await page.goto('/');
  await page.click('text=Enter Architect Portal');
  await expect(page).toHaveURL('/architects');
});

test('no prices on homepage', async ({ page }) => {
  await page.goto('/');
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\$[\d,]+\.\d{2}/);
});

test('homepage passes basic accessibility checks', async ({ page }) => {
  await page.goto('/');
  const images = await page.locator('img').all();
  for (const img of images) {
    await expect(img).toHaveAttribute('alt');
  }
});
```

---

*SPEC_HOMEPAGE.md | AFS | Reid Whitesides | June 2026*
