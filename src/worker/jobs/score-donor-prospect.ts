import type { SupabaseClient } from "@supabase/supabase-js";

import { ScoringEngine, type RequestContext } from "@/lib/donor-discovery/scoring-engine";
import type { DdGeography } from "@/lib/donor-discovery/adapters/google-places";
import type { ScoreResult } from "@/lib/donor-discovery/scoring";

/**
 * `score_donor_prospect` worker job (DONOR_DISCOVERY_ARCHITECTURE.md §2D).
 * Runs the Claude-rationale `ScoringEngine` (scoring-engine.ts) for one
 * `donor_discovery_prospects` row at a time, mirroring
 * `enrich-donor-prospect.ts`'s claim/handle shape so it can be wired into
 * any worker loop's idle cycle the same way.
 *
 * Distinct from `worker/dd-request-processor.ts`'s scoring stage, which
 * scores every prospect a request just surfaced synchronously, inline, with
 * the deterministic (non-Claude) `scoring.ts` engine before marking the
 * request complete. This job is the supplementary path: prospects that have
 * never been scored by `ScoringEngine`, or whose `scored_at` has gone stale,
 * picked up one at a time opportunistically.
 */

export const SCORE_DONOR_PROSPECT_JOB_TYPE = "score_donor_prospect" as const;

const SCORE_TTL_DAYS = 30;
const CLAIM_SCAN_LIMIT = 1;

export interface ScoreDonorProspectJob {
  type: typeof SCORE_DONOR_PROSPECT_JOB_TYPE;
  prospectId: string;
}

export interface ScoreDonorProspectResult {
  prospectId: string;
  result: ScoreResult;
}

interface ProspectContextRow {
  id: string;
  organization_id: string;
  request_id: string;
}

interface RequestGeographyRow {
  geography: DdGeography;
  taxonomy_ids: string[];
}

interface OrganizationMissionRow {
  mission_statement: string | null;
}

interface TaxonomyLabelRow {
  id: string;
  label: string;
}

// ── Dequeue ──────────────────────────────────────────────────────────────────

/**
 * Best-effort claim of the next `score_donor_prospect` job: the oldest
 * prospect with no `scored_at` (never scored by this engine) or a
 * `scored_at` older than `SCORE_TTL_DAYS`. `donor_discovery_prospects`
 * carries no status column to lock — same posture as
 * `claimNextEnrichDonorProspectJob` — a plain scan rather than a
 * `FOR UPDATE SKIP LOCKED` claim; `ScoringEngine.score` is idempotent, so two
 * workers racing on the same prospect just means one wasted scoring pass.
 *
 * Real defect found + fixed 2026-08-22: every one of `ScoringEngine`'s seven
 * signals except `foundationLinkageFound` depends on web-enrichment fields
 * (`has_giving_program`, `has_donation_form`, `in_kind_history_signals`,
 * `csr_page_url`, `company_size_estimate`) that only ever get populated for a
 * directory record with a `website` (see `enrichment-agent.ts`). For a
 * grantmaker-mode/BMF-sourced prospect (no website on file — see
 * `bmf-directory.ts`), this job had nothing to contribute beyond what
 * `scoring.ts`'s deterministic pass already computed, yet it still
 * unconditionally overwrote `score`/`score_rationale` — collapsing a real,
 * spread-producing deterministic score down to whatever
 * `foundationLinkageFound` alone is worth (flat 15/100 for every BMF
 * prospect, confirmed live against request `f4870e28-...`'s 59 prospects,
 * all re-scored to an identical 15 by this job ~4 hours after the request
 * completed). Filtered here to only claim prospects whose linked directory
 * record actually has a `website` — nothing for this engine to add
 * otherwise, and no clobbering.
 */
export async function claimNextScoreDonorProspectJob(
  supabase: SupabaseClient,
): Promise<ScoreDonorProspectJob | null> {
  const staleCutoffIso = new Date(Date.now() - SCORE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("donor_discovery_prospects")
    .select("id, donor_discovery_directory!inner(website)")
    .or(`scored_at.is.null,scored_at.lt.${staleCutoffIso}`)
    .not("donor_discovery_directory.website", "is", null)
    .order("created_at", { ascending: true })
    .limit(CLAIM_SCAN_LIMIT)
    .maybeSingle();

  if (error || !data) return null;

  return { type: SCORE_DONOR_PROSPECT_JOB_TYPE, prospectId: (data as { id: string }).id };
}

// ── Job handler ──────────────────────────────────────────────────────────────

/**
 * Runs one `score_donor_prospect` job: assembles a `RequestContext` from the
 * prospect's originating request (geography, taxonomy nodes) and
 * organization (mission statement), then delegates to `ScoringEngine.score`.
 *
 * `askSizeEstimate` is always `null` today — `donor_discovery_requests` has
 * no per-request ask-size field yet (architecture doc §8 Phase 5 may add
 * one). `ScoringEngine` already treats a null ask size as "the
 * company-size-match signal doesn't fire" rather than guessing, so this is
 * safe, not a stub.
 */
export async function handleScoreDonorProspectJob(
  supabase: SupabaseClient,
  job: ScoreDonorProspectJob,
): Promise<ScoreDonorProspectResult> {
  const requestContext = await buildRequestContext(supabase, job.prospectId);
  const engine = new ScoringEngine(supabase);
  const result = await engine.score(job.prospectId, requestContext);
  return { prospectId: job.prospectId, result };
}

async function buildRequestContext(
  supabase: SupabaseClient,
  prospectId: string,
): Promise<RequestContext> {
  const { data: prospectData, error: prospectError } = await supabase
    .from("donor_discovery_prospects")
    .select("id, organization_id, request_id")
    .eq("id", prospectId)
    .maybeSingle();

  if (prospectError || !prospectData) {
    throw new Error(`prospect_not_found: ${prospectError?.message ?? prospectId}`);
  }

  const prospect = prospectData as ProspectContextRow;

  const { data: requestData, error: requestError } = await supabase
    .from("donor_discovery_requests")
    .select("geography, taxonomy_ids")
    .eq("id", prospect.request_id)
    .maybeSingle();

  if (requestError || !requestData) {
    throw new Error(`request_not_found: ${requestError?.message ?? prospect.request_id}`);
  }

  const request = requestData as RequestGeographyRow;

  const { data: orgData } = await supabase
    .from("organizations")
    .select("mission_statement")
    .eq("id", prospect.organization_id)
    .maybeSingle();

  const orgMissionText = (orgData as OrganizationMissionRow | null)?.mission_statement ?? "";

  const taxonomyNodesRequested = await resolveTaxonomyLabels(supabase, request.taxonomy_ids ?? []);

  return {
    orgMissionText,
    askSizeEstimate: null,
    geography: request.geography,
    taxonomyNodesRequested,
  };
}

/** Resolves taxonomy node ids to their human-readable labels for the Claude prompt; falls back to the raw ids if the lookup fails. */
async function resolveTaxonomyLabels(supabase: SupabaseClient, taxonomyIds: string[]): Promise<string[]> {
  if (taxonomyIds.length === 0) return [];

  const { data, error } = await supabase
    .from("donor_discovery_taxonomy")
    .select("id, label")
    .in("id", taxonomyIds);

  if (error || !data) return taxonomyIds;

  const labelById = new Map((data as TaxonomyLabelRow[]).map((row) => [row.id, row.label]));
  return taxonomyIds.map((id) => labelById.get(id) ?? id);
}
