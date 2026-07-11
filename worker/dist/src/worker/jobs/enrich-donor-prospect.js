"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENRICH_DONOR_PROSPECT_JOB_TYPE = void 0;
exports.handleEnrichDonorProspectJob = handleEnrichDonorProspectJob;
exports.claimNextEnrichDonorProspectJob = claimNextEnrichDonorProspectJob;
const enrichment_agent_1 = require("../../lib/donor-discovery/agents/enrichment-agent");
const directory_1 = require("../../lib/donor-discovery/directory");
const scoring_1 = require("../../lib/donor-discovery/scoring");
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
exports.ENRICH_DONOR_PROSPECT_JOB_TYPE = "enrich_donor_prospect";
const ENRICHMENT_TTL_DAYS = 180;
const CLAIM_SCAN_LIMIT = 50;
// ── Job handler ──────────────────────────────────────────────────────────────
/**
 * Runs one `enrich_donor_prospect` job: re-enriches the directory record
 * (§2B) via `EnrichmentAgent.enrich`, then re-scores (§2D) every prospect
 * linked to it, using each prospect's originating request for geography
 * context — the same inputs `worker/dd-request-processor.ts`'s per-request
 * scoring stage uses, generalized here across every request/org that has
 * ever surfaced this directory record rather than one request's batch.
 */
async function handleEnrichDonorProspectJob(supabase, job) {
    const agent = new enrichment_agent_1.EnrichmentAgent(supabase);
    const enrichment = await agent.enrich(job.directoryId);
    const scoredProspectCount = await rescoreLinkedProspects(supabase, job.directoryId);
    return { directoryId: job.directoryId, enrichment, scoredProspectCount };
}
async function rescoreLinkedProspects(supabase, directoryId) {
    const { data: directoryRow, error: directoryError } = await supabase
        .from("donor_discovery_directory")
        .select("id, enrichment, hq_address, geo, linked_foundation_id, linkage_confidence")
        .eq("id", directoryId)
        .maybeSingle();
    if (directoryError || !directoryRow) {
        console.error(`[enrich-donor-prospect] Directory lookup failed for ${directoryId}: ${directoryError?.message ?? "not found"}`);
        return 0;
    }
    const directory = directoryRow;
    const { data: prospectRows, error: prospectsError } = await supabase
        .from("donor_discovery_prospects")
        .select("id, organization_id, request_id")
        .eq("directory_id", directoryId);
    if (prospectsError) {
        console.error(`[enrich-donor-prospect] Prospect lookup failed for ${directoryId}: ${prospectsError.message}`);
        return 0;
    }
    const prospects = (prospectRows ?? []);
    if (prospects.length === 0)
        return 0;
    const requestIds = Array.from(new Set(prospects.map((p) => p.request_id)));
    const { data: requestRows, error: requestsError } = await supabase
        .from("donor_discovery_requests")
        .select("id, geography")
        .in("id", requestIds);
    if (requestsError) {
        console.error(`[enrich-donor-prospect] Request geography lookup failed: ${requestsError.message}`);
        return 0;
    }
    const geographyByRequestId = new Map((requestRows ?? []).map((r) => [r.id, r.geography]));
    const organizationIds = Array.from(new Set(prospects.map((p) => p.organization_id)));
    const { data: orgRows, error: orgsError } = await supabase
        .from("organizations")
        .select("id, annual_budget, donor_discovery_scoring_weights")
        .in("id", organizationIds);
    if (orgsError) {
        console.error(`[enrich-donor-prospect] Organization lookup failed: ${orgsError.message}`);
        return 0;
    }
    const orgById = new Map((orgRows ?? []).map((o) => [o.id, o]));
    let givingCapacity = null;
    if (directory.linked_foundation_id) {
        const { data: foundationRow } = await supabase
            .from("foundation_directory")
            .select("id, giving_total, asset_amount")
            .eq("id", directory.linked_foundation_id)
            .maybeSingle();
        const foundation = foundationRow;
        givingCapacity = foundation?.giving_total ?? foundation?.asset_amount ?? null;
    }
    const directoryRecord = {
        enrichment: directory.enrichment,
        hq_address: directory.hq_address,
        geo: (0, directory_1.parseGeo)(directory.geo),
        linked_foundation_id: directory.linked_foundation_id,
        linkage_confidence: directory.linkage_confidence,
    };
    let scoredCount = 0;
    for (const prospect of prospects) {
        const geography = geographyByRequestId.get(prospect.request_id);
        if (!geography)
            continue;
        const org = orgById.get(prospect.organization_id);
        const weights = (0, scoring_1.parseScoringWeights)(org?.donor_discovery_scoring_weights ?? null);
        const { score, rationale } = (0, scoring_1.scoreProspect)(directoryRecord, {
            geography,
            organizationAnnualBudget: org?.annual_budget ?? null,
            linkedFoundationGivingCapacity: givingCapacity,
        }, weights);
        const { error: updateError } = await supabase
            .from("donor_discovery_prospects")
            .update({ score, score_rationale: rationale })
            .eq("id", prospect.id);
        if (updateError) {
            console.error(`[enrich-donor-prospect] Failed to update score for prospect ${prospect.id}: ${updateError.message}`);
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
async function claimNextEnrichDonorProspectJob(supabase) {
    const staleCutoffIso = new Date(Date.now() - ENRICHMENT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleRows, error: staleError } = await supabase
        .from("donor_discovery_directory")
        .select("id")
        .not("website", "is", null)
        .or(`enriched_at.is.null,enriched_at.lt.${staleCutoffIso}`)
        .order("created_at", { ascending: true })
        .limit(CLAIM_SCAN_LIMIT);
    if (staleError || !staleRows || staleRows.length === 0)
        return null;
    const candidateIds = staleRows.map((r) => r.id);
    const { data: prospectRows, error: prospectError } = await supabase
        .from("donor_discovery_prospects")
        .select("directory_id")
        .in("directory_id", candidateIds)
        .limit(1);
    if (prospectError || !prospectRows || prospectRows.length === 0)
        return null;
    const directoryId = prospectRows[0].directory_id;
    return { type: exports.ENRICH_DONOR_PROSPECT_JOB_TYPE, directoryId };
}
