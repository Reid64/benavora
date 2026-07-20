"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.txTdlrAdapter = exports.TdlrError = exports.NAICS_BY_LICENSE_TYPE = exports.TDLR_LICENSE_TYPES = void 0;
exports.parseLicenseeResults = parseLicenseeResults;
exports.isActiveLicense = isActiveLicense;
exports.searchLicenseType = searchLicenseType;
const node_html_parser_1 = require("node-html-parser");
const crawler_core_1 = require("@/lib/donor-discovery/crawler-core");
const directory_1 = require("@/lib/donor-discovery/directory");
/**
 * Texas Department of Licensing and Regulation (TDLR) registry adapter
 * (DONOR_DISCOVERY_ARCHITECTURE.md §2A "Registry layer" — "State contractor
 * license boards ... one adapter per state, config-driven URL/parse map,
 * added incrementally"). This is the first (and so far only) state license
 * board adapter; TX was picked as the pilot per the Faith Foundation
 * validation case (site-development trades in rural Texas).
 *
 * Source: GET https://www.tdlr.texas.gov/TNPWS/Lookup.aspx?SearchType=Business
 * &LicenseType=<code>. A public, unauthenticated licensee search — not a paid
 * API — so every request goes through `fetchCompliant` (crawler-core.ts),
 * which enforces the kill switch, ToS registry, robots.txt, and the shared
 * per-domain rate limiter, exactly as every other scraped source in this
 * codebase.
 *
 * Five license types cover the Faith Foundation site-development case:
 * Electrical (ELEC), Plumbing (PLMB), HVAC (HVAC), Elevator (ELEV), and
 * Boiler (BLRP). Each maps to a NAICS code that already exists in the
 * taxonomy seed (scripts/seed-dd-taxonomy.ts): ELEC -> 238210, PLMB and HVAC
 * -> 238220 (both are "Plumbing, Heating, and Air-Conditioning Contractors"
 * under the Census definition), and ELEV/BLRP -> 238290 ("Other Building
 * Equipment Contractors", which the Census NAICS manual explicitly groups
 * elevator and boiler-house piping installation under together).
 *
 * HTML parsing uses `node-html-parser` rather than this codebase's existing
 * `cheerio` dependency (used by src/lib/enrichment/sources/website-scraper.ts
 * and the enrichment agent) — a deliberate per-adapter choice, not a
 * house-wide switch. TDLR's Lookup.aspx results table is a plain,
 * server-rendered ASP.NET grid with no dependency on cheerio's jQuery-style
 * traversal; node-html-parser is a lighter, faster parser well suited to a
 * single flat table extraction. Column *positions* in that grid aren't
 * documented anywhere public and may shift over time, so parsing matches
 * columns by header text (case-insensitive) rather than a hardcoded index —
 * the same "flag for reconfiguration on structural drift" posture
 * BEHAVIORAL_CONTRACTS.md §18/§21 require of every scraped source.
 *
 * Nothing in this module runs at import time — matching the lazy-init
 * convention used by every other donor-discovery adapter.
 */
const PROVIDER = "tx_tdlr";
const TDLR_LOOKUP_URL = "https://www.tdlr.texas.gov/TNPWS/Lookup.aspx";
const TDLR_USER_AGENT = "BenavoraBot/1.0 (+https://benavora.vercel.app/security; Donor Discovery TX TDLR licensee search)";
exports.TDLR_LICENSE_TYPES = ["ELEC", "PLMB", "HVAC", "ELEV", "BLRP"];
/** See file header — ELEV and BLRP share 238290 per the Census NAICS manual's
 * "Other Building Equipment Contractors" grouping. */
exports.NAICS_BY_LICENSE_TYPE = {
    ELEC: "238210",
    PLMB: "238220",
    HVAC: "238220",
    ELEV: "238290",
    BLRP: "238290",
};
class TdlrError extends Error {
    constructor(message) {
        super(message);
        this.name = "TdlrError";
    }
}
exports.TdlrError = TdlrError;
// ── License type <-> NAICS resolution ───────────────────────────────────────
/** Every TDLR license type whose mapped NAICS code is present in `naicsCodes`.
 * A single requested NAICS code (e.g. 238220) can resolve to more than one
 * license type (PLMB and HVAC both map there). */
function licenseTypesForNaics(naicsCodes) {
    const wanted = new Set(naicsCodes);
    return exports.TDLR_LICENSE_TYPES.filter((licenseType) => wanted.has(exports.NAICS_BY_LICENSE_TYPE[licenseType]));
}
const HEADER_ALIASES = {
    "business name": "business_name",
    "name": "business_name",
    "licensee name": "business_name",
    "license number": "license_number",
    "license #": "license_number",
    "license no": "license_number",
    "license no.": "license_number",
    "city": "city",
    "zip": "zip",
    "zip code": "zip",
    "postal code": "zip",
    "phone": "phone",
    "phone number": "phone",
    "expiration date": "expiration_date",
    "expiration": "expiration_date",
    "exp date": "expiration_date",
    "exp. date": "expiration_date",
};
function cellText(el) {
    return el.text.replace(/\s+/g, " ").trim();
}
/** TDLR's Lookup.aspx result page is server-rendered ASP.NET; the results
 * grid is the table containing a header row whose cells include both a
 * "license"-ish and a "name"-ish label. Every other table on the page
 * (site nav, footer) won't match both, so this is resilient to layout
 * changes elsewhere on the page without hardcoding a CSS id/class that TDLR
 * could rename at any time. */
function findResultsTable(root) {
    const tables = root.querySelectorAll("table");
    for (const table of tables) {
        const headerRow = table.querySelector("tr");
        if (!headerRow)
            continue;
        const headerText = cellText(headerRow).toLowerCase();
        if (headerText.includes("license") && (headerText.includes("name") || headerText.includes("business"))) {
            return table;
        }
    }
    return null;
}
function mapColumnIndexes(headerCells) {
    const map = {};
    headerCells.forEach((cell, index) => {
        const key = cellText(cell).toLowerCase();
        const field = HEADER_ALIASES[key];
        if (field && map[field] === undefined) {
            map[field] = index;
        }
    });
    return map;
}
/** TDLR renders expiration dates as US "MM/DD/YYYY". Parsed manually (rather
 * than `new Date(str)`) so the result doesn't depend on the host's locale or
 * V8's US-date-string leniency. Returns null on anything that doesn't match. */
function parseUsDate(text) {
    const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match)
        return null;
    const [, mm, dd, yyyy] = match;
    if (!mm || !dd || !yyyy)
        return null;
    const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
}
function normalizePhone(raw) {
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
}
function cellsToRecord(cells, columnIndex, licenseType) {
    const nameIdx = columnIndex.business_name;
    const businessName = nameIdx !== undefined ? cells[nameIdx]?.trim() : undefined;
    if (!businessName)
        return null;
    const licenseNumberIdx = columnIndex.license_number;
    const licenseNumber = (licenseNumberIdx !== undefined ? cells[licenseNumberIdx]?.trim() : undefined) ?? "";
    const cityIdx = columnIndex.city;
    const city = (cityIdx !== undefined ? cells[cityIdx]?.trim() : undefined) || null;
    const zipIdx = columnIndex.zip;
    const zip = (zipIdx !== undefined ? cells[zipIdx]?.trim() : undefined) || null;
    const phoneIdx = columnIndex.phone;
    const phone = normalizePhone(phoneIdx !== undefined ? cells[phoneIdx] : undefined);
    const expirationIdx = columnIndex.expiration_date;
    const expirationDate = expirationIdx !== undefined ? parseUsDate(cells[expirationIdx] ?? "") : null;
    return {
        business_name: businessName,
        license_number: licenseNumber,
        license_type: licenseType,
        city,
        zip,
        phone,
        expiration_date: expirationDate,
    };
}
/**
 * Parses a TDLR Lookup.aspx results page into licensee records. Returns an
 * empty array (never throws) when no results table is found or it has no
 * data rows — a genuinely empty search result and a structurally-changed
 * page look identical from here, so the caller (`searchLicenseType`) is the
 * one that decides whether zero rows warrants a "page structure may have
 * changed" warning.
 */
function parseLicenseeResults(html, licenseType) {
    const root = (0, node_html_parser_1.parse)(html);
    const table = findResultsTable(root);
    if (!table)
        return [];
    const rows = table.querySelectorAll("tr");
    const headerRow = rows[0];
    if (!headerRow)
        return [];
    const columnIndex = mapColumnIndexes(headerRow.querySelectorAll("th, td"));
    if (columnIndex.business_name === undefined)
        return [];
    const records = [];
    for (const row of rows.slice(1)) {
        const cells = row.querySelectorAll("td").map(cellText);
        if (cells.length === 0)
            continue;
        const record = cellsToRecord(cells, columnIndex, licenseType);
        if (record)
            records.push(record);
    }
    return records;
}
/** Active = has a parseable expiration date strictly after today. Licenses
 * with no expiration date on the page (parse failure or a genuinely blank
 * cell) are treated as not-active rather than included on an unverifiable
 * assumption. */
function isActiveLicense(record, now = new Date()) {
    if (!record.expiration_date)
        return false;
    const expiry = Date.parse(record.expiration_date);
    if (Number.isNaN(expiry))
        return false;
    return expiry > now.getTime();
}
// ── Fetch ─────────────────────────────────────────────────────────────────
async function fetchLicenseeSearchHtml(licenseType) {
    const url = new URL(TDLR_LOOKUP_URL);
    url.searchParams.set("SearchType", "Business");
    url.searchParams.set("LicenseType", licenseType);
    const result = await (0, crawler_core_1.fetchCompliant)(url.toString(), {
        adapterName: PROVIDER,
        userAgent: TDLR_USER_AGENT,
    });
    if (result.blockedReason) {
        throw new TdlrError(`TDLR licensee search blocked for license type "${licenseType}": ${result.blockedReason}.`);
    }
    if (!result.ok || !result.html) {
        throw new TdlrError(`TDLR licensee search HTTP ${result.status} for license type "${licenseType}".`);
    }
    return result.html;
}
function buildHqAddress(city, zip) {
    const cityState = city ? `${city}, TX` : null;
    const parts = [cityState, zip].filter((p) => Boolean(p));
    return parts.length > 0 ? parts.join(" ") : null;
}
async function upsertLicenseeRecord(record) {
    try {
        const directoryRecord = await (0, directory_1.upsertDirectoryRecord)({
            legal_name: record.business_name,
            website: null,
            hq_address: buildHqAddress(record.city, record.zip),
            geo: null,
            phone: record.phone,
            naics_codes: [exports.NAICS_BY_LICENSE_TYPE[record.license_type]],
            source_adapter: PROVIDER,
            enrichment: {
                tx_tdlr: {
                    license_number: record.license_number,
                    license_type: record.license_type,
                    expiration_date: record.expiration_date,
                },
            },
        });
        return {
            legal_name: directoryRecord.legal_name,
            website: directoryRecord.website,
            hq_address: directoryRecord.hq_address,
            geo: directoryRecord.geo,
            phone: directoryRecord.phone,
            naics_codes: directoryRecord.naics_codes,
            source_adapters: directoryRecord.source_adapters,
            directory_id: directoryRecord.id,
            from_cache: false,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[tx-tdlr-adapter] Directory upsert failed for "${record.business_name}": ${message}`);
        return null;
    }
}
function dedupeByDirectoryId(prospects) {
    const byKey = new Map();
    for (const prospect of prospects) {
        const key = prospect.directory_id ?? `name:${prospect.legal_name.toLowerCase()}`;
        if (!byKey.has(key))
            byKey.set(key, prospect);
    }
    return Array.from(byKey.values());
}
/**
 * Fetches, parses, and upserts every active licensee for one TDLR license
 * type. Exported standalone (in addition to the `RegistryAdapter` shape
 * below) so scripts/ingest-tx-tdlr.ts — a bounded, fixed sweep across all
 * five license types, not a per-request geography lookup — can drive it
 * directly, the same pattern scripts/ingest-samgov.ts uses against
 * samgov-adapter.ts's standalone `searchEntitiesByNaics`.
 */
async function searchLicenseType(licenseType) {
    const html = await fetchLicenseeSearchHtml(licenseType);
    const records = parseLicenseeResults(html, licenseType);
    if (records.length === 0) {
        console.warn(`[tx-tdlr-adapter] Zero licensee rows parsed for license type "${licenseType}" — ` +
            "either a genuinely empty result or the TDLR results table structure has changed.");
    }
    const activeRecords = records.filter((r) => isActiveLicense(r));
    const prospects = [];
    for (const record of activeRecords) {
        const prospect = await upsertLicenseeRecord(record);
        if (prospect)
            prospects.push(prospect);
    }
    return prospects;
}
// ── RegistryAdapter ──────────────────────────────────────────────────────────
/**
 * `RegistryAdapter.enumerate` derives which of the five license types to
 * query from `naicsCodes` (reverse of `NAICS_BY_LICENSE_TYPE`). `geography`
 * and `organizationId` are accepted for interface conformance but not used
 * as filters: TDLR's licensee search is a statewide, unauthenticated public
 * dataset with no lat/lng on the result rows and no per-organization key —
 * unlike `googlePlacesAdapter`, there is nothing here to narrow by radius or
 * gate by BYOK.
 */
async function enumerate(naicsCodes, _geography, _organizationId) {
    const licenseTypes = licenseTypesForNaics(naicsCodes);
    const prospects = [];
    for (const licenseType of licenseTypes) {
        try {
            prospects.push(...(await searchLicenseType(licenseType)));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[tx-tdlr-adapter] ${message}`);
        }
    }
    return dedupeByDirectoryId(prospects);
}
exports.txTdlrAdapter = {
    name: PROVIDER,
    enumerate,
};
