import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Stuck-run watchdog (p5a-004, 2026-09-15).
 *
 * agent_runs rows can be left in status='running' forever if the process that
 * opened them (via startRun()/logRunStart()) crashes, is killed, or hangs
 * before ever reaching completeRun()/failRun() — nothing else in this
 * codebase revisits a run once it's no longer the active in-memory call, so a
 * genuinely-dead run stays 'running' indefinitely. Confirmed live: 6 rows
 * stuck this way at authoring time, the oldest since 2026-06-18 (89 days) —
 * `review` (stuck since 2026-08-23) and `recursive_learning` (since
 * 2026-09-11) were the 2 LEGACY_AGENT_STATUS.md named explicitly, but
 * `grant_summary`, `eligibility_scoring`, and `grants_gov_research` (x2) were
 * ALSO stuck and unnamed by that audit — this watchdog sweeps by status, not
 * by a fixed agent_type list, so it catches every case, not just the
 * previously-known ones.
 *
 * Implemented as a dedicated worker-boot poll loop (same shape as
 * worker/knowledge-indexer-processor.ts / worker/dd-request-processor.ts),
 * not folded into base-agent.ts/autonomous-base.ts: a per-agent-instance
 * check only ever runs when THAT agent type happens to execute again, so a
 * truly abandoned agent (e.g. one nobody schedules anymore) would never get
 * its stuck row swept. A standalone periodic sweep catches every agent type
 * uniformly regardless of whether anything else is running.
 *
 * Timeout: a flat 30 minutes for every agent type. Checked against live
 * completed-run durations before choosing this (2026-09-15): every agent
 * type with real history completes in under 2 minutes on average (grants_gov_research's
 * max was 72s), so 30 minutes is generously conservative, not tuned per-type.
 */

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const STUCK_TIMEOUT_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface StuckRow {
  id: string;
  agent_type: string;
  started_at: string;
}

class StuckRunWatchdog {
  private running = false;
  private sweeping = false;
  private readonly idleResolvers: Array<() => void> = [];

  constructor(private readonly supabase: SupabaseClient) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[StuckRunWatchdog] Starting');
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (!this.sweeping) this.resolveIdle();
  }

  waitForIdle(): Promise<void> {
    if (!this.sweeping) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private resolveIdle(): void {
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.length = 0;
  }

  private async sweepOnce(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MS).toISOString();
    const { data: stuck, error } = await this.supabase
      .from('agent_runs')
      .select('id, agent_type, started_at')
      .eq('status', 'running')
      .lt('started_at', cutoff);

    if (error) {
      console.error('[StuckRunWatchdog] Failed to query stuck runs:', error.message);
      return;
    }
    if (!stuck || stuck.length === 0) return;

    for (const row of stuck as StuckRow[]) {
      const ageMinutes = Math.round(
        (Date.now() - new Date(row.started_at).getTime()) / 60_000,
      );
      const { error: updateError } = await this.supabase
        .from('agent_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: `Timeout: run left status='running' for ${ageMinutes}m without completing (swept by stuck-run watchdog, threshold ${STUCK_TIMEOUT_MS / 60_000}m).`,
        })
        .eq('id', row.id)
        .eq('status', 'running'); // don't clobber a run that completed between the select and this update

      if (updateError) {
        console.error(
          `[StuckRunWatchdog] Failed to sweep run ${row.id} (${row.agent_type}):`,
          updateError.message,
        );
      } else {
        console.log(
          `[StuckRunWatchdog] Swept stuck run ${row.id} (${row.agent_type}, running ${ageMinutes}m)`,
        );
      }
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      this.sweeping = true;
      try {
        await this.sweepOnce();
      } catch (err) {
        console.error(
          '[StuckRunWatchdog] Sweep pass failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
      this.sweeping = false;
      if (!this.running) break;
      await sleep(SWEEP_INTERVAL_MS);
    }
    this.resolveIdle();
  }
}

let _watchdog: StuckRunWatchdog | null = null;

export function start(supabase: SupabaseClient): void {
  _watchdog = new StuckRunWatchdog(supabase);
  _watchdog.start();
}

export function stop(): void {
  _watchdog?.stop();
}

export function waitForIdle(): Promise<void> {
  return _watchdog?.waitForIdle() ?? Promise.resolve();
}
