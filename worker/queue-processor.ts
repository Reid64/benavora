import type { SupabaseClient } from '@supabase/supabase-js';
import { StealthBrowser } from '../src/lib/autoapply/stealth-browser.js';
import { FormAnalyzerAgent } from '../src/lib/autoapply/form-analyzer-agent.js';
import { FormFillerAgent } from '../src/lib/autoapply/form-filler-agent.js';
import * as heartbeat from './heartbeat.js';
import { RateLimiter } from './rate-limiter.js';

// --- types -------------------------------------------------------------------

interface QueueItem {
  id: string;
  organization_id: string;
  funder_id: string | null;
  status: string;
  automation_mode: string;
  scheduled_for: string | null;
  created_at: string;
}

interface FunderRow {
  id: string;
  name: string | null;
  giving_portal_url: string | null;
}

interface FormTemplateRow {
  id: string;
  funder_id: string | null;
  last_verified_at: string | null;
  [key: string]: unknown;
}

// --- constants ---------------------------------------------------------------

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SLEEP_MS = 15_000;
const SCREENSHOT_BUCKET = 'autoapply-screenshots';

// --- helpers -----------------------------------------------------------------

class SkipError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SkipError';
  }
}

function classifyError(message: string): string {
  const lower = message.toLowerCase();
  if (/captcha|recaptcha|hcaptcha/.test(lower)) return 'captcha_blocked';
  if (/login|sign\s+in|account/.test(lower)) return 'account_required';
  if (/timeout|etimedout/.test(lower)) return 'timeout';
  if (/\b404\b|\b403\b|\b500\b/.test(lower)) return 'site_error';
  return 'failed';
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function uploadScreenshot(
  supabase: SupabaseClient,
  buffer: Buffer,
  path: string,
): Promise<string | null> {
  const { error: uploadError } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, buffer, { contentType: 'image/png', upsert: true });

  if (uploadError) {
    console.error(`[QueueProcessor] Screenshot upload failed (${path}):`, uploadError.message);
    return null;
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .createSignedUrl(path, 365 * 24 * 60 * 60); // 1-year signed URL for audit trail

  if (signError || signedData === null) {
    console.error(`[QueueProcessor] Signed URL failed (${path}):`, signError?.message ?? 'null data');
    return null;
  }

  return signedData.signedUrl;
}

// --- QueueProcessor ----------------------------------------------------------

export class QueueProcessor {
  private running = false;
  private processing = false;
  private readonly idleResolvers: Array<() => void> = [];
  private readonly rateLimiter = new RateLimiter();

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly workerId: string,
  ) {}

  /** Begin the poll loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[QueueProcessor] Starting — worker=${this.workerId}`);
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
        console.log('[QueueProcessor] Queue empty, sleeping 15s');
        await sleep(SLEEP_MS);
        continue;
      }

      this.processing = true;
      await heartbeat.setProcessing(item.id);

      try {
        await this.processItem(item);
        await this.supabase
          .from('submission_queue')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', item.id);
        await heartbeat.incrementProcessed();
      } catch (err) {
        if (err instanceof SkipError) {
          console.log(`[QueueProcessor] Item ${item.id} skipped: ${err.message}`);
          await this.supabase
            .from('submission_queue')
            .update({ status: 'skipped', completed_at: new Date().toISOString() })
            .eq('id', item.id);
          await heartbeat.incrementProcessed();
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[QueueProcessor] Item ${item.id} failed: ${msg}`);
          await this.supabase
            .from('submission_queue')
            .update({ status: 'failed', completed_at: new Date().toISOString() })
            .eq('id', item.id);
          await heartbeat.incrementFailed();
        }
      }

      this.processing = false;
      await heartbeat.setProcessing(null);

      if (!this.running) break;

      await this.rateLimiter.waitBetweenSubmissions();
    }

    this.resolveIdle();
  }

  /**
   * Atomically claim the next pending item using a two-step SELECT → UPDATE.
   * When a dedicated RPC with FOR UPDATE SKIP LOCKED is added, replace this.
   */
  private async dequeue(): Promise<QueueItem | null> {
    const now = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('submission_queue')
      .select('*')
      .eq('status', 'pending')
      .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[QueueProcessor] Poll error:', error.message);
      return null;
    }
    if (data === null) return null;

    const item = data as QueueItem;

    // Claim: only succeeds if status is still 'pending' (guards against race).
    const { data: claimed, error: claimError } = await this.supabase
      .from('submission_queue')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (claimError) {
      console.error('[QueueProcessor] Claim error:', claimError.message);
      return null;
    }

    // Another worker claimed it between our SELECT and UPDATE.
    if (claimed === null) return null;

    return item;
  }

  private async processItem(item: QueueItem): Promise<void> {
    const { funder_id: funderId, organization_id: orgId, id: queueItemId } = item;

    if (funderId === null) throw new SkipError('no_funder_id');

    // Fetch funder record
    const { data: funderData, error: funderError } = await this.supabase
      .from('funders')
      .select('id, name, giving_portal_url')
      .eq('id', funderId)
      .maybeSingle();

    if (funderError) throw new SkipError(`funder_fetch_error: ${funderError.message}`);
    if (funderData === null) throw new SkipError('funder_not_found');

    const funder = funderData as FunderRow;
    const portalUrl = funder.giving_portal_url;
    if (!portalUrl) throw new SkipError('no_portal_url');
    const funderName = funder.name ?? funderId;

    // Per-domain throttle: minimum 24 hours between submissions to the same funder
    const canSubmit = await this.rateLimiter.canSubmitToDomain(funderId);
    if (!canSubmit) throw new SkipError('domain_throttled');

    // Check for existing form template; re-analyze if stale (> 7 days old)
    const { data: templateData } = await this.supabase
      .from('form_templates')
      .select('*')
      .eq('funder_id', funderId)
      .order('last_verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingTemplate = templateData as FormTemplateRow | null;
    const needsReanalysis =
      existingTemplate === null ||
      existingTemplate.last_verified_at === null ||
      Date.now() - new Date(existingTemplate.last_verified_at).getTime() > SEVEN_DAYS_MS;

    // Snapshot existing field count for change-detection during stale-template refresh
    const existingFieldCount: number | null = existingTemplate !== null
      ? (existingTemplate['field_count'] as number | null | undefined) ?? null
      : null;
    const isStaleRefresh = existingTemplate !== null && needsReanalysis;

    const stealthBrowser = new StealthBrowser({ headless: true });
    const { browser, page } = await stealthBrowser.launch();

    let preSubmitUrl: string | null = null;
    let confirmationUrl: string | null = null;
    let errorUrl: string | null = null;
    let submissionStatus = 'failed';
    let confirmationNumber: string | null = null;
    let requestDescription: string | null = null;
    let errorMessage: string | null = null;
    let formTemplateId: string | null = existingTemplate?.id ?? null;

    try {
      // Analyze the form if no cached template or template is stale
      if (needsReanalysis) {
        let analyzeResult: { id: string; fieldCount: number };
        try {
          const analyzer = new FormAnalyzerAgent(this.supabase);
          analyzeResult = await analyzer.analyzeAndStore({ page, portalUrl, funderId, organizationId: orgId });
        } catch (analyzerErr) {
          const analyzerMsg = analyzerErr instanceof Error ? analyzerErr.message : String(analyzerErr);
          console.warn(`[QueueProcessor] FormAnalyzerAgent failed for funder ${funderName}: ${analyzerMsg}`);
          // Mark portal as needing human review; ignore update errors (column may not exist yet)
          await this.supabase
            .from('funders')
            .update({ portal_review_status: 'needs_review' })
            .eq('id', funderId);
          throw new SkipError(`analyzer_failed: ${analyzerMsg}`);
        }

        formTemplateId = analyzeResult.id;

        // Persist auto-generated metadata on the stored template
        await this.supabase
          .from('form_templates')
          .update({
            auto_generated: true,
            field_count: analyzeResult.fieldCount,
            last_verified_at: new Date().toISOString(),
          })
          .eq('id', analyzeResult.id);

        // Warn if form structure changed during a stale-template refresh
        if (isStaleRefresh && existingFieldCount !== null && analyzeResult.fieldCount !== existingFieldCount) {
          console.warn(
            `[QueueProcessor] Form structure changed for ${funderName}: ` +
            `was ${existingFieldCount} fields, now ${analyzeResult.fieldCount} fields`,
          );
        }
      }

      // Load current template (just stored or previously cached)
      const { data: templateRow, error: templateError } = await this.supabase
        .from('form_templates')
        .select('*')
        .eq('id', formTemplateId)
        .maybeSingle();

      if (templateError || templateRow === null) {
        throw new Error('form_template unavailable after analysis');
      }

      const template = templateRow as Record<string, unknown>;

      // Pre-submit screenshot: page is on the portal after FormAnalyzerAgent ran
      const preBuffer = await page.screenshot({ fullPage: false });
      const prePath = `${orgId}/${funderId}/${Date.now()}_pre_submit.png`;
      preSubmitUrl = await uploadScreenshot(this.supabase, preBuffer, prePath);

      // Fill and submit the form
      const filler = new FormFillerAgent(this.supabase, stealthBrowser);
      const fillResult = await filler.fillAndSubmit({ page, template, organizationId: orgId, funderId });

      confirmationNumber = fillResult.confirmationNumber;
      requestDescription = fillResult.requestDescription;
      submissionStatus = 'submitted';

      // Confirmation screenshot: use agent-captured buffer if available, else take one now
      const confirmPath = `${orgId}/${funderId}/${Date.now()}_confirmation.png`;
      const confirmBuffer = fillResult.confirmationScreenshot ?? await page.screenshot({ fullPage: false });
      confirmationUrl = await uploadScreenshot(this.supabase, confirmBuffer, confirmPath);

    } catch (err) {
      // Re-throw SkipErrors so the loop handles them as skips, not failures
      if (err instanceof SkipError) throw err;

      const message = err instanceof Error ? err.message : String(err);
      errorMessage = message;
      submissionStatus = classifyError(message);

      // Best-effort error screenshot while browser may still be open
      try {
        const errBuffer = await page.screenshot({ fullPage: false });
        const errPath = `${orgId}/${funderId}/${Date.now()}_error.png`;
        errorUrl = await uploadScreenshot(this.supabase, errBuffer, errPath);
      } catch {
        // Browser already closed — skip error screenshot
      }
    } finally {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }

    // Persist full submission audit record
    const { data: submission, error: submissionError } = await this.supabase
      .from('autoapply_submissions')
      .insert({
        organization_id: orgId,
        funder_id: funderId,
        form_template_id: formTemplateId,
        status: submissionStatus,
        request_description: requestDescription,
        pre_submit_screenshot_url: preSubmitUrl,
        confirmation_screenshot_url: confirmationUrl,
        confirmation_number: confirmationNumber,
        error_message: errorMessage,
        error_screenshot_url: errorUrl,
        retry_count: 0,
        submitted_at: submissionStatus === 'submitted' ? new Date().toISOString() : null,
      })
      .select('id')
      .single();

    if (submissionError) {
      console.error(
        `[QueueProcessor] Failed to create submission record for queue item ${queueItemId}:`,
        submissionError.message,
      );
    }

    // Link submission_id back to the queue item for dashboard correlation
    if (submission !== null) {
      const submissionRow = submission as { id: string };
      await this.supabase
        .from('submission_queue')
        .update({ submission_id: submissionRow.id })
        .eq('id', queueItemId);

      // Schedule retry window for retryable error statuses
      if (submissionStatus !== 'submitted') {
        const backoffMs = this.rateLimiter.getBackoffDelay(submissionStatus, 0);
        if (backoffMs > 0) {
          await this.supabase
            .from('autoapply_submissions')
            .update({ next_retry_at: new Date(Date.now() + backoffMs).toISOString() })
            .eq('id', submissionRow.id);
        }
      }
    }

    // Non-submitted outcomes propagate as errors so the loop records them as failures
    if (submissionStatus !== 'submitted') {
      throw new Error(errorMessage ?? submissionStatus);
    }
  }
}

// --- Module-level wrappers (index.ts calls these) ----------------------------

let _processor: QueueProcessor | null = null;

export function start(supabase: SupabaseClient, workerId: string): void {
  _processor = new QueueProcessor(supabase, workerId);
  _processor.start();
}

export function stop(): void {
  _processor?.stop();
}

export function waitForIdle(): Promise<void> {
  return _processor?.waitForIdle() ?? Promise.resolve();
}
