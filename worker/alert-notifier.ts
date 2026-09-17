import type { SupabaseClient } from '@supabase/supabase-js';
import { redactSecrets } from '../src/lib/orchestration/orchestration-log.js';

/**
 * Alert notifier (AR-6.4 Part A).
 *
 * The spec's Edge Function is unnecessary here: `supabase/functions` does not
 * exist in this repo, and pg_net/pg_cron/http are not installed on this
 * project (verified 2026-09-17) -- SQL cannot reach Slack directly. The
 * Railway worker already runs continuously, so delivery lives here instead,
 * as one more poll loop alongside stuck-run-watchdog.ts (same start/stop/
 * waitForIdle shape).
 *
 * Polls public.alerts for severity='critical' rows with notified_at IS NULL
 * (added in migration 189, AR-6.1) and POSTs a compact, redacted message to
 * FORGE_SLACK_WEBHOOK -- the existing convention (forge-slack.ps1 reads the
 * same env var and no-ops when it is unset; this mirrors that rather than
 * provisioning a second webhook).
 *
 * Delivery idempotency: notified_at is set ONLY after a 2xx response. A
 * non-2xx response (or a thrown request) leaves it NULL so the next poll
 * retries; a successful post is never re-sent because the query itself
 * filters on notified_at IS NULL.
 */

const POLL_INTERVAL_MS = 60 * 1000;
const BATCH_SIZE = 20;

interface AlertRow {
  id: string;
  organization_id: string;
  type: string;
  severity: string;
  message: string;
  link: string | null;
  orchestration_id: string | null;
  created_at: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function formatSlackMessage(alert: AlertRow): string {
  const lines = [
    `*[${alert.severity.toUpperCase()}] ${alert.type}*`,
    redactSecrets(alert.message),
  ];
  if (alert.link) lines.push(redactSecrets(alert.link));
  const tags = [`org: ${alert.organization_id}`];
  if (alert.orchestration_id) tags.push(`orchestration: ${alert.orchestration_id}`);
  lines.push(tags.join(' · '));
  return lines.join('\n');
}

/**
 * Delivers one alert to Slack, setting notified_at only on a 2xx response.
 * Exported standalone (rather than only reachable via the interval loop
 * below) so tests can drive a single delivery attempt deterministically.
 */
export async function deliverAlert(
  supabase: SupabaseClient,
  webhookUrl: string,
  alert: AlertRow,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: formatSlackMessage(alert) }),
    });
  } catch (err) {
    console.error(
      `[AlertNotifier] Slack post for alert ${alert.id} threw — will retry next poll:`,
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  if (!response.ok) {
    console.error(
      `[AlertNotifier] Slack post for alert ${alert.id} failed with status ${response.status} — will retry next poll`,
    );
    return;
  }

  const { error: updateError } = await supabase
    .from('alerts')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', alert.id)
    .is('notified_at', null); // don't clobber if another process already marked it

  if (updateError) {
    console.error(
      `[AlertNotifier] Delivered alert ${alert.id} but failed to record notified_at (will re-send next poll):`,
      updateError.message,
    );
  } else {
    console.log(`[AlertNotifier] Delivered alert ${alert.id} (${alert.type}/${alert.severity})`);
  }
}

let warnedNoWebhookOnce = false;

export interface PollOnceOptions {
  // Scopes the query to one organization. Production call sites (the class
  // below, worker/index.ts) never pass this — the worker must service every
  // org's pending alerts in one batch. It exists purely so tests can poll
  // deterministically against a single throwaway org's data without
  // touching (or racing) real alerts belonging to every other org in the
  // same live database.
  organizationId?: string;
}

/**
 * Runs one poll pass: reads FORGE_SLACK_WEBHOOK, queries pending critical
 * alerts, and delivers each. Exported standalone for the same reason as
 * deliverAlert() above — the class below is a thin interval wrapper around
 * this function.
 */
export async function pollOnce(supabase: SupabaseClient, opts: PollOnceOptions = {}): Promise<void> {
  const webhookUrl = process.env['FORGE_SLACK_WEBHOOK'];
  if (!webhookUrl) {
    if (!warnedNoWebhookOnce) {
      console.log(
        '[AlertNotifier] FORGE_SLACK_WEBHOOK not set — no-op (logged once, will keep polling silently)',
      );
      warnedNoWebhookOnce = true;
    }
    return;
  }

  let query = supabase
    .from('alerts')
    .select('id, organization_id, type, severity, message, link, orchestration_id, created_at')
    .eq('severity', 'critical')
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (opts.organizationId) {
    query = query.eq('organization_id', opts.organizationId);
  }

  const { data: alerts, error } = await query;

  if (error) {
    console.error('[AlertNotifier] Failed to query pending alerts:', error.message);
    return;
  }
  if (!alerts || alerts.length === 0) return;

  for (const alert of alerts as AlertRow[]) {
    await deliverAlert(supabase, webhookUrl, alert);
  }
}

class AlertNotifier {
  private running = false;
  private polling = false;
  private readonly idleResolvers: Array<() => void> = [];

  constructor(private readonly supabase: SupabaseClient) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[AlertNotifier] Starting');
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (!this.polling) this.resolveIdle();
  }

  waitForIdle(): Promise<void> {
    if (!this.polling) return Promise.resolve();
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
      this.polling = true;
      try {
        await pollOnce(this.supabase);
      } catch (err) {
        console.error(
          '[AlertNotifier] Poll pass failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
      this.polling = false;
      if (!this.running) break;
      await sleep(POLL_INTERVAL_MS);
    }
    this.resolveIdle();
  }
}

let _notifier: AlertNotifier | null = null;

export function start(supabase: SupabaseClient): void {
  _notifier = new AlertNotifier(supabase);
  _notifier.start();
}

export function stop(): void {
  _notifier?.stop();
}

export function waitForIdle(): Promise<void> {
  return _notifier?.waitForIdle() ?? Promise.resolve();
}
