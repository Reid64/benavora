# CROSS-WIRING REPORT (2026-09-15)

Phase 0 audit deliverable 5 of 5. Traces: scheduled job → orchestrator → `agent_runs` → UI →
monitoring, for both the legacy and PIL systems.

## 1. Job triggers orchestrator?

| System | Answer | Evidence |
|---|---|---|
| Legacy | **Mostly yes.** 12 of 13 `worker/scheduler.ts` jobs genuinely call into `worker/autonomous-orchestrator.ts` or `worker/autoapply-autonomous-orchestrator.ts`. One (`self-improvement-agent`/AG-38) is scheduled but never actually fires in practice — see `LEGACY_AGENT_STATUS.md` §A. | `SCHEDULING_AUDIT.md` §2 |
| PIL | **No.** Zero callers of `orchestrateResearchRun()`/`pollAndOrchestratePendingRuns()` anywhere in `src/` or `worker/`, confirmed by two independent passes this session. Neither manual-trigger route (`/api/pil/research`, `/api/pil/discover`) calls the orchestrator either — they only insert a row that then sits forever. | `PIL_WIRING_AUDIT.md` §2, §5 |

## 2. Orchestrator populates agent_runs?

| System | Answer |
|---|---|
| Legacy | **Yes**, reliably, for every job that actually fires. 61,122 real rows across 71 distinct `agent_type` values confirms this end of the pipe works. |
| PIL | **Only once, synthetically.** All 38 `pil_agent_runs` rows trace to a single 2026-09-09 test burst whose own data says "synthetic prospect, not a real research target." Never populated by a real, automatic trigger. |

## 3. Is agent_runs visible in Dashboard / Analytics / Audit Log?

Grepped `src/app/**/*.tsx` and imported hooks/lib files for `agent_runs` queries. **4 real UI
surfaces found** (4 other grep hits were false positives — type defs, a comment, a doc mention):

| Page | What it queries | Would it ever catch the AG-29 pattern (status=completed, items_processed=0)? |
|---|---|---|
| `outcomes/analytics/page.tsx` | `agent_type, status, created_at, items_found` only | **No — structurally can't.** `items_processed` and `error_message` aren't even in the select list, so the mismatch isn't fetched, let alone shown. |
| `research/page.tsx` (RunHistory) | `items_found, items_processed, error_message` | **No — filtered out.** Query is scoped `.in("agent_type", RESEARCH_AGENT_TYPES)`; `ag-29-knowledge-indexer` isn't a research agent type, so it's excluded from this view regardless of what columns it selects. |
| `admin/orgs/[id]/page.tsx` → `OrgDetailTabs.tsx` | `items_found`, `items_processed` as separate table columns, per run | **Only place a human *could* spot it** — but there's no computed mismatch flag, no color coding, no sort/filter for "found ≠ processed while status=completed." Finding it among thousands of ag-29 rows requires already knowing to look, and the view is per-org and paginated. |
| `admin/improvements/ImprovementsClient.tsx` | Static text referencing `agent_runs` | Not a real query — informational copy only. |

**Net: no, not in any actionable sense.** One admin sub-tab has the right raw numbers on screen
with zero interpretation layered on top; every other surface either omits the relevant columns or
filters the offending agent out entirely.

## 4. Do errors propagate to monitoring?

- **No Sentry integration anywhere.** Two grep hits for "sentry" were unrelated coincidental
  string matches, not the SDK — confirmed by opening both.
- **`alerts` table (1,735 real rows, genuinely active) is opt-in, not a global failure hook.**
  Written via `AutonomousBase.createNotification()` — each agent's own code must explicitly call
  it. `KnowledgeIndexerAgent extends AutonomousAgent` (a *different* base class than
  `AutonomousBase`) and never calls `.from("alerts")` anywhere in its file — confirmed zero path
  from AG-29's failures to the one alerting mechanism that exists.
- **`automation_notifications` is empty (0 rows)** — a second, apparently-dead notification system
  that isn't wired to anything either (consistent with prior project memory on two disjoint
  notification systems).

## 5. Net conclusion — the platform is structurally blind to silent agent failure

Tracing the full chain for the worst case found this session: `ag-29-knowledge-indexer` runs
every ~60 seconds → writes a `status='completed'` row with the real failure buried in a text
summary field → no UI page both fetches the right columns and includes this agent type → no
alerting mechanism is wired to this agent's code path → nothing pages anyone. Every link in the
chain except the very first (the job actually running) is either missing or filtered in a way
that would hide exactly this failure mode. This is not specific to AG-29 — any other legacy agent
that started reporting fake-completions tomorrow would be equally invisible, since the gap is
structural (missing columns, agent-type filtering, opt-in-only alerting) rather than particular to
one agent's code.

For PIL, the equivalent chain is simpler to state: it never starts, so there's nothing to observe
yet — but the same missing-monitoring gap would apply the moment it's wired up, since PIL has no
alerting path of its own either (checked `pil_monitoring_events`/`pil_monitoring_subscriptions`:
both real tables, both empty, no code found writing to them from an agent failure).
