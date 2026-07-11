"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProPublicaError = void 0;
exports.searchOrganizations = searchOrganizations;
exports.enrichOrganizationByEin = enrichOrganizationByEin;
const admin_1 = require("../../../lib/supabase/admin");
const crawler_core_1 = require("../../../lib/donor-discovery/crawler-core");
/**
 * ProPublica Nonprofit Explorer adapter (DONOR_DISCOVERY_ARCHITECTURE.md §2C
 * "Signal layer", BEHAVIORAL_CONTRACTS.md §19). Free, no API key.
 *
 * Two endpoints:
 *  - GET /search.json (q, state[id], ntee[id]) — name/state/NTEE lookup,
 *    exposed here as `searchOrganizations` for future registry-layer use.
 *  - GET /organizations/{ein}.json — full org detail + filing history. This
 *    is what `enrichOrganizationByEin` calls: given a directory row's EIN, it
 *    pulls the latest filing's total_revenue, total_expenses, total_assets,
 *    ntee_code (+ a derived ntee_description), filing_year, form_type, and
 *    pdf_url, and writes them into that row's `enrichment` jsonb.
 *
 * Write path is a direct `.update()` by directory id, NOT
 * `upsertDirectoryRecord()` (directory.ts). That RPC's merge rule — existing
 * non-null enrichment keys are never overwritten (migration 071) — exists to
 * protect adapters that are fuzzy-matching *new* records against the shared
 * directory. Here the directory row is already known by id (the caller found
 * it via civic_kind = 'nonprofit_501c3'), and the whole point of a 90-day TTL
 * is to *refresh* `propublica_enriched_at` on re-enrichment, which the RPC's
 * "existing wins" merge would silently prevent. Financial fields are nested
 * under an `enrichment.propublica` key (sibling to the BMF ingest's top-level
 * `ein` / `ntee_cd` keys) so this adapter never touches data another adapter
 * wrote — only its own namespace plus the `propublica_enriched_at` cache
 * marker the task asks for by that exact name.
 *
 * Rate limit: self-imposed 1 request/second, never burst (contract §19) —
 * shared across both endpoints via one DomainRateLimiter bucket.
 *
 * Nothing in this module runs at import time — the admin client and the rate
 * limiter's first `acquire()` call are only touched inside the exported
 * functions, matching the lazy-init convention used by every other
 * donor-discovery module.
 */
const API_BASE = "https://projects.propublica.org/nonprofits/api/v2";
const HOST = "projects.propublica.org";
const propublicaRateLimiter = new crawler_core_1.DomainRateLimiter(1_000); // 1 req / 1s
const ENRICHMENT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
class ProPublicaError extends Error {
    constructor(message) {
        super(message);
        this.name = "ProPublicaError";
    }
}
exports.ProPublicaError = ProPublicaError;
// ── NTEE major-group descriptions ───────────────────────────────────────────
// ProPublica's org detail returns a bare ntee_code (e.g. "T30") with no
// description. The IRS's 26 NTEE major groups are keyed off the first
// letter and are stable public reference data, so `ntee_description` is
// derived from that rather than a second API call.
const NTEE_MAJOR_GROUPS = {
    A: "Arts, Culture & Humanities",
    B: "Education",
    C: "Environment",
    D: "Animal-Related",
    E: "Health Care",
    F: "Mental Health & Crisis Intervention",
    G: "Voluntary Health Associations & Medical Disciplines",
    H: "Medical Research",
    I: "Crime & Legal-Related",
    J: "Employment",
    K: "Food, Agriculture & Nutrition",
    L: "Housing & Shelter",
    M: "Public Safety, Disaster Preparedness & Relief",
    N: "Recreation & Sports",
    O: "Youth Development",
    P: "Human Services",
    Q: "International, Foreign Affairs & National Security",
    R: "Civil Rights, Social Action & Advocacy",
    S: "Community Improvement & Capacity Building",
    T: "Philanthropy, Voluntarism & Grantmaking Foundations",
    U: "Science & Technology Research Institutes",
    V: "Social Science Research Institutes",
    W: "Public & Societal Benefit",
    X: "Religion-Related",
    Y: "Mutual & Membership Benefit",
    Z: "Unknown",
};
function nteeDescription(nteeCode) {
    if (!nteeCode)
        return null;
    const major = nteeCode.trim().charAt(0).toUpperCase();
    return NTEE_MAJOR_GROUPS[major] ?? null;
}
const FORM_TYPE_LABELS = {
    0: "990",
    1: "990EZ",
    2: "990PF",
};
function formTypeLabel(formType) {
    if (formType === null || formType === undefined)
        return null;
    return FORM_TYPE_LABELS[formType] ?? String(formType);
}
function normalizeSearchOrg(raw) {
    if (raw.ein === undefined || raw.ein === null || !raw.name)
        return null;
    return {
        ein: String(raw.ein),
        name: raw.name,
        city: raw.city ?? null,
        state: raw.state ?? null,
        ntee_code: raw.ntee_code ?? null,
        have_filings: raw.have_filings ?? false,
    };
}
/**
 * GET /search.json — name (`q`), state (`state[id]`), and/or NTEE major
 * group (`ntee[id]`). At least one filter is required (ProPublica returns an
 * error on a completely open query). No auth, no key.
 */
async function searchOrganizations(params) {
    if (!params.q && !params.state && params.nteeId === undefined) {
        throw new ProPublicaError("searchOrganizations requires at least one of q, state, or nteeId.");
    }
    await propublicaRateLimiter.acquire(HOST);
    const url = new URL(`${API_BASE}/search.json`);
    if (params.q)
        url.searchParams.set("q", params.q);
    if (params.state)
        url.searchParams.set("state[id]", params.state);
    if (params.nteeId !== undefined)
        url.searchParams.set("ntee[id]", String(params.nteeId));
    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new ProPublicaError(`ProPublica search HTTP ${response.status} for ${url.toString()}`);
    }
    const body = (await response.json());
    const results = [];
    for (const raw of body.organizations ?? []) {
        const normalized = normalizeSearchOrg(raw);
        if (normalized)
            results.push(normalized);
    }
    return results;
}
async function fetchOrganizationDetail(ein) {
    await propublicaRateLimiter.acquire(HOST);
    const url = `${API_BASE}/organizations/${ein}.json`;
    const response = await fetch(url);
    if (response.status === 404) {
        throw new ProPublicaError(`No ProPublica record found for EIN ${ein}.`);
    }
    if (!response.ok) {
        throw new ProPublicaError(`ProPublica organization lookup HTTP ${response.status} for EIN ${ein}.`);
    }
    return (await response.json());
}
/** Most recent filing by tax_prd_yr. `filings_with_data` isn't documented as
 * pre-sorted, so this sorts defensively rather than trusting index 0. */
function latestFiling(filings) {
    if (!filings || filings.length === 0)
        return null;
    return [...filings].sort((a, b) => (b.tax_prd_yr ?? 0) - (a.tax_prd_yr ?? 0))[0] ?? null;
}
function toFinancialSignals(detail) {
    const filing = latestFiling(detail.filings_with_data);
    const nteeCode = detail.organization?.ntee_code ?? detail.organization?.raw_ntee_code ?? null;
    return {
        total_revenue: filing?.totrevenue ?? null,
        total_expenses: filing?.totfuncexpns ?? null,
        total_assets: filing?.totassetsend ?? null,
        ntee_code: nteeCode,
        ntee_description: nteeDescription(nteeCode),
        filing_year: filing?.tax_prd_yr ?? null,
        form_type: formTypeLabel(filing?.formtype),
        pdf_url: filing?.pdf_url ?? null,
    };
}
// ── 90-day cache + directory write-back ─────────────────────────────────────
function isFresh(enrichment) {
    const raw = enrichment.propublica_enriched_at;
    if (typeof raw !== "string")
        return false;
    const enrichedAt = Date.parse(raw);
    if (Number.isNaN(enrichedAt))
        return false;
    return Date.now() - enrichedAt < ENRICHMENT_TTL_MS;
}
async function loadDirectoryEnrichment(directoryId) {
    const supabase = (0, admin_1.createAdminClient)();
    const { data, error } = await supabase
        .from("donor_discovery_directory")
        .select("enrichment")
        .eq("id", directoryId)
        .maybeSingle();
    if (error || !data) {
        throw new ProPublicaError(`Could not load donor_discovery_directory row ${directoryId}: ${error?.message ?? "not found"}`);
    }
    return (data.enrichment ?? {});
}
async function writeFinancialSignals(directoryId, existingEnrichment, financials) {
    const supabase = (0, admin_1.createAdminClient)();
    const nowIso = new Date().toISOString();
    const enrichment = {
        ...existingEnrichment,
        propublica: financials,
        propublica_enriched_at: nowIso,
    };
    const { error } = await supabase
        .from("donor_discovery_directory")
        .update({ enrichment, enriched_at: nowIso })
        .eq("id", directoryId);
    if (error) {
        throw new ProPublicaError(`Failed to write enrichment for directory ${directoryId}: ${error.message}`);
    }
    return nowIso;
}
/**
 * Given a `donor_discovery_directory` row id and its EIN, fetches full org
 * detail from ProPublica and writes the extracted financial signals into
 * that row's `enrichment` jsonb (`enrichment.propublica`), stamping
 * `enrichment.propublica_enriched_at`. Skips (without calling the API) when
 * `enrichment.propublica_enriched_at` is already set and under 90 days old —
 * callers doing bulk batches should still pre-filter in SQL for efficiency,
 * this check is the adapter's own safety net for direct/one-off calls.
 */
async function enrichOrganizationByEin(directoryId, ein) {
    const cleanEin = ein.replace(/\D/g, "");
    if (!cleanEin) {
        return { directoryId, ein, skipped: true, skipReason: "missing_ein" };
    }
    const existingEnrichment = await loadDirectoryEnrichment(directoryId);
    if (isFresh(existingEnrichment)) {
        return { directoryId, ein: cleanEin, skipped: true, skipReason: "fresh_within_90_days" };
    }
    const detail = await fetchOrganizationDetail(cleanEin);
    const financials = toFinancialSignals(detail);
    await writeFinancialSignals(directoryId, existingEnrichment, financials);
    return { directoryId, ein: cleanEin, skipped: false, financials };
}
