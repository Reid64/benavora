"use strict";
// Grant narrative prompt template (Agent 05 - Narrative Drafting).
//
// Builds the system + user prompt for grant-style drafts (grant narrative,
// budget narrative, impact statement, letter of inquiry, full proposal). The
// prompt enforces BEHAVIORAL_CONTRACTS §9: the model uses ONLY the supplied
// organizational data, flags any gap with [NEEDS INPUT: ...], and never
// fabricates statistics, certifications, partnerships, or promises.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGrantNarrativePrompt = buildGrantNarrativePrompt;
const formatters_1 = require("@/lib/utils/formatters");
/** Human-readable description of each grant template the funder receives. */
const TEMPLATE_BRIEF = {
    grant_narrative: "a grant narrative: a structured proposal covering need, program design, capacity, and intended impact",
    donation_request_letter: "a donation request letter making a concise, compelling case for support",
    budget_narrative: "a budget narrative justifying each line item against the program's activities and the funder's priorities",
    impact_statement: "an impact statement quantifying the outcomes this funding will make possible",
    letter_of_inquiry: "a brief letter of inquiry introducing the organization and gauging the funder's interest before a full proposal",
    full_proposal: "a full grant proposal with all standard sections: summary, need statement, goals and objectives, program design, organizational capacity, budget justification, and evaluation",
};
function formatCurrencyRange(min, max) {
    const fmt = (n) => new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(n);
    if (min != null && max != null)
        return `${fmt(min)} - ${fmt(max)}`;
    if (max != null)
        return `up to ${fmt(max)}`;
    if (min != null)
        return `from ${fmt(min)}`;
    return null;
}
function renderOrganization(context) {
    if (!context) {
        return "No verified organization profile is available. Flag every organizational fact you would need with [NEEDS INPUT: ...].";
    }
    const lines = [];
    const add = (label, value) => {
        if (value !== null && value !== undefined && `${value}`.trim() !== "") {
            lines.push(`- ${label}: ${value}`);
        }
    };
    add("Legal name", context.name);
    add("Also known as", context.dba);
    add("EIN", context.ein);
    add("Tax status", context.taxStatus);
    add("Mission", context.missionStatement);
    add("Vision", context.visionStatement);
    add("Service area", context.serviceArea);
    add("Target population", context.targetPopulation);
    add("Founder", context.founderName);
    add("Annual budget", context.annualBudget != null
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
        }).format(context.annualBudget)
        : null);
    return lines.length > 0
        ? lines.join("\n")
        : "The organization profile exists but is empty. Flag missing facts with [NEEDS INPUT: ...].";
}
function renderKnowledgeEntries(entries) {
    if (entries.length === 0) {
        return "No reusable narrative blocks are available for this template. Build only from the organization profile and Organizational Q&A, and flag any genuine gap with [NEEDS INPUT: ...].";
    }
    return entries
        .map((entry) => `### ${entry.title} (${(0, formatters_1.humanizeEnum)(entry.category)})\n${entry.content.trim()}`)
        .join("\n\n");
}
/**
 * Render "custom" Knowledge Base entries, which the app stores as Q&A pairs
 * (the question is the title, the answer is the content). These hold the bulk
 * of an organization's verified facts, so they are presented as direct answers
 * to extract from - not as background reference - and the model is told to fill
 * narrative sections from them before flagging anything as [NEEDS INPUT].
 */
function renderCustomQA(entries) {
    if (entries.length === 0) {
        return "None provided.";
    }
    return entries
        .map((entry) => `Q: ${entry.title}\nA: ${entry.content.trim()}`)
        .join("\n\n");
}
function renderSuccessPatterns(patterns) {
    if (!patterns?.length) {
        return "None recorded yet for this funder type.";
    }
    return patterns
        .map((p, i) => {
        const example = p.example ? ` - e.g. "${p.example}"` : "";
        return `${i + 1}. ${p.description}${example}`;
    })
        .join("\n");
}
function renderProvenNarratives(narratives) {
    if (narratives.length === 0) {
        return "None available yet for this funder type. Proceed with the verified Knowledge Base content above.";
    }
    return narratives
        .map((narrative, index) => {
        const score = narrative.effectivenessScore != null
            ? ` (effectiveness ${Math.round(narrative.effectivenessScore * 100)}%)`
            : "";
        const section = narrative.sectionType
            ? `${(0, formatters_1.humanizeEnum)(narrative.sectionType)} - ` //
            : "";
        return `${index + 1}. ${section}previously funded${score}:\n${narrative.narrativeText.trim()}`;
    })
        .join("\n\n");
}
/**
 * Build the grant-narrative prompt for the given template type and context.
 * Used by /api/ai/draft for every template except the donation request letter,
 * which has its own dedicated builder.
 */
function buildGrantNarrativePrompt(context, templateType) {
    const orgName = context.organization?.name ?? "this organization";
    const brief = TEMPLATE_BRIEF[templateType] ?? TEMPLATE_BRIEF.grant_narrative;
    const amountRange = formatCurrencyRange(context.opportunity.amountMin, context.opportunity.amountMax);
    // "custom" entries are stored as Q&A pairs and carry most of an org's facts;
    // split them out so the prompt can instruct the model to extract answers from
    // them directly rather than treat them as reference like the typed blocks.
    const typedEntries = context.knowledgeEntries.filter((entry) => entry.category !== "custom");
    const customEntries = context.knowledgeEntries.filter((entry) => entry.category === "custom");
    const system = [
        `You are an expert grant writer for ${orgName}.`,
        "",
        "ABSOLUTE RULES - these override every other instruction:",
        "1. Use ONLY the organizational data provided below. Never invent facts.",
        "2. Never fabricate statistics, metrics, dollar figures, dates, certifications, accreditations, partnerships, or program outcomes that are not present in the provided data.",
        "3. If a required section needs information you were not given, insert a placeholder exactly in this form: [NEEDS INPUT: a short description of what is missing]. Do not guess.",
        "4. Do not promise future programs or outcomes that are not described in the provided program data.",
        "5. Write in a confident, specific, funder-aligned voice. Mirror the structure and language of any 'previously funded' narratives you are given - they have won before.",
        "6. Before flagging ANY section as [NEEDS INPUT], check all Q&A entries. If an answer exists there, use it.",
    ].join("\n");
    const opportunityLines = [
        `- Opportunity: ${context.opportunity.name}`,
        `- Funder: ${context.opportunity.funderName ?? "Unspecified funder"}`,
        `- Category: ${(0, formatters_1.humanizeEnum)(context.opportunity.category)}`,
    ];
    if (amountRange)
        opportunityLines.push(`- Funding available: ${amountRange}`);
    if (context.opportunity.eligibilityRequirements) {
        opportunityLines.push(`- Eligibility / requirements: ${context.opportunity.eligibilityRequirements}`);
    }
    if (context.opportunity.requiredDocuments?.length) {
        opportunityLines.push(`- Required documents: ${context.opportunity.requiredDocuments.join(", ")}`);
    }
    const prompt = [
        `# Task`,
        `Write ${brief} for "${context.opportunity.name}". Match the funder's stated priorities throughout.`,
        "",
        `What the funder is looking for: ${context.opportunity.description?.trim() ||
            "Not stated explicitly - infer from the category and requirements below, and flag anything you cannot ground with [NEEDS INPUT: ...]."}`,
        "",
        "## Opportunity details",
        opportunityLines.join("\n"),
        "",
        "## Verified organization profile",
        renderOrganization(context.organization),
        "",
        "## Reusable narrative blocks (verified Knowledge Base content)",
        renderKnowledgeEntries(typedEntries),
        "",
        "## ORGANIZATIONAL Q&A - extract and use these answers directly to fill narrative sections. Do not flag a section as [NEEDS INPUT] if the answer exists in any Q&A entry below.",
        renderCustomQA(customEntries),
        "",
        "## Previously funded narratives - weight their patterns, structure, and language heavily",
        renderProvenNarratives(context.provenNarratives),
        "",
        "## Winning language patterns for this funder type (apply these throughout)",
        renderSuccessPatterns(context.successPatterns),
        "",
        "## Output",
        "Return only the finished draft text, ready for an editor to review. Use clear section headings where appropriate. Remember: every organizational fact must come from the data above, and every gap must be marked with [NEEDS INPUT: ...].",
    ].join("\n");
    return { system, prompt };
}
