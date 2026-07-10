import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptKey } from "@/lib/crypto/key-encrypt";
import { parseGeo, type DirectoryRecord } from "@/lib/donor-discovery/directory";
import { apolloConnector } from "@/lib/donor-discovery/connectors/apollo-connector";
import { hunterConnector } from "@/lib/donor-discovery/connectors/hunter-connector";
import { logConnectorUsage } from "@/lib/donor-discovery/connectors/usage-log";
import type {
  ConnectorEnricher,
  ConnectorEnrichment,
} from "@/lib/donor-discovery/connectors/types";

/**
 * `run_connector_enrichment` worker job (DONOR_DISCOVERY_ARCHITECTURE.md
 * §6). Given a `donor_discovery_prospects` row and a connectable provider
 * ("apollo" | "hunter"), decrypts the owning organization's stored BYO-key
 * (`donor_discovery_connectors`), calls that provider's `ConnectorEnricher`
 * against the prospect's shared directory record, and merges the result
 * into `donor_discovery_prospects.enrichment_private` (migration 079) —
 * tenant-scoped, never written to the shared `donor_discovery_directory`
 * row, per §6's "contractually theirs, never shared cross-tenant."
 *
 * Same claim/handle shape as `enrich-donor-prospect.ts`/
 * `score-donor-prospect.ts` so it slots into `worker/queue-processor.ts`'s
 * idle cycle the same way.
 */

export const RUN_CONNECTOR_ENRICHMENT_JOB_TYPE = "run_connector_enrichment" as const;

const CONNECTORS: Record<"apollo" | "hunter", ConnectorEnricher> = {
  apollo: apolloConnector,
  hunter: hunterConnector,
};

type RunnableConnectorProvider = keyof typeof CONNECTORS;

function isRunnableConnectorProvider(value: string): value is RunnableConnectorProvider {
  return value === "apollo" || value === "hunter";
}

const CONNECTOR_SCAN_LIMIT = 20;

export interface RunConnectorEnrichmentJob {
  type: typeof RUN_CONNECTOR_ENRICHMENT_JOB_TYPE;
  prospectId: string;
  connectorProvider: RunnableConnectorProvider;
}

export interface RunConnectorEnrichmentResult {
  prospectId: string;
  connectorProvider: RunnableConnectorProvider;
  enrichment: ConnectorEnrichment;
}

interface ProspectRow {
  id: string;
  organization_id: string;
  directory_id: string;
  enrichment_private: Record<string, unknown> | null;
}

interface DirectoryRow {
  id: string;
  legal_name: string;
  dba_name: string | null;
  naics_codes: string[] | null;
  civic_kind: string | null;
  website: string | null;
  hq_address: string | null;
  geo: unknown;
  phone: string | null;
  enrichment: Record<string, unknown> | null;
  enriched_at: string | null;
  source_adapters: string[] | null;
  created_at: string;
}

interface ActiveConnectorRow {
  organization_id: string;
  provider: string;
  encrypted_api_key: string;
}

// ── Job handler ──────────────────────────────────────────────────────────────

/**
 * Runs one `run_connector_enrichment` job end to end: load the prospect and
 * its shared directory record, resolve + decrypt the org's active key for
 * the requested provider, call the connector, merge the result into
 * `enrichment_private` (existing provider keys other than this one are kept
 * — a Hunter run never erases a prior Apollo result), and log usage to
 * `adapter_usage_log` so the connectors page's existing telemetry
 * aggregation picks it up with no route change.
 */
export async function handleRunConnectorEnrichmentJob(
  supabase: SupabaseClient,
  job: RunConnectorEnrichmentJob,
): Promise<RunConnectorEnrichmentResult> {
  const prospect = await loadProspect(supabase, job.prospectId);
  const directoryRecord = await loadDirectoryRecord(supabase, prospect.directory_id);
  const apiKey = await resolveActiveApiKey(supabase, prospect.organization_id, job.connectorProvider);

  const connector = CONNECTORS[job.connectorProvider];
  const enrichment = await connector.enrich(directoryRecord, apiKey);

  await saveEnrichmentPrivate(supabase, prospect, job.connectorProvider, enrichment);

  await logConnectorUsage({
    organizationId: prospect.organization_id,
    adapterName: job.connectorProvider,
    recordsReturned: enrichment.contacts.length,
  });

  return { prospectId: job.prospectId, connectorProvider: job.connectorProvider, enrichment };
}

async function loadProspect(supabase: SupabaseClient, prospectId: string): Promise<ProspectRow> {
  const { data, error } = await supabase
    .from("donor_discovery_prospects")
    .select("id, organization_id, directory_id, enrichment_private")
    .eq("id", prospectId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`prospect_not_found: ${error?.message ?? prospectId}`);
  }

  return data as ProspectRow;
}

async function loadDirectoryRecord(supabase: SupabaseClient, directoryId: string): Promise<DirectoryRecord> {
  const { data, error } = await supabase
    .from("donor_discovery_directory")
    .select(
      "id, legal_name, dba_name, naics_codes, civic_kind, website, hq_address, geo, phone, enrichment, enriched_at, source_adapters, created_at",
    )
    .eq("id", directoryId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`directory_not_found: ${error?.message ?? directoryId}`);
  }

  const row = data as DirectoryRow;

  return {
    id: row.id,
    legal_name: row.legal_name,
    dba_name: row.dba_name,
    naics_codes: row.naics_codes ?? [],
    civic_kind: row.civic_kind,
    website: row.website,
    hq_address: row.hq_address,
    geo: parseGeo(row.geo),
    phone: row.phone,
    enrichment: row.enrichment ?? {},
    enriched_at: row.enriched_at,
    source_adapters: row.source_adapters ?? [],
    created_at: row.created_at,
  };
}

/**
 * Resolves and decrypts the org's active connector key for `provider`.
 * Throws rather than silently skipping — unlike the registry adapters'
 * "no key configured -> skip" posture (§18/§19), this job is only ever
 * claimed for an org that was already confirmed to have an active
 * connector (see `claimNextRunConnectorEnrichmentJob` below), so a missing
 * key here means the connector was disconnected between claim and handle —
 * a genuine failure worth surfacing, not a routine no-op.
 */
async function resolveActiveApiKey(
  supabase: SupabaseClient,
  organizationId: string,
  provider: RunnableConnectorProvider,
): Promise<string> {
  const { data, error } = await supabase
    .from("donor_discovery_connectors")
    .select("encrypted_api_key, status")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();

  const row = data as { encrypted_api_key: string; status: string } | null;
  if (error || !row || row.status !== "active") {
    throw new Error(
      `connector_not_active: organization ${organizationId} has no active ${provider} connector.`,
    );
  }

  return decryptKey(row.encrypted_api_key);
}

async function saveEnrichmentPrivate(
  supabase: SupabaseClient,
  prospect: ProspectRow,
  provider: RunnableConnectorProvider,
  enrichment: ConnectorEnrichment,
): Promise<void> {
  const merged = { ...(prospect.enrichment_private ?? {}), [provider]: enrichment };

  const { error } = await supabase
    .from("donor_discovery_prospects")
    .update({ enrichment_private: merged })
    .eq("id", prospect.id);

  if (error) {
    throw new Error(`enrichment_private_save_failed: ${error.message}`);
  }
}

// ── Dequeue ──────────────────────────────────────────────────────────────────

/**
 * Best-effort claim of the next `run_connector_enrichment` job: scans the
 * oldest `CONNECTOR_SCAN_LIMIT` active Apollo/Hunter connectors across all
 * orgs, and for the first one, finds that org's oldest prospect never
 * enriched by that provider (`enrichment_private->>provider IS NULL`).
 * `donor_discovery_connectors`/`donor_discovery_prospects` carry no
 * dedicated job-queue status column for this — same plain-scan posture as
 * `claimNextEnrichDonorProspectJob`/`claimNextScoreDonorProspectJob`; two
 * workers racing on the same (prospect, provider) pair just means one
 * wasted enrichment call, never corrupted data (the second write overwrites
 * the first with an equivalent result).
 */
export async function claimNextRunConnectorEnrichmentJob(
  supabase: SupabaseClient,
): Promise<RunConnectorEnrichmentJob | null> {
  const { data: connectorRows, error: connectorError } = await supabase
    .from("donor_discovery_connectors")
    .select("organization_id, provider, encrypted_api_key")
    .eq("status", "active")
    .in("provider", ["apollo", "hunter"])
    .order("activated_at", { ascending: true })
    .limit(CONNECTOR_SCAN_LIMIT);

  if (connectorError || !connectorRows || connectorRows.length === 0) return null;

  for (const row of connectorRows as ActiveConnectorRow[]) {
    if (!isRunnableConnectorProvider(row.provider)) continue;

    const { data: prospectRows, error: prospectError } = await supabase
      .from("donor_discovery_prospects")
      .select("id")
      .eq("organization_id", row.organization_id)
      .is(`enrichment_private->>${row.provider}`, null)
      .order("created_at", { ascending: true })
      .limit(1);

    if (prospectError || !prospectRows || prospectRows.length === 0) continue;

    const prospectId = (prospectRows[0] as { id: string }).id;
    return {
      type: RUN_CONNECTOR_ENRICHMENT_JOB_TYPE,
      prospectId,
      connectorProvider: row.provider,
    };
  }

  return null;
}
