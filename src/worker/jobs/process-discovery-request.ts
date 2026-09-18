import type { SupabaseClient } from "@supabase/supabase-js";

import { DdRequestProcessor, type DdRequestRow } from "../../../worker/dd-request-processor";
import { causeOf } from "@/lib/agents/base-agent";

/**
 * `process_discovery_request` job (DONOR_DISCOVERY_ARCHITECTURE.md §3).
 *
 * `worker/dd-request-processor.ts`'s `DdRequestProcessor` already implements
 * the full enumerate -> enrich -> link foundations -> score pipeline for a
 * `donor_discovery_requests` row, and its own poll loop (started from
 * `worker/index.ts`) claims queued requests via the
 * `donor_discovery_claim_request` RPC (migration 070, `FOR UPDATE SKIP
 * LOCKED`) — the sole running consumer of this table. This module exposes
 * that same pipeline under the `src/worker/jobs/*` job-payload shape used by
 * the sibling `enrich_donor_prospect` / `score_donor_prospect` jobs, without
 * duplicating its logic.
 */

export const PROCESS_DISCOVERY_REQUEST_JOB_TYPE = "process_discovery_request" as const;

export interface ProcessDiscoveryRequestJob {
  type: typeof PROCESS_DISCOVERY_REQUEST_JOB_TYPE;
  requestId: string;
  organizationId: string;
}

/** Runs one `process_discovery_request` job through the shared `DdRequestProcessor` pipeline. */
export async function handleProcessDiscoveryRequestJob(
  supabase: SupabaseClient,
  job: ProcessDiscoveryRequestJob,
): Promise<void> {
  const { data, error } = await supabase
    .from("donor_discovery_requests")
    .select("*")
    .eq("id", job.requestId)
    .eq("organization_id", job.organizationId)
    .maybeSingle();

  if (error) {
    console.error(
      `[handleProcessDiscoveryRequestJob] request lookup failed for requestId=${job.requestId}, org=${job.organizationId}: ${causeOf(error)}`,
    );
    throw new Error(`process_discovery_request_lookup_failed: ${causeOf(error)}`);
  }
  if (!data) {
    throw new Error(
      `process_discovery_request: request ${job.requestId} not found for org ${job.organizationId}`,
    );
  }

  await new DdRequestProcessor(supabase).processItem(data as DdRequestRow);
}
