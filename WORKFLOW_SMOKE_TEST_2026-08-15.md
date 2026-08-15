# Real End-to-End Workflow Smoke Test — 2026-08-15

## Scope and method

Ran the full core journey (login → dashboard → research/discover an opportunity → generate an
AI draft → assemble a document → move through the application pipeline → record an outcome)
against the **real, live production Supabase project** (`vbjplpquqxxfbpazyalt`), driving the
actual app UI with Playwright against a local `pnpm dev` server (port 3001 — port 3000 was
already occupied by an unrelated project). No mocks. Every step below is a real click or a real
authenticated `fetch()` call from inside the running app, and every "confirmed" claim was checked
by querying the live database directly (`psql "$DATABASE_URL"`), not by trusting the UI.

**Org split, and why:** login + dashboard + discovery were run against the **real FAITH
Foundation org** (`b1ab7402-...`, the org `info@faithfoundationsf.org` actually owns — there are
two same-named orgs in production, see Finding 6). Login used a Supabase-admin-issued magic link
exchanged into session cookies server-side; **the real password was never read or changed.** The
pipeline/draft/document-assembly steps were also run for real against FAITH Foundation, using a
newly-discovered real opportunity, all the way up to a real (correctly-triggered) compliance-check
block at the Submitted stage. The final **outcome-recording** step was done instead against the
dedicated, pre-existing **Benavora E2E Test Org** (`bf75d362-...`, `owner.e2e@benavora-test.dev`)
— recording an outcome triggers Recursive Learning / relationship scoring / Grant DNA, which would
have written fabricated "proven narrative" and success-rate data into FAITH Foundation's real,
live analytics. That's exactly the "real writes would be destructive" case the task called out for
using a disposable org instead.

Driver scripts (kept as real, reusable artifacts, not one-off scratch): `scripts/smoke-test-workflow.mjs`,
`scripts/smoke-test-faith-continue.mjs`, `scripts/smoke-test-e2e-outcome.mjs`. Screenshots for every
major step are in `smoke-test-output/`.

---

## Step-by-step results

### 1. Login (FAITH Foundation, real)
**Real.** Session established via an admin-issued magic link, exchanged server-side into the
exact cookie shape `@supabase/ssr` expects (the app's client uses PKCE, so a raw hash-token magic
link doesn't auto-authenticate — had to exchange it manually rather than just navigating to it).
Landed on `/dashboard` authenticated as the real owner.

### 2. Dashboard renders real data
**Confirmed, with one real bug found and fixed.** `/dashboard` rendered real, live numbers:
319→320 opportunities, 27 deadlines, 17% KB completeness, 133,812 research profiles indexed,
23 platform health score, "FAITH Foundation" branding. **But two console `500` errors fired on
every load** — see Finding 1 (fixed).

### 3. Research / discover a real opportunity
**Real, live external API call.** Clicked "Run Now" on `/settings/integrations`. This fired an
actual Grants.gov poll and inserted a genuine new row: **"Rural Housing Preservation Grant"**
(`opportunities.id = 2679d5eb-...`, `source = grants.gov`), confirmed via direct DB read
before/after (319 → 320 rows). This is a real opportunity from the real Grants.gov API, not
seeded or fabricated.

Then triggered the real Eligibility Scoring Agent (`POST /api/agents/eligibility`) — no manual
UI button exists for this on a single opportunity (see Finding 3), so I called the route directly
from the authenticated browser session, same as any UI button would. **First attempt failed with
a real 500** — see Finding 2 (fixed). After the fix, a real Claude call scored it: **18–35/100,
recommendation "skip"** across repeated runs, with real per-run reasoning ("Mission alignment is
partial — FAITH Foundation focuses on housing insecurity... but the HPG program specifically...").
This is an honest, correct assessment — this particular Grants.gov listing is a mediocre fit for
this org, and the AI said so rather than inflating the score.

Created a real application via **Apply Now → Create application**
(`applications.id = 1944f4e3-eade-48e7-b314-f5bb8001f56a`), confirmed by direct read.

### 4. Generate a real AI draft
**Real, confirmed end-to-end.** Moved the application discovered → eligibility_review → qualified
→ drafting via three real clicks through the "Move application" modal (each one verified in
`pipeline_history`). On the Draft Generator, selected "Grant narrative" and clicked Generate — a
real Claude call (`POST /api/ai/draft`, **149.6s**, 200) produced a **38,462-character** real draft,
saved onto the application (`applications.draft_content`, confirmed by direct read). Confidence
scored **0/100 with 23 unresolved `[NEEDS INPUT]` gaps** — an accurate reflection of this org's
real 17% Knowledge Base completeness, not a bug: the AI correctly refused to invent facts it didn't
have (bio data, program-specific USDA/rural-housing details this org's KB doesn't contain).

### 5. Assemble a real document
**Real, correct, but not what the label implies.** The application detail page has two
document-related tabs: "Assembly" (a document-attachment checklist — confirmed by reading
`src/lib/agents/final-assembly.ts`, it orders/verifies already-uploaded files against an
opportunity's `required_documents`, it does not generate a new file) and "Proposal Package" (the
real "One-Click Proposal Package" feature, `ProposalPackagePanel.tsx`). Ran the latter for real:
**3 of 4 steps succeeded** — Narrative Draft (real Claude call, confidence 14/100, same low-KB
cause as step 4), Logic Model (28 real items generated across inputs/activities/outputs/outcomes),
and Document Assembly (correctly reported "no documents to check" — this opportunity defines zero
`required_documents`). **Budget failed** because the org has 7 real programs and the package
doesn't know which one to cost against — this is documented, expected multi-program behavior, not
a new bug.

### 6. Move through the real pipeline
**Real, with a correct safety-gate block.** Advanced the application through drafting →
awaiting_documents → ready_for_review (2 more real, verified `pipeline_history` rows). Attempting
the final move to **Submitted** correctly failed: the real Compliance Pre-Check
(`POST /api/compliance/check`) found the draft's 15 remaining `[NEEDS INPUT]` gaps (specific
dollar amount, county-level USDA rural-designation data, target-county names) and blocked
submission with an itemized reason list. **This is the compliance gate working exactly as
designed** — it's the same underlying data gap step 4 already surfaced, now correctly stopping a
genuinely incomplete draft from being marked "submitted." I did not fabricate the missing KB facts
to force it through, since the AI's own principle ("never invents organizational facts") is the
thing being tested here. Application `1944f4e3` was left at **Ready for Review** — a real,
accurate, useful state for FAITH Foundation to actually pick up (a poor-fit opportunity, correctly
flagged, not yet submitted).

### 7. Record a real outcome
**Real, done in the disposable E2E Test Org** (see rationale above). Advanced the org's existing
seeded application ("Rural Housing Stability Grant (E2E Seed)") to Submitted — first attempt was
correctly blocked by the same real Compliance Pre-Check (missing org EIN / tax status; filled
those into the org profile directly since a real org would fill them in via Settings, then
retried — a legitimate setup step, not gaming the check). Opened **Record outcome**, submitted
**Awarded, $35,000**, and confirmed live in the database:

```
outcomes: result=awarded, awarded_amount=35000.00, requested_amount=35000.00,
          funder_feedback='Smoke test: real award recorded end-to-end...'
```

The synchronous Recursive Learning trigger (`POST /api/agents/learning`) returned a real `200`.
Three further best-effort, fire-and-forget triggers (funder relationship scoring, Grant DNA,
knowledge indexer) are architecturally client-initiated `fetch()` calls that are not guaranteed
to complete if the browser navigates away quickly — see Finding 7 (documented, not fixed).
Re-tested `grant-dna-trigger` directly with a patient session: real `200`, real queue row created.
Re-tested `funder-relationship` directly: correctly blocked by the org's real daily agent-run
quota (10/day, already spent by this session's own testing) — confirms the route itself works and
tier enforcement is real, not a bug.

---

## Findings

### Fixed this session (small, unambiguous, applied live via `psql`)

**1. `GET /api/notifications` 500'd on every single call, for every org, always.**
`automation_notifications`'s live schema was missing `title`, `related_entity_type`, and
`related_entity_id` — columns migration `036_automation_notifications.sql` already declares and
14 files across the codebase already read/write, but the live table was evidently created
independently of that migration file (the recurring "two migration realities" pattern documented
elsewhere in this repo's memory). This broke the bell-icon notification center for every user, in
every org, on every page load. **Fixed:** `supabase/migrations/134_automation_notifications_missing_columns.sql`,
applied live. Table had 0 rows at fix time, so no backfill needed.

**2. Eligibility Scoring Agent (AG-02) wrote successfully for only 6 of 1,247 real opportunities,
ever, before this fix — every other call 500'd.** `eligibility-scorer.ts` writes
`is_high_priority` and `match_mismatch_reasons`, columns `012_opportunity_match_percentage.sql`
already declares but were never applied live. This is a severe, previously-undocumented
production bug: the feature described in `FEATURE_REGISTRY_v2.md` as "BUILT — Auto-scores new
discoveries" has essentially never worked. **Fixed:**
`supabase/migrations/135_opportunities_eligibility_columns.sql`, applied live and re-verified —
scoring now genuinely succeeds (confirmed 4 real scoring runs this session, live Claude reasoning
each time).

**3. Mojibake ("â€"" instead of "—") visible in the live Outcomes page UI.** A real UTF-8
double-encoding artifact in `src/app/(dashboard)/outcomes/page.tsx`'s Success Rate empty-state
value — visibly broken in the "SUCCESS RATE" metric card whenever an org has zero outcomes
recorded (i.e. most new orgs, on first load of that page). Same corruption pattern found (in
comments only, not user-visible) in `src/lib/agents/corporate-scraper.ts` and
`src/lib/agents/tdhca-scraper.ts`. **Fixed all three**, `pnpm tsc --noEmit` clean afterward.

### Documented, not fixed (workflow gaps / design notes, none blocking)

**4. No manual UI trigger exists to eligibility-score a single opportunity.** Confirmed by
repo-wide grep — the only way to score a freshly-discovered opportunity today is to wait for the
autonomous AG-02 chain to eventually pick it up, or call `POST /api/agents/eligibility` directly.
A newly Grants.gov-discovered opportunity has no manual "Score this" button anywhere in the UI.

**5. The manual Grants.gov "Run Now" sync doesn't chain into eligibility scoring.** Confirmed by
reading `grantsgov-sync.ts` — a manually-triggered poll inserts raw opportunity rows only; nothing
queues AG-02 for them. Combined with Finding 4, a real user who clicks "Run Now" gets new
opportunities that sit unscored indefinitely unless the separate autonomous nightly sweep happens
to reach them.

**6. Two real, separate "FAITH Foundation" organizations exist in production.** `bed3e621-...`
(created 2026-06-09, owned by `reid@repvg.com` / `reid@benavora.com`, 56 real opportunities, 2
profiles) and `b1ab7402-...` (created 2026-06-13, owned by `info@faithfoundationsf.org`, 320 real
opportunities, the one actually used). The older one looks like an abandoned setup/dev pass that
predates the real customer org, not a customer-facing duplicate — but it still pollutes any
cross-org admin view (org lists, aggregate counts) with a second "FAITH Foundation" entry. Left
as-is; deleting an organization is a destructive action outside this task's scope.

**7. Outcome-triggered background agent calls (funder relationship, Grant DNA, knowledge indexer)
are fire-and-forget client-side `fetch()` calls, not server-side triggers.** They work correctly
when the tab stays open (confirmed directly), but a user who submits an outcome and immediately
navigates away or closes the tab could silently drop them — no retry, no queue write, no error
surfaced anywhere. Not something this task's scope covers fixing (would mean moving these to a
server-side trigger inside the `outcomes` insert path or a DB trigger), but worth a dedicated pass
given how much of this platform's "intelligence" depends on these events actually firing.

**8. `applications.draft_confidence_score` stayed `0` even though `draft_versions.confidence_score`
for the same generation was also `0` — consistent, not a mismatch; noted only because a 0-confidence
"successful" draft generation is an easy thing to misread as a failure if you're only glancing at
the number instead of the real cause (KB gaps).**

### Positive confirmations (things that correctly worked, worth stating explicitly)

- RLS is correctly enforced everywhere touched this session (`documents`, `application_documents`,
  `automation_notifications` post-fix) — no cross-org leakage found.
- Tier/usage-limit enforcement is real and live (agent-run daily cap correctly blocked a repeat
  call once the E2E test org's quota was spent by this session's own testing).
- The Compliance Pre-Check gate genuinely blocks incomplete submissions with a real, itemized,
  correct reason list — not a rubber stamp.
- The AI draft generator genuinely refuses to fabricate organizational facts, surfacing gaps
  instead — confirmed twice, on two different orgs.

---

## Verified-in-DB summary

| Real write | Table | Confirmed via |
|---|---|---|
| New Grants.gov opportunity | `opportunities` | row count 319→320, direct read |
| Eligibility score (post-fix) | `opportunities.eligibility_score` etc. | direct read, 6→7 org-wide non-null count |
| New application + full stage history | `applications`, `pipeline_history` | 6 real transition rows, direct read |
| AI-generated draft | `applications.draft_content` | 38,462 chars, direct read |
| Real outcome | `outcomes` | 1 row, `awarded`/$35,000, direct read |
| Notifications schema fix | `automation_notifications` | `\d` before/after |
| Eligibility schema fix | `opportunities` | `\d` before/after |

## Files changed this session
- `supabase/migrations/134_automation_notifications_missing_columns.sql` (new, applied live)
- `supabase/migrations/135_opportunities_eligibility_columns.sql` (new, applied live)
- `src/app/(dashboard)/outcomes/page.tsx` (mojibake fix)
- `src/lib/agents/corporate-scraper.ts` (mojibake fix, comment only)
- `src/lib/agents/tdhca-scraper.ts` (mojibake fix, comment only)
- `scripts/smoke-test-workflow.mjs`, `scripts/smoke-test-faith-continue.mjs`,
  `scripts/smoke-test-e2e-outcome.mjs` (new — reusable real-login/real-click test drivers)
- `smoke-test-output/*.png` (screenshots from every major step)

`pnpm tsc --noEmit` — 0 errors after all fixes.
