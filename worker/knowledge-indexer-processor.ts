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
 * Cadence (spec): 60s sleep when a pass embeds nothing new; immediate
 * re-poll (no sleep) when a pass fills a full EMBEDDING_BATCH_SIZE batch,
 * since a full batch signals there is very likely more real work waiting
 * right behind it. A partial (nonzero but under-capacity) batch is treated
 * the same as an empty one — under-capacity means this pass drained
 * everything currently pending, so there's nothing more to gain from an
 * immediate re-poll either.
 */

const EMPTY_PASS_SLEEP_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

class KnowledgeIndexerProcessor {
  private running = false;
  private processing = false;
  private readonly idleResolvers: Array<() => void> = [];
  private readonly agent: KnowledgeIndexerAgent;

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
          console.log(
            `[KnowledgeIndexerProcessor] Pass complete — ${result.itemsProcessed}/${result.itemsFound} embedded` +
              (result.errors.length > 0 ? `, ${result.errors.length} error(s)` : ''),
          );
        }
      } catch (err) {
        console.error(
          '[KnowledgeIndexerProcessor] Pass failed:',
          err instanceof Error ? err.message : String(err),
        );
      }

      this.processing = false;
      if (!this.running) break;

      if (!batchWasFull) {
        await sleep(EMPTY_PASS_SLEEP_MS);
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
