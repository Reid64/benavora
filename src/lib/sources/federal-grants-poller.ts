// Combined federal source poller — polls Grants.gov, SAM.gov, and the
// Federal Register for one org and syncs new opportunities into
// `opportunities`, returning a per-source summary.
//
// Deviations from the task-given spec, per this project's established
// practice of checking real state before applying a literal spec (see the
// 093–097 migration headers for prior instances of this pattern):
//   - Grants.gov and SAM.gov polling already exist as production sync code
//     (src/lib/sources/grantsgov-sync.ts, backing /api/sources/grantsgov and
//     the daily cron sweep; the inline sync in
//     src/app/api/sources/samgov/route.ts). This file is the missing
//     "all three sources in one call" orchestrator, not a rebuild of those —
//     it reuses `syncGrantsGovForOrg` directly and mirrors the SAM.gov
//     route's sync logic (that route has no separate module to import, so
//     the same dedupe-by-url-encoded-noticeId approach is reproduced here).
//   - The task's literal Grants.gov/SAM.gov request shapes (raw POST body,
//     hardcoded SAM_GOV api_key in the URL) don't match the real clients:
//     `searchGrantsGovOpportunities` in ./grantsgov-client.ts is a
//     keyword-search wrapper (no "browse all posted" mode — keywords come
//     from the org's active search_profiles, same as grantsgov-sync.ts), and
//     `searchSamGovOpportunities` in ./samgov-client.ts already reads
//     SAM_GOV_API_KEY from env (its own header comment: never hardcode a
//     live credential in source).
//   - `opportunities` has no dedicated external_id column (confirmed absent
//     from every migration through 097). Every sync here dedupes by encoding
//     the source's external id into the stored `url` column instead —
//     already-established convention, not a new one introduced here.

import type { SupabaseClient } from "@supabase/supabase-js";

import { syncGrantsGovForOrg } from "@/lib/sources/grantsgov-sync";
import {
  searchSamGovOpportunities,
  type SamGovNormalizedOpportunity,
} from "@/lib/sources/samgov-client";
import { decodeHtmlEntities } from "@/lib/utils/formatters";

const FEDERAL_REGISTER_URL =
  "https://www.federalregister.gov/api/v1/documents.json";

export interface FederalSourcePollResult {
  source: string;
  found: number;
  matched: number;
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

// ---------------------------------------------------------------------------
// SAM.gov — mirrors the sync in src/app/api/sources/samgov/route.ts (no
// shared module exists for it yet, unlike Grants.gov's grantsgov-sync.ts).
// ---------------------------------------------------------------------------

function samGovExternalUrl(externalId: string): string {
  return `https://sam.gov/opp/${externalId}`;
}

function extractSamGovExternalId(url: string | null): string {
  if (!url) return "";
  const m = /\/opp\/([^/?]+)/.exec(url);
  return m && m[1] ? decodeURIComponent(m[1]) : "";
}

async function syncSamGovForOrg(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ found: number; matched: number }> {
  const hits = await searchSamGovOpportunities();
  if (hits.length === 0) return { found: 0, matched: 0 };

  const byExternalId = new Map<string, SamGovNormalizedOpportunity>();
  for (const hit of hits) {
    if (!byExternalId.has(hit.externalId)) byExternalId.set(hit.externalId, hit);
  }

  const { data: existingRows, error: existingError } = await admin
    .from("opportunities")
    .select("id, url")
    .eq("organization_id", organizationId)
    .eq("source", "sam_gov");

  if (existingError) {
    throw new Error("Could not load existing SAM.gov opportunities.");
  }

  const existingByExternalId = new Map<string, string>();
  for (const row of (existingRows ?? []) as { id: string; url: string | null }[]) {
    const externalId = extractSamGovExternalId(row.url);
    if (externalId) existingByExternalId.set(externalId, row.id);
  }

  let newCount = 0;
  let updatedCount = 0;

  for (const opp of byExternalId.values()) {
    const existingId = existingByExternalId.get(opp.externalId);

    const patch: Record<string, unknown> = {
      name: opp.name,
      description: opp.description,
      amount_max: opp.amount,
      deadline: opp.deadline,
      source: "sam_gov",
      source_type: "government_federal" as const,
      url: samGovExternalUrl(opp.externalId),
    };

    if (existingId) {
      const { error } = await admin
        .from("opportunities")
        .update(patch)
        .eq("id", existingId)
        .eq("organization_id", organizationId);
      if (!error) updatedCount++;
    } else {
      const { error } = await admin.from("opportunities").insert({
        ...patch,
        organization_id: organizationId,
        category: "government_grant" as const,
        status: "open" as const,
      });
      if (!error) newCount++;
    }
  }

  return { found: newCount + updatedCount, matched: newCount };
}

// ---------------------------------------------------------------------------
// Federal Register — grant-funding notices. No existing sync module; the
// Federal Register's html_url is already a stable, unique per-document URL,
// so (unlike Grants.gov/SAM.gov) no id-encoding scheme is needed — existing
// rows are matched by exact `url` equality.
// ---------------------------------------------------------------------------

interface FederalRegisterResult {
  document_number?: unknown;
  title?: unknown;
  abstract?: unknown;
  html_url?: unknown;
}

interface FederalRegisterResponse {
  results?: FederalRegisterResult[];
}

interface FederalRegisterNotice {
  name: string;
  description: string | null;
  url: string;
}

async function fetchFederalRegisterNotices(): Promise<FederalRegisterNotice[]> {
  const params = new URLSearchParams();
  params.append("conditions[type][]", "NOTICE");
  params.set("conditions[term]", "grant funding nonprofit");
  params.set("per_page", "50");
  params.set("order", "newest");

  let response: Response;
  try {
    response = await fetch(`${FEDERAL_REGISTER_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return [];
  }

  if (!response.ok) return [];

  let body: FederalRegisterResponse;
  try {
    body = (await response.json()) as FederalRegisterResponse;
  } catch {
    return [];
  }

  const results = Array.isArray(body.results) ? body.results : [];
  const mapped: FederalRegisterNotice[] = [];
  for (const item of results) {
    const title = decodeHtmlEntities(toStr(item.title));
    const url = toStr(item.html_url);
    if (!title || !url) continue;
    mapped.push({
      name: title,
      description: toStr(item.abstract) || null,
      url,
    });
  }
  return mapped;
}

async function syncFederalRegisterForOrg(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ found: number; matched: number }> {
  const notices = await fetchFederalRegisterNotices();
  if (notices.length === 0) return { found: 0, matched: 0 };

  const { data: existingRows, error: existingError } = await admin
    .from("opportunities")
    .select("url")
    .eq("organization_id", organizationId)
    .eq("source", "federal_register");

  if (existingError) {
    throw new Error("Could not load existing Federal Register opportunities.");
  }

  const existingUrls = new Set(
    ((existingRows ?? []) as { url: string | null }[])
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u)),
  );

  let matched = 0;
  for (const notice of notices) {
    if (existingUrls.has(notice.url)) continue;

    const { error } = await admin.from("opportunities").insert({
      organization_id: organizationId,
      name: notice.name,
      description: notice.description,
      source: "federal_register",
      source_type: "government_federal" as const,
      url: notice.url,
      category: "government_grant" as const,
      status: "open" as const,
    });
    if (!error) {
      matched++;
      existingUrls.add(notice.url);
    }
  }

  return { found: notices.length, matched };
}

/**
 * Polls Grants.gov, SAM.gov, and the Federal Register for `orgId` and syncs
 * new/updated opportunities into `opportunities`, returning a per-source
 * summary. `supabase` mirrors the `supabase: any` pattern used by
 * `runOpportunityDiscovery` (src/lib/agents/opportunity-discovery-agent.ts):
 * every query below is explicitly scoped by `organizationId`, so this is safe
 * whether the caller passes a session client (RLS on) or the service-role
 * admin client. One source failing (thrown error or non-OK response) never
 * aborts the other two — each is caught independently and reported as a
 * zeroed result, matching the non-fatal-per-source behavior already
 * established in grantsgov-client.ts, samgov-client.ts, and
 * opportunity-discovery-agent.ts.
 */
export async function pollFederalSources(
  orgId: string,
  supabase: any,
): Promise<FederalSourcePollResult[]> {
  const results: FederalSourcePollResult[] = [];

  try {
    const grantsGov = await syncGrantsGovForOrg(supabase, orgId);
    results.push({
      source: "grants_gov",
      found: grantsGov.newCount + grantsGov.updatedCount,
      matched: grantsGov.newCount,
    });
  } catch {
    results.push({ source: "grants_gov", found: 0, matched: 0 });
  }

  try {
    const samGov = await syncSamGovForOrg(supabase, orgId);
    results.push({ source: "sam_gov", found: samGov.found, matched: samGov.matched });
  } catch {
    results.push({ source: "sam_gov", found: 0, matched: 0 });
  }

  try {
    const federalRegister = await syncFederalRegisterForOrg(supabase, orgId);
    results.push({
      source: "federal_register",
      found: federalRegister.found,
      matched: federalRegister.matched,
    });
  } catch {
    results.push({ source: "federal_register", found: 0, matched: 0 });
  }

  return results;
}
