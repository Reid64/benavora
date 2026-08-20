import type { SupabaseClient } from '@supabase/supabase-js';

import { safeFetch, SsrfBlockedError } from '@/lib/security/safe-fetch';

// Supported event names for AutoApply webhook notifications.
export type WebhookEvent =
  | 'submission_completed'
  | 'submission_failed'
  | 'queue_populated'
  | 'review_needed'
  | 'agreement_received'
  | 'captcha_solve_failed';

interface WebhookConfigRow {
  id: string;
  type: string;
  webhook_url: string;
  events: string[];
}

function buildSlackPayload(
  event: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const lines: string[] = [];

  if (event === 'submission_completed') {
    const funderName = typeof data['funderName'] === 'string' ? data['funderName'] : 'Unknown funder';
    const confirmation = typeof data['confirmationNumber'] === 'string'
      ? ` (conf: ${data['confirmationNumber']})`
      : '';
    lines.push(`*AutoApply: Submission completed*`);
    lines.push(`Funder: ${funderName}${confirmation}`);
  } else if (event === 'submission_failed') {
    const funderName = typeof data['funderName'] === 'string' ? data['funderName'] : 'Unknown funder';
    const errMsg = typeof data['errorMessage'] === 'string' ? data['errorMessage'] : String(data['status'] ?? '');
    lines.push(`*AutoApply: Submission failed*`);
    lines.push(`Funder: ${funderName}`);
    lines.push(`Reason: ${errMsg}`);
  } else if (event === 'queue_populated') {
    const count = typeof data['count'] === 'number' ? data['count'] : 0;
    lines.push(`*AutoApply: Queue populated*`);
    lines.push(`${count} submission${count === 1 ? '' : 's'} added to queue`);
  } else if (event === 'review_needed') {
    const funderName = typeof data['funderName'] === 'string' ? data['funderName'] : 'Unknown funder';
    const failures = typeof data['failureCount'] === 'number' ? data['failureCount'] : 0;
    lines.push(`*AutoApply: Human review needed*`);
    lines.push(`Funder: ${funderName} — ${failures} consecutive failures`);
  } else if (event === 'agreement_received') {
    const funderName = typeof data['funderName'] === 'string' ? data['funderName'] : 'Unknown funder';
    lines.push(`*AutoApply: Agreement received*`);
    lines.push(`Funder: ${funderName}`);
  } else if (event === 'captcha_solve_failed') {
    const funderId = typeof data['funderId'] === 'string' ? data['funderId'] : 'unknown funder';
    const captchaType = typeof data['captchaType'] === 'string' ? data['captchaType'] : 'captcha';
    const pageUrl = typeof data['pageUrl'] === 'string' ? data['pageUrl'] : '';
    lines.push(`*AutoApply: CAPTCHA solve failed — human intervention may be needed*`);
    lines.push(`Funder: ${funderId} — ${captchaType}${pageUrl ? ` on ${pageUrl}` : ''}`);
  } else {
    lines.push(`*AutoApply: ${event}*`);
  }

  const text = lines.join('\n');

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ],
  };
}

function buildGenericPayload(
  event: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    event,
    timestamp: new Date().toISOString(),
    data,
  };
}

export class WebhookNotifier {
  async notify(params: {
    orgId: string;
    event: WebhookEvent;
    data: Record<string, unknown>;
    supabase: SupabaseClient;
  }): Promise<void> {
    const { orgId, event, data, supabase } = params;

    const { data: configs, error } = await supabase
      .from('webhook_configs')
      .select('id, type, webhook_url, events')
      .eq('organization_id', orgId)
      .eq('is_active', true);

    if (error) {
      console.warn('[WebhookNotifier] Failed to fetch configs:', error.message);
      return;
    }

    const matching = ((configs ?? []) as WebhookConfigRow[]).filter(
      (c) => Array.isArray(c.events) && c.events.includes(event),
    );

    if (matching.length === 0) return;

    await Promise.allSettled(
      matching.map(async (config) => {
        try {
          const payload =
            config.type === 'slack'
              ? buildSlackPayload(event, data)
              : buildGenericPayload(event, data);

          try {
            await safeFetch(config.webhook_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              timeoutMs: 5_000,
            });
          } catch (err) {
            if (err instanceof SsrfBlockedError) {
              console.warn(
                `[WebhookNotifier] Blocked SSRF-unsafe webhook_url for config ${config.id}: ${err.message}`,
              );
              return;
            }
            throw err;
          }
        } catch (err) {
          console.warn(
            `[WebhookNotifier] Failed to POST to ${config.webhook_url}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }),
    );
  }
}
