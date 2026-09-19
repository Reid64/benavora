#!/usr/bin/env node
// AR-17.2 scoring-family deep-dive.
//
// READ-ONLY. GET-only against PostgREST, same discipline as AR-17.1's
// output-quality-sampler.mjs. This script exists because that sampler's
// OUTPUT_LOCATIONS registry points several PIL agents at a whole nested
// report object (e.g. "output.report") rather than the specific score
// field inside it -- fine for AR-17.1's generic pass, but useless for
// telling whether the *score itself* is degenerate, since two reports
// almost never serialize identically even when their score field is
// constant. This script re-targets each scoring agent at its real score
// field (dot-path into jsonb, confirmed against source in the citation
// below each entry) and, for agents whose scores live inside an array
// (one run can score N candidates), flattens across the array before
// computing variance/nullity/grounding.
//
// Usage: node scripts/audit/scoring-family-deep-dive.mjs [--json]

import { readFileSync } from "node:fs";
import {
  extractPath,
  isEmptyValue,
  computeVariance,
  computeNullity,
  computeBoilerplate,
  computeGrounding,
  computeStaleness,
} from "./output-quality-sampler.mjs";

function loadEnv() {
  const env = readFileSync(".env.local", "utf8");
  const pick = (k) =>
    (new RegExp(`^${k}=(.+)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  const url = pick("NEXT_PUBLIC_SUPABASE_URL") || pick("SUPABASE_URL");
  const key = pick("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase credentials missing from .env.local");
  return { url, key };
}
const ENV = loadEnv();

async function pgGet(query, headers = {}) {
  const r = await fetch(`${ENV.url}/rest/v1/${query}`, {
    headers: { apikey: ENV.key, Authorization: `Bearer ${ENV.key}`, ...headers },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`SELECT failed: ${query.split("?")[0]}: HTTP ${r.status} ${body.slice(0, 300)}`);
  }
  return r;
}
async function pgCount(query) {
  const r = await pgGet(query, { Prefer: "count=exact", Range: "0-0" });
  const n = Number((r.headers.get("content-range") ?? "").split("/")[1]);
  return Number.isFinite(n) ? n : 0;
}
async function pgSelect(query) {
  return (await pgGet(query)).json();
}

// Every entry: agentType, family, table, dateColumn, agentFilter, valueType,
// scorePath (dot-path to the score/probability/confidence field), evidencePaths,
// arrayPath (set when the score lives inside a per-row array -- scorePath is
// then relative to each array element), citation (file:line for the field name).
export const SCORING_ENTRIES = [
  {
    agentType: "eligibility_scoring", family: "core", table: "opportunities",
    dateColumn: "updated_at", agentFilter: "eligibility_score=not.is.null",
    valueType: "numeric", scorePath: "eligibility_score",
    evidencePaths: ["recommendation_reasoning"],
    contract: "eligibility-scorer.ts header: sets {eligibility_score, recommendation, recommendation_reasoning, match_percentage, is_high_priority, match_mismatch_reasons} on opportunities -- these columns are set ONLY by this agent.",
    citation: "src/lib/agents/eligibility-scorer.ts:190-204",
  },
  {
    agentType: "success_probability", family: "core", table: "success_probability_scores",
    dateColumn: "calculated_at", agentFilter: null,
    valueType: "numeric", scorePath: "probability_score",
    evidencePaths: ["factors"],
    contract: "success-probability.ts: upserts {probability_score, factors} into success_probability_scores.",
    citation: "src/lib/agents/success-probability.ts:171-184",
  },
  {
    agentType: "ag-29-fundability", family: "autonomous", table: "fundability_scores",
    dateColumn: "generated_at", agentFilter: null,
    valueType: "numeric", scorePath: "overall_score",
    evidencePaths: ["deficiencies"],
    contract: "fundability-scorer-agent.ts: inserts {overall_score, deficiencies} into fundability_scores.",
    citation: "src/lib/agents/fundability-scorer-agent.ts:1029-1042",
  },
  {
    agentType: "ag-15-probability", family: "autonomous", table: "opportunity_probability_scores",
    dateColumn: "computed_at", agentFilter: null,
    valueType: "numeric", scorePath: "overall_score",
    evidencePaths: ["factors", "key_risks", "key_strengths"],
    contract: "probability-scoring-agent.ts: upserts {overall_score, factors, key_risks, key_strengths} into opportunity_probability_scores.",
    citation: "src/lib/agents/probability-scoring-agent.ts:902-919",
  },
  {
    agentType: "funder_relationship", family: "core", table: "funder_relationship_scores",
    dateColumn: "updated_at", agentFilter: null,
    valueType: "numeric", scorePath: "relationship_score",
    evidencePaths: ["recent_events"],
    contract: "funder-relationship.ts: upserts {relationship_score, recent_events} into funder_relationship_scores.",
    citation: "src/lib/agents/funder-relationship.ts:195-215",
  },
  {
    agentType: "ag-30-donor-intent", family: "autonomous", table: "corporate_intent_signals",
    dateColumn: "signal_date", agentFilter: null,
    valueType: "numeric", scorePath: "intent_score",
    evidencePaths: ["signal_summary", "signal_url"],
    contract: "donor-intent-monitor-agent.ts: inserts {intent_score, signal_summary, signal_url} into corporate_intent_signals.",
    citation: "src/lib/agents/donor-intent-monitor-agent.ts:851-855",
  },
  {
    agentType: "ag-17-discovery", family: "autonomous", table: "opportunities",
    dateColumn: "created_at", agentFilter: "source=eq.agent",
    valueType: "numeric", scorePath: "eligibility_score",
    evidencePaths: [],
    contract: "opportunity-discovery-agent.ts: inserts opportunities rows with eligibility_score set at discovery time (source=agent) -- a second, distinct writer of the same column eligibility_scoring updates later.",
    citation: "src/lib/agents/opportunity-discovery-agent.ts:785-786",
  },
  {
    agentType: "autoapply_risk_engine", family: "autoapply", table: "submission_queue",
    dateColumn: "created_at", agentFilter: "risk_score=not.is.null",
    valueType: "numeric", scorePath: "risk_score",
    evidencePaths: ["risk_factors"],
    contract: "risk-engine.ts RiskAssessment{score,classification,factors,recommendation,shouldNotify} -- deterministic rule-based points sum, not a Claude call. Only .score persists to submission_queue.risk_score (flat numeric); .factors persists separately to submission_queue.risk_factors.",
    citation: "src/lib/autoapply/risk-engine.ts:15-32; worker/queue-processor.ts:1230-1238",
  },
  {
    agentType: "ag22_propensity_scoring", family: "autonomous", table: "corporate_prospects",
    dateColumn: "scores_computed_at", agentFilter: "scores_computed_at=not.is.null",
    valueType: "numeric", scorePath: "scores.PS-01.score",
    evidencePaths: ["scores.PS-01.rationale", "scores.PS-01.top_factors"],
    contract: "ag-22-propensity-scoring.ts PropensityScoreValue{score,rationale,top_factors} per rubric PS-01..PS-10; PS-01 = 'Overall Donation Likelihood', the headline number. clampScore() defaults unparseable Claude output to 0, never a fabricated midpoint (comment at :190).",
    citation: "src/lib/agents/ag-22-propensity-scoring.ts:190-195,243-252,567-570",
  },
  {
    agentType: "BEN-QLF-01", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-QLF-01",
    valueType: "numeric", scorePath: "output.report.overallScore",
    evidencePaths: ["output.report.evidenceRefs", "output.report.confidence"],
    contract: "MissionAffinityReport{causeAlignmentScore,populationAlignmentScore,programAlignmentScore,geographicAlignmentScore,recencyScore,overallScore,confidence,evidenceRefs,counterevidence,unscoredDimensions}",
    citation: "src/lib/pil/agents/qlf/BEN-QLF-01.ts:101-116",
  },
  {
    agentType: "BEN-QLF-02", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-QLF-02",
    valueType: "numeric", scorePath: "output.report.fundingEligibilityScore",
    evidencePaths: ["output.report.evidenceRefs", "output.report.disqualifyingReasons"],
    contract: "FundingEligibilityReport{eligible,applicantClassPass,...,fundingEligibilityScore,confidence,disqualifyingReasons,evidenceRefs}",
    citation: "src/lib/pil/agents/qlf/BEN-QLF-02.ts:212-228",
  },
  {
    agentType: "BEN-QLF-03", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-QLF-03",
    valueType: "numeric", scorePath: "output.report.propensityScore",
    evidencePaths: ["output.report.evidenceRefs", "output.report.uncertaintyNotes"],
    contract: "CapacityPropensityReport{capacityEstimateLow,capacityEstimateHigh,capacityConfidence,propensityScore,propensityConfidence,giftMagnitudePattern,vehicleUse,causeRelevanceScore,uncertaintyNotes,evidenceRefs}",
    citation: "src/lib/pil/agents/qlf/BEN-QLF-03.ts:111-131",
  },
  {
    agentType: "BEN-QLF-04", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-QLF-04",
    valueType: "numeric", scorePath: "output.report.overallScore",
    evidencePaths: ["output.report.disqualificationReasons", "output.report.confidence"],
    contract: "QualificationReport{dimensionScores,overallScore,classification,decision,disqualificationReasons,belowThresholdDimensions,confidence} -- classification/decision are the primary answer per AR-17.1's own citation.",
    citation: "src/lib/pil/agents/qlf/BEN-QLF-04.ts:206-218",
  },
  {
    agentType: "BEN-QLF-04-classification", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-QLF-04",
    valueType: "categorical", scorePath: "output.report.classification",
    evidencePaths: ["output.report.disqualificationReasons"],
    contract: "Same run as BEN-QLF-04 -- classification is the categorical decision customers actually see (vs. overallScore, the numeric input to it).",
    citation: "src/lib/pil/agents/qlf/BEN-QLF-04.ts:206-218",
  },
  {
    agentType: "BEN-QLF-05", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-QLF-05",
    valueType: "numeric", scorePath: "output.report.tenantReadinessScore",
    evidencePaths: ["output.report.evidenceRefs", "output.report.unscoredDimensions"],
    contract: "TimingReadinessReport{timingStatus,applicationWindowOpen,triggerRecencyDays,relationshipMaturityScore,tenantReadinessScore,documentReadinessScore,monitorConditions,stalenessFlags,confidence}",
    citation: "src/lib/pil/agents/qlf/BEN-QLF-05.ts:184-200",
  },
  {
    agentType: "BEN-KNW-01", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-KNW-01",
    valueType: "numeric", scorePath: "output.report.completenessScore",
    evidencePaths: ["output.report.conflictedFields", "output.report.researchGaps"],
    contract: "DigitalTwinReport{twinVersion,completenessScore,conflictedFields,researchGaps,contradictionsOpen} -- internal data-quality metric, not a customer-facing donor score.",
    citation: "src/lib/pil/agents/knw/BEN-KNW-01.ts:97-104",
  },
  {
    agentType: "BEN-KNW-03", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-KNW-03",
    valueType: "numeric", scorePath: "output.report.evidenceQualityScore",
    evidencePaths: ["output.report.unsupportedClaims"],
    contract: "EvidenceProvenanceReport{...,evidenceQualityScore,claimSupportScore,sourceDirectnessScore,sourceIndependenceScore,...} -- internal evidence-integrity metric, not customer-facing.",
    citation: "src/lib/pil/agents/knw/BEN-KNW-03.ts:221-239",
  },
  {
    agentType: "BEN-REL-04", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-REL-04",
    valueType: "numeric", scorePath: "output.decision.overlapConfidence",
    evidencePaths: [],
    contract: "RelationshipGraphBuilder decision{overlapInstitution,roleType,simultaneity,recurrence,interactionEvidence,overlapConfidence} -- internal graph-edge confidence, not customer-facing.",
    citation: "src/lib/pil/agents/rel/BEN-REL-04.ts:305-314",
  },
  {
    agentType: "BEN-STR-02", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-STR-02",
    valueType: "numeric", scorePath: "output.report.propensityScore",
    evidencePaths: ["output.report.capacityScore", "output.report.missionAffinityScore"],
    contract: "BestFirstAskReport{askType,capacityScore,propensityScore,missionAffinityScore,recommendedAskLow,recommendedAskHigh,relationshipStage,fallbackAsks} -- feeds the recommended dollar ask shown to fundraisers.",
    citation: "src/lib/pil/agents/str/BEN-STR-02.ts:84-96",
  },
  {
    agentType: "BEN-SUP-04", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-SUP-04",
    valueType: "numeric", arrayPath: "output.scored", scorePath: "prospectScore",
    evidencePaths: [],
    contract: "allocation scoring: conclusions.scored[] = {runId,prospectId,value,depthAchieved,proximityToGoal,prospectScore} -- one entry per active research run scored this cycle; internal allocation weighting, not customer-facing.",
    citation: "src/lib/pil/agents/sup/BEN-SUP-04.ts:138-247",
  },
  {
    agentType: "BEN-APP-01", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-APP-01",
    valueType: "numeric", arrayPath: "output.report.recommendations", scorePath: "successProbability",
    evidenceItemPaths: ["strategicReasoning", "riskFactors"],
    contract: "ApplicationRecommendation{requestType,requestProfileId,successProbability,recommendationStatus,strategicReasoning,fieldMappings,pitchParameters,riskFactors,relationshipStrategy,confidence,sequence} -- successProbability is the number shown per matched request profile.",
    citation: "src/lib/pil/agents/app/BEN-APP-01.ts:290-297",
  },
  {
    agentType: "BEN-APP-01-confidence", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-APP-01",
    valueType: "numeric", arrayPath: "output.report.recommendations", scorePath: "confidence",
    evidenceItemPaths: ["strategicReasoning"],
    contract: "Same recommendations array as BEN-APP-01 -- confidence is the agent's stated confidence in successProbability, checked separately for the UNGROUNDED CONFIDENCE failure mode (a high score whose own confidence field is empty or always identical).",
    citation: "src/lib/pil/agents/app/BEN-APP-01.ts:290-297",
  },
  {
    agentType: "BEN-APP-02", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-APP-02",
    valueType: "numeric", arrayPath: "output.report.ranked", scorePath: "priorityScore",
    evidenceItemPaths: ["reasoning"],
    contract: "PriorityRankingReport ranked[]{priorityScore,priorityPercentile,priorityRecommendation,scoreBreakdown,reasoning,nextStep} -- priorityScore drives the application priority queue order.",
    citation: "src/lib/pil/agents/app/BEN-APP-02.ts:255-270",
  },
  {
    agentType: "BEN-KNW-02", family: "pil", table: "pil_agent_runs",
    dateColumn: "created_at", agentFilter: "agent_id=eq.BEN-KNW-02",
    valueType: "numeric", arrayPath: "output.results", scorePath: "matchScore",
    evidenceItemPaths: ["signals"],
    contract: "EntityResolutionPairResult[]{prospectIdA,prospectIdB,matchScore,status,signals,merged,survivingProspectId,requiresHumanReview} -- matchScore drives automatic dedup merges.",
    citation: "src/lib/pil/agents/knw/BEN-KNW-02.ts:70-80",
  },
  {
    agentType: "consensus_validation", family: "autoapply", table: "validations",
    dateColumn: "updated_at", agentFilter: null,
    valueType: "numeric", scorePath: "confidence",
    evidencePaths: ["details"],
    contract: "consensus-validator.ts parseVerdict(): on any parse failure returns {verdict:'unverifiable', confidence:0} -- confidence 0 here is an HONEST low-confidence signal, not a silent midpoint default (worth contrasting with ag22's clampScore(0) default, which looks identical in the distribution table but means something different).",
    citation: "src/lib/agents/consensus-validator.ts:168-206,320",
  },
];

async function fetchNewestInputTimestamp() {
  return null; // staleness input-source mapping is out of scope for this deep-dive; AR-17.1's sampler covers it for entries it has inputTable configured for.
}

async function assessScoringEntry(entry, { sampleSize = 500 } = {}) {
  const filterQS = entry.agentFilter ? `&${entry.agentFilter}` : "";
  const table = entry.table;
  const topCol = String(entry.arrayPath ?? entry.scorePath).split(".")[0];
  const dateCol = entry.dateColumn;

  let total;
  try {
    total = await pgCount(`${table}?select=id${filterQS}`);
  } catch (err) {
    return { ...entry, status: "QUERY_ERROR", reason: err.message };
  }
  if (total === 0) {
    return { ...entry, status: "INSUFFICIENT_SAMPLE", n: 0, note: "zero output rows found at the located destination" };
  }

  const [oldestRow] = await pgSelect(`${table}?select=${dateCol}${filterQS}&order=${dateCol}.asc.nullslast&limit=1`);
  const [newestRow] = await pgSelect(`${table}?select=${dateCol}${filterQS}&order=${dateCol}.desc.nullslast&limit=1`);
  const dateRange = { oldest: oldestRow?.[dateCol] ?? null, newest: newestRow?.[dateCol] ?? null };

  const evidenceTopCols = entry.arrayPath ? [] : (entry.evidencePaths ?? []).map((p) => p.split(".")[0]);
  const selectCols = [...new Set([dateCol, topCol, ...evidenceTopCols])].join(",");
  const rows = await pgSelect(`${table}?select=${selectCols}${filterQS}&order=${dateCol}.desc.nullslast&limit=${sampleSize}`);
  const recentRaw = await pgSelect(`${table}?select=*${filterQS}&order=${dateCol}.desc.nullslast&limit=5`);

  if (total < 5) {
    return { ...entry, status: "INSUFFICIENT_SAMPLE", n: total, dateRange, recentOutputsVerbatim: recentRaw, note: `fewer than 5 output rows exist (n=${total}) -- scarcity itself is the finding` };
  }

  let values, evidenceRowsForGrounding, groundingPaths;
  if (entry.arrayPath) {
    const relPath = entry.arrayPath.split(".").slice(1).join(".");
    values = [];
    evidenceRowsForGrounding = [];
    for (const row of rows) {
      const container = topCol === entry.arrayPath ? row[topCol] : extractPath(row, entry.arrayPath);
      const arr = Array.isArray(container) ? container : (relPath ? extractPath({ [topCol]: row[topCol] }, entry.arrayPath) : null);
      const list = Array.isArray(arr) ? arr : (Array.isArray(container) ? container : []);
      for (const item of list) {
        values.push(item?.[entry.scorePath]);
        evidenceRowsForGrounding.push(item ?? {});
      }
    }
    groundingPaths = entry.evidenceItemPaths ?? [];
  } else {
    values = rows.map((row) => extractPath(row, entry.scorePath));
    evidenceRowsForGrounding = rows;
    groundingPaths = entry.evidencePaths ?? [];
  }

  const variance = computeVariance(values);
  const nullity = computeNullity(values);
  const boilerplate = entry.valueType === "text" ? computeBoilerplate(values) : { applicable: false, reason: `valueType is "${entry.valueType}", not text` };
  const grounding = computeGrounding(evidenceRowsForGrounding, groundingPaths);
  const staleness = computeStaleness(dateRange.newest, null);

  return {
    ...entry,
    status: "ASSESSED",
    n_total: total,
    n_values: values.length,
    sampleCap: sampleSize,
    dateRange,
    variance,
    nullity,
    boilerplate,
    grounding,
    staleness,
    recentOutputsVerbatim: recentRaw,
  };
}

async function main() {
  const asJson = process.argv.includes("--json");
  console.error("READ-ONLY: GET-only against PostgREST. Never calls Claude, never executes an agent.\n");
  const results = [];
  for (const entry of SCORING_ENTRIES) {
    process.stderr.write(`assessing ${entry.agentType} ...\n`);
    try {
      const result = await assessScoringEntry(entry);
      results.push(result);
    } catch (err) {
      results.push({ ...entry, status: "QUERY_ERROR", reason: err.stack || err.message });
    }
  }
  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      console.log(`\n${"=".repeat(78)}\n${r.agentType} [${r.family}] status=${r.status}`);
      if (r.status === "ASSESSED") {
        console.log(`n_total=${r.n_total} n_values=${r.n_values} dateRange=${JSON.stringify(r.dateRange)}`);
        console.log(`distinctCount=${r.variance.distinctCount} distribution=${JSON.stringify(r.variance.distribution)}`);
        console.log(`nullity=${(r.nullity.nullity * 100).toFixed(1)}%`);
        console.log(`grounding=${r.grounding.configured ? `${r.grounding.groundedCount}/${r.grounding.n} (${(r.grounding.groundedFraction * 100).toFixed(1)}%)` : "not configured"}`);
      } else {
        console.log(JSON.stringify(r, null, 2));
      }
    }
  }
}

const isMain = process.argv[1]?.endsWith("scoring-family-deep-dive.mjs");
if (isMain) {
  main().catch((err) => {
    console.error("FATAL:", err.stack || err.message);
    process.exit(1);
  });
}
