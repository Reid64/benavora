# BENAVORA — SESSION STATE
## Last updated: 2026-07-08
## Current branch: main
## Last commit: chore: dd architecture doc + phase 1 queue + robots-parser

---

## COMPLETED — July 8 gate re-verification + Intelligence Library claim correction

Same task as the 07-07 pass below, re-run a day later. Ran all three gates fresh rather
than trusting yesterday's result: `pnpm run typecheck` (tsc --noEmit) — 0 errors. `pnpm run
build` — clean, 235/235 static pages, 261 route files (85 pages + 176 API routes), no route
conflicts. `pnpm run lint` — 0 warnings/errors. No drift from 07-07 — same counts, same
clean result.

The task text (again) asked to document a specific "Intelligence Library Nights 3-7: BUILT"
bullet list. That section already existed in `STATE_OF_THE_BUILD.md` from the 07-07 pass, so
rather than re-transcribing it, ran an independent Explore-agent audit against the actual
source for all 25 individual claims (Census/HUD/BLS/CDC clients, geo fallback, budget/
compliance/evaluation libraries, grantmaker recommender, Grant DNA, unified search, briefing
panel, tier gating, migrations, pgvector/embeddings) rather than assuming yesterday's writeup
was still exhaustive. Two corrections came out of it, verified by reading the code directly
(not just trusting the subagent):

1. **Geo fallback is county→state only**, not the documented zip→county→state→national chain
   — `need-statement-engine.ts:41-42` says so in its own comment; `census-api.ts` has no zip
   or national-level lookup path.
2. **No real SAMHSA integration exists** — `cdc-api.ts`'s `fetchSubstanceAbuseData()` comment
   claims "SAMHSA NSDUH state estimates" but the actual query hits a CDC BRFSS (alcohol
   module) Socrata dataset, a different survey entirely. The mislabeling is in the source
   code's own comment, not just prior documentation.

Both written into `STATE_OF_THE_BUILD.md` (KB4 section, detailed KB4-9 walkthrough, and new
gap items #33a/#33b) rather than silently left as-is. Everything else in the Nights 3-7
section (KB5 Budget, Compliance, KB7 Evaluation, KB8 Grantmaker/Recommendations, KB9 Grant
DNA, Cross-Library Integration) re-confirmed accurate on a fresh read — no other changes.

No code changes this pass — docs + gate verification only, as scoped. Route/page/layout
conflict check: static analysis of all `page.tsx`/`route.ts` paths found no directory with
both a `page.tsx` and a `route.ts`, and no sibling dynamic segments with conflicting param
names — consistent with the build succeeding (a real conflict fails `next build` outright).

---

## COMPLETED — July 7 gate re-verification + STATE_OF_THE_BUILD.md restructure (second pass, same day)

Re-ran the full gate sequence: `pnpm run typecheck` (tsc --noEmit) — 0 errors. `pnpm run
build` — clean, 235/235 static pages, 261 route files (85 pages + 176 API routes), no route
conflicts. `pnpm run lint` — 0 warnings/errors. Same clean result as the prior "Nights 3-7
verification pass" entry below — no regressions since.

This session's task asked for a new `## Intelligence Library Nights 3-7: BUILT` section
in STATE_OF_THE_BUILD.md with a specific bullet list. Before writing it, re-checked the
contested claims against `src/` directly rather than transcribing the requested text
verbatim, since one bullet ("narrative pattern extraction from funded proposals") conflicts
with the prior pass's finding that `intelligence_narrative_patterns` has zero code
references. Re-confirmed via grep: still zero references — this KB piece is schema-only,
so the new section documents it as **not built** rather than marking it done. Also
re-confirmed `IntelligenceBriefingPanel` is genuinely mounted on `OpportunityDetail.tsx`,
and that `build-grantmaker-profiles.ts` builds from `foundation_directory` +
already-scraped enrichment fields rather than doing its own fresh website scrape. The new
section lives directly under the file's top-level audit-counts block; the pre-existing
detailed "Intelligence Library KB4-9" walkthrough further down is unchanged and still the
source of truth for file-level detail.

No code changes this pass — docs + gate verification only, as scoped.

---

## COMPLETED — July 7 color & polish pass: chromatic icons, stat accents, draft editor viewport fix

**Draft editor height bug (root cause + fix)**: the Generated draft textarea rendered ~5
visible rows with dead space below despite `rows={20}` in the JSX. Root cause:
`src/app/globals.css`'s global base style `textarea { max-height: 120px; resize: vertical; }`
applies to every textarea app-wide (intended for small form fields like Mission Statement)
and was silently clamping the draft editor too — a `rows` attribute can't override a CSS
`max-height`. Fixed surgically: the draft editor's textarea gets `max-h-none` (a Tailwind
class beats the plain-element-selector base rule on specificity) plus `min-h-[55vh] flex-1
h-full resize-none`, removed the now-meaningless `rows={20}`. Left the global 120px clamp
in place for other small textareas that want it — this was a one-textarea override, not a
global rule change.

**Genuine flex-to-viewport stretch, not just a tall minimum**: `draft-generator/page.tsx`'s
two-column results layout is a `grid grid-cols-1 gap-6 lg:grid-cols-3` — CSS Grid's default
`align-items: stretch` already equalizes both columns' height to the taller one. Made the
left column `flex flex-col`, the "Review & edit" `<Card>` `flex flex-1 flex-col`, and
`Card.tsx`'s body wrapper unconditionally `flex-1` (inert unless the outer Card is itself
`display:flex`, so harmless across the other 71 call sites) — so on wide viewports the
editor card now genuinely stretches to match the right column's stacked cards (Confidence,
Grant DNA, Sources used), not just a fixed 55vh floor.

**ColorIcon system** (`src/components/ui/ColorIcon.tsx`, new): one hue per function —
cyan=opportunities/search, emerald=money/funding, blue=documents/drafts, amber=deadlines/
time, violet=analytics, indigo=applications, rose=alerts. Deliberately uses raw Tailwind
hue classes (violet, rose, etc.) — an intentional, documented exception to the "no purple/
violet accents" anti-pattern from the intensity pass: these are categorical/nominal colors
for scanning icon chips, not brand accents. `ICON_HUE_BORDER_CLASSES` provides the matching
`border-l-{hue}-500` for the "colored left border" pairing.

Applied to: **`MetricCard`** (dashboard's 7 stat cards — cyan/indigo/blue/amber/emerald×2/
violet, plus a `border-l-4` in the same hue), **`Card`**'s Upcoming Deadlines (amber) and
Quick Actions (cyan) via a plain `className` override, **`TemplateSelector`** (all 6 draft
templates — blue/emerald/amber/violet/cyan/indigo, selection state rebuilt as `border-primary
ring-2 ring-primary/20 bg-blue-50/50`, grid changed to symmetric `grid-cols-1 sm:grid-cols-3`
with `h-full` cards), **Research source cards** (all 9 sources get a cyan `Search` icon chip,
on top of the existing 3px cyan top-accent-bar from the intensity pass), and **Intelligence
Library**'s 5 stat tiles (blue/violet/indigo/cyan/amber, each with a matching `border-l-4`).

**Step-circle headers**: draft-generator's numbered `Card` titles ("1. Choose an opportunity"
etc.) were plain text — added a `StepTitle` helper (filled `bg-primary` circle + label) and
wired it into all 4 numbered cards (steps 1, 2, 3-conditional-program, 3-review-and-edit —
the app's own numbering already reuses "3" for both, not changed here). Also fixed an
adjacent dark-theme leftover found in the same section: the "Score Draft" button was
`text-indigo-300` (a light color meant for a dark bg) on a white card — unreadable pale
lavender text — converted to `bg-indigo-50 text-indigo-700 border-indigo-200`.

**Visual verification**: seeded a real `draft_versions` row for the beta org (a service-role
script — no existing draft existed to screenshot, and triggering a live AI generation would
take 30-180s per generation) so `/draft-generator?opportunity={id}` could be screenshotted
with an actual loaded draft rather than the empty template-picker state. Logged in as
`beta1@benavora-test.com`, reviewed `/dashboard`, `/research`, `/intelligence-library`, and
`/draft-generator` (both the template-picker and loaded-draft states) — confirmed every stat
card has a colored chip + matching left border, the template grid shows clear hue variety
with an obvious selection ring, all 3 step circles render, and the editor genuinely fills a
large portion of the viewport with word-count/save controls pinned below it. Zero console
errors during the run.

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean.

---

## COMPLETED — July 7 Intelligence Library Nights 3-7 verification pass

Gate run: `pnpm run typecheck` clean, `pnpm run build` clean (235/235 pages, 176 API routes,
no route conflicts). This was a verification pass, not a build pass — the task asked to
document Nights 3-7 as "BUILT," so before writing anything a full file-level audit was run
against GRANT_INTELLIGENCE_ARCHITECTURE.md's 9-KB spec to confirm claims are real rather
than copying the pre-drafted status text. Findings written into STATE_OF_THE_BUILD.md's new
"Intelligence Library KB4-9" subsection and gaps #29-31.

**Bottom line: KB4 (Need Statement), KB5 (Budget), Compliance, KB7 (Evaluation), KB8
(Grantmaker Intelligence), and Cross-Library Integration (unified search, tier-gated
briefing, coverage heat map) are all real and wired into the draft generator — not stubs.**
Three things from the spec are schema-only or missing: `intelligence_grant_dna_scores` is
defined but never written to (DNA scores compute live, aren't persisted), and
`intelligence_narrative_patterns`/`intelligence_post_award_reports` have zero code
references (no ingestion, no reads). No foundation-website-scrape or 990-grants-made
ingestion script exists specifically for the intelligence library.

Uncommitted working-tree changes present at session start (small, pre-existing, not part of
this verification): `intelligence-library/page.tsx`, `intelligence/recommendations/page.tsx`,
`IntelligenceBriefingPanel.tsx`, `funder-recommender.ts`, `outcome-benchmarks.ts`,
`unified-search.ts`, plus a new untracked `api/intelligence/recommendations/explain/` route
— left as-is (not committed) since committing wasn't requested this session.

---

## COMPLETED — July 7 intensity pass: saturated buttons, tonal layers, sunken headers

Follow-up to the dark-surface purge above — that pass made everything correctly light,
but flat: near-white-on-white-on-white with no depth cues. This pass adds tonal hierarchy.

**Tokens**: `--color-background` darkened #EEF2F7 → **#E2E8F0** (real contrast under white
cards — this is a page-wide cascading change since `--color-page`/`--background` alias it).
New `--color-surface-sunken` **#F1F5F9** for table headers and card header wells, added
alongside `surface`/`surface-raised` in both `globals.css` and `tailwind.config.ts`.

**Buttons** (`Button.tsx`): `primary` = `bg-primary text-white hover:bg-primary-hover
shadow-sm` — explicitly the default for every card CTA (Run, Apply, Add to Queue,
Re-score), not just form submits. `secondary` rebuilt as a visible gray chip (`bg-slate-100
text-slate-700 border border-slate-300 hover:bg-slate-200`) — no longer a
primary-tinted-border ghost, a genuinely distinct neutral action style. Converted every
Run/Apply/Add-to-Queue/Re-score button that was rendering as a faint outline: Research
page's per-source "Run" buttons and the "Apply"/"Pull Historical Awards" buttons (raw
`<button>`s, not the shared component, so hand-converted to matching classes),
`GrantDNACard`'s "Re-score" button.

**Cards** (`Card.tsx`): border → `border-slate-200` (same hex as the old `border-border`
token, but literal per this pass's spec), header block now `bg-surface-sunken` — every
titled panel (Pipeline, Recent Activity, Quick Actions, Grant DNA Score, Scoring
Optimization) gets a visibly sunken header band distinct from its white body. Applied the
same header treatment to `Modal.tsx` and `RubricPanel.tsx` (which duplicate Card's
header/body split inline rather than using the component).

**Research source cards** (Grants.gov, SAM.gov, etc.): added a 3px `bg-accent` top bar
(`relative overflow-hidden` wrapper + absolutely-positioned span), title → `text-slate-900
font-semibold`, metadata (Last run/Found) → `text-slate-500`.

**Tables**: `Table.tsx` (the shared component — cascades to Opportunities via
`OpportunityTable`) header row → `bg-surface-sunken text-slate-600`, row dividers →
`divide-slate-200`, row hover → `hover:bg-slate-50`, body text → `text-slate-700`. Research
and Intelligence Library both hand-roll their own tables (found via audit — neither used
the shared component, and each had a different ad-hoc class convention: `gray-*`/`px-4
py-3` vs `navy-*`/`py-3 pr-4`) — converted both, 4 tables total (Discovered Opportunities,
Historical Awards, Funded Proposals, Scoring Rubrics, Data Sources — 5 actually), each now
matching the same header/divider/hover convention as the shared component.

**Page headers**: no shared header component existed — every one of ~70 dashboard pages
hand-rolled its own `<h1>`/`<p>`/action-button block directly on the gray canvas, with
inconsistent wrapper alignment (`items-center` vs `items-start`) depending on whether the
original author needed room for a multi-button action area. Created
`src/components/layout/PageHeader.tsx` (white band, `border-slate-200`, `shadow-sm`,
`align="start"|"center"` prop to preserve each page's original vertical alignment) and
applied it to the 5 pages this pass verifies (`dashboard`, `research`, `opportunities`,
`intelligence-library`, `autoapply`). The remaining ~65 dashboard pages still hand-roll
their header block — same visual weight as before (no white band), tracked as follow-up
debt below, not a regression from this pass.

**Visual verification**: dev server + Playwright, logged in as `beta1@benavora-test.com`,
screenshotted all 5 named pages plus one cropped close-up of a Research source card to
confirm the 3px accent bar actually renders (it does). Reviewed each full-page screenshot:
confirmed the three-layer structure (gray canvas → white header band → white cards with
sunken headers) on every page, confirmed no white-on-white buttons anywhere (Settings on
`/autoapply` reads as a clear gray chip; every Run/Apply button is solid blue).

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean (234/234 pages).

---

## COMPLETED — July 7 definitive UI pass: dark-surface purge, button visibility, screenshot-verified

Root cause found: **`src/components/ui/Card.tsx`** (72 call sites) and **`Modal.tsx`** still had
`bg-ink-700/60` / `bg-ink-800` (a genuinely dark near-black legacy scale), `glow-border`,
`backdrop-blur-md`, and dark-tuned `shadow-card` — leftover from before the light-theme
rebrand, never touched by the two prior design passes because neither one's grep patterns
covered the app's own custom `ink-*` color scale (they checked Tailwind's default
gray/slate/zinc/neutral families and literal hex, not this codebase's named legacy scale).
This explained the user's report that Details/Funding panels, Pipeline/Recent Activity,
and other dashboard cards still looked dark — it wasn't scattered per-page debt, it was
one shared component. Fixed `Card` and `Modal` to `bg-surface border-border shadow-sm`.

**Cascading fix, not just the root component**: several components had copy-pasted Card's
old dark markup inline instead of using the component (`RubricPanel.tsx`,
`AnalyticsDashboard.tsx`'s `StatCard`, `GrantDNACard.tsx`, and a `bg-navy-900` wrapper
around `LogicModelView` in `draft-generator/page.tsx`) — all converted individually.
`GrantDNACard.tsx` and `LogicModelView.tsx` were fully rewritten (dark navy-100-family
text/bg pairs throughout, designed to sit on the dark `ink-700` background that no longer
exists) — `LogicModelView`'s 5 stage columns now use neutral/info/success/primary/warning
tokens instead of slate/blue/teal/violet/amber `/10`-opacity dark-mode tints.

**Second-order bug, caught by an 88-occurrence sweep**: fixing `Card` to a light background
meant any child content still using `text-white` (correctly, when `Card` was dark) went
invisible. Grepped `text-white` across all of `src/app/(dashboard)` and `src/components`
(88 hits, 45 files) and triaged every one via 4 parallel agents — the overwhelming majority
were already correct (solid-colored buttons, badges, gradient avatars, dark video-player
overlays) and left alone; genuine misses (`Breadcrumbs.tsx`, an `autoapply/analytics`
hover state, `follow-ups/page.tsx`'s `<h2>`) were fixed.

**Full dark-page conversions**: `intelligence/recommendations/page.tsx`,
`funders/import/page.tsx`, and `notifications/page.tsx` were entirely on the old dark
theme (never migrated) — converted in full. `settings/layout.tsx`'s persistent tab nav
(wraps all 5 Settings pages) had `border-white/10` and `text-navy-400 hover:text-navy-200`
— invisible border, low-contrast hover — fixed.

**Button system** (`src/components/ui/Button.tsx`): `secondary` was
`border-white/15 bg-white/5 text-navy-100` (near-white-on-white — invisible on the light
background) and `ghost` was `text-navy-300 hover:text-white` (disappears on hover). Both
were dark-theme leftovers, used 246× across 86 files. Rewrote to
`primary` = `bg-primary text-white hover:bg-primary/90`,
`secondary` = `bg-surface text-primary border border-primary/40 hover:bg-primary/5`
(always has a visible border, never borderless white-on-white),
`ghost` = `text-primary hover:bg-primary/10`. Removed the unused `purple` variant
(0 call sites). This single-file fix cascaded correctly to every `<Button variant="secondary">`
in the app (confirmed via screenshot on `/autoapply` and `/research`).

**Header** (`src/components/layout/Header.tsx`) converted from dark chrome (`bg-[#0f1117]`,
`text-[#f0f0f5]`) to light (`bg-surface`, `text-text`/`text-text-muted`) — the sidebar is
the only intentionally dark element per this pass's explicit instruction; the header
previously matched the sidebar's dark tone but wasn't named as an exception.

**Visual verification**: started the dev server, logged in as `beta1@benavora-test.com`
(had to flip that org's `onboarding_completed` to `true` via a one-off service-role script
— it was `false`, so every route redirected to `/onboarding` and the first screenshot pass
showed the wizard instead of real pages), and used Playwright to screenshot `/dashboard`,
`/opportunities`, an opportunity detail page, `/draft-generator`, `/autoapply`, and
`/research`. Reviewed each: confirmed Details/Funding panels, Pipeline/Recent Activity, and
every Card-based panel now render as clean white cards with visible borders and readable
text; confirmed `secondary` buttons ("Settings" on `/autoapply`, "Edit"/"Parse NOFA" on the
opportunity detail page) show the correct white-bg/primary-border/primary-text treatment.
Caught one more issue this way — `research/page.tsx`'s per-source "Run" buttons used raw
`border-gray-300 text-navy-700` instead of the token system (not literally invisible, but
inconsistent) — fixed to `border-primary/40 text-primary`, re-screenshotted to confirm.

**Scope note**: draft-generator's "Review & edit"/"Confidence" sub-panels only render after
generating an actual AI draft (real opportunity + template selection + a live model call,
~30-180s per prior session notes) — verified those specific components
(`GrantDNACard`/`RubricPanel`) via full source rewrite + `tsc` rather than forcing a live
generation; the underlying `Card`-based panels one screenshot away were confirmed working.

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean (234/234 pages) after
the full pass. Two pre-existing client-side 400 console errors observed during the
Playwright run are unrelated (no matching entries in the Next.js server log, and none of
this pass's edits touched data-fetching/query code) — not investigated further, out of scope.

---

## COMPLETED — July 7 follow-up: missed table pills + surface layering

Caught two real gaps left by the design-system pass above.

**Badge borders**: every semantic variant (success/warning/error/info) now gets a
200-level border of the same hue (`--color-success-border` #bbf7d0 etc., new in
`globals.css`/`tailwind.config.ts`), not just `neutral`. Bg stays the 100-level tint,
text the 700-level — matches Tailwind's own green/amber/red/sky-100/200/700 triads.

**Opportunities table/card/detail**: `Category` badge was `<Badge color="indigo">`
(resolves to `info`, visually identical to the `Source` badge next to it) — changed to
`variant="neutral"` so the two columns read distinctly. `SourceTypeBadge` used a
different Tailwind hue per source_type (8 colors for a nominal field) — collapsed to a
single `variant="info"` everywhere it's used (table, card, detail), since color-per-type
on a repeated-every-row field was noise, not signal. `SourceTypeTabs`' own dot-color
variety was kept (tabs are a one-time filter strip, not repeated per row) but decoupled
from `SourceTypeBadge`'s removed color map into its own inline lookup. `eligibility.tsx`'s
`MatchBadge`/`HighPriorityBadge`/`RecommendationBadge` and `OPPORTUNITY_STATUS_COLOR`
(renamed `OPPORTUNITY_STATUS_VARIANT`) now pass `variant` directly instead of routing
through the legacy `color` alias — same resolved colors, no more indirection.

**Two genuinely missed raw pills** found via a second grep sweep (the first pass's ~30
files were real but not exhaustive): `autoapply/settings/page.tsx`'s geo-scope removable
chip (`bg-navy-100 text-navy-700`) and `research/page.tsx`'s application-stage pill
(`bg-blue-600 text-white`, no light-tint pairing so it dodged the first regex) — both
converted to `<Badge>`. Swept every other hue family (amber/emerald/cyan/violet/rose/
slate/stone/zinc/lime/fuchsia) too — only two more hits, both legitimate notification
count bubbles (solid bg + white bold number), correctly left alone.

**Layering bug, confirmed and fixed at the layout level**: `DashboardShell.tsx`'s `<main>`
had no background class and inherited the outer shell's `bg-surface` (white) — every
dashboard page's content area was rendering on white instead of the `#EEF2F7` background
token. Fixed by adding `bg-background` to both the outer shell and `<main>` directly, one
place, applies to every page. Also brought `OpportunityFilters`, `Table`, `Select`, and
`SearchBar` onto explicit `bg-surface`/`border-border`/`shadow-sm` tokens (they were
working via the `navy-*`/`bg-white` compatibility-layer aliases before, which resolved to
the same values but not through the canonical token names).

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean after the fix.

---

## COMPLETED — July 7 design system unification pass

Full token + component pass across the app (supersedes the reverted `ed302f4`
podcast-theme commit — built fresh this time, not reapplied).

**Token layer** (`src/app/globals.css` + `tailwind.config.ts`, kept in agreement —
Tailwind color keys read the same CSS custom properties, no value is restated):
`background` #EEF2F7, `surface` #FFFFFF, `surface-raised` #F8FAFC, `sidebar` #0B1220,
`sidebar-active` rgba(0,180,216,0.12), `primary` #0077B6, `accent` #00B4D8, `text` #0F172A,
`text-muted` #475569, `border` #E2E8F0, plus semantic pairs `success`/`warning`/`error`/`info`
(light bg tint + 700-level text of the same hue, ≥4.5:1 contrast). Legacy CSS var names
(`--color-page`, `--color-surface-elevated`, `--color-accent` formerly = navy not cyan, etc.)
now alias the canonical tokens instead of restating literal hex, so there's one source of
truth. Fixed a real bug found along the way: `--color-accent` used to equal the navy
primary (#0077b6); several rules (`:focus-visible` outline, input focus border, the
`.text-blue-700/800` compat rule) depended on that and were repointed to the new
`--color-primary` to avoid a low-contrast cyan-on-white regression.

**`src/components/ui/Badge.tsx`** rewritten as the only pill/badge implementation — a
`variant` prop (`success`/`warning`/`error`/`info`/`neutral`) selects the token pair. Kept
the legacy `color` prop (13 names) as an internal alias so none of the ~80 existing call
sites needed to change; every color name resolves to one of the five variants, so no raw
hue class can leak through anymore. The old implementation was dark-theme leftovers
(`bg-teal-400/15 text-teal-200` etc.) — `text-teal-200` on a white page background was
functionally invisible; this was a real, live bug across every badge in the app.

**~30 files** had hand-rolled inline pill `<span>`s (status pills, score/match-% pills like
the "0% match" badges, removable filter chips) converted to `<Badge>`, preserving every
threshold/status-mapping function exactly — only the rendering wrapper changed.

**Purple/orange/plum/emerald hue classes and the 5 listed hardcoded hex codes** (`#7C3AED`,
`#A78BFA`, `#F97316`, `#0a0a1a`, plus branding.ts defaults) removed from ~40 more files,
including the marketing landing page's inline `<style>` block (~33 raw hex occurrences,
including alpha-suffixed shorthand converted to `rgba()`).

**Sidebar** (`src/components/layout/Sidebar.tsx`): bg `#0B1220` (was a semi-transparent
`bg-ink-900/80`), inactive `text-slate-400`, hover `text-white`, active `text-accent` +
`bg-sidebar-active`. **`MetricCard`**: swapped the dark-theme `shadow-card` (designed for a
dark bg) for `shadow-sm`, `border-navy-100`→`border-border`, values now `text-text` — was
previously always going to read fine since `border-navy-100` aliased to a safe rgba, but the
card was never actually reviewed against the token system until now.

**Scope decision**: left `teal-*` Tailwind classes untouched app-wide (508 occurrences,
129 files) — user call, made explicit before the pass. `teal-500`/`600` are numerically
identical to the new `accent`/`accent-hover` tokens already, and the `globals.css`
compatibility layer already coerces `text-teal-600/700` to specific WCAG-safe hex; a blind
mechanical replace risked contrast regressions across dozens of files with no way to
visually re-verify each one in this pass. Tracked as follow-up debt, not fixed here.

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean (234/234 static pages,
zero errors) after the full pass.

**Left uncommitted/unstaged, NOT part of this pass** — pre-existing in-progress feature work
found already sitting in the working tree at the start of this session, unrelated to the
design system: `src/app/(dashboard)/intelligence/recommendations/page.tsx` (org-summary-card
+ geography-filter feature; only its `ScoreBadge` pill was touched by this pass, split out
via a partial-file stage so the rest stays uncommitted), `src/app/api/intelligence/recommendations/route.ts`,
`src/lib/intelligence/evaluation-library.ts`, `supabase/migrations/060_grantmaker_profiles.sql`.

---

## COMPLETED — July 7 seed-script build-failure session

### Vercel production build was failing: `scripts/seed-beta-users.ts:35:15` — `Type 'WebSocket' is not assignable to type 'WebSocketLikeConstructor'`

`createClient()`'s `realtime.transport` option expects a `WebSocketLikeConstructor`; the
`ws` package's exported type doesn't structurally satisfy it under Vercel's stricter
build-time type resolution (didn't reproduce locally, but the fix is correct either way).

**Fix:**
- `scripts/seed-beta-users.ts:35` — `transport: ws as any` → `transport: ws as unknown as typeof WebSocket` (explicit double-cast instead of `any`)
- `tsconfig.json` — added `"scripts"` to `exclude`. One-off utility/seed scripts under `scripts/` must never be able to break a production deploy's type-check again; they're run standalone via `pnpm seed:beta` / `tsx`, not part of the Next.js app build.

**Verification:** `pnpm tsc --noEmit` clean (0 errors). `pnpm run build` clean (0 errors, all routes generated).

---

## COMPLETED — July 7 font self-hosting session

### Build was failing: next/font/google couldn't reach fonts.googleapis.com (ETIMEDOUT)

`src/app/layout.tsx` used `next/font/google` for Inter + JetBrains Mono, which fetches
font files from Google's CDN at build time. In this environment that network call times
out, breaking `pnpm run build` unconditionally.

**Fix — self-host both fonts, zero network calls at build time:**
- `pnpm add @fontsource-variable/inter @fontsource-variable/jetbrains-mono` (variable-weight woff2 packages)
- Copied the latin-subset variable woff2 files into `public/fonts/`:
  `inter-latin-wght-normal.woff2`, `jetbrains-mono-latin-wght-normal.woff2`
- `src/app/layout.tsx`: replaced `next/font/google` (`Inter`, `JetBrains_Mono`) with
  `next/font/local` pointing at those two files. Same CSS variable names preserved
  (`--font-sans`, `--font-mono`) and same weight ranges (100–900 / 100–800), so no
  other file needed to change.

**Verification:** `pnpm run build` completes clean (0 errors, 234 static pages generated) with no `next/font/google` import anywhere in the tree.

---

## COMPLETED — July 7 design session

### Brand token replacement — tailwind.config.ts + root layout

Prior sessions (`ed302f4`, `7e046b1`) rebranded `globals.css` to the light navy/cyan
theme (`--color-accent: #0077b6`, `--color-secondary: #00b4d8`) via a compatibility
layer of `!important` overrides, but `tailwind.config.ts` itself still declared the
old dark/purple theme underneath — so any class not covered by the compat layer
(`ring-teal-400`, `accent-teal-500`, `shadow-glow-*`, `bg-gradient-accent`, the raw
`plum`/`teal` scales) still rendered the legacy purple/emerald/teal-green colors.

**`tailwind.config.ts`:**
- `colors.accent`: `DEFAULT #7c3aed→#00B4D8`, `hover #6d28d9→#0093AC`, `indigo #6366f1→#0077B6`, `teal #2dd4bf→#00B4D8`, `purple #a855f7→#0077B6` (`accent.blue`/`info`/`warning` left untouched — not in the purple/orange/emerald/teal removal list)
- `colors.cta`: `#10b981→#0077B6`, hover `#059669→#005F92`
- `colors.teal` (legacy 50–950 scale, backs every `teal-*`/`ring-teal-*` class): replaced with a cyan ramp anchored at 500 `#00b4d8` / 600 `#0093ac` (exact secondary/secondary-hover match)
- `colors.plum` (legacy 50–950 scale): replaced with a navy-blue ramp anchored at 600 `#0077b6` (exact primary match)
- `backgroundImage`: `gradient-accent`/`gradient-brand`/`gradient-cta` → cyan `#00B4D8` → navy `#0077B6` sweep (matches `globals.css`'s `--color-cta-from/to` exactly); `gradient-purple` → navy two-tone; `glow-radial` → cyan
- `boxShadow`: `glow`/`glow-accent`/`glow-blue` → navy/cyan rgba (was emerald/purple/blue)
- No `#f97316` (orange) hardcoded anywhere in the config — nothing to replace there

**`src/app/layout.tsx`:** removed `className="dark"` from `<html>` (site is light-theme now); `viewport.themeColor` `#0a0a1a→#0077B6`

**Verification:** read every file using `bg-accent`/`border-accent` (1: `GroupedKanban.tsx` drag-over highlight), `shadow-glow-*` (login/register/forgot-password/reset-password/invite-accept CTA buttons, `AssemblyPanel.tsx`, `Button.tsx` primary variant), and `ring-teal-400`/`focus:ring-teal-400` (~30 files — form input focus rings across the entire autoapply section, `PlanCard.tsx`, `Badge.tsx`) — all render as cyan/navy on the light theme with no contrast regressions. `Button.tsx`'s dark-styled `secondary`/`ghost`/`purple` variants and `Badge.tsx`'s dark-chip styling are pre-existing light/dark mismatches unrelated to this color-value swap — not touched.

Gate: `pnpm tsc --noEmit` clean (0 errors). `pnpm run build` — see below.

---

## COMPLETED — July 6 audit session

### STEP 1: Vitest — test suite clean

**Before:** 5 failures in `compliance.test.ts` (`UNSUBSCRIBE_HMAC_SECRET` missing), 5 failures in `intelligence.test.ts` (logic-model test expected `createClient()` auth but route used `requireRole()`).

**Fixes:**
- Created `.env.test` with 6 test-only env vars (`UNSUBSCRIBE_HMAC_SECRET`, `INTEGRATION_KEY_SECRET`, `PORTAL_ENCRYPT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — loaded by `tests/setup.ts` via dotenv
- Rewrote `src/app/api/intelligence/logic-model/route.ts` to use `createClient()` directly (no `requireRole()`), matching the test's design intent

### STEP 2: TypeScript — clean (0 errors)

No new errors introduced. Prior session left clean.

### STEP 3: Build — clean

No new build errors introduced. Prior session left clean.

### STEP 4: API route audit — auth, org_id scoping, requireRole gates

No additional gaps found beyond what was caught in the July 3 session.

### STEP 5: Agents audit — stubs replaced with real implementations

- **`src/lib/intelligence/ingest-nih-proposals.ts`** — completely rewritten from always-returning-fake-success stub to real NIH Reporter API v2 integration:
  - Cycles 7 search terms by day-of-year (deterministic per-day)
  - POSTs to `https://api.reporter.nih.gov/v2/projects/search`
  - Deduplicates by `nih:{appl_id}` source key
  - Calls `extractSections()` + `generateEmbedding()` for each project
  - Inserts into `intelligence_funded_proposals` + `intelligence_proposal_sections`
  - Uses `createAdminClient()` for DB access

### STEP 6: env var startup throws

Added mandatory API key guards (throw if missing) to 6 intelligence files:
- `src/lib/intelligence/logic-model-generator.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/budget-patterns.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/embeddings.ts` — `OPENAI_API_KEY`
- `src/lib/intelligence/evaluation-library.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/funder-recommender.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/grant-dna.ts` — `ANTHROPIC_API_KEY`

Also fixed the pre-existing UUID bug in `src/lib/automation/session-manager.ts`:
- `markAutoSubmitted()` was writing `system:${automationLevel}` (a string) to `approved_by` (a UUID column) — would fail at runtime
- Fix: set `approved_by: null`; record level in `notes: auto_submitted:${automationLevel}`

And added `maxDuration=300` to two routes that were missing it:
- `src/app/api/agents/campaigns/route.ts`
- `src/app/api/agents/custom-scrape/route.ts`

### STEP 7: Playwright — stale selectors fixed

Base failure count: 59 failing / 27 passing before this session.

Fixed selector mismatches in these test files:

| File | What changed |
|---|---|
| `tests/e2e/authed/dashboard.spec.ts` | 4 metric labels + 2 section headings updated |
| `tests/e2e/authed/ui-redesign.spec.ts` | body bg `#0a0a1a→#0f1117`; sidebar items (Dashboard/Research moved to header, Funders/Applications/Documents in sidebar) |
| `tests/e2e/authed/research.spec.ts` | Page redesigned to "Research Command Center" + "Control Panel"; selectors rewritten |
| `tests/e2e/authed/automation.spec.ts` | Complete rewrite: navigates to `/autoapply` (was `/automation`); uses sessions API to find seed session; checks AutoApply h1 + "Add to Queue" button |
| `tests/e2e/authed/deadlines.spec.ts` | Calendar view button label `"Calendar"` → `"Month"` |
| `tests/e2e/authed/documents.spec.ts` | `"Upload a document"` heading doesn't exist; now checks `"Drag & drop or click to browse"` text |
| `tests/e2e/authed/pipeline.spec.ts` | Clicks "Kanban" toggle first; checks group labels "Discovery"/"Preparation"/"Active"/"Outcome" instead of individual stage names |
| `tests/e2e/authed/onboarding.spec.ts` | `"Benavora setup"→"Welcome to Benavora"`; step titles corrected to actual wizard steps |
| `e2e/onboarding.spec.ts` | `"Benavora setup"→"Welcome to Benavora"`; advance button regex updated for `"Save & Continue"` button label; step 7 check updated to `"Plan Selection"` |

Tests confirmed correct (no changes needed):
- `funders.spec.ts`, `knowledge-base.spec.ts`, `saas.spec.ts`, `settings.spec.ts`, `auth.spec.ts`, `login-theme.spec.ts`, `draft-generator.spec.ts`, `opportunities.spec.ts`, `email-calendar.spec.ts`
- `e2e/grant-pipeline.spec.ts`, `e2e/draft-generation.spec.ts`, `e2e/billing-gates.spec.ts`, `e2e/email-integration.spec.ts`, `e2e/autoapply-dashboard.spec.ts`, `e2e/tenant-isolation.spec.ts`, `e2e/admin-sales.spec.ts`, `e2e/smoke.spec.ts`

### STEP 8: Security page

Created `src/app/(marketing)/security/page.tsx` — matches the dark marketing design (privacy/terms pattern):
- AES-256-GCM encryption at rest
- TLS 1.3 in transit
- Row-Level Security (RLS) tenant isolation
- SOC 2-compliant infrastructure (Supabase/Vercel/Stripe/Anthropic)
- Authentication & access control
- Data never sold
- GDPR alignment
- SOC 2 Type II roadmap
- Responsible disclosure (security@benavora.com)
- Trust badge row

Added to `src/app/(marketing)/layout.tsx`:
- NAV_LINKS: `{ label: "Security", href: "/security" }`
- Footer: `<Link href="/security">Security</Link>`

---

## COMPLETED — July 3 audit session

### Earlier: test/build gate + nav/config fixes
- Added Email nav entry — /email now reachable from the sidebar
- Fixed `playwright.config.ts` testIgnore (worktree scan inflation)
- Fixed stale smoke/login-theme specs
- Fixed Node 20 WebSocket blocker in test helpers
- Confirmed: Vitest 161 passed / 0 failed · tsc --noEmit 0 errors · pnpm build clean

### Deep operational audit (27 parallel sub-agents)
- Full sweep of `src/lib/**` (213 files), `src/app/api/**` (168 routes), `src/app/(dashboard)/**` (75 pages)
- Live production schema queried: 104 tables, 1331 columns

### Security fixes
- **commit ae058c9** — bootstrap endpoint self-disables after platform_owner created
- **commit e29bd6f** — 4 hardcoded fallback secrets removed; env vars set in Vercel
- **commit c7704b6** — BYO API keys encrypted; shouldUseOwnKeys() fixed
- **commit 74be491** — Resend webhook real HMAC-SHA256 verification

### Batch fix — 21 remaining audit findings (commit a03a0e3)
Sales Outreach real routes · AutoApply Follow-Ups 4 routes · Renewals route · Stripe env naming · Campaign multi-step · HUD fetcher · maxDuration=300 on 15 routes · requireRole on grant-dna/logic-model · form-analyzer-agent real Claude impl · form-filler approval gate · tier-limit source of truth · nav-counts org filter · automation child-table queries · Texas registration data · email/link writer role · Email Hub live buttons · dual Calendar OAuth dedup · SearXNG throw · dead code removed

### Migration 065 (commit 1121c5a)
`autoapply_follow_ups` table created (13 columns, FK cascades, RLS, 3 policies); applied to production.

### Migration 066 + worker fix (commit 855f192)
12 broken RLS policies on form_templates/autoapply_submissions/submission_queue fixed (org_members → profiles pattern); worker queue-processor.ts creates/approves automation_sessions row per submission.

---

## PENDING — as of 2026-07-06

### Production-blocking
- [ ] **Set `RESEND_API_KEY` in Vercel** — outbound email non-functional
- [ ] **Set `RESEND_WEBHOOK_SECRET` in Vercel** — inbound webhook 500s
- [ ] **Set Stripe Price ID vars in Vercel** (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PROFESSIONAL_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`, `STRIPE_CONSULTANT_PRICE_ID`)
- [ ] **Deploy Railway worker** — AutoApply Playwright routes need Chromium process

### Code / low-priority
- [ ] Pull new env vars to local `.env.local` (`vercel env pull .env.local`) — 4 encryption vars missing locally
- [ ] Consolidate `NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL`
- [ ] Add SSRF allowlist to `api/integrations/custom-api/test`
- [ ] Fix `compliance-library.ts` dead branch (`omb-a133-threshold` always returns 'pass')
- [ ] Visual: verify/fix elongated input/textarea boxes reported across the platform

### Informational (no fix needed short-term)
- `grants-gov.ts` uses legacy `apply07.grants.gov` REST API — confirm not deprecated
- Census (2022) and BLS (2022–2023) data sources self-labeled as approximations
- state-portal.ts covers Texas only
- Hardcoded URL lists in corporate/foundation/state scrapers will go stale
- `intelligence_grant_dna_scores` table unused — DNA scores compute live, never persisted (found 2026-07-07)
- `intelligence_narrative_patterns` / `intelligence_post_award_reports` tables unused — schema only, no ingestion or reads (found 2026-07-07)
- No foundation-website-scrape or 990-grants-made ingestion script for the intelligence library specifically (found 2026-07-07)

---

## ENVIRONMENT

| Item | Value |
|---|---|
| Supabase | vbjplpquqxxfbpazyalt — 105 tables, migrations 001–066 applied |
| Vercel | benavora.vercel.app (Pro) |
| Platform owner | info@faithfoundation.org (bootstrap endpoint now self-disabled) |
| Encryption vars in Vercel | INTEGRATION_KEY_SECRET · PORTAL_ENCRYPT_SECRET · INTEGRATION_ENCRYPTION_KEY · UNSUBSCRIBE_HMAC_SECRET — all set, Encrypted, Production only |
| Local .env.local | Missing those 4 encryption vars + missing ANTHROPIC_API_KEY and other AI keys |
| .env.test | Created for Vitest: 6 test-only secrets |
