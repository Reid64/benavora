"use strict";
// Core draft generation logic shared by the interactive /api/ai/draft route and
// the autonomous DraftAutoGenerator. Extracted so there is exactly one code path
// for all draft generation — manual and automatic.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATE_SECTION_TYPES = exports.TEMPLATE_KB_CATEGORIES = exports.VALID_TEMPLATE_TYPES = void 0;
exports.extractTopPatterns = extractTopPatterns;
exports.computeConfidence = computeConfidence;
exports.buildDetailedRubricSection = buildDetailedRubricSection;
exports.generateDraft = generateDraft;
const claude_1 = require("../../lib/ai/claude");
const grant_narrative_1 = require("../../lib/ai/prompts/grant-narrative");
const donation_request_1 = require("../../lib/ai/prompts/donation-request");
const rag_retrieval_1 = require("../../lib/intelligence/rag-retrieval");
const need_statement_engine_1 = require("../../lib/intelligence/need-statement-engine");
const logic_model_generator_1 = require("../../lib/intelligence/logic-model-generator");
const budget_patterns_1 = require("../../lib/intelligence/budget-patterns");
const evaluation_library_1 = require("../../lib/intelligence/evaluation-library");
const compliance_library_1 = require("../../lib/intelligence/compliance-library");
exports.VALID_TEMPLATE_TYPES = [
    "grant_narrative",
    "donation_request_letter",
    "budget_narrative",
    "impact_statement",
    "letter_of_inquiry",
    "full_proposal",
];
// Which Knowledge Base categories feed each template type.
exports.TEMPLATE_KB_CATEGORIES = {
    grant_narrative: [
        "mission",
        "vision",
        "need_statement",
        "program_description",
        "impact",
        "capacity",
        "sustainability",
        "partnerships",
        "organizational_history",
        "budget_justification",
    ],
    donation_request_letter: [
        "mission",
        "need_statement",
        "impact",
        "program_description",
    ],
    budget_narrative: [
        "budget_justification",
        "program_description",
        "capacity",
        "sustainability",
    ],
    impact_statement: ["impact", "mission", "program_description"],
    letter_of_inquiry: [
        "mission",
        "need_statement",
        "program_description",
        "impact",
    ],
    full_proposal: [
        "mission",
        "vision",
        "need_statement",
        "program_description",
        "impact",
        "capacity",
        "sustainability",
        "partnerships",
        "budget_justification",
        "organizational_history",
    ],
};
// Which intelligence section types are most relevant per template.
exports.TEMPLATE_SECTION_TYPES = {
    grant_narrative: [
        "executive_summary",
        "need_statement",
        "problem_framing",
        "program_design",
        "outcomes",
        "methodology",
    ],
    donation_request_letter: ["executive_summary", "need_statement"],
    budget_narrative: ["budget_narrative"],
    impact_statement: ["outcomes", "evaluation_plan"],
    letter_of_inquiry: [
        "executive_summary",
        "need_statement",
        "program_design",
    ],
    full_proposal: [
        "executive_summary",
        "need_statement",
        "problem_framing",
        "program_design",
        "outcomes",
        "evaluation_plan",
        "sustainability",
        "budget_narrative",
        "methodology",
        "capacity",
        "partnerships",
    ],
};
/**
 * Pull the winning_patterns from the first proven_narrative row that has a
 * non-null success_patterns JSONB.
 */
function extractTopPatterns(rawPatterns) {
    for (const raw of rawPatterns) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            continue;
        const analysis = raw;
        if (Array.isArray(analysis.winning_patterns) &&
            analysis.winning_patterns.length > 0) {
            return analysis.winning_patterns
                .filter((p) => typeof p === "object" &&
                p !== null &&
                typeof p.description === "string")
                .slice(0, 3);
        }
    }
    return [];
}
/**
 * Heuristic confidence score. Reflects how much of the draft is grounded in
 * verified data versus AI-generated content.
 */
function computeConfidence(draftText, kbCount, provenCount) {
    const needsInput = (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;
    if (kbCount === 0) {
        return Math.max(55, 65 - needsInput * 3);
    }
    let score = 92;
    if (provenCount === 0)
        score -= 4;
    if (kbCount < 3)
        score -= 12;
    score -= needsInput * 3;
    return Math.max(0, Math.min(100, score));
}
/**
 * Parse rubric dimensions jsonb into a detailed prompt section and a
 * client-facing summary.
 */
function buildDetailedRubricSection(rubric) {
    const dims = rubric.dimensions;
    const dimensionSummary = [];
    const lines = [
        "SCORING OPTIMIZATION — This grant will be evaluated by reviewers using the following scoring dimensions.",
        "For each section you write, mentally score it against the relevant dimension. If a section would score below 80% of available points, rewrite it to be more specific and evidence-based.\n",
    ];
    const processDim = (name, val) => {
        if (!val || typeof val !== "object" || Array.isArray(val)) {
            const points = typeof val === "number" ? val : null;
            dimensionSummary.push({ name, points, description: null });
            lines.push(`• ${name}${points !== null ? ` (${points} pts)` : ""}`);
            return;
        }
        const d = val;
        const points = typeof d.points === "number" ? d.points : null;
        const description = typeof d.description === "string" ? d.description : null;
        const deductions = Array.isArray(d.common_deductions)
            ? d.common_deductions
            : [];
        dimensionSummary.push({ name, points, description });
        lines.push(`• ${name}${points !== null ? ` (${points} pts)` : ""}`);
        if (description)
            lines.push(`  - Full marks: ${description}`);
        if (deductions.length > 0)
            lines.push(`  - Avoid: ${deductions.join("; ")}`);
    };
    if (Array.isArray(dims)) {
        for (const item of dims) {
            if (!item || typeof item !== "object" || Array.isArray(item))
                continue;
            const d = item;
            const name = typeof d.name === "string" ? d.name : "Unnamed";
            processDim(name, {
                points: d.points,
                description: d.description,
                common_deductions: d.common_deductions,
            });
        }
    }
    else {
        for (const [name, val] of Object.entries(dims)) {
            processDim(name, val);
        }
    }
    return { promptText: lines.join("\n"), dimensionSummary };
}
/** Map opportunity source_type + category to a budget grantType string. */
function resolveGrantType(sourceType, category) {
    const src = (sourceType ?? "").toLowerCase();
    const cat = (category ?? "").toLowerCase();
    if (["grants_gov", "sam_gov", "federal"].some((k) => src.includes(k)))
        return "federal";
    if (["state", "portal"].some((k) => src.includes(k)))
        return "state";
    if (["foundation", "propublica", "private"].some((k) => src.includes(k)))
        return "foundation";
    if (src.includes("corporate"))
        return "corporate";
    if (["federal", "government"].some((k) => cat.includes(k)))
        return "federal";
    if (cat.includes("state"))
        return "state";
    if (["foundation", "private"].some((k) => cat.includes(k)))
        return "foundation";
    return "federal";
}
/**
 * Core draft generation function. Loads org knowledge, queries the intelligence
 * library, constructs and augments the prompt, calls Claude, computes confidence,
 * and saves the draft_version row. Returns all artifacts needed by callers.
 *
 * Callers are responsible for auth enforcement, tier gating, billing metering,
 * audit logging, and agent_run lifecycle management.
 */
async function generateDraft(params) {
    const { supabase, organizationId, opportunityId, templateType, createdByUserId = null, draftSource = "generated", } = params;
    // Resolve platform config (model, token budget).
    const { data: configRows } = await supabase
        .from("platform_config")
        .select("key, value")
        .in("key", ["ai.model", "ai.max_tokens"]);
    const configMap = new Map((configRows ?? []).map((r) => [r.key, r.value]));
    const model = configMap.get("ai.model") ?? claude_1.DEFAULT_MODEL;
    const maxTokens = Number(configMap.get("ai.max_tokens")) || claude_1.DEFAULT_MAX_TOKENS;
    // Opportunity (expected to be already verified by the caller).
    const { data: opportunity, error: oppError } = await supabase
        .from("opportunities")
        .select("*")
        .eq("id", opportunityId)
        .single();
    if (oppError || !opportunity) {
        throw new Error(`Opportunity ${opportunityId} not found.`);
    }
    // Parallel data load: org profile, KB (template categories), KB (custom),
    // proven narratives for funder category, and funder name.
    const [orgRes, kbResA, kbResB, provenRes, funderRes] = await Promise.all([
        supabase
            .from("organizations")
            .select("name, dba, ein, tax_status, mission_statement, vision_statement, service_area, target_population, founder_name, annual_budget")
            .eq("id", organizationId)
            .single(),
        supabase
            .from("knowledge_base")
            .select("id, title, category, content, is_proven, updated_at")
            .in("category", exports.TEMPLATE_KB_CATEGORIES[templateType])
            .order("is_proven", { ascending: false })
            .order("updated_at", { ascending: false }),
        supabase
            .from("knowledge_base")
            .select("id, title, category, content, is_proven, updated_at")
            .eq("category", "custom")
            .order("is_proven", { ascending: false })
            .order("updated_at", { ascending: false }),
        supabase
            .from("proven_narratives")
            .select("id, narrative_text, section_type, funder_category, effectiveness_score, success_patterns")
            .eq("funder_category", opportunity.category)
            .order("effectiveness_score", { ascending: false, nullsFirst: false })
            .limit(5),
        opportunity.funder_id
            ? supabase
                .from("funders")
                .select("name")
                .eq("id", opportunity.funder_id)
                .single()
            : Promise.resolve({ data: null }),
    ]);
    const org = orgRes.data;
    // Merge template-category KB + custom KB; deduplicate by id; re-sort.
    const kbMerged = [...(kbResA.data ?? []), ...(kbResB.data ?? [])];
    const kbSeen = new Set();
    const kbDeduped = kbMerged.filter((entry) => {
        const id = entry.id;
        if (kbSeen.has(id))
            return false;
        kbSeen.add(id);
        return true;
    });
    kbDeduped.sort((a, b) => {
        const aProven = Boolean(a.is_proven);
        const bProven = Boolean(b.is_proven);
        if (aProven !== bProven)
            return bProven ? 1 : -1;
        const aDate = a.updated_at ?? "";
        const bDate = b.updated_at ?? "";
        return bDate.localeCompare(aDate);
    });
    const knowledgeEntries = kbDeduped.map((entry) => ({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        content: entry.content,
    }));
    const provenNarratives = (provenRes.data ?? []).map((p) => ({
        id: p.id,
        sectionType: p.section_type ?? null,
        funderCategory: p.funder_category ?? null,
        effectivenessScore: p.effectiveness_score ?? null,
        narrativeText: p.narrative_text,
    }));
    const successPatterns = extractTopPatterns((provenRes.data ?? []).map((p) => p.success_patterns));
    const context = {
        organization: org
            ? {
                name: org.name,
                dba: org.dba ?? null,
                ein: org.ein ?? null,
                taxStatus: org.tax_status ?? null,
                missionStatement: org.mission_statement ?? null,
                visionStatement: org.vision_statement ?? null,
                serviceArea: org.service_area ?? null,
                targetPopulation: org.target_population ?? null,
                founderName: org.founder_name ?? null,
                annualBudget: org.annual_budget ?? null,
            }
            : null,
        opportunity: {
            name: opportunity.name,
            category: opportunity.category,
            description: opportunity.description ?? null,
            funderName: funderRes.data?.name ?? null,
            eligibilityRequirements: opportunity.eligibility_requirements ?? null,
            amountMin: opportunity.amount_min ?? null,
            amountMax: opportunity.amount_max ?? null,
            requiredDocuments: opportunity.required_documents ?? null,
        },
        knowledgeEntries,
        provenNarratives,
        successPatterns: successPatterns.length > 0 ? successPatterns : undefined,
    };
    // ---------------------------------------------------------------------------
    // Intelligence Library RAG retrieval. Non-blocking: failures fall through.
    // ---------------------------------------------------------------------------
    let intelligenceSections = [];
    let intelligenceRubric = null;
    let intelligenceLogicModel = null;
    let needDataPoints = [];
    const oppDescLower = (opportunity.description ?? "").toLowerCase();
    const oppEligLower = (opportunity.eligibility_requirements ?? "").toLowerCase();
    const LOGIC_MODEL_KEYWORDS = [
        "logic model",
        "theory of change",
        "program design",
    ];
    const needsLogicModel = templateType === "full_proposal" ||
        LOGIC_MODEL_KEYWORDS.some((kw) => oppDescLower.includes(kw) || oppEligLower.includes(kw));
    {
        const queryText = [
            opportunity.description,
            opportunity.name,
            opportunity.eligibility_requirements,
        ]
            .filter(Boolean)
            .join(" ");
        const sectionTypes = exports.TEMPLATE_SECTION_TYPES[templateType];
        // Templates that include a need statement benefit from live government data.
        const needsNeedData = templateType === "grant_narrative" ||
            templateType === "letter_of_inquiry" ||
            templateType === "full_proposal";
        try {
            [intelligenceSections, intelligenceRubric, intelligenceLogicModel] =
                await Promise.all([
                    (0, rag_retrieval_1.retrieveIntelligence)({ queryText, sectionTypes, limit: 5 }).catch((e) => {
                        console.error("[INTELLIGENCE] retrieveIntelligence failed:", e.message);
                        return [];
                    }),
                    (0, rag_retrieval_1.retrieveRubric)({
                        funderName: context.opportunity.funderName ?? undefined,
                        category: context.opportunity.category,
                    }).catch((e) => {
                        console.error("[INTELLIGENCE] retrieveRubric failed:", e.message);
                        return null;
                    }),
                    needsLogicModel
                        ? (0, rag_retrieval_1.retrieveLogicModel)(context.opportunity.category).catch((e) => {
                            console.error("[INTELLIGENCE] retrieveLogicModel failed:", e.message);
                            return null;
                        })
                        : Promise.resolve(null),
                ]);
            // Gather need data for the org's service area when the template includes
            // a need statement section. Non-blocking: a failure returns empty array.
            if (needsNeedData && org?.service_area) {
                const serviceArea = org.service_area.trim();
                // Derive state from a "City, ST" or "County, ST" or plain "ST" pattern
                const statePart = serviceArea.split(',').pop()?.trim() ?? serviceArea;
                if (statePart.length >= 2) {
                    needDataPoints = await new need_statement_engine_1.NeedStatementEngine()
                        .gatherNeedData({ state: statePart }, [])
                        .catch((e) => {
                        console.error("[INTELLIGENCE] gatherNeedData failed:", e.message);
                        return [];
                    });
                }
            }
        }
        catch (e) {
            console.error("[INTELLIGENCE] RAG retrieval failed:", e.message);
        }
    }
    // Rubric fallback: infer from opportunity details if library has no match.
    if (!intelligenceRubric) {
        const oppDesc = (opportunity.description ?? "").slice(0, 800);
        const oppName = opportunity.name;
        if (oppDesc || oppName) {
            try {
                const inferPrompt = [
                    "You are an expert grant reviewer.",
                    "Based on this grant opportunity, infer the most likely scoring dimensions reviewers will use.",
                    "",
                    `Grant: ${oppName}`,
                    `Category: ${context.opportunity.category}`,
                    `Description: ${oppDesc}`,
                    "",
                    "Return ONLY valid JSON (no markdown fences, no explanation):",
                    '{"dimensions":{"Dimension Name":{"points":20,"description":"What earns full marks on this dimension","common_deductions":["vague language","missing data"]}}}',
                    "",
                    "Include 4-6 dimensions appropriate for this grant type and funder category.",
                ].join("\n");
                const inferResponse = await (0, claude_1.callClaude)({
                    system: "You are a grant scoring expert. Return only valid JSON, no markdown, no extra text.",
                    prompt: inferPrompt,
                    model,
                    maxTokens: 600,
                });
                const jsonMatch = inferResponse.text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.dimensions &&
                        typeof parsed.dimensions === "object" &&
                        !Array.isArray(parsed.dimensions)) {
                        intelligenceRubric = {
                            id: "inferred",
                            source: "inferred",
                            source_url: null,
                            funder_name: context.opportunity.funderName,
                            grant_program: oppName,
                            category: [context.opportunity.category],
                            dimensions: parsed.dimensions,
                            full_text: null,
                        };
                        // Cache for future calls. Non-fatal if the insert fails.
                        try {
                            await supabase.from("intelligence_scoring_rubrics").insert({
                                source: "inferred",
                                grant_program: oppName,
                                category: [context.opportunity.category],
                                dimensions: parsed.dimensions,
                            });
                        }
                        catch (cacheErr) {
                            console.error("[INTELLIGENCE] Inferred rubric cache failed:", cacheErr.message);
                        }
                    }
                }
            }
            catch (inferErr) {
                console.error("[INTELLIGENCE] Rubric inference failed:", inferErr.message);
            }
        }
    }
    // Logic model: prefer RAG result, fall back to AI generation when needed.
    let generatedLogicModel = null;
    {
        const toStrArr = (v) => Array.isArray(v)
            ? v.filter((x) => typeof x === "string")
            : [];
        if (intelligenceLogicModel) {
            generatedLogicModel = {
                inputs: toStrArr(intelligenceLogicModel.inputs),
                activities: toStrArr(intelligenceLogicModel.activities),
                outputs: toStrArr(intelligenceLogicModel.outputs),
                outcomes: toStrArr(intelligenceLogicModel.outcomes),
                impact: toStrArr(intelligenceLogicModel.impact),
                category: context.opportunity.category,
                templateBased: true,
            };
        }
        else if (needsLogicModel) {
            try {
                const programDescription = knowledgeEntries
                    .filter((e) => e.category === "program_description")
                    .map((e) => e.content)
                    .join(" ") ||
                    context.organization?.missionStatement ||
                    "";
                generatedLogicModel = await (0, logic_model_generator_1.generateLogicModel)({
                    category: context.opportunity.category,
                    programDescription,
                    organizationName: context.organization?.name ?? "",
                    targetPopulation: context.organization?.targetPopulation ?? undefined,
                    geography: context.organization?.serviceArea ?? undefined,
                });
            }
            catch (lmErr) {
                console.error("[INTELLIGENCE] generateLogicModel failed:", lmErr.message);
            }
        }
    }
    // ---------------------------------------------------------------------------
    // Budget patterns, evaluation KPIs, and compliance intelligence
    // ---------------------------------------------------------------------------
    const grantType = resolveGrantType(opportunity.source_type, opportunity.category);
    const needsBudgetPatterns = templateType === "budget_narrative" || templateType === "full_proposal";
    const needsEvaluationKPIs = exports.TEMPLATE_SECTION_TYPES[templateType].includes("evaluation_plan");
    let budgetTemplate = null;
    let evaluationKPIs = [];
    let complianceChecklist = null;
    try {
        const budgetLib = new budget_patterns_1.BudgetPatternLibrary();
        const evalLib = new evaluation_library_1.EvaluationLibrary();
        const [budgetRes, evalRes] = await Promise.all([
            needsBudgetPatterns
                ? budgetLib
                    .getTemplateByCategory(opportunity.category, grantType)
                    .catch((e) => {
                    console.error("[INTELLIGENCE] budget patterns failed:", e.message);
                    return null;
                })
                : Promise.resolve(null),
            needsEvaluationKPIs
                ? evalLib.getKPIs(opportunity.category).catch((e) => {
                    console.error("[INTELLIGENCE] evaluation KPIs failed:", e.message);
                    return [];
                })
                : Promise.resolve([]),
        ]);
        budgetTemplate = budgetRes;
        evaluationKPIs = evalRes ?? [];
        // Compliance — always run for all template types.
        const complianceLib = new compliance_library_1.ComplianceLibrary();
        const complianceReqs = complianceLib.getRequirements(opportunity.category, opportunity.source_type ?? "");
        complianceChecklist = complianceLib.checkCompliance({
            documents: Array.isArray(opportunity.required_documents)
                ? opportunity.required_documents
                : [],
        }, complianceReqs);
    }
    catch (e) {
        console.error("[INTELLIGENCE] budget/eval/compliance failed:", e.message);
    }
    // Build prompt.
    const built = templateType === "donation_request_letter"
        ? (0, donation_request_1.buildDonationRequestPrompt)(context)
        : (0, grant_narrative_1.buildGrantNarrativePrompt)(context, templateType);
    // Augment with intelligence context.
    let rubricDimensionSummary = [];
    let enhancedPrompt = built.prompt;
    if (intelligenceSections.length > 0) {
        const excerpts = intelligenceSections
            .map((s, i) => `[Example ${i + 1}] Source: ${s.funder_name ?? "Unknown funder"} | Year: ${s.award_year ?? "N/A"} | Section: ${s.section_type} | Quality: ${s.quality_score ?? "N/A"}/10\n${s.section_text}`)
            .join("\n\n---\n\n");
        enhancedPrompt +=
            "\n\nINTELLIGENCE CONTEXT — These are excerpts from funded proposals in similar categories. Use their structure, patterns, and level of specificity as guidance:\n\n" +
                excerpts;
    }
    if (intelligenceRubric) {
        const { promptText, dimensionSummary } = buildDetailedRubricSection(intelligenceRubric);
        rubricDimensionSummary = dimensionSummary;
        enhancedPrompt += "\n\n" + promptText;
    }
    if (needDataPoints.length > 0) {
        const dataTable = needDataPoints
            .slice(0, 20) // cap to avoid bloating the context window
            .map((d) => `- ${d.metric}: ${d.value.toLocaleString()} (${d.geography}, ${d.year}) [Citation: ${d.citation}]`)
            .join("\n");
        enhancedPrompt +=
            "\n\nNEED STATEMENT DATA — These statistics are sourced from authoritative government databases for the organization's service area. " +
                "When writing the need statement section, use these figures with the provided citations. " +
                "Do NOT fabricate statistics not present here. Include parenthetical citations (e.g., 'U.S. Census Bureau ACS, 2022') after each statistic.\n\n" +
                dataTable;
    }
    if (generatedLogicModel) {
        const formattedModel = (0, logic_model_generator_1.formatLogicModelAsText)(generatedLogicModel);
        enhancedPrompt +=
            "\n\nPROGRAM LOGIC MODEL — Use this as the structural backbone for the program design section:\n" +
                formattedModel;
    }
    if (budgetTemplate !== null) {
        const budgetLib = new budget_patterns_1.BudgetPatternLibrary();
        const indirectGuidance = budgetLib.getIndirectCostRateGuidance(grantType);
        const lineItemsText = budgetTemplate.lineItems
            .map((item) => `- ${item.name} (${item.category}): typical ${item.typicalPctMin}–${item.typicalPctMax}% of budget.\n  Example: "${item.justificationExample}"`)
            .join("\n");
        const costPrinciplesText = budgetTemplate.lineItems
            .map((item) => {
            const refs = budgetLib.getFederalCostPrinciples(item.category);
            return `${item.category}:\n${refs.map((r) => `  - ${r}`).join("\n")}`;
        })
            .join("\n");
        enhancedPrompt +=
            "\n\nBUDGET PATTERNS — Typical line items and justification language for this grant type:\n" +
                lineItemsText +
                "\n\nINDIRECT COST GUIDANCE:\n" +
                indirectGuidance +
                "\n\nFEDERAL COST PRINCIPLES:\n" +
                costPrinciplesText;
    }
    if (evaluationKPIs.length > 0) {
        const kpiText = evaluationKPIs
            .slice(0, 8)
            .map((k) => `- ${k.name}: ${k.definition} (Target: ${k.target_range}; Measured by: ${k.measurement_method}; Source: ${k.data_source}; Frequency: ${k.frequency})`)
            .join("\n");
        enhancedPrompt +=
            "\n\nEVALUATION KPIs — Include these measurable outcomes in the evaluation plan section. " +
                "Use specific targets and measurement methods as shown:\n" +
                kpiText;
    }
    if (complianceChecklist !== null) {
        const actionItems = complianceChecklist.items
            .filter((i) => i.status === "fail" || i.status === "warning")
            .slice(0, 10)
            .map((i) => `- [${i.severity.toUpperCase()}] ${i.requirementName}: ${i.message} (${i.citation})`)
            .join("\n");
        if (actionItems) {
            enhancedPrompt +=
                "\n\nCOMPLIANCE REQUIREMENTS NEEDING ATTENTION — Flag these items explicitly in the draft " +
                    "where relevant and note what the applicant must provide:\n" +
                    actionItems;
        }
    }
    const response = await (0, claude_1.callClaude)({
        system: built.system,
        prompt: enhancedPrompt,
        model,
        maxTokens,
    });
    let draftText = response.text;
    if (response.stopReason === "max_tokens") {
        console.error(`[DRAFT] Output truncated at ${maxTokens} tokens for org=${organizationId} opp=${opportunityId}`);
        draftText +=
            "\n\n[Draft truncated — regenerate with a more specific template type for complete output]";
    }
    let confidenceScore = computeConfidence(draftText, knowledgeEntries.length, provenNarratives.length);
    // Compliance penalty: required failures cost 5 pts each, warnings cost 2.
    if (complianceChecklist !== null) {
        const penalty = complianceChecklist.failCount * 5 + complianceChecklist.warningCount * 2;
        confidenceScore = Math.max(0, Math.min(100, confidenceScore - penalty));
    }
    const gapCount = (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;
    const wordCount = draftText.trim().split(/\s+/).length;
    // Transparency panel: every KB entry, proven narrative, and intelligence
    // library excerpt supplied to the model.
    const sources = [
        ...knowledgeEntries.map((entry) => ({
            id: entry.id,
            kind: "knowledge_base",
            title: entry.title,
        })),
        ...provenNarratives.map((p) => ({
            id: p.id,
            kind: "proven_narrative",
            title: p.sectionType ? `Proven: ${p.sectionType}` : "Proven narrative",
        })),
        ...intelligenceSections.map((s) => ({
            id: s.id,
            kind: "intelligence_library",
            title: `${s.section_type} — ${s.funder_name ?? "Funded proposal"} (${s.award_year ?? "N/A"})`,
        })),
        ...(intelligenceRubric
            ? [
                {
                    id: intelligenceRubric.id,
                    kind: "intelligence_library",
                    title: `Scoring rubric: ${intelligenceRubric.funder_name ?? intelligenceRubric.source}`,
                },
            ]
            : []),
    ];
    // Save the draft version. Best-effort: a save failure must not fail generation.
    let savedVersion = null;
    {
        const { data: version, error: versionError } = await supabase
            .from("draft_versions")
            .insert({
            organization_id: organizationId,
            opportunity_id: opportunityId,
            template_type: templateType,
            content: draftText,
            confidence_score: confidenceScore,
            knowledge_sources: sources,
            humanization_status: "not_humanized",
            source: draftSource,
            created_by: createdByUserId,
        })
            .select("id, version_number, humanization_status, created_at")
            .single();
        if (versionError) {
            console.error("DRAFT VERSION SAVE ERROR:", versionError.message);
        }
        else if (version) {
            savedVersion = {
                id: version.id,
                versionNumber: version.version_number,
                humanizationStatus: version.humanization_status,
                createdAt: version.created_at,
            };
        }
    }
    // Mirror the draft onto the most recent application for this opportunity.
    {
        const { data: existingApp } = await supabase
            .from("applications")
            .select("id")
            .eq("opportunity_id", opportunityId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (existingApp?.id) {
            const { error: appUpdateError } = await supabase
                .from("applications")
                .update({
                draft_content: draftText,
                draft_template_type: templateType,
                draft_confidence_score: confidenceScore,
                draft_knowledge_sources: sources,
                updated_at: new Date().toISOString(),
            })
                .eq("id", existingApp.id);
            if (appUpdateError) {
                console.error("DRAFT APPLICATION SYNC ERROR:", appUpdateError.message);
            }
        }
    }
    return {
        content: draftText,
        confidenceScore,
        gapCount,
        wordCount,
        sources,
        savedVersion,
        tokensUsed: response.usage.totalTokens,
        rubricDimensionSummary,
        logicModel: generatedLogicModel,
        complianceChecklist,
    };
}
