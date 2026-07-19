"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LandBankDirectoryError = void 0;
exports.parseLandBankDirectory = parseLandBankDirectory;
exports.fetchLandBankDirectory = fetchLandBankDirectory;
const node_html_parser_1 = require("node-html-parser");
const crawler_core_1 = require("../../../lib/donor-discovery/crawler-core");
const directory_1 = require("../../../lib/donor-discovery/directory");
/**
 * Center for Community Progress land bank directory adapter
 * (DONOR_DISCOVERY_ARCHITECTURE.md §1B "civic entity types" — land banks —
 * and §2A layer 4 "Civic directories ... scraped once, refreshed quarterly
 * by cron").
 *
 * Source: GET https://www.communityprogress.org/resources/land-bank-resources/land-bank-directory/
 * A single public directory page, not a per-geography or per-NAICS search —
 * unlike the registry-layer adapters (google-places-adapter.ts,
 * samgov-adapter.ts, tx-tdlr-adapter.ts), this one doesn't implement
 * `RegistryAdapter`. There's no NAICS code or lat/lng radius to enumerate
 * against; land banks are a fixed national list (~300 entities per the
 * architecture doc) refreshed on a schedule, so the whole point of a run is
 * "fetch the one page, upsert whatever's on it."
 *
 * Fetched through `fetchCompliant` (crawler-core.ts) — kill switch, ToS
 * registry, robots.txt, and the shared per-domain rate limiter — like every
 * other scraped (non-paid-API) source in this codebase.
 *
 * HTML parsing uses `node-html-parser` (see tx-tdlr-adapter.ts's file header
 * for why that adapter picked it over the existing `cheerio` dependency —
 * the same reasoning applies here: a single flat table extraction, matched
 * by header text rather than a hardcoded column index so a column reorder on
 * communityprogress.org's end doesn't silently mis-map fields).
 *
 * Nothing in this module runs at import time — matching the lazy-init
 * convention used by every other donor-discovery adapter.
 */
const PROVIDER = "land_bank_directory";
const CIVIC_KIND = "land_bank";
const DIRECTORY_URL = "https://www.communityprogress.org/resources/land-bank-resources/land-bank-directory/";
const LAND_BANK_USER_AGENT = "BenavoraBot/1.0 (+https://benavora.vercel.app/security; Donor Discovery land bank directory scrape)";
class LandBankDirectoryError extends Error {
    constructor(message) {
        super(message);
        this.name = "LandBankDirectoryError";
    }
}
exports.LandBankDirectoryError = LandBankDirectoryError;
const HEADER_ALIASES = {
    "name": "org_name",
    "organization": "org_name",
    "organization name": "org_name",
    "land bank": "org_name",
    "land bank name": "org_name",
    "state": "state",
    "city": "city",
    "location": "city",
    "website": "website",
    "url": "website",
    "web site": "website",
    "contact": "contact",
    "contact name": "contact",
    "contact info": "contact",
    "email": "contact",
};
function cellText(el) {
    return el.text.replace(/\s+/g, " ").trim();
}
/** First `<a href>` inside a cell, if any — the directory typically links the
 * org name or a dedicated "Website" cell out to the land bank's own site
 * rather than printing the bare URL as text. */
function cellLinkHref(el) {
    const anchor = el.querySelector("a[href]");
    const href = anchor?.getAttribute("href")?.trim();
    return href && !href.startsWith("mailto:") ? href : null;
}
function cellMailto(el) {
    const anchor = el.querySelector("a[href^='mailto:']");
    const href = anchor?.getAttribute("href")?.trim();
    return href ? href.replace(/^mailto:/i, "") : null;
}
/** The directory table is the one containing a header row that mentions both
 * a "name"/"organization" label and a "state" or "land bank" label — every
 * other table on the page (nav, related-resources) won't match both. */
function findDirectoryTable(root) {
    const tables = root.querySelectorAll("table");
    for (const table of tables) {
        const headerRow = table.querySelector("tr");
        if (!headerRow)
            continue;
        const headerText = cellText(headerRow).toLowerCase();
        const hasName = headerText.includes("name") || headerText.includes("organization") || headerText.includes("land bank");
        const hasLocation = headerText.includes("state") || headerText.includes("city") || headerText.includes("location");
        if (hasName && hasLocation)
            return table;
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
function cellAt(cellElements, index) {
    return index !== undefined ? cellElements[index] : undefined;
}
function cellsToRecord(cellElements, columnIndex) {
    const nameCell = cellAt(cellElements, columnIndex.org_name);
    const orgName = nameCell ? cellText(nameCell) : undefined;
    if (!orgName)
        return null;
    const stateCell = cellAt(cellElements, columnIndex.state);
    const state = (stateCell ? cellText(stateCell) : "") || null;
    const cityCell = cellAt(cellElements, columnIndex.city);
    const city = (cityCell ? cellText(cityCell) : "") || null;
    const websiteCell = cellAt(cellElements, columnIndex.website);
    const website = (websiteCell ? cellLinkHref(websiteCell) || cellText(websiteCell) || null : null) ??
        (nameCell ? cellLinkHref(nameCell) : null);
    const contactCell = cellAt(cellElements, columnIndex.contact);
    const contact = contactCell ? cellMailto(contactCell) || cellText(contactCell) || null : null;
    return {
        org_name: orgName,
        state,
        city,
        website: website || null,
        contact,
    };
}
/**
 * Parses the Center for Community Progress land bank directory page into
 * records. Returns an empty array (never throws) when no directory table is
 * found or it has no data rows — the caller (`fetchLandBankDirectory`)
 * decides whether that warrants a "page structure may have changed" warning,
 * per BEHAVIORAL_CONTRACTS.md §21.
 */
function parseLandBankDirectory(html) {
    const root = (0, node_html_parser_1.parse)(html);
    const table = findDirectoryTable(root);
    if (!table)
        return [];
    const rows = table.querySelectorAll("tr");
    const headerRow = rows[0];
    if (!headerRow)
        return [];
    const columnIndex = mapColumnIndexes(headerRow.querySelectorAll("th, td"));
    if (columnIndex.org_name === undefined)
        return [];
    const records = [];
    for (const row of rows.slice(1)) {
        const cells = row.querySelectorAll("td");
        if (cells.length === 0)
            continue;
        const record = cellsToRecord(cells, columnIndex);
        if (record)
            records.push(record);
    }
    return records;
}
// ── Fetch + upsert ───────────────────────────────────────────────────────────
async function fetchDirectoryHtml() {
    const result = await (0, crawler_core_1.fetchCompliant)(DIRECTORY_URL, {
        adapterName: PROVIDER,
        userAgent: LAND_BANK_USER_AGENT,
    });
    if (result.blockedReason) {
        throw new LandBankDirectoryError(`Land bank directory fetch blocked: ${result.blockedReason}.`);
    }
    if (!result.ok || !result.html) {
        throw new LandBankDirectoryError(`Land bank directory fetch HTTP ${result.status}.`);
    }
    return result.html;
}
function buildHqAddress(city, state) {
    const parts = [city, state].filter((p) => Boolean(p));
    return parts.length > 0 ? parts.join(", ") : null;
}
async function upsertLandBankRecord(record) {
    try {
        const directoryRecord = await (0, directory_1.upsertDirectoryRecord)({
            legal_name: record.org_name,
            website: record.website,
            hq_address: buildHqAddress(record.city, record.state),
            geo: null,
            phone: null,
            naics_codes: [],
            civic_kind: CIVIC_KIND,
            source_adapter: PROVIDER,
            enrichment: record.contact ? { land_bank: { contact: record.contact } } : null,
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
        console.warn(`[land-bank-adapter] Directory upsert failed for "${record.org_name}": ${message}`);
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
 * Fetches, parses, and upserts the full Center for Community Progress land
 * bank directory. Exported standalone — not wrapped in a `RegistryAdapter`,
 * see file header — so scripts/ingest-land-banks.ts can drive it directly.
 */
async function fetchLandBankDirectory() {
    const html = await fetchDirectoryHtml();
    const records = parseLandBankDirectory(html);
    if (records.length === 0) {
        console.warn("[land-bank-adapter] Zero land bank rows parsed — either the directory is genuinely empty " +
            "or communityprogress.org's page structure has changed.");
    }
    const prospects = [];
    for (const record of records) {
        const prospect = await upsertLandBankRecord(record);
        if (prospect)
            prospects.push(prospect);
    }
    return dedupeByDirectoryId(prospects);
}
