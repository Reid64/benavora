"use strict";
// Reputation Intelligence Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 15
// (Reputation Intelligence), AGENTS_v2.md AG-18.
//
// Searches DuckDuckGo's free Instant Answer API for an entity's name paired
// with risk keywords, has Claude classify each relevant result as a
// reputation risk (or a positive signal), and persists the classified ones
// to reputation_signals (migration 076). That table has no organization_id —
// a funder's reputation is the same fact for every org tracking it — so
// writes here are entity-scoped, not tenant-scoped. A plain function like
// runOpportunityDiscovery/sendMorningDigest: no agent_type enum value yet,
// nothing to log to agent_runs.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReputationIntelligenceAgent = void 0;
exports.checkEntityReputation = checkEntityReputation;
const autonomous_base_1 = require("@/lib/agents/autonomous-base");
const claude_1 = require("@/lib/ai/claude");
const DUCKDUCKGO_URL = "https://api.duckduckgo.com/";
const SEARCH_SUFFIX = "lawsuit fraud scandal leadership change";
// Claude classification is the expensive step — cap how many DuckDuckGo
// results get sent to it per run so one entity can't blow the route budget.
const MAX_RESULTS_TO_ANALYZE = 6;
// Skip DuckDuckGo "related topic" stubs too short to carry real signal.
const MIN_RESULT_TEXT_LENGTH = 20;
const VALID_SEVERITIES = [
    "critical",
    "high",
    "medium",
    "low",
    "positive",
];
function toStr(val) {
    if (typeof val === "string")
        return val.trim();
    if (val === null || val === undefined)
        return "";
    return String(val).trim();
}
/** DuckDuckGo nests related topics under category groups via `Topics`. */
function flattenTopics(topics) {
    const flat = [];
    for (const topic of topics) {
        if (Array.isArray(topic.Topics) && topic.Topics.length > 0) {
            flat.push(...flattenTopics(topic.Topics));
        }
        else {
            flat.push(topic);
        }
    }
    return flat;
}
/**
 * Queries DuckDuckGo's free Instant Answer API for `entityName` plus risk
 * keywords. Returns [] on any HTTP/parse/network failure — a dead search
 * source should never abort the caller's run.
 */
async function searchDuckDuckGo(entityName) {
    const params = new URLSearchParams({
        q: `${entityName} ${SEARCH_SUFFIX}`,
        format: "json",
        no_html: "1",
        skip_disambig: "1",
    });
    let response;
    try {
        response = await fetch(`${DUCKDUCKGO_URL}?${params.toString()}`, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
        });
    }
    catch {
        return [];
    }
    if (!response.ok)
        return [];
    let body;
    try {
        body = (await response.json());
    }
    catch {
        return [];
    }
    const topics = Array.isArray(body.RelatedTopics) ? body.RelatedTopics : [];
    const flat = flattenTopics(topics);
    const results = [];
    for (const topic of flat) {
        const text = toStr(topic.Text);
        if (text.length < MIN_RESULT_TEXT_LENGTH)
            continue;
        results.push({ text, url: toStr(topic.FirstURL) || null });
    }
    return results.slice(0, MAX_RESULTS_TO_ANALYZE);
}
/**
 * Extracts and validates the model's JSON reply. Returns null on any
 * unreadable/malformed response or a missing headline — that result is
 * skipped rather than risking a garbage signal (mirrors the tolerant-parse
 * pattern in eligibility-scorer.ts).
 */
function parseClassification(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start)
        return null;
    let raw;
    try {
        raw = JSON.parse(text.slice(start, end + 1));
    }
    catch {
        return null;
    }
    const obj = (raw ?? {});
    const headline = toStr(obj.headline).slice(0, 100);
    if (!headline)
        return null;
    const severityRaw = toStr(obj.severity).toLowerCase();
    const severity = VALID_SEVERITIES.includes(severityRaw)
        ? severityRaw
        : "medium";
    return {
        isRisk: obj.is_risk === true,
        signalType: toStr(obj.signal_type) || "general",
        severity,
        headline,
        summary: toStr(obj.summary).slice(0, 200),
    };
}
function buildClassificationPrompt(entityName, entityType, result) {
    const system = [
        "You are a nonprofit funding-intelligence analyst screening search results for reputational risk to a funder or corporate donor.",
        "",
        "RULES:",
        "1. Judge ONLY from the search result text provided. Never invent facts.",
        "2. A reputation risk is: an active lawsuit, fraud, scandal, regulatory action, financial distress, or an abrupt/controversial leadership change.",
        '3. A positive signal (severity "positive", is_risk false) is: an announced giving expansion, a new initiative, or other clearly favorable news.',
        "4. If the result is irrelevant, ambiguous, or too vague to judge, return is_risk false and severity \"low\".",
        "5. Respond with ONLY a single JSON object, no prose, no code fences, in exactly this shape:",
        '{"is_risk": <boolean>, "signal_type": "<short category, e.g. lawsuit|fraud|leadership_change|financial_distress|positive_giving>", "severity": "critical" | "high" | "medium" | "low" | "positive", "headline": "<max 100 chars>", "summary": "<max 200 chars>"}',
    ].join("\n");
    const prompt = [
        "## Entity",
        `- Name: ${entityName}`,
        `- Type: ${entityType}`,
        "",
        "## Search Result",
        `- Text: ${result.text}`,
        result.url ? `- URL: ${result.url}` : "",
        "",
        "Classify this result now. Return ONLY the JSON object described above.",
    ]
        .filter(Boolean)
        .join("\n");
    return { system, prompt };
}
/**
 * Searches DuckDuckGo for `entityName` plus risk keywords, has Claude
 * classify each relevant result, and inserts a reputation_signals row for
 * every result flagged as a risk (`is_risk: true`) or a positive signal
 * (`severity: "positive"`). Returns the newly inserted rows. `supabase` may
 * be a session client or the admin client — reputation_signals carries no
 * organization_id, so no tenant scoping applies to the write itself.
 */
async function checkEntityReputation(entityId, entityType, entityName, supabase) {
    const results = await searchDuckDuckGo(entityName);
    if (results.length === 0)
        return [];
    const today = new Date().toISOString().slice(0, 10);
    const inserted = [];
    for (const result of results) {
        const { system, prompt } = buildClassificationPrompt(entityName, entityType, result);
        let classified;
        try {
            const response = await (0, claude_1.callClaude)({
                system,
                prompt,
                model: claude_1.DEFAULT_MODEL,
            });
            classified = parseClassification(response.text);
        }
        catch {
            classified = null;
        }
        if (!classified)
            continue;
        if (!classified.isRisk && classified.severity !== "positive")
            continue;
        const { data, error } = await supabase
            .from("reputation_signals")
            .insert({
            entity_id: entityId,
            entity_type: entityType,
            signal_type: classified.signalType,
            severity: classified.severity,
            headline: classified.headline,
            summary: classified.summary || null,
            source_url: result.url,
            signal_date: today,
        })
            .select()
            .single();
        if (!error && data)
            inserted.push(data);
    }
    return inserted;
}
/**
 * Maps the five-value ReputationSeverity already produced by Claude's
 * classification (see buildClassificationPrompt above) onto the four
 * decision/alert tiers this agent acts on. "positive" carries no risk, so
 * it folds into LOW alongside "low" rather than getting a fifth bucket.
 */
function toSeverityLevel(severity) {
    switch (severity) {
        case "critical":
            return "CRITICAL";
        case "high":
            return "HIGH";
        case "medium":
            return "MEDIUM";
        default:
            return "LOW";
    }
}
class ReputationIntelligenceAgent extends autonomous_base_1.AutonomousAgent {
    constructor(orgId, supabase) {
        super(orgId, "ag-18-reputation", supabase);
    }
    async run(triggerSource) {
        const runId = await this.startRun(triggerSource);
        const errors = [];
        const decisions = [];
        let signalsFound = 0;
        let critical = 0;
        let high = 0;
        let medium = 0;
        let low = 0;
        let alertsCreated = 0;
        let memoryEntriesCreated = 0;
        try {
            const { data: funderRows, error: fundersError } = await this.supabase
                .from("funders")
                .select("id, name")
                .eq("organization_id", this.orgId);
            if (fundersError) {
                throw new Error(`Failed to load funders: ${fundersError.message}`);
            }
            const funders = (funderRows ?? []);
            const today = new Date().toISOString().slice(0, 10);
            for (const funder of funders) {
                let signals;
                try {
                    signals = (await checkEntityReputation(funder.id, "funder", funder.name, this.supabase));
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : "Reputation check failed.";
                    errors.push(`funder ${funder.id}: ${message}`);
                    continue;
                }
                for (const signal of signals) {
                    signalsFound++;
                    const severity = toSeverityLevel(signal.severity);
                    if (severity === "CRITICAL")
                        critical++;
                    else if (severity === "HIGH")
                        high++;
                    else if (severity === "MEDIUM")
                        medium++;
                    else
                        low++;
                    const signalSummary = signal.summary || signal.headline;
                    const { data: alertRow, error: alertError } = await this.supabase
                        .from("reputation_alerts")
                        .insert({
                        org_id: this.orgId,
                        signal_id: signal.id,
                        status: "unread",
                    })
                        .select("id")
                        .single();
                    if (alertError || !alertRow) {
                        errors.push(`Failed to create reputation alert for signal ${signal.id}: ` +
                            `${alertError?.message ?? "no row returned"}`);
                        continue;
                    }
                    const alertId = alertRow.id;
                    alertsCreated++;
                    const decisionId = await this.logDecision({
                        decisionType: "reputation_signal_detected",
                        agentRunId: runId,
                        entityType: "funder",
                        entityId: funder.id,
                        reasoning: `Signal for ${funder.name}: ${signalSummary}. ` +
                            `Severity: ${severity}.`,
                        confidenceScore: 75,
                        actionTaken: "created_reputation_alert",
                        requiredHumanReview: severity === "CRITICAL" || severity === "HIGH",
                    });
                    decisions.push(decisionId);
                    if (severity === "CRITICAL") {
                        await this.createNotification("reputation_critical", "URGENT: Critical funder signal detected", `${funder.name}: ${signalSummary}`, { funderId: funder.id, severity, alertId });
                    }
                    if (severity === "HIGH" || severity === "CRITICAL") {
                        const { error: memoryError } = await this.supabase
                            .from("relationship_memory")
                            .insert({
                            org_id: this.orgId,
                            entity_id: funder.id,
                            entity_type: "funder",
                            memory_type: "press",
                            content: signalSummary,
                            signal_date: today,
                        });
                        if (memoryError) {
                            errors.push(`Failed to record relationship memory for funder ` +
                                `${funder.id}: ${memoryError.message}`);
                        }
                        else {
                            memoryEntriesCreated++;
                        }
                    }
                }
            }
            await this.completeRun(runId, {
                outputSummary: JSON.stringify({
                    signalsFound,
                    critical,
                    high,
                    medium,
                    low,
                    alertsCreated,
                    memoryEntriesCreated,
                }),
                itemsFound: funders.length,
                itemsProcessed: signalsFound,
                itemsQueued: alertsCreated,
            });
            return {
                success: true,
                itemsFound: funders.length,
                itemsProcessed: signalsFound,
                itemsQueued: alertsCreated,
                decisions,
                nextActions: [],
                errors,
            };
        }
        catch (err) {
            const message = err instanceof Error
                ? err.message
                : "Reputation intelligence run failed.";
            await this.failRun(runId, message);
            return {
                success: false,
                itemsFound: 0,
                itemsProcessed: signalsFound,
                itemsQueued: alertsCreated,
                decisions,
                nextActions: [],
                errors: [...errors, message],
            };
        }
    }
}
exports.ReputationIntelligenceAgent = ReputationIntelligenceAgent;
