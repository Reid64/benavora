import { DomainRateLimiter } from "@/lib/donor-discovery/crawler-core";
import { upsertDirectoryRecord, type DirectoryGeo } from "@/lib/donor-discovery/directory";
import type { RawProspect } from "@/lib/donor-discovery/adapters/google-places-adapter";

/**
 * SAM.gov registry adapter (DONOR_DISCOVERY_ARCHITECTURE.md §2A "Registry
 * layer"). Two independent lookups against the same platform-managed key:
 *
 *  1. `searchEntitiesByNaics` — SAM.gov Entity Management API v3
 *     (https://api.sam.gov/entity-information/v3/entities), filtered to
 *     entities registered for federal financial assistance
 *     (purposeOfRegistrationCode=Z2) matching a NAICS code. These are
 *     businesses that have opted into federal grant/assistance eligibility —
 *     a much closer signal for "potential corporate donor with government
 *     relationships" than the raw SAM entity list.
 *
 *  2. `searchRecentAwardRecipients` — SAM.gov Contract Opportunities API v2
 *     (https://api.sam.gov/opportunities/v2/search), filtered to Award
 *     Notices (ptype=a) posted in the last N days. Award Notices are the one
 *     opportunity type that carries an `awardee` block, which is what makes
 *     this endpoint usable for "who did the government just pay" rather than
 *     "who is the government asking for bids" — every other posting type
 *     under this endpoint has no recipient identity, only agency and
 *     solicitation metadata (see the existing `sam-gov.ts` grant-discovery
 *     agent, which reads `title`/`agency` from this same host for the
 *     opposite purpose: finding funding opportunities, not funded
 *     companies).
 *
 * Both write into the shared `donor_discovery_directory` via
 * `upsertDirectoryRecord()` (directory.ts) — never a raw insert — with
 * `source_adapter: "samgov"`.
 *
 * Env var: SAM_GOV_API_KEY. The task that requested this adapter referred to
 * it as `SAM_API_KEY`, but every other SAM.gov integration already in this
 * codebase (src/lib/agents/sam-gov.ts, src/app/api/agents/sam-gov/route.ts,
 * .env.local) reads `SAM_GOV_API_KEY` — that's the actual configured name,
 * so this adapter follows it rather than introducing a second, dead env var
 * for the same key.
 *
 * Rate limit: 450 requests/minute, shared across both endpoints since
 * they're billed against the same API key (SAM.gov's per-key quota, not a
 * per-host one) — one `DomainRateLimiter` bucket keyed on "api.sam.gov".
 *
 * Nothing in this module runs at import time — the env var is only read
 * inside the exported functions, matching the lazy-init convention used by
 * every other donor-discovery adapter.
 */

const PROVIDER = "samgov";
const ENTITY_API_URL = "https://api.sam.gov/entity-information/v3/entities";
const OPPORTUNITIES_API_URL = "https://api.sam.gov/opportunities/v2/search";

const SAM_HOST = "api.sam.gov";
// 450 req/min == 1 req / 133.33ms. Round up so the bucket never exceeds the quota.
const samRateLimiter = new DomainRateLimiter(Math.ceil(60_000 / 450));

export class SamGovError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SamGovError";
  }
}

function getApiKey(): string {
  const key = process.env.SAM_GOV_API_KEY;
  if (!key) {
    throw new SamGovError("SAM_GOV_API_KEY environment variable is not configured.");
  }
  return key;
}

/** SAM.gov date params are MM/dd/yyyy, not ISO. */
function toSamDate(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

// ── Entity Management API v3 ─────────────────────────────────────────────────

interface RawEntityPhysicalAddress {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateOrProvinceCode?: string | null;
  zipCode?: string | null;
  countryCode?: string | null;
}

interface RawEntity {
  entityRegistration?: {
    ueiSAM?: string | null;
    legalBusinessName?: string | null;
    registrationStatus?: string | null;
  };
  coreData?: {
    entityInformation?: {
      entityURL?: string | null;
    };
    physicalAddress?: RawEntityPhysicalAddress;
  };
}

interface RawEntitySearchResponse {
  totalRecords?: number;
  entityData?: RawEntity[];
}

function formatPhysicalAddress(addr: RawEntityPhysicalAddress | undefined): string | null {
  if (!addr) return null;
  const parts = [addr.addressLine1, addr.addressLine2, addr.city, addr.stateOrProvinceCode, addr.zipCode]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : null;
}

function normalizeEntity(raw: RawEntity, naicsCode: string): RawProspect | null {
  const legalName = raw.entityRegistration?.legalBusinessName?.trim();
  if (!legalName) return null;

  return {
    legal_name: legalName,
    website: raw.coreData?.entityInformation?.entityURL?.trim() || null,
    hq_address: formatPhysicalAddress(raw.coreData?.physicalAddress),
    geo: null as DirectoryGeo | null, // Entity API doesn't return lat/lng.
    phone: null,
    naics_codes: [naicsCode],
    source_adapters: [PROVIDER],
    directory_id: null,
    from_cache: false,
  };
}

export interface SearchEntitiesOptions {
  /** MM/dd/yyyy. Defaults to today — "currently active as of" per SAM's convention. */
  activeDate?: string;
  /** Entity API page size. Default 100 (single page — see file header on pagination scope). */
  size?: number;
}

/**
 * Searches SAM.gov Entity Management API v3 for entities registered for
 * federal financial assistance (purposeOfRegistrationCode=Z2) matching
 * `naicsCode`, upserts each into `donor_discovery_directory`, and returns
 * the upserted `RawProspect` rows.
 *
 * Single page only — the task this adapter was built for is a bounded,
 * fixed-list NAICS sweep (scripts/ingest-samgov.ts), not an exhaustive crawl;
 * a future caller needing full pagination can extend this with a `page`
 * param without changing the contract here.
 */
export async function searchEntitiesByNaics(
  naicsCode: string,
  opts: SearchEntitiesOptions = {},
): Promise<RawProspect[]> {
  const apiKey = getApiKey();
  await samRateLimiter.acquire(SAM_HOST);

  const url = new URL(ENTITY_API_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("purposeOfRegistrationCode", "Z2");
  url.searchParams.set("naicsCode", naicsCode);
  url.searchParams.set("activeDate", opts.activeDate ?? toSamDate(new Date()));
  url.searchParams.set("size", String(opts.size ?? 100));

  const response = await fetch(url.toString());
  if (response.status === 401 || response.status === 403) {
    throw new SamGovError("SAM.gov API key is invalid or unauthorized for the Entity Management API.");
  }
  if (!response.ok) {
    throw new SamGovError(`SAM.gov entity search HTTP ${response.status} for NAICS ${naicsCode}.`);
  }

  const body = (await response.json()) as RawEntitySearchResponse;
  const prospects: RawProspect[] = [];

  for (const raw of body.entityData ?? []) {
    const normalized = normalizeEntity(raw, naicsCode);
    if (!normalized) continue;

    try {
      const record = await upsertDirectoryRecord({
        legal_name: normalized.legal_name,
        website: normalized.website,
        hq_address: normalized.hq_address,
        geo: normalized.geo,
        phone: normalized.phone,
        naics_codes: normalized.naics_codes,
        source_adapter: PROVIDER,
      });
      prospects.push({ ...normalized, directory_id: record.id, source_adapters: record.source_adapters });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[samgov-adapter] Directory upsert failed for "${normalized.legal_name}": ${message}`);
      prospects.push(normalized);
    }
  }

  return prospects;
}

// ── Contract Opportunities API v2 — Award Notices ────────────────────────────

interface RawAwardee {
  name?: string | null;
  ueiSAM?: string | null;
  location?: {
    streetAddress?: string | null;
    city?: { name?: string | null } | null;
    state?: { code?: string | null } | null;
    zip?: string | null;
  } | null;
}

interface RawAwardOpportunity {
  title?: string | null;
  naicsCode?: string | null;
  awardee?: RawAwardee | null;
}

interface RawOpportunitySearchResponse {
  totalRecords?: number;
  opportunitiesData?: RawAwardOpportunity[];
}

function formatAwardeeAddress(location: RawAwardee["location"]): string | null {
  if (!location) return null;
  const parts = [location.streetAddress, location.city?.name, location.state?.code, location.zip]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : null;
}

function normalizeAwardee(raw: RawAwardOpportunity): RawProspect | null {
  const legalName = raw.awardee?.name?.trim();
  if (!legalName) return null;

  return {
    legal_name: legalName,
    website: null, // Award Notices don't carry a website field.
    hq_address: formatAwardeeAddress(raw.awardee?.location),
    geo: null,
    phone: null,
    naics_codes: raw.naicsCode ? [raw.naicsCode] : [],
    source_adapters: [PROVIDER],
    directory_id: null,
    from_cache: false,
  };
}

/**
 * Searches SAM.gov Contract Opportunities API v2 for Award Notices
 * (ptype=a) posted in the last `daysBack` days (default 90), extracts the
 * awardee (the company the government just paid) from each, upserts every
 * distinct awardee into `donor_discovery_directory`, and returns the
 * upserted `RawProspect` rows. Postings with no `awardee` block (the vast
 * majority of non-Award-Notice opportunity types) are skipped rather than
 * producing a directory row with no company identity.
 */
export async function searchRecentAwardRecipients(daysBack = 90): Promise<RawProspect[]> {
  const apiKey = getApiKey();
  await samRateLimiter.acquire(SAM_HOST);

  const url = new URL(OPPORTUNITIES_API_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("ptype", "a"); // Award Notice — the only type carrying an `awardee` block.
  url.searchParams.set("limit", "1000");
  url.searchParams.set("postedFrom", toSamDate(daysAgo(daysBack)));
  url.searchParams.set("postedTo", toSamDate(new Date()));

  const response = await fetch(url.toString());
  if (response.status === 401 || response.status === 403) {
    throw new SamGovError("SAM.gov API key is invalid or unauthorized for the Opportunities API.");
  }
  if (!response.ok) {
    throw new SamGovError(`SAM.gov award recipient search HTTP ${response.status}.`);
  }

  const body = (await response.json()) as RawOpportunitySearchResponse;
  const seenNames = new Set<string>();
  const prospects: RawProspect[] = [];

  for (const raw of body.opportunitiesData ?? []) {
    const normalized = normalizeAwardee(raw);
    if (!normalized) continue;

    const dedupeKey = normalized.legal_name.toLowerCase();
    if (seenNames.has(dedupeKey)) continue;
    seenNames.add(dedupeKey);

    try {
      const record = await upsertDirectoryRecord({
        legal_name: normalized.legal_name,
        website: normalized.website,
        hq_address: normalized.hq_address,
        geo: normalized.geo,
        phone: normalized.phone,
        naics_codes: normalized.naics_codes,
        source_adapter: PROVIDER,
      });
      prospects.push({ ...normalized, directory_id: record.id, source_adapters: record.source_adapters });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[samgov-adapter] Directory upsert failed for awardee "${normalized.legal_name}": ${message}`);
      prospects.push(normalized);
    }
  }

  return prospects;
}
