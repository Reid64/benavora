// HARD LIMIT: This agent NEVER modifies production code, prompts, configs, or database schema.
// It ONLY creates improvement_proposals records requiring explicit human approval.
// Any proposal of type 'code_change' or 'schema_change' is automatically rejected before insertion.
//
// AG-38 Self-Improvement Agent (AUTONOMOUS_PLATFORM_VISION.md Phase 4,
// "Autonomous Continuous Improvement Engine" -- the vision doc's own
// numbering calls this AG-36; AGENTS_v2.md section 5's Phase 2-5 spec
// assigns it AG-38 instead and documents the collision in its own
// Numbering note. This file follows AGENTS_v2.md's AG-38 spec).
//
// 2026-07-20 enterprise hardening pass: full 6-metric calculation engine
// (success_rate, avg_confidence_score, avg_items_processed, review_rate,
// auto_approval_rate, error_rate -- migration 100 adds the runs_failed
// column error_rate needs for its 7-day rollup), exact-threshold
// underperformance detection with structured Finding objects, a >=300-word
// proposal-generation system prompt with explicit acceptable/forbidden
// proposal types, proposal deduplication (same proposal_type + affected
// agent within 30 days; a rejected match suppresses re-proposing for 90
// days -- migration 100 adds improvement_proposals.affected_agent_id),
// confidence-score filtering (>=70, with every rejection logged), immediate
// (not digest-gated) platform-owner escalation when an agent's 7-day
// success rate drops below 50% or its error rate exceeds 40%, and a
// deterministic (no Claude call -- nothing to hallucinate in a metrics
// report) weekly performance report stored as
// proposal_type='performance_report' (migration 100 also widens that CHECK
// constraint) every Sunday.
//
// BEHAVIORAL_CONTRACTS.md section 34 (Autonomous Agent Contracts) and
// section 35 (Autonomous Configuration Contracts) are the applicable
// governance sections for this agent -- the task's requested "sections
// 16-17" don't cover this topic in governance/BEHAVIORAL_CONTRACTS.md
// (section 17 there is Grants.gov Integration Contracts, unrelated; there
// is no section 16 in that file at all, only a note that v1.0 sections
// 1-16 are "unchanged" and were never actually carried into this v2.0
// document -- see project memory on governance docs missing v1 sections).
// Section 34's hard limits are what AUTONOMOUS_HARD_LIMITS and this file's
// own HARD LIMIT comment above encode in TypeScript.
//
// Platform-wide, not org-scoped: this is the first agent in the codebase
// whose run genuinely spans every organization rather than looping per-org
// like every AutonomousAgent subclass (src/lib/agents/autonomous-base.ts).
// AutonomousAgent's constructor requires a non-null orgId and every method
// (logDecision, queueChainedAgent, getOrgConfig, createNotification) scopes
// itself to `this.orgId` -- none of that fits a run with no owning org, so
// this class does not extend it. Instead it keeps its own minimal
// startRun/completeRun/failRun against agent_runs with
// organization_id = null (migration 088_self_improvement_agent.sql loosens
// agent_runs.organization_id's NOT NULL constraint for exactly this case,
// and adds 'ag-38-self-improvement' to the agent_type enum per the
// precedent in AGENTS_v2.md section 1.2 / 086_strategic_advisor.sql).
//
// "yesterday" / the trailing 7-day window below are computed on UTC
// calendar days; the weekly-report gate uses America/Chicago instead
// (matching worker/scheduler.ts and worker/autonomous-orchestrator.ts's own
// isSundayChicago() convention for "weekly" cadence) since a human platform
// owner reads that report and "Sunday" should mean their own calendar day,
// not UTC's.
//
// human_verdict (not "review_outcome") is the real column on agent_decisions
// (migration 080_autonomous_agent_infrastructure.sql) -- SCHEMA_REGISTRY_v2.md
// documents a "review_outcome" column that was never actually applied;
// trust the migration over the doc, per this codebase's own established
// practice of flagging doc/schema drift.

import type { SupabaseClient } from "@supabase/supabase-js";

import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

export interface AutonomousAgentResult {
  success: boolean;
  itemsFound: number;
  itemsProcessed: number;
  itemsQueued: number;
  decisions: string[];
  nextActions: string[];
  errors: string[];
}

const AGENT_ID = "ag-38-self-improvement";
const MAX_TOKENS = 1800;

// --- underperformance thresholds (exact, per this task's spec) -------------
const CRITICAL_SUCCESS_RATE_THRESHOLD = 0.75; // success_rate < 75% (7d) -> CRITICAL
const LOW_CONFIDENCE_THRESHOLD = 60; // avg_confidence_score < 60 -> LOW confidence concern
const HIGH_REVIEW_RATE_THRESHOLD = 0.4; // review_rate > 40% -> HIGH human review burden
const HIGH_ERROR_RATE_THRESHOLD = 0.2; // error_rate > 20% -> RELIABILITY concern

// --- immediate-escalation thresholds (stricter than the above; page the
// platform owner now rather than waiting for a proposal or the digest) -----
const ESCALATION_SUCCESS_RATE_THRESHOLD = 0.5; // success_rate < 50% (7d)
const ESCALATION_ERROR_RATE_THRESHOLD = 0.4; // error_rate > 40% (7d)

// --- proposal generation / filtering ----------------------------------------
const MIN_CONFIDENCE_TO_PROPOSE = 70;
const HIGH_PERFORMING_MIN_CONFIDENCE = 85;
const DEDUP_LOOKBACK_DAYS = 30;
const REJECTED_COOLDOWN_DAYS = 90;

const METRICS_LOOKBACK_DAYS = 7;
const PATTERNS_LOOKBACK_DAYS = 30;
const MAX_PATTERN_ROWS = 2000;
const MAX_RUN_ROWS = 20000;
const MAX_DEDUP_CANDIDATES = 5;

const PROPOSAL_TYPES = [
  "prompt_optimization",
  "agent_threshold",
  "workflow_change",
  "ui_improvement",
  "data_quality",
] as const;
type ProposalType = (typeof PROPOSAL_TYPES)[number];

// Never insertable, regardless of what Claude returns -- HARD LIMIT.
const FORBIDDEN_PROPOSAL_TYPES = ["code_change", "schema_change", "permission_change"] as const;

const RISK_LEVELS = ["low", "medium", "high"] as const;
type RiskLevel = (typeof RISK_LEVELS)[number];

function isProposalType(value: unknown): value is ProposalType {
  return (
    typeof value === "string" &&
    (PROPOSAL_TYPES as readonly string[]).includes(value)
  );
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return (
    typeof value === "string" && (RISK_LEVELS as readonly string[]).includes(value)
  );
}

interface RawProposal {
  proposal_type?: unknown;
  title?: unknown;
  description?: unknown;
  evidence?: unknown;
  expected_impact?: unknown;
  risk_level?: unknown;
  confidence_score?: unknown;
  affected_agent_id?: unknown;
}

interface ValidatedProposal {
  proposal_type: ProposalType;
  title: string;
  description: string;
  evidence: string;
  expected_impact: string;
  risk_level: RiskLevel;
  confidence_score: number;
  affectedAgentId: string;
}

type ValidationResult =
  | { ok: true; proposal: ValidatedProposal }
  | { ok: false; reason: string };

interface AgentMetricRow {
  agent_id: string;
  runs_total: number;
  runs_successful: number;
  runs_failed: number;
  avg_confidence_score: number | null;
  avg_items_processed: number | null;
  decisions_requiring_review: number;
  decisions_auto_approved: number;
  // Derived percentages (0-100). Not persisted -- agent_performance_metrics
  // stores the raw counts these are computed from; recomputing on read keeps
  // one source of truth per Core Data Principle #3 (SCHEMA_REGISTRY_v2.md
  // section 4.2: scoring/rate data is derived, never a duplicated column).
  success_rate: number | null;
  review_rate: number | null;
  auto_approval_rate: number | null;
  error_rate: number | null;
}

type FindingCategory = "CRITICAL" | "LOW_CONFIDENCE" | "HIGH_REVIEW_BURDEN" | "RELIABILITY";

interface Finding {
  category: FindingCategory;
  metric: "success_rate" | "avg_confidence_score" | "review_rate" | "error_rate";
  value: number;
  threshold: number;
  evidence: string;
}

interface UnderperformingAgent {
  agentId: string;
  runsTotal: number;
  successRate: number | null; // fraction 0-1
  avgConfidenceScore: number | null;
  reviewRate: number | null; // fraction 0-1
  errorRate: number | null; // fraction 0-1
  findings: Finding[];
}

interface HighPerformingPattern {
  agentId: string;
  decisionType: string;
  occurrences: number;
  avgConfidenceScore: number;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** UTC-calendar-day range, `daysAgo` days back from today. See file header
 * for why UTC (not America/Chicago) is used here for the metrics window. */
function utcDayRange(
  daysAgo: number,
): { startISO: string; endISO: string; dateKey: string } {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo),
  );
  const end = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysAgo + 1,
    ),
  );
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    dateKey: start.toISOString().slice(0, 10),
  };
}

/** Mirrors worker/autonomous-orchestrator.ts's isSundayChicago() -- the
 * weekly report should land on the platform owner's own Sunday, not UTC's.
 * Duplicated locally rather than imported: src/lib/ must not depend on
 * worker/, and the check is 4 lines. */
function isSundayChicago(): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  }).format(new Date());
  return weekday === "Sun";
}

/** Best-effort JSON array extraction - mirrors the parse-then-regex-fallback
 * convention in strategic-advisor-agent.ts / simulation-agent.ts. Claude is
 * asked for JSON-only output but occasionally wraps it in prose or a
 * markdown fence. */
function parseProposalArray(text: string): RawProposal[] {
  const tryParse = (candidate: string): RawProposal[] | null => {
    try {
      const parsed: unknown = JSON.parse(candidate);
      return Array.isArray(parsed) ? (parsed as RawProposal[]) : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(text.trim());
  if (direct) return direct;

  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    const fromMatch = tryParse(match[0]);
    if (fromMatch) return fromMatch;
  }

  throw new Error("Claude did not return a parseable improvement-proposal JSON array.");
}

/** Validates and coerces one raw Claude proposal. Never throws - returns a
 * discriminated result so every rejection (forbidden type, invalid type,
 * missing field) carries a specific reason the caller logs, instead of a
 * proposal silently vanishing (matches "never fabricate a field it can't
 * extract" convention used throughout AGENTS_v2.md, extended here to "never
 * drop a rejection without saying why"). */
function validateProposal(raw: RawProposal): ValidationResult {
  // HARD LIMIT enforcement: forbidden types are rejected before anything
  // else, even before checking whether the type string is otherwise
  // well-formed.
  if (
    typeof raw.proposal_type === "string" &&
    (FORBIDDEN_PROPOSAL_TYPES as readonly string[]).includes(raw.proposal_type)
  ) {
    return {
      ok: false,
      reason: `forbidden proposal_type "${raw.proposal_type}" rejected before insertion -- HARD LIMIT (code_change/schema_change/permission_change are never permitted)`,
    };
  }
  if (!isProposalType(raw.proposal_type)) {
    return { ok: false, reason: `unrecognized proposal_type "${String(raw.proposal_type)}"` };
  }
  if (typeof raw.title !== "string" || raw.title.trim() === "") {
    return { ok: false, reason: "missing or empty title" };
  }
  if (typeof raw.description !== "string" || raw.description.trim() === "") {
    return { ok: false, reason: "missing or empty description" };
  }
  if (typeof raw.evidence !== "string" || raw.evidence.trim() === "") {
    return { ok: false, reason: "missing or empty evidence" };
  }

  const expected_impact =
    typeof raw.expected_impact === "string" && raw.expected_impact.trim() !== ""
      ? raw.expected_impact.trim()
      : "Not specified.";

  const risk_level = isRiskLevel(raw.risk_level) ? raw.risk_level : "medium";

  const confidenceRaw = Number(raw.confidence_score);
  const confidence_score = Number.isFinite(confidenceRaw)
    ? Math.min(100, Math.max(0, Math.round(confidenceRaw)))
    : 50;

  const affectedAgentId =
    typeof raw.affected_agent_id === "string" && raw.affected_agent_id.trim() !== ""
      ? raw.affected_agent_id.trim()
      : "platform";

  return {
    ok: true,
    proposal: {
      proposal_type: raw.proposal_type,
      title: raw.title.trim(),
      description: raw.description.trim(),
      evidence: raw.evidence.trim(),
      expected_impact,
      risk_level,
      confidence_score,
      affectedAgentId,
    },
  };
}

export class SelfImprovementAgent {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** Opens a platform-level agent_runs row (organization_id = null; see
   * migration 088_self_improvement_agent.sql). Mirrors
   * AutonomousAgent.startRun() but deliberately does not scope to an org. */
  private async startRun(triggerSource: TriggerSource): Promise<string> {
    const { data, error } = await this.supabase
      .from("agent_runs")
      .insert({
        organization_id: null,
        agent_type: AGENT_ID,
        status: "running",
        trigger_source: triggerSource,
        input_params: {},
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to start AG-38 platform-level run: ${error?.message ?? "no row returned"}`,
      );
    }
    return (data as { id: string }).id;
  }

  private async completeRun(
    runId: string,
    params: {
      outputSummary: string;
      itemsFound: number;
      itemsProcessed: number;
    },
  ): Promise<void> {
    await this.supabase
      .from("agent_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        output_summary: params.outputSummary,
        items_found: params.itemsFound,
        items_processed: params.itemsProcessed,
      })
      .eq("id", runId);
  }

  /** Never throws - a logging failure must never mask the original error
   * the caller is already handling (matches AutonomousAgent.failRun()). */
  private async failRun(runId: string, errorMessage: string): Promise<void> {
    try {
      await this.supabase
        .from("agent_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", runId);
    } catch {
      // Logging failure is swallowed deliberately - see doc comment above.
    }
  }

  /** METRICS CALCULATION ENGINE (step 2 of this task's spec). For every
   * agent_type seen in yesterday's agent_runs, computes all six metrics:
   * success_rate, avg_confidence_score, avg_items_processed, review_rate,
   * auto_approval_rate, error_rate. Upserts the raw counts these are derived
   * from into agent_performance_metrics for yesterday's date
   * (UNIQUE(agent_id, metric_date), migration 087 + 100's runs_failed
   * column). The 7-day rollup underperformance detection reads from these
   * daily rows in identifyUnderperformers() below rather than this method
   * storing a rolling 7-day window under one date -- doing that would
   * double- and triple-count activity across consecutive nightly runs,
   * since this agent runs once per night, not once per week. */
  private async calculateAgentMetrics(): Promise<{
    metricsCalculated: number;
    metricRows: AgentMetricRow[];
  }> {
    const { startISO, endISO, dateKey } = utcDayRange(1);

    const { data: runRows, error: runError } = await this.supabase
      .from("agent_runs")
      .select("agent_type, status, confidence_score, items_processed")
      .gte("created_at", startISO)
      .lt("created_at", endISO)
      .limit(MAX_RUN_ROWS);
    if (runError) {
      throw new Error(`Failed to load yesterday's agent_runs: ${runError.message}`);
    }

    const { data: decisionRows, error: decisionError } = await this.supabase
      .from("agent_decisions")
      .select("agent_id, required_human_review")
      .gte("created_at", startISO)
      .lt("created_at", endISO)
      .limit(MAX_RUN_ROWS);
    if (decisionError) {
      throw new Error(
        `Failed to load yesterday's agent_decisions: ${decisionError.message}`,
      );
    }

    interface RunTally {
      runsTotal: number;
      runsSuccessful: number;
      runsFailed: number;
      confidenceSum: number;
      confidenceCount: number;
      itemsProcessedSum: number;
      itemsProcessedCount: number;
    }
    const runTallies = new Map<string, RunTally>();

    for (const row of (runRows ?? []) as Array<{
      agent_type: string;
      status: string;
      confidence_score: number | null;
      items_processed: number | null;
    }>) {
      const key = row.agent_type;
      const tally = runTallies.get(key) ?? {
        runsTotal: 0,
        runsSuccessful: 0,
        runsFailed: 0,
        confidenceSum: 0,
        confidenceCount: 0,
        itemsProcessedSum: 0,
        itemsProcessedCount: 0,
      };
      tally.runsTotal += 1;
      if (row.status === "completed") tally.runsSuccessful += 1;
      if (row.status === "failed") tally.runsFailed += 1;
      if (row.confidence_score !== null) {
        tally.confidenceSum += row.confidence_score;
        tally.confidenceCount += 1;
      }
      if (row.items_processed !== null) {
        tally.itemsProcessedSum += row.items_processed;
        tally.itemsProcessedCount += 1;
      }
      runTallies.set(key, tally);
    }

    const decisionTallies = new Map<
      string,
      { requiringReview: number; autoApproved: number }
    >();
    for (const row of (decisionRows ?? []) as Array<{
      agent_id: string;
      required_human_review: boolean | null;
    }>) {
      const tally = decisionTallies.get(row.agent_id) ?? {
        requiringReview: 0,
        autoApproved: 0,
      };
      if (row.required_human_review) tally.requiringReview += 1;
      else tally.autoApproved += 1;
      decisionTallies.set(row.agent_id, tally);
    }

    const metricRows: AgentMetricRow[] = [];
    for (const [agentId, tally] of runTallies) {
      const decisions = decisionTallies.get(agentId) ?? {
        requiringReview: 0,
        autoApproved: 0,
      };
      const totalDecisions = decisions.requiringReview + decisions.autoApproved;

      metricRows.push({
        agent_id: agentId,
        runs_total: tally.runsTotal,
        runs_successful: tally.runsSuccessful,
        runs_failed: tally.runsFailed,
        avg_confidence_score:
          tally.confidenceCount > 0
            ? Number((tally.confidenceSum / tally.confidenceCount).toFixed(2))
            : null,
        avg_items_processed:
          tally.itemsProcessedCount > 0
            ? Number(
                (tally.itemsProcessedSum / tally.itemsProcessedCount).toFixed(2),
              )
            : null,
        decisions_requiring_review: decisions.requiringReview,
        decisions_auto_approved: decisions.autoApproved,
        success_rate:
          tally.runsTotal > 0
            ? Number(((tally.runsSuccessful / tally.runsTotal) * 100).toFixed(1))
            : null,
        review_rate:
          totalDecisions > 0
            ? Number(((decisions.requiringReview / totalDecisions) * 100).toFixed(1))
            : null,
        auto_approval_rate:
          totalDecisions > 0
            ? Number(((decisions.autoApproved / totalDecisions) * 100).toFixed(1))
            : null,
        error_rate:
          tally.runsTotal > 0
            ? Number(((tally.runsFailed / tally.runsTotal) * 100).toFixed(1))
            : null,
      });
    }

    if (metricRows.length > 0) {
      const { error: upsertError } = await this.supabase
        .from("agent_performance_metrics")
        .upsert(
          metricRows.map((row) => ({
            agent_id: row.agent_id,
            metric_date: dateKey,
            runs_total: row.runs_total,
            runs_successful: row.runs_successful,
            runs_failed: row.runs_failed,
            avg_confidence_score: row.avg_confidence_score,
            avg_items_processed: row.avg_items_processed,
            decisions_requiring_review: row.decisions_requiring_review,
            decisions_auto_approved: row.decisions_auto_approved,
          })),
          { onConflict: "agent_id,metric_date" },
        );
      if (upsertError) {
        throw new Error(
          `Failed to upsert agent_performance_metrics: ${upsertError.message}`,
        );
      }
    }

    return { metricsCalculated: metricRows.length, metricRows };
  }

  /** UNDERPERFORMANCE DETECTION (step 3 of this task's spec) -- aggregates
   * agent_performance_metrics over the trailing 7 days (inclusive of
   * yesterday) and checks all four exact thresholds independently, so an
   * agent breaching more than one gets a Finding per breach rather than
   * only the first one detected. */
  private async identifyUnderperformers(): Promise<UnderperformingAgent[]> {
    const windowStart = utcDayRange(METRICS_LOOKBACK_DAYS).dateKey;
    const windowEnd = utcDayRange(1).dateKey;

    const { data, error } = await this.supabase
      .from("agent_performance_metrics")
      .select(
        "agent_id, runs_total, runs_successful, runs_failed, avg_confidence_score, decisions_requiring_review, decisions_auto_approved",
      )
      .gte("metric_date", windowStart)
      .lte("metric_date", windowEnd);
    if (error) {
      throw new Error(
        `Failed to load 7-day agent_performance_metrics: ${error.message}`,
      );
    }

    interface Agg {
      runsTotal: number;
      runsSuccessful: number;
      runsFailed: number;
      confidenceWeightedSum: number;
      confidenceWeight: number;
      requiringReview: number;
      autoApproved: number;
    }
    const aggregates = new Map<string, Agg>();

    for (const row of (data ?? []) as Array<{
      agent_id: string;
      runs_total: number;
      runs_successful: number;
      runs_failed: number | null;
      avg_confidence_score: number | null;
      decisions_requiring_review: number | null;
      decisions_auto_approved: number | null;
    }>) {
      const agg = aggregates.get(row.agent_id) ?? {
        runsTotal: 0,
        runsSuccessful: 0,
        runsFailed: 0,
        confidenceWeightedSum: 0,
        confidenceWeight: 0,
        requiringReview: 0,
        autoApproved: 0,
      };
      agg.runsTotal += row.runs_total;
      agg.runsSuccessful += row.runs_successful;
      agg.runsFailed += row.runs_failed ?? 0;
      if (row.avg_confidence_score !== null && row.runs_total > 0) {
        agg.confidenceWeightedSum += row.avg_confidence_score * row.runs_total;
        agg.confidenceWeight += row.runs_total;
      }
      agg.requiringReview += row.decisions_requiring_review ?? 0;
      agg.autoApproved += row.decisions_auto_approved ?? 0;
      aggregates.set(row.agent_id, agg);
    }

    const underperformers: UnderperformingAgent[] = [];
    for (const [agentId, agg] of aggregates) {
      const successRate = agg.runsTotal > 0 ? agg.runsSuccessful / agg.runsTotal : null;
      const errorRate = agg.runsTotal > 0 ? agg.runsFailed / agg.runsTotal : null;
      const avgConfidenceScore =
        agg.confidenceWeight > 0
          ? Number((agg.confidenceWeightedSum / agg.confidenceWeight).toFixed(2))
          : null;
      const totalDecisions = agg.requiringReview + agg.autoApproved;
      const reviewRate = totalDecisions > 0 ? agg.requiringReview / totalDecisions : null;

      const findings: Finding[] = [];

      if (successRate !== null && successRate < CRITICAL_SUCCESS_RATE_THRESHOLD) {
        findings.push({
          category: "CRITICAL",
          metric: "success_rate",
          value: Number((successRate * 100).toFixed(1)),
          threshold: CRITICAL_SUCCESS_RATE_THRESHOLD * 100,
          evidence: `success rate ${(successRate * 100).toFixed(1)}% (${agg.runsSuccessful}/${agg.runsTotal} runs, trailing ${METRICS_LOOKBACK_DAYS}d) is below the ${CRITICAL_SUCCESS_RATE_THRESHOLD * 100}% floor`,
        });
      }
      if (avgConfidenceScore !== null && avgConfidenceScore < LOW_CONFIDENCE_THRESHOLD) {
        findings.push({
          category: "LOW_CONFIDENCE",
          metric: "avg_confidence_score",
          value: avgConfidenceScore,
          threshold: LOW_CONFIDENCE_THRESHOLD,
          evidence: `avg confidence ${avgConfidenceScore} across ${agg.runsTotal} runs (trailing ${METRICS_LOOKBACK_DAYS}d) is below the ${LOW_CONFIDENCE_THRESHOLD} floor`,
        });
      }
      if (reviewRate !== null && reviewRate > HIGH_REVIEW_RATE_THRESHOLD) {
        findings.push({
          category: "HIGH_REVIEW_BURDEN",
          metric: "review_rate",
          value: Number((reviewRate * 100).toFixed(1)),
          threshold: HIGH_REVIEW_RATE_THRESHOLD * 100,
          evidence: `${(reviewRate * 100).toFixed(1)}% of decisions required human review (${agg.requiringReview}/${totalDecisions}, trailing ${METRICS_LOOKBACK_DAYS}d)`,
        });
      }
      if (errorRate !== null && errorRate > HIGH_ERROR_RATE_THRESHOLD) {
        findings.push({
          category: "RELIABILITY",
          metric: "error_rate",
          value: Number((errorRate * 100).toFixed(1)),
          threshold: HIGH_ERROR_RATE_THRESHOLD * 100,
          evidence: `${(errorRate * 100).toFixed(1)}% of runs failed (${agg.runsFailed}/${agg.runsTotal}, trailing ${METRICS_LOOKBACK_DAYS}d)`,
        });
      }

      if (findings.length > 0) {
        underperformers.push({
          agentId,
          runsTotal: agg.runsTotal,
          successRate,
          avgConfidenceScore,
          reviewRate,
          errorRate,
          findings,
        });
      }
    }

    return underperformers.sort((a, b) => {
      const aCritical = a.findings.some((f) => f.category === "CRITICAL") ? 0 : 1;
      const bCritical = b.findings.some((f) => f.category === "CRITICAL") ? 0 : 1;
      if (aCritical !== bCritical) return aCritical - bCritical;
      return b.runsTotal - a.runsTotal;
    });
  }

  /** agent_decisions with human_verdict = 'approved' and
   * confidence_score >= 85 over the trailing 30 days, grouped by
   * (agent_id, decision_type) to surface what these high-confidence,
   * human-confirmed decisions have in common. Feeds the proposal-generation
   * prompt as positive evidence, not just complaints. */
  private async identifyHighPerformingPatterns(): Promise<
    HighPerformingPattern[]
  > {
    const { startISO } = utcDayRange(PATTERNS_LOOKBACK_DAYS);

    const { data, error } = await this.supabase
      .from("agent_decisions")
      .select("agent_id, decision_type, confidence_score")
      .eq("human_verdict", "approved")
      .gte("confidence_score", HIGH_PERFORMING_MIN_CONFIDENCE)
      .gte("created_at", startISO)
      .limit(MAX_PATTERN_ROWS);
    if (error) {
      throw new Error(`Failed to load high-performing agent_decisions: ${error.message}`);
    }

    interface Tally {
      occurrences: number;
      confidenceSum: number;
    }
    const tallies = new Map<string, Tally>();

    for (const row of (data ?? []) as Array<{
      agent_id: string;
      decision_type: string;
      confidence_score: number | null;
    }>) {
      const key = `${row.agent_id}::${row.decision_type}`;
      const tally = tallies.get(key) ?? { occurrences: 0, confidenceSum: 0 };
      tally.occurrences += 1;
      tally.confidenceSum += row.confidence_score ?? HIGH_PERFORMING_MIN_CONFIDENCE;
      tallies.set(key, tally);
    }

    const patterns: HighPerformingPattern[] = [];
    for (const [key, tally] of tallies) {
      const separatorIndex = key.indexOf("::");
      const agentId = key.slice(0, separatorIndex);
      const decisionType = key.slice(separatorIndex + 2);
      patterns.push({
        agentId,
        decisionType,
        occurrences: tally.occurrences,
        avgConfidenceScore: Number((tally.confidenceSum / tally.occurrences).toFixed(2)),
      });
    }

    return patterns.sort((a, b) => b.occurrences - a.occurrences).slice(0, 10);
  }

  /** IMMEDIATE ESCALATION (step 6 of this task's spec). Fires a HIGH
   * PRIORITY alert to every platform owner the moment an agent's trailing
   * 7-day success_rate drops below 50% or its error_rate exceeds 40% --
   * independent of, and ahead of, proposal generation and the 7:00 AM
   * morning digest. Called from run() wrapped in its own try/catch so a
   * failure here can never suppress the rest of the pipeline, and a failure
   * in Claude proposal generation later can never suppress this. */
  private async escalateCriticalAgents(
    underperformers: UnderperformingAgent[],
    log: string[],
  ): Promise<void> {
    const critical = underperformers.filter(
      (agent) =>
        (agent.successRate !== null && agent.successRate < ESCALATION_SUCCESS_RATE_THRESHOLD) ||
        (agent.errorRate !== null && agent.errorRate > ESCALATION_ERROR_RATE_THRESHOLD),
    );
    if (critical.length === 0) return;

    const { dateKey } = utcDayRange(1);
    for (const agent of critical) {
      const parts: string[] = [];
      if (agent.successRate !== null && agent.successRate < ESCALATION_SUCCESS_RATE_THRESHOLD) {
        parts.push(
          `success rate ${(agent.successRate * 100).toFixed(1)}% (< ${ESCALATION_SUCCESS_RATE_THRESHOLD * 100}%)`,
        );
      }
      if (agent.errorRate !== null && agent.errorRate > ESCALATION_ERROR_RATE_THRESHOLD) {
        parts.push(
          `error rate ${(agent.errorRate * 100).toFixed(1)}% (> ${ESCALATION_ERROR_RATE_THRESHOLD * 100}%)`,
        );
      }
      const message =
        `AG-38 IMMEDIATE ESCALATION: agent "${agent.agentId}" -- ${parts.join(", ")} ` +
        `over the trailing ${METRICS_LOOKBACK_DAYS} days (${agent.runsTotal} runs). Review at /admin/monitor.`;

      await this.alertPlatformOwners(
        message,
        `self-improvement-escalation:${dateKey}:${agent.agentId}`,
      );
      log.push(`escalation: ${agent.agentId} -- ${parts.join(", ")}`);
    }
  }

  /** PROPOSAL GENERATION PROMPT (step 3 of this task's spec) -- >= 300
   * words, defining what counts as a meaningful improvement, the five
   * acceptable proposal types, the three forbidden ones, the required
   * evidence/impact statement formats, and the risk_level rubric. Kept as
   * its own method (rather than inlined into generateProposals) so its word
   * count and content can be reviewed/tested independently of the
   * per-run data it's paired with. */
  private buildProposalSystemPrompt(): string {
    return (
      "You are AG-38, the Benavora platform's Autonomous Continuous Improvement " +
      "Engine. Every night you analyze the trailing 7 days of every autonomous " +
      "agent's performance across every subscriber organization and decide " +
      "whether any specific, evidence-backed improvement is worth proposing to " +
      "the platform owner. You never act on your own conclusions -- every " +
      "proposal you produce is advisory only and requires explicit human " +
      "approval before anything changes in production.\n\n" +
      "A MEANINGFUL improvement changes a measurable outcome: it raises a " +
      "specific agent's success rate, lowers its error rate, reduces the " +
      "fraction of its decisions that require human review, or raises its " +
      "average confidence score by a stated amount. A meaningful improvement is " +
      "never cosmetic -- do not propose renaming a field, reformatting a log " +
      "line, or any change whose only effect is how something looks rather than " +
      "how it performs. If the evidence does not support a specific, measurable " +
      "claim for an agent, do not propose anything for that agent.\n\n" +
      "ACCEPTABLE proposal types, and only these five: prompt_optimization " +
      "(rewording or restructuring an agent's Claude system or user prompt to " +
      "improve output quality or confidence calibration), agent_threshold " +
      "(adjusting a numeric gate such as a confidence floor, auto-draft " +
      "threshold, or sample size -- never widening what an agent is allowed to " +
      "do autonomously beyond its current hard limits), workflow_change " +
      "(reordering, gating, or adding a step within an existing pipeline -- " +
      "never a new external integration), ui_improvement (a change to how " +
      "existing data is surfaced to a human reviewer), and data_quality (a fix " +
      "to how source data is validated, deduplicated, or normalized before an " +
      "agent consumes it).\n\n" +
      "FORBIDDEN proposal types, which you must never emit under any " +
      "circumstances: code_change (any proposal describing an edit to a source " +
      "file, function, or class), schema_change (any proposal describing " +
      "adding, altering, or dropping a database table, column, or constraint), " +
      "and permission_change (any proposal describing altering a role, RLS " +
      "policy, or access grant). If the only way to achieve an improvement " +
      "would require one of these three, do not propose it -- describe the " +
      "underlying data or performance problem in the evidence field of a " +
      "different, allowed proposal type instead, or omit it entirely.\n\n" +
      "Every proposal's evidence field must cite specific numbers: an agent " +
      "id, a metric name, its measured value, the sample size behind it, and " +
      "the threshold it crossed -- never a vague phrase like 'seems slow' or " +
      "'could be better.' Every expected_impact field must state a specific " +
      "expected percentage-point or count change in a named metric, not a " +
      "general aspiration. Assess risk_level using these definitions: low " +
      "means the change only affects wording or a UI label with no behavioral " +
      "effect; medium means the change adjusts a numeric threshold within the " +
      "agent's existing safe range or reorders an existing step; high means " +
      "the change would affect more than one agent, alter a gating condition " +
      "that controls whether an action requires human review, or touch " +
      "anything adjacent to a hard limit. Return ONLY a JSON array -- no " +
      "prose, no markdown fence."
    );
  }

  /** Step 5 (generation half): asks Claude what specific improvements would
   * raise success rates and confidence scores, given the 7-day summary,
   * underperformer findings, and high-performing patterns. Returns
   * validated proposals only -- every rejected raw entry (forbidden type,
   * invalid type, missing field) is logged with its specific reason rather
   * than silently dropped. */
  private async generateProposals(
    metricRows: AgentMetricRow[],
    underperformers: UnderperformingAgent[],
    patterns: HighPerformingPattern[],
    log: string[],
  ): Promise<ValidatedProposal[]> {
    const summaryLines = metricRows.map(
      (row) =>
        `- ${row.agent_id}: ${row.runs_successful}/${row.runs_total} completed ` +
        `(${row.runs_failed} failed), success_rate=${row.success_rate ?? "n/a"}%, ` +
        `avg_confidence_score=${row.avg_confidence_score ?? "n/a"}, ` +
        `review_rate=${row.review_rate ?? "n/a"}%, ` +
        `auto_approval_rate=${row.auto_approval_rate ?? "n/a"}%, ` +
        `error_rate=${row.error_rate ?? "n/a"}%`,
    );

    const underperformerLines = underperformers.flatMap((agent) =>
      agent.findings.map((f) => `- ${agent.agentId} [${f.category}]: ${f.evidence}`),
    );

    const patternLines = patterns.map(
      (pattern) =>
        `- ${pattern.agentId} / ${pattern.decisionType}: ${pattern.occurrences} human-approved decision(s) at avg confidence ${pattern.avgConfidenceScore}`,
    );

    const system = this.buildProposalSystemPrompt();

    const prompt = `Yesterday's per-agent performance:
${summaryLines.length > 0 ? summaryLines.join("\n") : "(no agent_runs activity yesterday)"}

Underperforming agents over the trailing ${METRICS_LOOKBACK_DAYS} days (each line is one specific threshold breach -- CRITICAL: success_rate < ${CRITICAL_SUCCESS_RATE_THRESHOLD * 100}%, LOW_CONFIDENCE: avg_confidence_score < ${LOW_CONFIDENCE_THRESHOLD}, HIGH_REVIEW_BURDEN: review_rate > ${HIGH_REVIEW_RATE_THRESHOLD * 100}%, RELIABILITY: error_rate > ${HIGH_ERROR_RATE_THRESHOLD * 100}%):
${underperformerLines.length > 0 ? underperformerLines.join("\n") : "(none found)"}

High-performing decision patterns (human-approved, confidence >= ${HIGH_PERFORMING_MIN_CONFIDENCE}, trailing ${PATTERNS_LOOKBACK_DAYS} days):
${patternLines.length > 0 ? patternLines.join("\n") : "(none found)"}

What specific improvements would increase success rates and confidence scores for the underperforming agents, informed by what the high-performing patterns have in common? Return ONLY a JSON array (no prose, no markdown fence) of proposal objects, each shaped exactly as:
[{ "proposal_type": "prompt_optimization" | "agent_threshold" | "workflow_change" | "ui_improvement" | "data_quality", "affected_agent_id": string (the agent_id this proposal targets, or "platform" if it is cross-cutting), "title": string, "description": string, "evidence": string, "expected_impact": string, "risk_level": "low" | "medium" | "high", "confidence_score": number (0-100) }]

If there is not enough data to propose anything with reasonable confidence, return an empty array [].`;

    const response = await callClaude({
      prompt,
      system,
      model: DEFAULT_MODEL,
      maxTokens: MAX_TOKENS,
    });

    const raw = parseProposalArray(response.text);
    const validated: ValidatedProposal[] = [];
    for (const entry of raw) {
      const result = validateProposal(entry);
      if (result.ok) {
        validated.push(result.proposal);
      } else {
        log.push(`proposal_rejected[validation]: ${result.reason}`);
      }
    }
    return validated;
  }

  /** PROPOSAL DEDUPLICATION (step 4 of this task's spec). Checks
   * improvement_proposals for a similar proposal (same proposal_type +
   * same affected_agent_id) in the last 30 days. If the most recent match
   * within the trailing 90 days was rejected, suppress re-proposing for
   * that full 90-day window; otherwise, any match within 30 days is treated
   * as a duplicate regardless of status. */
  private async checkDuplicate(
    proposal: ValidatedProposal,
  ): Promise<{ isDuplicate: boolean; reason?: string }> {
    const now = Date.now();
    const ninetyDaysAgoISO = new Date(now - REJECTED_COOLDOWN_DAYS * 86_400_000).toISOString();
    const thirtyDaysAgoISO = new Date(now - DEDUP_LOOKBACK_DAYS * 86_400_000).toISOString();

    const { data, error } = await this.supabase
      .from("improvement_proposals")
      .select("id, status, proposed_at")
      .eq("proposal_type", proposal.proposal_type)
      .eq("affected_agent_id", proposal.affectedAgentId)
      .gte("proposed_at", ninetyDaysAgoISO)
      .order("proposed_at", { ascending: false })
      .limit(MAX_DEDUP_CANDIDATES);

    if (error || !data || data.length === 0) return { isDuplicate: false };

    const candidates = data as Array<{ id: string; status: string; proposed_at: string }>;

    const rejectedRecently = candidates.find((row) => row.status === "rejected");
    if (rejectedRecently) {
      return {
        isDuplicate: true,
        reason:
          `a ${proposal.proposal_type} proposal for "${proposal.affectedAgentId}" was rejected ` +
          `on ${rejectedRecently.proposed_at.slice(0, 10)} -- suppressed for ${REJECTED_COOLDOWN_DAYS} days`,
      };
    }

    const withinThirty = candidates.find((row) => row.proposed_at >= thirtyDaysAgoISO);
    if (withinThirty) {
      return {
        isDuplicate: true,
        reason:
          `a similar ${proposal.proposal_type} proposal for "${proposal.affectedAgentId}" already exists ` +
          `(status=${withinThirty.status}, proposed ${withinThirty.proposed_at.slice(0, 10)})`,
      };
    }

    return { isDuplicate: false };
  }

  /** CONFIDENCE FILTERING (step 5) + PROPOSAL DEDUPLICATION (step 4),
   * applied in sequence, with every rejection logged to the orchestrator
   * log before the survivors are persisted. */
  private async insertProposals(
    proposals: ValidatedProposal[],
    log: string[],
  ): Promise<ValidatedProposal[]> {
    const aboveConfidence = proposals.filter((proposal) => {
      if (proposal.confidence_score < MIN_CONFIDENCE_TO_PROPOSE) {
        log.push(
          `proposal_rejected[confidence]: "${proposal.title}" confidence ${proposal.confidence_score} < ${MIN_CONFIDENCE_TO_PROPOSE}`,
        );
        return false;
      }
      return true;
    });

    const toInsert: ValidatedProposal[] = [];
    for (const proposal of aboveConfidence) {
      const dup = await this.checkDuplicate(proposal);
      if (dup.isDuplicate) {
        log.push(`proposal_rejected[duplicate]: "${proposal.title}" -- ${dup.reason}`);
        continue;
      }
      toInsert.push(proposal);
    }

    if (toInsert.length === 0) return [];

    const { error } = await this.supabase.from("improvement_proposals").insert(
      toInsert.map((proposal) => ({
        proposal_type: proposal.proposal_type,
        title: proposal.title,
        description: proposal.description,
        evidence: proposal.evidence,
        expected_impact: proposal.expected_impact,
        risk_level: proposal.risk_level,
        confidence_score: proposal.confidence_score,
        affected_agent_id: proposal.affectedAgentId,
        status: "proposed",
      })),
    );
    if (error) {
      throw new Error(`Failed to insert improvement_proposals: ${error.message}`);
    }

    return toInsert;
  }

  /** Shared alert helper for both the high-risk-proposal notice and the
   * immediate escalation path. There is no platform-wide notifications
   * table in this schema (see autonomous-base.ts's own header note) --
   * `alerts` is org-scoped, so this writes one alert per organization that
   * has an owner, matching the cross-tenant service-role query pattern
   * already used by /api/admin/platform-metrics. Best-effort: a
   * notification failure must not fail the run that already successfully
   * computed metrics or persisted proposals. */
  private async alertPlatformOwners(message: string, dedupKey: string): Promise<void> {
    const { data: owners, error } = await this.supabase
      .from("profiles")
      .select("organization_id")
      .eq("role", "owner");
    if (error || !owners) return;

    const orgIds = new Set(
      (owners as Array<{ organization_id: string }>).map((row) => row.organization_id),
    );
    if (orgIds.size === 0) return;

    const alertRows = Array.from(orgIds).map((orgId) => ({
      organization_id: orgId,
      type: "system",
      severity: "critical",
      message,
      link: "/admin/monitor",
      dedup_key: dedupKey,
    }));

    await this.supabase.from("alerts").upsert(alertRows, {
      onConflict: "organization_id,dedup_key",
    });
  }

  /** WEEKLY PERFORMANCE REPORT (step 7 of this task's spec). Runs every
   * Sunday (America/Chicago -- see isSundayChicago()), after metrics
   * calculation. Deterministic, not Claude-generated: a metrics rollup has
   * nothing to hallucinate, and a platform owner reading a "performance
   * report" should be able to trust every number in it came directly from
   * the query, not from a model's summarization of it. Stored as
   * proposal_type='performance_report' (migration 100 widens the CHECK
   * constraint to allow this alongside the five Claude-generated types). */
  private async generateWeeklyReport(
    metricRows: AgentMetricRow[],
    underperformers: UnderperformingAgent[],
    patterns: HighPerformingPattern[],
    insertedCount: number,
    rejectedCount: number,
    log: string[],
  ): Promise<void> {
    if (!isSundayChicago()) {
      log.push("weekly_report: skipped (not Sunday, America/Chicago)");
      return;
    }

    const { dateKey } = utcDayRange(1);
    const totalRuns = metricRows.reduce((sum, row) => sum + row.runs_total, 0);
    const totalFailed = metricRows.reduce((sum, row) => sum + row.runs_failed, 0);
    const overallSuccessRate =
      totalRuns > 0 ? Number((((totalRuns - totalFailed) / totalRuns) * 100).toFixed(1)) : null;

    const agentLines = metricRows
      .slice()
      .sort((a, b) => b.runs_total - a.runs_total)
      .map(
        (row) =>
          `  ${row.agent_id}: ${row.runs_total} runs, success_rate=${row.success_rate ?? "n/a"}%, ` +
          `avg_confidence_score=${row.avg_confidence_score ?? "n/a"}, review_rate=${row.review_rate ?? "n/a"}%, ` +
          `error_rate=${row.error_rate ?? "n/a"}%`,
      )
      .join("\n");

    const underperformerSection =
      underperformers.length > 0
        ? underperformers
            .map(
              (agent) =>
                `  ${agent.agentId}: ${agent.findings.map((f) => `[${f.category}] ${f.evidence}`).join("; ")}`,
            )
            .join("\n")
        : "  None -- every agent with activity this week met all four thresholds.";

    const patternSection =
      patterns.length > 0
        ? patterns
            .slice(0, 5)
            .map(
              (p) =>
                `  ${p.agentId} / ${p.decisionType}: ${p.occurrences} human-approved decision(s), avg confidence ${p.avgConfidenceScore}`,
            )
            .join("\n")
        : "  No high-confidence, human-approved decision patterns found in the trailing 30 days.";

    const focusAreas =
      underperformers.length > 0
        ? underperformers
            .slice(0, 3)
            .map((agent) => {
              const top = agent.findings[0];
              return `  - ${agent.agentId}: prioritize the ${top?.category ?? "unknown"} finding first (${top?.evidence ?? "no evidence recorded"})`;
            })
            .join("\n")
        : "  - No agent requires focus this week; continue monitoring.";

    const report =
      `WEEKLY AGENT PERFORMANCE REPORT -- week ending ${dateKey}\n\n` +
      `SUMMARY\n` +
      `  ${metricRows.length} agent(s) had activity yesterday. Platform-wide success rate: ${overallSuccessRate ?? "n/a"}% (${totalRuns} runs, ${totalFailed} failed).\n` +
      `  ${underperformers.length} agent(s) breached at least one performance threshold over the trailing ${METRICS_LOOKBACK_DAYS} days.\n` +
      `  ${insertedCount} improvement proposal(s) generated this run, ${rejectedCount} rejected (confidence/duplicate/validation).\n\n` +
      `PER-AGENT METRICS (yesterday)\n${agentLines || "  (no agent_runs activity yesterday)"}\n\n` +
      `UNDERPERFORMERS (trailing ${METRICS_LOOKBACK_DAYS} days)\n${underperformerSection}\n\n` +
      `HIGH-PERFORMING PATTERNS (trailing ${PATTERNS_LOOKBACK_DAYS} days)\n${patternSection}\n\n` +
      `RECOMMENDED FOCUS AREAS\n${focusAreas}`;

    const { error } = await this.supabase.from("improvement_proposals").insert({
      proposal_type: "performance_report",
      title: `Weekly Performance Report -- week ending ${dateKey}`,
      description: report,
      evidence: `${metricRows.length} agent(s) with activity, ${totalRuns} total runs, ${underperformers.length} underperformer(s) over the trailing ${METRICS_LOOKBACK_DAYS} days.`,
      expected_impact: "Informational only -- no behavioral change is proposed by this report itself.",
      risk_level: "low",
      confidence_score: 100,
      affected_agent_id: null,
      status: "proposed",
    });

    if (error) {
      log.push(`weekly_report: FAILED to insert -- ${error.message}`);
      return;
    }
    log.push("weekly_report: generated and stored");
  }

  async run(triggerSource: TriggerSource): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const log: string[] = [];

    try {
      const { metricsCalculated, metricRows } = await this.calculateAgentMetrics();
      const underperformers = await this.identifyUnderperformers();
      const patterns = await this.identifyHighPerformingPatterns();

      // Fire immediately, independent of proposal generation succeeding --
      // do not wait for the digest cycle (task spec step 6).
      try {
        await this.escalateCriticalAgents(underperformers, log);
      } catch (err) {
        log.push(`escalation: FAILED -- ${errMsg(err)}`);
      }

      const proposals = await this.generateProposals(metricRows, underperformers, patterns, log);
      const inserted = await this.insertProposals(proposals, log);

      const highRisk = inserted.filter((proposal) => proposal.risk_level === "high");
      if (highRisk.length > 0) {
        const message =
          highRisk.length === 1 && highRisk[0]
            ? `AG-38 flagged a HIGH-RISK improvement proposal: "${highRisk[0].title}". Review at /admin/monitor.`
            : `AG-38 flagged ${highRisk.length} HIGH-RISK improvement proposals overnight. Review at /admin/monitor.`;
        await this.alertPlatformOwners(
          message,
          `self-improvement-highrisk:${utcDayRange(1).dateKey}`,
        );
        log.push(`platform_owners_notified: ${highRisk.length} high-risk proposal(s)`);
      }

      const rejectedCount = log.filter((entry) => entry.startsWith("proposal_rejected")).length;

      await this.generateWeeklyReport(
        metricRows,
        underperformers,
        patterns,
        inserted.length,
        rejectedCount,
        log,
      );

      const summary =
        `Metrics calculated: ${metricsCalculated}. ` +
        `Underperformers found: ${underperformers.length}. ` +
        `Proposals generated: ${inserted.length} (${rejectedCount} rejected). ` +
        log.join(" | ");

      await this.completeRun(runId, {
        outputSummary: summary.slice(0, 4000),
        itemsFound: metricsCalculated,
        itemsProcessed: inserted.length,
      });

      return {
        success: true,
        itemsFound: metricsCalculated,
        itemsProcessed: inserted.length,
        itemsQueued: 0,
        decisions: log,
        nextActions: highRisk.length > 0 ? ["platform_owners_notified_high_risk"] : [],
        errors: [],
      };
    } catch (err) {
      const message = errMsg(err);
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions: log,
        nextActions: [],
        errors: [message],
      };
    }
  }
}
