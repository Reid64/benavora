# benavora — DESIGN SYSTEM (FORGE × UI/UX Pro Max)

- **Generated:** 2026-06-12T18:03:13.507Z
- **Last revised:** 2026-07-07 — replaced the podcast-platform generator output with the benavora brand system (nonprofit grant management SaaS).
- **Source:** Hand-maintained brand system, derived from the benavora logo palette.

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

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#0077B6` | `--color-accent` |
| Secondary | `#00B4D8` | `--color-secondary` |
| Background | `#F8FAFC` | `--color-page` |
| Surface | `#FFFFFF` | `--color-surface` |
| Surface-2 | `#EFF6FF` | `--color-surface-elevated` |
| Sidebar | `#0F172A` | `--color-sidebar` |
| Text | `#0F172A` | `--color-text-primary` |
| Text-muted | `#64748B` | `--color-text-muted` |
| Border | `#E2E8F0` | `--color-border` |
| CTA gradient | `#00B4D8 → #0077B6` | `--color-cta-from` / `--color-cta-to` |

**Color Notes:** Deep navy-cyan primary with a bright cyan secondary, on light neutral surfaces. Sidebar stays a fixed deep navy regardless of theme, echoing the logo mark. Trustworthy, professional, calm — appropriate for a nonprofit-facing funding platform, not a consumer or entertainment product.

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

```css
/* Primary Button */
.btn-primary {
  background: linear-gradient(135deg, #00B4D8 0%, #0077B6 100%);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: filter 200ms ease, box-shadow 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  filter: brightness(0.94);
  box-shadow: 0 4px 14px -4px rgba(0, 119, 182, 0.45);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #0077B6;
  border: 2px solid #0077B6;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
}

.card:hover {
  border-color: #CBD5E1;
  box-shadow: var(--shadow-lg);
}
```

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

```css
.sidebar {
  background: #0F172A;
  color: #F8FAFC;
  width: 240px;
}

.sidebar-item.active {
  background: rgba(248, 250, 252, 0.1);
  color: #FFFFFF;
}

.sidebar-item .accent-bar {
  background: #00B4D8;
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
