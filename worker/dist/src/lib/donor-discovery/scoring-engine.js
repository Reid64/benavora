"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoringEngine = exports.DEFAULT_ENGINE_WEIGHTS = void 0;
exports.parseEngineWeights = parseEngineWeights;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const admin_1 = require("../../lib/supabase/admin");
const directory_1 = require("../../lib/donor-discovery/directory");
const foundation_linkage_1 = require("../../lib/donor-discovery/foundation-linkage");
/**
 * Donor Discovery on-demand scoring engine (DONOR_DISCOVERY_ARCHITECTURE.md
 * §2D). Distinct from `scoring.ts`'s `scoreProspect` — that function is pure
 * (no I/O, no Claude call) and backs the automatic per-request pipeline
 * (`worker/dd-request-processor.ts`) with a deterministic, templated
 * rationale string and its own 6-signal weight scheme. This module is a
 * self-contained class that does its own database I/O (given only a
 * `prospectId`), computes a 7-signal weighted score against this class's own
 * weight scheme, and calls Claude for a genuinely plain-English 2-sentence
 * rationale instead of a templated one. Both write to the same
 * `donor_discovery_prospects.score` / `score_rationale` columns — this
 * engine additionally stamps `scored_at` (migration 078) so a caller/worker
 * job can tell when a prospect was last scored by *this* engine.
 *
 * Small geo-matching helpers below are intentionally duplicated from
 * `scoring.ts` rather than imported — `scoring.ts` doesn't export them, and
 * this codebase's established convention (see enrichment-agent.ts's
 * `mergeEnrichment` doc comment) is to duplicate small private helpers
 * across donor-discovery modules rather than widen another module's public
 * surface for one caller.
 */
const CLAUDE_MODEL = "claude-haiku-4-5";
const CLAUDE_MAX_TOKENS = 300;
// architecture doc §2D: this engine's own foundation-linkage floor. Looser
// than foundation-linkage.ts's MIN_NAME_SIMILARITY (0.55, the bar for
// *persisting* a linkage onto the shared directory record) because here a
// weak match is just one of seven additive signals, not a standalone claim.
const FOUNDATION_SIMILARITY_THRESHOLD = 0.4;
const FOUNDATION_CANDIDATE_LIMIT = 1;
/** Sums to 100. */
exports.DEFAULT_ENGINE_WEIGHTS = {
    hasGivingProgram: 25,
    hasDonationForm: 20,
    inKindHistorySignals: 15,
    foundationLinkageFound: 15,
    geographicMatch: 10,
    companySizeMatch: 10,
    csrPageExists: 5,
};
// `organizations.donor_discovery_scoring_weights` (migration 074) already
// holds `scoring.ts`'s own camelCase override keys (givingProgram,
// donationForm, ...). Rather than add a second jsonb column for this
// engine's weights, overrides here live under a nested `scoring_engine`
// sub-key of that same column, keyed by this engine's own snake_case signal
// names — no key collision with scoring.ts's overrides, and no new column.
const WEIGHT_KEY_MAP = {
    has_giving_program: "hasGivingProgram",
    has_donation_form: "hasDonationForm",
    in_kind_history_signals: "inKindHistorySignals",
    foundation_linkage_found: "foundationLinkageFound",
    geographic_match: "geographicMatch",
    company_size_match: "companySizeMatch",
    csr_page_exists: "csrPageExists",
};
function parseEngineWeights(raw) {
    const merged = { ...exports.DEFAULT_ENGINE_WEIGHTS };
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return merged;
    const overrides = raw.scoring_engine;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
        return merged;
    const obj = overrides;
    for (const [jsonKey, weightKey] of Object.entries(WEIGHT_KEY_MAP)) {
        const value = obj[jsonKey];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            merged[weightKey] = value;
        }
    }
    return merged;
}
// ── Anthropic client (lazy — no module-load side effects) ──────────────────
let anthropicClient = null;
function getClient() {
    if (anthropicClient)
        return anthropicClient;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error("Missing ANTHROPIC_API_KEY");
    }
    anthropicClient = new sdk_1.default({ apiKey });
    return anthropicClient;
}
// ── Signal: giving program / donation form / in-kind / csr page ────────────
function asStringOrNull(v) {
    return typeof v === "string" && v.trim() ? v.trim() : null;
}
function asStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.filter((x) => typeof x === "string" && x.trim().length > 0);
}
function hasGivingProgram(enrichment) {
    return enrichment?.has_giving_program === true;
}
function hasDonationForm(enrichment) {
    return enrichment?.has_donation_form === true;
}
function hasInKindHistorySignals(enrichment) {
    return asStringArray(enrichment?.in_kind_history_signals).length > 0;
}
function hasCsrPage(enrichment) {
    return asStringOrNull(enrichment?.csr_page_url) !== null;
}
const VALID_SIZES = ["small", "medium", "large", "enterprise"];
function companySizeEstimateOf(enrichment) {
    const value = enrichment?.company_size_estimate;
    return typeof value === "string" && VALID_SIZES.includes(value)
        ? value
        : null;
}
// ── Signal: geographic match ─────────────────────────────────────────────────
// Duplicated from scoring.ts (see file header) — same haversine + address
// state-suffix heuristic, kept intentionally minimal.
const EARTH_RADIUS_KM = 6371;
const KM_PER_MILE = 1.60934;
function haversineKm(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}
function extractStateFromAddress(address) {
    if (!address)
        return null;
    const match = address.match(/,\s*([A-Za-z]{2})\s*\d{5}(-\d{4})?\s*$/);
    return match?.[1] ? match[1].toUpperCase() : null;
}
function matchesGeography(hqAddress, geo, geography) {
    if ("national" in geography && geography.national)
        return true;
    if ("center" in geography && "radius_mi" in geography) {
        if (!geo)
            return false;
        return haversineKm(geo, geography.center) <= geography.radius_mi * KM_PER_MILE;
    }
    if ("states" in geography) {
        const state = extractStateFromAddress(hqAddress);
        if (!state)
            return false;
        return geography.states.some((s) => s.toUpperCase() === state);
    }
    return false;
}
// ── Signal: company size vs. ask size ────────────────────────────────────────
// Coarse plausibility ceilings per company_size_estimate category — not an
// eligibility gate, just "is this ask size implausible for a company this
// size" (mirrors scoring.ts's isSizeAppropriate posture of "missing data
// means the signal doesn't fire", never a midpoint guess).
const SIZE_ASK_CEILINGS = {
    small: 5_000,
    medium: 25_000,
    large: 100_000,
    enterprise: Number.POSITIVE_INFINITY,
};
function matchesCompanySize(sizeEstimate, askSizeEstimate) {
    if (!sizeEstimate || askSizeEstimate == null || askSizeEstimate <= 0)
        return false;
    return askSizeEstimate <= SIZE_ASK_CEILINGS[sizeEstimate];
}
// ── Signal: foundation linkage ───────────────────────────────────────────────
/**
 * True if this directory record is linked (or plausibly linkable) to a
 * corporate foundation in `foundation_directory`. Checks, in order:
 * 1. An existing `linked_foundation_id` from the §2C pipeline
 *    (foundation-linkage.ts) — that pipeline's 0.55 similarity floor is
 *    stricter than this engine's own 0.4, so an existing link always counts.
 * 2. An exact EIN match, when the directory record's enrichment carries one
 *    (no adapter populates this today, but the field is checked "if
 *    available" per the architecture doc rather than assumed absent).
 * 3. A live fuzzy name-similarity query (`donor_discovery_match_foundations`
 *    RPC, migration 074) at this engine's own 0.4 floor.
 * Never throws — a query failure is treated as "no linkage found" by the
 * caller, matching this module's soft-failure posture for signal lookups.
 */
async function findsFoundationLinkage(supabase, directory) {
    if (directory.linked_foundation_id)
        return true;
    const enrichmentEin = asStringOrNull(directory.enrichment?.ein);
    if (enrichmentEin) {
        const { data, error } = await supabase
            .from("foundation_directory")
            .select("id")
            .eq("ein", enrichmentEin)
            .maybeSingle();
        if (!error && data)
            return true;
    }
    const candidateNames = (0, foundation_linkage_1.buildCandidateFoundationNames)(directory.legal_name);
    if (candidateNames.length === 0)
        return false;
    const { data, error } = await supabase.rpc("donor_discovery_match_foundations", {
        p_candidate_names: candidateNames,
        p_min_similarity: FOUNDATION_SIMILARITY_THRESHOLD,
        p_limit: FOUNDATION_CANDIDATE_LIMIT,
    });
    if (error) {
        throw new Error(`foundation_match_query_failed: ${error.message}`);
    }
    return Array.isArray(data) && data.length > 0;
}
function computeScore(signals, weights) {
    const raw = (signals.hasGivingProgram ? weights.hasGivingProgram : 0) +
        (signals.hasDonationForm ? weights.hasDonationForm : 0) +
        (signals.inKindHistorySignals ? weights.inKindHistorySignals : 0) +
        (signals.foundationLinkageFound ? weights.foundationLinkageFound : 0) +
        (signals.geographicMatch ? weights.geographicMatch : 0) +
        (signals.companySizeMatch ? weights.companySizeMatch : 0) +
        (signals.csrPageExists ? weights.csrPageExists : 0);
    return Math.round(Math.max(0, Math.min(100, raw)));
}
// ── Rationale: Claude-generated, with a deterministic fallback ─────────────
function joinWithCommasAnd(parts) {
    if (parts.length <= 1)
        return parts[0] ?? "";
    if (parts.length === 2)
        return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
const SIGNAL_DESCRIPTIONS = [
    ["hasGivingProgram", "has an active giving program"],
    ["hasDonationForm", "has a donation or sponsorship request form"],
    ["inKindHistorySignals", "shows evidence of past in-kind giving"],
    ["csrPageExists", "publishes a dedicated CSR or community-giving page"],
    ["foundationLinkageFound", "is linked to a corporate giving foundation"],
    ["geographicMatch", "is located within the requested geography"],
    ["companySizeMatch", "appears sized appropriately for this ask"],
];
/** Used only if the Claude call itself fails — never blocks persistence on an AI outage. */
function buildFallbackRationale(legalName, signals, score) {
    const parts = SIGNAL_DESCRIPTIONS.filter(([key]) => signals[key]).map(([, text]) => text);
    const signalSentence = parts.length > 0
        ? `This prospect ${joinWithCommasAnd(parts)}.`
        : "No strong positive signals were found for this prospect.";
    return `${legalName} scored ${score} out of 100 for this request. ${signalSentence}`;
}
function buildRationalePrompt(params) {
    const { legalName, orgMissionText, askSizeEstimate, taxonomyNodesRequested, signals, score } = params;
    const firedDescriptions = SIGNAL_DESCRIPTIONS.filter(([key]) => signals[key]).map(([, text]) => text);
    const signalsLine = firedDescriptions.length > 0 ? joinWithCommasAnd(firedDescriptions) : "no positive signals";
    return `You are writing a short, plain-English rationale for a nonprofit fundraiser about a potential in-kind/corporate donor prospect, "${legalName}", who scored ${score} out of 100 in our donor-prospecting tool.

Nonprofit's mission: ${orgMissionText || "not provided"}
What this search was looking for: ${taxonomyNodesRequested.length > 0 ? taxonomyNodesRequested.join(", ") : "not specified"}
Estimated ask size: ${askSizeEstimate != null ? `$${askSizeEstimate.toLocaleString()}` : "not specified"}
Signals found for this prospect: ${signalsLine}

Write EXACTLY two sentences in plain English explaining why this score makes sense, so a nonprofit staff member can quickly decide whether to pursue this prospect. Do not invent facts beyond the signals listed above. No jargon, no bullet points, no quotation marks, no preamble — return only the two sentences.`;
}
async function generateRationale(params) {
    const message = await getClient().messages.create({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        temperature: 0.3,
        messages: [{ role: "user", content: buildRationalePrompt(params) }],
    });
    const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
    if (!text) {
        throw new Error("empty_claude_response");
    }
    return text;
}
// ── ScoringEngine ────────────────────────────────────────────────────────────
class ScoringEngine {
    supabase;
    constructor(supabase) {
        this.supabase = supabase ?? (0, admin_1.createAdminClient)();
    }
    /**
     * Scores one `donor_discovery_prospects` row against `requestContext`,
     * generates a Claude rationale (falling back to a deterministic sentence
     * if the Claude call fails), persists `score` / `score_rationale` /
     * `scored_at` onto the prospect, and returns the result.
     */
    async score(prospectId, requestContext) {
        const prospect = await this.loadProspect(prospectId);
        const directory = await this.loadDirectory(prospect.directory_id);
        const weights = await this.loadWeights(prospect.organization_id);
        const enrichment = directory.enrichment;
        const geo = (0, directory_1.parseGeo)(directory.geo);
        const foundationLinkageFound = await findsFoundationLinkage(this.supabase, directory).catch((err) => {
            console.warn(`[ScoringEngine] Foundation linkage check failed for prospect ${prospectId}: ` +
                `${err instanceof Error ? err.message : String(err)}`);
            return false;
        });
        const signals = {
            hasGivingProgram: hasGivingProgram(enrichment),
            hasDonationForm: hasDonationForm(enrichment),
            inKindHistorySignals: hasInKindHistorySignals(enrichment),
            foundationLinkageFound,
            geographicMatch: matchesGeography(directory.hq_address, geo, requestContext.geography),
            companySizeMatch: matchesCompanySize(companySizeEstimateOf(enrichment), requestContext.askSizeEstimate),
            csrPageExists: hasCsrPage(enrichment),
        };
        const score = computeScore(signals, weights);
        let rationale;
        try {
            rationale = await generateRationale({
                legalName: directory.legal_name,
                orgMissionText: requestContext.orgMissionText,
                askSizeEstimate: requestContext.askSizeEstimate,
                taxonomyNodesRequested: requestContext.taxonomyNodesRequested,
                signals,
                score,
            });
        }
        catch (err) {
            console.warn(`[ScoringEngine] Claude rationale generation failed for prospect ${prospectId}, using fallback: ` +
                `${err instanceof Error ? err.message : String(err)}`);
            rationale = buildFallbackRationale(directory.legal_name, signals, score);
        }
        await this.persist(prospect, score, rationale);
        return { score, rationale };
    }
    async loadProspect(prospectId) {
        const { data, error } = await this.supabase
            .from("donor_discovery_prospects")
            .select("id, organization_id, directory_id")
            .eq("id", prospectId)
            .maybeSingle();
        if (error || !data) {
            throw new Error(`prospect_not_found: ${error?.message ?? prospectId}`);
        }
        return data;
    }
    async loadDirectory(directoryId) {
        const { data, error } = await this.supabase
            .from("donor_discovery_directory")
            .select("id, legal_name, website, hq_address, geo, enrichment, linked_foundation_id, linkage_confidence")
            .eq("id", directoryId)
            .maybeSingle();
        if (error || !data) {
            throw new Error(`directory_not_found: ${error?.message ?? directoryId}`);
        }
        return data;
    }
    async loadWeights(organizationId) {
        const { data, error } = await this.supabase
            .from("organizations")
            .select("donor_discovery_scoring_weights")
            .eq("id", organizationId)
            .maybeSingle();
        if (error) {
            console.warn(`[ScoringEngine] Weight lookup failed for org ${organizationId}, using defaults: ${error.message}`);
            return { ...exports.DEFAULT_ENGINE_WEIGHTS };
        }
        const row = data;
        return parseEngineWeights(row?.donor_discovery_scoring_weights ?? null);
    }
    async persist(prospect, score, rationale) {
        const { error } = await this.supabase
            .from("donor_discovery_prospects")
            .update({ score, score_rationale: rationale, scored_at: new Date().toISOString() })
            .eq("id", prospect.id)
            .eq("organization_id", prospect.organization_id);
        if (error) {
            throw new Error(`prospect_score_persist_failed: ${error.message}`);
        }
    }
}
exports.ScoringEngine = ScoringEngine;
