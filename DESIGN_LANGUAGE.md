# DESIGN LANGUAGE — Bright Box Homes

Canonical visual system for all Bright Box Homes surfaces. Locked per GOVERNANCE_BRIEF.md Section 4 before any UI code is authored. Every component, page, and animation references this document as authoritative.

Cross-references: BLUEPRINT.md (brand positioning), ARCHITECTURE.md (component structure), PRD.md (feature requirements), BEHAVIORAL_CONTRACTS.md (engineering rules).

---

## 1. Brand Positioning Summary

**Brand:** Bright Box Homes — "American Owned. Globally Sourced. US Delivered."
**Visual register:** Warm Modern — clean, confident, premium but accessible. Not luxury-dark, not budget-bright.
**Competitive reference points:** Tesla (scroll choreography, image quality), Rivian (warmth, approachability), Cover (architectural product photography). NOT generic WordPress theme, NOT Boxabl's cluttered layouts.
**Emotional target:** "This company is serious, trustworthy, and builds beautiful homes I can afford."

---

## 2. Color Palette

### 2.1 Brand Colors (OPERATOR CONFIRM — derived from existing brand materials)

| Token | Hex | Usage |
|---|---|---|
| `--bb-blue` | `#4A9BD9` | Primary brand blue. CTAs, links, active states, hero accents. |
| `--bb-navy` | `#1B2D4F` | Authority color. Header, footer, headline text, dark backgrounds. |
| `--bb-blue-light` | `#E8F2FB` | Blue tint for backgrounds, hover states, card highlights. |
| `--bb-blue-dark` | `#2E6FA3` | Pressed states, visited links, active nav indicators. |

### 2.2 Neutral Palette

| Token | Hex | Usage |
|---|---|---|
| `--bb-white` | `#FFFFFF` | Page background, card surfaces. |
| `--bb-warm-white` | `#FAFAF7` | Alternating section backgrounds. Warm, not sterile. |
| `--bb-gray-100` | `#F3F4F6` | Input backgrounds, disabled states. |
| `--bb-gray-200` | `#E5E7EB` | Borders, dividers, table rules. |
| `--bb-gray-400` | `#9CA3AF` | Placeholder text, captions, metadata. |
| `--bb-gray-600` | `#4B5563` | Body text (secondary). |
| `--bb-gray-900` | `#111827` | Body text (primary), headlines on light backgrounds. |

### 2.3 Semantic Colors

| Token | Hex | Usage |
|---|---|---|
| `--bb-success` | `#16A34A` | Form success, payment confirmed, available slots. |
| `--bb-warning` | `#D97706` | Caution states, limited availability, form validation hints. |
| `--bb-error` | `#DC2626` | Form errors, failed states, destructive actions. |
| `--bb-info` | `#4A9BD9` | Aliases `--bb-blue`. Informational banners. |

### 2.4 Admin Dashboard Palette (Phase 1B)

Admin surfaces use the same token system but shift toward a denser, information-rich register per BLUEPRINT.md Section 10 ("Bloomberg/Palantir-grade").

| Token | Hex | Usage |
|---|---|---|
| `--admin-bg` | `#0F172A` | Dashboard background. Dark mode default. |
| `--admin-surface` | `#1E293B` | Cards, panels, sidebar. |
| `--admin-border` | `#334155` | Panel borders, table rules. |
| `--admin-text` | `#E2E8F0` | Primary text on dark. |
| `--admin-accent` | `#4A9BD9` | Same brand blue, carried into admin. |

### 2.5 Color Rules

- `--bb-blue` is NEVER used as a background fill for large areas (hero sections, full-width banners). It is an accent and interactive color only.
- Dark-on-light for marketing surfaces. Light-on-dark for admin surfaces.
- All text/background combinations must pass WCAG 2.1 AA contrast (4.5:1 body text, 3:1 large text).
- Product photography always on `--bb-white` or `--bb-warm-white` backgrounds. No colored backgrounds behind product images.
- The FAITH Foundation section uses `--bb-blue` paired with warm imagery, not a separate color system.

---

## 3. Typography

### 3.1 Type Stack

| Role | Family | Weight | Fallback Stack |
|---|---|---|---|
| Headings (marketing) | Plus Jakarta Sans | 700 (bold), 800 (extra-bold hero) | system-ui, -apple-system, sans-serif |
| Body (all surfaces) | Inter | 400 (regular), 500 (medium for emphasis) | system-ui, -apple-system, sans-serif |
| Monospace (specs, code) | JetBrains Mono | 400 | ui-monospace, monospace |

**Loading strategy:** Both fonts loaded via `next/font/google` with `display: swap`, `subsets: ['latin']`, and `preload: true`. Variable font files preferred for weight flexibility without extra network requests.

### 3.2 Type Scale (rem-based, 16px root)

| Token | Size | Line Height | Usage |
|---|---|---|---|
| `--text-hero` | 3.5rem (56px) | 1.1 | Homepage hero headline only. |
| `--text-h1` | 2.5rem (40px) | 1.2 | Page titles, section heroes. |
| `--text-h2` | 1.875rem (30px) | 1.25 | Section headings. |
| `--text-h3` | 1.5rem (24px) | 1.3 | Subsection headings, card titles. |
| `--text-h4` | 1.25rem (20px) | 1.35 | Feature labels, sidebar headings. |
| `--text-body` | 1rem (16px) | 1.6 | Body copy, descriptions, form labels. |
| `--text-sm` | 0.875rem (14px) | 1.5 | Captions, metadata, helper text, footer. |
| `--text-xs` | 0.75rem (12px) | 1.4 | Badges, legal fine print, admin table cells. |

### 3.3 Type Rules

- Maximum line length: 72ch for body copy. Enforced via `max-width` on text containers, not on layout wrappers.
- Headings are NEVER all-caps in marketing surfaces. Sentence case or title case only.
- Spec tables (dimensions, inclusions, pricing) use monospace for numeric columns.
- No font size below `--text-xs` (12px) anywhere on the site. Accessibility floor.
- Letter-spacing: 0 for body, -0.02em for hero/h1, +0.05em for `--text-xs` uppercase labels.

---

## 4. Spacing Scale

8px base grid. All spacing uses multiples of 4px for sub-grid alignment.

| Token | Value | Usage |
|---|---|---|
| `--space-1` | 4px | Tight icon-to-label gaps, inline badge padding. |
| `--space-2` | 8px | Input padding, small card internal gaps. |
| `--space-3` | 12px | Button padding (vertical), list item gaps. |
| `--space-4` | 16px | Standard element gap, card body padding. |
| `--space-6` | 24px | Card padding, form field gaps. |
| `--space-8` | 32px | Section internal padding (mobile). |
| `--space-12` | 48px | Section gaps (mobile), card group gaps. |
| `--space-16` | 64px | Section gaps (desktop). |
| `--space-24` | 96px | Hero padding, major section separation. |
| `--space-32` | 128px | Page-level top/bottom padding. |

Tailwind mapping: Use `p-1` through `p-32` via Tailwind config extending the default scale. Do NOT use arbitrary values (`p-[37px]`) except in one-off layout fixes.

---

## 5. Component Aesthetic Principles

### 5.1 Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 6px | Inputs, badges, small buttons, chips. |
| `--radius-md` | 10px | Cards, modals, dropdowns, tooltips. |
| `--radius-lg` | 16px | Hero cards, featured content blocks, image containers. |
| `--radius-full` | 9999px | Pill buttons, avatar circles, tag chips. |

No sharp corners (0px radius) on any interactive element. Minimum radius is `--radius-sm`.

### 5.2 Shadows

| Token | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.08)` | Cards at rest, inputs. |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.1)` | Cards on hover, dropdowns, popovers. |
| `--shadow-lg` | `0 12px 32px rgba(0,0,0,0.12)` | Modals, floating panels, hero feature cards. |
| `--shadow-inner` | `inset 0 2px 4px rgba(0,0,0,0.05)` | Pressed button states, input focus. |

Shadows are ALWAYS neutral (gray/black alpha). Never colored shadows. Never box-shadow on text.

### 5.3 Buttons

Three tiers, one canonical CTA copy:

| Tier | Style | Usage |
|---|---|---|
| Primary | Solid `--bb-blue` bg, white text, `--radius-sm` | "Book a Consultation" and deposit CTAs only. Max 1 per viewport. |
| Secondary | `--bb-blue` border, `--bb-blue` text, transparent bg | Alternative actions: "View Floor Plans," "Download Spec Sheet." |
| Ghost | No border, `--bb-blue` text, transparent bg | Tertiary links: "Learn more," nav items. |

**Canonical CTA copy:** "Book a Consultation" — exactly this text, every time, site-wide. Not "Book a Consult," not "Schedule a Call," not "Get Started." Enforced when UI is built per STATE_OF_THE_BUILD Entry 2 operator decision.

**Button sizing:** Minimum touch target 44x44px (WCAG 2.5.8). Horizontal padding minimum `--space-6`, vertical `--space-3`.

### 5.4 Cards

- White background (`--bb-white`) on warm sections (`--bb-warm-white`), warm background on white sections.
- `--shadow-sm` at rest, `--shadow-md` on hover with `transform: translateY(-2px)`.
- `--radius-md` corners.
- Image area has no internal padding; bleeds to card edges with `overflow: hidden` + top border-radius.
- Text area uses `--space-6` padding.

### 5.5 Forms

- Label above input, never floating/inside.
- Input height: 48px (desktop), 52px (mobile).
- Border: 1px `--bb-gray-200`, focus ring: 2px `--bb-blue`.
- Error state: border `--bb-error`, helper text below in `--bb-error` with `--text-sm`.
- Success state: border `--bb-success`, check icon inline.
- Honeypot field: `position: absolute; left: -9999px; tabindex: -1`. Per ARCHITECTURE.md Section 15.

---

## 6. Motion Language

### 6.1 Timing

| Token | Value | Usage |
|---|---|---|
| `--duration-fast` | 150ms | Hover states, tooltips, focus rings. |
| `--duration-normal` | 300ms | Page transitions, card hover lifts, dropdown opens. |
| `--duration-slow` | 500ms | Hero reveals, section scroll-in, modal overlays. |
| `--duration-hero` | 800ms | Homepage hero sequence, premium loading animations. |

### 6.2 Easing

| Token | Value | Usage |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Most UI transitions. Elements arriving. |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Symmetrical transitions (toggles, carousels). |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful micro-interactions (add-to-cart, notification badge). |

### 6.3 Scroll-Triggered Reveals

Marketing page sections use IntersectionObserver-triggered entrance animations. Pattern:

- **Default hidden state:** `opacity: 0; transform: translateY(24px);`
- **Revealed state:** `opacity: 1; transform: translateY(0);`
- **Timing:** `--duration-slow` with `--ease-out`.
- **Stagger:** Child elements stagger by 80ms each (e.g., 3 feature cards = 0ms, 80ms, 160ms).
- **Threshold:** `0.15` (trigger when 15% of element is visible).
- **Once:** Animations fire once, never replay on scroll-up.

### 6.4 Hero Loading Sequence (Premium)

Homepage hero follows a choreographed 3-beat entrance per BLUEPRINT.md Section 10:

1. **Beat 1 (0–400ms):** Background image fades in from 0% to 100% opacity.
2. **Beat 2 (300–700ms):** Headline slides up from +24px with `--ease-out`. Badge fades in at 500ms.
3. **Beat 3 (600–1000ms):** CTA button and supporting text fade up. Scroll indicator pulses.

Overlap is intentional — beats cascade, not sequence.

### 6.5 Motion Rules

- `prefers-reduced-motion: reduce` — all transitions become instant (0ms duration, no transforms). No exceptions.
- No auto-playing carousels. Product image galleries advance on user interaction only.
- No scroll-jacking. Native scroll behavior at all times.
- No parallax on mobile (performance). Desktop parallax limited to hero background only, max 20% travel.
- Image hover zoom: `transform: scale(1.03)` over `--duration-normal`. Subtle, not dramatic.

---

## 7. Layout Principles

### 7.1 Grid

- Marketing pages: 12-column grid, max-width 1280px, centered.
- Content max-width: 768px for text-heavy pages (blog, legal, FAQ).
- Product pages: Full-bleed hero, 12-column content below.
- Admin dashboard: Sidebar (256px fixed) + fluid content area. No max-width.

### 7.2 Breakpoints

| Token | Value | Target |
|---|---|---|
| `--bp-sm` | 640px | Large phones landscape. |
| `--bp-md` | 768px | Tablets. |
| `--bp-lg` | 1024px | Small laptops, tablets landscape. |
| `--bp-xl` | 1280px | Desktop. Content max-width. |
| `--bp-2xl` | 1536px | Large desktop. Admin dashboard optimal. |

Mobile-first: base styles target phones. `@media (min-width: ...)` layers up.

### 7.3 Image Handling

- Product photography: WebP with JPEG fallback via `<picture>` or `next/image`.
- Lazy loading on all below-fold images. Eager load hero + first product image.
- Placeholder: low-quality blurred image (LQIP) via `next/image` `placeholder="blur"`.
- Aspect ratios locked per product line to prevent layout shift:
  - Expandable homes exterior: 16:9
  - Interior photos: 4:3
  - Apple Cabin / Space Capsule: 3:2
  - Floor plans: 1:1 (square container, content centered)
- Alt text required on every image. No empty alt except decorative SVG icons.

---

## 8. Iconography

- Icon library: Lucide React (tree-shakeable, consistent 24px grid, MIT license).
- Icon size: 20px inline with text, 24px standalone, 32px feature callouts.
- Icon color inherits text color via `currentColor`. Never hardcoded icon colors.
- No emoji as icons. No FontAwesome. No icon fonts.

---

## 9. Product-Specific Visual Rules

### 9.1 China Erasure (ABSOLUTE — per BLUEPRINT.md Section 12)

- No Chinese characters in any image, label, stamp, background, or signage.
- No identifiably Chinese people in any imagery.
- No metric measurements (mm, cm, m, kg, Celsius). Imperial only.
- No Chinese brand stamps or hardware logos visible.
- Every image must pass audit checklist before publish.

### 9.2 Photography Style

- Product exteriors: white or natural background, full sun lighting, 3/4 angle preferred.
- Interiors: staged with neutral furniture, warm lighting, no people.
- Lifestyle shots: American settings (suburban lots, rural land, mountain properties). Racially diverse American families/individuals.
- Factory/shipping photos: curated to show quality control, steel framing, shipping containers on cargo ships. No factory floor wide shots.

### 9.3 Price Display

- Always USD, formatted with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })`.
- Prices rendered via server component from `products` table. Never hardcoded in markup.
- "Starting at" prefix for product lines with multiple models.
- Per-month financing estimates use "as low as" prefix with Acorn disclaimers.
- 25/25/25/25 payment breakdown shown as 4-step visual (not just text).

---

## 10. Anti-Patterns (Forbidden)

These are explicitly banned from the Bright Box Homes build:

1. **Generic stock photography** — No Shutterstock people standing in front of houses they don't own.
2. **Gradient backgrounds** — No blue-to-purple hero gradients. Clean, solid colors only.
3. **Auto-playing video** — All video playback initiated by user click.
4. **Carousel auto-rotation** — Product galleries are user-controlled.
5. **Floating label inputs** — Labels above inputs, always visible.
6. **Hamburger menu on desktop** — Full nav visible at `--bp-lg` and above.
7. **"Learn More" as sole CTA** — Every CTA either books a consultation or navigates to a product page. Generic "Learn More" without destination context is banned.
8. **Infinite scroll** — Paginated content with explicit "Load More" or pagination controls.
9. **Dark patterns** — No pre-checked upsells, no urgency timers without real deadlines, no misleading button placement.
10. **Lorem ipsum** — No placeholder text ships to production. Every text element populated or hidden.
11. **Metric measurements** — Imperial only, site-wide, no exceptions.
12. **Multiple primary CTAs per viewport** — One "Book a Consultation" button visible at a time.

---

## 11. Tailwind Configuration Mapping

Design tokens map to `tailwind.config.ts` as follows (exact config authored during scaffold phase):

```
colors.bb.blue → --bb-blue
colors.bb.navy → --bb-navy
colors.bb.blue.light → --bb-blue-light
(etc. — full mapping in tailwind.config.ts)

fontFamily.heading → Plus Jakarta Sans
fontFamily.body → Inter
fontFamily.mono → JetBrains Mono

borderRadius.sm → --radius-sm
borderRadius.md → --radius-md
borderRadius.lg → --radius-lg

spacing extends with --space-N tokens
```

Admin-specific tokens scoped under a `.admin` parent class or `data-theme="admin"` attribute on the admin layout root.

---

## 12. Governance

- This document is LOCKED per CONTRACT-014 once committed. Modifications require explicit operator directive.
- Color tokens marked OPERATOR CONFIRM require operator sign-off before the scaffold phase generates the Tailwind config.
- Typography and motion decisions are locked by Lead AI under executive decision-making authority for technical best practices.
- Anti-patterns list is append-only. New anti-patterns may be added; existing ones never removed.

---

END OF DESIGN_LANGUAGE.md
