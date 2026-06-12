# STATE OF THE BUILD — Benavora

_Generated from a live codebase audit on 2026-06-12._

## Overview

Benavora is a multi-tenant nonprofit grant/fundraising platform. Every table is
organization-scoped with Row Level Security; `organization_id` is always derived
server-side from the authenticated session, never from a request body.

**Stack (locked):** Next.js 14 (App Router, TypeScript strict) · Supabase
(Postgres + Auth + RLS) · Tailwind CSS · Playwright · pnpm · Vercel.

## Codebase inventory (audited 2026-06-12)

| Area | Count | Notes |
| --- | --- | --- |
| App pages (`page.tsx`) | 39 | No new pages this session |
| API routes (`route.ts`) | 35 | +1 this session: `api/ai/humanize` |
| React components (`.tsx`) | 74 | No new components this session |
| Agent modules (`src/lib/agents/*.ts`) | 22 | +1 this session: `humanizer-agent.ts` |
| SQL migrations | 10 | `001`–`009` (incl. two `002_*` files) |
| AI routes | 5 | draft, **humanize**, review, summarize, fit-analysis |

## Feature areas (implemented)

- **Auth & onboarding** — registration, org bootstrap (`register_organization`),
  invitations, multi-step onboarding wizard, role gates (owner/admin/writer/viewer).
- **Opportunities & applications** — CRUD, pipeline board with stage transitions,
  pipeline history timeline.
- **Knowledge base** — org profile, narratives (list + detail view), answers,
  proven-narrative scoring.
- **Draft generator** — grounded AI drafting via `/api/ai/draft`, **two-pass
  humanization via `/api/ai/humanize`**, confidence scoring, source transparency,
  draft version history, `?opportunity=` deep link.
- **AI agents** — research (corporate/foundation/government/local), eligibility,
  deadline extraction, summary, review, recursive learning, cold outreach,
  **humanizer**.
- **Automation** — browser form-fill sessions with human approval workflow.
- **Integrations** — Google (Gmail + Calendar), Stripe billing + usage metering.
- **Admin** — audit log, usage dashboard.

## This session — AI Humanizer Agent (Six Laws status)

Feature: a second AI pass that rewrites a generated draft so it reads like an
experienced human grant writer wrote it, not a language model — defeating the
statistical fingerprints AI-detection tools key on, while staying grounded in the
organization's verified data (BEHAVIORAL_CONTRACTS §9).

The humanizer runs two layers in sequence:

1. **A specialized Claude call** (separate from the drafting pass, its own
   system prompt and a higher temperature for rhythm) that does the semantic
   rewrite: removes em dashes, drops AI vocabulary, injects dramatic
   sentence-length variance (short next to long), adds natural contractions,
   breaks perfect paragraph/list parallelism, varies formality and sentence
   starters, reduces burstiness uniformity, eliminates colon-led inline lists,
   and replaces vague claims with specific numbers/names/dates/locations pulled
   ONLY from the Knowledge Base and org profile. It mirrors the voice of the
   org's proven narratives.
2. **A deterministic enforcement net** (`enforceHumanization`) that GUARANTEES
   zero em dashes and zero banned vocabulary survive, regardless of model output.

`analyzeHumanization` then measures the result (sentence-length std dev /
burstiness, dramatic variance, repeated starters, colon-list count, contraction
count, surviving em dashes / banned words) and `computeHumanizationScore` turns
that into a 0-100 "reads human" score.

1. **SCHEMA** — ✅ No new tables/columns. Uses the existing `humanization_status`
   enum and `source` column on `draft_versions` (migration 009), and `agent_runs`
   for run logging. All reads/writes RLS-scoped (org isolation, migrations 001/009).
2. **API** — ✅ New route `POST /api/ai/humanize`. Authenticates via session,
   derives `organization_id` from the profile (never the body), enforces the
   per-minute burst limit + daily `api_calls` quota, logs to `agent_runs`
   (agent_type `narrative_drafting`, `input_params.pass = "humanize"`) with token
   tracking, and appends the humanized output as a new `draft_versions` row.
3. **UI** — ✅ Draft Generator gains a **Humanize** button (writer+; in the
   "Review & edit" card header) that calls the endpoint and replaces the editor
   content with the humanized draft. A humanization-status badge appears on the
   Confidence card; the confidence score is recomputed to reflect humanization.
4. **DATA** — ✅ Real, org-scoped queries, no mocks. Grounding pulls the org
   profile, the most-trusted Knowledge Base entries (`is_proven` first, up to 12),
   and proven narratives for the opportunity's funder category (up to 5) as voice
   samples. Sources are recorded in the same `{ id, kind, title }` shape
   `/api/ai/draft` uses, so narrative usage-history queries match humanized
   versions too.
5. **WIRING** — ✅ Humanize button → `/api/ai/humanize` → new humanized version
   in the history panel (which already badges `humanization_status`) → editor +
   confidence reflect it. Role-gated to `canEdit` (viewers cannot humanize).
6. **VERIFICATION** — ⚠️ **Unverified at runtime.** The quality gates (`tsc`,
   `build`, `lint`, Playwright) could **not** be executed this session: `npx tsc`
   / `pnpm` return "requires approval" under both the Bash and PowerShell tools in
   this non-interactive session. Per Iron Law 3, **no gate is claimed as passing.**
   A read-only static type/reference audit was completed (below).

## Files implementing this feature

New:

- `src/lib/agents/humanizer-agent.ts` — the agent: banned-vocabulary tables,
  deterministic transforms (`stripEmDashes`, `replaceAiVocabulary`,
  `enforceHumanization`), text analysis (`analyzeHumanization`,
  `computeHumanizationScore`), the specialized prompt builder
  (`buildHumanizerPrompt`), and the `runHumanizer` orchestrator.
- `src/app/api/ai/humanize/route.ts` — the endpoint: auth, rate/quota limits,
  grounding-data load, `runHumanizer`, blended confidence, version persistence,
  `agent_runs` logging.

Changed:

- `src/types/ai.ts` — adds the `HumanizeResult` response type.
- `src/app/(dashboard)/draft-generator/page.tsx` — Humanize button + handler,
  active humanization-status badge, status threaded through generate/revert/load.

## Static audit performed this session (read-only)

- Inventory: routes **35** (+1), agents **22** (+1), pages 39, components 74,
  migrations 10 — consistent with the two new files.
- Every import in the new/changed files resolves (`@/lib/ai/claude`,
  `@/lib/agents/humanizer-agent`, `@/lib/auth/role-gate`, `@/lib/billing/*`,
  `@/lib/supabase/server`, `@/types/ai`, `@/types/database`, the `ui` barrel).
- The humanize route mirrors `/api/ai/draft` exactly for auth, org derivation,
  rate limiting, quota enforcement, `agent_runs` logging, and the
  `draft_versions` insert shape — all column names match the columns the draft
  route already reads/writes (`organizations.*`, `proven_narratives.*`,
  `knowledge_base.*`, `draft_versions.*`).
- `agent_type` stays a valid enum value (`narrative_drafting`); no DB enum change
  was required, so no migration and no `database.ts` regeneration is needed.
- `HumanizeResult.savedVersion.humanizationStatus` is `"humanized"`, a member of
  the `HumanizationStatus` union and the DB `humanization_status` enum.
- Badge colors used (`gray`/`green`/`yellow`/`red`) are members of `BadgeColor`.

## Governance / design notes

- **No new `agent_type`.** Humanization is the second pass of narrative drafting,
  so it logs under `narrative_drafting` (with `input_params.pass = "humanize"`)
  rather than adding an enum value that would force a migration + type regen.
- **Append-only history preserved.** Humanizing creates a NEW `draft_versions`
  row (`source = "humanized"`), never mutating the original — same discipline as
  generate and revert.
- **Grounding is never relaxed.** The humanizer may only substitute a specific
  fact that is present in the supplied data; the system prompt forbids inventing
  numbers, and `[NEEDS INPUT: …]` placeholders are preserved verbatim. Confidence
  blends grounding (65%) with the reads-human score (35%) so a slick but
  ungrounded draft cannot score high.

## Other in-flight work in the working tree (prior sessions, uncommitted)

- **Knowledge Base detail views** — `knowledge-base/narratives/[id]`,
  `NarrativeDetail`, `MarkdownContent`.
- **Navigation State Preservation** — URL-encoded list filters/search/sort/tabs +
  sidebar section memory (`useUrlState.ts`, `src/lib/navigation/`).
- **Draft Persistence & Version History** — `009_draft_versions.sql`,
  `DraftsHistoryPanel.tsx`, `diff.ts`, draft route/page + types. This session's
  humanizer builds directly on it.

## Outstanding / next steps

1. **Run the full gate sequence** and report actual results:
   `pnpm tsc --noEmit` → `pnpm build` → `pnpm lint` → `npx playwright test`.
   (Blocked this session on command-execution approval.)
2. **Confirm `009_draft_versions.sql` is applied** to the remote project so the
   humanized version inserts and the history panel resolve against real data.
3. **Smoke-test the Humanizer** in the browser: generate a draft → click
   Humanize → confirm the content visibly changes (no em dashes, no AI vocab,
   varied rhythm, contractions), a new "Humanized" version appears in history, and
   the confidence/badge update. Verify a viewer cannot humanize.
