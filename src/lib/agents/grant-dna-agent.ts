// AG-10 Grant DNA Analysis Agent (AutonomousAgent, migration 106:
// funder_dna_profiles). Enterprise spec: AGENTS_v2.md §5, AG-10 "Grant DNA
// Analysis Agent" (written 2026-08-03). Purpose: analyzes what a funder
// tends to require and reward, producing a structured DNA profile per
// (organization_id, funder_id).
//
// Two triggers, per spec:
//   1. Event-chained (primary) — fired via agent_queue (trigger_source:
//      "event", same convention as AG-28 FollowupGeneratorAgent's own
//      queue-payload-read pattern) whenever a new `outcomes` row is inserted
//      for an application whose opportunity has a non-null funder_id. The
//      enqueue happens in src/components/outcomes/OutcomeForm.tsx via
//      POST /api/autonomous/grant-dna-trigger, mirroring the existing
//      best-effort AG-07/AG-23 triggers already fired from that same form.
//   2. Weekly schedule (secondary) — worker/scheduler.ts, Sunday 3:00 AM
//      CST, via runGrantDnaWeeklyPipeline() in
//      worker/autonomous-orchestrator.ts. Scans every funder with ≥1 new
//      `opportunities` row since funder_dna_profiles.last_analyzed_at (or no
//      profile row yet), capped at MAX_FUNDERS_PER_SCHEDULED_RUN per run.
//
// Both paths resolve a funderIds: string[] scope before startRun() — the
// event path scopes to the one funder read off the currently-processing
// agent_queue row's input_payload.funderId; the schedule path (and any other
// trigger source, e.g. a manual re-run) scopes to the full per-org scan.
//
// Cross-org evidence pooling (spec's explicit design note): opportunities/
// outcomes evidence for a given funder is read across every organization
// that has a `funders` row with a matching name (case-insensitive), not just
// the calling org — a funder's real-world behavior is an objective fact, not
// something that differs by which org is asking. The OUTPUT row stays
// strictly per-org (this.orgId), since this schema has no cross-org funder
// identity resolution (no dedup/canonical-entity column on `funders`) — name
// matching is a best-effort read-time join, not a real foreign key. The
// count of evidence drawn from other orgs' name-matched funder rows is
// tracked as `matchedByName` in both reward_patterns and the logged
// decision's actionPayload, so a human can see how much of the sample came
// from this org's own funder_id vs. name-matching. This mirrors the same
// cross-org read pattern already used by AG-32
// (relationship-graph-builder-agent.ts) against `funders`, running under the
// same service-role worker client, RLS-transparent when invoked from a
// session-scoped route instead (matchedByName degrades to 0, not a crash).
//
// Deterministic vs. Claude-assisted split (spec's own design principle,
// matching AG-26's forecast math): requirement_patterns is pure aggregation
// over already-structured columns (required_documents, amount_min/max,
// recurrence) — no Claude call needed, so it is always computed even with
// zero outcomes on file. reward_patterns needs real language understanding
// over free text (eligibility_requirements, funder_feedback, denial_reason)
// and is only computed when ≥1 outcome exists; below
// MIN_SAMPLE_FOR_UNCAPPED_CONFIDENCE outcomes, Claude is still called (there
// is real signal worth extracting even from 1-2 outcomes) but the returned
// confidence is capped in code at SMALL_SAMPLE_CONFIDENCE_CAP regardless of
// what the model reports — a small sample cannot honestly support high
// confidence, and that cap is enforced here, not left to the model.
//
// Idempotency: every run recomputes requirement_patterns/reward_patterns
// from the FULL current evidence set and overwrites the jsonb columns via an
// upsert on (organization_id, funder_id) — never an incremental append. A
// re-run with no new evidence produces the same aggregate numbers both
// times. last_analyzed_at is stamped on every successful write, including
// the zero-outcome (requirements-only) case, so the weekly scheduled scan's
// "new since last_analyzed_at" scope query is always accurate.
//
// Error isolation: each funder's analysis runs inside its own try/catch
// (process step 7) — one funder's bad data or a Claude failure never aborts
// the rest of a run. The Claude call itself retries up to 3 times with
// exponential backoff (1s/2s/4s), the same pattern already proven in
// src/lib/intelligence/embeddings.ts, reused rather than reinvented.
//
// Hard limits: never writes financial/pipeline data (opportunities/outcomes
// are read-only inputs); this agent only writes the analytical
// funder_dna_profiles read-model. No human-approval gate — see the spec's
// "Autonomy level" section: this agent takes no external action and writes
// nothing a human needs to approve before another agent/human reads it.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

/** Bounds a single scheduled run regardless of platform growth — remaining funders roll to next week's run rather than growing one run unboundedly (mirrors AG-26's own per-run cap design). */
const MAX_FUNDERS_PER_SCHEDULED_RUN = 25;

/** Below this many outcomes, a small-sample confidence cap applies regardless of what Claude reports. */
const MIN_SAMPLE_FOR_UNCAPPED_CONFIDENCE = 3;
const SMALL_SAMPLE_CONFIDENCE_CAP = 40;

const REWARD_ANALYSIS_MAX_TOKENS = 800;

const REWARD_SYSTEM_PROMPT =
  "You are the Grant DNA Analysis Agent inside Benavora, an AI-powered nonprofit " +
  "funding intelligence platform. You analyze a specific funder's historical grant " +
  "outcomes to extract real, evidence-backed patterns about what that funder tends " +
  "to reward. Never invent a theme, correlation, or pattern that is not directly " +
  "supported by the outcome and eligibility text you are given - if the evidence is " +
  "genuinely thin, say so with a low confidence score rather than fabricating a " +
  "pattern to sound more useful. You are producing structured data for another " +
  "system, not prose for a human to read directly - respond with ONLY the requested " +
  "JSON, no markdown fences, no commentary before or after it.";

interface FunderRow {
  id: string;
  organization_id: string;
  name: string;
}

interface OpportunityRow {
  id: string;
  organization_id: string;
  funder_id: string;
  eligibility_requirements: string | null;
  required_documents: string[] | null;
  amount_min: number | null;
  amount_max: number | null;
  recurrence: string | null;
}

interface OutcomeRow {
  id: string;
  organization_id: string;
  application_id: string;
  result: string;
  awarded_amount: number | null;
  requested_amount: number | null;
  funder_feedback: string | null;
  denial_reason: string | null;
  recorded_at: string | null;
}

interface RequirementPatterns {
  commonDocuments: { type: string; frequency: number }[];
  awardRange: { min: number | null; max: number | null; median: number | null };
  recurrenceDistribution: Record<string, number>;
}

interface RewardPatterns {
  themes: string[];
  sizeCorrelation: string | null;
  matchedByName: number;
}

interface AnalyzeFunderOutcome {
  outcome: "updated" | "skipped";
  decisionId?: string;
  tokensUsed: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid] ?? null;
  }
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error.";
}

export class GrantDnaAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-10-grant-dna", supabase);
  }

  /**
   * Reads the agent_queue row the worker marked "processing" for this
   * org/agent this run — AutonomousAgent has no queue-item id passed into
   * run(), so the currently-processing row is the only way to recover the
   * event payload (mirrors FollowupGeneratorAgent.loadTriggerPayload).
   * Returns an empty scope, not a throw, when no valid payload is found —
   * a manual/queue-misfire re-run with nothing to scope to is a legitimate
   * zero-item completion, not a failure.
   */
  private async loadEventScope(): Promise<string[]> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as { funderId?: unknown };
    if (typeof payload.funderId !== "string" || payload.funderId.trim() === "") {
      return [];
    }
    return [payload.funderId];
  }

  /**
   * Every funder in this org with ≥1 opportunities row created since its
   * funder_dna_profiles.last_analyzed_at (or no profile row yet at all),
   * capped at MAX_FUNDERS_PER_SCHEDULED_RUN. Used for the weekly schedule
   * trigger and as the fallback scope for any non-"event" trigger source.
   */
  private async loadScheduledScope(): Promise<string[]> {
    const { data: funderRows } = await this.supabase
      .from("funders")
      .select("id")
      .eq("organization_id", this.orgId);
    const funders = (funderRows ?? []) as { id: string }[];
    if (funders.length === 0) return [];

    const { data: profileRows } = await this.supabase
      .from("funder_dna_profiles")
      .select("funder_id, last_analyzed_at")
      .eq("organization_id", this.orgId);
    const lastAnalyzedByFunder = new Map<string, string | null>(
      (profileRows ?? []).map((p) => [
        p.funder_id as string,
        p.last_analyzed_at as string | null,
      ]),
    );

    const scope: string[] = [];
    for (const funder of funders) {
      if (scope.length >= MAX_FUNDERS_PER_SCHEDULED_RUN) break;

      const lastAnalyzedAt = lastAnalyzedByFunder.get(funder.id) ?? null;
      let query = this.supabase
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("funder_id", funder.id);
      if (lastAnalyzedAt) query = query.gt("created_at", lastAnalyzedAt);

      const { count } = await query;
      if ((count ?? 0) > 0) scope.push(funder.id);
    }
    return scope;
  }

  /** Deterministic requirement_patterns — no Claude call. */
  private computeRequirementPatterns(
    opportunities: OpportunityRow[],
  ): RequirementPatterns {
    const docFrequency = new Map<string, number>();
    for (const opp of opportunities) {
      for (const doc of opp.required_documents ?? []) {
        docFrequency.set(doc, (docFrequency.get(doc) ?? 0) + 1);
      }
    }
    const commonDocuments = Array.from(docFrequency.entries())
      .map(([type, frequency]) => ({ type, frequency }))
      .sort((a, b) => b.frequency - a.frequency);

    const mins = opportunities
      .map((o) => o.amount_min)
      .filter((n): n is number => n != null);
    const maxs = opportunities
      .map((o) => o.amount_max)
      .filter((n): n is number => n != null);

    const awardRange = {
      min: mins.length > 0 ? Math.min(...mins) : null,
      max: maxs.length > 0 ? Math.max(...maxs) : null,
      median: median([...mins, ...maxs]),
    };

    const recurrenceDistribution: Record<string, number> = {};
    for (const opp of opportunities) {
      const key = opp.recurrence ?? "unknown";
      recurrenceDistribution[key] = (recurrenceDistribution[key] ?? 0) + 1;
    }

    return { commonDocuments, awardRange, recurrenceDistribution };
  }

  private buildRewardPrompt(
    funderName: string,
    opportunities: OpportunityRow[],
    outcomes: OutcomeRow[],
  ): string {
    const outcomeLines = outcomes
      .map((o) => {
        const ratio =
          o.awarded_amount != null && o.requested_amount
            ? (o.awarded_amount / o.requested_amount).toFixed(2)
            : "n/a";
        return (
          `- Result: ${o.result}. Awarded/requested ratio: ${ratio}. ` +
          `Funder feedback: ${o.funder_feedback ?? "none given"}. ` +
          `Denial reason: ${o.denial_reason ?? "none given"}.`
        );
      })
      .join("\n");

    const eligibilityLines =
      opportunities
        .map((o) => o.eligibility_requirements)
        .filter((t): t is string => !!t && t.trim() !== "")
        .map((t) => `- ${t}`)
        .join("\n") || "(no eligibility requirement text on file for this funder)";

    return (
      `Analyze historical grant outcomes for the funder "${funderName}" to extract what this funder tends to reward.\n\n` +
      `Recorded outcomes for applications to this funder:\n${outcomeLines}\n\n` +
      `Eligibility requirements text from this funder's posted opportunities:\n${eligibilityLines}\n\n` +
      "Extract:\n" +
      "(a) recurring themes that appear across AWARDED applications' stated eligibility/context but are absent or weaker in DENIED ones.\n" +
      "(b) whether award size (the awarded/requested ratio) appears to correlate with any observable factor mentioned in funder feedback " +
      '(e.g. "prioritizes first-time applicants", "favors capital projects over general operating") - or null if no such correlation is evident from the given text.\n' +
      "(c) a 0-100 confidence score for how strongly this specific sample actually supports the patterns you found.\n\n" +
      'Respond with ONLY JSON (no markdown fences, no prose), shaped exactly: {"themes": string[], "sizeCorrelation": string | null, "confidence": number}'
    );
  }

  /** Claude call with 3-attempt exponential backoff (1s/2s/4s), the pattern already proven in src/lib/intelligence/embeddings.ts. */
  private async callClaudeWithRetry(prompt: string): Promise<{
    text: string;
    tokensUsed: number;
  }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await callClaude({
          model: DEFAULT_MODEL,
          maxTokens: REWARD_ANALYSIS_MAX_TOKENS,
          system: REWARD_SYSTEM_PROMPT,
          prompt,
        });
        return { text: response.text, tokensUsed: response.usage.totalTokens };
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Claude call failed after 3 attempts.");
  }

  /**
   * Claude-assisted reward_patterns extraction. Throws on a parse failure
   * (rather than silently defaulting to an empty result) so the caller's
   * per-funder try/catch records it as a real failure — a funder whose
   * extraction genuinely failed should not get a falsely-empty profile
   * written for it.
   */
  private async extractRewardPatterns(
    funderName: string,
    opportunities: OpportunityRow[],
    outcomes: OutcomeRow[],
  ): Promise<{ themes: string[]; sizeCorrelation: string | null; confidence: number; tokensUsed: number }> {
    const prompt = this.buildRewardPrompt(funderName, opportunities, outcomes);
    const { text, tokensUsed } = await this.callClaudeWithRetry(prompt);

    const jsonText = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "");

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      throw new Error(`Could not parse Claude's reward-pattern response as JSON: ${errMsg(err)}`);
    }

    const obj = parsed as {
      themes?: unknown;
      sizeCorrelation?: unknown;
      confidence?: unknown;
    };

    const themes = Array.isArray(obj.themes)
      ? obj.themes.filter((t): t is string => typeof t === "string")
      : [];
    const sizeCorrelation =
      typeof obj.sizeCorrelation === "string" && obj.sizeCorrelation.trim() !== ""
        ? obj.sizeCorrelation
        : null;
    const rawConfidence =
      typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
        ? obj.confidence
        : 0;
    const confidence = Math.max(0, Math.min(100, rawConfidence));

    return { themes, sizeCorrelation, confidence, tokensUsed };
  }

  /**
   * Steps 1-6 of the spec for a single funder. Cross-org name pooling
   * happens here (step 1's "Design note on cross-org scope"): evidence is
   * read across every funders row (any org) whose name case-insensitively
   * matches this org's funder, but the profile row written is always scoped
   * to (this.orgId, funderId).
   */
  private async analyzeFunder(
    runId: string,
    funderId: string,
  ): Promise<AnalyzeFunderOutcome> {
    const { data: funderRow } = await this.supabase
      .from("funders")
      .select("id, organization_id, name")
      .eq("id", funderId)
      .eq("organization_id", this.orgId)
      .maybeSingle();

    if (!funderRow) {
      throw new Error(`Funder ${funderId} not found for this organization.`);
    }
    const funder = funderRow as FunderRow;

    // Cross-org evidence pooling by name (best-effort read-time join, not a
    // real FK — see file header). Degrades gracefully to just this org's own
    // funder row under RLS (a session-scoped client can only see its own
    // org's funders anyway), so this never throws on a missing match.
    const { data: matchedFunderRows } = await this.supabase
      .from("funders")
      .select("id")
      .ilike("name", funder.name.trim());
    const matchedIds = new Set(
      ((matchedFunderRows ?? []) as { id: string }[]).map((f) => f.id),
    );
    matchedIds.add(funder.id);
    const allFunderIds = Array.from(matchedIds);
    const matchedByNameCount = allFunderIds.filter((id) => id !== funder.id).length;

    // Step 1: load evidence — opportunities across every matched funder id.
    const { data: oppRows } = await this.supabase
      .from("opportunities")
      .select(
        "id, organization_id, funder_id, eligibility_requirements, required_documents, amount_min, amount_max, recurrence",
      )
      .in("funder_id", allFunderIds);
    const opportunities = (oppRows ?? []) as OpportunityRow[];

    // Step 2, branch 1: zero opportunities anywhere for this funder — skip
    // entirely, no row written, no decision logged.
    if (opportunities.length === 0) {
      return { outcome: "skipped", tokensUsed: 0 };
    }

    // outcomes joined 2-hop: applications.opportunity_id -> the matched
    // opportunity set (outcomes carries no direct funder_id).
    const oppIds = opportunities.map((o) => o.id);
    const { data: appRows } = await this.supabase
      .from("applications")
      .select("id")
      .in("opportunity_id", oppIds);
    const appIds = ((appRows ?? []) as { id: string }[]).map((a) => a.id);

    let outcomes: OutcomeRow[] = [];
    if (appIds.length > 0) {
      const { data: outcomeRows } = await this.supabase
        .from("outcomes")
        .select(
          "id, organization_id, application_id, result, awarded_amount, requested_amount, funder_feedback, denial_reason, recorded_at",
        )
        .in("application_id", appIds);
      outcomes = (outcomeRows ?? []) as OutcomeRow[];
    }

    // Step 3: deterministic requirement_patterns — always computed once
    // opportunities exist, no Claude call.
    const requirementPatterns = this.computeRequirementPatterns(opportunities);

    // Step 2, branch 2 vs. branch 3 / Step 4: reward_patterns only when
    // outcomes exist; small-sample confidence cap enforced in code.
    let rewardPatterns: RewardPatterns | Record<string, never> = {};
    let confidence: number | null = null;
    let tokensUsed = 0;
    const sampleSize = outcomes.length;

    if (sampleSize > 0) {
      const extraction = await this.extractRewardPatterns(
        funder.name,
        opportunities,
        outcomes,
      );
      tokensUsed += extraction.tokensUsed;

      confidence =
        sampleSize < MIN_SAMPLE_FOR_UNCAPPED_CONFIDENCE
          ? Math.min(extraction.confidence, SMALL_SAMPLE_CONFIDENCE_CAP)
          : extraction.confidence;

      rewardPatterns = {
        themes: extraction.themes,
        sizeCorrelation: extraction.sizeCorrelation,
        matchedByName: matchedByNameCount,
      };
    }

    // Step 5: upsert on (organization_id, funder_id) — full overwrite, never
    // an incremental append (idempotency: see file header).
    const nowIso = new Date().toISOString();
    const { error: upsertError } = await this.supabase
      .from("funder_dna_profiles")
      .upsert(
        {
          organization_id: this.orgId,
          funder_id: funder.id,
          requirement_patterns: requirementPatterns,
          reward_patterns: rewardPatterns,
          typical_award_range_min: requirementPatterns.awardRange.min,
          typical_award_range_max: requirementPatterns.awardRange.max,
          common_eligibility_themes:
            "themes" in rewardPatterns ? rewardPatterns.themes : [],
          common_required_documents: requirementPatterns.commonDocuments.map(
            (d) => d.type,
          ),
          sample_size: sampleSize,
          confidence,
          last_analyzed_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "organization_id,funder_id" },
      );

    if (upsertError) {
      throw new Error(`Failed to upsert funder_dna_profiles: ${upsertError.message}`);
    }

    // Step 6: log a decision for every funder actually updated (both the
    // requirements-only branch and the full branch reach here — only the
    // zero-opportunities skip above never logs one).
    const reasoning =
      sampleSize > 0
        ? `Recomputed funder DNA for "${funder.name}" from ${opportunities.length} opportunity/ies and ${sampleSize} outcome(s) ` +
          `(${matchedByNameCount} funder record(s) pooled cross-org by name match). ` +
          `Requirement patterns are deterministic aggregates over structured columns; reward patterns come from a Claude synthesis over outcome/feedback text, ` +
          `confidence ${confidence}${sampleSize < MIN_SAMPLE_FOR_UNCAPPED_CONFIDENCE ? ` (capped at ${SMALL_SAMPLE_CONFIDENCE_CAP} — sample size ${sampleSize} is below the ${MIN_SAMPLE_FOR_UNCAPPED_CONFIDENCE}-outcome floor for an uncapped score)` : ""}.`
        : `Recomputed requirement patterns for "${funder.name}" from ${opportunities.length} opportunity/ies (${matchedByNameCount} funder record(s) pooled cross-org by name match). ` +
          "No outcomes exist yet for this funder, so reward_patterns is empty and confidence is null — not enough data to say what gets rewarded.";

    const decisionId = await this.logDecision({
      decisionType: "funder_dna_updated",
      agentRunId: runId,
      entityType: "funder",
      entityId: funder.id,
      reasoning,
      confidenceScore: confidence ?? 0,
      actionTaken:
        sampleSize > 0
          ? "updated_dna_profile_with_reward_patterns"
          : "updated_dna_profile_requirements_only",
      actionPayload: {
        requirementPatterns,
        rewardPatterns,
        sampleSize,
        matchedByName: matchedByNameCount,
      },
    });

    return { outcome: "updated", decisionId, tokensUsed };
  }

  override async run(triggerSource: TriggerSource): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let itemsProcessed = 0;
    let skipped = 0;
    let tokensUsed = 0;

    try {
      const funderIds =
        triggerSource === "event"
          ? await this.loadEventScope()
          : await this.loadScheduledScope();

      // Per-funder error isolation (step 7): one bad funder's data never
      // aborts the rest of the run.
      for (const funderId of funderIds) {
        try {
          const result = await this.analyzeFunder(runId, funderId);
          tokensUsed += result.tokensUsed;
          if (result.outcome === "updated") {
            itemsProcessed++;
            if (result.decisionId) decisions.push(result.decisionId);
          } else {
            skipped++;
          }
        } catch (err) {
          errors.push(`funder ${funderId}: ${errMsg(err)}`);
        }
      }

      await this.completeRun(runId, {
        outputSummary:
          `Scoped ${funderIds.length} funder(s): ${itemsProcessed} profile(s) updated, ` +
          `${skipped} skipped (no opportunities on file), ${errors.length} error(s).`,
        itemsFound: funderIds.length,
        itemsProcessed,
        itemsQueued: 0,
        tokensUsed,
        outputPayload: {
          funderIds,
          newOrUpdatedProfiles: itemsProcessed,
          skipped,
          errors,
        },
      });

      return {
        success: true,
        itemsFound: funderIds.length,
        itemsProcessed,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message = errMsg(err) || "Grant DNA analysis failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
