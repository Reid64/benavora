import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerate, type DdGeography } from '../src/lib/donor-discovery/adapters/google-places.js';
import { findOrCreateProspect } from '../src/lib/donor-discovery/directory.js';

/**
 * Donor Discovery request worker (DONOR_DISCOVERY_ARCHITECTURE.md §3, §8
 * Phase 1). Structurally mirrors worker/queue-processor.ts: a poll loop that
 * atomically claims one queued item, runs it, and records the outcome.
 *
 * Unlike QueueProcessor's dequeue() (a two-step select+conditional-update
 * stand-in — PostgREST can't express row locking over its query builder),
 * this worker claims through a real `FOR UPDATE SKIP LOCKED` Postgres
 * function (migration 070), so multiple worker instances can safely poll
 * the same `donor_discovery_requests` table concurrently.
 *
 * Phase 1 scope: enumeration only (Google Places adapter → shared directory →
 * org-scoped prospect rows). Enrichment (§2B) and scoring (§2D) are Phase 2 —
 * see `runEnrichmentAndScoringStub` below.
 */

// --- types -------------------------------------------------------------------

interface DdRequestRow {
  id: string;
  organization_id: string;
  name: string;
  taxonomy_ids: string[];
  geography: DdGeography;
  status: string;
  counts: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

interface TaxonomyRow {
  id: string;
  code: string;
  kind: string;
}

// --- constants ---------------------------------------------------------------

const POLL_INTERVAL_MS = 15_000;

// --- helpers -----------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Phase 2 seam (DONOR_DISCOVERY_ARCHITECTURE.md §2B enrichment, §2D scoring).
 * TODO(Phase 2): replace this stub with the Claude enrichment agent (§2B) and
 * the scoring engine (§2D) — driving status through 'enriching' → 'scoring'
 * before 'complete', and populating each prospect's score/score_rationale.
 * For Phase 1, every prospect created by enumeration is left at its default
 * pipeline_stage='new' / score=null, which is exactly the state Phase 2 will
 * pick them up from.
 */
async function runEnrichmentAndScoringStub(requestId: string): Promise<void> {
  console.log(
    `[DdRequestProcessor] Request ${requestId}: enrichment/scoring stubbed for Phase 1 ` +
      `(see DONOR_DISCOVERY_ARCHITECTURE.md §2B/§2D) — marking complete after enumeration.`,
  );
}

// --- DdRequestProcessor --------------------------------------------------------

export class DdRequestProcessor {
  private running = false;
  private processing = false;
  private readonly idleResolvers: Array<() => void> = [];

  constructor(private readonly supabase: SupabaseClient) {}

  /** Begin the poll loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[DdRequestProcessor] Starting');
    void this.loop();
  }

  /** Signal the loop to stop. Resolves immediately if idle. */
  stop(): void {
    this.running = false;
    if (!this.processing) this.resolveIdle();
  }

  /** Resolves when the current item finishes (or immediately if idle). */
  waitForIdle(): Promise<void> {
    if (!this.processing) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private resolveIdle(): void {
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.length = 0;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const item = await this.dequeue();

      if (item === null) {
        console.log('[DdRequestProcessor] Queue empty, sleeping 15s');
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      this.processing = true;

      try {
        await this.processItem(item);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[DdRequestProcessor] Request ${item.id} failed: ${message}`);
        await this.supabase
          .from('donor_discovery_requests')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            counts: { ...(item.counts ?? {}), error: message },
          })
          .eq('id', item.id);
      }

      this.processing = false;

      if (!this.running) break;
    }

    this.resolveIdle();
  }

  /**
   * Atomically claims the oldest queued request via the
   * `donor_discovery_claim_request` RPC (migration 070), which runs
   * `SELECT ... FOR UPDATE SKIP LOCKED` and flips status to 'enumerating' in
   * one transaction.
   */
  private async dequeue(): Promise<DdRequestRow | null> {
    const { data, error } = await this.supabase.rpc('donor_discovery_claim_request');

    if (error) {
      console.error('[DdRequestProcessor] Claim error:', error.message);
      return null;
    }

    return (data as DdRequestRow | null) ?? null;
  }

  private async processItem(item: DdRequestRow): Promise<void> {
    // --- Resolve taxonomy_ids -> NAICS codes (Phase 1: Google Places only) ---
    const { data: taxonomyRows, error: taxonomyError } = await this.supabase
      .from('donor_discovery_taxonomy')
      .select('id, code, kind')
      .in('id', item.taxonomy_ids);

    if (taxonomyError) {
      throw new Error(`taxonomy_lookup_failed: ${taxonomyError.message}`);
    }

    const rows = (taxonomyRows ?? []) as TaxonomyRow[];
    const naicsCodes = rows.filter((r) => r.kind === 'naics').map((r) => r.code);
    const nonNaicsCount = rows.length - naicsCodes.length;

    if (nonNaicsCount > 0) {
      console.warn(
        `[DdRequestProcessor] Request ${item.id}: ${nonNaicsCount} non-NAICS taxonomy ` +
          `node(s) skipped — civic/association enumeration adapters are Phase 4 ` +
          `(architecture doc §2A items 2-5).`,
      );
    }

    if (naicsCodes.length === 0) {
      throw new Error(
        'no_naics_taxonomy_nodes: request has no NAICS taxonomy nodes resolvable by the ' +
          'Google Places adapter (Phase 1)',
      );
    }

    // --- Enumerate via the Google Places registry adapter (§2A) ---
    const enumerateResult = await enumerate({
      naicsCodes,
      geography: item.geography,
    });

    // --- Create/reuse org-scoped prospect rows linked to the shared directory ---
    // findOrCreateProspect is idempotent per (organization_id, directory_id) —
    // a company this org has already seen (from an earlier request) reuses its
    // prospect row and just gains a request linkage, instead of a duplicate
    // (DONOR_DISCOVERY_ARCHITECTURE.md §3; src/lib/donor-discovery/directory.ts).
    const uniqueDirectoryIds = Array.from(new Set(enumerateResult.directoryIds));

    for (const directoryId of uniqueDirectoryIds) {
      await findOrCreateProspect(item.organization_id, item.id, directoryId);
    }

    const enumeratedCount = uniqueDirectoryIds.length;

    console.log(
      `[DdRequestProcessor] Request ${item.id}: enumerated ${enumeratedCount} prospect(s) ` +
        `via ${enumerateResult.requestsMade} Places request(s) (~$${enumerateResult.estCostUsd.toFixed(2)})`,
    );

    await this.supabase
      .from('donor_discovery_requests')
      .update({ counts: { enumerated: enumeratedCount, enriched: 0, scored: 0 } })
      .eq('id', item.id);

    // --- Phase 2 seam: enrichment (§2B) and scoring (§2D) ---
    await runEnrichmentAndScoringStub(item.id);

    await this.supabase
      .from('donor_discovery_requests')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', item.id);
  }
}

// --- Module-level wrappers (index.ts would call these) -----------------------

let _processor: DdRequestProcessor | null = null;

export function start(supabase: SupabaseClient): void {
  _processor = new DdRequestProcessor(supabase);
  _processor.start();
}

export function stop(): void {
  _processor?.stop();
}

export function waitForIdle(): Promise<void> {
  return _processor?.waitForIdle() ?? Promise.resolve();
}
