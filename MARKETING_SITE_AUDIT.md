# Marketing Site Audit — 2026-09-05/06

**Read-only evidence-gathering pass. Nothing in this audit was fixed. No code, content, or screenshot was modified.** Fixes are out of scope and will be a separate task once these findings are reviewed.

**Method:** Routes were enumerated by re-executing `src/app/sitemap.ts`'s own route-discovery logic standalone (a filesystem walk of `src/app/(marketing)/` for static `page.tsx` routes, plus `content/marketing/**/*.mdx` for the `[...slug]` catch-all, minus MDX slugs shadowed by a static route at the same path) on 2026-09-05 — not recalled from memory or from `nav.ts` alone (which lists several nav labels, e.g. `/agents`, `/trust`, `/why-benavora`, that only exist as MDX content routes, and several, e.g. `/platform/pipeline-crm`'s nav label "Pipeline and CRM", that don't match their own route's file path 1:1 — the sitemap walk is the only source that can't drift from what's actually deployable). `/login` was added on top of that per this audit's task scope, even though it sits outside the `(marketing)` route group. Screenshots were captured **unauthenticated** against a local `next dev` server with Playwright at 1440×900 (desktop, full page) and 390×844 (mobile, full page); manifest at `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/manifest.json` — **48/48 routes captured, 0 failures**. Six parallel sub-agents each independently opened every screenshot with an image-capable read tool and reported findings against the five defect categories; the lead pass (this document's author) independently re-verified the homepage's two named bugs (brain-network black box, logo) with additional targeted crops and live DOM/computed-style inspection, and cross-checked the shared static screenshot assets in `public/marketing/` directly at full resolution.

## Refresh pass — 2026-09-06 (same-day follow-up)

On re-opening this task, `git status` showed uncommitted working-tree changes to 10 files since the pass above was captured, several of which back pages this audit already covered: `content/marketing/platform/autoapply.mdx`, `content/marketing/trust.mdx`, `src/lib/marketing/nav.ts`, `src/app/(marketing)/pricing/PricingPageClient.tsx` + `page.tsx`, `src/app/(marketing)/for-consultants/ForConsultantsClient.tsx`, `src/components/marketing/WhatWillItCost.tsx`, `src/lib/marketing/structured-data.ts`, `src/lib/utils/constants.ts`, and a new `src/lib/utils/pricing-plans.ts`. Rather than assume the original screenshots were still accurate (or blindly re-running the full 48-page capture, which would have discarded a verified-accurate pass over the ~44 unaffected pages), each changed file was diffed against HEAD to determine whether it changed *rendered, visible* content, and only the routes with confirmed visual-relevant drift were re-captured and re-inspected. Full method and findings below; per-page sections for `/pricing`, `/for-consultants`, and the homepage brain-network sub-finding are updated in place further down, each tagged "(refreshed 2026-09-06)".

**Verified unaffected by the diff (no re-capture needed):** `src/lib/marketing/nav.ts`'s change is a 2-line href swap (`/platform/opportunity-discovery`→`/platform/discovery`, `/platform/ai-grant-writer`→`/platform/draft-generator`) — both old and new destinations are separate routes this audit already screenshotted and assessed independently; the diff only changes which one the top nav links to, not either page's content. `content/marketing/trust.mdx`'s diff is pure textual rewording (old "always holds for review" AutoApply language → new "risk-tiered, routine submissions proceed automatically" language) with no structural/visual change — `/trust`'s five-category findings below are unaffected. `content/marketing/platform/autoapply.mdx` has a large diff but, per `src/app/sitemap.ts`'s own shadowing logic (confirmed by re-reading that file directly), this MDX route is shadowed by the static `src/app/(marketing)/platform/autoapply/page.tsx` and is dead content — unreachable at `/platform/autoapply`, so this diff has zero effect on the live page audited below.

**Environment caveat, disclosed rather than papered over:** a `next dev` server was already running on port 3100 (owned by a separate, concurrently active peer session, `benavora-4c`, confirmed via the agent-listing tool) and was reused rather than starting a second one, per this repo's own documented lesson that multiple concurrent dev servers corrupt the shared `.next` cache. That existing server was, independently of anything this pass touched, already in a partially corrupted state: `GET /solutions` returned a live HTTP 500 with the server's own error payload reading `Cannot find module './vendor-chunks/@opentelemetry+api@1.9.1.js'` against `.next/server/app/(marketing)/[...slug]/page.js` — a stale/corrupted webpack dev cache for the MDX catch-all route bundle, not an application code defect (confirmed: `content/marketing/solutions.mdx` carries no diff). Because a peer session was actively using this server, it was not restarted or cache-cleared to avoid disrupting their concurrent work, consistent with this task's read-only scope. One consequence: `/solutions`, and therefore `/for-consultants` (which redirects there — see below), could not be freshly re-captured this pass; the original 2026-09-05 screenshots of `/solutions` are the best available evidence and are still used below, since that page's own source is unchanged. A second, separate instability was observed on the same server: one otherwise-successful homepage capture showed the page's `WhatWillItCost` section entirely absent from the rendered DOM/text (confirmed by direct `page.evaluate()` text search, not just a visual skim) despite the component being correctly imported and invoked in `HomeClient.tsx` (`src/app/(marketing)/HomeClient.tsx:434`) — most likely a stale compiled chunk for that route predating this component's current wiring, given the vendor-chunk corruption already confirmed elsewhere on the same server. This is called out explicitly in the Homepage section below as an inconclusive live-render check, rather than either asserting a new production bug or silently reusing the prior day's clean capture as if it re-confirmed the current DOM.

## Top-line numbers

- **Total real marketing routes found (incl. homepage, excl. `/login`): 47** — 29 static `page.tsx` routes + 18 MDX catch-all content routes. Full list in "Route inventory" below.
- **Total pages assessed in this audit (47 marketing + `/login`): 48.** Note (added 2026-09-06): one of the 48, `/for-consultants`, is a permanent (308) server-level redirect to `/solutions`, confirmed intentional and documented in `next.config.mjs` — it has no independently-rendered content of its own, so its findings below are inherited from `/solutions` rather than being a distinct page assessment. This doesn't change the 48 count (the URL is still a real, reachable, publicly-linked entry point that was in scope to check), but is stated plainly rather than left implicit.
- **Pages with test-organization / real-customer data leakage: 17 of 48** (see full list and exact visible text under "Cross-cutting finding" below). 16 of those 17 show the synthetic QA label **"Benavora E2E Test Org"**; 2 of those 17 (`/platform/autoapply`, `/solutions/grant-application-automation`) instead show a **real, named customer org, "FAITH Foundation"** — arguably a more serious exposure since it identifies an actual organization, not a synthetic test fixture.
- **Pages with a wrong/mismatched embedded screenshot:** not a single clean number — the defect has two distinct shapes, both confirmed real:
  - **Hard mismatch (screenshot depicts a visibly different feature than the one the page's own headline names): 2** — `/solutions/autonomous-fundraising-platform` (headline promises a "command center" of nine autonomy switches; screenshot shows the unrelated Corporate Marketplace prospect list) and `/solutions/funding-operations-software` (headline is about roles/permissions/audit trails; screenshot shows the unrelated, empty Semantic Funder Matching screen).
  - **Soft mismatch (screenshot is topically related but is an unconvincing empty/all-zero/thin-data state that fails to demonstrate the specific claim being made): 8** — `/solutions/nonprofit-outreach-automation`, `/solutions/nonprofit-prospect-research`, `/platform/draft-generator`, `/solutions/ai-grant-writing-software`, `/solutions/corporate-donation-application-software` (page itself discloses this), `/solutions/corporate-giving-database`, `/solutions/funding-pipeline-software` / `/solutions/grant-deadline-tracking` (both share one thin single-row screenshot), `/solutions/grant-matching-software` (technically-correct match list includes "SONS OF CONFEDERATE VETERANS INC" as a result for a veterans-homelessness mission — a bad example rather than a wrong feature).
  - Everything else with an embedded screenshot was judged a genuine, reasonable match by the page's own headline; pages with no embedded screenshot at all (about half the site — see per-page sections) are N/A for this category, not failures.
- **Brain-network black-box bug: PRESENT — CONFIRMED**, both visually and via live DOM/computed-style inspection. See Homepage section for the full evidence chain (z-index/paint-order proof, not just a visual impression).
- **Logo mismatch vs. "the original approved HTML source": BLOCKED.** The only repo file matching that description, `public/Benavora-Marketing page.html`, contains **zero** embedded logo image (grepped case-insensitively for `logo`: 0 matches; its one embedded `<img>` is `class="bnf-brain-photo"`, the neural-fleet background photo). A comparison as specified cannot be performed against an artifact that doesn't contain what the task assumes. Separately confirmed instead: only one logo asset exists anywhere in the repo (`public/benavora_logo.png`, used everywhere via one shared `Logo` component — no second/substitute logo asset exists to have been swapped in), but that asset's "benavora" wordmark is baked in at a pale cream color that is nearly illegible against the light nav bar used on every marketing page — reproduced on desktop and mobile, and independently reconfirmed by 3 of the 6 sub-agents across unrelated page batches.
- **Generic-template vs. genuinely distinctive: 8 of 48 distinctive, 40 of 48 generic.** Distinctive: `/` (homepage fleet visualization), `/how-it-works`, `/tour`, `/login`, `/platform/autoapply`, `/platform/discovery`, `/platform/draft-generator` (all three "moderately," carried by a real embedded screenshot), `/solutions/donor-prospecting-intelligence` (animated sequence in place of a screenshot). Every other page — all 5 "vertical" solutions pages (faith-based/housing/veterans/education/human-services/community-development are literally the same template with only text swapped, confirmed pixel-identical in structure by direct comparison), all pure-MDX platform pages, all legal/utility pages, and the majority of the SEO solutions pages — was independently and critically assessed as a centered-hero-plus-card-grid template indistinguishable from a generic SaaS site.

## Route inventory (47 marketing routes, ground-truth via `src/app/sitemap.ts` logic)

**29 static `page.tsx` routes:** `/`, `/demo`, `/for-consultants`, `/how-it-works`, `/platform/autoapply`, `/platform/discovery`, `/platform/draft-generator`, `/platform/prospect-intelligence`, `/pricing`, `/privacy`, `/scan`, `/security`, `/terms`, `/tour`, `/solutions/ai-grant-writing-software`, `/solutions/autonomous-fundraising-platform`, `/solutions/corporate-donation-application-software`, `/solutions/corporate-giving-database`, `/solutions/donor-prospecting-intelligence`, `/solutions/funding-operations-software`, `/solutions/funding-pipeline-software`, `/solutions/grant-application-automation`, `/solutions/grant-deadline-tracking`, `/solutions/grant-discovery-software`, `/solutions/grant-matching-software`, `/solutions/human-in-the-loop-ai`, `/solutions/nonprofit-funding-software`, `/solutions/nonprofit-outreach-automation`, `/solutions/nonprofit-prospect-research`.

**18 MDX catch-all content routes (`content/marketing/**/*.mdx`, not shadowed by a static route):** `/agents`, `/company`, `/platform`, `/platform/ai-grant-writer`, `/platform/analytics`, `/platform/funding-intelligence`, `/platform/opportunity-discovery`, `/platform/pipeline-crm`, `/resources`, `/solutions`, `/solutions/community-development`, `/solutions/education`, `/solutions/faith-based`, `/solutions/housing`, `/solutions/human-services`, `/solutions/veterans`, `/trust`, `/why-benavora`.

**Comparison pages:** none exist. No `page.tsx`, MDX file, or nav entry matching "vs", "compare", "comparison", or "alternative" was found anywhere in `src/app/(marketing)` or `content/marketing`.

**Plus `/login`** (outside the marketing route group, included per this audit's task scope) = **48 total pages audited.**

## Cross-cutting finding: shared screenshot assets, exactly which pages embed them, and exactly what's visible

Verified by `grep -rn 'src="/marketing/'` across `src/app/(marketing)/**` and by opening every resulting PNG directly at full resolution in `public/marketing/`:

| Static asset | Exact text/data visible in the image (VERIFIED by direct full-resolution inspection) | Pages embedding it |
|---|---|---|
| `platform-corporate-marketplace-live.png` | "Benavora E2E Test Org" nav badge + sidebar footer | `/solutions/corporate-giving-database`, `/solutions/autonomous-fundraising-platform` |
| `platform-applications-pipeline-live.png` | "Benavora E2E Test Org" + record "Rural Housing Stability Grant (E2E Seed)" funded by "Lone Star Community Foundation (E2E Seed)" | `/solutions/funding-pipeline-software`, `/solutions/grant-deadline-tracking` |
| `platform-autoapply-dashboard-live.png` | **Real customer org "FAITH Foundation"** (not synthetic) + queue rows "Meade Tractor" ×2, "Walmart" ×3, all "skipped" | `/platform/autoapply`, `/solutions/grant-application-automation` |
| `platform-dashboard-overview-live.png` | "Benavora E2E Test Org" as the literal dashboard page title + "E2E Pipeline Test Grant (178336930…)" record | `/solutions/nonprofit-funding-software` |
| `platform-discovery-research-live.png` | "Benavora E2E Test Org" rendered concatenated with its avatar as "Benavora E2E Test OrgBE" + a visibly broken/unstyled nav render (raw concatenated link text, no spacing, e.g. "DashboardResearchOpportunitiesAutoApplyDraft GeneratorDonor Discovery") | `/platform/discovery`, `/solutions/grant-discovery-software` |
| `platform-donor-discovery-live.png` | "Benavora E2E Test Org" + all-zero empty state (0 prospects, 0 signals, 0 submissions) | `/solutions/nonprofit-prospect-research`, `/solutions/nonprofit-outreach-automation` |
| `platform-draft-generator-live.png` | "Benavora E2E Test Org" + opportunity row "E2E Billing Gate Test Opp (178856565532981942)" | `/platform/draft-generator`, `/solutions/ai-grant-writing-software` |
| `platform-funder-matching-live.png` | "Benavora E2E Test Org" + a matched-funder result list including **"SONS OF CONFEDERATE VETERANS INC"** as a result for a mission statement about housing/veterans homelessness | `/solutions/grant-matching-software` |
| `platform-opportunities-corporate-filter-live.png` | "Benavora E2E Test Org" + empty "No opportunities match your filters" state, all stat tiles at 0 | `/solutions/corporate-donation-application-software` |
| `platform-semantic-matches-live.png` | "Benavora E2E Test Org" + empty "No strong matches found" state | `/solutions/funding-operations-software` |
| `tour/01-research.png`, `02-draft-generator.png`, `03-autoapply.png` | "Benavora E2E Test Org" in all three; "E2E Billing Gate Test Opp" in the draft-generator frame | `/tour` |
| `product-screenshot-research.png` | (unused — not referenced by any live page; orphaned asset, not itself a defect) | none |

**Full list of the 17 leaking pages:** `/platform/autoapply` (FAITH Foundation), `/platform/discovery`, `/platform/draft-generator`, `/tour`, `/solutions/ai-grant-writing-software`, `/solutions/autonomous-fundraising-platform`, `/solutions/corporate-donation-application-software`, `/solutions/corporate-giving-database`, `/solutions/funding-operations-software`, `/solutions/funding-pipeline-software`, `/solutions/grant-application-automation` (FAITH Foundation), `/solutions/grant-deadline-tracking`, `/solutions/grant-discovery-software`, `/solutions/grant-matching-software`, `/solutions/nonprofit-funding-software`, `/solutions/nonprofit-outreach-automation`, `/solutions/nonprofit-prospect-research`.

**Also worth noting (not a UI leak):** `/company`'s body copy states in its own narrative text, "Benavora's founding organization, Faith Foundation, is the organization whose own grant work shaped the platform's first version" — this is intentional company-history prose, not an accidental leak, so it is not counted in the 17 above.

**Also worth noting (not org leakage, a separate content-accuracy bug found during this pass):** `/scan`'s lead-capture form uses the placeholder text "Faith Foundation or faithfoundation.org" in its organization-name field — plausibly a generic faith-based-nonprofit example rather than a reference to the real customer, but flagged as **UNKNOWN** (not ruled out) rather than dismissed.

---

## / (Homepage)

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/home__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/home__mobile-390.png` (targeted crops: `home__mobile-top.png`, `home__mobile-fleet.png`)
- Neural-fleet crops: `home__brain-network-stage-crop.png`, `home__brain-network-section-crop.png`
- Nav logo crop: `home__nav-logo-crop.png`

**1. Screenshot match — N/A.** No embedded static product screenshot; the centerpiece is the interactive "Neural Fleet" SVG/CSS visualization (`src/components/marketing/NeuralFleetVisualization.tsx`), an illustrative diagram, not an app screenshot. — *VERIFIED*

**2. Test-org / data leakage — none visible.** No live-app screenshot embedded, so no org names/emails appear. — *VERIFIED*

**3. Brain-network black-box bug — PRESENT, confirmed two independent ways:**
- *Visual:* `home__brain-network-stage-crop.png` and `home__mobile-fleet.png` show the brain photo sitting inside a plain dark rectangular region with no visible spiral/swirl lines anywhere in the surrounding margin, even though the component defines three animated swirl paths (`bnfSwirl` keyframes; `.bnf-swirl` / `.swirl-two` / `.swirl-three`).
- *DOM/computed-style ground truth* (live `page.evaluate()` inspection, 2026-09-05):
  - `.bnf-brain-photo`: `position: absolute`, **`z-index: 1`**, `backgroundColor: rgb(34,38,36)` (the section's own near-black background color), `backgroundImage: url(.../brain-network.webp)`, bounding box `x:419 y:112 w:602 h:602`.
  - `.bnf-svg` (container of the swirl `<path>` elements): `position: absolute`, **`z-index: auto`**, bounding box `x:160 y:49 w:1120 h:700` (the full stage).
  - The three `.bnf-swirl` paths' own bounding boxes (`swirl-one` x:376–1120 y:29–704; `swirl-two` x:373–1105 y:144–760; `swirl-three` x:405–1083 y:86–702) sit almost entirely *inside* the photo's x:419–1021 / y:112–714 box.
  - Because `.bnf-brain-photo` has an explicit `z-index:1` and `.bnf-svg` has `z-index:auto` (painted at the base level regardless of DOM order), the photo's own opaque background paints over the swirl paths for effectively their entire visible extent. The swirl animation genuinely exists and runs — it is simply hidden behind the photo block, exactly matching the reported "black rectangle obscuring the swirling animation" bug.
  - Source: `src/components/marketing/NeuralFleetVisualization.tsx` — `.bnf-brain-photo` rule (~line 584-600, `z-index: 1`) vs. `.bnf-svg` (~line 530, no z-index) and `.bnf-swirl` (~line 561).
  - Classification: **VERIFIED** (both visually and via code/DOM evidence).

**4. Logo accuracy — BLOCKED for the literal "original HTML" comparison; a real, separate defect found instead.**
- `public/Benavora-Marketing page.html` (143,369 bytes, the only file matching the task's description) was grepped case-insensitively for `logo`: **0 matches**. Its only `<img>` is `<img class="bnf-brain-photo" src="data:image/webp;base64,...">` — the neural-fleet photo, not a logo. No embedded logo exists in that file to compare against, byte-wise or visually. — **BLOCKED**.
- Exactly one logo asset exists anywhere in the repo, `public/benavora_logo.png`, rendered everywhere through one shared component (`src/components/layout/Logo.tsx`), including every marketing page and `/login`. No second/unrelated logo asset exists anywhere in `src/` or `public/`. — *VERIFIED*
- **Separately confirmed defect:** `home__nav-logo-crop.png` shows the nav-bar logo's "benavora" wordmark rendering in a near-white/cream color against the light cream nav background — almost illegible, only the gold icon and a faint letter outline read clearly. Reproduces identically on mobile (`home__mobile-top.png`) and was independently reconfirmed by sub-agents on 3 unrelated pages (`/platform`, `/platform/ai-grant-writer`, `/platform/analytics`) who inspected the source asset directly and confirmed the wordmark pixels themselves are pale cream — a static-asset defect, not a capture artifact, so it reproduces on every page. — *VERIFIED*

**5. Generic vs distinctive design — distinctive.** The homepage's centerpiece is a custom interactive SVG/CSS "48 agentic minds" node-and-orbit diagram with pointer-driven parallax and per-division selection state — a bespoke build, independent of the z-index bug above. — *VERIFIED* (fleet section) / *INFERRED* (remaining homepage sections, not exhaustively re-checked beyond the full-page screenshot already on file).

**Refresh pass, 2026-09-06 — two follow-up checks, both inconclusive due to server instability, not new production evidence:**
- *Brain-network region, re-checked:* `src/components/marketing/NeuralFleetVisualization.tsx` carries **zero uncommitted diff** — it is byte-identical to what the finding above was verified against. A fresh capture this pass (`AUDIT_SCREENSHOTS/mkt-refresh-2026-09-06/home__desktop-1440.png`, `home__brain-crop-2026-09-06.png`) instead showed a solid black organic-blob shape with no visible photo at all, and a fresh `page.evaluate()` DOM check found `.bnf-brain-photo` collapsed to zero height while several large `<ellipse>`/`<path>` swirl elements all reported `fill: rgb(0, 0, 0)` — a different, more severe presentation than the z-index-occlusion finding above. Because the source is unchanged and this same dev-server instance was already caught serving a corrupted webpack chunk on an unrelated route (see Refresh pass section above), this fresh capture is treated as **UNKNOWN / likely environment noise**, not a supersede of the finding above. **The z-index-occlusion finding above remains the standing, source-corroborated VERIFIED answer** to "is the brain black-box bug present" — re-confirming it cleanly would require a freshly restarted, uncontended dev server, out of scope for this pass since a peer session is actively using the current one.
- *`WhatWillItCost` cost section, checked for the first time this pass (not evaluated in the original 2026-09-05 pass):* source confirms a real fix landed — `src/components/marketing/WhatWillItCost.tsx` previously showed three placeholder tiers ("Starter/Growth/Enterprise," all "Contact for pricing," none matching `/pricing`'s real tier names) and now imports `PRICING_PLANS`/`AGENCY_PLANS` from the same `src/lib/utils/pricing-plans.ts` module `/pricing` itself uses, rendering four real tiers (Starter/Professional/Enterprise/Agency) with real dollar figures. This directly resolves a previously-known tier-name/placeholder-pricing mismatch on this section. However, a live re-render could not be confirmed this pass: a `page.evaluate()` text search of the fully-loaded homepage found neither the old placeholder copy ("still being finalized") nor the new copy ("Transparent pricing," "award-fee") anywhere on the page — the section did not render at all in that attempt, most likely the same stale-chunk phenomenon affecting this dev-server instance rather than a real regression. **Classification: INFERRED (fix is real and correct in source) — not VERIFIED (could not confirm the fix is what a visitor currently sees, due to environment instability, not a source-code issue).**

---

## /demo

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/demo__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/demo__mobile-390.png`

1. **Match — N/A.** Headline "See how Benavora would fund your mission." Single centered lead-capture form (Work email, Organization website, Role, Primary funding challenge, "Show me a time" button) on a dark green field; no embedded product screenshot. — *VERIFIED*
2. **Leakage — none visible.** Only generic placeholders ("you@yourorganization.org"). — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same mark, rendered faint/washed-out** (low-contrast wordmark) in header and footer. — *VERIFIED*
5. **Generic vs distinctive — generic.** Single centered white card with stacked form fields on a flat color background — the standard "lead-gen form on solid color" pattern. — *VERIFIED*

## /for-consultants (refreshed 2026-09-06 — routing question from the original pass now resolved from source)

- Screenshots: same as `/solutions` — `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions__desktop-1440.png` / `solutions__mobile-390.png` (still the best available evidence of what a visitor sees; see environment caveat below for why a same-day re-capture wasn't possible)

1. **Match — N/A. The original pass's open question ("intentional alias or content/routing gap?") is resolved: intentional, confirmed directly from source.** `next.config.mjs` defines a permanent (308) redirect, with an explanatory comment: `"mkt-001: /for-consultants predates the new marketing IA ... and has no direct replacement page yet, so it points at the closest existing hub, /solutions."` Reproduced live this pass: `curl -sIL http://localhost:3100/for-consultants` returns `HTTP/1.1 308 Permanent Redirect` / `location: /solutions`. So this is not a rendering bug in `ForConsultantsClient.tsx` — it's a deliberate, documented route deprecation; the component never executes for a real visitor. — *VERIFIED (redirect + intent, from source and live curl)*
2. **A genuinely new finding this pass, not in scope of the original five categories but worth flagging: the redirect makes `ForConsultantsClient.tsx` dead code that was actively edited anyway.** `git diff` shows this component's pricing calculator was substantially reworked since the 2026-09-05 capture — its old invented pricing model ($2,999/mo base + $299/client + a one-time setup fee, with no basis in the platform's real pricing) was replaced with the same shared `AGENCY_PLANS` data structure `/pricing` now uses. That is a real accuracy improvement to the component's own code, but because of the permanent redirect above, **no visitor can ever reach this component to see it** — the fix was made to unreachable code. Worth a follow-up decision: either restore a live route for this content (given real work has now gone into it twice) or remove the component to stop it from drifting further. — *VERIFIED (both the redirect and the dead-code edit, from source)*
3. **Leakage — none visible** on the destination `/solutions` page (per the original pass's finding for that page, restated here since this route serves that page's content). — *VERIFIED*
4. **Brain bug — N/A.**
5. **Logo — same faint/washed-out rendering** (per `/solutions`'s own finding). — *VERIFIED*
6. **Generic vs distinctive — generic**, matching `/solutions`'s own assessment, since that is what actually renders. — *VERIFIED*

**Environment caveat for this route specifically:** the dev server's compiled bundle for the `(marketing)/[...slug]` catch-all — which `/solutions` (and therefore the redirect target of `/for-consultants`) depends on — was found mid-pass to be serving a live HTTP 500 (`Cannot find module './vendor-chunks/@opentelemetry+api@1.9.1.js'`), a corrupted webpack dev cache unrelated to any application code (confirmed: `content/marketing/solutions.mdx` has no diff since 2026-09-05). A same-day fresh screenshot of the redirect's actual current destination render could not be captured as a result; the 2026-09-05 screenshot of `/solutions` remains the best available evidence, and is used above on the strength of that page's source being unchanged.

## /how-it-works

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/how-it-works__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/how-it-works__mobile-390.png`

1. **Match — largely honest by disclosure.** All-dark/navy theme, gradient headline "How Benavora **actually works**," 8 small UI mockups (one per step: Onboarding, Opportunity Research, Filtering & Scoring, Draft Generator & AutoApply Population, Proven Narrative Reuse, Ongoing Research, Email Parser, Email Mail-Merge). Content plausibly matches each step's copy, but **every mockup is explicitly labeled in-image "Illustrative example — not live customer data"** — disclosed placeholder UI, not a real product screenshot passed off as one. — *VERIFIED*
2. **Leakage — none visible.** Mockups use generic labels ("Sample Foundation," "Sample Nonprofit Partner") — no real/test org names. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — MISSING.** No gold-icon+wordmark logo appears anywhere on this page; the header shows only a plain box and a "← Back to home" text link. This is a real branding inconsistency versus every other audited page. — *VERIFIED*
5. **Generic vs distinctive — distinctive.** Full dark theme, gradient/multicolor headline, per-step color-coded numbered badges, glowing card borders — real visual identity, not a template pattern. — *VERIFIED*

## /pricing (refreshed 2026-09-06 — page source changed since the 2026-09-05 capture, re-verified)

- Desktop (2026-09-06 refresh): `AUDIT_SCREENSHOTS/mkt-refresh-2026-09-06/pricing__desktop-1440.png`
- Mobile (2026-09-06 refresh): `AUDIT_SCREENSHOTS/mkt-refresh-2026-09-06/pricing__mobile-390.png`
- (Prior-day originals, now superseded by the above: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/pricing__desktop-1440.png` / `pricing__mobile-390.png`)

`git diff --stat` showed `PricingPageClient.tsx` (+1019/-lines) and `page.tsx` changed since the 2026-09-05 capture; re-captured live against the running dev server (HTTP 200) rather than trusting the old screenshot. The three original tiers' dollar figures are unchanged (Starter $397/mo·$317 annual, Professional $897/mo·$717 annual, Enterprise $1,997/mo·$1,597 annual — same numbers the 2026-09-05 pass already recorded), but the page itself is substantially more built out:

1. **Match — N/A.** No embedded product screenshot. Now five tiers instead of four: Starter $397/mo, Professional $897/mo ("Most Popular"), Enterprise $1,997/mo, **Agency $3,497/mo** (5 client workspaces, +$497/mo per additional client), and a new **Agency Scale $5,997/mo** (up to 10 client workspaces) — both Agency tiers now carry real published dollar figures where the 2026-09-05 capture's Agency column did not. New sections not present in the prior capture: a 4-step "One lifecycle" band (Discover/Understand/Create/Execute), a "Built for people managing more than one mission" agency-specific block, an explicit "We won't publish a number we can't stand behind" honesty statement about not claiming a fixed autonomous-submission count, and a monthly-vs-annual comparison table covering all five tiers. — *VERIFIED*
2. **Leakage — none on this page.** The cross-page mismatch against `/terms` is **still present and re-verified directly from `/terms`'s own source** (`src/app/(marketing)/terms/page.tsx`, Section 3): `/terms` hardcodes Starter $249/mo, Professional $599/mo, Enterprise $1,999/mo, and still has no Agency line at all. Since `/pricing` has now been rebuilt around this richer 5-tier structure while `/terms` was not touched in this diff, the drift between the two pages is unchanged in kind and, if anything, more conspicuous now that `/pricing` is the more detailed, current-looking page of the two. — *VERIFIED (source-level, both pages)*
3. **Brain bug — N/A.**
4. **Logo — same faint/washed-out rendering, unchanged.** — *VERIFIED*
5. **Generic vs distinctive — still generic in overall shape** (hero → tier-card grid → lifecycle strip → comparison table → FAQ is still a recognizable SaaS-pricing template skeleton), but with real added depth beyond the 2026-09-05 capture: the explicit "we won't publish a number we can't stand behind" candor about autonomous-submission volume, and the five-tier agency-scale structure, read as more considered than a generic template's usual three-tier "Good/Better/Best" pattern. Net assessment unchanged from the original pass (generic), but for a more substantive reason now. — *VERIFIED*

## /privacy

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/privacy__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/privacy__mobile-390.png`

1. **Match — N/A.** Plain legal text (10 numbered sections), no imagery. — *VERIFIED*
2. **Leakage — none.** Only Benavora's own intentional support email appears. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same faint/washed-out rendering.** — *VERIFIED*
5. **Generic vs distinctive — generic**, as expected for a legal page. — *VERIFIED*

## /security

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/security__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/security__mobile-390.png`

1. **Match — N/A.** Plain long-form text (10 sections: encryption, tenant isolation, SOC 2, auth, GDPR, disclosure, etc.), no imagery. — *VERIFIED*
2. **Leakage — none**, only intentional Benavora contact emails. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same faint/washed-out rendering.** — *VERIFIED*
5. **Generic vs distinctive — mostly generic**, slightly relieved by six colored capability pill-badges (AES-256-GCM, TLS 1.3, RLS, SOC 2 Type II roadmap, GDPR-aligned, data never sold). — *VERIFIED*

## /terms

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/terms__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/terms__mobile-390.png`

1. **Match — N/A.** Plain legal text (11 sections). — *VERIFIED*
2. **Leakage — none** on org/email/badge grounds, but a real cross-page accuracy bug: Section 3 lists Starter $249/mo, Professional $599/mo, Enterprise $1,999/mo and omits the Agency tiers — stale relative to the live `/pricing` page's actual figures. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same faint/washed-out rendering.** — *VERIFIED*
5. **Generic vs distinctive — generic.** — *VERIFIED*

## /scan

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/scan__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/scan__mobile-390.png`

1. **Match — N/A.** Headline "Free Funding Potential Scan," single centered lead form (org name/website, EIN, state, mission, priority), no embedded screenshot. — *VERIFIED*
2. **Leakage — UNKNOWN, flagged not asserted.** The organization-name field's placeholder text reads "Faith Foundation or faithfoundation.org" — plausibly a generic example, plausibly a reuse of the real customer's identity seen elsewhere on the site; not confirmable from this page alone. No other leakage visible. — *UNKNOWN*
3. **Brain bug — N/A.**
4. **Logo — same faint/washed-out rendering.** — *VERIFIED*
5. **Generic vs distinctive — generic.** Near-identical layout to `/demo` (centered white form card, dark-green background, orange CTA). — *VERIFIED*

---

## /platform

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform__mobile-390.png`

1. **Match — N/A.** Platform index/overview; hero + three paragraphs explaining six connected systems + CTA band + footer link-farm. No embedded screenshot or interactive widget anywhere. Confirmed via `content/marketing/platform.mdx` (no image reference). — *VERIFIED*
2. **Leakage — none visible** (no app screenshot present). — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — low-contrast wordmark confirmed at the source-asset level:** the gold icon is correct, but the "benavora" wordmark pixels in `public/benavora_logo.png` itself are pale cream, confirmed by opening the asset directly — a real defect, not a capture artifact. — *VERIFIED*
5. **Generic vs distinctive — generic.** Centered hero + unbroken wall of body paragraphs, no imagery, cards, or diagrams differentiating the six sub-systems described. — *VERIFIED*

## /platform/autoapply

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_autoapply__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_autoapply__mobile-390.png`

1. **Match — genuine.** Headline "Qualify deeply. Apply selectively. Never lose momentum." Screenshot shows the AutoApply Engine: session stats, "Live Session Viewer" (no active session), a queue with items marked "skipped," and a Manual/Semi-Auto/Autonomous mode selector on Manual. Consistent with the claim. — *VERIFIED*
2. **Leakage — real customer org, not synthetic:** top-right shows "FAITH Foundation" (avatar "FF"), sidebar footer repeats "FAITH Foundation / Nonprofit funding automation." Distinct from the "Benavora E2E Test Org" pattern seen elsewhere — this is a real customer's name exposed on a public marketing page. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same shared header; low-contrast issue presumed present but not independently re-confirmable at this capture's downscale.** — *INFERRED*
5. **Generic vs distinctive — moderately distinctive**, carried by a real, detailed product screenshot (colored stat tiles, mock browser illustration, live queue) rather than only generic card grids. — *VERIFIED*

## /platform/discovery

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_discovery__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_discovery__mobile-390.png`

1. **Match — partial.** Headline "Stop finding out about a grant after it closed." Screenshot shows a static "Research Command Center" source-catalog grid (Grants.gov, SAM.gov, USASpending.gov, NIH RePORTER, etc. with "Visit" buttons) — proves the Research module exists but does not visually demonstrate the specific "closed before you found it" detection claim. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" concatenated with its avatar as "Benavora E2E Test OrgBE" near the bell icon, repeated in the sidebar footer. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same shared header; low-contrast issue presumed present.** — *INFERRED*
5. **Generic vs distinctive — moderately distinctive**, the real ~14-card data-source grid adds authentic texture beyond the repeating problem/capability/FAQ template. — *VERIFIED*

## /platform/draft-generator

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_draft-generator__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_draft-generator__mobile-390.png`

1. **Match — undercuts its own headline.** Headline "Stop starting every grant narrative from a blank page." Screenshot shows step 1 ("Select Opportunity") plus stats "0 Total Drafts / 0 AI Drafts Pending / 0 Drafts This Month / — Avg Confidence" and "No drafts generated yet." Shows the pre-drafting screen with zero drafts ever produced, not an actual generated narrative. — *VERIFIED*
2. **Leakage — confirmed, two instances:** "Benavora E2E Test Org" badge + sidebar, **and** the opportunity list itself contains "E2E Billing Gate Test Opp (178856565532981942)" listed as a real "Housing Grant" alongside genuine government grant names. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same shared header; low-contrast issue presumed present.** — *INFERRED*
5. **Generic vs distinctive — moderately distinctive** (real 4-step wizard screenshot) but undermined by the "0 drafts" empty state reading as an unused environment. — *VERIFIED*

## /platform/prospect-intelligence

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_prospect-intelligence__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_prospect-intelligence__mobile-390.png`

1. **Match — N/A, disclosed.** Headline "Know who to ask, before you ask them." Page explicitly states the feature "hides behind an org-level rollout flag that defaults to off" and "a screenshot won't tell you that plainly." Confirmed in source (`ProspectIntelligenceClient.tsx` has zero image references). — *VERIFIED*
2. **Leakage — none** (no screenshot exists). — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same shared header; low-contrast issue presumed present.** — *INFERRED*
5. **Generic vs distinctive — generic.** Same repeating stacked-text template as other text-only pages despite unusually candid copy about the feature being unlaunched. — *VERIFIED*

## /platform/ai-grant-writer

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_ai-grant-writer__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_ai-grant-writer__mobile-390.png`

1. **Match — N/A**, MDX content page (`content/marketing/platform/ai-grant-writer.mdx`, no image reference). Has an "INTERACTIVE / Draft Generator Theater — Runs on a recorded fixture" placeholder card that renders **completely blank/empty** in this static capture — flagged as a possible rendering gap for an interactive widget, though this may just be a static-screenshot limitation rather than a live bug. — *VERIFIED (box renders empty)* / *INFERRED (root cause)*
2. **Leakage — none visible.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — clearly confirmed at this page's lower downscale:** gold icon correct, "benavora" wordmark pale cream and washed-out against the white nav. — *VERIFIED*
5. **Generic vs distinctive — generic.** Same template as Analytics/Funding Intelligence; the one potentially-differentiating interactive element renders empty in capture. — *VERIFIED*

## /platform/analytics

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_analytics__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_analytics__mobile-390.png`

1. **Match — N/A**, MDX content page, no image/screenshot and no "interactive" placeholder either. Notably, for a page about analytics, there is **no chart, graph, or data visualization of any kind** — the "Sample output" section is prose describing what a report would show rather than showing one. — *VERIFIED*
2. **Leakage — none.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — clearly confirmed:** pale-cream wordmark, low contrast against white nav. — *VERIFIED*
5. **Generic vs distinctive — generic**, identical template skeleton to sibling platform pages; the complete absence of any chart on an analytics page is a notably weak, template-driven choice. — *VERIFIED*

## /platform/funding-intelligence

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_funding-intelligence__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_funding-intelligence__mobile-390.png`

1. **Match — N/A**, MDX content page. Has the same "INTERACTIVE / Opportunity Analysis — Runs on a recorded fixture" placeholder, which again renders as an empty white box. — *VERIFIED (box empty)* / *INFERRED (root cause)*
2. **Leakage — none.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — clearly confirmed:** pale-cream wordmark, washed-out. — *VERIFIED*
5. **Generic vs distinctive — generic**, same repeating template; the one potentially distinctive element (interactive demo) again renders empty. — *VERIFIED*

## /platform/opportunity-discovery

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_opportunity-discovery__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_opportunity-discovery__mobile-390.png`

1. **Match — N/A.** The "INTERACTIVE / Opportunity Analysis / Runs on a recorded fixture. No live account data, no submissions." card is a blank white placeholder in both desktop and mobile captures — no image content visible. Headline: "Opportunity Discovery — Federal, foundation, and corporate funding sources in one feed." — *VERIFIED*
2. **Leakage — none visible.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same gold icon + wordmark**; the logo sits inside a light rectangular chip that itself looks like it could be mistaken for an unloaded-image placeholder box. — *VERIFIED*
5. **Generic vs distinctive — generic.** Dark hero, 3-card "problem solved" grid, capability list, numbered "How the AI works" section — standard SaaS template; one relatively distinctive element is an unusually detailed prose "Sample output" section. — *VERIFIED*

## /platform/pipeline-crm

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_pipeline-crm__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/platform_pipeline-crm__mobile-390.png`

1. **Match — N/A.** Same pattern as opportunity-discovery — "INTERACTIVE / Pipeline Walk-through" card renders blank. Headline: "Pipeline and CRM — Every prospect, application, and deadline in one pipeline." — *VERIFIED*
2. **Leakage — none visible.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — same gold icon + wordmark**, matches site-wide standard. — *VERIFIED*
5. **Generic vs distinctive — generic.** Structurally identical template to opportunity-discovery; no unique layout element. — *VERIFIED*

## /tour

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/tour__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/tour__mobile-390.png`

1. **Match — confirmed for the captured step.** Headline "See discovery, drafting, and Auto Apply run end to end." Captured state shows "Step 1 of 3 · Discovery — Research Command Center," genuinely depicting a Research Command Center with a real-looking source-card grid — matches the copy. Steps 2 and 3 (draft-generator, autoapply) are not visible in this single static capture. — *VERIFIED (step 1)* / *UNKNOWN (steps 2–3)*
2. **Leakage — confirmed:** top nav shows "Benavora E2E Test Org" next to a "BE" avatar and bell icon; repeated in the sidebar under "Settings." — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — matches standard**, plus a second in-app instance of the same gold "b" logo visible inside the embedded screenshot's own sidebar. — *VERIFIED*
5. **Generic vs distinctive — distinctive.** Full-bleed dark scrollytelling/step-through experience with a large embedded screenshot, progress bar, and Back/Pause/Next controls — materially different, more interactive than the templated card-grid pages elsewhere. — *VERIFIED*

## /agents

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/agents__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/agents__mobile-390.png`

1. **Match — N/A.** Pure MDX/prose page describing each agent family (Opportunity Discovery, Funding Intelligence, AI Grant Writer, AutoApply, Pipeline, Analytics); no image or screenshot of any kind. — *VERIFIED*
2. **Leakage — none visible.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard**, consistent with other pages. — *VERIFIED*
5. **Generic vs distinctive — generic and plain.** A single column of body-text paragraphs with a dark hero band and no cards, images, or icons — reads as a raw content/legal-style page. — *VERIFIED*

## /company

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/company__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/company__mobile-390.png`

1. **Match — N/A.** Pure prose page, no embedded image/screenshot. — *VERIFIED*
2. **Leakage — none in UI chrome.** Body copy itself states "Benavora's founding organization, Faith Foundation, is the organization whose own grant work shaped the platform's first version" — real org named in intentional narrative text, not an accidental UI leak, noted separately from the 17-page leakage count. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard**, nav and footer. — *VERIFIED*
5. **Generic vs distinctive — generic.** Same single-column prose-on-dark-hero template as `/agents`, structurally indistinguishable. — *VERIFIED*

## /resources

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/resources__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/resources__mobile-390.png`

1. **Match — N/A for a static screenshot**, but the page embeds a live functional "Ask Benavora Assist" chat widget (input field + Send button) consistent with its own claim of "a chatbot that answers questions from the same library." — *VERIFIED*
2. **Leakage — none visible.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — mostly generic**, but the live chat widget is a genuine interactive element the pure-MDX pages lack. — *VERIFIED*

## /login

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/login__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/login__mobile-390.png`

1. **Match — N/A.** This is the real authentication form, not a marketing content page. Left panel: dark-green gradient with tagline "Fund More. Do More. Change More."; right panel: plain email/password sign-in form. — *VERIFIED*
2. **Leakage — none visible.** Placeholder "you@organization.org," masked password, no real data displayed. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard**, in the same light chip container used elsewhere. — *VERIFIED*
5. **Generic vs distinctive — distinctive** relative to the rest of the audit: a polished split-screen layout (dark brand panel with radial glow + large tagline, clean light form panel) rather than a generic centered-card login, though the dark-panel/light-form pattern itself is a common SaaS convention. — *VERIFIED*

## /solutions

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions__mobile-390.png`

1. **Match — N/A.** Pure prose page ("Solutions," "Every organization type is funded differently…"), no embedded image. — *VERIFIED*
2. **Leakage — none visible.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic, and specifically weak:** body text says "The six pages linked below describe the funding problems specific to each organization type" (Faith-Based, Human Services, Housing, Veterans, Education, Community Development), but **no cards, tiles, or inline links to those six pages are visually rendered anywhere in the screenshot** — a single unbroken column of paragraph text with no visual navigation aid to the sub-pages it explicitly references. Worth a follow-up check on whether the links render at all in production. — *VERIFIED*

---

## /solutions/ai-grant-writing-software

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_ai-grant-writing-software__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_ai-grant-writing-software__mobile-390.png`

1. **Match — soft mismatch.** Headline: "A draft grounded in your own record, not a generic template with your name swapped in." Screenshot (captioned "Not a mockup — the live Grant Draft Wizard... mid-workflow") shows the opportunity-picker step plus "0 Total Drafts / 0 AI Drafts Pending / 0 Drafts This Month" and "No drafts generated yet." The page's own CTA says "See a real draft generated," but the screenshot shows zero drafts ever generated — an empty state undercutting the specific claim, even though the labeled workflow step itself is accurately depicted. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" badge in the top nav. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic** (centered hero, numbered-step list, uniform limitation cards, FAQ, CTA band) despite the added credibility of a genuine embedded screenshot. — *VERIFIED*

## /solutions/autonomous-fundraising-platform

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_autonomous-fundraising-platform__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_autonomous-fundraising-platform__mobile-390.png`

1. **Match — HARD MISMATCH, confirmed.** Headline: "Autonomous means nine separate switches, not one." Section labeled "The actual command center," captioned "Not a mockup — the live Dashboard... captured from a running instance." The image actually shows the **Corporate Marketplace** screen (industry/ownership filters, a 6-card company grid, all "Not scored"/"Never verified") — no autonomy switches, toggles, or command-center controls of any kind are visible. The caption's own claim ("Dashboard"/"command center") does not match what is shown. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" badge. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic** (hero, 3-card "revenue lanes" grid, repeated capability list, 2-card limitations block, FAQ, CTA). — *VERIFIED*

## /solutions/corporate-donation-application-software

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_corporate-donation-application-software__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_corporate-donation-application-software__mobile-390.png`

1. **Match — soft mismatch, self-disclosed.** Headline: "A corporate ask, timed and sized like one." Caption openly admits: "This particular account has no corporate-source opportunities loaded yet, and we'd rather show that honest empty state than a staged one." Screenshot shows all-0 stat tiles and "No opportunities match your filters" — proves the filter UI exists but never demonstrates the claimed "timed and sized" scoring logic. Unusual honesty about the empty state, but the demo itself proves nothing about the specific feature. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" badge. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic.** — *VERIFIED*

## /solutions/corporate-giving-database

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_corporate-giving-database__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_corporate-giving-database__mobile-390.png`

1. **Match — reasonable topically, but weak evidence.** Headline: "A real, growing database of companies that actually give — not a purchased list," emphasizing "a propensity score where one has been computed." Same Corporate Marketplace screenshot as above (correctly captioned here as the marketplace/database view) — but every visible card says "Not scored," and the page's own "Still early" section admits a propensity score exists for only a minority of the database. The screenshot honestly reflects that immaturity, but is a weak demonstration of the headlined feature. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" badge. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic**, and reuses the identical screenshot/layout skeleton from another solutions page, reinforcing the template feel. — *VERIFIED*

## /solutions/donor-prospecting-intelligence

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_donor-prospecting-intelligence__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_donor-prospecting-intelligence__mobile-390.png`

1. **Match — N/A, honestly disclosed.** No live product screenshot at all. Page shows an "ANIMATED SEQUENCE — ONE PROSPECT'S DOSSIER, NOT A SCREEN RECORDING" and states outright that "the rollout flag that opens it defaults off per organization, and no organization has been through the rollout yet" — the feature is real code with no live customer to screenshot, and the page is transparent about substituting an animated illustration. — *VERIFIED*
2. **Leakage — none visible** (no app screenshot exists to leak from). — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — still template-shaped overall**, but the animated step-sequence in place of a static screenshot is a genuine, distinctive departure from the other solutions pages. — *VERIFIED*

## /solutions/funding-operations-software

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_funding-operations-software__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_funding-operations-software__mobile-390.png`

1. **Match — HARD MISMATCH, confirmed.** Headline: "Grantseeking has an operations problem, too" — body copy is about role-based access, audit trails, admin controls. Screenshot, captioned "The actual matching and scoring engine behind every approval," instead shows the unrelated "Semantic Funder Matches" screen with an empty "No strong matches found" state — no roles, permissions, or audit-log UI of any kind. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" badge. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic** (hero, screenshot, 4-card role grid, limitations, FAQ, CTA). — *VERIFIED*

## /solutions/funding-pipeline-software

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_funding-pipeline-software__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_funding-pipeline-software__mobile-390.png`

1. **Match — the closest topical match in this set, but thin/conspicuously seeded data.** Headline: "A pipeline that won't let a stage get skipped." Screenshot (captioned "each row showing the funder, the deadline, days spent in the current stage, and the latest success-probability score") genuinely shows those fields, but with a single row: "Rural Housing Stability Grant (E2E Seed)" / "Lone Star Community Foundation (E2E Seed)," $35,000, "17 days in stage." — *VERIFIED*
2. **Leakage — confirmed, and more conspicuous than a nav badge alone:** "Benavora E2E Test Org" badge PLUS the literal grant and funder names both carry visible "(E2E Seed)" suffixes. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic.** — *VERIFIED*

## /solutions/grant-application-automation

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_grant-application-automation__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_grant-application-automation__mobile-390.png`

1. **Match — reasonable, but weak/garbled data.** Headline: "Automated form-filling that stops the moment a human actually needs to look." Screenshot (captioned "showing real queued and processed submission items") shows the AutoApply Engine panel, mostly blank/zero stats, and a queue with entries oddly named "Meade Tractor" (×2) and "Walmart" (×2), all "stopped" — directly on-topic, but the queue-item names look like garbled/placeholder scrape data rather than real funder or portal names. — *VERIFIED*
2. **Leakage — real customer org, not synthetic:** badge reads **"FAITH Foundation"**, not "Benavora E2E Test Org" — a real, named nonprofit customer exposed on a public marketing page, arguably more serious than the synthetic test-org instances. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic.** — *VERIFIED*

## /solutions/grant-deadline-tracking

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_grant-deadline-tracking__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_grant-deadline-tracking__mobile-390.png`

1. **Match — soft mismatch.** Headline: "Stop finding out about a deadline the week it closes" — copy promises deadline extraction/prediction/tiered reminders. Screenshot ("The actual pipeline, deadlines and all") shows the Applications kanban board with one card ("Rural Housing Stability Grant (E2E Seed)," $35,000, "Jun 19, 2026") — a pipeline/kanban view, not the deadline-tier/urgency/prediction UI the copy specifically describes. Topically adjacent, not a direct depiction of the claimed capability. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" badge + sidebar, plus "Rural Housing Stability Grant (E2E Seed)" / "Lone Star Community Foundation (E2E Seed)." — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard** (gold icon + "BENAVORA" wordmark). — *VERIFIED*
5. **Generic vs distinctive — generic**, only the one screenshot provides any depth. — *VERIFIED*

## /solutions/grant-discovery-software

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_grant-discovery-software__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_grant-discovery-software__mobile-390.png`

1. **Match — genuine, reasonable.** Headline: "Stop finding out about a grant after it closed," claiming six source categories across eight parallel research lanes. Screenshot ("The actual Research feed") shows the Research Command Center's source-card grid (Grants.gov, SAM.gov, USASpending.gov, NIH RePORTER, HRSA, HUD, SAMHSA, DOJ OJP, IRS Tax Exempt Search, ProPublica, Candid/GuideStar, Foundation Directory Online, GrantWatch) — a genuine, reasonable match to the "multi-source research feed" claim. — *VERIFIED*
2. **Leakage — confirmed, plus a rendering glitch:** "Benavora E2E Test Org" badge, AND the embedded screenshot's own top nav renders as raw unstyled concatenated text — "DashboardResearchOpportunitiesAutoApplyDraft GeneratorDonor Discovery" — with no spacing or button styling, a CSS-not-applied rendering bug baked into the static asset itself. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic** overall; the one distinctive element (the real screenshot) is undercut by the visible broken-nav glitch within it. — *VERIFIED*

## /solutions/grant-matching-software

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_grant-matching-software__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_grant-matching-software__mobile-390.png`

1. **Match — functionally accurate, but contains a bad example.** Headline: "A ranked list of funders isn't the same as knowing which ones actually fit," claiming a live "Funder Matching" run scoring a real mission statement. Screenshot shows exactly that (a match-percentage list + an "AI Funder Match" panel with a housing/veterans-homelessness mission statement) — functionally matches the claim. **However, the second result is "SONS OF CONFEDERATE VETERANS INC"** — a Confederate-heritage organization surfaced as a funder match for a mission about veterans experiencing homelessness. Technically-accurate keyword match ("veterans"), but a tone-deaf, embarrassing example to show unedited on a public marketing page. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" badge. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic**, distinguished only by the embedded screenshot. — *VERIFIED*

## /solutions/human-in-the-loop-ai

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_human-in-the-loop-ai__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_human-in-the-loop-ai__mobile-390.png`

1. **Match — N/A.** Headline: "Where the automation actually stops, in the code, not in a claim." Entire page is text/card content — "Five places a person, not the model, decides," an autonomy-toggle config table, stated limitations, FAQ. No embedded product screenshot anywhere. — *VERIFIED*
2. **Leakage — none visible** (no screenshot present). — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic, the most template-like of this batch.** A config table (`auto_research_enabled = off by default`, etc.) adds specificity/credibility, but visually it's a plain stacked-section template with no imagery or screenshots at all. — *VERIFIED*

## /solutions/nonprofit-funding-software

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_nonprofit-funding-software__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_nonprofit-funding-software__mobile-390.png`

1. **Match — strong, direct match.** Headline: "Nonprofit funding software that covers the whole cycle, not just one step" — a six-stage pipeline dashboard on one screen. Screenshot shows exactly that: the dashboard's page title literally reads "Benavora E2E Test Org," a pipeline stage bar (Onboard 0/7, Research 133812, Opportunities 486, Narratives 1, AutoApply 0, Funding Secured 0), stat tiles, Action Queue, Top Opportunities (including "E2E Pipeline Test Grant (178336930…"), AI Triggers, Alerts. Strong match to the "whole cycle in one dashboard" claim. — *VERIFIED*
2. **Leakage — confirmed, prominently:** the dashboard's own page title inside the screenshot literally is "Benavora E2E Test Org," plus a pipeline record "E2E Pipeline Test Grant (178336930…)." — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic template overall**, but the full-dashboard screenshot (multiple stat tiles, three side-by-side panels, a stage bar) gives more genuine product depth than most other pages. — *VERIFIED*

## /solutions/nonprofit-outreach-automation

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_nonprofit-outreach-automation__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_nonprofit-outreach-automation__mobile-390.png`

1. **Match — soft mismatch.** Headline: "Draft the outreach. Send the channels a platform can actually send" — about drafting/sequencing outreach across email, LinkedIn, phone, and mail. Screenshot ("the actual donor and corporate-giving directory") shows the Donor Discovery dashboard with all-zero/dash stat tiles across the board — topically adjacent (donor/corporate outreach) but shows an empty prospecting dashboard, not an actual drafted multi-channel sequence as specifically described. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" badge + sidebar; all stats zero/empty, an obvious unpopulated demo state. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic**, screenshot adds some depth but undercuts credibility with an all-zero empty state. — *VERIFIED*

## /solutions/nonprofit-prospect-research

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_nonprofit-prospect-research__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_nonprofit-prospect-research__mobile-390.png`

1. **Match — soft mismatch.** Headline: "Tell it a cause and a place. It comes back with scored prospects, not a guess," promising a plain-English reason for every score. Screenshot (the identical Donor Discovery dashboard used on the outreach-automation page) shows zero prospects and "No score breakdown available yet" — a direct mismatch between the headline's promise (scored prospects with reasons) and the screenshot (zero prospects, no scores). The real seven-signal weighting shown further down the page is a separate static bar-chart graphic, not part of the product screenshot. — *VERIFIED*
2. **Leakage — confirmed:** "Benavora E2E Test Org" badge (same asset as outreach-automation). — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic**; the seven-signal weighted-bar chart is a nice bit of genuine informational design, but the reused empty-state screenshot undercuts the "scored prospects" story. — *VERIFIED*

## /solutions/community-development

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_community-development__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_community-development__mobile-390.png`

1. **Match — N/A.** Pure MDX content page — hero, three "funding problems" cards, five capability cards, prose, FAQ. No embedded screenshot anywhere. — *VERIFIED*
2. **Leakage — none visible** (no screenshot present). — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — the most generic/template-like page found in this batch** — centered hero, uniform card grids, plain text block, FAQ accordion, zero imagery/screenshots/charts of any kind. — *VERIFIED*

## /solutions/education

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_education__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_education__mobile-390.png`

1. **Match — N/A.** No embedded product screenshot, chart, or UI image anywhere; entire page is text (hero, 3 problem cards, 5 capability cards, prose, FAQ). — *VERIFIED*
2. **Leakage — none visible.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard**, with the same wordmark-softness noted site-wide (not page-specific). — *VERIFIED*
5. **Generic vs distinctive — generic.** Plain vertical stack of undecorated white-rectangle cards distinguished only by headline text; nothing about the layout is education-specific beyond the words. — *VERIFIED*

## /solutions/faith-based

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_faith-based__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_faith-based__mobile-390.png`

1. **Match — N/A.** No embedded image of any kind. — *VERIFIED*
2. **Leakage — none visible.** Generic concepts ("denominational funds," "community foundations") only. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard**, same treatment as `/solutions/education`. — *VERIFIED*
5. **Generic vs distinctive — generic, and structurally identical to `/solutions/education` down to the pixel** — same hero height/color, same 3-card grid, same 5-card (4+1) grid, same prose block, same 4-item FAQ, same CTA band. Only the headline/body text is swapped; no unique imagery, icons, or color accent exists for this vertical. — *VERIFIED*

## /solutions/housing

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_housing__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_housing__mobile-390.png`

1. **Match — N/A.** No embedded screenshot. — *VERIFIED*
2. **Leakage — none visible.** Real public program names (HUD, CDBG, HOME, TDHCA) appear as factual domain content, not test-org data. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic**, same exact template as education/faith-based; nothing visual changes between verticals, only the words. — *VERIFIED*

## /solutions/human-services

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_human-services__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_human-services__mobile-390.png`

1. **Match — N/A.** No embedded screenshot. — *VERIFIED*
2. **Leakage — none visible.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic**, again byte-for-byte the same template shell as the other verticals. — *VERIFIED*

## /solutions/veterans

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_veterans__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/solutions_veterans__mobile-390.png`

1. **Match — N/A.** No embedded screenshot. — *VERIFIED*
2. **Leakage — none visible.** References to VFW, American Legion, VA SSVF are real-world program names used as factual content, not test data. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic.** The fifth of five solutions verticals confirmed visually indistinguishable from the other four — no imagery, iconography, or color differentiation across any of the five. — *VERIFIED*

## /trust

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/trust__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/trust__mobile-390.png`

1. **Match — N/A.** No embedded screenshot, image, or diagram — dark hero + single long prose column (~6 paragraphs) + CTA band. — *VERIFIED*
2. **Leakage — none visible.** Abstract governance discussion (review holds, citations, CAPTCHA handling), no org name or email shown. — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic**, though structurally simpler than the solutions template (drops both card grids and the FAQ) — still a plain, undecorated single-column text page with no imagery, pull-quotes, or icons. Shares this exact shell with `/why-benavora` — only the words differ between the two. — *VERIFIED*

**Refresh note, 2026-09-06:** `content/marketing/trust.mdx` has an uncommitted diff since the 2026-09-05 capture — pure copy rewording, replacing "every submission carries an approver" language with "routine, low-risk submissions proceed automatically; anything unfamiliar or high-risk carries an approver," matching a platform-wide copy update (see `/platform/autoapply`'s and the homepage's own risk-tiered-AutoApply language). No layout, imagery, or structural change accompanies it, so the five-category findings above are unaffected by this diff — noted here for completeness, not because any finding changed.

## /why-benavora

- Desktop: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/why-benavora__desktop-1440.png`
- Mobile: `AUDIT_SCREENSHOTS/mkt-full-audit-2026-09-05/why-benavora__mobile-390.png`

1. **Match — N/A.** Same hero + single prose column + CTA structure as `/trust`, no embedded image. — *VERIFIED*
2. **Leakage — none visible.** — *VERIFIED*
3. **Brain bug — N/A.**
4. **Logo — standard.** — *VERIFIED*
5. **Generic vs distinctive — generic, visually identical in structure to `/trust`** — same hero sizing, same single-column prose with no visual breaks, same CTA band, same footer. Only the headline/paragraph text differs; the shell is pixel-for-pixel the same template. — *VERIFIED*

---

## Appendix: additional issues surfaced during this pass (outside the five requested categories, flagged for completeness per the "evidence before assertion" standard — not scored into the top-line counts above)

- **`/for-consultants` renders the generic `/solutions` hub with zero consultant-specific content** — **resolved as of the 2026-09-06 refresh pass: this is an intentional, documented permanent redirect** (`next.config.mjs`, comment `mkt-001`), not a routing/content gap. See the updated `/for-consultants` section above for the new finding this uncovered instead (a real pricing-accuracy fix landed in the now-permanently-unreachable `ForConsultantsClient.tsx`).
- **`/how-it-works` is missing the site logo entirely** in its header — the only page audited where the standard gold-icon-plus-wordmark does not appear at all.
- **`/terms` lists stale subscription pricing** ($249/$599/$1,999 per month, 3 tiers, no Agency tier) that contradicts the live `/pricing` page's actual current tiers and figures — **re-verified 2026-09-06, still present and unchanged; see the updated `/pricing` section above.** `/pricing` itself was substantially rebuilt (5 tiers, new lifecycle/agency/honesty sections) in the interim while `/terms` was not touched, so this drift is unchanged in kind but the two pages now look further apart in maturity.
- **`/solutions` references six sub-pages by name in body copy but does not visibly render any links/cards to them** in the captured screenshot.
- **`platform-discovery-research-live.png`'s embedded nav renders visibly broken/unstyled** (raw concatenated link text with no spacing) — a rendering bug baked into the static asset itself, visible on both pages that use it.
- **`/scan`'s lead-form placeholder text ("Faith Foundation or faithfoundation.org")** may or may not be an inadvertent reuse of a real customer's identity as example copy — flagged as UNKNOWN, not resolved, in this pass.
- **(New, 2026-09-06) The homepage's `WhatWillItCost` placeholder-pricing bug (three tiers named "Starter/Growth/Enterprise," none matching `/pricing`'s real names, all reading "Contact for pricing") has been fixed in source** — now pulls real tier names and dollar figures from the same `src/lib/utils/pricing-plans.ts` module `/pricing` uses. Classified INFERRED, not VERIFIED, this pass only because a live re-render could not be confirmed due to dev-server instability unrelated to this fix — see the Homepage section's refresh note above.
- **(New, 2026-09-06) The local dev server used for this and the prior day's capture pass was found mid-session with a corrupted webpack dev cache** (`Cannot find module './vendor-chunks/@opentelemetry+api@1.9.1.js'`, live HTTP 500 on the marketing catch-all route), plus one inconclusive homepage capture missing an entire section that source confirms is correctly wired. Both are believed to be dev-cache/environment artifacts, not application bugs — flagged here so a future pass doesn't mistake environment noise for a regression, and doesn't mistake this note for a claim that the underlying app code is broken.
