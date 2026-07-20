"use strict";
// Corporate donation request prompt template (Agent 05 - Narrative Drafting).
//
// Builds the system + user prompt for a corporate donation request letter. The
// tone is warmer and more relationship-oriented than a formal grant narrative,
// but the same BEHAVIORAL_CONTRACTS §9 guardrails apply: use only verified
// organizational data, flag gaps with [NEEDS INPUT: ...], never fabricate.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDonationRequestPrompt = buildDonationRequestPrompt;
const formatters_1 = require("@/lib/utils/formatters");
function formatAsk(min, max) {
    const fmt = (n) => new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(n);
    if (max != null)
        return fmt(max);
    if (min != null)
        return fmt(min);
    return null;
}
function renderOrganization(context) {
    if (!context) {
        return "No verified organization profile is available. Flag every organizational fact with [NEEDS INPUT: ...].";
    }
    const lines = [];
    const add = (label, value) => {
        if (value && value.trim() !== "")
            lines.push(`- ${label}: ${value}`);
    };
    add("Legal name", context.name);
    add("Also known as", context.dba);
    add("Tax status", context.taxStatus);
    add("Mission", context.missionStatement);
    add("Service area", context.serviceArea);
    add("Target population", context.targetPopulation);
    add("Founder", context.founderName);
    return lines.length > 0
        ? lines.join("\n")
        : "The organization profile exists but is empty. Flag missing facts with [NEEDS INPUT: ...].";
}
function renderKnowledgeEntries(entries) {
    if (entries.length === 0) {
        return "No reusable narrative blocks are available. Build only from the organization profile above and flag gaps with [NEEDS INPUT: ...].";
    }
    return entries
        .map((entry) => `### ${entry.title} (${(0, formatters_1.humanizeEnum)(entry.category)})\n${entry.content.trim()}`)
        .join("\n\n");
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
        return `${index + 1}. previously funded${score}:\n${narrative.narrativeText.trim()}`;
    })
        .join("\n\n");
}
/**
 * Build the donation-request-letter prompt for the given context. Used by
 * /api/ai/draft when the selected template type is donation_request_letter.
 */
function buildDonationRequestPrompt(context) {
    const orgName = context.organization?.name ?? "this organization";
    const funder = context.opportunity.funderName ?? "the company";
    const ask = formatAsk(context.opportunity.amountMin, context.opportunity.amountMax);
    const system = [
        `You are a development director writing on behalf of ${orgName}.`,
        "",
        "ABSOLUTE RULES - these override every other instruction:",
        "1. Use ONLY the organizational data provided below. Never invent facts.",
        "2. Never fabricate statistics, dollar figures, dates, certifications, partnerships, or outcomes that are not present in the provided data.",
        "3. If you need information you were not given, insert a placeholder exactly in this form: [NEEDS INPUT: a short description of what is missing]. Do not guess.",
        "4. Keep it to a concise, warm, professional letter - typically three to five short paragraphs.",
        "5. Mirror the language and structure of any 'previously funded' narratives provided.",
    ].join("\n");
    const prompt = [
        "# Task",
        `Write a corporate donation request letter from ${orgName} to ${funder}.`,
        "",
        "Structure the letter as: (1) a warm opening that connects the organization's mission to the company's community values, (2) the specific need and who it serves, (3) the concrete ask and how the gift will be used, (4) a gracious close with a clear next step.",
        "",
        `What ${funder} cares about / program details: ${context.opportunity.description?.trim() ||
            "Not stated - keep the appeal grounded in the organization's mission and the community need, and flag anything you cannot ground with [NEEDS INPUT: ...]."}`,
        ask ? `\nSuggested ask amount: ${ask}.` : "",
        "",
        "## Verified organization profile",
        renderOrganization(context.organization),
        "",
        "## Reusable narrative blocks (verified Knowledge Base content)",
        renderKnowledgeEntries(context.knowledgeEntries),
        "",
        "## Previously funded narratives - weight their patterns and language heavily",
        renderProvenNarratives(context.provenNarratives),
        "",
        "## Output",
        "Return only the finished letter text, ready for an editor to review. Every organizational fact must come from the data above; mark every gap with [NEEDS INPUT: ...].",
    ].join("\n");
    return { system, prompt };
}
