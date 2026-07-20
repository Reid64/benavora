"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hunterConnector = exports.HunterConnectorError = void 0;
const directory_1 = require("@/lib/donor-discovery/directory");
const crawler_core_1 = require("@/lib/donor-discovery/crawler-core");
const types_1 = require("@/lib/donor-discovery/connectors/types");
/**
 * Hunter.io Domain Search connector (DONOR_DISCOVERY_ARCHITECTURE.md §6).
 * `ConnectorEnricher` implementation: given a shared directory record and
 * the caller's already-decrypted Hunter API key, returns every email
 * address Hunter has found for that company's domain, filtered down to
 * decision-maker titles (director/manager/president/CEO/executive/
 * development/donor/giving/CSR — `isDecisionMakerTitle`), each carrying
 * Hunter's own per-email confidence score.
 *
 * Domain-only, unlike Apollo — Hunter's Domain Search endpoint has no
 * organization-name search mode, so a directory record with no website on
 * file can't be searched at all.
 */
const PROVIDER = "hunter";
const HUNTER_HOST = "api.hunter.io";
const DOMAIN_SEARCH_URL = "https://api.hunter.io/v2/domain-search";
// Hunter's own published rate limit is generous (15 req/s on paid plans),
// but this is a shared per-org key hitting one company at a time — 1 req/s
// is a conservative default, matching this codebase's other "respectful
// polling" adapters (e.g. propublica-adapter.ts §19).
const hunterRateLimiter = new crawler_core_1.DomainRateLimiter(1_000);
class HunterConnectorError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "HunterConnectorError";
        this.code = code;
    }
}
exports.HunterConnectorError = HunterConnectorError;
function contactName(email) {
    const parts = [email.first_name, email.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : null;
}
function toContact(email) {
    return {
        name: contactName(email),
        title: email.position ?? null,
        email: email.value ?? null,
        phone: email.phone_number ?? null,
        linkedin_url: email.linkedin ?? null,
        confidence: email.confidence ?? null,
    };
}
async function domainSearch(domain, apiKey) {
    await hunterRateLimiter.acquire(HUNTER_HOST);
    const url = new URL(DOMAIN_SEARCH_URL);
    url.searchParams.set("domain", domain);
    url.searchParams.set("api_key", apiKey);
    const response = await fetch(url.toString());
    if (response.status === 401 || response.status === 403) {
        throw new HunterConnectorError("AUTH_FAILED", `Hunter API key rejected (HTTP ${response.status}).`);
    }
    if (!response.ok) {
        throw new HunterConnectorError("API_ERROR", `Hunter Domain Search HTTP ${response.status}.`);
    }
    const json = (await response.json());
    if (json.errors && json.errors.length > 0) {
        throw new HunterConnectorError("API_ERROR", `Hunter Domain Search error: ${json.errors[0]?.details ?? "unknown error"}`);
    }
    return json.data?.emails ?? [];
}
async function enrich(prospect, apiKey) {
    const domain = (0, directory_1.normalizeDomain)(prospect.website);
    if (!domain) {
        throw new HunterConnectorError("NO_SEARCH_TARGET", `Directory record ${prospect.id} has no website on file — Hunter Domain Search requires a domain.`);
    }
    const emails = await domainSearch(domain, apiKey);
    const contacts = emails.map(toContact).filter((contact) => (0, types_1.isDecisionMakerTitle)(contact.title));
    return {
        provider: PROVIDER,
        contacts,
        enriched_at: new Date().toISOString(),
    };
}
exports.hunterConnector = {
    provider: PROVIDER,
    enrich,
};
