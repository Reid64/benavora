# PIL Rollout Schedule

**Date:** 2026-09-01
**Source task:** `queue-feature-flags-pil-rollout-REAL.yaml`, id `rollout-schedule`
**Status:** Drafted. **Not yet executable** — see §5 for what's blocking an actual Phase 1 start.

---

## 1. Grounding this plan in the real flags (not the sketch's names)

The source task's prompt describes a `pil-enabled` boolean flag. That flag does not exist under
that name. What's actually implemented, live in this repo:

| Sketch name | Real flag key | File | Type | Fallback |
|---|---|---|---|---|
| `pil-enabled` | `pil-prospect-intelligence-layer` | `src/lib/feature-flags/pil.ts` (`PIL_ROLLOUT_FLAG_KEY`) | boolean, org-scoped | `false` (fail closed) |
| `pil-autoapply-source` | `pil-autoapply-source` | `src/lib/autoapply/queue-populator.ts` (`AUTOAPPLY_SOURCE_FLAG_KEY`) | string (`"prospects"` \| `"dossiers"`), org-scoped | `"prospects"` (old path) |

Both are evaluated per-**organization**, not per-user (`pilOrgContext(organizationId)` /
`autoapplySourceContext(organizationId)`) — every teammate at one org sees the same state, by
design (see `pil.ts` header comment). Any rollout mechanics below (percentages, canary lists) are
therefore org-level, not user-level.

The sketch's three other flags — `pil-dossier-ui`, `pil-agent-family-strictness`,
`pil-max-concurrent-runs` — have **no code implementation anywhere in this repo**. They're out of
scope for this schedule; standing them up would be separate follow-up work, not part of executing
the schedule below.

Per-variant metrics already exist and are wired into both branches of
`populateSubmissionQueue()`: `benavora_autoapply_source_run_total{source, outcome}` and
`benavora_autoapply_source_run_duration_ms{source}` (`src/lib/observability/flag-metrics.ts`).
`outcome` is `success | error | skipped` — `skipped` (org has no PIL research data yet) is
deliberately excluded from error-rate math so onboarding gaps don't trip a false rollback (see that
file's own deviation notes).

## 2. What "rollout percentage" actually means here

Per `ld-client.ts`'s header comment: **targeting and rollout percentage live entirely in the
LaunchDarkly dashboard**, not in this codebase. This repo only reads whatever LaunchDarkly returns
for a given org context and fails closed (`false` / `"prospects"`) if LD is unreachable or the flag
is unset. Nothing here can set "10% rollout" from code — that's a LaunchDarkly console action
(percentage rollout rule, or a targeting rule against an org-key segment), requires a LaunchDarkly
account with write access, and isn't something this session has credentials for (`.env.local`
carries a placeholder `LAUNCHDARKLY_SDK_KEY`, which is a **server SDK key** for flag *evaluation*
only — not a Dashboard/Management API token that could create segments or targeting rules).

## 3. Phases (as designed — pending §5's blockers)

**Phase 1 — Canary (Week 1–2)**
- Target: a **named list** of specific pilot orgs (not a blind 10%) via an LD org-key targeting
  rule — safer than a percentage rollout when the "population" is small enough to hand-pick.
- `pil-prospect-intelligence-layer` → `true` for that org list only.
- Daily review of `benavora_autoapply_source_run_total{source="dossiers"}` error rate and
  `benavora_autoapply_source_run_duration_ms` p95, plus dossier completion rate off
  `pil_prospect_dossiers`.
- Exit: error rate < 1%, p95 latency < 2s, > 90% dossier completion, sustained across the full
  window (not a single good day).

**Phase 2 — Canary Expansion (Week 3–4)**
- Expand the named org list (still explicit membership, not a percentage — see §5.2 on why a
  percentage doesn't make sense yet).
- `pil-autoapply-source` → `"dossiers"` for the same expanded list, gated behind Phase 1 already
  being green for those orgs.
- Watch: DB load / agent queuing via `pil_agent_runs` and `AgentRunner`'s existing budget/policy
  checks, not just the flag-outcome counters.
- Exit: error rate < 0.5%, no capacity-driven policy denials trending up.

**Phase 3 — General Availability**
- Switch from an explicit org list to an actual LD percentage rollout rule, once §5.1 is resolved
  and the real org count is known.
- Exit: error rate < 0.1%. (Customer-satisfaction-score exit criteria dropped here — see §5.3.)

**Phase 4 — Full Rollout**
- 100% rollout on both flags. Old `populateFromProspects` path kept in code as the fallback
  (already true today via the flag default) rather than deleted — the rollback path in §4 depends
  on it still existing.

## 4. Rollback plan (unchanged from the sketch — this part is accurate as written)

- Trigger: `error_rate > 5%` OR `p95 latency > 5s`, read off the metrics in §1.
- Action: set `pil-autoapply-source` back to `"prospects"` in LaunchDarkly for the affected org(s)
  or globally. This is a **flag change only** — no deploy, no migration — because the old
  `populateFromProspects` path is still live code, exactly so this rollback stays a config change.
- Notify Reid + support team; post-mortem within 24h; fix before re-enabling.
- Note: `pil-prospect-intelligence-layer` itself already fails closed on any LD outage (§1), so the
  autoapply-source flag is the one that needs an explicit manual revert — the UI-gating flag
  reverting itself is not a substitute for that.

## 5. What's blocking actual execution

1. **No LaunchDarkly write access from this session.** I can't create the org-targeting
   rule/segments, set a rollout percentage, or flip either flag. That needs either LaunchDarkly
   dashboard access handed to me (a Management API token, or you doing the console steps directly
   from this plan) or an LD MCP connector, which isn't currently connected.
2. **No confirmed beta/pilot org list.** The sketch says "5 orgs max" for canary and "500+ orgs"
   for GA. I have no live read on the actual organization count or who your beta customers are —
   the Supabase project this platform actually runs on (`vbjplpquqxxfbpazyalt`, per
   `PIL_MIGRATION_PLAN.md`) isn't reachable through the Supabase connector available in this
   session (it's scoped to an unrelated account/org). If the platform is still pre-launch, "500+
   customers" may be a stale/aspirational number rather than a real one worth planning Phase 3
   around — worth confirming before I bake it into anything further.
3. **No support team or notification channel identified.** "Notify Reid + support team" in the
   rollback plan and "support team briefed" in Phase 3 both assume a channel (Slack, email list,
   PagerDuty) I don't have. I can wire an actual notification (e.g., an alert that posts somewhere)
   once you tell me where it should go.
4. Customer-satisfaction (">4.5/5") as a Phase 3 exit criterion has no data source anywhere in this
   codebase — dropped from §3 above rather than left as an unmeasurable gate. If you have a CSAT
   pipeline elsewhere, tell me and I'll wire it back in as a real check.

**Bottom line:** the schedule and rollback mechanics are grounded in real, already-shipped flags
and metrics, so they're accurate as documentation. Actually *executing* Phase 1 needs one of: (a)
LaunchDarkly access for me, or (b) you doing the LD console steps from §3 yourself using this doc,
plus (c) a real pilot org list from you instead of a guessed one.
