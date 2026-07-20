/**
 * UI inline-style audit — 2026-07-20
 *
 * Scope: src/app/(dashboard)/dashboard/page.tsx, opportunities/page.tsx,
 * applications/page.tsx, intelligence/page.tsx.
 *
 * Rule under audit (BLUEPRINT_v2.md §7.5, "The Only UI Rule That Works"):
 * all colors/backgrounds/shadows/borders must be inline style={{}} with
 * hardcoded hex values. Tailwind is only permitted for layout, typography,
 * and other non-color utilities.
 *
 * Live-source note: all four pages already render on canvas #D6E4F0, not
 * BLUEPRINT_v2.md §7.1's documented #C8D4DC. Verified against the actual
 * file contents below, not the doc. #D6E4F0 (this task's requested canvas
 * color) is what's actually live in production on all four pages audited —
 * treating live source as ground truth per prior "verify live source"
 * guidance, not the governance doc's stale value. Flagging the doc/prod
 * drift for a future governance sync; not fixed here (out of scope).
 *
 * ---------------------------------------------------------------------
 * 1) src/app/(dashboard)/dashboard/page.tsx
 * ---------------------------------------------------------------------
 * Tailwind color classes found:
 *   - Line ~457 (no-organization error state):
 *       className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
 *     This is the ONLY color-bearing Tailwind usage in the file.
 * CSS variable references (var(--*)):
 *   - None found.
 * Elements with no styling at all (naked divs/spans):
 *   - None. Every div/span/element carries either an inline style object
 *     or a non-color Tailwind utility (layout/animation only, e.g.
 *     className="flex items-center justify-between", className="animate-pulse",
 *     className="text-xs font-medium" for a link that also gets its color
 *     from an inline style prop).
 * Hardcoded inline styles already present:
 *   - Extensive — the file is ~95% inline style={{}} with hex/rgba values
 *     already (hero banner, action items tray, pipeline section, deadlines
 *     panel, quick actions, funding summary, autonomous activity feed,
 *     strategic advisor card). Canvas background is #D6E4F0 (line ~576).
 * Verdict: one violation, fixed this session (see below).
 *
 * ---------------------------------------------------------------------
 * 2) src/app/(dashboard)/opportunities/page.tsx
 * ---------------------------------------------------------------------
 * Tailwind color classes found:
 *   - None. The entire file uses inline style={{}} for every colored
 *     surface (header, filter bar, stat cards, table, badges, empty state
 *     is a separate component). No bg-, text-, or border- color-utility
 *     classes appear anywhere in this file.
 * CSS variable references (var(--*)):
 *   - None found.
 * Elements with no styling at all:
 *   - None found.
 * Hardcoded inline styles already present:
 *   - Extensive — canvas #D6E4F0, header, filter bar, StatCard component,
 *     table header/rows, source/probability/eligibility badges all use
 *     inline hex values already.
 * Verdict: no violations. No rewrite needed or performed.
 *
 * ---------------------------------------------------------------------
 * 3) src/app/(dashboard)/applications/page.tsx
 * ---------------------------------------------------------------------
 * Tailwind color classes found:
 *   - Line ~372 (clone-modal error message):
 *       className="text-sm text-red-600"
 *     This is the only color-bearing Tailwind usage in the file.
 *   - Line ~360: className="space-y-4" is layout-only, not a color class.
 * CSS variable references (var(--*)):
 *   - None found.
 * Elements with no styling at all:
 *   - None found.
 * Hardcoded inline styles already present:
 *   - Extensive — canvas #D6E4F0, header, stage-family tabs, error banner,
 *     ApplicationRow cards (accent bar, stage/AI-draft/review badges,
 *     probability badge, clone button) all inline hex.
 * Verdict: one violation found. Not rewritten — this file is out of scope
 * for this task's rewrite step (dashboard + opportunities only). Flagged
 * for a follow-up session.
 *
 * ---------------------------------------------------------------------
 * 4) src/app/(dashboard)/intelligence/page.tsx
 * ---------------------------------------------------------------------
 * Tailwind color classes found:
 *   - None. Every Tailwind className in this file is layout/typography-only
 *     (e.g. "min-h-screen p-6", "grid grid-cols-1 gap-4 sm:grid-cols-2
 *     lg:grid-cols-3", "flex h-11 w-11 shrink-0 items-center justify-center
 *     rounded-lg", "text-2xl font-bold tracking-tight", "rounded-full
 *     px-2.5 py-1 text-xs font-bold"). All actual color values (CANVAS,
 *     CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TRACK_BG,
 *     BADGE_NEUTRAL_BG/TEXT, BADGE_ALERT_BG/TEXT, per-module `color`) are
 *     hex constants passed through style={{}}. Complies with §7.5.
 * CSS variable references (var(--*)):
 *   - None found.
 * Elements with no styling at all:
 *   - None found.
 * Hardcoded inline styles already present:
 *   - Extensive, via named hex constants at the top of the file
 *     (CANVAS = "#D6E4F0", CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY,
 *     TRACK_BG, BADGE_NEUTRAL_BG/TEXT, BADGE_ALERT_BG/TEXT) plus a
 *     per-module `color` hex value on each MODULES entry.
 * Verdict: no violations. No rewrite needed or performed.
 *
 * ---------------------------------------------------------------------
 * Actions taken this session
 * ---------------------------------------------------------------------
 * - dashboard/page.tsx: replaced the one Tailwind-color className on the
 *   no-organization error state with inline style={{}} hex values
 *   (border #FECACA, background #FEF2F2, text #B91C1C — matching the
 *   existing error-banner palette already used elsewhere in this file's
 *   SectionError component and in opportunities/page.tsx's error banner).
 * - opportunities/page.tsx: no change — already fully compliant.
 * - applications/page.tsx, intelligence/page.tsx: audited only, per task
 *   scope (rewrite step named dashboard + opportunities only). The one
 *   applications/page.tsx violation (text-red-600) is left for a follow-up
 *   session rather than expanded into out-of-scope work.
 */
export {};
