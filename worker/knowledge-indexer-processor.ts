import type { SupabaseClient } from '@supabase/supabase-js';
import { KnowledgeIndexerAgent } from '../src/lib/agents/knowledge-indexer-agent.js';

/**
 * Continuous poll loop for AG-29 Knowledge Engine Indexer Agent
 * (src/lib/agents/knowledge-indexer-agent.ts). Per its own spec's Trigger
 * design section, this is the one agent in this batch built for genuine 24/7
 * background operation rather than a periodic schedule — embedding
 * generation has no meaningful "batch window," so a new row with real text
 * content is embedded as soon as this loop next gets to it, not on a nightly
 * or weekly sweep.
 *
 * Structurally mirrors worker/dd-request-processor.ts's poll loop (claim ->
 * process -> sleep or re-poll), not a new pattern: same running/processing/
 * idleResolvers shape, same start()/stop()/waitForIdle() module-level
 * wrapper worker/index.ts already expects for queueProcessor and
 * ddRequestProcessor.
 *
 * Cadence: throttled re-poll (FULL_BATCH_THROTTLE_MS, not zero — see its own
 * doc comment) when a pass fills a full EMBEDDING_BATCH_SIZE batch, since a
 * full batch signals there is very likely more real work waiting right
 * behind it. A partial (nonzero but under-capacity) batch is treated the
 * same as an empty one — under-capacity means this pass drained everything
 * currently pending, so there's nothing more to gain from an immediate
 * re-poll either.
 *
 * AR-14.1: an empty pass sleeps, starting at EMPTY_PASS_SLEEP_MS and
 * doubling on each consecutive empty pass up to EMPTY_PASS_SLEEP_MAX_MS,
 * instead of a flat 60s forever. Before this session's producer fix
 * (knowledge-indexer-agent.ts's flattenFoundationText()), every one of this
 * agent's ~9,700 passes/week found nothing — a fixed 60s poll against a
 * source that, once its real backlog is drained, genuinely receives new
 * content only via the event-triggered path (enqueueKnowledgeIndexerTrigger,
 * routed through worker/autonomous-orchestrator.ts's 'event' case, not this
 * loop) is polling far faster than work actually arrives. The backoff
 * resets to the base interval the moment a pass finds any work at all
 * (result.itemsFound > 0), so a burst of new content — e.g. a fresh
 * enrichment run repopulating foundation_directory — is caught quickly
 * again rather than staying on a long-idle interval.
 */

const EMPTY_PASS_SLEEP_MS = 60_000;
const EMPTY_PASS_SLEEP_MAX_MS = 30 * 60_000;
/** AR-14.1 blast-radius mitigation (REMEDIATION_PLAN.md RC-1): the producer
 * fix makes up to 133,812 previously-unindexable foundation_directory rows
 * indexable in one pass. A full-batch pass previously re-polled with zero
 * delay; a real OpenAI embedding backlog that size drained with zero
 * inter-batch delay would fire ~1,338 back-to-back embedding-API calls as
 * fast as the network allows. This throttles consecutive full-batch passes
 * to one every few seconds — still orders of magnitude faster than the
 * former 60s-per-pass idle cadence, but not a single uncontrolled burst. */
const FULL_BATCH_THROTTLE_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

class KnowledgeIndexerProcessor {
  private running = false;
  private processing = false;
  private readonly idleResolvers: Array<() => void> = [];
  private readonly agent: KnowledgeIndexerAgent;
  /** Consecutive empty (itemsFound === 0) passes — drives the backoff sleep.
   * Reset to 0 by any pass that finds work. */
  private consecutiveEmptyPasses = 0;

  constructor(supabase: SupabaseClient) {
    this.agent = new KnowledgeIndexerAgent(supabase);
  }

  /** Begin the poll loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[KnowledgeIndexerProcessor] Starting');
    void this.loop();
  }

  /** Signal the loop to stop. Resolves immediately if idle. */
  stop(): void {
    this.running = false;
    if (!this.processing) this.resolveIdle();
  }

  /** Resolves when the current pass finishes (or immediately if idle). */
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
      this.processing = true;
      let batchWasFull = false;

      try {
        const result = await this.agent.run('autonomous');
        batchWasFull = result.batchWasFull;
        if (result.itemsFound > 0) {
          this.consecutiveEmptyPasses = 0;
          console.log(
            `[KnowledgeIndexerProcessor] Pass complete — ${result.itemsProcessed}/${result.itemsFound} embedded` +
              (result.errors.length > 0 ? `, ${result.errors.length} error(s)` : ''),
          );
        } else {
          this.consecutiveEmptyPasses++;
        }
      } catch (err) {
        console.error(
          '[KnowledgeIndexerProcessor] Pass failed:',
          err instanceof Error ? err.message : String(err),
        );
        this.consecutiveEmptyPasses++;
      }

      this.processing = false;
      if (!this.running) break;

      if (batchWasFull) {
        await sleep(FULL_BATCH_THROTTLE_MS);
      } else {
        const backoffSleepMs = Math.min(
          EMPTY_PASS_SLEEP_MS * 2 ** Math.max(0, this.consecutiveEmptyPasses - 1),
          EMPTY_PASS_SLEEP_MAX_MS,
        );
        await sleep(backoffSleepMs);
      }
    }

    this.resolveIdle();
  }
}

// --- Module-level wrappers (worker/index.ts calls these) ---------------------

let _processor: KnowledgeIndexerProcessor | null = null;

export function start(supabase: SupabaseClient): void {
  _processor = new KnowledgeIndexerProcessor(supabase);
  _processor.start();
}

export function stop(): void {
  _processor?.stop();
}

export function waitForIdle(): Promise<void> {
  return _processor?.waitForIdle() ?? Promise.resolve();
}
