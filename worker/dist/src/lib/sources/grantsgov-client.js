"use strict";
// Grants.gov opportunity search client — lightweight polling client for the
// public v2 search endpoint (no auth required).
//
// This is intentionally a thin fetch + map layer: given a search term it
// returns opportunities normalised toward the `opportunities` table shape.
// Callers (route handlers, worker jobs) own persistence and dedup.
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchGrantsGovOpportunities = searchGrantsGovOpportunities;
const formatters_1 = require("@/lib/utils/formatters");
const GRANTS_GOV_SEARCH_URL = "https://api.grants.gov/grantsws/rest/opportunities/search/v2";
const DEFAULT_ROWS = 100;
function toStr(val) {
    if (typeof val === "string")
        return val.trim();
    if (val === null || val === undefined)
        return "";
    return String(val).trim();
}
function toAmount(val) {
    if (val === null || val === undefined || val === "")
        return null;
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : null;
}
// Grants.gov close dates arrive as "MM/DD/YYYY"; normalise to ISO (YYYY-MM-DD).
function toIsoDate(val) {
    const raw = toStr(val);
    if (!raw)
        return null;
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (slash) {
        const [, month, day, year] = slash;
        return `${year}-${(month ?? "").padStart(2, "0")}-${(day ?? "").padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(raw))
        return raw.slice(0, 10);
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function mapHit(hit) {
    const externalId = toStr(hit.id);
    const name = (0, formatters_1.decodeHtmlEntities)(toStr(hit.oppTitle));
    if (!externalId || !name)
        return null;
    return {
        externalId,
        name,
        description: toStr(hit.synopsis) || null,
        amount: toAmount(hit.awardCeiling),
        deadline: toIsoDate(hit.closeDate),
        category: "Government Federal",
        source: "grants_gov",
    };
}
/**
 * Searches the public Grants.gov v2 opportunity search API for `searchTerm`
 * and returns opportunities mapped toward the `opportunities` table shape.
 * Returns an empty array on any HTTP or parse failure (non-fatal — callers
 * typically loop over several search terms and should not abort the whole
 * poll because one keyword's request failed).
 */
async function searchGrantsGovOpportunities(searchTerm) {
    const keyword = searchTerm.trim();
    if (!keyword)
        return [];
    let response;
    try {
        response = await fetch(GRANTS_GOV_SEARCH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                keyword,
                oppStatuses: "posted",
                rows: DEFAULT_ROWS,
                startRecordNum: 0,
            }),
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
    const hits = Array.isArray(body.oppHits) ? body.oppHits : [];
    const mapped = [];
    for (const hit of hits) {
        const opp = mapHit(hit);
        if (opp)
            mapped.push(opp);
    }
    return mapped;
}
