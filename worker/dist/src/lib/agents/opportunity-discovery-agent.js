"use strict";
// Opportunity Discovery Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 2 (AI
// Opportunity Discovery Engine), AGENTS_v2.md AG-17.
//
// Sweeps Grants.gov, SAM.gov, and the Federal Register for opportunities the
// org hasn't seen yet, scores each against the org's mission, and stages
// matches above threshold in discovery_matches (migration 095) — a match only
// becomes a real `opportunities` row when a user actions it. This keeps
// discovery non-destructive: it never writes to `opportunities` itself.
//
// A plain function rather than a BaseAgent subclass: this agent has no
// `agent_type` enum value yet and no Claude call to meter, so agent_runs
// logging would be pure overhead. discovery_runs (migration 095) is this
// agent's own run log instead.
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOpportunityDiscovery = runOpportunityDiscovery;
const grantsgov_client_1 = require("../../lib/sources/grantsgov-client");
const samgov_client_1 = require("../../lib/sources/samgov-client");
const FEDERAL_REGISTER_URL = "https://www.federalregister.gov/api/v1/documents.json";
// Below this score a discovered item is too weak a mission fit to surface.
const MATCH_THRESHOLD = 0.3;
// Skipped when tokenizing — too common to signal mission fit either way.
const STOPWORDS = new Set([
    "with",
    "that",
    "this",
    "from",
    "will",
    "have",
    "their",
    "which",
    "into",
    "such",
    "about",
    "these",
    "those",
    "shall",
    "under",
    "through",
    "program",
    "programs",
    "organization",
    "organizations",
]);
function toStr(val) {
    if (typeof val === "string")
        return val.trim();
    if (val === null || val === undefined)
        return "";
    return String(val).trim();
}
function tokenize(text) {
    const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w));
    return new Set(words);
}
/**
 * Basic keyword-overlap score: fraction of the org mission's significant
 * words that also appear in the opportunity's title/description. Cheap and
 * deterministic — a heavier semantic pass (Pillar 5's Grant Probability
 * Engine) runs later, once a match is actually added to the pipeline.
 */
function scoreMatch(missionText, opp) {
    const missionWords = tokenize(missionText);
    if (missionWords.size === 0)
        return { score: 0, reasons: [] };
    const oppWords = tokenize(`${opp.externalTitle} ${opp.description ?? ""}`);
    const matched = [...missionWords].filter((w) => oppWords.has(w));
    if (matched.length === 0)
        return { score: 0, reasons: [] };
    const score = Math.min(matched.length / missionWords.size, 1);
    const reasons = matched
        .slice(0, 5)
        .map((word) => `Matched keyword: ${word}`);
    return { score, reasons };
}
function mapGrantsGov(hit) {
    return {
        externalTitle: hit.name,
        externalSource: "grants_gov",
        externalUrl: hit.externalId
            ? `https://www.grants.gov/search-grants?opp=${hit.externalId}`
            : null,
        description: hit.description,
    };
}
function mapSamGov(hit) {
    return {
        externalTitle: hit.name,
        externalSource: "sam_gov",
        externalUrl: hit.externalId
            ? `https://sam.gov/opp/${hit.externalId}/view`
            : null,
        description: hit.description,
    };
}
/**
 * Polls the Federal Register for grant-funding notices. Returns an empty
 * array on any HTTP/parse failure (non-fatal — mirrors the grants.gov/SAM.gov
 * source clients' behavior so one dead source never aborts the whole run).
 */
async function fetchFederalRegister() {
    const params = new URLSearchParams();
    params.append("conditions[type][]", "NOTICE");
    params.set("conditions[term]", "grant funding");
    params.set("per_page", "20");
    params.set("order", "newest");
    let response;
    try {
        response = await fetch(`${FEDERAL_REGISTER_URL}?${params.toString()}`, {
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
    const results = Array.isArray(body.results) ? body.results : [];
    const mapped = [];
    for (const item of results) {
        const title = toStr(item.title);
        if (!title)
            continue;
        mapped.push({
            externalTitle: title,
            externalSource: "federal_register",
            externalUrl: toStr(item.html_url) || null,
            description: toStr(item.abstract) || null,
        });
    }
    return mapped;
}
/** True if an opportunity with this title or url already exists for the org. */
async function existsInOpportunities(supabase, orgId, title, url) {
    const { data: byName } = await supabase
        .from("opportunities")
        .select("id")
        .eq("organization_id", orgId)
        .ilike("name", title)
        .maybeSingle();
    if (byName)
        return true;
    if (url) {
        const { data: byUrl } = await supabase
            .from("opportunities")
            .select("id")
            .eq("organization_id", orgId)
            .eq("url", url)
            .maybeSingle();
        if (byUrl)
            return true;
    }
    return false;
}
/** True if this exact source item was already staged in a prior run. */
async function existsInDiscoveryMatches(supabase, orgId, title, source) {
    const { data } = await supabase
        .from("discovery_matches")
        .select("id")
        .eq("organization_id", orgId)
        .eq("external_source", source)
        .ilike("external_title", title)
        .maybeSingle();
    return Boolean(data);
}
/**
 * Discovers new funding opportunities for `orgId` across Grants.gov,
 * SAM.gov, and the Federal Register; scores each against the org's mission
 * (Digital Twin first, org profile as fallback); and stages matches scoring
 * above {@link MATCH_THRESHOLD} in discovery_matches. Logs one discovery_runs
 * row per call. `supabase` may be a session client (RLS on, route-triggered)
 * or the admin client (scheduled run) — every query is explicitly scoped by
 * `orgId` so both are safe.
 */
async function runOpportunityDiscovery(orgId, supabase) {
    const runStart = Date.now();
    const { data: org } = await supabase
        .from("organizations")
        .select("mission_statement")
        .eq("id", orgId)
        .maybeSingle();
    const { data: twin } = await supabase
        .from("organizational_digital_twins")
        .select("mission")
        .eq("organization_id", orgId)
        .maybeSingle();
    const missionText = toStr(twin?.mission) || toStr(org?.mission_statement);
    const grantsGovKeyword = missionText.slice(0, 50).trim() || "nonprofit grant";
    const sourcesChecked = ["grants_gov", "sam_gov", "federal_register"];
    const [grantsGovHits, samGovHits, federalRegisterHits] = await Promise.all([
        (0, grantsgov_client_1.searchGrantsGovOpportunities)(grantsGovKeyword),
        (0, samgov_client_1.searchSamGovOpportunities)(),
        fetchFederalRegister(),
    ]);
    const discovered = [
        ...grantsGovHits.map(mapGrantsGov),
        ...samGovHits.map(mapSamGov),
        ...federalRegisterHits,
    ];
    const { data: run } = await supabase
        .from("discovery_runs")
        .insert({ organization_id: orgId, sources_checked: sourcesChecked })
        .select("id")
        .maybeSingle();
    const runId = run?.id ?? null;
    let matched = 0;
    for (const opp of discovered) {
        if (!opp.externalTitle)
            continue;
        const alreadyOpportunity = await existsInOpportunities(supabase, orgId, opp.externalTitle, opp.externalUrl);
        if (alreadyOpportunity)
            continue;
        const alreadyStaged = await existsInDiscoveryMatches(supabase, orgId, opp.externalTitle, opp.externalSource);
        if (alreadyStaged)
            continue;
        const { score, reasons } = scoreMatch(missionText, opp);
        if (score <= MATCH_THRESHOLD)
            continue;
        const { error } = await supabase.from("discovery_matches").insert({
            organization_id: orgId,
            discovery_run_id: runId,
            external_title: opp.externalTitle,
            external_source: opp.externalSource,
            external_url: opp.externalUrl,
            match_score: Number(score.toFixed(2)),
            match_reasons: reasons,
        });
        if (!error)
            matched++;
    }
    if (runId) {
        await supabase
            .from("discovery_runs")
            .update({
            opportunities_found: discovered.length,
            opportunities_matched: matched,
            runtime_seconds: Math.round((Date.now() - runStart) / 1000),
        })
            .eq("id", runId);
    }
    return { matched, found: discovered.length, sources: sourcesChecked };
}
