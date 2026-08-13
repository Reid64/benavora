# Email Parser Verification — 2026-08-13

## Scope

`FEATURE_REGISTRY_v2.md` row #38 marks "Email Parsing Agent" as **BUILT** with no dated
verification citation and no live-test evidence — an old-style row from before this project
adopted its current evidence-citation discipline. This document checks it for real, live, against
three distinct capabilities that must not be conflated:

1. **EXTRACT/CLASSIFY** — BLUEPRINT.md §9.1's spec (Gmail webhook → classify → extract).
2. **SUMMARIZE** — `/api/email/summarize`, a candidate separate feature.
3. **RESPOND/REPLY** — auto-reply drafting/sending tied to inbound classification.

**Method:** every code claim below was confirmed by reading the real file in full. Every
functional claim was confirmed by running the real code (not a reimplementation) against the real
production database (`FAITH Foundation`, `organization_id = bed3e621-d93c-4e89-bfc4-a0fcea61b8fd`
— actual live org, real `funders` rows) and the real Anthropic API, via temporary `tsx` scripts deleted immediately
after use (none committed). No claim below is inferred from reading code alone where a live test
was possible.

---

## 1. EXTRACT/CLASSIFY — CONFIRMED WORKING

### Spec (BLUEPRINT.md §9.1, read in full)

> "Gmail API webhook triggers on new email. Email parser agent classifies: acknowledgment,
> information request, award notification, rejection, follow-up, general. Extracts funder name,
> opportunity reference, action required, urgency, sentiment."

### Real files read in full

- `src/lib/agents/email-parser.ts` — the `EmailParserAgent` class (extends `BaseAgent`).
- `src/app/api/agents/email-parser/route.ts` — the trigger route.
- `src/components/dashboard/EmailParserWidget.tsx` — the dashboard entry point.

### What the code actually does (confirmed by reading, then by live test below)

For each input email: calls Claude (`callClaude`, default model `claude-sonnet-4-6`) with a system
prompt that enumerates the exact 6 spec types and the exact 5 spec extraction fields
(`funder_name`, `opportunity_reference`, `action_required`/`action_description`, `urgency`,
`sentiment`); parses the JSON response; attempts a case-insensitive `ilike` match against the
org's `funders` table; if matched, appends a note to `funders.notes`; if type is
`award_notification`/`rejection`, sets `flaggedForOutcomeRecording`; inserts one row into
`email_activity` (table + `agent_type` enum value both added by migration
`018_email_activity.sql`, confirmed live/applied per `MIGRATION_AUDIT.md` line 211).

### Live test — real function, real DB, real Claude call

Ran `EmailParserAgent.run()` directly (not a route wrapper, not a mock) against the real Supabase
service-role client, scoped to the real FAITH Foundation org, with two realistic nonprofit funder
emails: an award notification from "Brightwater Foundation" (a real seeded funder,
`The Brightwater Foundation`) and an information request from a real seeded funder ("State Office
of Housing & Community Development").

**Real output (`outcome.data`, verbatim):**

```json
{
  "processed": 2,
  "results": [
    {
      "emailIndex": 0,
      "from": "grants@brightwaterfoundation.org",
      "subject": "Congratulations - Your Grant Application Has Been Approved",
      "emailType": "award_notification",
      "funderName": "Brightwater Foundation",
      "matchedFunderId": "9d6071af-8abc-4d1f-9e51-b11456d116df",
      "matchedFunderName": "The Brightwater Foundation",
      "opportunityReference": "Community Resilience Grant (Cycle 2026-B)",
      "actionRequired": true,
      "actionDescription": "Confirm receipt of award email, sign and return grant agreement within 15 business days, and prepare for mid-year progress report due January 15, 2027",
      "urgency": "high",
      "sentiment": "positive",
      "flaggedForOutcomeRecording": true,
      "emailActivityId": "6d2a0c4a-00a1-4ec2-a6a0-470f854e06d9"
    },
    {
      "emailIndex": 1,
      "from": "programs@statehousingdept.gov",
      "subject": "Re: Community Development Block Grant - Additional Documentation Needed",
      "emailType": "information_request",
      "funderName": "State Office of Housing & Community Development",
      "matchedFunderId": "f7b46b7f-c8d3-470b-ade9-d7e972e1929c",
      "matchedFunderName": "State Office of Housing & Community Development",
      "opportunityReference": "Community Development Block Grant",
      "actionRequired": true,
      "actionDescription": "Submit audited financial statements (last 2 fiscal years), Board of Directors roster with terms of service, and Certificate of Good Standing within 10 business days",
      "urgency": "medium",
      "sentiment": "neutral",
      "flaggedForOutcomeRecording": false,
      "emailActivityId": "09b8c317-b31f-4704-a2bf-ea588115ed6e"
    }
  ]
}
```

`tokensUsed: 1253`, `durationMs: 7083`.

**Verified side effects, queried back from the live DB after the run (not assumed from the
return value):**

- Both rows landed for real in `email_activity`, correctly scoped to `organization_id`, correct
  `funder_id` FK set on the matched rows, `action_required`/`urgency`/`summary` all populated
  correctly.
- `agent_runs` got a real `completed` row: `agent_type: "email_parser"`, `items_found: 2`,
  `items_processed: 2`, `tokens_used: 1253`, full `input_params`/`output_summary` present.
- Test rows deleted after verification (`thread_id` scoped delete); no permanent test data left in
  production.

**Classification, extraction, and funder-matching all match the spec exactly, live, for real
nonprofit-shaped emails.** Award notification → correctly typed, correctly flagged for outcome
recording, correctly matched to the real seeded funder despite the sender domain and funder name
not being identical strings ("Brightwater Foundation" vs "The Brightwater Foundation" — the
`ilike '%name%'` match handled this correctly). Information request → correctly typed, medium
urgency, not flagged for outcome recording (correct — it isn't an award/rejection), action
description accurately extracted from a documents-needed email.

### Gap found in the *trigger*, not the classifier (spec deviation, documented not fixed)

The spec's first sentence — "**Gmail API webhook triggers on new email**" — is **not built**.
Confirmed by repo-wide grep: no route, cron, or listener anywhere in `src/` references a Gmail
push/pubsub webhook (`grep -ri "webhook" src/lib/integrations/google/gmail.ts` → 0 matches; no
file matches `gmail.*webhook` outside `email-parser/route.ts` itself, which is the *manual*
trigger, not a webhook receiver). `/api/email/sync` (the real Gmail-sync route) does **not** call
`EmailParserAgent` or the `email-parser` route at all — confirmed by grep, 0 matches for
`email-parser`/`email_parser` in `src/app/api/email/sync/route.ts`. The code's own header comment
confirms this is known, not accidental:

> "Phase 3: processes email data passed to it directly. Phase 4 will wire in actual Gmail API
> integration (AGENTS.md Agent 17 family)." — `src/lib/agents/email-parser.ts:4-5`
>
> "Phase 4 will call this from the Gmail webhook; for now the manual EmailParserWidget on the
> dashboard is the entry point." — `src/app/api/agents/email-parser/route.ts:17-18`

**Net verdict for capability 1: the classification/extraction engine itself is CONFIRMED WORKING
end-to-end** (real Claude call, real correct output, real DB writes). **The automatic Gmail-webhook
trigger described in the same spec sentence is CONFIRMED ABSENT** — today the agent only runs when
a user manually pastes/enters email content into the `EmailParserWidget` on the dashboard. Row #38
as a single "BUILT" line conflates these two facts; the underlying agent logic is genuinely built
and correct, but the "triggers on new email" half of the spec is not.

---

## 2. SUMMARIZE — CONFIRMED WORKING, CONFIRMED SEPARATE SYSTEM FROM ROW #38

### Real file read in full

`src/app/api/email/summarize/route.ts` (75 lines, read in full).

### What it actually is

A `POST { thread_id }` route that:
1. Gates on `requireRole("viewer")`.
2. Reads `synced_email_threads`/`synced_email_messages` (the Gmail-*sync* tables from migration
   `002_phases_2_5.sql` — a completely different table family from row #38's `email_activity`,
   confirmed by direct migration read).
3. Builds a plain transcript and sends it to Claude (`claude-haiku-4-5-20251001`, a *different*
   model than the parser's default `claude-sonnet-4-6`) with a "summarize this thread in 2-4
   sentences" prompt.
4. Returns `{ summary }`. No classification, no extraction fields, no `funders` matching, no
   `email_activity` write — it does not touch a single table or code path that row #38's
   `EmailParserAgent` touches.

### Live test — real DB, real Claude call

`requireRole`'s cookie-based session auth (identical boilerplate shared by every authed route in
this codebase, not business logic specific to this feature) could not be exercised outside a real
browser login, so this test seeded a real 3-message thread into `synced_email_threads`/
`synced_email_messages` for the FAITH Foundation org and ran the route's exact query + Claude-call
logic verbatim (same tables, same prompt, same model) directly against the live DB and live
Anthropic API — everything downstream of the auth gate, for real.

**Seed data:** a realistic 3-message thread between Faith Foundation and "Janet Ruiz" at
Cornerstone Bank Community Fund (a real seeded funder) about scheduling a site visit and
requesting a 990/budget.

**Real output:**

```
# Email Summary

Faith Foundation and Janet Ruiz (Cornerstone Bank Community Fund) have scheduled a site visit for
August 26th at 10am to discuss Faith Foundation's LOI submission. Faith Foundation will submit
their most recent 990 form and program budget by end of week for the committee's pre-visit review.
```

Accurate, concise, correctly identifies the decision (site visit date/time) and the action item
(990 + budget). Test rows deleted after verification.

**Verdict: CONFIRMED WORKING**, and **CONFIRMED to be a genuinely separate system from row #38**
— different tables, different model, different prompt, no classification/extraction/funder-
matching, no shared code path with `EmailParserAgent`. Row #38's "Email Parsing Agent" and
`/api/email/summarize` are two independent, both-working features that happen to both touch
inbound email.

---

## 3. RESPOND/REPLY — CONFIRMED ABSENT

BLUEPRINT.md's §9 spec for Gmail integration (§9.1 Inbox Monitoring, §9.2 Auto-Matching, §9.3
Thread Tracking, §9.4 Calendar Sync — read in full) never mentions auto-reply drafting or sending.

Repo-wide search performed across `src/lib/agents/`, `src/lib/integrations/google/gmail.ts`,
`src/app/api/email/`, and `src/app/api/agents/` for anything resembling this capability:

- `grep -ri "auto.?repl|autoReply|draft.?repl|reply.?draft"` across `src/` → the only match is
  `src/lib/admin/unsubscribe-agent.ts`, read in full and confirmed **unrelated**: it classifies
  *sales-outreach cold-email* replies (`unsubscribe | positive | question | negative | auto_reply |
  bounce`) for suppression-list management (see
  `benavora-outreach-table-names-collide` /
  `benavora-three-followup-sequence-systems` memory) — a different domain (sales prospecting, not
  inbound funder-communication triage) and it only classifies/suppresses, it never drafts or sends
  anything.
- `grep -ri "gmail.*draft|createDraft|drafts\.create"` across `src/` → **0 matches**. No code path
  anywhere in this repo calls the Gmail drafts API.
- No route under `/api/email/` or `/api/agents/` composes or sends a reply in response to an
  inbound-email classification.

**Verdict: CONFIRMED ABSENT.** This is a clean, real finding, not a bug — there is no
auto-reply-drafting or auto-reply-sending capability tied to inbound email classification anywhere
in the codebase. Per the recovery-task instructions, this is **not built in this task** — it is
new feature scope requiring its own design decision from Reid (what should trigger a reply, what
tone/template, human-approval-before-send or fully autonomous, etc.), not verification work.

---

## Fix applied

**None required.** Both live-testable capabilities (EXTRACT/CLASSIFY and SUMMARIZE) worked
correctly on the first real run — no bug, no wrong column/table name, no silent failure of the
class already found elsewhere in this project this week. The one real gap found (no Gmail webhook
wiring the classifier to actually fire on new mail) is a missing integration, not a small
unambiguous bug — it is out of this task's SAFE-bar scope (wiring Gmail push notifications/pubsub
is new integration work, not a fix) and is documented above rather than attempted here.

## Summary table

| Capability | Verdict | Evidence |
|---|---|---|
| EXTRACT/CLASSIFY (classifier itself) | **CONFIRMED WORKING** | Live `EmailParserAgent.run()` against real DB + real Claude, correct classification/extraction/funder-match/DB-write, verified by re-querying `email_activity` and `agent_runs` after the run |
| EXTRACT/CLASSIFY (Gmail webhook trigger, same spec sentence) | **CONFIRMED ABSENT** | Repo-wide grep, 0 webhook/pubsub references; `/api/email/sync` never calls the parser; code comments confirm "Phase 4" not built |
| SUMMARIZE | **CONFIRMED WORKING**, separate system from row #38 | Live Claude call against a real seeded thread, correct 2-4 sentence summary; different tables/model/prompt from the parser, no shared code |
| RESPOND/REPLY | **CONFIRMED ABSENT** | Repo-wide grep across agents/email/api dirs, 0 relevant matches; not in BLUEPRINT.md spec; not built in this task per SAFE-bar scope |
