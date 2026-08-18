# CSS Override Removal — `bg-white` compat layer
## Date: August 18, 2026
## Status: DONE — removed the `!important` compat rule, renamed live usages, regression-tested.
## Follows: CSS_OVERRIDE_INVESTIGATION_2026-08-15.md (investigation-only pass, same file)

---

## Trigger

Three real bugs tonight all traced to the same root cause: `.bg-white { background-color:
var(--color-surface) !important; }` in `src/app/globals.css` beat every attempt to give an
element a custom color, because an author-stylesheet `!important` rule beats even a plain
inline `style` attribute.

1. **Impersonate button** (`admin/orgs`) needed a distinct warning color; couldn't be set via
   inline style while the button also carried `bg-white`.
2. **`FramedCard`** — a local one-off replacement for the shared `Card` component, invented in
   `SalesOutreachClient.tsx`/`AuditLogClient.tsx` specifically because `Card.tsx` hardcodes
   `bg-white` in its base class, and no amount of caller `style`/`className` could beat it.
3. **`variant="ghost"` workaround** — `Button.tsx`'s `secondary` variant also hardcodes
   `bg-white`; any custom-colored secondary button had to use `ghost` (no background class at
   all) instead, because `secondary` + a custom color always lost to the forced ivory.

## Root cause confirmed

- `Card.tsx` line 36: `"bg-white rounded-xl shadow-sm border border-border ..."` (base class,
  caller's `className` appended after via `cn()`).
- `Button.tsx` line 32: `secondary: "bg-white border border-slate-200 ..."`.
- `cn()` (`src/lib/utils/cn.ts`) is a dependency-free `clsx` — plain string concatenation, no
  Tailwind-merge dedup. Class order in the string has no bearing on which wins; CSS
  specificity/`!important` alone decides.
- `.bg-white`'s `!important` beat everything: caller `className`, inline `style`, Tailwind
  arbitrary-value classes (`bg-[#hex]`) — all lost regardless of where they appeared.

## What was checked before removing it (learning from the 2026-07-16 incident)

The 2026-08-15 investigation (`CSS_OVERRIDE_INVESTIGATION_2026-08-15.md`) found that a prior
blind full removal of this compat layer (`6b52f8e`, 2026-07-16) caused an immediate visible
regression across ~150 files and was reverted 43 minutes later (`7ac3844`) — `bg-white` alone
was live in 116 files, all expecting the *ivory surface* color, not Tailwind's literal white.
Deleting the override rule alone, without also fixing every call site, would have reproduced
that exact incident.

**Confirmed before touching anything:**
- `tailwind.config.ts` already defines `surface`/`surface-sunken` keys with the exact same
  values `.bg-white`/`.bg-white-sunken` were forcing (`var(--color-surface)`/
  `var(--color-surface-sunken)`) — an honestly-named class already existed, unused.
- No `white` key exists in `tailwind.config.ts` at all, so `bg-white` (once unforced) resolves
  to Tailwind's real, unmodified `#ffffff` — exactly what the class name says.
- `.card-depth`, `.border-accent-*`, `.table-header-dark` only ever needed `!important` to beat
  `.bg-white`'s own `!important` on the same element (confirmed via live combined-classname
  grep: `FoundationCard.tsx`, `FunderCard.tsx`, `ApplicationsTable.tsx`, `OpportunityTable.tsx`)
  — none of them are ever combined with a still-`!important` `navy-*` class, so dropping their
  `!important` alongside `bg-white`'s removal is safe.
- `bg-white-raised` (13 files) and `bg-white/NN` opacity-modifier forms (~20 files) are
  **unrelated** to this compat rule — the compat layer never intercepted either (different
  selectors) — left untouched. `bg-white-raised` is in fact a separate, pre-existing dead class
  (no `white` key ever existed to generate it); flagged, not fixed here, out of scope.

## What changed

1. **Renamed** `bg-white` → `bg-surface` and `bg-white-sunken` → `bg-surface-sunken` across 107
   files (`src/**/*.tsx`), 324 replacements, via `scripts/rename-bg-white-2026-08-18.mjs`. Pure
   rename — identical CSS variable values, zero visual change by itself.
2. **Deleted** the `.bg-white { !important }` / `.bg-white-sunken { !important }` rules from
   `globals.css` entirely.
3. **Dropped `!important`** from `.card-depth`, `.border-accent-blue/cyan/violet/green/red/amber`,
   `.table-header-dark` — their only reason for it is gone.
4. **Left untouched**: the entire `navy-*` family (bg/text/border/divide/placeholder/hover,
   still genuinely load-bearing per the 2026-08-15 finding — same shade number means a
   different color per property, ~149 files, needs a real migration not a rename) and the
   `@media print` block (functionally necessary, unrelated to color overrides).

## Workarounds revisited

See git history for `admin/sales-outreach/SalesOutreachClient.tsx`,
`admin/audit-log/AuditLogClient.tsx`, and the `variant="ghost"` buttons introduced in tonight's
earlier v2 rollout — reverted to the straightforward `Card`/`variant="secondary"` where the
underlying inline-style/custom-color override now genuinely works without the forced
`!important` fight.
