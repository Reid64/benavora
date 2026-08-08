// Domain allowlist enforcement for Custom API Connectors / Scraping Targets
// (FEATURE_REGISTRY_v2.md rows #59/#60).
//
// Per-org, admin-configured allowlist of domains a custom connector is
// permitted to target — deliberately a SEPARATE control from end users
// typing in any base_url/target url they like. An org admin manages the
// allowlist (custom_connector_allowlist, migration 132); a writer creating a
// connector can only point it at an already-allowlisted domain, and every
// execution re-checks the allowlist at fetch time (not just at save time),
// so removing a domain from the allowlist immediately stops any connector
// still configured against it.

import type { SupabaseClient } from "@supabase/supabase-js";

export class AllowlistBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowlistBlockedError";
  }
}

/** Lowercased hostname, no scheme/path/port. Throws on an unparseable URL. */
export function extractHostname(url: string): string {
  const parsed = new URL(url);
  return parsed.hostname.toLowerCase();
}

/**
 * True if `hostname` matches `allowedDomain` exactly, or is a subdomain of it
 * (e.g. allowing "grants.example.gov" also allows "api.grants.example.gov").
 */
function domainMatches(hostname: string, allowedDomain: string): boolean {
  const domain = allowedDomain.toLowerCase();
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Throws {@link AllowlistBlockedError} unless `url`'s hostname matches at
 * least one active allowlist entry for `organizationId`. Call this both
 * before saving a connector/target (so an admin gets immediate feedback) and
 * immediately before every fetch (so a since-removed domain can't still run).
 */
export async function assertDomainAllowed(
  supabase: SupabaseClient,
  organizationId: string,
  url: string,
): Promise<void> {
  let hostname: string;
  try {
    hostname = extractHostname(url);
  } catch {
    throw new AllowlistBlockedError("Invalid URL.");
  }

  const { data, error } = await supabase
    .from("custom_connector_allowlist")
    .select("domain")
    .eq("organization_id", organizationId);

  if (error) {
    // Fail closed — an allowlist we couldn't read is not an allowlist that
    // passed.
    throw new AllowlistBlockedError("Could not verify the domain allowlist.");
  }

  const allowed = (data ?? []).some((row) =>
    domainMatches(hostname, row.domain as string),
  );

  if (!allowed) {
    throw new AllowlistBlockedError(
      `"${hostname}" is not on this organization's allowlisted domains. An admin must add it under Settings before a connector can target it.`,
    );
  }
}

/** Normalizes a user-entered domain: strips scheme/path/port, lowercases. */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    // Allow entries typed as either "example.com" or "https://example.com/path".
    const withScheme = /^[a-z]+:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  }
}
