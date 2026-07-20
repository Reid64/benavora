import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerate, type DdGeography } from '../src/lib/donor-discovery/adapters/google-places.js';
import { findOrCreateProspect, parseGeo } from '../src/lib/donor-discovery/directory.js';
import { extractFromWebsite } from '../src/lib/enrichment/web-extractor.js';
import { linkFoundationForDirectoryRecord } from '../src/lib/donor-discovery/foundation-linkage.js';
import {
  scoreProspect,
  parseScoringWeights,
  type ScoringDirectoryRecord,
} from '../src/lib/donor-discovery/scoring.js';
import type { Json } from '../src/types/database.js';

/**
 * Donor Discovery request worker (DONOR_DISCOVERY_ARCHITECTURE.md §3, §8
 * Phase 1/2). Structurally mirrors worker/queue-processor.ts: a poll loop that
 * atomically claims one queued item, runs it, and records the outcome.
 *
 * Unlike QueueProcessor's dequeue() (a two-step select+conditional-update
 * stand-in — PostgREST can't express row locking over its query builder),
 * this worker claims through a real `FOR UPDATE SKIP LOCKED` Postgres
 * function (migration 070), so multiple worker instances can safely poll
 * the same `donor_discovery_requests` table concurrently.
 *
 * Phase 1 scope: enumeration (Google Places adapter → shared directory →
 * org-scoped prospect rows). Phase 2 adds three further stages, all run
 * while the request sits in 'enriching'/'scoring' status:
 *   §2B enrichment  — each linked directory record with a website and no (or
 *     stale) enrichment is visited via the shared `web-extractor`
 *     (`donor_prospect` schema — same engine `scripts/enrich-foundations-web.ts`
 *     uses for foundations) and the result is merged into
 *     `donor_discovery_directory.enrichment`.
 *   §2C foundation linkage — every directory record not yet linked to a
 *     `foundation_directory` row is matched by name heuristic
 *     (foundation-linkage.ts), independent of whether it has a website.
 *   §2D scoring — every prospect surfaced by this request is scored
 *     deterministically (scoring.ts) against the org's (possibly
 *     overridden) weights, and `donor_discovery_prospects.score` /
 *     `score_rationale` are written before the request is marked complete.
 */

// --- types -------------------------------------------------------------------

export interface DdRequestRow {
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

interface DirectoryEnrichmentRow {
  id: string;
  website: string | null;
  enrichment: Record<string, unknown> | null;
  enriched_at: string | null;
}

interface DdEnrichmentErrorLogEntry {
  directory_id: string;
  website: string | null;
  error: string;
  at: string;
}

interface DdEnrichmentOutcome {
  enrichedCount: number;
  errors: DdEnrichmentErrorLogEntry[];
}

interface FoundationLinkageCandidateRow {
  id: string;
  legal_name: string;
  website: string | null;
}

interface ScoringDirectoryRow {
  id: string;
  enrichment: Record<string, unknown> | null;
  hq_address: string | null;
  geo: unknown;
  linked_foundation_id: string | null;
  linkage_confidence: number | null;
}

interface OrganizationScoringContextRow {
  annual_budget: number | null;
  donor_discovery_scoring_weights: Json | null;
}

interface FoundationGivingCapacityRow {
  id: string;
  giving_total: number | null;
  asset_amount: number | null;
}

// --- constants ---------------------------------------------------------------

const POLL_INTERVAL_MS = 15_000;
const FAILED_ITEM_BACKOFF_MS = 5_000;
const ENRICHMENT_CONCURRENCY = 5;
const ENRICHMENT_TTL_DAYS = 180; // matches donor_discovery_directory.enriched_at staleness (architecture §3)

// --- helpers -----------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once —
 * a fixed pool of workers pulling from a shared cursor, rather than a
 * semaphore, since callers here don't need per-call acquire/release.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
}

/**
 * Enrichment jsonb merge — a fresh non-empty value always wins; a fresh
 * null/empty value only fills a gap, it never clobbers existing data.
 * Mirrors `scripts/enrich-foundations-web.ts`'s `mergeEnrichment`.
 */
function mergeEnrichment(
  existing: Record<string, unknown> | null,
  fresh: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(fresh)) {
    const isEmpty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
    if (isEmpty && merged[key] !== undefined && merged[key] !== null) continue;
    merged[key] = value;
  }
  return merged;
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
      let failed = false;

      try {
        await this.processItem(item);
      } catch (err) {
        failed = true;
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

      // Backoff after a failed item — dequeue() re-claims immediately on the
      // next loop iteration with no gap otherwise, so a run of malformed
      // requests (or any other systematic failure) would hammer the RPC and
      // the org lookup with no delay between attempts.
      if (failed) {
        await sleep(FAILED_ITEM_BACKOFF_MS);
      }
    }

    this.resolveIdle();
  }

  /**
   * Atomically claims the oldest queued request via the
   * `donor_discovery_claim_request` RPC (migration 070), which runs
   * `SELECT ... FOR UPDATE SKIP LOCKED` and flips status to 'enumerating' in
   * one transaction.
   *
   * BUG FIX (2026-07-20): the RPC's SQL `return null;` on an empty result set
   * does not come back over PostgREST as JSON `null` — Postgres serializes a
   * NULL of a composite/row type as an object with every field null
   * (verified live: `{"id":null,"organization_id":null,"taxonomy_ids":null,...}`).
   * The previous `(data as DdRequestRow | null) ?? null` only catches actual
   * null/undefined, so that all-null object passed straight through as a
   * "real" claimed row. `loop()` then called `processItem()` on it: `.in('id',
   * item.taxonomy_ids)` with `taxonomy_ids: null` fails, the catch handler's
   * `.eq('id', item.id)` with `id: null` matches zero rows (SQL `= NULL` is
   * never true), so the request was never marked failed either — and with no
   * delay between a caught failure and the next dequeue(), this spun in a
   * tight loop re-claiming the same phantom null row. Checking `row?.id`
   * explicitly (not just object truthiness) closes this — the queue-is-empty
   * case now actually returns null and hits the normal 15s idle sleep.
   */
  private async dequeue(): Promise<DdRequestRow | null> {
    const { data, error } = await this.supabase.rpc('donor_discovery_claim_request');

    if (error) {
      console.error('[DdRequestProcessor] Claim error:', error.message);
      return null;
    }

    const row = data as DdRequestRow | null;
    if (!row || row.id === null || row.id === undefined) return null;
    return row;
  }

  /** Runs the full enumerate -> enrich -> link foundations -> score pipeline for one request. */
  async processItem(item: DdRequestRow): Promise<void> {
    // Fail fast on a malformed request (no real column named
    // `naics_taxonomy_nodes` exists on donor_discovery_requests — the real
    // column is `taxonomy_ids`, a uuid[] resolved to NAICS codes below) —
    // avoids an unnecessary donor_discovery_taxonomy round-trip when there's
    // nothing to look up.
    if (!item.taxonomy_ids || item.taxonomy_ids.length === 0) {
      throw new Error('malformed_request: taxonomy_ids is empty or missing');
    }

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

    // --- §2B enrichment: web-extractor over linked directory records ---
    const { enrichedCount, errors: enrichmentErrors } = await this.runEnrichment(
      item,
      uniqueDirectoryIds,
    );

    // --- §2C signal layer: corporate foundation linkage (same 'enriching' phase) ---
    const { linkedCount } = await this.runFoundationLinkage(uniqueDirectoryIds);

    await this.supabase
      .from('donor_discovery_requests')
      .update({
        counts: {
          enumerated: enumeratedCount,
          enriched: enrichedCount,
          linked: linkedCount,
          scored: 0,
          enrichment_errors: enrichmentErrors,
        },
      })
      .eq('id', item.id);

    // --- §2D scoring: deterministic score + rationale per prospect ---
    const { scoredCount } = await this.runScoring(item, uniqueDirectoryIds);

    await this.supabase
      .from('donor_discovery_requests')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        counts: {
          enumerated: enumeratedCount,
          enriched: enrichedCount,
          linked: linkedCount,
          scored: scoredCount,
          enrichment_errors: enrichmentErrors,
        },
      })
      .eq('id', item.id);
  }

  /**
   * §2B enrichment. For each `directoryIds` row with a website and no (or
   * stale, >180-day) enrichment, visits the site once via the shared
   * `web-extractor` (`donor_prospect` schema) at concurrency
   * `ENRICHMENT_CONCURRENCY` and merges the result into
   * `donor_discovery_directory.enrichment`. Per-site failures are recorded in
   * `errors` and never throw — one bad website must not fail the whole
   * request (architecture doc §2B/§8 Phase 2).
   */
  private async runEnrichment(
    item: DdRequestRow,
    directoryIds: string[],
  ): Promise<DdEnrichmentOutcome> {
    if (directoryIds.length === 0) {
      return { enrichedCount: 0, errors: [] };
    }

    await this.supabase
      .from('donor_discovery_requests')
      .update({ status: 'enriching' })
      .eq('id', item.id);

    const staleCutoffIso = new Date(
      Date.now() - ENRICHMENT_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: candidateRows, error: candidatesError } = await this.supabase
      .from('donor_discovery_directory')
      .select('id, website, enrichment, enriched_at')
      .in('id', directoryIds)
      .not('website', 'is', null)
      .or(`enriched_at.is.null,enriched_at.lt.${staleCutoffIso}`);

    if (candidatesError) {
      throw new Error(`enrichment_candidate_lookup_failed: ${candidatesError.message}`);
    }

    const candidates = (candidateRows ?? []) as DirectoryEnrichmentRow[];

    console.log(
      `[DdRequestProcessor] Request ${item.id}: enriching ${candidates.length} of ` +
        `${directoryIds.length} linked directory record(s) (concurrency ${ENRICHMENT_CONCURRENCY})`,
    );

    const errors: DdEnrichmentErrorLogEntry[] = [];
    let enrichedCount = 0;

    await runWithConcurrency(candidates, ENRICHMENT_CONCURRENCY, async (row) => {
      try {
        const extraction = await extractFromWebsite(row.website as string, 'donor_prospect');

        if (!extraction.ok || !extraction.data) {
          errors.push({
            directory_id: row.id,
            website: row.website,
            error: extraction.error ?? 'extraction returned no data',
            at: new Date().toISOString(),
          });
          return;
        }

        const nowIso = new Date().toISOString();
        const merged = mergeEnrichment(row.enrichment, {
          ...extraction.data,
          extracted_at: nowIso,
        });

        const { error: updateError } = await this.supabase
          .from('donor_discovery_directory')
          .update({ enrichment: merged, enriched_at: nowIso })
          .eq('id', row.id);

        if (updateError) {
          errors.push({
            directory_id: row.id,
            website: row.website,
            error: `directory_update_failed: ${updateError.message}`,
            at: nowIso,
          });
          return;
        }

        enrichedCount += 1;
      } catch (err) {
        errors.push({
          directory_id: row.id,
          website: row.website,
          error: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        });
      }
    });

    console.log(
      `[DdRequestProcessor] Request ${item.id}: enrichment complete — ${enrichedCount} enriched, ` +
        `${errors.length} failed`,
    );

    return { enrichedCount, errors };
  }

  /**
   * §2C signal layer: corporate foundation linkage. Runs over every
   * directory record this request surfaced that isn't already linked to a
   * `foundation_directory` row — unlike enrichment, this doesn't need a
   * website (name-heuristic matching only needs `legal_name`; a website, if
   * present, only boosts confidence — see foundation-linkage.ts). An
   * existing linkage is never re-attempted or overwritten. Per-record
   * failures are logged and never throw, matching runEnrichment's
   * one-bad-record-shouldn't-fail-the-request posture.
   */
  private async runFoundationLinkage(directoryIds: string[]): Promise<{ linkedCount: number }> {
    if (directoryIds.length === 0) return { linkedCount: 0 };

    const { data: candidateRows, error: candidatesError } = await this.supabase
      .from('donor_discovery_directory')
      .select('id, legal_name, website')
      .in('id', directoryIds)
      .is('linked_foundation_id', null);

    if (candidatesError) {
      throw new Error(`foundation_linkage_candidate_lookup_failed: ${candidatesError.message}`);
    }

    const candidates = (candidateRows ?? []) as FoundationLinkageCandidateRow[];

    console.log(
      `[DdRequestProcessor] Request-linked directory records: attempting foundation linkage for ` +
        `${candidates.length} of ${directoryIds.length} (concurrency ${ENRICHMENT_CONCURRENCY})`,
    );

    let linkedCount = 0;

    await runWithConcurrency(candidates, ENRICHMENT_CONCURRENCY, async (row) => {
      try {
        const match = await linkFoundationForDirectoryRecord(row.id, {
          legalName: row.legal_name,
          website: row.website,
        });
        if (match) linkedCount += 1;
      } catch (err) {
        console.warn(
          `[DdRequestProcessor] Foundation linkage failed for directory ${row.id}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    console.log(`[DdRequestProcessor] Foundation linkage complete — ${linkedCount} newly linked`);

    return { linkedCount };
  }

  /**
   * §2D scoring. Scores every prospect this request surfaced against the
   * requesting org's (possibly overridden) weights and writes
   * `donor_discovery_prospects.score` / `score_rationale`. `scoreProspect`
   * itself is pure (scoring.ts) — this method does all the fetching (the
   * directory record, the org's budget/weight overrides, and the linked
   * foundation's giving capacity, if any) and hands it plain data.
   */
  private async runScoring(
    item: DdRequestRow,
    directoryIds: string[],
  ): Promise<{ scoredCount: number }> {
    if (directoryIds.length === 0) return { scoredCount: 0 };

    await this.supabase
      .from('donor_discovery_requests')
      .update({ status: 'scoring' })
      .eq('id', item.id);

    const { data: orgRow, error: orgError } = await this.supabase
      .from('organizations')
      .select('annual_budget, donor_discovery_scoring_weights')
      .eq('id', item.organization_id)
      .maybeSingle();

    if (orgError) {
      throw new Error(`scoring_org_lookup_failed: ${orgError.message}`);
    }

    const org = orgRow as OrganizationScoringContextRow | null;
    const weights = parseScoringWeights(org?.donor_discovery_scoring_weights ?? null);
    const organizationAnnualBudget = org?.annual_budget ?? null;

    const { data: directoryRows, error: directoryError } = await this.supabase
      .from('donor_discovery_directory')
      .select('id, enrichment, hq_address, geo, linked_foundation_id, linkage_confidence')
      .in('id', directoryIds);

    if (directoryError) {
      throw new Error(`scoring_directory_lookup_failed: ${directoryError.message}`);
    }

    const rows = (directoryRows ?? []) as ScoringDirectoryRow[];

    const linkedFoundationIds = Array.from(
      new Set(rows.map((r) => r.linked_foundation_id).filter((id): id is string => id !== null)),
    );

    let givingCapacityByFoundationId = new Map<string, number | null>();
    if (linkedFoundationIds.length > 0) {
      const { data: foundationRows, error: foundationError } = await this.supabase
        .from('foundation_directory')
        .select('id, giving_total, asset_amount')
        .in('id', linkedFoundationIds);

      if (foundationError) {
        throw new Error(`scoring_foundation_lookup_failed: ${foundationError.message}`);
      }

      givingCapacityByFoundationId = new Map(
        (foundationRows as FoundationGivingCapacityRow[] | null ?? []).map((f) => [
          f.id,
          f.giving_total ?? f.asset_amount ?? null,
        ]),
      );
    }

    let scoredCount = 0;

    for (const row of rows) {
      const directoryRecord: ScoringDirectoryRecord = {
        enrichment: row.enrichment,
        hq_address: row.hq_address,
        geo: parseGeo(row.geo),
        linked_foundation_id: row.linked_foundation_id,
        linkage_confidence: row.linkage_confidence,
      };

      const { score, rationale } = scoreProspect(
        directoryRecord,
        {
          geography: item.geography,
          organizationAnnualBudget,
          linkedFoundationGivingCapacity: row.linked_foundation_id
            ? givingCapacityByFoundationId.get(row.linked_foundation_id) ?? null
            : null,
        },
        weights,
      );

      const { error: updateError } = await this.supabase
        .from('donor_discovery_prospects')
        .update({ score, score_rationale: rationale })
        .eq('organization_id', item.organization_id)
        .eq('directory_id', row.id);

      if (updateError) {
        console.warn(
          `[DdRequestProcessor] Failed to write score for directory ${row.id}: ${updateError.message}`,
        );
        continue;
      }

      scoredCount += 1;
    }

    console.log(`[DdRequestProcessor] Request ${item.id}: scored ${scoredCount} of ${rows.length} prospect(s)`);

    return { scoredCount };
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
