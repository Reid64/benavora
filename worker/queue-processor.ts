import type { SupabaseClient } from '@supabase/supabase-js';
import { StealthBrowser } from '../src/lib/autoapply/stealth-browser.js';
import { FormAnalyzerAgent } from '../src/lib/autoapply/form-analyzer-agent.js';
import { FormFillerAgent } from '../src/lib/autoapply/form-filler-agent.js';
import { CaptchaSolver } from '../src/lib/autoapply/captcha-solver.js';
import { RegistrationAgent } from '../src/lib/autoapply/registration-agent.js';
import { CredentialManager } from '../src/lib/autoapply/credential-manager.js';
import { ScreenshotManager } from '../src/lib/autoapply/screenshot-manager.js';
import * as heartbeat from './heartbeat.js';
import { RateLimiter } from './rate-limiter.js';
import { ProxyManager } from './proxy-manager.js';
import { quickHealthCheck } from './portal-health.js';

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

// --- helpers -----------------------------------------------------------------

class SkipError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SkipError';
  }
}

function classifyError(message: string): string {
  if (/^captcha_failed/.test(message)) return 'captcha_failed';
  const lower = message.toLowerCase();
  if (/captcha|recaptcha|hcaptcha/.test(lower)) return 'captcha_blocked';
  if (/login|sign\s+in|account/.test(lower)) return 'account_required';
  if (/timeout|etimedout/.test(lower)) return 'timeout';
  if (/\b404\b|\b403\b|\b500\b/.test(lower)) return 'site_error';
  return 'failed';
}

function isIpBlock(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b403\b|\b429\b|blocked|suspicious|too many requests|rate.?limit/.test(lower);
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// --- QueueProcessor ----------------------------------------------------------

export class QueueProcessor {
  private running = false;
  private processing = false;
  private readonly idleResolvers: Array<() => void> = [];
  private readonly rateLimiter = new RateLimiter();
  private readonly captchaSolver = new CaptchaSolver();
  private readonly registrationAgent = new RegistrationAgent();
  private readonly credentialManager: CredentialManager;
  private readonly proxyManager = new ProxyManager({
    provider: process.env['PROXY_PROVIDER'] ?? 'static',
    apiKey: process.env['PROXY_API_KEY'] ?? '',
  });

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly workerId: string,
  ) {
    this.credentialManager = new CredentialManager(supabase);
  }

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
    await this.proxyManager.loadProxies();
    const proxyStats = this.proxyManager.getStats();
    console.log(`[QueueProcessor] Proxy pool ready — ${proxyStats.active}/${proxyStats.total} active`);

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

    // Fetch org name for registration params (best-effort — null is handled gracefully)
    const { data: orgRow } = await this.supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .maybeSingle();
    const orgProfile = orgRow as { name?: string | null } | null;
    if (!portalUrl) throw new SkipError('no_portal_url');
    const funderName = funder.name ?? funderId;

    // Quick portal health check before committing to a full browser session
    const portalHealth = await quickHealthCheck(portalUrl);
    if (portalHealth === 'dead') {
      console.log(`[QueueProcessor] Portal dead for ${funderName} (${portalUrl}) — skipping`);
      await this.supabase
        .from('funders')
        .update({ portal_status: 'dead', portal_last_checked_at: new Date().toISOString() })
        .eq('id', funderId);
      throw new SkipError('portal_dead');
    }

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

    const proxy = this.proxyManager.rotateForSubmission();
    if (proxy !== null) {
      console.log(`[QueueProcessor] Using proxy for ${funderName}: ${proxy.replace(/:[^:@]+@/, ':***@')}`);
    }

    const stealthBrowser = new StealthBrowser({ headless: true });
    const { browser, page } = await stealthBrowser.launch({ proxy: proxy ?? undefined });

    // Screenshot manager tracks all captures for this submission and back-fills
    // submission_id once the autoapply_submissions record is created.
    const screenshotManager = new ScreenshotManager();

    // Convenience wrapper — submissionId is null until the submission record exists.
    const snap = (stage: string): Promise<string> =>
      screenshotManager.captureAndUpload(page, stage, {
        orgId, funderId, submissionId: null, supabase: this.supabase,
      });

    let pageLoadPath: string | null = null;
    let preFillPath: string | null = null;
    let postFillPath: string | null = null;
    let postSubmitPath: string | null = null;
    let confirmationPath: string | null = null;
    let errorPath: string | null = null;
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

        // Capture page state after form analysis (analyzer already navigated to the portal)
        pageLoadPath = await snap('page_load');
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

      // For cached templates the FormAnalyzerAgent was skipped, so navigate now.
      if (!needsReanalysis) {
        await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        // Capture page state immediately after navigation
        pageLoadPath = await snap('page_load');
      }

      // Handle portals that require login or registration before the form is reachable
      await this.handleLoginGating(page, orgId, funderId, portalUrl, orgProfile);

      // Capture page state after login (the portal form, ready to be filled)
      preFillPath = await snap('pre_fill');

      // CAPTCHA detection and solving before form filling
      const captchaDetection = await this.captchaSolver.detectCaptcha(page);
      if (captchaDetection !== null && captchaDetection.type !== null) {
        const hasApiKey = Boolean(process.env['TWOCAPTCHA_API_KEY']);
        if (!hasApiKey) {
          console.log(`[QueueProcessor] CAPTCHA detected: ${captchaDetection.type}, no solver configured`);
          throw new Error('captcha_blocked');
        }

        console.log(`[QueueProcessor] CAPTCHA detected: ${captchaDetection.type}, solving...`);
        const token = await this.captchaSolver.solveCaptcha(captchaDetection, page);
        if (token === null) {
          throw new Error(`captcha_failed: solve returned null for ${captchaDetection.type}`);
        }

        await this.captchaSolver.injectSolution(page, captchaDetection, token);
        console.log(`[QueueProcessor] CAPTCHA solution injected for ${captchaDetection.type}`);
      }

      // Fill and submit the form
      const filler = new FormFillerAgent(this.supabase, stealthBrowser);
      const fillResult = await filler.fillAndSubmit({ page, template, organizationId: orgId, funderId });

      confirmationNumber = fillResult.confirmationNumber;
      requestDescription = fillResult.requestDescription;
      submissionStatus = 'submitted';

      // Capture live page state after fill + submit (post_fill = form submit complete)
      postFillPath = await snap('post_fill');

      // Capture post_submit using FormFillerAgent's screenshot if available
      // (captured mid-submission), falling back to a fresh page screenshot.
      if (fillResult.confirmationScreenshot) {
        postSubmitPath = await screenshotManager.uploadAndRecord(
          fillResult.confirmationScreenshot,
          'post_submit',
          { orgId, funderId, submissionId: null, supabase: this.supabase },
        );
      } else {
        postSubmitPath = await snap('post_submit');
      }

      // Final confirmation screenshot of the landing page
      confirmationPath = await snap('confirmation');

    } catch (err) {
      // Re-throw SkipErrors so the loop handles them as skips, not failures
      if (err instanceof SkipError) throw err;

      const message = err instanceof Error ? err.message : String(err);
      errorMessage = message;
      submissionStatus = classifyError(message);

      // Mark proxy as failed if the error looks like an IP block
      if (proxy !== null && isIpBlock(message)) {
        this.proxyManager.markFailed(proxy);
      }

      // Best-effort error screenshot while browser may still be open
      try {
        errorPath = await snap('error');
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
        pre_submit_screenshot_url: preFillPath,
        confirmation_screenshot_url: confirmationPath ?? postSubmitPath,
        confirmation_number: confirmationNumber,
        error_message: errorMessage,
        error_screenshot_url: errorPath,
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

    // Link submission_id back to the queue item for dashboard correlation,
    // and back-fill all autoapply_screenshots rows with the now-known submission ID.
    if (submission !== null) {
      const submissionRow = submission as { id: string };

      await Promise.all([
        this.supabase
          .from('submission_queue')
          .update({ submission_id: submissionRow.id })
          .eq('id', queueItemId),
        screenshotManager.linkToSubmission(submissionRow.id, this.supabase),
      ]);

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

    // Log captured paths for observability
    console.log(
      `[QueueProcessor] Screenshots for queue item ${queueItemId}:`,
      { pageLoadPath, preFillPath, postFillPath, postSubmitPath, confirmationPath, errorPath },
    );

    // After 3 consecutive failures for the same funder, surface for human review
    if (submissionStatus !== 'submitted' && submission !== null) {
      await this.maybeEnqueueForReview({
        orgId,
        funderId,
        submissionId: (submission as { id: string }).id,
        reason: submissionStatus,
      }).catch((e: unknown) => {
        console.warn(
          '[QueueProcessor] Failed to check review queue:',
          e instanceof Error ? e.message : String(e),
        );
      });
    }

    // Non-submitted outcomes propagate as errors so the loop records them as failures
    if (submissionStatus !== 'submitted') {
      throw new Error(errorMessage ?? submissionStatus);
    }
  }

  /**
   * After 3+ consecutive failures for the same funder, inserts (or updates) a
   * record in autoapply_review_queue so a human can investigate.
   */
  private async maybeEnqueueForReview({
    orgId,
    funderId,
    submissionId,
    reason,
  }: {
    orgId: string;
    funderId: string;
    submissionId: string;
    reason: string;
  }): Promise<void> {
    const { count } = await this.supabase
      .from('autoapply_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('funder_id', funderId)
      .eq('organization_id', orgId)
      .neq('status', 'submitted');

    const failureCount = count ?? 0;
    if (failureCount < 3) return;

    // If a pending or in_review entry already exists, update its failure count
    const { data: existing } = await this.supabase
      .from('autoapply_review_queue')
      .select('id')
      .eq('funder_id', funderId)
      .eq('organization_id', orgId)
      .in('status', ['pending', 'in_review'])
      .maybeSingle();

    if (existing !== null) {
      await this.supabase
        .from('autoapply_review_queue')
        .update({ failure_count: failureCount, reason })
        .eq('id', (existing as { id: string }).id);
      return;
    }

    await this.supabase.from('autoapply_review_queue').insert({
      submission_id: submissionId,
      organization_id: orgId,
      funder_id: funderId,
      reason,
      failure_count: failureCount,
      status: 'pending',
    });

    console.log(
      `[QueueProcessor] Funder ${funderId} has ${failureCount} failures — added to review queue`,
    );
  }

  /**
   * Detects whether the portal is gated behind a login wall and handles it by:
   * 1. Using stored credentials to log in, or
   * 2. Registering a new account and logging in with the generated credentials.
   * Throws SkipError('awaiting_confirmation') if the portal requires email verification
   * before the account becomes usable.
   */
  private async handleLoginGating(
    page: any,
    orgId: string,
    funderId: string,
    portalUrl: string,
    orgProfile: { name?: string | null } | null,
  ): Promise<void> {
    const loginDetection = await this.registrationAgent.detectLoginForm(page);
    if (!loginDetection?.hasLoginForm) return;

    console.log(`[QueueProcessor] Login form detected for funder ${funderId} — checking credentials`);

    const existing = await this.credentialManager.getCredentials(orgId, funderId);

    if (existing !== null) {
      const loginSuccess = await this.registrationAgent.login(page, {
        username: existing.username,
        password: existing.password,
      });
      await this.credentialManager.updateLastLogin(existing.id, loginSuccess);

      if (!loginSuccess) {
        throw new Error('account_required: stored credentials failed');
      }

      console.log(`[QueueProcessor] Logged in to ${portalUrl} with stored credentials`);
      return;
    }

    // No stored credentials — attempt registration
    console.log(`[QueueProcessor] No credentials for funder ${funderId} — attempting registration`);

    const regDetection = await this.registrationAgent.detectRegistrationForm(page);
    if (!regDetection?.hasRegistrationForm) {
      throw new Error('account_required: portal requires login but no registration form found');
    }

    const applyEmail = process.env['AUTOAPPLY_EMAIL'] ?? `apply+${funderId.slice(0, 8)}@benavora.com`;
    const orgName = orgProfile?.name ?? 'Organization';

    const regResult = await this.registrationAgent.register(page, {
      orgName,
      orgEmail: applyEmail,
      orgPhone: process.env['AUTOAPPLY_PHONE'] ?? '',
      contactName: orgName,
      contactEmail: applyEmail,
    });

    if (!regResult.success) {
      throw new Error(`account_required: registration failed — ${regResult.error ?? 'unknown'}`);
    }

    if (regResult.confirmationRequired) {
      // Can't proceed until the user confirms their email — skip this item
      throw new SkipError('awaiting_confirmation');
    }

    // Persist credentials so future submissions don't need to re-register
    await this.credentialManager.storeCredentials({
      organizationId: orgId,
      funderId,
      portalUrl,
      username: regResult.username ?? applyEmail,
      password: regResult.password ?? '',
    });

    console.log(`[QueueProcessor] Registered on ${portalUrl} — logging in`);

    const loginSuccess = await this.registrationAgent.login(page, {
      username: regResult.username ?? applyEmail,
      password: regResult.password ?? '',
    });

    if (!loginSuccess) {
      throw new Error('account_required: login failed after registration');
    }

    console.log(`[QueueProcessor] Logged in to ${portalUrl} after registration`);
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
