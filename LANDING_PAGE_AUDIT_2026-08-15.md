# Landing Page Audit — 2026-08-15

## Scope

Read in full, live from source (not summarized): every real marketing/landing page in the
repo. There is no separate `/features` or `/about` page — the full public marketing surface is:

| Route | File | Prod HTTP status (this session) |
|---|---|---|
| `/` (homepage) | `src/app/(marketing)/MarketingPageClient.tsx` (1,011 lines) | **200** |
| `/pricing` | `src/app/(marketing)/pricing/PricingPageClient.tsx` | **307 → /login** |
| `/for-consultants` | `src/app/(marketing)/for-consultants/ForConsultantsClient.tsx` | **307 → /login** |
| `/security` | `src/app/(marketing)/security/page.tsx` | **307 → /login** |
| `/privacy` | `src/app/(marketing)/privacy/page.tsx` | **307 → /login** |
| `/terms` | `src/app/(marketing)/terms/page.tsx` | **307 → /login** |

`sitemap.ts` only lists `/`, `/for-consultants`, `/privacy`, `/terms`, `/security` — it explicitly
omits `/pricing`, with a comment claiming pricing is "a section of the homepage," which is stale:
`/pricing` is a real, separate, differently-built page (see Finding 1 below).

---

## Finding 0 (most important, not something the task asked me to look for, but it undercuts
everything else): the entire secondary marketing surface is unreachable in production

`src/middleware.ts`'s `PUBLIC_PATHS` is:
```
["/", "/login", "/register", "/forgot-password", "/reset-password"]
```
`/pricing`, `/for-consultants`, `/security`, `/privacy`, and `/terms` are **not** in that list, so
the auth middleware treats them as protected routes and 307-redirects any anonymous visitor to
`/login` before the page ever renders. Confirmed live against `www.benavora.com` this session, all
five routes.

Compounding this: the homepage's own nav and footer don't link to any of them anyway — the nav's
"Product" and "For Consultants" links both point to `href="#"` (dead anchors, only "Pricing" goes
anywhere, to the in-page `#pricing` anchor), and the footer's "Privacy" / "Terms" / "Security" /
"Contact" links are **all** `href="#"` too, not `/privacy` etc. So even a visitor who typed
`/pricing` directly, or found it via the (currently-missing-from-)sitemap, hits a login wall.

**Net effect:** the only marketing content any real anonymous visitor can ever actually see today
is what's on the single-page homepage. Everything below about "what's already on `/pricing`" or
"`/for-consultants`" describes real, well-built code that is currently invisible to prospects.
Fixing `PUBLIC_PATHS` (5 strings) and the dead nav/footer links is a trivial, high-leverage fix and
should happen before any of the copy/structure work below.

---

## Item 2: does displayed pricing match Starter $317 / Professional $717 / Enterprise $1,997?

**Homepage (`/`, the only page real visitors can reach): yes, exactly**, on first load. The billing
toggle defaults to `annual: true` (`MarketingPageClient.tsx:222`), and the `TIERS` array's `annual`
values are `317 / 717 / 1997` — matching Reid's screenshot precisely. The monthly (non-default)
prices are `397 / 897 / 2497`.

**`/pricing` (unreachable in prod, but reviewed as code): does not match — a real, separate bug.**
It pulls from a different, drifted data source, `src/lib/utils/pricing-plans.ts`:
```
starter:      { monthly: 397,  annual: 317 }   // matches homepage
professional: { monthly: 897,  annual: 717 }   // matches homepage
enterprise:   { monthly: 1997, annual: 1597 }  // does NOT match homepage (2497 / 1997)
```
Enterprise is wrong in both directions on `/pricing`: its "monthly" figure (1997) equals the
homepage's *annual* figure, and its "annual" figure (1597) matches neither of the homepage's two
numbers. The file's own top comment even flags the risk: *"Keep in sync manually — see
PricingPageClient.tsx and RegisterPageClient.tsx."* It wasn't. If `/pricing` becomes reachable
(Finding 0) without fixing this, a prospect who toggles to annual billing would see Enterprise at
$1,597/mo — $400/mo below what the homepage and Reid's own screenshot show, and below what
`/register?plan=enterprise` and Stripe checkout presumably actually charge. This is a real quoted-price
bug, not a cosmetic one.

**Recommendation:** make `MarketingPageClient.tsx`'s `TIERS` pricing derive from
`pricing-plans.ts` (or vice versa) so there is one source of truth. Fix Enterprise to `1997 / 2497`
(or whichever is the actual Stripe-side truth — check `src/lib/stripe` price IDs) before `/pricing`
ships live.

---

## Item 3: does the page already make a comparative/premium-pricing case?

**Yes — partially, and only on the homepage.** Two real pieces of comparative/ROI framing already
exist; this confirms Reid's instinct that "much of this already exists" is correct, not a
starting-from-zero situation:

1. **"The Math" section** (`MarketingPageClient.tsx:578-686`) — an explicit Without-Benavora
   ($79,360/yr: FTE grant writer salary + benefits + 480 hrs research, 12-18 apps/yr, ~14% win
   rate, 2-3 awards) vs. With-Benavora-Professional ($10,764/yr: 40 hrs, 60-120+ apps/yr, 400+
   AutoApply submissions/night capable, 8-15 awards) comparison, closing on "$68,596 in annual
   savings. One foundation grant covers 5+ years of the platform." This is a strong, concrete ROI
   argument and it's genuinely already built — not something this audit needs to invent.

2. **"How we compare" strip** directly under the pricing cards (`:817-836`) — a real, named
   competitor comparison:
   ```
   Instrumentl Full Lifecycle   $999/mo   discovery + tracking only, bolt-on AI editing
   SmartSimple                  $500+/mo  no AI, complex implementation, high consulting cost
   Benavora Enterprise          $2,497/mo AutoApply + AI factory + 1.97M database + digital twin
   ```
   So an explicit named-competitor comparison table already exists too — this is not merely
   implicit differentiation via a feature list.

**But it has real problems, both requested-to-check and found independently:**

- **It doesn't match the market comparables Reid gave.** Reid's real current figures are Instrumentl
  **$179–$549/mo** and Foundant GrantHub **$95–$249/mo**. The page instead cites "Instrumentl Full
  Lifecycle $999/mo" — a materially higher number, for what may be a discontinued/renamed
  higher-end SKU — and never mentions Foundant GrantHub at all. Foundant is arguably the *closer*
  comparable (a nonprofit-grant-seeker tool, not a funder-side case-management platform like
  SmartSimple) and it's the cheapest of the three named-in-brief competitors — its absence looks
  like cherry-picking if a prospect finds it on their own, and undermines the credibility of the
  comparison that *is* shown. If a prospect fact-checks "$999/mo" against Instrumentl's real public
  pricing and finds it's actually $549 at the top end, the whole comparison loses trust — worse for
  a premium-pricing pitch than not comparing at all.
- **Only the Enterprise tier is compared.** Starter ($317-397/mo) and Professional ($717-897/mo) —
  the two tiers actually priced in Instrumentl's and Foundant's real ranges — get no comparison at
  all. The one tier that *is* shown against competitors ($2,497/mo Enterprise) is priced far above
  both named real comparables' entire range, which reads as "we don't really compete at your price
  point" rather than making a premium-value case at the tiers that do overlap.
  - The "$2,497/mo" figure used in the comparison strip is also the **monthly** price, not the
    **annual** price shown three lines above it in the pricing card the visitor just looked at
    (which reads $1,997/mo by default, since annual billing is the default toggle state). Same
    section of the same page shows two different numbers for the same tier.
- **The comparison is a single small text strip, not a structured table.** Three competitors, one
  line each, small type, below the fold of the pricing section — easy to miss, not designed as a
  primary conversion element the way "The Math" section is (which gets its own full-width section
  with large numbers).
- **Feature lists (Six AI Systems, tier feature checklists) are all implicit, never comparative.**
  "AutoApply," "Digital Twin," "Fundability Intelligence," "Strategic Advisor" are described in
  isolation — real, specific, non-generic descriptions (this is not a vague feature-list problem) —
  but nothing ever says "Instrumentl doesn't have browser-automation submission" or "Foundant has no
  AI drafting." The comparison strip names competitors on *price*; it never says what they *lack* on
  *capability*, which is the more persuasive premium-pricing argument for a nonprofit buyer trying to
  justify paying more.
- **`/pricing` (the standalone page) has zero competitive content of any kind** — no comparison
  strip, no ROI section, nothing from "The Math." Even setting aside Finding 0's reachability bug, if
  it becomes the canonical linked-to pricing page (which its own metadata/SEO description suggests
  it's meant to be), a visitor arriving there sees plain feature-checklist cards with no comparative
  or ROI framing at all — strictly weaker than what already exists on the homepage.

---

## Secondary accuracy findings (adjacent to the task, found while reading in full)

- **SOC 2 claim inconsistency.** The homepage's hero trust badges say flatly **"SOC 2 compliant"**
  (`MarketingPageClient.tsx:362`). `/security` (once reachable) says the opposite in its own words:
  *"SOC 2 Type II Roadmap"* / *"pursuing SOC 2 Type II certification... target: 2027."* For a buyer
  persona (nonprofit ED/board) that may specifically ask about compliance certifications as part of
  justifying premium pricing, an overclaimed badge that a linked page then contradicts is a
  credibility risk in the same family as the Instrumentl price issue above — both are "a stat the
  page asserts confidently that doesn't survive the prospect clicking one link further."
- **"113 real awarded grant narratives" (FAQ + homepage stat card) understates the real number.**
  Live `intelligence_funded_proposals` count via direct DB query this session: **3,489** rows, not
  113. This is a stale, out-of-date figure understating the product, not a false/inflated claim — a
  missed-opportunity finding, not a trust risk, but worth refreshing given how central "grounded in
  real awarded language" is to the AI-drafting differentiation story.
- **"30 autonomous AI agents working day and night"** (homepage stat card) — per this project's own
  most recent agent tally (`AGENT_VERIFICATION_LOG.md`, 2026-08-07), of ~42 real agents, 26 are
  confirmed working, 2 unwired, 3 blocked, 1 not-built; "30" appears to be the *designed* count from
  `FEATURE_REGISTRY_v2.md`'s infrastructure summary, not a "confirmed working" count. Not urgent to
  fix, but if this copy is ever revisited for accuracy, "30 designed" and "26 confirmed running" are
  different claims.
- **`for-consultants` page uses Tailwind utility classes** (`text-white`, `bg-primary`, etc.), not
  the inline-`style={{}}` hex-value convention Directive 4 mandates for the rest of the site, and its
  content renders inside the shared marketing layout's `bg-white text-slate-800` chrome — worth a
  visual check once Finding 0 is fixed, since white-styled text on a white outer background is a
  plausible invisible-text bug depending on how `bg-primary`/`text-accent` resolve in the Tailwind
  config, not confirmed live this session because the route itself is unreachable.

---

## What's genuinely already there (don't rebuild)

- Full six-system feature deep-dive with specific, non-generic descriptions (not just names) of AI
  Discovery, Draft Generation, AutoApply, Fundability Intelligence, Digital Twin, Strategic Advisor.
- A real, complete 3-tier pricing table with annual/monthly toggle, feature checklists per tier, and
  correct copy differentiation between tiers.
- A working "How it Works" 3-step section and an "Illustrative Outcomes" stats section (3x
  opportunities found, 40→4 hrs per application, +28 pts fundability) with an honest
  "illustrative projections, not guaranteed" disclaimer already in place.
- A real, named-competitor pricing comparison strip and a real, fully-worked ROI cost comparison
  ("The Math") — i.e., the *category* of content Reid asked about (explicit premium-pricing
  justification vs. comparables) is not missing. It exists, is reasonably well-written, and just
  needs to be fixed (competitor figures), expanded (name Foundant, cover all 3 tiers, add
  capability-gap framing not just price framing), made visually more prominent, and — most
  importantly — made reachable outside the homepage.

---

## Concrete recommendations (audit only — not implemented here)

1. **Fix reachability first (Finding 0).** Add `/pricing`, `/for-consultants`, `/security`,
   `/privacy`, `/terms` to `middleware.ts`'s `PUBLIC_PATHS`. Fix the homepage nav's "Product"/"For
   Consultants" `href="#"` dead links and the footer's four `href="#"` dead links to point to their
   real routes. Add `/pricing` to `sitemap.ts` and fix its stale comment. Nothing else in this
   report matters to a real prospect until this ships.
2. **Unify the two pricing data sources** (`MarketingPageClient.tsx`'s `TIERS` and
   `pricing-plans.ts`) into one, and correct Enterprise's numbers to match whichever is actually
   correct against Stripe.
3. **Rebuild the competitor comparison as a real table**, not a one-line strip, using Reid's real
   current figures (Instrumentl $179–$549/mo, Foundant GrantHub $95–$249/mo) and add Foundant
   explicitly. Compare Starter/Professional against Instrumentl's and Foundant's actual overlapping
   tiers, not just Enterprise against numbers outside their range. Structure it as rows = capability
   (AI drafting, AutoApply browser automation, autonomous overnight agents, digital twin,
   1.97M-record proprietary database, funder relationship intelligence) × columns = Benavora /
   Instrumentl / Foundant GrantHub, with explicit "not offered" marks for competitors on rows they
   genuinely lack — this converts today's implicit-only feature list into the explicit comparative
   case the task asked about. Cite each competitor claim with a real source/date so it survives a
   prospect's own fact-check.
4. **Add capability-gap sentences, not just price-gap sentences**, to the comparison — e.g. "Neither
   Instrumentl nor Foundant submits applications for you; Benavora's AutoApply fills and files
   corporate giving-portal forms autonomously" — tying each named differentiator explicitly back to
   what the named competitors don't do, since that is the stronger premium-pricing argument for this
   buyer than price-only framing.
5. **Promote "The Math" ROI framing onto `/pricing` too** (once reachable) — it currently only lives
   on the homepage; the standalone pricing page a prospect is most likely to be sent a direct link to
   has none of it.
6. **Fix the SOC 2 badge wording** to match `/security`'s own honest "roadmap / target 2027"
   language, or drop the unqualified badge — don't let two linked pages disagree on a compliance claim.
7. Lower-priority: refresh the "113 grant narratives" copy to the real, larger current count; clarify
   "30 agents" as designed vs. confirmed-working if that copy is revisited; check `for-consultants`'
   Tailwind-class styling renders correctly once reachable.
