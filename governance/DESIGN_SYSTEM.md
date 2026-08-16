Project: benavora, Category: Nonprofit Fundraising SaaS, Colors: Background #E4E9F0, Surface #F7F5F1, Surface Raised #FBFAF7, Primary #0077B6, Secondary/Accent #00B4D8, Accent-Amber #F59E0B, Accent-Green #10B981, Accent-Red #EF4444, Text #1E293B, Muted #8B93A5, Border #D9D3C5. Fonts: Plus Jakarta Sans only.

**Real brand palette (corrected 2026-08-15) — sourced from the actual uploaded logo, not the
old navy/teal/plum values previously documented here.** Those old values (navy #1A2744-ish, teal
#00B4D8, plum #7A3B5C) were derived from old, unused, dead-code color definitions that were never
checked against the real logo. The real logo is: a blue-gradient "b" mark (deep blue ~#1D4ED8 at
top fading to sky blue ~#0284C7/#38BDF8), a violet paper-airplane and heart accent (~#7C3AED to
#A855F7), and bright teal-cyan leaf petals (~#22D3EE). The verified real values, now the single
source of truth in `tailwind.config.ts`'s `theme.extend.colors.brand`:

| Token | Hex | Source / use |
|---|---|---|
| `brand.deep` | `#1D4ED8` | "b" mark gradient — top (deep blue) |
| `brand.sky` | `#0284C7` | "b" mark gradient — bottom (sky blue) |
| `brand.violet` | `#7C3AED` | paper-airplane / heart accent |
| `brand.indigo` | `#4C51C6` | blue-violet blend |
| `brand.teal` | `#0E7490` | teal-blue blend |
| `brand.highlight` | `#22D3EE` | fixed bright teal (leaf petals) — primary CTAs/buttons, and the sidebar/header active-nav accent |

The sidebar and header now render the real deep-to-sky blue gradient (`linear-gradient(180deg,
#1D4ED8 0%, #0284C7 100%)` on the sidebar rail, solid `#1D4ED8` on the header bar) in place of the
old dark navy (`#162032`/`#1A2535`), live-verified via Playwright screenshot 2026-08-15.

**The old `navy`/`teal`/`plum` scales are NOT yet deleted from `tailwind.config.ts`.** `plum` was
already dead code (zero live usages, confirmed previously). `navy` is a different story — it is
genuinely live in ~149 files / ~3,800 class usages app-wide (mostly body text/backgrounds on
cards, tables, and pages, not just nav), confirmed via a real repo-wide grep 2026-08-15. It is
flagged in `tailwind.config.ts` as not belonging to the real brand and pending removal, but was
deliberately NOT deleted this session — doing so would silently unstyle that content, reproducing
the 2026-07-16 `!important`-layer-removal regression (see `CSS_OVERRIDE_INVESTIGATION_2026-08-15.md`)
at a wider scale. It needs a scoped, file-by-file migration first, matching the precedent already
set for the `teal`/`red`/`yellow`/`amber`/`green`/`emerald`/`blue` families.

**Hard rule — nav/sidebar/header text is always solid white (2026-08-15):** every sidebar nav
item, sidebar sub-item, and header tab link renders `color: "#FFFFFF"` unconditionally — never
varied by active/hover state or by which background accent (gradient, active-tint, hover-tint) is
underneath it. Only the background tint, border-bottom, and font-weight vary between states; the
text color itself is a single hardcoded literal in `Sidebar.tsx`'s `navItemStyle()`/`ChildNavLink`
and `Header.tsx`'s `headerTabStyle()`, not a conditional expression — so it cannot be silently
reintroduced as a colored/dimmed label by a future per-page or per-state style. This does not apply
to the header's avatar dropdown menu (Settings/Billing/Log Out, etc.), which is a separate light
popover card by standard convention (must stay dark-text-on-white for its own legibility) — the
rule covers the primary navigation surfaces (sidebar rail, header tab bar), not that utility menu.

(Corrected 2026-08-15 — this file's prior color values, e.g. Background #C4D0DC / Surface #FFFFFF,
had drifted from the real canonical palette in `src/app/globals.css`'s `:root` custom properties for
some time; the non-brand values above are read directly from that file, the actual single source of
truth for those tokens. `tailwind.config.ts`'s color scales are supposed to reference those same
variables — see `CSS_OVERRIDE_INVESTIGATION_2026-08-15.md` for where that broke down for the legacy
`navy`/`teal` scales and Tailwind's untouched built-in palette, and what was fixed vs. what's still
intentionally guarded by `globals.css`'s `!important` compatibility layer. `FEATURE_REGISTRY_v2.md`'s
"The One UI Rule" section has the current, per-color-family, evidence-based version of that
constraint — do not treat inline-hex-only as a blanket rule without reading that section first.)

## Section Accent Colors (added 2026-08-15)

**Goal:** variance across the app's dozens of pages, but grouped by logical nav section — not
random per-page colors — so a user builds a mental map of "this shade means this part of the app."
The shared sidebar/header shell is explicitly excluded from this system and stays the one
consistent deep-blue gradient (`#1D4ED8` → `#0284C7`) everywhere, per Directive 4's "one shared
foundation" principle — only a page's own content area (its `PageHeader` accent, key stat/metric
cards, and primary buttons/interactive controls) shifts color by section.

### How the six logical sections were derived

`src/components/layout/nav-items.ts` was read in full to ground this in the real nav tree, not a
guessed grouping. Two things about the real structure mattered:

1. The header bar (not in `nav-items.ts` — see its own top-of-file comment) carries the app's
   primary top-level "modes": **Dashboard, Research, Opportunities, AutoApply, Draft Generator,
   Donor Discovery.**
2. The sidebar's `NAV_ITEMS`/`RESOURCES_NAV_ITEMS`/`PLATFORM_NAV_ITEMS`/`SETTINGS_NAV_ITEM` is a
   flatter, persistent CRM-style list that sits alongside whichever header mode is active, not
   nested under it — so the six groupings below are a content-type grouping across *both* the
   header modes and the sidebar list, not a literal reproduction of either one's own shape.

### Final mapping

| # | Section | Accent | Real brand token | Nav items grouped here |
|---|---|---|---|---|
| 1 | **Dashboard / Home** | `#1D4ED8` | `brand.deep` (also the shell's own anchor color) | Dashboard (header), Alerts, Activity |
| 2 | **Research & Discovery** | `#0284C7` | `brand.sky` | Research, Opportunities (header); Foundations, Nonprofit Directory (sidebar) |
| 3 | **Applications & Pipeline** | `#0E7490` | `brand.teal` | AutoApply, Draft Generator (header); Applications, Documents, Deadlines, Compliance, Financials, Funders, Contacts (sidebar) |
| 4 | **Intelligence & Reports** | `#7C3AED` | `brand.violet` | Intelligence (+ 13 children), Reports (+ 3 children), Outcomes & Analytics, Knowledge Base, Intelligence Library, Agent Marketplace |
| 5 | **Donor Discovery & Outreach** | `#4C51C6` | `brand.indigo` | Donor Discovery + its Prospects/Intent Signals drilldown (header); Email (+ children), Outreach (+ children), Marketplace |
| 6 | **Admin & Settings** | `#22D3EE` | `brand.highlight` | Settings; the full Platform section (Command Center, Organizations, System Health, Import, Sales Outreach, AutoApply Ops, Monitor, Improvements, Audit Log) |

This adjusts the illustrative mapping given in the original task prompt in one place: "Admin/Settings
→ mid blue (#2563EB)" used a hex that isn't one of the six real brand tokens above, so Admin/Settings
was reassigned to `brand.highlight` (`#22D3EE`) instead — the one remaining real token once the other
five sections were assigned their most semantically sensible color. `brand.highlight` already does
double duty as the sidebar/header's own active-nav-link accent (`Sidebar.tsx`, `ChildNavLink`'s active
dot) — that's a shell-level usage, a different visual context from a page's own content area, so the
reuse doesn't conflict with Directive 4's "one shared foundation" rule.

### Implementation pattern

- `src/lib/design/section-accents.ts` — canonical `SECTION_ACCENTS` map + a `sectionForPath()` /
  `sectionAccent()` route-prefix resolver, so any future page can look up its section's accent by
  `pathname` instead of re-deriving a hex value.
- `src/components/layout/PageHeader.tsx` — gained an optional `accent?: string` prop (default
  `#0077B6`, today's app-wide primary, so every page that doesn't pass one is visually unchanged).
  When passed, it colors the header's left border bar and title text.
- Per Directive 4, this session did **not** batch-recolor every page — six representative pages (one
  per section) were updated and live-verified via Playwright per the task's own scope, establishing
  the pattern for future one-page-per-session rollout to the remaining pages, the same precedent
  already established for the `teal`/`red`/`yellow`/etc. color-family migration in
  `CSS_OVERRIDE_INVESTIGATION_2026-08-15.md`:
  - **Dashboard/Home** — `/alerts` (`PageHeader accent`, "Mark all read" button, filter pills, "Mark
    as read" link all now `#1D4ED8`; the Dashboard hero page itself is intentionally left alone — it
    has its own, separately-documented dark theme, see `benavora-design-history-dark-vs-light`)
  - **Research & Discovery** — `/foundations` (`PageHeader accent`, `StatCard` top border + value
    color, search-input focus ring, all `#0284C7`)
  - **Applications & Pipeline** — `/applications` (custom header, not `PageHeader` — added a matching
    left-border-bar treatment + `#0E7490` title color, and recolored the *generic* active-filter-pill
    look from the old legacy-navy `#1A2B3C` to `#0E7490`; the five per-family pipeline-stage colors
    — discovery/drafting/submitted/awarded/denied — are semantic status colors and were deliberately
    left untouched)
  - **Intelligence & Reports** — `/outcomes` (`PageHeader accent` only, `#7C3AED`; the page's existing
    three metric-card accents — green/teal/violet — are meaningful status colors, not decorative
    section branding, and were deliberately left untouched)
  - **Donor Discovery & Outreach** — `/donor-discovery/prospects` (`PageHeader accent`, the prospect
    count pill, the "Total Prospects" stat card, and the "Discover More" button, all `#4C51C6`)
  - **Admin & Settings** — `/admin/orgs` (added a `#22D3EE` bottom border to the existing dark header
    panel rather than swapping its fill — `brand.highlight` is a light/bright color that would fail
    contrast against the panel's white header text as a solid background)
- **Live-verified 2026-08-15** via real Playwright screenshots of all six pages above: each page's
  own accent renders correctly, the shared sidebar/header shell stays the one consistent deep-blue
  gradient on every page (unchanged by this work), and sidebar/header nav text remains solid white
  everywhere — confirmed visually across all six screenshots, not just on the page that happens to be
  active.
