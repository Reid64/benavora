"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apolloConnector = exports.ApolloConnectorError = void 0;
const directory_1 = require("@/lib/donor-discovery/directory");
const crawler_core_1 = require("@/lib/donor-discovery/crawler-core");
const types_1 = require("@/lib/donor-discovery/connectors/types");
/**
 * Apollo.io People Search connector (DONOR_DISCOVERY_ARCHITECTURE.md §6).
 * `ConnectorEnricher` implementation: given a shared directory record and
 * the caller's already-decrypted Apollo API key, finds decision-maker
 * contacts (CEO, Executive Director, CSR Director, Donations Manager, and
 * near-synonyms — see `DECISION_MAKER_TITLE_KEYWORDS`) at that company.
 *
 * Apollo's People Search endpoint takes the API key in the request body,
 * not a header — that's Apollo's own documented auth convention for this
 * endpoint (`v1/mixed_people/search`), unlike Hunter's query-string key.
 */
const PROVIDER = "apollo";
const APOLLO_HOST = "api.apollo.io";
const SEARCH_URL = "https://api.apollo.io/v1/mixed_people/search";
const PER_PAGE = 10;
// Apollo has no documented public rate limit tier that applies uniformly
// across plans — 1 req/2s is a conservative default so a single org's
// enrichment run can't itself trip Apollo's own throttling.
const apolloRateLimiter = new crawler_core_1.DomainRateLimiter(2_000);
class ApolloConnectorError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "ApolloConnectorError";
        this.code = code;
    }
}
exports.ApolloConnectorError = ApolloConnectorError;
/** The task's explicit decision-maker target titles, sent as Apollo's `person_titles` filter (an OR match server-side). Broader synonym matching happens client-side via `isDecisionMakerTitle`. */
const TARGET_PERSON_TITLES = [
    "CEO",
    "Chief Executive Officer",
    "Executive Director",
    "CSR Director",
    "Corporate Social Responsibility Director",
    "Donations Manager",
];
function personName(person) {
    if (person.name)
        return person.name;
    const parts = [person.first_name, person.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : null;
}
function firstPhone(person) {
    const phone = person.phone_numbers?.[0];
    return phone?.sanitized_number ?? phone?.raw_number ?? null;
}
function toContact(person) {
    return {
        name: personName(person),
        title: person.title ?? null,
        email: person.email ?? null,
        phone: firstPhone(person),
        linkedin_url: person.linkedin_url ?? null,
        // Apollo's People Search response carries no per-contact confidence
        // score (unlike Hunter's domain search) — null, not a fabricated value.
        confidence: null,
    };
}
async function searchPeople(apiKey, body) {
    await apolloRateLimiter.acquire(APOLLO_HOST);
    const response = await fetch(SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            api_key: apiKey,
            person_titles: TARGET_PERSON_TITLES,
            per_page: PER_PAGE,
            ...body,
        }),
    });
    if (response.status === 401 || response.status === 403) {
        throw new ApolloConnectorError("AUTH_FAILED", `Apollo API key rejected (HTTP ${response.status}).`);
    }
    if (!response.ok) {
        throw new ApolloConnectorError("API_ERROR", `Apollo People Search HTTP ${response.status}.`);
    }
    const json = (await response.json());
    if (json.error) {
        throw new ApolloConnectorError("API_ERROR", `Apollo People Search error: ${json.error}`);
    }
    return json.people ?? [];
}
/**
 * Searches by company domain when the directory record has a website
 * (Apollo's `q_organization_domains` param — the precise match); falls back
 * to a free-text organization-name search (`q_organization_name`) when no
 * website is on file, per the task's "searches by company domain or name."
 */
async function searchByProspect(prospect, apiKey) {
    const domain = (0, directory_1.normalizeDomain)(prospect.website);
    if (domain) {
        return searchPeople(apiKey, { q_organization_domains: domain });
    }
    if (prospect.legal_name?.trim()) {
        return searchPeople(apiKey, { q_organization_name: prospect.legal_name.trim() });
    }
    throw new ApolloConnectorError("NO_SEARCH_TARGET", `Directory record ${prospect.id} has neither a website nor a legal name to search Apollo by.`);
}
async function enrich(prospect, apiKey) {
    const people = await searchByProspect(prospect, apiKey);
    const contacts = people.map(toContact).filter((contact) => (0, types_1.isDecisionMakerTitle)(contact.title));
    return {
        provider: PROVIDER,
        contacts,
        enriched_at: new Date().toISOString(),
    };
}
exports.apolloConnector = {
    provider: PROVIDER,
    enrich,
};
