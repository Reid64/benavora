# AR-17.4 — Drafting & Generation family: cross-org similarity, specificity and fabrication assessment

**Date:** 2026-09-19
**Scope:** every agent that generates prose or a document for a customer —
LOI/narrative/budget-narrative/impact-statement/full-proposal drafting
(`src/lib/drafts/generator.ts`), the twin-powered autonomous draft path
(`src/lib/agents/draft-generation-agent.ts`, ag-05-draft), the legacy
budget-builder note path (`src/lib/agents/budget-agent.ts` /
`budget-builder.ts`), executive-summary generation, funder/donor outreach
copy (`follow-up-generator.ts`, `cold-outreach.ts`), B2B sales-outreach
(`sales-campaign-engine.ts`), the AutoApply personalized pitch
(`pitch-personalizer.ts`), and AutoApply's form-answer generation
(`form-filler-agent.ts`).
**Method:** a new read-only sampler (`test-evidence/drafting-family-deep-dive.mjs`)
pulling every stored draft/pitch/note this platform has ever produced, plus
every organization/knowledge_base/twin/opportunity/funder row needed to
check each one against the org's own stored data. Full raw output:
`test-evidence/drafting-family-raw.json`. Cross-check script (reproduces the
four headline claims below): `test-evidence/ar174-fabrication-crosscheck.mjs`.
GET-only against PostgREST throughout. **No Claude call was made, no agent
was executed, no row was written by this audit.**
**Verdicts only. No fixes. AR-17.6 fixes.**

---

## LEAD FINDING — read this section first

This platform has produced exactly **47** drafting-agent outputs and **3**
AutoApply submissions in its entire history. That is not a sampling
limitation this report works around — it is close to the whole population,
and reading all of it surfaced three independently-confirmed instances of a
funding application containing a materially false statement, plus one
metadata field that has never once recorded the truth.

### 1. A federal grant application phone number that exists nowhere in the organization's data, repeated identically five times

Every one of the five drafts produced by the "twin-powered" autonomous
draft path (`draft-generation-agent.ts`, ag-05-draft) for FAITH Foundation
contains the phone number **`888-497-6620`** or **`(888) 497-6620`** in a
federal-application header block ("Phone: 888-497-6620"). FAITH
Foundation's real, stored phone number is **`7372967444`**
(`organizations.phone`). `888-497-6620` appears nowhere in the
organization's record, its 36-entry knowledge base, or its digital twin —
confirmed by direct search of all three (see
`ar174-fabrication-crosscheck.mjs` output, section 2). It is not a stray
one-off: it is byte-identical (format aside) across five separate
generations spanning **2026-08-20 to 2026-09-08**, for five different
federal opportunities (PRICE, Stand Down Grants, Reentry Housing, HVRP,
NSP). Zero of the platform's other 41 drafts for this same organization —
generated through the *ordinary* drafting path — contain a fabricated phone
number; those correctly render `[NEEDS INPUT: Phone number]` wherever
contact data is missing. **Root cause, verified in source**: the ordinary
path's organization query (`src/lib/drafts/generator.ts:348-351`) selects
`ein, tax_status` and its prompt-builder inserts an explicit `[NEEDS INPUT:
...]` placeholder for every field it doesn't have. The twin-powered path's
organization query (`src/lib/agents/draft-generation-agent.ts:1476-1480`)
selects only `name, mission_statement, vision_statement, service_area,
target_population, founder_name, annual_budget` — it never selects phone,
address, EIN, or tax status, and never substitutes a placeholder for them
either. When the federal application template it's imitating calls for a
phone number, the model isn't told one is missing; it just writes one. This
is the single most concrete, most reproducible fabrication in this audit.

### 2. A real submission, sent to a real funder, describing the wrong organization

On **2026-06-19**, an AutoApply submission from FAITH Foundation (Burnet,
Texas) to the corporate funder **Meade Tractor** — status `submitted` —
carried this `request_description`, verbatim:

> "Faith Foundation SF is a 501(c)(3) nonprofit providing emergency housing
> and community services in the San Francisco Bay Area. We are requesting
> support for our upcoming community outreach program serving families in
> transitional housing."

FAITH Foundation is not in the San Francisco Bay Area, is not called "Faith
Foundation SF," and does not run a "community outreach program" — its real
work (per its own 36-entry knowledge base) is down-payment vouchers,
transitional housing, and the Cornerstone Communities modular-housing
model in South and Central Texas. This text is not the drafting agent's
invention — it traces to a `request_profiles.needs_description` value that
was corrected on 2026-07-28, five weeks *after* this submission went out —
but the platform pipeline that pulled it into a live funder submission
(`FormFillerAgent.buildFillData()`) performed no check of any kind against
the organization's own profile before sending it. Compounding it: Meade
Tractor's own stated `geographic_focus` is **"Virginia West Virginia North
Carolina"** — nowhere near Texas or San Francisco. Three different claims
about where this organization operates (real: Texas; claimed: San
Francisco; funder's actual footprint: VA/WV/NC) collided in one submission,
and none of it was caught before the funder received it.

### 3. An empty organization profile produced the second-highest confidence score on the platform

The one draft ever generated for a second organization ("Beta Org 1," which
has **zero** knowledge_base rows and a blank `mission_statement`) invents,
with no hedging: a **94% housing retention rate**, **twelve years** of
prior operation, a **340-unit** existing housing portfolio, and **28 FTE
staff** — none of which exist anywhere in this organization's data, because
this organization has no data. `draft_versions.confidence_score` for this
row is **82**, the second-highest score in the entire 47-row corpus. Per
the documented scoring formula in the same file
(`computeConfidence()`, `src/lib/drafts/generator.ts:167-184`), a draft
built from zero knowledge-base entries should score at most ~65 minus a
penalty per `[NEEDS INPUT]` gap — 82 is not reachable by that formula for
this input, and `knowledge_sources` on the row is `null` rather than an
empty array, meaning the transparency panel that should show a customer
exactly what was and wasn't used to write their draft shows nothing at
all. Full detail in §1.2 below.

**These three findings compound rather than average out.** A customer
reading FAITH Foundation's ordinary drafts (§1.1) would see a careful,
well-grounded, appropriately humble product — median confidence score 25,
heavy and correct use of `[NEEDS INPUT]`, real citations to the org's own
data. That same customer's *autonomous* drafts, generated by the feature
this platform markets as "twin-powered," fabricate a phone number every
time they run. And the one AutoApply submission this platform has actually
sent to a real funder on this organization's behalf misstated which state
the organization is in.

---

## 0. Population sampled

| Table / path | Total rows ever | Distinct orgs | Distinct real (non-fixture) orgs |
|---|---|---|---|
| `draft_versions` (narrative_drafting + budget_builder) | 47 | 2 | 1 (FAITH Foundation, 46 rows) + 1 near-empty (Beta Org 1, 1 row) |
| `applications` with non-empty `draft_content` | 11 (manual) + 5 (autonomous) | 5 | 2 (FAITH Foundation appears under **two different organization_id rows**, see §2.3) |
| `autoapply_submissions` | 3 | 3 | 1 (FAITH Foundation); 2 are named test-harness fixtures (`EXERCISE-HARNESS-Test Foundation`, `AR12_2_LIVE_RUN_q7x9k2`) |
| `pitch_cache` | **0** | — | personalized-pitch caching has never persisted a row in production |
| `notes` (`follow_up_generator`) | **0** | — | this agent has never produced output |
| `notes` (`budget_builder_worker`, review-agent) | 7 | 2 | 1 (FAITH Foundation, 4 rows) |
| `sales_sends` (B2B sales-outreach) | **0** | — | zero emails ever sent (matches prior finding: Resend env var absent in prod) |

**This changes how every section below must be read.** "Cross-org
similarity" and "funder-specificity" are questions this platform's own
production data can answer with real confidence for exactly one
organization. Where the sample is one org or fewer, that scarcity is
reported as the finding, not padded with a wider net or a synthetic
comparison — consistent with the AR-17.1/17.2/17.3 discipline this queue
established.

---

## 1. Core drafting agent (`narrative_drafting`, `src/lib/drafts/generator.ts`) — LOI, grant narrative, donation letter, full proposal, impact statement, budget narrative

`draft_versions.template_type` breakdown (47 rows): `grant_narrative` 40,
`full_proposal` 2, `letter_of_inquiry` 2, `donation_request_letter` 2,
`budget_narrative` 1, `impact_statement` 0 (never generated, ever).
`source` breakdown: `generated` 30 (manual, one-click), `autonomous` 5
(nightly batch via `worker/autonomous-orchestrator.ts`, template hardcoded
to `grant_narrative` regardless of what `TemplateSelector` would actually
pick), `humanized` 12 (a `generated` draft re-run through the humanizer).

### 1.1 CROSS-ORG SIMILARITY

Only two organizations have ever used this feature: **FAITH Foundation**
(46 of 47 rows) and **Beta Org 1** (1 row). This is the entire cross-org
comparison population available; it is reported honestly rather than
inflated.

**The one cross-org pair available shows near-zero overlap.** Jaccard
similarity over 5-word shingles between Beta Org 1's single draft and each
of FAITH Foundation's 40 `grant_narrative` drafts: **0.0000–0.0006** (0–2
shared 5-word phrases out of 350–5,500 per document). Two different
organizations did not receive interchangeable text — but with n=1 org pair,
this cannot be generalized into "the platform never produces boilerplate
across customers." It can only be reported as: the one instance this
platform has ever produced shows no duplication, and no wider claim is
supportable from this data.

**Same-org, different-funder similarity (the achievable substitute test,
516 pairs, FAITH Foundation only):** mean Jaccard **3.7%**, median **3.5%**,
max **14.8%**, min **0.6%**. The highest-similarity pair (drafts for the
PRICE program vs. a Fair Housing Assistance Program opportunity) shares the
organization's own boilerplate — its mission statement, board bios, and
Cornerstone Communities program description repeat verbatim, which is
*correct behavior* (an org's own facts about itself should not change
funder to funder) — while the need-statement, program-fit, and ask sections
differ substantially. **This is the positive half of the finding: the
agent is not producing a form-letter with the funder's name swapped in.**
It is producing genuinely different documents keyed to genuinely different
funders, for the one organization with enough data to make that possible.

### 1.2 ORG-SPECIFICITY and FABRICATION — the split verdict

**When knowledge_base data exists, the agent uses it correctly and does not
invent beyond it.** Every fact checked against FAITH Foundation's org
record, digital twin, and 36 knowledge_base entries was traceable:

- "Foundation for Affordable Instruction and Tenancy Hope" (the FAITH
  backronym) — present verbatim in `knowledge_base` (`organizational_history`,
  `mission` categories).
- Founder Reid Whitesides's biography (20+ years construction, ~20 years
  incarcerated, 15+ years sober) — present verbatim in `knowledge_base`
  (`capacity` category, "Board Leadership & Governance").
- Board members Scott Ellis and Pastor Juan Valdez, their roles and
  backgrounds — present verbatim in `knowledge_base`.
- "Bright Box Homes," the $2,500-per-home-sold mechanism, $30,000–$60,000
  per modular unit — present verbatim in `knowledge_base` (`partnerships`,
  `capacity`).
- Annual budget figure used in the budget narrative ("$75,000") — matches
  `organizations.annual_budget: 75000` exactly.
- A checked citation ("UNLV Reentry Research Brief, 2024," 82% re-arrest
  rate) initially looked fabricated — no such exact title was found in the
  org's own knowledge base at first read. A web search located a real UNLV
  Criminal Courts Justice Partnership document ("Re-Entry Barriers:
  Barriers to Successful Re-Entry," Dec. 2024) whose figures match; the
  citation is an informal shorthand for a real source, not an invention.
  **Reported here specifically because it looked like fabrication and
  wasn't** — the same discipline AR-17.3 applied to reading zeros
  correctly applies to reading a suspicious-looking citation correctly.
  A platform-internal reviewer agent (see §3) independently flagged this
  same citation as "an unusual source for a federal grant" — a legitimate
  citation-hygiene note, not evidence of invention.
- No instance was found, across a targeted sweep of all 46 FAITH
  Foundation drafts, of a projected/target figure (e.g. the KB's own "Year
  3 target: 90% housing retention") being reframed as an already-achieved
  outcome. The org's explicit "we are pre-revenue, these are targets, not
  results" framing survived into every draft checked.

**When knowledge_base data does not exist, the agent invents with total
confidence.** Beta Org 1's draft (§ Lead Finding #3, full text below)
states as fact: a 94% retention rate, twelve years of operation, 340
housing units, 28 FTE staff, "successfully operated similar programs,"
"strong relationships with local workforce development boards" — a
complete organizational history and track record for an organization that
has entered no organizational history anywhere in the product. Two
`[NEEDS INPUT]` markers appear in the same document (staffing credentials,
per-unit cost) sitting directly alongside equally-unfounded, unmarked
figures — the agent applied its hedging convention inconsistently within
the same output.

**And the twin-powered path invents even when data exists** — see the Lead
Finding: the same organization (FAITH Foundation) that is correctly and
richly grounded under the ordinary path gets a fabricated phone number
under the autonomous path, because that path's own context-builder never
retrieves or flags the field as missing.

### 1.3 FUNDER-SPECIFICITY

Positive. Every FAITH Foundation draft checked addresses the named
opportunity by its actual program name and funder type, and adapts
framing accordingly: the Fair Housing Assistance Program LOI leads with
disparate-impact/discrimination framing and includes a `[NEEDS INPUT]`
flag questioning whether FAITH Foundation is even FHAP-eligible (FHAP
funds government agencies, not nonprofits directly — a genuinely useful,
funder-rule-aware catch, not boilerplate); the Stand Down Grant application
(DOL/VETS) opens with the correct program citation ("VPL 01-23") and a
one-day-vs-multi-day funding-amount fork; the Texas CDBG-Housing budget
narrative ties every cost category to the CDBG program's own rural-housing
priority language. This is not generic nonprofit prose with a name
substituted in — it is response text built around each funder's actual
rules and stated interest, for the one organization with data to build it
from.

### 1.4 LENGTH AND FORMAT vs. funder limits

Two concrete defects, both traceable to a single root cause: every
template type shares one `DEFAULT_MAX_TOKENS = 8192` ceiling
(`src/lib/ai/claude.ts:27`), with no template-specific budget.

- **12 of 47 drafts (26%) were truncated mid-generation**, each one ending
  literally with the string `[Draft truncated — regenerate with a more
  specific template type for complete output]`. This is not a rare edge
  case — it is one in four of everything this feature has ever produced.
- **The Letter of Inquiry template is not a letter of inquiry by length.**
  The prompt itself correctly defines the template as "a *brief* letter of
  inquiry introducing the organization and gauging the funder's interest
  before a full proposal" (`src/lib/ai/prompts/grant-narrative.ts:26-27`),
  but nothing enforces that. The two LOIs sampled run **14,352 and 14,803
  characters** (roughly 2,300–2,500 words) — longer than most full grant
  narratives at peer organizations, and including a multi-page federal
  compliance-checklist appendix (SAM.gov, UEI, Davis-Bacon, Section 3,
  Single Audit thresholds) that has no place in a document whose entire
  purpose is a one-page inquiry before any of that becomes relevant. A
  program officer opening what was promised as a letter of inquiry and
  receiving a five-times-too-long federal-compliance dossier would
  reasonably conclude the sender doesn't know what an LOI is.

### 1.5 Two organizational_id rows for what appears to be one real organization

FAITH Foundation exists under **two separate `organization_id` values**
(`b1ab7402...`, 46 drafts and the org this report otherwise discusses; and
`bed3e621...`, which owns a different, earlier-sounding mission statement
about "down payment assistance vouchers" without the Bright Box
Homes/Cornerstone Communities narrative, and its own separate 17-entry
knowledge base and digital twin). Same EIN digits in both (`33-2640449` /
`332640449`, formatting differs), different founding dates, different
annual budgets ($250,000 vs. $75,000), different phone/address. This is
very likely the same real nonprofit re-onboarded at some point under a new
account, splitting its knowledge base and twin across two identities. Not
itself scored as a drafting-quality defect, but material context for
reading every number in this report: "FAITH Foundation's data" is really
two organizations' worth of data that a real program officer would expect
to be one.

---

## 2. Twin-powered autonomous draft path (`ag-05-draft`, `draft-generation-agent.ts`) — its own findings

Per the AR-13 census this agent is **DEGRADED**. This audit adds:

1. **`twin_powered` has never once been `true` in production.** The
   current source unconditionally sets `twin_powered: true` on every
   insert (`draft-generation-agent.ts:1879`) — it is not gated on whether
   twin data actually existed. Every one of the 5 live `draft_source =
   'autonomous'` application rows in production shows `twin_powered:
   false, twin_completeness: null`. Either these rows were produced by a
   version of the code that predates this flag, or `agent_runs` logging
   for `ag-05-draft` (4 lifetime runs recorded, dated Aug 8 and today) does
   not correspond to the runs that actually produced these 5 rows (dated
   Aug 15–Sep 8) — the two datasets do not reconcile, and this report does
   not claim to have resolved which. Either way: **no row in this
   platform's history currently proves the twin-powered feature has ever
   fired as designed**, despite organizational_digital_twins holding real,
   substantial data (twin_completeness_score 60–70) for the organization
   these drafts were generated for.
2. **The fabricated phone number** (Lead Finding #1) is unique to this
   path — the ordinary drafting path, given the same organization and the
   same missing phone number, correctly emits `[NEEDS INPUT: Phone
   number]` instead.
3. Text quality and structure otherwise matches the ordinary path closely
   (both call the same underlying model with comparably-sized prompts),
   which is expected since both draw the same knowledge_base and
   proven-narrative rows — the defect here is specifically in this path's
   own, separately-written context-assembly code
   (`buildSharedContextBlock`), not in narrative quality generally.

---

## 3. Budget narrative — two independent writers, same destination

Both `src/lib/agents/budget-agent.ts` (`agentType: budget_builder`) and
`src/lib/drafts/generator.ts` (when `template_type = 'budget_narrative'`)
insert into `draft_versions` with `source: "generated"` — there is no
column distinguishing which of the two wrote a given `budget_narrative`
row. Only one such row exists in production (§0), so this could not be
resolved empirically this round; flagging it as the same kind of registry
ambiguity AR-17.3 found in the research family (seven agents sharing an
undiscriminating filter) rather than treating the single row as
representative of either writer specifically. The separate
`budget_builder_worker` path (`src/lib/agents/budget-builder.ts`, writing
to `notes`) is a third, distinct implementation again — its output is a
**review of an existing draft's budget readiness**, not a budget narrative
itself (see §5, it is in practice functioning as the review-agent). Three
code paths, two of them ambiguously sharing one table, is worth AR-17.6's
attention independent of any quality question.

---

## 4. Executive summary — not persisted, cannot be sampled

`POST /api/reports/board-report/executive-summary` generates a ~200-word
board-ready summary via Claude and returns it directly to the client
(`src/app/api/reports/board-report/executive-summary/route.ts:54-66`). It
is never written to any table. This is the same structural gap AR-17.1
found for `email_campaign` — the content a customer actually sees cannot
be retrieved, sampled, or audited after the fact, by design. **UNLOCATABLE**,
consistent with the existing registry convention (`output-quality-locations.mjs`);
no fixes attempted per this prompt's scope, and no live call was made to
generate a sample, since this audit does not execute agents.

---

## 5. Outreach and sales-outreach copy

### 5.1 Funder/donor-facing outreach — `follow_up_generator`

**Zero notes have ever been produced.** This agent (post-submission
thank-you/check-in/status-request sequence, `follow-up-generator.ts`) has
never fired successfully in this platform's history. No output exists to
sample.

### 5.2 `cold_outreach` (`outreach_contacts`)

Writes contact identification (name, title, source URL), not generated
pitch copy — no prose to assess for this audit's purposes; see
AR-17.3 for its provenance findings.

### 5.3 B2B sales-outreach (`sales_campaigns` / `sales_sends`) — not actually a drafting agent

`SalesCampaignEngine` (`src/lib/admin/sales-campaign-engine.ts`) is **plain
string-template substitution** — `{org_name}`, `{first_name}`, `{city}`,
`{state}` swapped into an admin-authored `subject_template`/`body_template`
(`renderTemplate()`, line 57-59). **There is no LLM call anywhere in this
path.** It is included here because the task named "sales-outreach copy"
explicitly, but the honest finding is that this system does not generate
copy at all — every recipient of a given campaign step receives
byte-identical text apart from four database columns. Cross-org similarity
here is 100% by construction, which is not a defect of an AI system (there
isn't one) but is worth naming: if "personalized sales outreach" is a
claim made to anyone about this feature, it is not accurate. Moot for
fabrication risk (the only per-recipient data are `org_name`/`city`/`state`,
pulled directly from the `prospects` table, never invented) and moot in
practice: **zero emails have ever been sent** (`sales_sends`: 0 rows,
matching the prior finding that the Resend API key is absent from
production).

---

## 6. AutoApply personalized pitch (`autoapply_pitch_personalizer`, `pitch-personalizer.ts`)

`pitch_cache` (the 30-day cache keyed by org+funder+request_type) has
**zero rows in production** — this feature's cached-output path has never
been exercised by a real customer. The only pitch text on record came from
the AR-12 test-harness live run (`AR12_2_LIVE_RUN_q7x9k2`, a fixture org
with placeholder funder data). It is worth reading regardless, because it
demonstrates the prompt's anti-fabrication instruction working exactly as
designed:

> "I'm not able to responsibly fabricate a 'personalized' pitch when the
> funder identity and priorities are unspecified — doing so would produce
> exactly the generic boilerplate the instructions caution against. Please
> provide the actual funder details and I'll write a strong, specific
> pitch right away."

`buildPrompt()` (`pitch-personalizer.ts:173-211`) explicitly instructs "Do
NOT fabricate programs, outcomes, or statistics not mentioned above" in
both its monetary and non-monetary branches — the only Claude call in this
entire family that carries an explicit anti-fabrication instruction in its
own prompt text. **This is the one clean positive result available to
sample, and it is a genuine one**: given garbage input, the model
correctly refused rather than confabulating a pitch. A secondary,
harness-only defect: this refusal text was still written into the
`personalized_pitch` column as if it were a usable pitch, rather than the
call being treated as a failed generation — a formatting gap, not a
fabrication risk, since it happened on a fixture org.

**No real customer has ever received a personalized pitch through this
system in production.**

---

## 7. AUTOAPPLY FORM ANSWERS — dedicated section per this prompt

### 7.1 The AR-12 fix: present in source, live on `main`, unverified against a real post-fix submission

`FormFillerAgent.buildFillData()` (`src/lib/autoapply/form-filler-agent.ts`)
still contains the original bug the fix works around: its
`knowledge_base`-category loop (`cat.includes('ein')`,
`cat.includes('contact_email')`, `cat.includes('phone')`,
`cat.includes('address')`) checks against category strings the real
`knowledge_base_category` enum can never produce (it has no `ein`,
`contact_email`, `phone`, or `address` member — confirmed against
`database.ts`'s 11-value enum). The code's own comment states this
plainly: "every `cat.includes('ein')`-style check above is permanently
unreachable against a real row." **The fix** (lines 609–624) is a
fallback directly onto `organizations.ein / .contact_email / .phone /
.address_line1`, matching how `submission-validator.ts`'s readiness gate
already reads the same columns.

- **Verified: the fix is on `main`.** Commit `a69c67f1` (2026-09-18,
  labeled `[FORGE] AR-9.3` in this repo's own numbering — the prompt's
  "AR-12" almost certainly refers to a different track's numbering for the
  same underlying defect) is an ancestor of `origin/main`; local `HEAD`
  matches `origin/main`. Railway's `watchPatterns` include
  `src/lib/autoapply/**`, so a push here triggers a worker rebuild.
- **Verified: for the platform's real (non-test) organizations, `email`
  and `contact_email` are kept in sync**, so the fallback's choice of
  `contact_email` over `email` is not itself a live gap. Of 23 onboarded
  organizations, all genuine (non-`*-test-*`/`*e2e*`/`EXERCISE-HARNESS`)
  rows show `contact_email === email` whenever either is set; the
  mismatches found in a first pass (78 of 2,173 total org rows) were
  entirely test-fixture noise from Playwright/registration-flow specs,
  none of them onboarded, none of them real.
- **Not verified: no real AutoApply submission has occurred since the fix
  landed.** All 3 rows in `autoapply_submissions` predate or are unrelated
  to it: the one real-organization row (FAITH Foundation → Meade Tractor)
  is from 2026-06-19, three months before the fix; the other two are named
  test-harness fixtures from Sep 18–19. **There is currently no evidence,
  one way or the other, that a real customer's EIN/phone/address has
  actually been filled correctly on a live funder portal since this fix
  shipped** — only that the code which should do so is present and
  deployed.

### 7.2 What the Claude fallback (`fillUnmappedFields`) is actually instructed to write

For any visible form field the stored template mapping doesn't cover,
`fillUnmappedFields()` (`form-filler-agent.ts:945-1056`) sends Claude the
available `fillData` values and the unmapped field labels, and asks it to
return `{"selector":"...","value":"..."}` pairs, with the single
instruction: *"Only include fields that have relevant data."*
**This prompt carries no anti-fabrication instruction of any kind** — no
"do not invent," no "leave blank if unknown," nothing resembling the
explicit guardrail present in `pitch-personalizer.ts`'s prompt (§6) or in
`grant-narrative.ts`'s prompt (§1). Its only implicit safety property is
that it can only select from the `fillData` object it was handed — it has
no mechanism to introduce a wholly new fact the way the twin-powered
drafting path did (§ Lead Finding #1), because it is filling fields from a
fixed key-value set rather than composing free narrative text. But nothing
in its instructions would stop it from mis-selecting or reformatting a
value if the label matching is ambiguous, and — because this call fires
live inside a real browser session against a real funder portal and its
output is never persisted anywhere — **there is no way to audit after the
fact what it actually wrote into any given field.** This is the same
structural blind spot as executive-summary generation (§4), on the
riskiest path in this family: the fields it fills are the ones that
reach a live submission with no downstream record.

### 7.3 The one real submission's request description, again

Read together with §7.1: the platform's readiness gate (`checkOrgReadiness`
in `submission-validator.ts`) requires `mission_statement`, `ein`,
`address_line1`, `founder_name`, `contact_email`, and `phone` to be
non-null before a submission is allowed — meaning by 2026-06-19 those
columns were populated for FAITH Foundation. The gate correctly verified
the organization *had* identity data on file. It has no gate that checks
whether the *free-text* `request_profiles.needs_description` field
actually describes that same organization. That gap is exactly how "Faith
Foundation SF... San Francisco Bay Area" reached Meade Tractor: every
structured field was present and internally consistent; the one field
carrying the organization's actual self-description was wrong, and nothing
downstream was positioned to notice.

---

## 8. Summary of verdicts

| # | Finding | Severity |
|---|---|---|
| 1 | **Twin-powered draft path fabricates a phone number that exists nowhere in the org's data, identically across all 5 lifetime outputs**, because its context-builder never retrieves or flags the field as missing (root-caused to specific line numbers, §2). | **Critical** |
| 2 | **A real submission to a real funder misstated the organization's identity and location** (Texas org described as "Faith Foundation SF... San Francisco Bay Area"), sent to a funder whose own stated geography is neither Texas nor California. Not agent-invented, but nothing in the pipeline checks stored free-text against the org's own profile before submitting. | **Critical** |
| 3 | **An empty organization profile produced a confident, fully invented operating history** (94% retention, 12 years, 340 units, 28 FTE) with a confidence score (82) mathematically inconsistent with the documented scoring formula for zero knowledge-base input, and a `null` (not empty) transparency-panel field. | **Critical** |
| 4 | `twin_powered` has never recorded `true` in production despite unconditional-`true` source code and real twin data existing — the flag and the underlying reality are currently un-reconciled. | **High** |
| 5 | 26% of all drafting-agent output (12/47) was truncated mid-generation by a one-size-fits-all 8,192-token ceiling shared across every template type. | **High** |
| 6 | The Letter of Inquiry template produces 14K+ character documents with a full federal-compliance appendix, ~15-20x longer than the "brief... before a full proposal" the prompt itself defines it as. | **High** |
| 7 | AutoApply's Claude-driven unmapped-field filler carries no anti-fabrication instruction (unlike the pitch-personalizer and the narrative-drafting prompts), and its output is never persisted — unauditable by construction on the platform's highest-consequence path. | **High** |
| 8 | The AR-12-class fix (organizations-table fallback in `FormFillerAgent.buildFillData()`) is verified present and pushed to `main`, but **no real (non-test) AutoApply submission has occurred since it landed** — its production effect is unverified, not confirmed. | **Medium (corrects scope of "verified")** |
| 9 | `pitch_cache` (0 rows), `follow_up_generator` notes (0 rows), and B2B `sales_sends` (0 rows) — three of the seven agents in this family's scope have **never produced a single piece of real output**. | **Medium** |
| 10 | B2B "sales-outreach copy" is plain 4-variable string-template substitution with no LLM involved — "personalized" would misdescribe it if claimed. | **Medium** |
| 11 | FAITH Foundation's knowledge base and twin are split across two `organization_id` rows, likely the same real nonprofit re-onboarded — context for every number in this report, not itself scored. | **Medium** |
| 12 | Two independent code paths (`budget-agent.ts`, `generator.ts`) write `budget_narrative` rows to the same table with no distinguishing column; only one row exists in production so this could not be resolved empirically. | **Medium** |
| 13 | Executive-summary generation is never persisted — structurally unauditable, same class of gap as `email_campaign` (AR-17.1). | **Medium** |
| 14 | **Positive, checked and confirmed:** where knowledge_base data exists (FAITH Foundation, ordinary path), org-specificity and funder-specificity are both genuinely strong — real founder biography, real board members, real program economics, funder-rule-aware caveats (e.g. flagging FHAP eligibility doubt), and appropriately low, humble confidence scores driven by real content gaps. | **Positive** |
| 15 | **Positive, checked and confirmed:** the AutoApply pitch-personalizer's prompt explicitly instructs against fabrication, and its one real sample shows the model correctly refusing to invent a pitch from placeholder input rather than complying with a bad prompt. | **Positive** |

---

## Evidence index

| File | Contents |
|---|---|
| `drafting-family-deep-dive.mjs` | Read-only sampler: pulls every drafting/pitch/outreach row this platform has ever produced, plus org/KB/twin/opportunity/funder context |
| `drafting-family-raw.json` | Full raw output of the above — every draft quoted in this report is verbatim from this file |
| `ar174-fabrication-crosscheck.mjs` | Reproduces the four headline claims (Beta Org 1 fabrication + confidence anomaly; FAITH Foundation phone-number fabrication across all 5 autonomous drafts; twin_powered always-false; the Meade Tractor wrong-identity submission) directly from the raw JSON |

All probes read-only. No agent was executed, no Claude call made, no row written.
