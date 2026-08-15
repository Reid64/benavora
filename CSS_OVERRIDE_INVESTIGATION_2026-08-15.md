# CSS Override Investigation — globals.css `!important` Layer
## Date: August 15, 2026
## Status: INVESTIGATION ONLY — no CSS changes made in this pass, per task scope.
## File under investigation: `src/app/globals.css` (662 lines, read in full)

---

## 0. Headline finding

**The inline-hex-only rule can be safely relaxed, but only after a specific, ordered fix — not by simply deleting `!important` from globals.css.**

The `!important` compatibility layer is not arbitrary. It exists because **two separate, drifted
definitions of the same brand colors exist side by side**: `tailwind.config.ts`'s legacy
`navy`/`teal`/`plum` color scales (plus Tailwind's untouched built-in `red`/`yellow`/`amber`/`green`/
`emerald`/`blue`/`white`), and `globals.css`'s newer CSS-variable-driven canonical palette. The
compatibility layer is a runtime patch that always makes the second win over the first. This was
tested empirically on **2026-07-16**: the layer was fully removed (`6b52f8e`, 628 lines deleted),
and it was reverted in full 43 minutes later (`7ac3844`, "fix: restore working globals.css") —
i.e., removing it caused an immediate, visible regression back to the stale Tailwind-config colors
across the ~150+ files that still reference those class names. That incident is direct, reproduced
evidence that the layer (in its current form) is load-bearing today, not legacy cruft that can be
deleted outright.

The actual fix is to **collapse the duplication at the source** — move the same hex/rgba values the
compatibility layer currently forces into `tailwind.config.ts`'s `theme.extend.colors` (which
already overrides `navy`/`teal`/`plum`, and can be extended to override `red`/`yellow`/`amber`/
`green`/`emerald`/`blue`/`white` too, since Tailwind merges `extend` on top of its built-in palette).
Once there is exactly one source of truth for each class name, ordinary CSS cascade/specificity
already produces the correct result with no `!important` needed — which also means inline styles,
Tailwind arbitrary-value classes (`bg-[#...]`), and CSS variables would again be genuinely
overridable, restoring the design flexibility Reid wants.

---

## 1. Methodology

1. Read `src/app/globals.css` in full (662 lines).
2. `git log --follow` + `git show` on every commit that touched the file, to find why each
   `!important` block was introduced (or removed/restored).
3. For every class the compatibility layer targets, grepped live usage across `src/**/*.tsx` to
   determine: (a) is it still actually used anywhere (dead code check), (b) is it ever combined on
   the same element with a *newer* color class that also needs `!important` to win (arms-race
   check).
4. Read `tailwind.config.ts` in full to confirm which class families it defines vs. leaves as
   Tailwind's untouched built-in palette, and whether its literal values match or diverge from
   `globals.css`'s canonical palette.
5. Cross-checked the stated reasoning in `BLUEPRINT_v2.md` §7.5 ("The Only UI Rule That Works")
   against actual CSS mechanics, using live combined-class-name evidence found in step 3.

---

## 2. Full catalog

`globals.css` contains **76 individual `!important` declarations**, grouped into 9 rule blocks.

| # | Lines | Selector(s) | Property forced | First introduced | What it overrides |
|---|---|---|---|---|---|
| 1 | 105 | `body` | `background-color` | `a91f6eb` (2026-07-15, "fix: force CSS classes in globals"), var-ified in `7ac3844` | Nothing identified live — see §3.4 |
| 2 | 434–468 | `.bg-white`, `.bg-white-sunken`, `.bg-surface`, `.bg-navy-50/100`, `.bg-navy-50\/50`, `\/30`, `.hover\:bg-navy-50/100`, `.disabled\:bg-navy-50`, `.disabled\:text-navy-500`, `.placeholder\:text-navy-400/300` | `background-color`, `color` | `7ac3844` (2026-07-16 restore); concept traces to `67f2a8c` "unified token system" | Tailwind's built-in `white` + `tailwind.config.ts`'s `navy` scale |
| 3 | 471–502 | `.text-navy-900`…`.text-navy-300`, `.hover\:text-navy-*`, `.focus-visible\:text-navy-700` | `color` | same as #2 | `tailwind.config.ts`'s `navy` scale |
| 4 | 505–523 | `.border-navy-100/200/300`, `.hover\:border-navy-300/400`, `.divide-navy-100/200` | `border-color` | same as #2 | `tailwind.config.ts`'s `navy` scale |
| 5 | 526–546 | `.text-teal-600/700`, `.hover\:text-teal-700`, `.bg-teal-50` family, `.border-teal-200/300` | `color`, `background-color`, `border-color` | same as #2 | `tailwind.config.ts`'s `teal` scale |
| 6 | 549–562 | `.bg-plum-50`, `.border-plum-200`, `.text-plum-600/700/800/900` | `background-color`, `border-color`, `color` | same as #2 | `tailwind.config.ts`'s `plum` scale |
| 7 | 565–621 | `.bg-red-50`, `.border-red-200`, `.text-red-*`, `.bg-yellow-50/.bg-amber-50`, `.border-yellow-*/.border-amber-200`, `.text-yellow-*/.text-amber-*`, `.bg-green-50/.bg-emerald-50`, `.border-green-200/.border-emerald-200`, `.text-green-*/.text-emerald-700`, `.bg-blue-50`, `.border-blue-200`, `.text-blue-700/800` | `background-color`, `border-color`, `color` | same as #2 | Tailwind's **untouched built-in** `red`/`yellow`/`amber`/`green`/`emerald`/`blue` palettes |
| 8 | 627–646 | `.card-blue/cyan/violet/navy/green/amber`, `.card-depth`, `.border-accent-*` (×6), `.badge-*` (×5), `.table-header-dark`, `.page-bg` | `background-color`, `color`, `border`, `box-shadow`, `border-radius`, `padding`, `font-size`, `font-weight` | `66afc7d` → force-duplicated in `a91f6eb` (both 2026-07-15) | **Rows 2–7 of this same table** — see §3.3, the self-inflicted arms race |
| 9 | 653–661 | `@media print { body.report-print-mode aside, header.sticky { display:none } main { padding:0; overflow:visible } }` | `display`, `padding`, `overflow` | `da65a26` (board/impact report generators) | `DashboardShell`'s sidebar/header layout, only in print mode |

---

## 3. Category analysis

### 3.1 Category 1 — real, necessary purpose (keep as `!important`)

**Row 9 — print-mode chrome hiding.** `DashboardShell` renders the sidebar (`aside`) and sticky
header outside the individual report page's own component tree, so a report page (`board-report`,
`impact`) has no prop/className path to hide them for printing — the only mechanism available is a
global CSS rule keyed off a `body.report-print-mode` class the page toggles via
`document.body.classList.add(...)` on mount and removes on unmount (confirmed in
`src/app/(dashboard)/reports/board-report/page.tsx:123` and `.../impact/page.tsx:109`). This is
scoped by `@media print` (never applies on screen) **and** a specific opt-in body class, so it can
never collide with the color/inline-style work this investigation is about. This is a genuine,
narrow, functionally-necessary override, not a fight against the app's own Tailwind/component
styles. **Recommendation: leave unchanged, permanently.**

### 3.2 Category 2 — fighting the app's own styles (the real problem)

**Rows 2–7 — the compatibility layer proper.** These rules exist solely because
`tailwind.config.ts`'s `theme.extend.colors` defines a **separate, literal** `navy`/`teal`/`plum`
scale (e.g. `navy.50: "#f4f6fa"`, `teal.50: "#eafbfe"`) that was never updated when the palette moved
to the CSS-variable-driven system now documented at the top of `globals.css`, and Tailwind's
**built-in, untouched** `red`/`yellow`/`amber`/`green`/`emerald`/`blue`/`white` palettes were never
overridden in `tailwind.config.ts` at all. Concretely:

| Class | Tailwind's own value (from config / built-in) | Compat layer's forced value | Same? |
|---|---|---|---|
| `bg-navy-50` | `#f4f6fa` (gray) | `rgba(0, 119, 182, 0.04)` (blue tint) | No |
| `text-navy-900` | `#1a2744` | `var(--color-text-primary)` = `#1e293b` | Close, not equal |
| `bg-teal-50` | `#eafbfe` | `rgba(0, 180, 216, 0.08)` | No |
| `bg-white` | `#ffffff` (Tailwind core, untouched) | `var(--color-surface)` = `#f7f5f1` (warm ivory) | No |
| `bg-red-50` | `#fef2f2` (Tailwind default) | `rgba(220, 38, 38, 0.08)` | No |

Every one of these class names is real, valid, Tailwind-generated CSS **and** is redefined a second
time by hand in `globals.css`, with `!important` used to guarantee the hand-written value always
wins regardless of which one the build happens to place later. `bg-plum-*` is the exception — see
§3.5, it's simply dead.

**This is squarely "fighting the app's own styles"**: nothing external (a third-party embed,
a browser quirk) is being overridden — it's this repo's own `tailwind.config.ts` losing a fight
against this repo's own `globals.css`, because they were never reconciled into one source of truth.

**Row 1 — `body` background.** No component anywhere sets a `className` on `<body>`
(`src/app/layout.tsx:74` is bare `<body>{children}</body>`), and a repo-wide grep of
`document.body` found no code that sets `document.body.style.background*` at runtime (the two
runtime touches on `document.body` are `.style.overflow` for modal scroll-locking and
`.classList` for the print-mode toggle in §3.1 — neither touches background). No live conflict was
found for this specific rule; it appears to be defensive/leftover from the `a91f6eb` "force CSS
classes" pass rather than a fix for an observed collision. **Low-risk, but no proven necessity
either.**

**Row 8 — the "Premium UI Overhaul" block.** This is the most important finding in this
investigation: **these rules need `!important` not because of anything in `tailwind.config.ts`, but
purely to beat the compatibility layer's own `!important` rules (rows 2–7) when both are applied to
the same element.** This was proven two ways:

1. **Live combined-class-name evidence**, found by grepping which files use `page-bg`/`card-depth`/
   `badge-*`/`table-header-dark` and checking what else is on the same `className`:
   - `src/components/applications/ApplicationsTable.tsx:355` — `className="... bg-white ... table-header-dark"` (both set `background-color`; `.bg-white` forces ivory, `.table-header-dark` forces navy — only wins because it's declared later in the file, not because of any structural reason).
   - `src/components/documents/DocumentList.tsx:265`, `src/components/foundations/FoundationCard.tsx:57`, `src/components/funders/FunderCard.tsx:103` — all combine `bg-white` with `card-depth` (same coincidental value in this case, `#F7F5F1`, but structurally still two competing `!important` declarations for the same property, resolved only by file order).
   - `src/app/(dashboard)/{documents,foundations,funders}/page.tsx` and `intelligence/{disaster,learning-network}/page.tsx` — all combine a Tailwind **arbitrary-value** class, `bg-[#EEF2F7]`, with `page-bg` (`!important`, forces `#E4E9F0`). An arbitrary-hex Tailwind class is exactly the kind of "just write the hex in the class" escape hatch a developer would reach for expecting it to behave like an inline style — it does not; it is still a plain class, and the compat layer's `!important` swallows it silently.
   - `src/components/opportunities/OpportunityTable.tsx:330,337` — `bg-[#DCFCE7] ... badge-green` and `bg-[#FEE2E2] ... badge-red`, same pattern.
2. **Direct historical proof.** Commit `66afc7d` ("feat: premium UI overhaul using !important CSS
   classes", 2026-07-15 18:36) added `page-bg`/`card-depth`/etc. Thirty-six minutes later, commit
   `a91f6eb` ("fix: force CSS classes in globals", 2026-07-15 19:12) **appended a second, duplicate
   copy of the same selectors** (`body`, `card-blue/cyan/violet/navy`, `card-depth`, `border-l-*`,
   `table-dark`) directly below the first — because the first pass's styling wasn't visibly taking
   effect. This is the arms race caught in the act: a brand-new class, added specifically to change
   colors, itself had to be force-redeclared with heavier `!important` just to survive contact with
   the pre-existing compatibility layer.

The practical consequence: **every future color-styling change to this codebase inherits this
requirement**, not just the original legacy-class problem the compat layer was built to solve. Any
new class or inline style that touches `background-color`/`color`/`border-color` on an element that
still carries any of the ~90 legacy class names from rows 2–7 must also fight for the win, and can
only do so with its own `!important` placed *after* the compat layer in file order — which is
exactly why "rewrite the whole component from scratch with inline `style={{}}`, removing the old
class names entirely" is the only method that has reliably worked. It isn't that inline styles are
structurally unbeatable (`BLUEPRINT_v2.md` §7.5's stated reasoning, "inline styles have higher
specificity and cannot be overridden," is imprecise — a stylesheet `!important` rule *can* beat a
plain inline style); it's that the rewrites happened to also strip out the legacy classnames that
were the actual, real point of collision.

### 3.3 Dead code (zero live usage — no visual risk either way)

Grepped every class the compat layer targets against `src/**/*.tsx`. These have **zero** references
anywhere in the current codebase:

- `.bg-plum-50`, `.border-plum-200`, `.text-plum-600`, `.text-plum-700/800/900` — the entire "plum"
  block (lines 549–562), 0 usages. `tailwind.config.ts`'s `plum` scale is equally dead.
- `.bg-surface` (as a class — the `--color-surface` *variable* is used extensively, this is the
  distinct `.bg-surface` utility class), 0 usages.
- `.bg-navy-50\/30`, 0 usages.
- `.disabled\:text-navy-500`, 0 usages.
- `.focus-visible\:text-navy-700`, 0 usages.

These can be deleted immediately with no migration step and no visual risk — nothing depends on
them today.

By contrast, the rest of the compat layer is heavily live: `navy`/`teal` classes appear in 149/101
files respectively, the four status-tint families (`red/yellow/amber/green/emerald/blue`-50) in 124
files, and `bg-white` in 116 files. This is why the 2026-07-16 full-removal attempt broke visibly and
had to be reverted within the hour — it wasn't a false alarm.

---

## 4. Recommendation

**Do this in order. Do not skip the migration step and go straight to deleting `!important` — that
reproduces the exact 2026-07-16 regression.**

1. **Immediate, zero-risk cleanup:** delete the confirmed dead selectors from §3.3 (plum block,
   `.bg-surface`, `.bg-navy-50\/30`, `.disabled\:text-navy-500`, `.focus-visible\:text-navy-700`)
   from `globals.css`, and the dead `plum` scale from `tailwind.config.ts`. No visual change possible
   — nothing references them.
2. **`body` (row 1):** drop the `!important` (keep the declaration). No live conflict was found;
   independent of every other step below.
3. **Collapse the duplicate source of truth (rows 2–7):** for every class family still in live use
   (`navy`, `teal`, `red`, `yellow`/`amber`, `green`/`emerald`, `blue`, `white`), move the exact
   values the compat layer currently forces into `tailwind.config.ts`'s `theme.extend.colors`,
   replacing the stale literal `navy`/`teal` scales and adding overrides for the built-in
   `red`/`yellow`/`amber`/`green`/`emerald`/`blue`/`white` keys (Tailwind merges `extend` over its
   built-in theme, so this is a supported, normal override — not a hack). Once each class name has
   exactly one definition, drop the corresponding rule from `globals.css`'s compatibility layer.
   Do this family-by-family, verifying computed styles/screenshots after each (per this project's
   own established verification discipline — see `benavora-ui-claims-need-visual-proof` precedent),
   not as one big-bang change.
   - Caveat on `white` specifically: it's a much more overloaded Tailwind primitive (used for literal
     white text/backgrounds elsewhere, e.g. the premium cards' own hardcoded `color: #FFFFFF`, which
     doesn't go through the `white` token and would be unaffected either way) — verify no unrelated
     "true white" usage would be silently retinted before overriding it globally, rather than
     assuming it's safe by analogy to `navy`/`teal`.
4. **Premium overhaul block (row 8):** only after step 3 is complete for a given color family, drop
   `!important` from the corresponding `card-*`/`badge-*`/`border-accent-*`/`table-header-dark`/
   `page-bg` rules too. Doing this before step 3 (or only doing one of the two) reproduces the
   `a91f6eb` "force CSS classes" scenario — these rules and rows 2–7 must lose their `!important`
   together, family by family, or whichever side still has `!important` silently wins again.
5. **Print block (row 9):** no action. Correct as-is.

**Verdict:** the inline-hex-only constraint is a workaround for a real, currently-load-bearing
override layer — it is not arbitrary, and the 2026-07-16 history proves the layer can't just be
deleted today. But the underlying cause (two competing definitions of the same brand colors) is
fixable, not an unavoidable technical limitation. Once steps 1–4 land and are visually re-verified,
inline styles, Tailwind arbitrary-value classes, and CSS variables would all be genuinely
overridable again through normal CSS cascade — no `!important` required — and "The One UI Rule" in
`DESIGN_SYSTEM.md`/`FEATURE_REGISTRY_v2.md` could be relaxed for the color families that have
completed the migration. Any family that hasn't yet been migrated should keep the inline-hex-only
rule until it has.
