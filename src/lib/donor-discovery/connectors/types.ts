import type { DdConnectorProvider } from "@/lib/donor-discovery/connector-providers";
import type { DirectoryRecord } from "@/lib/donor-discovery/directory";

/**
 * Shared contract for §6 BYO-key connector enrichers
 * (DONOR_DISCOVERY_ARCHITECTURE.md §6). Every connector takes the shared
 * directory record it's enriching plus the caller's already-decrypted API
 * key and returns a normalized set of decision-maker contacts — never raw
 * provider JSON, so `run-connector-enrichment.ts` and the eventual UI don't
 * need per-provider parsing.
 */

export interface DecisionMakerContact {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  /** 0-100. Hunter reports a real per-email confidence score; Apollo contacts carry null (the API doesn't expose one). */
  confidence: number | null;
}

export interface ConnectorEnrichment {
  provider: DdConnectorProvider;
  contacts: DecisionMakerContact[];
  enriched_at: string;
}

export interface ConnectorEnricher {
  provider: DdConnectorProvider;
  enrich(prospect: DirectoryRecord, apiKey: string): Promise<ConnectorEnrichment>;
}

/** Job title substrings (case-insensitive) both connectors filter to — the task's "decision-maker" list, shared so it can't drift between providers. */
export const DECISION_MAKER_TITLE_KEYWORDS = [
  "ceo",
  "chief executive",
  "executive director",
  "president",
  "director",
  "manager",
  "csr",
  "corporate social responsibility",
  "development",
  "donor",
  "giving",
  "philanthropy",
];

export function isDecisionMakerTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return DECISION_MAKER_TITLE_KEYWORDS.some((keyword) => lower.includes(keyword));
}
