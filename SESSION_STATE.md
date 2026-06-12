# SESSION STATE — Benavora

_Last updated: 2026-06-12._

## This session: AI Humanizer Agent (two-pass content system)

**Goal:** After the Narrative Drafting Agent generates a draft, a second
specialized AI pass rewrites it to read like an experienced human grant writer
wrote it — defeating AI-detection fingerprints while staying grounded in the
organization's verified data. The Draft Generator gets a **Humanize** button that
calls the new endpoint, replaces the draft content with the humanized version,
and updates the confidence score to reflect humanization.

### Status: implementation complete & statically audited; runtime gates blocked on command-execution permission

`npx tsc` / `pnpm` return "requires approval" under both the Bash and PowerShell
tools in this non-interactive session. Per Iron Law 3, **no gate is claimed as
passing.** A read-only static type/reference audit was completed.

| Requirement | Where | Status |
| --- | --- | --- |
| `humanizer-agent.ts` created | `src/lib/agents/humanizer-agent.ts` | ✅ Done |
| `humanize/route.ts` created | `src/app/api/ai/humanize/route.ts` | ✅ Done |
| Two-pass system (draft → humanizer) | route loads grounding, calls `runHumanizer` | ✅ Done |
| Separate Claude call, specialized system prompt | `buildHumanizerPrompt` + `callClaude` (temp 0.9) | ✅ Done |
| Replace all em dashes (comma/paren/sentence break) | prompt rule + `stripEmDashes` enforcement net | ✅ Done |
| Strip + replace AI vocabulary (18 terms/phrases) | prompt rule + `replaceAiVocabulary` enforcement | ✅ Done |
| Dramatic sentence-length variance (5 vs 30 words) | prompt rule; measured by `analyzeHumanization` | ✅ Done |
| Add contractions naturally | prompt rule; measured | ✅ Done |
| Break perfect paragraph structure | prompt rule (one-sentence paragraphs) | ✅ Done |
| Pull specific numbers/names/dates/locations from KB + org | grounding data block in prompt | ✅ Done |
| Match org authentic voice from proven narratives | proven-narrative voice samples in prompt | ✅ Done |
| Vary formality within sections | prompt rule | ✅ Done |
| Eliminate repetitive sentence starters | prompt rule; `repeatedStarters` metric | ✅ Done |
| Remove perfect list parallelism | prompt rule | ✅ Done |
| Reduce burstiness uniformity | prompt rule; `burstiness` metric | ✅ Done |
| Eliminate colon-heavy inline lists | prompt rule; `colonListPatterns` metric | ✅ Done |
| Humanize button replaces draft content | `handleHumanize` in draft-generator page | ✅ Done |
| Confidence reflects humanization status | blended score (grounding 65% + reads-human 35%) + badge | ✅ Done |
| Gate sequence (tsc → build → lint → test) | — | ⛔ Blocked — command execution denied |

### Files

New:

- **`src/lib/agents/humanizer-agent.ts`** — banned-vocabulary tables; the
  deterministic transforms `stripEmDashes` / `replaceAiVocabulary` /
  `enforceHumanization` (the hard safety net: zero em dashes, zero banned vocab
  guaranteed); text analysis `analyzeHumanization` + `computeHumanizationScore`;
  the specialized `buildHumanizerPrompt`; and the `runHumanizer` orchestrator
  (specialized Claude call → enforcement → metrics).
- **`src/app/api/ai/humanize/route.ts`** — `POST` handler. requireRole("writer"),
  session auth, org derived from profile, per-minute burst limit + daily
  `api_calls` quota, `agent_runs` logging (agent_type `narrative_drafting`,
  `pass: "humanize"`, token tracking), grounding-data load (org + top-12 KB +
  top-5 proven), `runHumanizer`, blended confidence, append humanized
  `draft_versions` row (`source = "humanized"`, `humanization_status =
  "humanized"`).

Changed:

- **`src/types/ai.ts`** — adds `HumanizeResult` (content, confidenceScore,
  humanizationStatus, sources, savedVersion, humanizationScore).
- **`src/app/(dashboard)/draft-generator/page.tsx`** — `Humanize` button in the
  "Review & edit" card header (writer+), `handleHumanize` that calls the endpoint
  and replaces editor content + sources + confidence, a humanization-status badge
  on the Confidence card, and `humanizationStatus` threaded through
  generate/revert/load-version.

### Design decisions / notes

- **Two layers, not one.** The Claude pass handles everything semantic (rhythm,
  voice, contractions, grounding vague claims, de-parallelizing lists). A
  deterministic post-pass enforces only the two *mechanical, absolute* rules
  ("replace ALL em dashes", "strip AI vocabulary") so they can never leak,
  whatever the model returns. Inherently semantic rules (sentence variance,
  contractions, formality) are left to the model and only *measured*
  deterministically — blind regex rewrites there would damage grammar.
- **No new `agent_type` enum.** Humanization is narrative drafting's second pass,
  so it logs under `narrative_drafting` (distinguished by `input_params.pass`).
  Adding an enum value would force a migration + `database.ts` regeneration, which
  is unnecessary and (gate-blocked) risky this session.
- **Append-only history.** Humanizing creates a NEW version (`source =
  "humanized"`); the original draft is never mutated — same as generate/revert.
- **Confidence is honest.** It blends grounding (KB/proven coverage, unresolved
  `[NEEDS INPUT]` gaps) at 65% with the reads-human score at 35%, so a slick but
  ungrounded draft cannot score high. The en dash (–) is intentionally NOT
  stripped, so numeric/date ranges survive.

### Static audit performed this session (read-only)

- Inventory: routes **35** (+1 `api/ai/humanize`), agents **22** (+1
  `humanizer-agent.ts`), pages 39, components 74, migrations 10.
- All imports in the new/changed files resolve; the humanize route mirrors
  `/api/ai/draft` column-for-column for `organizations`, `knowledge_base`,
  `proven_narratives`, `agent_runs`, and the `draft_versions` insert.
- `agent_type` value (`narrative_drafting`), `humanization_status` value
  (`humanized`), and Badge colors all type-check against existing unions.
- `callClaude` accepts the `temperature` option used by `runHumanizer`.

### Blockers (need user action)

1. **Command execution denied** — `npx tsc` / `pnpm tsc/build/lint` and
   `npx playwright test` return "requires approval" via both Bash and PowerShell.
   The gate sequence could not be executed. Per Iron Law 3, no gate is claimed as
   passing.
2. **Migration 009 not yet confirmed applied** to the remote Supabase project —
   the humanizer's `draft_versions` insert and the history panel assume it exists.

### To resume / hand off

1. Approve and run, in order: `pnpm tsc --noEmit` → `pnpm build` → `pnpm lint` →
   `npx playwright test --reporter=list`. Report actual results; fix any fallout.
2. Browser smoke test: Draft Generator → generate a draft → click **Humanize** →
   confirm the content changes (no em dashes, no AI vocab, varied sentence
   lengths, contractions), a new "Humanized" version appears in history, the
   Confidence card badge reads "Humanized" and the score updates → confirm a
   viewer role sees no Humanize button.
3. Nothing was committed this session; the working tree also still holds prior
   navigation-state, KB-detail, and draft-versions work. Commit when gates pass.
