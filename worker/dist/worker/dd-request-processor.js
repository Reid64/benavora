"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DdRequestProcessor = void 0;
exports.start = start;
exports.stop = stop;
exports.waitForIdle = waitForIdle;
const google_places_js_1 = require("../src/lib/donor-discovery/adapters/google-places.js");
const directory_js_1 = require("../src/lib/donor-discovery/directory.js");
const web_extractor_js_1 = require("../src/lib/enrichment/web-extractor.js");
const foundation_linkage_js_1 = require("../src/lib/donor-discovery/foundation-linkage.js");
const scoring_js_1 = require("../src/lib/donor-discovery/scoring.js");
// --- constants ---------------------------------------------------------------
const POLL_INTERVAL_MS = 15_000;
const ENRICHMENT_CONCURRENCY = 5;
const ENRICHMENT_TTL_DAYS = 180; // matches donor_discovery_directory.enriched_at staleness (architecture §3)
// --- helpers -----------------------------------------------------------------
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once —
 * a fixed pool of workers pulling from a shared cursor, rather than a
 * semaphore, since callers here don't need per-call acquire/release.
 */
async function runWithConcurrency(items, concurrency, worker) {
    let nextIndex = 0;
    async function runWorker() {
        for (;;) {
            const index = nextIndex++;
            if (index >= items.length)
                return;
            await worker(items[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
}
/**
 * Enrichment jsonb merge — a fresh non-empty value always wins; a fresh
 * null/empty value only fills a gap, it never clobbers existing data.
 * Mirrors `scripts/enrich-foundations-web.ts`'s `mergeEnrichment`.
 */
function mergeEnrichment(existing, fresh) {
    const merged = { ...(existing ?? {}) };
    for (const [key, value] of Object.entries(fresh)) {
        const isEmpty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
        if (isEmpty && merged[key] !== undefined && merged[key] !== null)
            continue;
        merged[key] = value;
    }
    return merged;
}
// --- DdRequestProcessor --------------------------------------------------------
class DdRequestProcessor {
    supabase;
    running = false;
    processing = false;
    idleResolvers = [];
    constructor(supabase) {
        this.supabase = supabase;
    }
    /** Begin the poll loop. */
    start() {
        if (this.running)
            return;
        this.running = true;
        console.log('[DdRequestProcessor] Starting');
        void this.loop();
    }
    /** Signal the loop to stop. Resolves immediately if idle. */
    stop() {
        this.running = false;
        if (!this.processing)
            this.resolveIdle();
    }
    /** Resolves when the current item finishes (or immediately if idle). */
    waitForIdle() {
        if (!this.processing)
            return Promise.resolve();
        return new Promise((resolve) => {
            this.idleResolvers.push(resolve);
        });
    }
    resolveIdle() {
        for (const resolve of this.idleResolvers)
            resolve();
        this.idleResolvers.length = 0;
    }
    async loop() {
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
            }
            catch (err) {
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
            if (!this.running)
                break;
        }
        this.resolveIdle();
    }
    /**
     * Atomically claims the oldest queued request via the
     * `donor_discovery_claim_request` RPC (migration 070), which runs
     * `SELECT ... FOR UPDATE SKIP LOCKED` and flips status to 'enumerating' in
     * one transaction.
     */
    async dequeue() {
        const { data, error } = await this.supabase.rpc('donor_discovery_claim_request');
        if (error) {
            console.error('[DdRequestProcessor] Claim error:', error.message);
            return null;
        }
        return data ?? null;
    }
    /** Runs the full enumerate -> enrich -> link foundations -> score pipeline for one request. */
    async processItem(item) {
        // --- Resolve taxonomy_ids -> NAICS codes (Phase 1: Google Places only) ---
        const { data: taxonomyRows, error: taxonomyError } = await this.supabase
            .from('donor_discovery_taxonomy')
            .select('id, code, kind')
            .in('id', item.taxonomy_ids);
        if (taxonomyError) {
            throw new Error(`taxonomy_lookup_failed: ${taxonomyError.message}`);
        }
        const rows = (taxonomyRows ?? []);
        const naicsCodes = rows.filter((r) => r.kind === 'naics').map((r) => r.code);
        const nonNaicsCount = rows.length - naicsCodes.length;
        if (nonNaicsCount > 0) {
            console.warn(`[DdRequestProcessor] Request ${item.id}: ${nonNaicsCount} non-NAICS taxonomy ` +
                `node(s) skipped — civic/association enumeration adapters are Phase 4 ` +
                `(architecture doc §2A items 2-5).`);
        }
        if (naicsCodes.length === 0) {
            throw new Error('no_naics_taxonomy_nodes: request has no NAICS taxonomy nodes resolvable by the ' +
                'Google Places adapter (Phase 1)');
        }
        // --- Enumerate via the Google Places registry adapter (§2A) ---
        const enumerateResult = await (0, google_places_js_1.enumerate)({
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
            await (0, directory_js_1.findOrCreateProspect)(item.organization_id, item.id, directoryId);
        }
        const enumeratedCount = uniqueDirectoryIds.length;
        console.log(`[DdRequestProcessor] Request ${item.id}: enumerated ${enumeratedCount} prospect(s) ` +
            `via ${enumerateResult.requestsMade} Places request(s) (~$${enumerateResult.estCostUsd.toFixed(2)})`);
        await this.supabase
            .from('donor_discovery_requests')
            .update({ counts: { enumerated: enumeratedCount, enriched: 0, scored: 0 } })
            .eq('id', item.id);
        // --- §2B enrichment: web-extractor over linked directory records ---
        const { enrichedCount, errors: enrichmentErrors } = await this.runEnrichment(item, uniqueDirectoryIds);
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
    async runEnrichment(item, directoryIds) {
        if (directoryIds.length === 0) {
            return { enrichedCount: 0, errors: [] };
        }
        await this.supabase
            .from('donor_discovery_requests')
            .update({ status: 'enriching' })
            .eq('id', item.id);
        const staleCutoffIso = new Date(Date.now() - ENRICHMENT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data: candidateRows, error: candidatesError } = await this.supabase
            .from('donor_discovery_directory')
            .select('id, website, enrichment, enriched_at')
            .in('id', directoryIds)
            .not('website', 'is', null)
            .or(`enriched_at.is.null,enriched_at.lt.${staleCutoffIso}`);
        if (candidatesError) {
            throw new Error(`enrichment_candidate_lookup_failed: ${candidatesError.message}`);
        }
        const candidates = (candidateRows ?? []);
        console.log(`[DdRequestProcessor] Request ${item.id}: enriching ${candidates.length} of ` +
            `${directoryIds.length} linked directory record(s) (concurrency ${ENRICHMENT_CONCURRENCY})`);
        const errors = [];
        let enrichedCount = 0;
        await runWithConcurrency(candidates, ENRICHMENT_CONCURRENCY, async (row) => {
            try {
                const extraction = await (0, web_extractor_js_1.extractFromWebsite)(row.website, 'donor_prospect');
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
            }
            catch (err) {
                errors.push({
                    directory_id: row.id,
                    website: row.website,
                    error: err instanceof Error ? err.message : String(err),
                    at: new Date().toISOString(),
                });
            }
        });
        console.log(`[DdRequestProcessor] Request ${item.id}: enrichment complete — ${enrichedCount} enriched, ` +
            `${errors.length} failed`);
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
    async runFoundationLinkage(directoryIds) {
        if (directoryIds.length === 0)
            return { linkedCount: 0 };
        const { data: candidateRows, error: candidatesError } = await this.supabase
            .from('donor_discovery_directory')
            .select('id, legal_name, website')
            .in('id', directoryIds)
            .is('linked_foundation_id', null);
        if (candidatesError) {
            throw new Error(`foundation_linkage_candidate_lookup_failed: ${candidatesError.message}`);
        }
        const candidates = (candidateRows ?? []);
        console.log(`[DdRequestProcessor] Request-linked directory records: attempting foundation linkage for ` +
            `${candidates.length} of ${directoryIds.length} (concurrency ${ENRICHMENT_CONCURRENCY})`);
        let linkedCount = 0;
        await runWithConcurrency(candidates, ENRICHMENT_CONCURRENCY, async (row) => {
            try {
                const match = await (0, foundation_linkage_js_1.linkFoundationForDirectoryRecord)(row.id, {
                    legalName: row.legal_name,
                    website: row.website,
                });
                if (match)
                    linkedCount += 1;
            }
            catch (err) {
                console.warn(`[DdRequestProcessor] Foundation linkage failed for directory ${row.id}: ` +
                    `${err instanceof Error ? err.message : String(err)}`);
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
    async runScoring(item, directoryIds) {
        if (directoryIds.length === 0)
            return { scoredCount: 0 };
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
        const org = orgRow;
        const weights = (0, scoring_js_1.parseScoringWeights)(org?.donor_discovery_scoring_weights ?? null);
        const organizationAnnualBudget = org?.annual_budget ?? null;
        const { data: directoryRows, error: directoryError } = await this.supabase
            .from('donor_discovery_directory')
            .select('id, enrichment, hq_address, geo, linked_foundation_id, linkage_confidence')
            .in('id', directoryIds);
        if (directoryError) {
            throw new Error(`scoring_directory_lookup_failed: ${directoryError.message}`);
        }
        const rows = (directoryRows ?? []);
        const linkedFoundationIds = Array.from(new Set(rows.map((r) => r.linked_foundation_id).filter((id) => id !== null)));
        let givingCapacityByFoundationId = new Map();
        if (linkedFoundationIds.length > 0) {
            const { data: foundationRows, error: foundationError } = await this.supabase
                .from('foundation_directory')
                .select('id, giving_total, asset_amount')
                .in('id', linkedFoundationIds);
            if (foundationError) {
                throw new Error(`scoring_foundation_lookup_failed: ${foundationError.message}`);
            }
            givingCapacityByFoundationId = new Map((foundationRows ?? []).map((f) => [
                f.id,
                f.giving_total ?? f.asset_amount ?? null,
            ]));
        }
        let scoredCount = 0;
        for (const row of rows) {
            const directoryRecord = {
                enrichment: row.enrichment,
                hq_address: row.hq_address,
                geo: (0, directory_js_1.parseGeo)(row.geo),
                linked_foundation_id: row.linked_foundation_id,
                linkage_confidence: row.linkage_confidence,
            };
            const { score, rationale } = (0, scoring_js_1.scoreProspect)(directoryRecord, {
                geography: item.geography,
                organizationAnnualBudget,
                linkedFoundationGivingCapacity: row.linked_foundation_id
                    ? givingCapacityByFoundationId.get(row.linked_foundation_id) ?? null
                    : null,
            }, weights);
            const { error: updateError } = await this.supabase
                .from('donor_discovery_prospects')
                .update({ score, score_rationale: rationale })
                .eq('organization_id', item.organization_id)
                .eq('directory_id', row.id);
            if (updateError) {
                console.warn(`[DdRequestProcessor] Failed to write score for directory ${row.id}: ${updateError.message}`);
                continue;
            }
            scoredCount += 1;
        }
        console.log(`[DdRequestProcessor] Request ${item.id}: scored ${scoredCount} of ${rows.length} prospect(s)`);
        return { scoredCount };
    }
}
exports.DdRequestProcessor = DdRequestProcessor;
// --- Module-level wrappers (index.ts would call these) -----------------------
let _processor = null;
function start(supabase) {
    _processor = new DdRequestProcessor(supabase);
    _processor.start();
}
function stop() {
    _processor?.stop();
}
function waitForIdle() {
    return _processor?.waitForIdle() ?? Promise.resolve();
}
