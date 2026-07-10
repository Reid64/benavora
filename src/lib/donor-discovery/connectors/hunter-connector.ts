import { normalizeDomain, type DirectoryRecord } from "@/lib/donor-discovery/directory";
import { DomainRateLimiter } from "@/lib/donor-discovery/crawler-core";
import {
  isDecisionMakerTitle,
  type ConnectorEnricher,
  type ConnectorEnrichment,
  type DecisionMakerContact,
} from "@/lib/donor-discovery/connectors/types";

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

const PROVIDER = "hunter" as const;
const HUNTER_HOST = "api.hunter.io";
const DOMAIN_SEARCH_URL = "https://api.hunter.io/v2/domain-search";

// Hunter's own published rate limit is generous (15 req/s on paid plans),
// but this is a shared per-org key hitting one company at a time — 1 req/s
// is a conservative default, matching this codebase's other "respectful
// polling" adapters (e.g. propublica-adapter.ts §19).
const hunterRateLimiter = new DomainRateLimiter(1_000);

export type HunterConnectorErrorCode = "AUTH_FAILED" | "API_ERROR" | "NO_SEARCH_TARGET";

export class HunterConnectorError extends Error {
  readonly code: HunterConnectorErrorCode;
  constructor(code: HunterConnectorErrorCode, message: string) {
    super(message);
    this.name = "HunterConnectorError";
    this.code = code;
  }
}

interface HunterEmail {
  value?: string | null;
  confidence?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  phone_number?: string | null;
  linkedin?: string | null;
}

interface HunterDomainSearchResponse {
  data?: { emails?: HunterEmail[] | null } | null;
  errors?: Array<{ details?: string }>;
}

function contactName(email: HunterEmail): string | null {
  const parts = [email.first_name, email.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function toContact(email: HunterEmail): DecisionMakerContact {
  return {
    name: contactName(email),
    title: email.position ?? null,
    email: email.value ?? null,
    phone: email.phone_number ?? null,
    linkedin_url: email.linkedin ?? null,
    confidence: email.confidence ?? null,
  };
}

async function domainSearch(domain: string, apiKey: string): Promise<HunterEmail[]> {
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

  const json = (await response.json()) as HunterDomainSearchResponse;
  if (json.errors && json.errors.length > 0) {
    throw new HunterConnectorError(
      "API_ERROR",
      `Hunter Domain Search error: ${json.errors[0]?.details ?? "unknown error"}`,
    );
  }

  return json.data?.emails ?? [];
}

async function enrich(prospect: DirectoryRecord, apiKey: string): Promise<ConnectorEnrichment> {
  const domain = normalizeDomain(prospect.website);
  if (!domain) {
    throw new HunterConnectorError(
      "NO_SEARCH_TARGET",
      `Directory record ${prospect.id} has no website on file — Hunter Domain Search requires a domain.`,
    );
  }

  const emails = await domainSearch(domain, apiKey);
  const contacts = emails.map(toContact).filter((contact) => isDecisionMakerTitle(contact.title));

  return {
    provider: PROVIDER,
    contacts,
    enriched_at: new Date().toISOString(),
  };
}

export const hunterConnector: ConnectorEnricher = {
  provider: PROVIDER,
  enrich,
};
