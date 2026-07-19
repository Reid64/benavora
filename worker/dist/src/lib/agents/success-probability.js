"use strict";
// Success Probability Agent - AGENTS.md Agent 22.
//
// Calculates per-application funding probability using 6 data-driven factors
// (BEHAVIORAL_CONTRACTS §25). No Claude call required — purely data arithmetic.
//
// Factor weights (max points sum to 100):
//   1. Eligibility Score   0-25
//   2. Giving History      0-20
//   3. Track Record        0-20
//   4. Deadline Proximity  0-10
//   5. Competition Density 0-10
//   6. Narrative Quality   0-15
//
// Insufficient data for any factor: use midpoint, mark factor as 'estimated'
// (BEHAVIORAL_CONTRACTS §25). Minimum 3 outcomes needed for Factor 3.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuccessProbabilityAgent = void 0;
const date_fns_1 = require("date-fns");
const base_agent_1 = require("../../lib/agents/base-agent");
class SuccessProbabilityAgent extends base_agent_1.BaseAgent {
    agentType = "success_probability";
    async execute(input) {
        const { applicationId } = input;
        const { data: application, error: appError } = await this.client
            .from("applications")
            .select("id, opportunity_id, organization_id")
            .eq("id", applicationId)
            .eq("organization_id", this.organizationId)
            .single();
        if (appError || !application) {
            throw new base_agent_1.AgentError("Application not found.", "not_found", 404);
        }
        if (!application.opportunity_id) {
            throw new base_agent_1.AgentError("Application has no linked opportunity.", "invalid_state", 422);
        }
        const { data: opportunity, error: oppError } = await this.client
            .from("opportunities")
            .select("id, name, category, funder_id, deadline, eligibility_score")
            .eq("id", application.opportunity_id)
            .eq("organization_id", this.organizationId)
            .single();
        if (oppError || !opportunity) {
            throw new base_agent_1.AgentError("Opportunity not found.", "not_found", 404);
        }
        const [givingRes, outcomesRes, competitorRes, narrativesRes] = await Promise.all([
            opportunity.funder_id
                ? this.client
                    .from("funder_giving_history")
                    .select("id", { count: "exact", head: true })
                    .eq("funder_id", opportunity.funder_id)
                    .eq("organization_id", this.organizationId)
                : Promise.resolve({ count: null }),
            opportunity.category
                ? this.client
                    .from("outcomes")
                    .select("result")
                    .eq("organization_id", this.organizationId)
                    .eq("funder_category", opportunity.category)
                : Promise.resolve({ data: null }),
            this.client
                .from("competitor_tracking")
                .select("competition_level")
                .eq("organization_id", this.organizationId)
                .eq("opportunity_id", application.opportunity_id)
                .order("observed_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
            opportunity.category
                ? this.client
                    .from("proven_narratives")
                    .select("effectiveness_score")
                    .eq("organization_id", this.organizationId)
                    .eq("funder_category", opportunity.category)
                : Promise.resolve({ data: null }),
        ]);
        const f1 = scoreEligibility(opportunity.eligibility_score);
        const f2 = scoreGivingHistory(givingRes.count);
        const f3 = scoreTrackRecord(outcomesRes.data);
        const f4 = scoreDeadlineProximity(opportunity.deadline);
        const f5 = scoreCompetitionDensity(competitorRes.data
            ?.competition_level ?? null);
        const f6 = scoreNarrativeQuality(narrativesRes.data);
        const probabilityScore = Math.max(0, Math.min(100, Math.round(f1.score + f2.score + f3.score + f4.score + f5.score + f6.score)));
        const allFactors = [f1, f2, f3, f4, f5, f6];
        const estimatedCount = allFactors.filter((f) => f.estimated).length;
        const dataQuality = estimatedCount === allFactors.length
            ? "estimated"
            : estimatedCount > 0
                ? "partial"
                : "full";
        const factors = {
            eligibilityScore: f1,
            givingHistoryMatch: f2,
            trackRecord: f3,
            deadlineProximity: f4,
            competitionDensity: f5,
            narrativeQuality: f6,
        };
        const { error: upsertError } = await this.client
            .from("success_probability_scores")
            .upsert({
            organization_id: this.organizationId,
            application_id: applicationId,
            probability_score: probabilityScore,
            factors,
            data_quality: dataQuality,
            calculated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }, { onConflict: "application_id" });
        if (upsertError) {
            throw new base_agent_1.AgentError("Failed to save probability score.", "write_failed");
        }
        return {
            data: { applicationId, probabilityScore, factors, dataQuality },
            outputSummary: `Success probability for application: ${probabilityScore}% (${dataQuality}).`,
            itemsFound: 1,
            itemsProcessed: 1,
        };
    }
}
exports.SuccessProbabilityAgent = SuccessProbabilityAgent;
// --- factor scoring -----------------------------------------------------------
function scoreEligibility(raw) {
    if (raw == null) {
        return {
            score: 13,
            maxScore: 25,
            estimated: true,
            reason: "No eligibility score yet; using midpoint.",
        };
    }
    return {
        score: Math.round((raw / 100) * 25),
        maxScore: 25,
        estimated: false,
        reason: `Eligibility score ${raw}/100.`,
    };
}
function scoreGivingHistory(count) {
    if (count == null) {
        return {
            score: 10,
            maxScore: 20,
            estimated: true,
            reason: "No funder giving history available; using midpoint.",
        };
    }
    if (count === 0) {
        return {
            score: 10,
            maxScore: 20,
            estimated: true,
            reason: "Funder has no giving history on record; using midpoint.",
        };
    }
    const score = count <= 5 ? 15 : 20;
    return {
        score,
        maxScore: 20,
        estimated: false,
        reason: `${count} funder giving history record${count === 1 ? "" : "s"} found.`,
    };
}
const MIN_OUTCOMES_FOR_TRACK_RECORD = 3;
function scoreTrackRecord(outcomes) {
    if (!outcomes || outcomes.length < MIN_OUTCOMES_FOR_TRACK_RECORD) {
        return {
            score: 10,
            maxScore: 20,
            estimated: true,
            reason: outcomes
                ? `Only ${outcomes.length} outcome${outcomes.length === 1 ? "" : "s"} for this funder category (need ${MIN_OUTCOMES_FOR_TRACK_RECORD}); using midpoint.`
                : "No outcomes for this funder category; using midpoint.",
        };
    }
    const awarded = outcomes.filter((o) => o.result === "awarded").length;
    const winRate = awarded / outcomes.length;
    return {
        score: Math.round(winRate * 20),
        maxScore: 20,
        estimated: false,
        reason: `${awarded}/${outcomes.length} wins in this funder category (${Math.round(winRate * 100)}%).`,
    };
}
function scoreDeadlineProximity(deadline) {
    if (!deadline) {
        return {
            score: 5,
            maxScore: 10,
            estimated: true,
            reason: "No deadline set; using midpoint.",
        };
    }
    const days = (0, date_fns_1.differenceInCalendarDays)(new Date(deadline), new Date());
    const score = days > 90 ? 10 : days > 60 ? 8 : days > 30 ? 6 : days > 14 ? 4 : days > 7 ? 2 : 0;
    return {
        score,
        maxScore: 10,
        estimated: false,
        reason: `${days} day${days === 1 ? "" : "s"} until deadline.`,
    };
}
const COMPETITION_SCORES = {
    low: 10,
    medium: 7,
    high: 4,
    very_high: 1,
};
function scoreCompetitionDensity(level) {
    if (!level) {
        return {
            score: 5,
            maxScore: 10,
            estimated: true,
            reason: "No competition data available; using midpoint.",
        };
    }
    return {
        score: COMPETITION_SCORES[level] ?? 5,
        maxScore: 10,
        estimated: false,
        reason: `Competition level: ${level.replace("_", " ")}.`,
    };
}
function scoreNarrativeQuality(narratives) {
    if (!narratives || narratives.length === 0) {
        return {
            score: 8,
            maxScore: 15,
            estimated: true,
            reason: "No proven narratives for this funder category; using midpoint.",
        };
    }
    const highScoring = narratives.filter((n) => n.effectiveness_score != null && n.effectiveness_score > 70).length;
    const score = narratives.length >= 3 && highScoring >= 2
        ? 15
        : narratives.length >= 3
            ? 12
            : 10;
    return {
        score,
        maxScore: 15,
        estimated: false,
        reason: `${narratives.length} proven narrative${narratives.length === 1 ? "" : "s"} (${highScoring} high-effectiveness).`,
    };
}
