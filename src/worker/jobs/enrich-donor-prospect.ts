import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EnrichmentAgent,
  type EnrichmentRecord,
} from "@/lib/donor-discovery/agents/enrichment-agent";
import { parseGeo } from "@/lib/donor-discovery/directory";
import {
  scoreProspect,
  parseScoringWeights,
  type ScoringDirectoryRecord,
} from "@/lib/donor-discovery/scoring";
import type { DdGeography } from "@/lib/donor-discovery/adapters/google-places";
import type { Json } from "@/types/database";

/**
 * `enrich_donor_prospect` worker job (DONOR_DISCOVERY_ARCHITECTURE.md §2B/
 * §2D). Re-enriches one shared `donor_discovery_directory` record via
 * `EnrichmentAgent.enrich`, then re-scores every org-scoped
 * `donor_discovery_prospects` row linked to it.
 *
 * `donor_discovery_directory` has no dedicated job-queue status column (it's
 * a shared, platform-wide table, not a per-tenant queue like
 * `submission_queue`), so `claimNextEnrichDonorProspectJob` treats "website
 * on file, no or stale (>180-day) `enriched_at`, at least one linked
 * prospect" as the queue predicate — the same staleness rule
 * `worker/dd-request-processor.ts`'s per-request enrichment stage already
 * uses, generalized here into a standalone, dequeue-one-job-at-a-time unit
 * so it can run opportunistically from any worker loop's idle cycle.
 */

export const ENRICH_DONOR_PROSPECT_JOB_TYPE = "enrich_donor_prospect" as const;

const ENRICHMENT_TTL_DAYS = 180;
const CLAIM_SCAN_LIMIT = 50;

export interface EnrichDonorProspectJob {
  type: typeof ENRICH_DONOR_PROSPECT_JOB_TYPE;
  directoryId: string;
}

export interface EnrichDonorProspectResult {
  directoryId: string;
  enrichment: EnrichmentRecord;
  scoredProspectCount: number;
}

interface DirectoryScoringRow {
  id: string;
  enrichment: Record<string, unknown> | null;
  hq_address: string | null;
  geo: unknown;
  linked_foundation_id: string | null;
  linkage_confidence: number | null;
}

interface ProspectRow {
  id: string;
  organization_id: string;
  request_id: string;
}

interface RequestGeographyRow {
  id: string;
  geography: DdGeography;
}

interface OrganizationScoringContextRow {
  id: string;
  annual_budget: number | null;
  donor_discovery_scoring_weights: Json | null;
}

interface FoundationGivingCapacityRow {
  id: string;
  giving_total: number | null;
  asset_amount: number | null;
}

// ── Job handler ──────────────────────────────────────────────────────────────

/**
 * Runs one `enrich_donor_prospect` job: re-enriches the directory record
 * (§2B) via `EnrichmentAgent.enrich`, then re-scores (§2D) every prospect
 * linked to it, using each prospect's originating request for geography
 * context — the same inputs `worker/dd-request-processor.ts`'s per-request
 * scoring stage uses, generalized here across every request/org that has
 * ever surfaced this directory record rather than one request's batch.
 */
export async function handleEnrichDonorProspectJob(
  supabase: SupabaseClient,
  job: EnrichDonorProspectJob,
): Promise<EnrichDonorProspectResult> {
  const agent = new EnrichmentAgent(supabase);
  const enrichment = await agent.enrich(job.directoryId);

  const scoredProspectCount = await rescoreLinkedProspects(supabase, job.directoryId);

  return { directoryId: job.directoryId, enrichment, scoredProspectCount };
}

async function rescoreLinkedProspects(
  supabase: SupabaseClient,
  directoryId: string,
): Promise<number> {
  const { data: directoryRow, error: directoryError } = await supabase
    .from("donor_discovery_directory")
    .select("id, enrichment, hq_address, geo, linked_foundation_id, linkage_confidence")
    .eq("id", directoryId)
    .maybeSingle();

  if (directoryError || !directoryRow) {
    console.error(
      `[enrich-donor-prospect] Directory lookup failed for ${directoryId}: ${directoryError?.message ?? "not found"}`,
    );
    return 0;
  }

  const directory = directoryRow as DirectoryScoringRow;

  const { data: prospectRows, error: prospectsError } = await supabase
    .from("donor_discovery_prospects")
    .select("id, organization_id, request_id")
    .eq("directory_id", directoryId);

  if (prospectsError) {
    console.error(
      `[enrich-donor-prospect] Prospect lookup failed for ${directoryId}: ${prospectsError.message}`,
    );
    return 0;
  }

  const prospects = (prospectRows ?? []) as ProspectRow[];
  if (prospects.length === 0) return 0;

  const requestIds = Array.from(new Set(prospects.map((p) => p.request_id)));
  const { data: requestRows, error: requestsError } = await supabase
    .from("donor_discovery_requests")
    .select("id, geography")
    .in("id", requestIds);

  if (requestsError) {
    console.error(`[enrich-donor-prospect] Request geography lookup failed: ${requestsError.message}`);
    return 0;
  }

  const geographyByRequestId = new Map(
    ((requestRows ?? []) as RequestGeographyRow[]).map((r) => [r.id, r.geography]),
  );

  const organizationIds = Array.from(new Set(prospects.map((p) => p.organization_id)));
  const { data: orgRows, error: orgsError } = await supabase
    .from("organizations")
    .select("id, annual_budget, donor_discovery_scoring_weights")
    .in("id", organizationIds);

  if (orgsError) {
    console.error(`[enrich-donor-prospect] Organization lookup failed: ${orgsError.message}`);
    return 0;
  }

  const orgById = new Map(
    ((orgRows ?? []) as OrganizationScoringContextRow[]).map((o) => [o.id, o]),
  );

  let givingCapacity: number | null = null;
  if (directory.linked_foundation_id) {
    const { data: foundationRow } = await supabase
      .from("foundation_directory")
      .select("id, giving_total, asset_amount")
      .eq("id", directory.linked_foundation_id)
      .maybeSingle();
    const foundation = foundationRow as FoundationGivingCapacityRow | null;
    givingCapacity = foundation?.giving_total ?? foundation?.asset_amount ?? null;
  }

  const directoryRecord: ScoringDirectoryRecord = {
    enrichment: directory.enrichment,
    hq_address: directory.hq_address,
    geo: parseGeo(directory.geo),
    linked_foundation_id: directory.linked_foundation_id,
    linkage_confidence: directory.linkage_confidence,
  };

  let scoredCount = 0;

  for (const prospect of prospects) {
    const geography = geographyByRequestId.get(prospect.request_id);
    if (!geography) continue;

    const org = orgById.get(prospect.organization_id);
    const weights = parseScoringWeights(org?.donor_discovery_scoring_weights ?? null);

    const { score, rationale } = scoreProspect(
      directoryRecord,
      {
        geography,
        organizationAnnualBudget: org?.annual_budget ?? null,
        linkedFoundationGivingCapacity: givingCapacity,
      },
      weights,
    );

    const { error: updateError } = await supabase
      .from("donor_discovery_prospects")
      .update({ score, score_rationale: rationale })
      .eq("id", prospect.id);

    if (updateError) {
      console.error(
        `[enrich-donor-prospect] Failed to update score for prospect ${prospect.id}: ${updateError.message}`,
      );
      continue;
    }

    scoredCount += 1;
  }

  return scoredCount;
}

// ── Dequeue ──────────────────────────────────────────────────────────────────

/**
 * Best-effort claim of the next `enrich_donor_prospect` job: scans the
 * oldest `CLAIM_SCAN_LIMIT` directory records with a website and no-or-stale
 * enrichment, and returns the first one that has at least one linked
 * prospect (re-enriching a company nobody has actually prospected would be
 * wasted work). `donor_discovery_directory` carries no status column to
 * lock, so this is a plain scan rather than a `FOR UPDATE SKIP LOCKED`
 * claim; `EnrichmentAgent.enrich` is idempotent, so two workers racing on
 * the same record just means one wasted enrichment pass, never corrupted
 * data.
 */
export async function claimNextEnrichDonorProspectJob(
  supabase: SupabaseClient,
): Promise<EnrichDonorProspectJob | null> {
  const staleCutoffIso = new Date(
    Date.now() - ENRICHMENT_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: staleRows, error: staleError } = await supabase
    .from("donor_discovery_directory")
    .select("id")
    .not("website", "is", null)
    .or(`enriched_at.is.null,enriched_at.lt.${staleCutoffIso}`)
    .order("created_at", { ascending: true })
    .limit(CLAIM_SCAN_LIMIT);

  if (staleError || !staleRows || staleRows.length === 0) return null;

  const candidateIds = (staleRows as Array<{ id: string }>).map((r) => r.id);

  const { data: prospectRows, error: prospectError } = await supabase
    .from("donor_discovery_prospects")
    .select("directory_id")
    .in("directory_id", candidateIds)
    .limit(1);

  if (prospectError || !prospectRows || prospectRows.length === 0) return null;

  const directoryId = (prospectRows[0] as { directory_id: string }).directory_id;
  return { type: ENRICH_DONOR_PROSPECT_JOB_TYPE, directoryId };
}
