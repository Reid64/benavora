# benavora — DESIGN SYSTEM (FORGE × UI/UX Pro Max)

- **Generated:** 2026-06-12T18:03:13.507Z
- **Last revised:** 2026-07-07 (color & polish pass) — added `ColorIcon` (`src/components/ui/ColorIcon.tsx`), a categorical hue-per-function icon-chip system (cyan/emerald/blue/amber/violet/indigo/rose), applied to dashboard stat cards, draft templates, research source cards, and Intelligence Library stat tiles, each paired with a matching `border-l-4` accent. Fixed the draft-generator editor's height (global `textarea{max-height:120px}` base style was silently clamping it — see Inputs section below). Supersedes the same-day intensity-pass revision below it in this history, which darkened the canvas background, added `surface-sunken`, rebuilt `secondary` buttons as a visible gray chip, and added the shared `PageHeader`.
- **Source:** Hand-maintained brand system, derived from the benavora logo palette. Canonical values live in `src/app/globals.css` (CSS custom properties) and `tailwind.config.ts` (Tailwind color keys reading the same variables) — this file is a summary for prompt-injection use, not the source of truth; if the two disagree, the code wins.

> FORGE injects this document into EVERY UI prompt context during Phase 1B
> (FrontendArchitecture + InteractionMaps) and Phase 3 UI prompts, so all
> generated UI uses one consistent palette, type scale, spacing scale, shadow
> depths, and component spec.

---

# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** benavora
**Category:** Nonprofit Grant Management SaaS

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable | Tailwind class |
|------|-----|--------------|-----------------|
| Background (page canvas) | `#E2E8F0` | `--color-background` | `bg-background` |
| Surface | `#FFFFFF` | `--color-surface` | `bg-surface` |
| Surface-raised (nested/inset areas) | `#F8FAFC` | `--color-surface-raised` | `bg-surface-raised` |
| Surface-sunken (table headers, card header wells) | `#F1F5F9` | `--color-surface-sunken` | `bg-surface-sunken` |
| Sidebar (the ONLY intentionally dark surface) | `#0B1220` | `--color-sidebar` | `bg-sidebar` |
| Sidebar-active | `rgba(0,180,216,0.12)` | `--color-sidebar-active` | `bg-sidebar-active` |
| Primary | `#0077B6` | `--color-primary` | `bg-primary` / `text-primary` |
| Accent | `#00B4D8` | `--color-accent` | `bg-accent` / `text-accent` |
| Text | `#0F172A` | `--color-text` | `text-text` |
| Text-muted | `#475569` | `--color-text-muted` | `text-text-muted` |
| Border | `#E2E8F0` | `--color-border` | `border-border` |
| CTA gradient | `#00B4D8 → #0077B6` | `--color-cta-from` / `--color-cta-to` | n/a (used in `.btn-primary` only) |

**Semantic status pairs** (bg = 100-level tint, text = 700-level, border = 200-level of the same hue — consumed by `<Badge>`, never by raw Tailwind hue classes):

| Variant | Bg | Text | Border |
|---|---|---|---|
| success | `#DCFCE7` `bg-success-bg` | `#15803D` `text-success-text` | `#BBF7D0` `border-success-border` |
| warning | `#FEF3C7` `bg-warning-bg` | `#B45309` `text-warning-text` | `#FDE68A` `border-warning-border` |
| error | `#FEE2E2` `bg-error-bg` | `#B91C1C` `text-error-text` | `#FECACA` `border-error-border` |
| info | `#E0F2FE` `bg-info-bg` | `#0369A1` `text-info-text` | `#BAE6FD` `border-info-border` |
| neutral | `bg-surface-raised` | `text-text-muted` | `border-border` |

**Color Notes:** Deep navy-cyan primary with a bright cyan accent, on light neutral surfaces. Sidebar stays a fixed near-black navy regardless of theme, echoing the logo mark — it is the **only** deliberately dark element in the app; every page body, panel, card, and modal is light. Trustworthy, professional, calm — appropriate for a nonprofit-facing funding platform, not a consumer or entertainment product.

**Three-layer tonal structure** (every dashboard page): 1) gray canvas (`bg-background`, `#E2E8F0`) — darker than a pure near-white so white cards read with real contrast, not washed out; 2) white header band (`PageHeader`, `border-slate-200`) separating the page title from the canvas; 3) white cards (`Card`, `border-slate-200`, `shadow-sm`) with a `bg-surface-sunken` header well for titled panels. Table headers use the same `surface-sunken` tint.

### Typography

- **Heading Font:** Plus Jakarta Sans
- **Body Font:** Inter
- **Mood:** professional, clear, trustworthy, modern, approachable
- **Google Fonts:** [Plus Jakarta Sans + Inter](https://fonts.google.com/share?selection.family=Plus+Jakarta+Sans:wght@500;600;700;800|Inter:wght@400;500;600;700)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
```

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(15,23,42,0.04)` | Subtle lift |
| `--shadow-md` | `0 4px 12px rgba(15,23,42,0.06)` | Cards, buttons |
| `--shadow-lg` | `0 10px 24px rgba(15,23,42,0.10)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 40px rgba(15,23,42,0.14)` | Hero images, featured cards |

---

## Component Specs

### Buttons

Canonical implementation: `src/components/ui/Button.tsx`, four variants. `secondary` and `ghost` were dark-theme leftovers (`border-white/15 bg-white/5 text-navy-100` / `text-navy-300 hover:text-white`) that rendered invisible on the light background until fixed 2026-07-07 — never reintroduce translucent-white or `text-white`-on-hover styling for these variants. `primary` is the default for every card CTA — Run, Apply, Add to Queue, Re-score, not just form submits; don't leave these as faint outlines.

```css
/* Primary — solid brand fill, the default for every card CTA */
.btn-primary {
  background: #0077B6; /* bg-primary */
  color: white;
  border-radius: 8px;
  font-weight: 500;
  box-shadow: var(--shadow-sm);
}
.btn-primary:hover { background: #005F92; /* hover:bg-primary-hover */ }

/* Secondary — a visible GRAY CHIP, never a primary-tinted outline or
   borderless white-on-white. */
.btn-secondary {
  background: #F1F5F9; /* bg-slate-100 */
  color: #334155; /* text-slate-700 */
  border: 1px solid #CBD5E1; /* border-slate-300 */
  border-radius: 8px;
  font-weight: 500;
}
.btn-secondary:hover { background: #E2E8F0; /* hover:bg-slate-200 */ }

/* Ghost — no border/bg of its own; reserve for buttons inside a colored
   header/banner that already provides definition. On the plain page
   background or a white card it has too little affordance on its own. */
.btn-ghost {
  color: #0077B6; /* text-primary */
}
.btn-ghost:hover { background: rgba(0, 119, 182, 0.1); /* hover:bg-primary/10 */ }

/* Danger */
.btn-danger {
  background: rgba(239, 68, 68, 0.9);
  color: white;
  border: 1px solid rgba(248, 113, 113, 0.3);
}
```

### Cards

Canonical implementation: `src/components/ui/Card.tsx`. Also used by `Modal.tsx`'s dialog surface. Never `bg-ink-*`, `glow-border`, or `backdrop-blur` — those were dark-glass leftovers purged 2026-07-07 (they had gone unnoticed in `Card`, `Modal`, `GrantDNACard`, `LogicModelView`, and `RubricPanel` since the original dark-theme build, silently rendering translucent near-black panels — with light `navy-100`-family text on top — on every page that used them).

```css
.card {
  background: #FFFFFF; /* bg-surface */
  border: 1px solid #E2E8F0; /* border-slate-200 */
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 200ms ease;
}

.card:hover {
  box-shadow: var(--shadow-md);
}

/* Titled panels (title/description/actions passed to <Card>) get a sunken
   header well distinct from the white body below. */
.card-header {
  background: #F1F5F9; /* bg-surface-sunken */
  border-bottom: 1px solid #E2E8F0; /* border-slate-200 */
  padding: 16px 20px;
}
```

### Page headers

Canonical implementation: `src/components/layout/PageHeader.tsx`. White band (`bg-surface`, `border-slate-200`, `shadow-sm`) at the top of every dashboard page's content — the first of the three tonal layers (gray canvas → white header band → white cards). Applied to `dashboard`, `research`, `opportunities`, `intelligence-library`, `autoapply` as of 2026-07-07; most other dashboard pages still hand-roll a bare `<div>` header (no white band) — migrate opportunistically, not yet a full sweep.

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  background: #FFFFFF;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.input:focus {
  border-color: #0077B6;
  outline: none;
  box-shadow: 0 0 0 3px rgba(0, 119, 182, 0.18);
}
```

**Textareas:** `globals.css` applies a global base `textarea { max-height: 120px; resize: vertical; }` — correct for small form fields (Mission Statement, notes), but it silently overrides any `rows` attribute. Any textarea meant to be large (an editor, not a form field) MUST explicitly override with a Tailwind class of higher specificity, e.g. `max-h-none min-h-[55vh] flex-1` — a `rows={N}` prop alone will not win against the CSS `max-height`. This bit the draft-generator editor once already (2026-07-07); don't reintroduce it elsewhere.

### Icon chips (ColorIcon)

Canonical implementation: `src/components/ui/ColorIcon.tsx`. One hue per **function**, applied consistently everywhere that function's icon appears — cyan = opportunities/search, emerald = money/funding, blue = documents/drafts, amber = deadlines/time, violet = analytics, indigo = applications, rose = alerts. Pair with `ICON_HUE_BORDER_CLASSES` for a matching `border-l-4` card accent. These are categorical/nominal colors for scanning, not brand accents — `violet` and `rose` here are an intentional, narrow exception to the "no purple accents" anti-pattern below; don't use violet/rose/etc. as a general page accent outside this icon-chip system.

```css
.icon-chip {
  display: flex;
  height: 40px; /* h-10, or 36px/h-9 for the "sm" size */
  width: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #CFFAFE; /* e.g. bg-cyan-100 */
  color: #0E7490; /* e.g. text-cyan-700 */
}
```

### Modals

```css
.modal-overlay {
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: #FFFFFF;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

### Sidebar

The only intentionally dark surface in the app — every other panel, card, and modal is light. Canonical implementation: `src/components/layout/Sidebar.tsx`.

```css
.sidebar {
  background: #0B1220; /* bg-sidebar */
  width: 256px;
}

.sidebar-item {
  color: #94A3B8; /* text-slate-400, inactive */
}
.sidebar-item:hover {
  color: #FFFFFF; /* hover:text-white */
}
.sidebar-item.active {
  background: rgba(0, 180, 216, 0.12); /* bg-sidebar-active */
  color: #00B4D8; /* text-accent */
}
```

---

## Style Guidelines

**Style:** Light, professional SaaS

**Keywords:** Light theme, clean, high contrast, trustworthy, navy and cyan, generous whitespace, data-dense but calm

**Best For:** Nonprofit operations tools, grant/funding workflows, dashboards, admin panels, document-heavy B2B SaaS

**Key Effects:** Subtle elevation via soft shadows (not glow), gradient reserved for primary CTAs and headline accents, visible focus rings, no heavy blur or dark glass effects on the page canvas

### Page Pattern

**Pattern Name:** Dashboard-First Application Shell

- **Structure:** Fixed deep-navy sidebar (240px) for primary navigation, light content canvas for tables, forms, and cards.
- **CTA Placement:** Primary action top-right of each page header; contextual actions inline on cards/rows.
- **Section Order (dashboard pages):** 1. Page header (title + primary action), 2. Key metrics / summary cards, 3. Primary data table or content, 4. Secondary panels / detail views.

---

## Anti-Patterns (Do NOT Use)

- ❌ Purple (`#7C3AED`) or orange (`#F97316`) accents — replaced by the navy-cyan brand palette
- ❌ OLED/near-black page backgrounds (`#0a0a1a`) — this product is light-theme by default
- ❌ Podcast/media-player UI patterns (audio players, episode feeds)
- ❌ `bg-ink-*`, `glow-border`, `backdrop-blur-md`, or the dark-tuned `shadow-card`/`shadow-card-hover` on any page-body panel, card, or modal — these are dark-glass leftovers from the pre-rebrand theme. The sidebar (`bg-sidebar`, `#0B1220`) is the ONLY intentionally dark surface in the app.
- ❌ Raw Tailwind hue classes on status/label pills (`bg-green-100 text-green-700`, etc.) — use `<Badge variant="success|warning|error|info|neutral">` from `src/components/ui/Badge.tsx` so bg/text/border stay in sync.
- ❌ `text-white`, `text-gray-200/300`, or other light text colors outside a genuinely dark/colored container (a solid button, a badge, a gradient avatar, an image overlay, the sidebar) — these go invisible on the light page background.
- ❌ Borderless `secondary`/`ghost` buttons that render as white-on-white — `secondary` is always a visible gray chip (`bg-slate-100 border-slate-300 text-slate-700`).
- ❌ Washed-out contrast: a near-white page canvas under white cards, faint outline-only CTAs, or missing sunken headers on titled panels — the canvas (`bg-background`, `#E2E8F0`) must read as visibly darker than card surfaces.

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio on light surfaces
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Text contrast 4.5:1 minimum on light surfaces
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
- [ ] No purple, orange, or OLED-black colors introduced
