# Homepage "See More" Deep-Dive Page — Plan (2026-08-15)

## What this document is

A content + animation plan for a new "See More" button under the homepage's "Six AI systems
working in parallel" section, linking to a new deep-dive page that visually walks through the
real, live Benavora pipeline end to end. Every claim below was checked against
`FEATURE_REGISTRY_v2.md` and the actual source this session (see citations per stage). Nothing
here is aspirational — where the real system is manual-trigger-only, partially wired, or has a
known gap, that is stated in the copy, not smoothed over.

**This is a plan for the next prompt to build from — it is not itself the page.** The next prompt
must write real copy and real animation code against this plan, not invent new claims.

---

## Hard requirement for the next prompt (non-negotiable)

**Every animation on this page must use clearly-synthetic, labeled sample data — never real
customer, funder, or donor data.** No real org names, no real EINs, no real dollar amounts pulled
from `foundation_directory`/`corporate_prospects`/`opportunities`, no real contact emails. Use
obviously placeholder values (e.g. "Sample Foundation," "$50,000 (illustrative)," "Jane Doe,
Program Officer") and/or a visible "Illustrative data" caption on every animated panel. This is a
hard requirement, not a style suggestion — this repo has a standing pattern of confusing
illustrative/mock content with real state (see `benavora-ui-claims-need-visual-proof` project
memory), and Faith Foundation is a real live customer whose data must never appear in marketing
material without consent.

---

## Stage-by-stage narrative (corrected against real code/registry)

### Stage 1 — Onboarding & Digital Twin

**Real status:** BUILT — VERIFIED (registry rows #1, #49, #107, #108, #111).

- Real 7-step onboarding wizard (row #49), not 11 as some older docs/copy have said — confirmed
  correct in registry's Dashboard v4 note.
- On completion, `POST /api/onboarding/complete-setup` builds a real Organizational Digital Twin
  (`buildDigitalTwin()`, `src/lib/intelligence/digital-twin-builder.ts`) — mission statement,
  board members, focus areas, service area — persisted to `organizational_digital_twins`, with a
  live `twin_completeness_score` (real Faith Foundation org scores 70/100, row #111).
- The twin also rebuilds on every Knowledge Base save (`src/app/api/knowledge-base/route.ts`), so
  it's a living profile, not a one-time onboarding artifact.

**Copy angle:** "You tell us who you are once. We build a living profile of your organization
that every other system below reads from."

**Animation:** A simulated 7-step wizard stepper animating left-to-right (Org Info → Mission →
Programs → Board → Service Area → Documents → Review), with a completeness ring/gauge filling from
0% to a sample value (e.g. 72%) as steps complete. End state: a card labeled "Digital Twin Built"
with 3-4 illustrative fields (sample mission sentence, sample board member count, sample service
area) — clearly marked "Illustrative data."

---

### Stage 2 — Opportunity Research & Discovery

**Real status:** BUILT — VERIFIED (registry row #83 / AG-17, fully unblocked as of 2026-08-07).

- Real sources, all live: Grants.gov (daily poll, row #53), SAM.gov (weekly poll, row #54),
  ProPublica 990 mining (row #55, built but never run at scale — do not claim "constantly mining
  IRS filings," it's a batch script that exists but isn't scheduled), State Portal Framework
  (row #56, PARTIAL — one real working source, California Grants Portal RSS, plus older
  partially-broken scrapers; don't claim full state coverage).
- `OpportunityDiscoveryAgent` (`src/lib/agents/opportunity-discovery-agent.ts`, AG-17) is a real
  perceive/decide/execute/observe loop with five strategy branches — live-verified discovering 30
  new opportunities and chaining 20 into scoring in one real run.
- Discovery reads org preferences (row #86): source toggles, focus areas, min/max amount,
  excluded funders — real, not decorative.

**Copy angle, precisely scoped:** "Every day, AG-17 checks federal and state funding sources
against your organization's real focus areas — filtering out what doesn't fit before a human ever
sees it." Do NOT claim continuous real-time scraping of "thousands of sources" — the honest claim
is: 2 always-on federal sources (daily/weekly), a growing set of state sources, and 990 mining
that exists but isn't yet run at scale.

**Animation:** A simulated multi-source "radar" — 3-4 labeled source icons (Grants.gov, SAM.gov,
State Portals, 990 Filings) each pulsing on its real cadence label ("Daily," "Weekly," "Weekly"),
feeding into a central funnel. An animated counter ticks up ("+30 opportunities found") using a
sample number, then narrows as a filter animation removes non-matching cards, leaving a small
set that flow into Stage 3.

---

### Stage 3 — Filtering & Scoring

**Real status:** BUILT — VERIFIED (registry rows #102-106).

- Eligibility scoring (row #27, existing Tier 2 feature) runs first.
- `computeGrantProbability()` (`src/lib/intelligence/grant-probability-engine.ts`, row #102) is a
  **deterministic** (not LLM-guessed) engine — hand-verified factor-by-factor against real data,
  matched exactly, twice. This is a genuinely strong, differentiated claim — it's worth stating
  plainly that the score is computed, not a black-box AI guess.
- Factor Breakdown UI (row #106) shows the real weighted factors (4 factors) plus key
  risks/strengths, confirmed byte-for-byte matching the stored score this session.
- Chain: per Behavioral Contracts §34, AG-17 (discovery) → AG-15 (probability scoring) is a real,
  live autonomous chain triggered automatically, not manual.

**Copy angle:** "Every opportunity gets a transparent, deterministic score — not a vague AI
opinion. You can see exactly which factors drove the number."

**Animation:** A card for a sample opportunity animating through a 4-factor breakdown (e.g.
"Mission Alignment," "Funding History," "Deadline Proximity," "Amount Fit"), each factor's bar
filling in sequence with a small illustrative weight/contribution number, converging into a single
score badge (e.g. "87 — Strong Fit") that color-shifts green as it lands.

---

### Stage 4 — Draft Generator & AutoApply Population

**Real status:** BUILT, but the real trigger flow is more nuanced than a single pipeline — get
this precise, since it's the stage most likely to be overstated.

**Verified real flow (source: `probability-scoring-agent.ts:958-968`,
`draft-generation-agent.ts:789-838`, `draft-queue-engine.ts`, `submission_queue` insert sites):**

- **Discovery → Scoring → Draft is a real, autonomous chain.** When `ProbabilityScoringAgent`
  scores an opportunity ≥ 80 (and the org's `auto_draft_enabled`/`auto_draft_threshold` config
  allows it), it automatically queues `DraftGenerationAgent` (AG-05). AG-05 writes a real draft,
  but **every autonomous draft is hard-forced to `pending_review: true`** — it is never submitted,
  always waits for a human to approve it (Behavioral Contracts §34's Human Review Gate).
- **Reaching AutoApply's submission queue is a separate, mostly human-gated step**, not an
  automatic consequence of drafting. The main paths: a user manually clicking "Submit"/"Add to
  Queue" in the AutoApply UI; an org-level `auto_submit_above_confidence` config combined with a
  human "approve" action; or a nightly `auto-queue-populator.ts` sweep (funder-centric, opt-in per
  org via `auto_queue_config.enabled`). Corporate/donor-discovery prospects have their own,
  separate manual "Route to AutoApply" button (row #93) — a different path from grant
  opportunities.

**Copy angle — accurate, not oversold:** "Once a fit is confirmed, our AI drafts a real,
narrative-complete application for you — but it never submits anything on its own. A human always
reviews and approves before a draft moves toward submission." This is honest and still a strong
selling point (it directly reflects the Behavioral Contracts' hard human-approval limit) — don't
try to claim a fully automatic discovery-to-submission pipeline, because that isn't what's built.

**Animation:** A simulated document assembling itself section-by-section (Executive Summary →
Need Statement → Budget Narrative → Logic Model), each section's text lines animating in as
placeholder gray bars/lorem-style text (never real narrative copy). End on a clearly-labeled
"Pending Human Review" badge/checkpoint icon before a second, distinct panel shows a person icon
clicking "Approve" — visually reinforcing that a human, not the AI, authorizes what happens next.

---

### Stage 5 — Proven Narrative Reuse

**Real status:** BUILT (registry rows #9, #14, source: `recursive-learning.ts`,
`draft-generation-agent.ts:1479-1625`).

- When an application is marked `awarded` or `partial`, `RecursiveLearningAgent` (manual/event
  trigger, fired when an outcome is recorded — not on a nightly schedule) extracts winning
  narrative sections via Claude, upserts them into `proven_narratives` with a real
  `effectiveness_score` (wins ÷ (wins + denials) per funder category), and bumps
  `knowledge_base.proven_count` — flipping `is_proven = true` once a threshold is crossed.
- The Draft Generator actively pulls this back in on every new draft: it queries
  `knowledge_base` ordered by `is_proven DESC` and `proven_narratives` filtered to the new
  opportunity's funder category (top 5 by effectiveness), and injects both into the generation
  prompt as a labeled "PROVEN NARRATIVES" block.

**Copy angle:** "Every win teaches the system. Language that's actually earned a grant before gets
surfaced first for your next application in the same funder category." This is real and provable
end-to-end (write path and read path both confirmed in code) — a strong, accurate claim.

**Animation:** A simulated feedback loop diagram: an "Awarded" trophy/checkmark icon on a sample
past application animates a highlighted paragraph flying from that card into a "Knowledge Base"
icon, which lights up a "Proven ✓" badge. Then, on a new sample draft card, that same
proven-badge paragraph animates back in, visually closing the loop.

---

### Stage 6 — Ongoing / Continuous Research

**Real status:** Real, but scope must be precise — do not claim constant real-time monitoring
across the board.

- Genuinely scheduled/autonomous: Grants.gov (daily), SAM.gov (weekly), State Portals (weekly per
  source where wired), the nightly autonomous orchestrator's discovery→scoring→draft chain, and
  AG-43 Funder Signal Monitoring (row #99, news + 990 data on existing funders, LinkedIn
  explicitly excluded for ToS reasons).
- NOT continuous / batch-only: ProPublica 990 mining at scale (script exists, never run as a
  schedule), NIH/NSF/Federal Register/SAMHSA ingestion (rows #166-169, real ingestion scripts, run
  manually/periodically, not on an autonomous cron).

**Copy angle:** "The system doesn't stop after the first search. Every day, it re-checks federal
and state sources for new opportunities, and separately watches your existing funders for
leadership changes, new funding priorities, and public recognition — so you hear about a shift
before you'd have found it yourself." Avoid "monitors everything in real time" — the honest claim
is a mix of daily/weekly scheduled sweeps, not continuous streaming.

**Animation:** A simple recurring-clock/calendar motif — a small looped animation showing a clock
hand sweeping past labeled ticks ("Day 1," "Day 2," "Day 3…") with a new sample opportunity card
or a funder-signal alert card popping in at intervals, reinforcing "this keeps running," without
implying instant/real-time.

---

### Stage 7 — Email Parser: Classification, Not Auto-Reply

**Real status:** BUILT — PARTIAL, and this is the stage most important to get exactly right per
the task brief. Source: `EMAIL_PARSER_VERIFICATION_2026-08-13.md`, registry row #38.

**What is real and live-verified (2026-08-13, real org, real Claude call, real DB rows):**
- `EmailParserAgent.run()` correctly classifies inbound funder emails (award notification,
  information request, etc.), extracts 5 structured fields (funder name, opportunity reference,
  action required, urgency, sentiment), and correctly fuzzy-matches the funder even with
  non-identical name strings.
- A separate summarizer (different tables, different model) can summarize a synced email thread.

**What is confirmed ABSENT — do not describe otherwise:**
- No Gmail webhook/pub-sub listener exists anywhere in the repo. Classification only runs when a
  user manually pastes email content into the dashboard's Email Parser widget — it does not fire
  automatically when an email arrives.
- No auto-reply or auto-send capability exists at all. The system never drafts or sends a
  response to an inbound email on its own.

**Copy angle — must be explicit about the boundary:** "When a funder emails you — an award
notice, a request for more information — you can hand it to the system and get an instant,
structured read: what kind of email it is, what's being asked, how urgent it is, and which funder
record it belongs to. **The system flags it and tells you what to do next — it does not write or
send replies on your behalf.** That decision, like every outbound communication, stays with a
human." This is a deliberate, honest scope statement, not a hedge — do not let page copy imply
"the AI answers your funder emails."

**Animation:** A simulated inbox with one sample email arriving, then a visible manual action
(a cursor/click on "Analyze" or drag-into-widget) — never an automatic pop, to avoid implying
autopilot — followed by a structured-output panel animating in with labeled tags (Classification:
"Award Notification," Urgency: "High," Suggested Next Step: "Update funder record"). End with a
clearly human-icon "Your move" prompt — no send/reply button rendered in the animation at all.

---

### Stage 8 — Email Mail-Merge Campaigns

**Real status:** BUILT, real send capability, real multi-recipient-type support — but the
automatic scheduling half is currently unregistered. Source:
`src/lib/email/sequence-engine.ts`, `vercel.json`, `src/app/(dashboard)/email/campaigns/page.tsx`,
`OUTREACH_CONSOLIDATION_AUDIT.md`.

- Live engine: `email_campaign_sequences` / `email_sequence_steps` / `email_sequence_enrollments`
  — this is the real, consolidated system as of 2026-08-13 (Cold Outreach Sequences, row #36, is
  deprecated and redirects here).
- **Real multi-recipient-type support, confirmed in code**, not scoped to one entity type:
  enrollments can come from `outreach_contacts` (a generic CRM table with a free-text
  `company_type` — foundations, other nonprofits, local businesses all fit here), from `funders`
  directly, from a pasted free-text email list in the campaign wizard, or from
  donor-discovery/corporate prospect routing. This genuinely matches the "foundations / other
  nonprofits / local businesses" framing Reid described.
- Sending itself is real — a genuine Resend API call, not a stub.
- **Real gap to state honestly:** the cron route that would fire scheduled sends automatically
  (`/api/cron/email-sequences`) is not currently registered in `vercel.json`. So today, sends
  happen when that route is invoked (manually, or once re-registered) — not on a fully hands-off
  automatic schedule. Do not claim "runs automatically every day" for this stage specifically.

**Copy angle:** "One system to reach out — foundations, peer nonprofits, or local businesses —
with a personalized, multi-step email sequence, sent for real through your own send
infrastructure. Today, campaigns go out when you trigger a send; full autonomous scheduling is the
next step." This keeps the real strength (genuinely flexible recipient sourcing, real sending) and
is honest about the one open gap.

**Animation:** A simulated mail-merge: a small set of sample recipient "cards" (3 labeled
placeholder types: "Sample Foundation," "Sample Nonprofit Partner," "Sample Local Business") each
receiving a personalized-looking (placeholder-text) email preview animating in with a distinct
first line per card, then a "Sent via Resend" status chip appearing per card in sequence (not
simultaneous, to reflect real per-recipient sends, not a single broadcast blast).

---

## Page-level structure recommendation

1. Hero: "How Benavora Actually Works" + one-line honest summary (discovery → scoring → drafting
   with human approval → learning → outreach).
2. 8 stage sections in the order above, each with: a 1-2 sentence header claim, the animation
   described, and a small "What's real today" expandable detail (optional, for credibility with
   technical readers/investors) — do not require it, but it's a good place to be transparent about
   the Stage 4/6/7/8 nuances without cluttering the primary copy.
3. Closing CTA back to signup/demo.

## What NOT to do (explicit guardrails for the next prompt)

- Do not imply the AI submits applications or sends emails without human approval anywhere on this
  page — that would misstate Behavioral Contracts §34's hard limits.
- Do not imply the Email Parser replies to or drafts responses to inbound emails.
- Do not imply 24/7 real-time monitoring of "every funding source" — the real cadence is
  daily/weekly scheduled sweeps.
- Do not pull any real row from `opportunities`, `foundation_directory`, `corporate_prospects`,
  `funders`, or `outreach_contacts` for animation content. Sample data only, visibly labeled.
- Do not claim automatic scheduled mail-merge sends until `/api/cron/email-sequences` is actually
  registered in `vercel.json` — if that gets fixed before this page ships, re-verify and update
  Stage 8's copy accordingly.
