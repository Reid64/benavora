"use strict";
// AG-38 Self-Improvement Agent (AUTONOMOUS_PLATFORM_VISION.md Phase 4,
// "Autonomous Continuous Improvement Engine" -- the vision doc's own
// numbering calls this AG-36; AGENTS_v2.md section 5's Phase 2-5 spec
// assigns it AG-38 instead and documents the collision in its own
// Numbering note. This file follows AGENTS_v2.md's AG-38 spec).
//
// HARD LIMIT: This agent NEVER modifies production code, prompts, or
// configurations directly. It ONLY proposes improvements (written to
// improvement_proposals, migration 087) that require explicit platform
// owner approval before implementation. It has no write path to any other
// agent's prompt text, any agent_registry row, or any governance file --
// matching AUTONOMOUS_HARD_LIMITS.NEVER_MODIFY_GOVERNANCE_FILES and
// BEHAVIORAL_CONTRACTS.md section 34 (Autonomous Agent Contracts).
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
// calendar days, not America/Chicago like worker/scheduler.ts's cron gating
// -- this is a nightly analytics rollup where exact timezone-boundary
// precision doesn't change the result meaningfully, and no timezone library
// is available in this codebase beyond Intl.DateTimeFormat part extraction
// (see worker/scheduler.ts's chicagoParts, which only extracts parts, not a
// full-day boundary in a target zone).
//
// human_verdict (not "review_outcome") is the real column on agent_decisions
// (migration 080_autonomous_agent_infrastructure.sql) -- SCHEMA_REGISTRY_v2.md
// documents a "review_outcome" column that was never actually applied;
// trust the migration over the doc, per this codebase's own established
// practice of flagging doc/schema drift.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelfImprovementAgent = void 0;
const claude_1 = require("@/lib/ai/claude");
const AGENT_ID = "ag-38-self-improvement";
const MAX_TOKENS = 1500;
// Thresholds per AGENTS_v2.md AG-38 spec / this task's own spec.
const SUCCESS_RATE_THRESHOLD = 0.8;
const MIN_AVG_CONFIDENCE = 65;
const REVIEW_RATIO_THRESHOLD = 0.5;
const MIN_CONFIDENCE_TO_PROPOSE = 75;
const HIGH_PERFORMING_MIN_CONFIDENCE = 85;
const METRICS_LOOKBACK_DAYS = 7;
const PATTERNS_LOOKBACK_DAYS = 30;
const MAX_PATTERN_ROWS = 2000;
const MAX_RUN_ROWS = 20000;
const PROPOSAL_TYPES = [
    "prompt_optimization",
    "agent_threshold",
    "workflow_change",
    "ui_improvement",
    "data_quality",
];
const RISK_LEVELS = ["low", "medium", "high"];
function isProposalType(value) {
    return (typeof value === "string" &&
        PROPOSAL_TYPES.includes(value));
}
function isRiskLevel(value) {
    return (typeof value === "string" && RISK_LEVELS.includes(value));
}
function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
}
/** UTC-calendar-day range, `daysAgo` days back from today. See file header
 * for why UTC (not America/Chicago) is used here. */
function utcDayRange(daysAgo) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo + 1));
    return {
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        dateKey: start.toISOString().slice(0, 10),
    };
}
/** Best-effort JSON array extraction - mirrors the parse-then-regex-fallback
 * convention in strategic-advisor-agent.ts / simulation-agent.ts. Claude is
 * asked for JSON-only output but occasionally wraps it in prose or a
 * markdown fence. */
function parseProposalArray(text) {
    const tryParse = (candidate) => {
        try {
            const parsed = JSON.parse(candidate);
            return Array.isArray(parsed) ? parsed : null;
        }
        catch {
            return null;
        }
    };
    const direct = tryParse(text.trim());
    if (direct)
        return direct;
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
        const fromMatch = tryParse(match[0]);
        if (fromMatch)
            return fromMatch;
    }
    throw new Error("Claude did not return a parseable improvement-proposal JSON array.");
}
/** Validates and coerces one raw Claude proposal. Returns null (never
 * throws) for a malformed entry - one bad proposal must not sink the rest
 * of the batch (same "never fabricate a field it can't extract" convention
 * used throughout AGENTS_v2.md). */
function validateProposal(raw) {
    if (!isProposalType(raw.proposal_type))
        return null;
    if (typeof raw.title !== "string" || raw.title.trim() === "")
        return null;
    if (typeof raw.description !== "string" || raw.description.trim() === "")
        return null;
    if (typeof raw.evidence !== "string" || raw.evidence.trim() === "")
        return null;
    const expected_impact = typeof raw.expected_impact === "string" && raw.expected_impact.trim() !== ""
        ? raw.expected_impact.trim()
        : "Not specified.";
    const risk_level = isRiskLevel(raw.risk_level) ? raw.risk_level : "medium";
    const confidenceRaw = Number(raw.confidence_score);
    const confidence_score = Number.isFinite(confidenceRaw)
        ? Math.min(100, Math.max(0, Math.round(confidenceRaw)))
        : 50;
    return {
        proposal_type: raw.proposal_type,
        title: raw.title.trim(),
        description: raw.description.trim(),
        evidence: raw.evidence.trim(),
        expected_impact,
        risk_level,
        confidence_score,
    };
}
class SelfImprovementAgent {
    supabase;
    constructor(supabase) {
        this.supabase = supabase;
    }
    /** Opens a platform-level agent_runs row (organization_id = null; see
     * migration 088_self_improvement_agent.sql). Mirrors
     * AutonomousAgent.startRun() but deliberately does not scope to an org. */
    async startRun(triggerSource) {
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
            throw new Error(`Failed to start AG-38 platform-level run: ${error?.message ?? "no row returned"}`);
        }
        return data.id;
    }
    async completeRun(runId, params) {
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
    async failRun(runId, errorMessage) {
        try {
            await this.supabase
                .from("agent_runs")
                .update({
                status: "failed",
                completed_at: new Date().toISOString(),
                error_message: errorMessage,
            })
                .eq("id", runId);
        }
        catch {
            // Logging failure is swallowed deliberately - see doc comment above.
        }
    }
    /** Step 2: for every agent_type seen in yesterday's agent_runs, compute
     * runs_total / runs_successful / avg confidence / avg items_processed,
     * plus decisions_requiring_review / decisions_auto_approved from
     * yesterday's agent_decisions for that same agent id. Upserts one row per
     * agent into agent_performance_metrics keyed (agent_id, metric_date). */
    async calculateYesterdayMetrics() {
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
            throw new Error(`Failed to load yesterday's agent_decisions: ${decisionError.message}`);
        }
        const runTallies = new Map();
        for (const row of (runRows ?? [])) {
            const key = row.agent_type;
            const tally = runTallies.get(key) ?? {
                runsTotal: 0,
                runsSuccessful: 0,
                confidenceSum: 0,
                confidenceCount: 0,
                itemsProcessedSum: 0,
                itemsProcessedCount: 0,
            };
            tally.runsTotal += 1;
            if (row.status === "completed")
                tally.runsSuccessful += 1;
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
        const decisionTallies = new Map();
        for (const row of (decisionRows ?? [])) {
            const tally = decisionTallies.get(row.agent_id) ?? {
                requiringReview: 0,
                autoApproved: 0,
            };
            if (row.required_human_review)
                tally.requiringReview += 1;
            else
                tally.autoApproved += 1;
            decisionTallies.set(row.agent_id, tally);
        }
        const metricRows = [];
        for (const [agentId, tally] of runTallies) {
            const decisions = decisionTallies.get(agentId) ?? {
                requiringReview: 0,
                autoApproved: 0,
            };
            metricRows.push({
                agent_id: agentId,
                runs_total: tally.runsTotal,
                runs_successful: tally.runsSuccessful,
                avg_confidence_score: tally.confidenceCount > 0
                    ? Number((tally.confidenceSum / tally.confidenceCount).toFixed(2))
                    : null,
                avg_items_processed: tally.itemsProcessedCount > 0
                    ? Number((tally.itemsProcessedSum / tally.itemsProcessedCount).toFixed(2))
                    : null,
                decisions_requiring_review: decisions.requiringReview,
                decisions_auto_approved: decisions.autoApproved,
            });
        }
        if (metricRows.length > 0) {
            const { error: upsertError } = await this.supabase
                .from("agent_performance_metrics")
                .upsert(metricRows.map((row) => ({
                agent_id: row.agent_id,
                metric_date: dateKey,
                runs_total: row.runs_total,
                runs_successful: row.runs_successful,
                avg_confidence_score: row.avg_confidence_score,
                avg_items_processed: row.avg_items_processed,
                decisions_requiring_review: row.decisions_requiring_review,
                decisions_auto_approved: row.decisions_auto_approved,
            })), { onConflict: "agent_id,metric_date" });
            if (upsertError) {
                throw new Error(`Failed to upsert agent_performance_metrics: ${upsertError.message}`);
            }
        }
        return { metricsCalculated: metricRows.length, metricRows };
    }
    /** Step 3: aggregate agent_performance_metrics over the trailing 7 days
     * (inclusive of yesterday) and flag any agent tripping one of the three
     * thresholds. */
    async identifyUnderperformers() {
        const windowStart = utcDayRange(METRICS_LOOKBACK_DAYS).dateKey;
        const windowEnd = utcDayRange(1).dateKey;
        const { data, error } = await this.supabase
            .from("agent_performance_metrics")
            .select("agent_id, runs_total, runs_successful, avg_confidence_score, decisions_requiring_review")
            .gte("metric_date", windowStart)
            .lte("metric_date", windowEnd);
        if (error) {
            throw new Error(`Failed to load 7-day agent_performance_metrics: ${error.message}`);
        }
        const aggregates = new Map();
        for (const row of (data ?? [])) {
            const agg = aggregates.get(row.agent_id) ?? {
                runsTotal: 0,
                runsSuccessful: 0,
                confidenceWeightedSum: 0,
                confidenceWeight: 0,
                requiringReview: 0,
            };
            agg.runsTotal += row.runs_total;
            agg.runsSuccessful += row.runs_successful;
            if (row.avg_confidence_score !== null && row.runs_total > 0) {
                agg.confidenceWeightedSum += row.avg_confidence_score * row.runs_total;
                agg.confidenceWeight += row.runs_total;
            }
            agg.requiringReview += row.decisions_requiring_review ?? 0;
            aggregates.set(row.agent_id, agg);
        }
        const underperformers = [];
        for (const [agentId, agg] of aggregates) {
            const successRate = agg.runsTotal > 0 ? agg.runsSuccessful / agg.runsTotal : null;
            const avgConfidenceScore = agg.confidenceWeight > 0
                ? Number((agg.confidenceWeightedSum / agg.confidenceWeight).toFixed(2))
                : null;
            const reviewRatio = agg.runsTotal > 0 ? agg.requiringReview / agg.runsTotal : null;
            const reasons = [];
            if (successRate !== null && successRate < SUCCESS_RATE_THRESHOLD) {
                reasons.push(`success rate ${(successRate * 100).toFixed(1)}% < ${SUCCESS_RATE_THRESHOLD * 100}%`);
            }
            if (avgConfidenceScore !== null && avgConfidenceScore < MIN_AVG_CONFIDENCE) {
                reasons.push(`avg confidence ${avgConfidenceScore} < ${MIN_AVG_CONFIDENCE}`);
            }
            if (reviewRatio !== null && reviewRatio > REVIEW_RATIO_THRESHOLD) {
                reasons.push(`${(reviewRatio * 100).toFixed(1)}% of decisions required human review`);
            }
            if (reasons.length > 0) {
                underperformers.push({
                    agentId,
                    runsTotal: agg.runsTotal,
                    successRate,
                    avgConfidenceScore,
                    reviewRatio,
                    reasons,
                });
            }
        }
        return underperformers.sort((a, b) => b.runsTotal - a.runsTotal);
    }
    /** Step 4: agent_decisions with human_verdict = 'approved' and
     * confidence_score >= 85 over the trailing 30 days, grouped by
     * (agent_id, decision_type) to surface what these high-confidence,
     * human-confirmed decisions have in common. */
    async identifyHighPerformingPatterns() {
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
        const tallies = new Map();
        for (const row of (data ?? [])) {
            const key = `${row.agent_id}::${row.decision_type}`;
            const tally = tallies.get(key) ?? { occurrences: 0, confidenceSum: 0 };
            tally.occurrences += 1;
            tally.confidenceSum += row.confidence_score ?? HIGH_PERFORMING_MIN_CONFIDENCE;
            tallies.set(key, tally);
        }
        const patterns = [];
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
    /** Step 5: asks Claude what specific improvements would raise success
     * rates and confidence scores, given the 7-day summary, underperformer
     * list, and high-performing patterns. Returns validated proposals only -
     * malformed entries are dropped, never fabricated (see validateProposal). */
    async generateProposals(metricRows, underperformers, patterns) {
        const summaryLines = metricRows.map((row) => `- ${row.agent_id}: ${row.runs_successful}/${row.runs_total} completed, ` +
            `avg confidence ${row.avg_confidence_score ?? "n/a"}, ` +
            `${row.decisions_requiring_review} decision(s) required review, ` +
            `${row.decisions_auto_approved} auto-approved`);
        const underperformerLines = underperformers.map((agent) => `- ${agent.agentId} (${agent.runsTotal} runs over trailing ${METRICS_LOOKBACK_DAYS}d): ${agent.reasons.join("; ")}`);
        const patternLines = patterns.map((pattern) => `- ${pattern.agentId} / ${pattern.decisionType}: ${pattern.occurrences} human-approved decision(s) at avg confidence ${pattern.avgConfidenceScore}`);
        const system = "You are the Benavora platform's Autonomous Continuous Improvement Engine " +
            "(AG-38). You analyze nightly agent performance across every subscriber " +
            "organization and propose specific, evidence-backed improvements. You " +
            "NEVER propose modifying a governance file, a hard limit constant, or " +
            "anything that would let an agent submit externally, send email without " +
            "approval, or delete user data - those are permanent, non-negotiable " +
            "constraints (AUTONOMOUS_HARD_LIMITS). Every proposal you return is " +
            "advisory only and requires explicit platform-owner approval before any " +
            "code, prompt, or configuration changes.";
        const prompt = `Yesterday's per-agent performance (agent_id: successful/total runs, avg confidence, review split):
${summaryLines.length > 0 ? summaryLines.join("\n") : "(no agent_runs activity yesterday)"}

Underperforming agents over the trailing ${METRICS_LOOKBACK_DAYS} days (success rate < ${SUCCESS_RATE_THRESHOLD * 100}%, avg confidence < ${MIN_AVG_CONFIDENCE}, or review ratio > ${REVIEW_RATIO_THRESHOLD * 100}%):
${underperformerLines.length > 0 ? underperformerLines.join("\n") : "(none found)"}

High-performing decision patterns (human-approved, confidence >= ${HIGH_PERFORMING_MIN_CONFIDENCE}, trailing ${PATTERNS_LOOKBACK_DAYS} days):
${patternLines.length > 0 ? patternLines.join("\n") : "(none found)"}

What specific improvements would increase success rates and confidence scores for the underperforming agents, informed by what the high-performing patterns have in common? Return ONLY a JSON array (no prose, no markdown fence) of proposal objects, each shaped exactly as:
[{ "proposal_type": "prompt_optimization" | "agent_threshold" | "workflow_change" | "ui_improvement" | "data_quality", "title": string, "description": string, "evidence": string, "expected_impact": string, "risk_level": "low" | "medium" | "high", "confidence_score": number (0-100) }]

If there is not enough data to propose anything with reasonable confidence, return an empty array [].`;
        const response = await (0, claude_1.callClaude)({
            prompt,
            system,
            model: claude_1.DEFAULT_MODEL,
            maxTokens: MAX_TOKENS,
        });
        const raw = parseProposalArray(response.text);
        const validated = [];
        for (const entry of raw) {
            const proposal = validateProposal(entry);
            if (proposal)
                validated.push(proposal);
        }
        return validated;
    }
    /** Step 6: persists every proposal with confidence_score >= 75. */
    async insertProposals(proposals) {
        const toInsert = proposals.filter((proposal) => proposal.confidence_score >= MIN_CONFIDENCE_TO_PROPOSE);
        if (toInsert.length === 0)
            return [];
        const { error } = await this.supabase.from("improvement_proposals").insert(toInsert.map((proposal) => ({
            proposal_type: proposal.proposal_type,
            title: proposal.title,
            description: proposal.description,
            evidence: proposal.evidence,
            expected_impact: proposal.expected_impact,
            risk_level: proposal.risk_level,
            confidence_score: proposal.confidence_score,
            status: "proposed",
        })));
        if (error) {
            throw new Error(`Failed to insert improvement_proposals: ${error.message}`);
        }
        return toInsert;
    }
    /** Step 7: high-risk proposals page every platform owner immediately.
     * There is no platform-wide notifications table in this schema (see
     * autonomous-base.ts's own header note) - `alerts` is org-scoped, so this
     * writes one alert per organization that has an owner, matching the
     * cross-tenant service-role query pattern already used by
     * /api/admin/platform-metrics. */
    async notifyPlatformOwners(highRiskProposals) {
        if (highRiskProposals.length === 0)
            return;
        const { data: owners, error } = await this.supabase
            .from("profiles")
            .select("organization_id")
            .eq("role", "owner");
        if (error || !owners)
            return;
        const orgIds = new Set(owners.map((row) => row.organization_id));
        if (orgIds.size === 0)
            return;
        const message = highRiskProposals.length === 1 && highRiskProposals[0]
            ? `AG-38 flagged a HIGH-RISK improvement proposal: "${highRiskProposals[0].title}". Review at /admin/monitor.`
            : `AG-38 flagged ${highRiskProposals.length} HIGH-RISK improvement proposals overnight. Review at /admin/monitor.`;
        const alertRows = Array.from(orgIds).map((orgId) => ({
            organization_id: orgId,
            type: "system",
            severity: "critical",
            message,
            link: "/admin/monitor",
            dedup_key: `self-improvement:${utcDayRange(1).dateKey}`,
        }));
        // Best-effort: a notification failure must not fail the run that
        // already successfully generated and persisted the proposals.
        await this.supabase.from("alerts").upsert(alertRows, {
            onConflict: "organization_id,dedup_key",
        });
    }
    async run(triggerSource) {
        const runId = await this.startRun(triggerSource);
        try {
            const { metricsCalculated, metricRows } = await this.calculateYesterdayMetrics();
            const underperformers = await this.identifyUnderperformers();
            const patterns = await this.identifyHighPerformingPatterns();
            const proposals = await this.generateProposals(metricRows, underperformers, patterns);
            const inserted = await this.insertProposals(proposals);
            const highRisk = inserted.filter((proposal) => proposal.risk_level === "high");
            await this.notifyPlatformOwners(highRisk);
            const summary = `Metrics calculated: ${metricsCalculated}. ` +
                `Underperformers found: ${underperformers.length}. ` +
                `Proposals generated: ${inserted.length}.`;
            await this.completeRun(runId, {
                outputSummary: summary,
                itemsFound: metricsCalculated,
                itemsProcessed: inserted.length,
            });
            return {
                success: true,
                itemsFound: metricsCalculated,
                itemsProcessed: inserted.length,
                itemsQueued: 0,
                decisions: [],
                nextActions: highRisk.length > 0 ? ["platform_owners_notified_high_risk"] : [],
                errors: [],
            };
        }
        catch (err) {
            const message = errMsg(err);
            await this.failRun(runId, message);
            return {
                success: false,
                itemsFound: 0,
                itemsProcessed: 0,
                itemsQueued: 0,
                decisions: [],
                nextActions: [],
                errors: [message],
            };
        }
    }
}
exports.SelfImprovementAgent = SelfImprovementAgent;
