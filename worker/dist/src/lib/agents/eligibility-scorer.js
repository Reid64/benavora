"use strict";
// Eligibility Scoring Agent - AGENTS.md Agent 02.
//
// Evaluates whether the organization qualifies for an opportunity by comparing
// the verified organization profile against the opportunity's eligibility
// requirements, then writes a 0-100 score, an apply/skip/review recommendation,
// and per-criterion reasoning back onto the opportunity record.
//
// Scoring rubric (AGENTS.md Agent 02):
//   80-100 strong match  -> apply
//   60-79  moderate      -> review
//   40-59  weak          -> skip (unless strategic)
//   0-39   poor          -> skip
//
// Per BEHAVIORAL_CONTRACTS §5 the eligibility score and recommendation are set
// ONLY by this agent, never edited manually.
Object.defineProperty(exports, "__esModule", { value: true });
exports.EligibilityScorer = exports.MISMATCH_REASON_THRESHOLD = exports.HIGH_PRIORITY_THRESHOLD = void 0;
exports.parseScoreResponse = parseScoreResponse;
const claude_1 = require("@/lib/ai/claude");
const formatters_1 = require("@/lib/utils/formatters");
const base_agent_1 = require("@/lib/agents/base-agent");
/** Match at or above this percentage auto-flags the opportunity high priority. */
exports.HIGH_PRIORITY_THRESHOLD = 80;
/** Below this match percentage the UI surfaces the specific mismatch reasons. */
exports.MISMATCH_REASON_THRESHOLD = 40;
class EligibilityScorer extends base_agent_1.BaseAgent {
    agentType = "eligibility_scoring";
    model;
    maxTokens;
    constructor(options) {
        super(options);
        this.model = options.model ?? claude_1.DEFAULT_MODEL;
        this.maxTokens = options.maxTokens ?? claude_1.DEFAULT_MAX_TOKENS;
    }
    async execute(input) {
        const opportunityId = input.opportunityId;
        // Opportunity + organization profile, both scoped to the tenant so the
        // agent is correct under the service role client as well (RLS off there).
        const [oppRes, orgRes] = await Promise.all([
            this.client
                .from("opportunities")
                .select("id, name, category, description, eligibility_requirements, geographic_restrictions, amount_min, amount_max")
                .eq("id", opportunityId)
                .eq("organization_id", this.organizationId)
                .single(),
            this.client
                .from("organizations")
                .select("name, tax_status, mission_statement, service_area, target_population, annual_budget")
                .eq("id", this.organizationId)
                .single(),
        ]);
        if (oppRes.error || !oppRes.data) {
            throw new base_agent_1.AgentError("Opportunity not found.", "not_found", 404);
        }
        const opportunity = {
            name: oppRes.data.name,
            category: oppRes.data.category,
            description: oppRes.data.description ?? null,
            eligibilityRequirements: oppRes.data.eligibility_requirements ?? null,
            geographicRestrictions: oppRes.data.geographic_restrictions ?? null,
            amountMin: oppRes.data.amount_min ?? null,
            amountMax: oppRes.data.amount_max ?? null,
        };
        const org = orgRes.data
            ? {
                name: orgRes.data.name,
                taxStatus: orgRes.data.tax_status ?? null,
                missionStatement: orgRes.data.mission_statement ?? null,
                serviceArea: orgRes.data.service_area ?? null,
                targetPopulation: orgRes.data.target_population ?? null,
                annualBudget: orgRes.data.annual_budget ?? null,
            }
            : null;
        const { system, prompt } = buildEligibilityPrompt(org, opportunity);
        const response = await (0, claude_1.callClaude)({
            system,
            prompt,
            model: this.model,
            maxTokens: this.maxTokens,
        });
        const parsed = parseScoreResponse(response.text);
        // The match percentage is the same fit assessment surfaced under its own
        // column (see grants-service mapping); high priority and mismatch reasons
        // derive from it deterministically.
        const matchPercentage = parsed.score;
        const isHighPriority = matchPercentage >= exports.HIGH_PRIORITY_THRESHOLD;
        const mismatchReasons = parsed.failedCriteria.map((c) => `${c.criterion}: ${c.reason}`);
        // Persist the agent-owned fields (BEHAVIORAL_CONTRACTS §5). Scoped by
        // organization_id so a service role write can never cross tenants.
        const { error: updateError } = await this.client
            .from("opportunities")
            .update({
            eligibility_score: parsed.score,
            recommendation: parsed.recommendation,
            recommendation_reasoning: parsed.reasoning,
            match_percentage: matchPercentage,
            is_high_priority: isHighPriority,
            // Store reasons only when they explain a weak match; otherwise clear
            // any stale reasons from a prior, lower-scoring run.
            match_mismatch_reasons: mismatchReasons.length > 0 ? mismatchReasons : null,
            updated_at: new Date().toISOString(),
        })
            .eq("id", opportunityId)
            .eq("organization_id", this.organizationId);
        if (updateError) {
            throw new base_agent_1.AgentError("Failed to save the eligibility score.", "write_failed");
        }
        return {
            data: {
                opportunityId,
                eligibilityScore: parsed.score,
                recommendation: parsed.recommendation,
                recommendationReasoning: parsed.reasoning,
                matchPercentage,
                isHighPriority,
                mismatchReasons,
            },
            outputSummary: `Scored "${opportunity.name}" ${matchPercentage}% match → ${parsed.recommendation}.`,
            itemsFound: 1,
            itemsProcessed: 1,
            tokensUsed: response.usage.totalTokens,
        };
    }
}
exports.EligibilityScorer = EligibilityScorer;
// --- prompt ------------------------------------------------------------------
function formatCurrency(amount) {
    if (amount == null)
        return null;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(amount);
}
function buildEligibilityPrompt(org, opportunity) {
    const system = [
        "You are a nonprofit grants analyst scoring how well an organization fits a funding opportunity.",
        "",
        "RULES:",
        "1. Judge ONLY from the organizational facts provided. Never invent facts about the organization.",
        "2. Where a fact needed to judge a criterion is missing, treat it as unknown and lower confidence for that criterion - do not assume it qualifies.",
        "3. Score 0-100 using this rubric: 80-100 strong match (apply); 60-79 moderate (review); 40-59 weak (skip unless strategic); 0-39 poor (skip).",
        "4. Weigh five criteria: mission alignment, geographic match, tax-status qualification, budget appropriateness, and program relevance.",
        "5. In `failed_criteria`, list ONLY the criteria (by name) that the organization fails or weakly meets, each with a one-sentence reason naming the specific eligibility requirement that does not fit. Use [] when the organization clearly meets every criterion.",
        "6. Respond with ONLY a single JSON object, no prose, no code fences, in exactly this shape:",
        '{"score": <integer 0-100>, "recommendation": "apply" | "review" | "skip", "reasoning": "<one paragraph covering each of the five criteria>", "failed_criteria": [{"criterion": "<criterion name>", "reason": "<one sentence>"}]}',
    ].join("\n");
    const orgLines = [];
    const add = (label, value) => {
        if (value != null && `${value}`.trim() !== "") {
            orgLines.push(`- ${label}: ${value}`);
        }
    };
    if (org) {
        add("Legal name", org.name);
        add("Tax status", org.taxStatus);
        add("Mission", org.missionStatement);
        add("Service area", org.serviceArea);
        add("Target population", org.targetPopulation);
        add("Annual budget", formatCurrency(org.annualBudget));
    }
    const orgBlock = orgLines.length > 0
        ? orgLines.join("\n")
        : "No verified organization profile is available. Score conservatively and explain that missing profile data limits confidence.";
    const oppLines = [
        `- Name: ${opportunity.name}`,
        `- Category: ${(0, formatters_1.humanizeEnum)(opportunity.category)}`,
    ];
    const amountRange = [
        formatCurrency(opportunity.amountMin),
        formatCurrency(opportunity.amountMax),
    ];
    if (amountRange[0] || amountRange[1]) {
        oppLines.push(`- Award range: ${amountRange[0] ?? "?"} - ${amountRange[1] ?? "?"}`);
    }
    if (opportunity.description) {
        oppLines.push(`- What the funder wants: ${opportunity.description}`);
    }
    if (opportunity.eligibilityRequirements) {
        oppLines.push(`- Eligibility requirements: ${opportunity.eligibilityRequirements}`);
    }
    if (opportunity.geographicRestrictions) {
        oppLines.push(`- Geographic restrictions: ${opportunity.geographicRestrictions}`);
    }
    const prompt = [
        "## Organization",
        orgBlock,
        "",
        "## Opportunity",
        oppLines.join("\n"),
        "",
        "Score the eligibility now. Return ONLY the JSON object described above.",
    ].join("\n");
    return { system, prompt };
}
/** Parse the model's `failed_criteria` array, tolerating omissions/bad shapes. */
function parseFailedCriteria(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        if (!item || typeof item !== "object")
            continue;
        const obj = item;
        const criterion = typeof obj.criterion === "string" ? obj.criterion.trim() : "";
        const reason = typeof obj.reason === "string" ? obj.reason.trim() : "";
        if (criterion && reason)
            out.push({ criterion, reason });
    }
    return out;
}
/** Map a score to the rubric's recommendation. Used as a fallback. */
function recommendationFromScore(score) {
    if (score >= 80)
        return "apply";
    if (score >= 60)
        return "review";
    return "skip";
}
/**
 * Extract score/recommendation/reasoning from the model's reply. Tolerant of
 * stray prose or code fences around the JSON: it scans for the first balanced
 * object. Falls back to deriving the recommendation from the score when the
 * model omits or mis-spells it, so a usable result is always returned.
 */
function parseScoreResponse(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
        throw new base_agent_1.AgentError("The eligibility model returned an unreadable response.", "bad_model_output");
    }
    let raw;
    try {
        raw = JSON.parse(text.slice(start, end + 1));
    }
    catch {
        throw new base_agent_1.AgentError("The eligibility model returned malformed JSON.", "bad_model_output");
    }
    const obj = (raw ?? {});
    const scoreNum = Number(obj.score);
    const score = Number.isFinite(scoreNum)
        ? Math.max(0, Math.min(100, Math.round(scoreNum)))
        : 0;
    const rawRec = typeof obj.recommendation === "string"
        ? obj.recommendation.trim().toLowerCase()
        : "";
    const recommendation = rawRec === "apply" || rawRec === "review" || rawRec === "skip"
        ? rawRec
        : recommendationFromScore(score);
    const reasoning = typeof obj.reasoning === "string" && obj.reasoning.trim() !== ""
        ? obj.reasoning.trim()
        : "No reasoning was provided by the model.";
    return {
        score,
        recommendation,
        reasoning,
        failedCriteria: parseFailedCriteria(obj.failed_criteria),
    };
}
