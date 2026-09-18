import type { SupabaseClient } from '@supabase/supabase-js';

import { raiseOrchestrationAlert } from '../src/lib/alerts/raise-orchestration-alert.js';
import { dedupKeys } from '../src/lib/alerts/alerts-service.js';

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
 *
 * PIL sweep (AR-1.1, 2026-09-16): this watchdog swept only `agent_runs`.
 * `pil_agent_runs` (PROSPECT_INTELLIGENCE_ARCHITECTURE.md's separate agent
 * harness -- src/lib/pil/agent-runner.ts) has the identical
 * crash-before-completeRun failure mode and was never touched by any sweep:
 * live production data showed 6 rows stuck in status='running' forever
 * (BEN-SUP-01 x6, plus BEN-DIS-08, BEN-INT-03, BEN-INT-09, BEN-REL-03). Same
 * threshold, same select-then-guarded-update shape, same log prefix
 * convention, added below as a second sweep target rather than a separate
 * poll loop.
 *
 * automation_sessions sweep (AR-7.2, 2026-09-17): a third target, same
 * crash-before-finalize failure mode again, but with teeth this time -
 * submission-validator.ts's checkConcurrentAutomation() refuses to start a
 * new AutoApply run for an org+funder pair while ANY non-terminal
 * automation_sessions row exists for it, so one abandoned row blocks that
 * org+funder forever. Live production data (2026-09-17 audit) showed 7 rows
 * stuck this way, the oldest 99 days, and autoapply_queue_processor failing
 * 32/32 runs on `concurrent_automation_conflict` as a direct result. Unlike
 * agent_runs/pil_agent_runs, this table has a status that is a legitimate
 * long-lived human wait (`awaiting_approval` - session-manager.ts's
 * PAUSE-FOR-APPROVAL INVARIANT), so it cannot share the flat 30-minute
 * STUCK_TIMEOUT_MS; see AUTOMATION_SESSION_TIMEOUTS_MS below for the
 * per-status thresholds and the reasoning behind each one. Reaping also
 * raises a `manual_review_required` alert (AR-6.3) per reaped row, unlike
 * the two sweeps above - a session getting stuck here means AutoApply was
 * silently blocked for that org+funder, which is worth a human looking at,
 * not just a log line.
 */

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const STUCK_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * automation_sessions statuses that count as "stuck" if left untouched past
 * their threshold, and how long each gets. `submitted` / `failed` /
 * `cancelled` are terminal and never swept.
 *
 * - pending / in_progress / approved: technical mid-flight states with a
 *   real SLA - the browser-automation route caps a run at ~5 minutes
 *   (BEHAVIORAL_CONTRACTS §18, api/agents/automation/route.ts's maxDuration
 *   comment), and processItem()'s own pipeline drives pending -> approved ->
 *   submitted/failed within a single queue-item attempt (seconds, not
 *   minutes). 30 minutes - the same STUCK_TIMEOUT_MS already used for
 *   agent_runs/pil_agent_runs above - is 6x that ceiling, so nothing
 *   legitimate is ever still sitting in one of these three when the sweep
 *   runs; only a crashed or killed worker leaves a row here this long.
 * - awaiting_approval: different in kind, not degree. This state waits on a
 *   HUMAN, not code (PAUSE-FOR-APPROVAL INVARIANT, session-manager.ts) - a
 *   real reviewer may legitimately take days to get to it. Live data showed
 *   abandoned rows aged 9.8, 11.7, 13.1, and 99.0 days with zero human
 *   action; a short timeout here would reap a session someone is genuinely
 *   about to approve, destroying real pending work. 7 days is long enough
 *   that a human who intends to review has almost certainly already done
 *   so, while still eventually releasing the org+funder lock for a request
 *   nobody will ever act on.
 */
const AUTOMATION_SESSION_TIMEOUTS_MS: Record<string, number> = {
  pending: 30 * 60 * 1000,
  in_progress: 30 * 60 * 1000,
  approved: 30 * 60 * 1000,
  awaiting_approval: 7 * 24 * 60 * 60 * 1000,
};

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** e.g. "99.0d" for >= 1 day of age, else "45m". */
function formatAge(ms: number): string {
  const days = ms / (24 * 60 * 60 * 1000);
  if (days >= 1) return `${days.toFixed(1)}d`;
  return `${Math.round(ms / 60_000)}m`;
}

interface StuckRow {
  id: string;
  agent_type: string;
  started_at: string;
}

interface StuckPilRow {
  id: string;
  agent_id: string;
  started_at: string;
}

interface StuckAutomationSessionRow {
  id: string;
  organization_id: string;
  funder_id: string | null;
  updated_at: string;
}

/**
 * One sweep pass over automation_sessions, reaping anything stuck past its
 * per-status threshold (AUTOMATION_SESSION_TIMEOUTS_MS above). Exported as a
 * standalone function, not just a StuckRunWatchdog private method, so
 * integration tests can invoke a single deterministic pass directly against
 * real fixture rows instead of waiting on (or mocking) the 10-minute loop.
 */
export async function reapStaleAutomationSessions(supabase: SupabaseClient): Promise<void> {
  for (const [status, timeoutMs] of Object.entries(AUTOMATION_SESSION_TIMEOUTS_MS)) {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    const { data: stuck, error } = await supabase
      .from('automation_sessions')
      .select('id, organization_id, funder_id, updated_at')
      .eq('status', status)
      .lt('updated_at', cutoff);

    if (error) {
      console.error(
        `[StuckRunWatchdog] Failed to query stuck automation_sessions (${status}):`,
        error.message,
      );
      continue;
    }
    if (!stuck || stuck.length === 0) continue;

    for (const row of stuck as StuckAutomationSessionRow[]) {
      const ageMs = Date.now() - new Date(row.updated_at).getTime();
      const ageLabel = formatAge(ageMs);
      const reason =
        `Reaped by stuck-run watchdog: automation_sessions row stuck in '${status}' for ` +
        `${ageLabel} without advancing (threshold ${formatAge(timeoutMs)}).`;

      const { error: updateError } = await supabase
        .from('automation_sessions')
        .update({
          status: 'failed',
          error_message: reason,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', status); // don't clobber a session that advanced between select and update

      if (updateError) {
        console.error(
          `[StuckRunWatchdog] Failed to reap automation_sessions ${row.id} (${status}):`,
          updateError.message,
        );
        continue;
      }

      console.log(
        `[StuckRunWatchdog] Reaped stuck automation_sessions ${row.id} ` +
        `(org ${row.organization_id}, funder ${row.funder_id ?? 'none'}, was ${status} for ${ageLabel})`,
      );

      // AR-6.3: a session reaped for staleness means AutoApply was silently
      // blocked for this org+funder pair, possibly for days - that deserves
      // a human looking at it, not just a log line nobody reads.
      await raiseOrchestrationAlert(supabase, {
        organizationId: row.organization_id,
        orchestrationId: row.id,
        type: 'manual_review_required',
        severity: 'warning',
        message:
          `AutoApply automation session reaped after being stuck in '${status}' for ${ageLabel} - ` +
          `it was blocking further automation for this org+funder pair.`,
        dedupKey: dedupKeys.orchestrationManualReviewRequired(row.id),
      });
    }
  }
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

  private async sweepPilAgentRunsOnce(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_TIMEOUT_MS).toISOString();
    const { data: stuck, error } = await this.supabase
      .from('pil_agent_runs')
      .select('id, agent_id, started_at')
      .eq('status', 'running')
      .lt('started_at', cutoff);

    if (error) {
      console.error('[StuckRunWatchdog] Failed to query stuck pil_agent_runs:', error.message);
      return;
    }
    if (!stuck || stuck.length === 0) return;

    for (const row of stuck as StuckPilRow[]) {
      const ageMinutes = Math.round(
        (Date.now() - new Date(row.started_at).getTime()) / 60_000,
      );
      const { error: updateError } = await this.supabase
        .from('pil_agent_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: `Timeout: run left status='running' for ${ageMinutes}m without completing (swept by stuck-run watchdog, threshold ${STUCK_TIMEOUT_MS / 60_000}m).`,
        })
        .eq('id', row.id)
        .eq('status', 'running'); // don't clobber a run that completed between the select and this update

      if (updateError) {
        console.error(
          `[StuckRunWatchdog] Failed to sweep pil_agent_runs ${row.id} (${row.agent_id}):`,
          updateError.message,
        );
      } else {
        console.log(
          `[StuckRunWatchdog] Swept stuck pil_agent_runs ${row.id} (${row.agent_id}, running ${ageMinutes}m)`,
        );
      }
    }
  }

  private async sweepAutomationSessionsOnce(): Promise<void> {
    await reapStaleAutomationSessions(this.supabase);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      this.sweeping = true;
      try {
        await this.sweepOnce();
        await this.sweepPilAgentRunsOnce();
        await this.sweepAutomationSessionsOnce();
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
