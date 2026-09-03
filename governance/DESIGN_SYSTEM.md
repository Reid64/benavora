Project: benavora, Category: Nonprofit Fundraising SaaS, Colors: Background #F0EBE0, Surface #F9F6EF, Surface Raised #FCFAF5, Primary #3D6B50, Secondary/Accent #C49A4F, Accent-Terracotta #B85C3C, Accent-Amber #F59E0B, Accent-Green #10B981, Accent-Red #EF4444, Text #2A2E28, Heading #3D6B50, Muted #8B8370, Border #C9BFA8. Fonts: Plus Jakarta Sans only.

**Real brand palette (superseded 2026-09-02 — warm nonprofit palette).** The blue-logo palette
below (corrected 2026-08-15) has been replaced app-wide by a warm nonprofit palette: forest green
`#3D6B50` (primary), gold `#C49A4F` (secondary/CTA), terracotta `#B85C3C` (secondary accent), and
warm ivory `#F0EBE0` (background) — chosen for warmth and approachability over the prior blue-logo
system. The Benavora logo itself is being redesigned to match this palette; until that ships, the
uploaded logo asset is visually out of sync with the app chrome, which is expected during the
transition. This is now the single source of truth in `tailwind.config.ts`'s
`theme.extend.colors.brand` and `src/app/globals.css`'s `:root` custom properties:

| Token | Hex | Use |
|---|---|---|
| `brand.deep` | `#3D6B50` | Forest green — primary brand color, sidebar/header rail |
| `brand.sky` | `#5C8B6E` | Lighter forest green tint |
| `brand.highlight` | `#C49A4F` | Gold — primary CTAs/buttons, sidebar/header active-nav accent |
| `brand.violet` | `#B85C3C` | Terracotta accent |
| `brand.indigo` | `#8B5E3C` | Warm umber accent |
| `brand.teal` | `#7A8B5C` | Sage/olive accent |

The sidebar and header now render dark forest green (`#2C4E3B`) in place of the prior dark navy
(`#101B2D`), with gold (`#C49A4F`) active-state and badge accents, applied app-wide via a
token-level + literal-hex recolor pass 2026-09-02.

<details>
<summary>Prior blue-logo palette (2026-08-15, superseded — kept for history)</summary>

Sourced from the actual uploaded logo at the time: a blue-gradient "b" mark (deep blue ~#1D4ED8 at
top fading to sky blue ~#0284C7/#38BDF8), a violet paper-airplane and heart accent (~#7C3AED to
#A855F7), and bright teal-cyan leaf petals (~#22D3EE). Values: `brand.deep` `#1D4ED8`, `brand.sky`
`#0284C7`, `brand.violet` `#7C3AED`, `brand.indigo` `#4C51C6`, `brand.teal` `#0E7490`,
`brand.highlight` `#22D3EE`. Sidebar/header rendered `linear-gradient(180deg, #1D4ED8 0%, #0284C7
100%)`, live-verified via Playwright screenshot 2026-08-15.
</details>

**The old `navy`/`teal`/`plum` scales are NOT yet deleted from `tailwind.config.ts`.** `plum` was
already dead code (zero live usages, confirmed previously). `navy` is a different story — it is
genuinely live in ~149 files / ~3,800 class usages app-wide (mostly body text/backgrounds on
cards, tables, and pages, not just nav), confirmed via a real repo-wide grep 2026-08-15. Rather
than a file-by-file migration, the 2026-09-02 warm-palette pass recolored the `navy` scale's own
hex values (and the compatibility-layer overrides in `globals.css` that force a subset of its
classes) to the forest-green family in place — the same class names (`bg-navy-50`, `text-navy-700`,
etc.) now resolve to warm-palette colors without touching the ~149 consuming files individually.
It still needs a scoped, file-by-file rename eventually (the class names themselves are stale/
misleading — "navy" no longer means navy), just not for correctness.

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

## Section Accent Colors (added 2026-08-15, recolored + realigned to nav 2026-09-02)

**Goal:** variance across the app's dozens of pages, but grouped by logical nav section — not
random per-page colors — so a user builds a mental map of "this shade means this part of the app."
The shared sidebar/header shell is explicitly excluded from this system and stays the one
consistent dark-forest rail (`#2C4E3B`) everywhere, per Directive 4's "one shared foundation"
principle — only a page's own content area (its `PageHeader` accent, key stat/metric cards, and
primary buttons/interactive controls) shifts color by section.

### How the seven logical sections were derived

`src/components/layout/nav-items.ts` was read in full to ground this in the real nav tree. As of
2026-09-02 the sidebar's `NAV_ITEMS` is 6 top-level sections (Dashboard, Prospects & Analysis,
Opportunities, Applications, Engagement, Resources) with everything previously reachable folded in
as children, plus `SETTINGS_NAV_ITEM` (Compliance, Financials, Reports, Alerts, Outcomes &
Analytics) rendered separately at the bottom of the rail — 7 groups total. This superseded the
original 6-group mapping (Dashboard/Research/Pipeline/Intelligence/Outreach/Admin), which was tied
to an older, flatter nav shape; `src/lib/design/section-accents.ts`'s `ROUTE_SECTIONS` now mirrors
the current nav tree directly.

### Current mapping (warm nonprofit palette, 2026-09-02)

| # | Section | Accent | Real brand token | Nav items grouped here |
|---|---|---|---|---|
| 1 | **Dashboard / Home** | `#3D6B50` | `brand.deep` (also the shell's own anchor color) | Dashboard, Activity, Strategic Recommendations |
| 2 | **Prospects & Analysis** | `#C49A4F` | `brand.highlight` | My Prospects, Analysis Results, Run New Analysis, Pending Review, Giving Signals, Community Needs, Disaster Response |
| 3 | **Opportunities** | `#B85C3C` | `brand.violet` | Find/All Opportunities, Matched for My Prospects, Funder Matches, Competitor Insights, Foundations, Funders |
| 4 | **Applications** | `#7A8B5C` | `brand.teal` | Draft Applications, Ready to Submit, Needs Attention, Submitted & Tracking, Gap Analysis, Documents, Deadlines |
| 5 | **Engagement** | `#8B5E3C` | `brand.indigo` | Email Campaigns, Outreach, Relationship Management, Recommendations, Funder & Contact Monitoring, Relationship Network, Donation Marketplace |
| 6 | **Resources** | `#2C4E3B` | (dark forest, same as sidebar) | Knowledge Base, Organization Profile, Knowledge Search, Nonprofit Directory, Templates |
| 7 | **Admin & Settings** | `#A4712C` | (bronze, matches the app-wide scrollbar thumb) | Settings (Compliance, Financials, Reports, Alerts, Outcomes & Analytics); the full Platform section (Command Center, Organizations, System Health, Import, Sales Outreach, AutoApply Ops, Monitor, Improvements, Audit Log) |

Every section accent is now a warm-palette hex (forest green / gold / terracotta / sage / umber /
bronze) — none reuse the prior blue-logo tokens.

### Implementation pattern

- `src/lib/design/section-accents.ts` — canonical `SECTION_ACCENTS` map + a `sectionForPath()` /
  `sectionAccent()` route-prefix resolver, so any future page can look up its section's accent by
  `pathname` instead of re-deriving a hex value.
- `src/components/layout/PageHeader.tsx` — optional `accent?: string` prop (default `#3D6B50`,
  today's app-wide primary, so every page that doesn't pass one still matches the new palette).
  When passed, it colors the header's left border bar and title text.
- The 2026-08-15 session hand-verified six representative pages (one per the *old* 6-section
  mapping) via Playwright; those pages' literal accent hexes were swept forward to the new warm
  palette by the 2026-09-02 bulk recolor (see that session's notes), but have not been re-verified
  individually against the *new* 7-section mapping above — a future session should re-run the same
  one-page-per-section Playwright check against the current mapping before treating it as
  live-verified again.
- **Live-verified 2026-08-15** via real Playwright screenshots of all six pages above: each page's
  own accent renders correctly, the shared sidebar/header shell stays the one consistent deep-blue
  gradient on every page (unchanged by this work), and sidebar/header nav text remains solid white
  everywhere — confirmed visually across all six screenshots, not just on the page that happens to be
  active.
