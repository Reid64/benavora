# mkt-003 STEP 1: Current Home page inventory (before)

Read in full: `src/app/(marketing)/page.tsx` (thin server wrapper, 7 lines,
`export const revalidate = 3600`) which renders
`src/app/(marketing)/MarketingPageClient.tsx` (the actual "current dark home
page" content, 1047 lines, `"use client"`).

The client component uses its own local brand token object `B` (near-black
`#080C14` canvas, gold `#D4A94D` / `#B88A2E` primary accent, bronze/slate
secondary accents) which is entirely separate from `src/lib/marketing/theme.ts`'s
`mk` "Forest and paper" tokens introduced by the blueprint. It also self-hosts
its own nav and footer (the real page.tsx is not wrapped by
`MarketingNav`/`MarketingFooter` when rendering this client component's own
`<nav>`/`<footer>` markup).

## Sections present (top to bottom)

1. **Nav** (sticky, dark, blurred) - "Product" / "For Consultants" / "Pricing"
   links, "Sign In", gold "Get Started" CTA -> `#pricing`.
2. **Hero** - centered Benavora logo image, gold/bronze gradient eyebrow pill
   ("AI-Powered Nonprofit Funding Platform"), H1 "Your mission deserves every
   dollar available to it." (gradient-text second line), sub-paragraph,
   "Start Free Trial" primary CTA -> `#pricing`, "Watch a demo" ghost link,
   4 trust badges (14-day trial, no credit card, SOC 2, data not used for
   training).
3. **Social proof stats strip** - 3 animated `Counter` stat cards (1.97M+
   nonprofits, 113 awarded narratives, 30 AI agents).
4. **"The nonprofit funding reality in 2026" stats band** - 4-column animated
   stat grid (93%, 40 hrs, 14%, 2.1M+) with a closing gradient-text line.
5. **Feature deep-dive "Six AI systems working in parallel"** - 6 numbered
   cards (AI Grant Discovery, Autonomous Draft Generation, AutoApply,
   Fundability Intelligence, Digital Twin, Strategic Advisor), link to
   `/how-it-works`.
6. **"How It Works" 3-step strip** - Complete Digital Twin / Agents discover
   overnight / Review and submit.
7. **"The Math" cost comparison** - Without Benavora vs. With Benavora
   Professional side-by-side cost tables ($79,360 vs $10,764/yr).
8. **Pricing** (`id="pricing"`) - monthly/annual toggle, 3 tier cards
   (Starter $397, Professional $897 "Most Popular", Enterprise $2,497) each
   with feature checklists, plus a competitor-comparison strip (Instrumentl,
   SmartSimple, Benavora).
9. **Outcomes** - 3 illustrative-outcome stat cards (3x opportunities, 40->4
   hrs, +28 pts fundability) with a disclaimer line.
10. **FAQ** - 6 accordion questions/answers.
11. **Final CTA band** - "Your mission is too important to leave funding to
    chance.", "Start Free Trial" + "Schedule a demo" CTAs.
12. **Footer** - logo, Privacy/Terms/Security/Contact links, copyright.

## Interactive/client state

`useState` for `annual` (pricing toggle), `openFaq` (accordion), `_hovered`
(unused hover index); an `IntersectionObserver`-driven `Counter` animation
component used in 3 different stat sections; inline `<style>` block with
keyframe animations (`fadeUp`, `glow`) and hover rules.

## Scope note

None of this content maps to the mkt-003 Step 2 spec (hero + three doors +
lifecycle strip + platform grid + solutions grid + pull-quote + final CTA).
Per the task instruction ("Remove every element of the old dark page that is
not in this list"), all 12 sections above are being replaced. Real nav/footer
for the new page come from the `(marketing)` layout's `MarketingNav` /
`MarketingFooter` (`src/app/(marketing)/layout.tsx`), not from page-local
markup, so items 1 and 12 above are dropped as page content and are handled
by the layout instead.
