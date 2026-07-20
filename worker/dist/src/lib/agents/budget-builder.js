"use strict";
// Budget Builder Agent - AGENTS.md Agent 06.
//
// Creates a project budget (structured line items by standard grant category)
// and a budget narrative for a grant application, using ONLY the organization's
// program financial data (BEHAVIORAL_CONTRACTS §9). It calls Claude with the
// budget-narrative prompt, parses the structured result, and records the
// narrative as a note on the application (or the opportunity when no application
// is supplied) so the work is persisted, not just returned.
Object.defineProperty(exports, "__esModule", { value: true });
exports.BudgetBuilderAgent = void 0;
exports.parseBudgetResponse = parseBudgetResponse;
const claude_1 = require("@/lib/ai/claude");
const budget_narrative_1 = require("@/lib/ai/prompts/budget-narrative");
const base_agent_1 = require("@/lib/agents/base-agent");
class BudgetBuilderAgent extends base_agent_1.BaseAgent {
    agentType = "budget_builder";
    model;
    maxTokens;
    constructor(options) {
        super(options);
        this.model = options.model ?? claude_1.DEFAULT_MODEL;
        this.maxTokens = options.maxTokens ?? claude_1.DEFAULT_MAX_TOKENS;
    }
    async execute(input) {
        const opportunityId = input.opportunityId;
        const { data: opp, error } = await this.client
            .from("opportunities")
            .select("id, name, category, funder_id, eligibility_requirements, amount_min, amount_max")
            .eq("id", opportunityId)
            .eq("organization_id", this.organizationId)
            .single();
        if (error || !opp) {
            throw new base_agent_1.AgentError("Opportunity not found.", "not_found", 404);
        }
        const [orgRes, programsRes, funderRes] = await Promise.all([
            this.client
                .from("organizations")
                .select("name, annual_budget")
                .eq("id", this.organizationId)
                .single(),
            this.client
                .from("programs")
                .select("name, description, budget, beneficiaries_served")
                .eq("organization_id", this.organizationId),
            opp.funder_id
                ? this.client
                    .from("funders")
                    .select("name")
                    .eq("id", opp.funder_id)
                    .eq("organization_id", this.organizationId)
                    .single()
                : Promise.resolve({ data: null }),
        ]);
        const org = orgRes.data;
        const { system, prompt } = (0, budget_narrative_1.buildBudgetNarrativePrompt)({
            organizationName: org?.name ?? "the organization",
            annualBudget: org?.annual_budget ?? null,
            funderName: funderRes.data?.name ?? null,
            opportunityName: opp.name,
            category: opp.category,
            requestedAmount: input.requestedAmount ?? null,
            amountMin: opp.amount_min ?? null,
            amountMax: opp.amount_max ?? null,
            budgetRequirements: opp.eligibility_requirements ?? null,
            programs: (programsRes.data ?? []).map((p) => ({
                name: p.name,
                description: p.description ?? null,
                budget: p.budget ?? null,
                beneficiariesServed: p.beneficiaries_served ?? null,
            })),
        });
        const response = await (0, claude_1.callClaude)({
            system,
            prompt,
            model: this.model,
            maxTokens: this.maxTokens,
        });
        const parsed = parseBudgetResponse(response.text);
        // Persist the narrative as a note (best effort - a notes failure must not
        // fail the run). Exactly one parent FK, per the notes CHECK constraint.
        const noteContent = formatBudgetNote(parsed);
        if (input.applicationId) {
            await this.client.from("notes").insert({
                organization_id: this.organizationId,
                application_id: input.applicationId,
                content: noteContent,
                author_id: this.triggeredBy,
            });
        }
        else {
            await this.client.from("notes").insert({
                organization_id: this.organizationId,
                opportunity_id: opportunityId,
                content: noteContent,
                author_id: this.triggeredBy,
            });
        }
        return {
            data: {
                opportunityId,
                lineItems: parsed.lineItems,
                totalRequested: parsed.totalRequested,
                narrative: parsed.narrative,
            },
            outputSummary: `Built a budget for "${opp.name}" (${parsed.lineItems.length} line items).`,
            itemsFound: parsed.lineItems.length,
            itemsProcessed: parsed.lineItems.length,
            tokensUsed: response.usage.totalTokens,
        };
    }
}
exports.BudgetBuilderAgent = BudgetBuilderAgent;
// --- formatting --------------------------------------------------------------
function formatCurrency(amount) {
    if (amount == null)
        return "[NEEDS INPUT]";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(amount);
}
function formatBudgetNote(result) {
    const lines = result.lineItems.map((li) => `- ${li.category}: ${formatCurrency(li.amount)} - ${li.justification}`);
    return [
        "**Budget**",
        "",
        ...lines,
        "",
        `**Total requested:** ${formatCurrency(result.totalRequested)}`,
        "",
        "**Budget Narrative**",
        "",
        result.narrative,
    ].join("\n");
}
// --- response parsing --------------------------------------------------------
function toIntOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : null;
}
/**
 * Parse the budget JSON. Tolerant of stray prose/code fences. Throws AgentError
 * on unreadable output so the run is logged as failed.
 */
function parseBudgetResponse(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
        throw new base_agent_1.AgentError("The budget model returned an unreadable response.", "bad_model_output");
    }
    let raw;
    try {
        raw = JSON.parse(text.slice(start, end + 1));
    }
    catch {
        throw new base_agent_1.AgentError("The budget model returned malformed JSON.", "bad_model_output");
    }
    const obj = (raw ?? {});
    const lineItems = Array.isArray(obj.lineItems)
        ? obj.lineItems
            .map((item) => {
            const li = (item ?? {});
            const category = typeof li.category === "string" ? li.category.trim() : "";
            if (category === "")
                return null;
            return {
                category,
                amount: toIntOrNull(li.amount),
                justification: typeof li.justification === "string"
                    ? li.justification.trim()
                    : "",
            };
        })
            .filter((li) => li !== null)
        : [];
    const narrative = typeof obj.narrative === "string" && obj.narrative.trim() !== ""
        ? obj.narrative.trim()
        : "No budget narrative was provided by the model.";
    return {
        lineItems,
        totalRequested: toIntOrNull(obj.totalRequested),
        narrative,
    };
}
