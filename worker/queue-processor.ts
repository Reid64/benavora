import type { SupabaseClient } from '@supabase/supabase-js';
import { StealthBrowser } from '../src/lib/autoapply/stealth-browser.js';
import { FormAnalyzerAgent } from '../src/lib/autoapply/form-analyzer-agent.js';
import { FormFillerAgent } from '../src/lib/autoapply/form-filler-agent.js';
import { CaptchaSolver } from '../src/lib/autoapply/captcha-solver.js';
import { RegistrationAgent } from '../src/lib/autoapply/registration-agent.js';
import { CredentialManager } from '../src/lib/autoapply/credential-manager.js';
import { ScreenshotManager } from '../src/lib/autoapply/screenshot-manager.js';
import { SubmissionValidator } from '../src/lib/autoapply/submission-validator.js';
import { SubmissionControls } from '../src/lib/autoapply/submission-controls.js';
import { parseConfirmationPage, type ConfirmationData } from '../src/lib/autoapply/confirmation-parser.js';
import { generateReceipt } from '../src/lib/autoapply/receipt-generator.js';
import { getOptimalAskAmount } from '../src/lib/autoapply/amount-optimizer.js';
import { personalizePitch } from '../src/lib/autoapply/pitch-personalizer.js';
import { getTimingScore } from '../src/lib/autoapply/timing-optimizer.js';
import * as heartbeat from './heartbeat.js';
import { RateLimiter } from './rate-limiter.js';
import { ProxyManager } from './proxy-manager.js';
import { quickHealthCheck } from './portal-health.js';
import { scoreAndReorderQueue } from './batch-scorer.js';
import { WebhookNotifier } from '../src/lib/autoapply/webhook-notifier.js';
import { annotateErrorScreenshot } from '../src/lib/autoapply/error-annotator.js';
import { assessSubmissionRisk, type RiskAssessment } from '../src/lib/autoapply/risk-engine.js';
import { RelationshipManager } from '../src/lib/autoapply/relationship-manager.js';
import { submitViaEmail } from '../src/lib/autoapply/email-submitter.js';
import { QueueControlPlane } from '../src/lib/autoapply/queue-controls.js';
import { UsageMeter } from '../src/lib/autoapply/usage-meter.js';
import { ABTestEngine } from '../src/lib/autoapply/ab-testing.js';
import type { ReadinessReport } from '../src/lib/autoapply/submission-validator.js';
import type { StreamServer } from './stream-server.js';
import { promises as fs } from 'node:fs';
import {
  claimNextEnrichDonorProspectJob,
  handleEnrichDonorProspectJob,
} from '../src/worker/jobs/enrich-donor-prospect.js';
import {
  claimNextScoreDonorProspectJob,
  handleScoreDonorProspectJob,
} from '../src/worker/jobs/score-donor-prospect.js';
import {
  claimNextRunConnectorEnrichmentJob,
  handleRunConnectorEnrichmentJob,
} from '../src/worker/jobs/run-connector-enrichment.js';

// --- types -------------------------------------------------------------------

interface QueueItem {
  id: string;
  organization_id: string;
  funder_id: string | null;
  status: string;
  automation_mode: string;
  scheduled_for: string | null;
  created_at: string;
  request_profile_id: string | null;
}

interface FunderRow {
  id: string;
  name: string | null;
  giving_portal_url: string | null;
  contact_email: string | null;
  category: string | null;
  type: string | null;
  automation_level: string | null;
}

interface FormTemplateRow {
  id: string;
  funder_id: string | null;
  last_verified_at: string | null;
  [key: string]: unknown;
}

interface RequestProfileRow {
  id: string;
  name: string;
  request_type: string;
  needs_description: string;
  pitch_template: string | null;
  form_field_overrides: Record<string, string> | null;
  min_value: number | null;
  max_value: number | null;
}

interface OrgRow {
  name: string | null;
  mission_statement: string | null;
  subscription_tier: string | null;
  ein: string | null;
  contact_email: string | null;
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

/**
 * Thrown by handleLoginGating() for portals (currently: Walmart Spark Good)
 * that require a one-time, human-in-the-loop account setup
 * (scripts/setup-sparkgood-account.ts) before this worker can log in and
 * submit autonomously. Distinct from SkipError so the poll loop can persist
 * a dedicated 'requires_account_setup' status instead of 'skipped' — the
 * dashboard (autoapply/page.tsx) surfaces this status as an actionable
 * banner rather than a routine skip.
 */
class AccountSetupRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountSetupRequiredError';
  }
}

/**
 * Thrown when a CAPTCHA or non-CAPTCHA verification challenge is detected
 * before form-fill begins. Per AUTOAPPLY_ARCHITECTURE_V2.md §10B, Benavora
 * does not solve CAPTCHAs or verification challenges — every detection
 * pauses the item for a human to resolve out-of-band (§10C's Human Review
 * Queue UI) and click resume. Distinct from SkipError/AccountSetupRequiredError
 * so the poll loop persists 'paused_verification' (not 'skipped' or
 * 'requires_account_setup') plus the reason and screenshot captured at
 * detection time. The screenshot must be taken here (while the browser page
 * is still open, before the outer loop's catch runs) — the reason and path
 * are carried on the error so the poll loop can write both to submission_queue
 * in one place, the same way AccountSetupRequiredError/SkipError already do.
 */
class CaptchaPauseError extends Error {
  constructor(
    public readonly pauseReason: string,
    public readonly screenshotPath: string,
  ) {
    super(`verification_pause: ${pauseReason}`);
    this.name = 'CaptchaPauseError';
  }
}

const VERIFICATION_CHALLENGE_PHRASES = [
  "verify you're human",
  'unusual activity',
  'account has been locked',
  'enter the code sent to',
  'two-factor',
  'one-time passcode',
  'security check',
] as const;

const WALMART_SPARKGOOD_PORTAL_TYPE = 'walmart_sparkgood';

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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// --- QueueProcessor ----------------------------------------------------------

export class QueueProcessor {
  private running = false;
  private processing = false;
  private wasIdle = true;
  private readonly idleResolvers: Array<() => void> = [];
  private readonly rateLimiter = new RateLimiter();
  private readonly captchaSolver = new CaptchaSolver();
  private readonly registrationAgent = new RegistrationAgent();
  private readonly credentialManager: CredentialManager;
  private readonly submissionValidator = new SubmissionValidator();
  private readonly submissionControls = new SubmissionControls();
  private readonly proxyManager = new ProxyManager({
    provider: process.env['PROXY_PROVIDER'] ?? 'static',
    apiKey: process.env['PROXY_API_KEY'] ?? '',
  });
  // Cached org readiness reports: orgId â†’ full report.
  // Reset on each idleâ†’active transition to re-check after a long pause.
  private readonly orgReadinessCache = new Map<string, ReadinessReport>();
  private readonly webhookNotifier = new WebhookNotifier();
  private readonly relationshipManager = new RelationshipManager();
  private readonly queueControlPlane = new QueueControlPlane();
  private readonly usageMeter = new UsageMeter();
  private readonly abTestEngine = new ABTestEngine();

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly workerId: string,
    private readonly streamServer?: StreamServer,
  ) {
    this.credentialManager = new CredentialManager(supabase);
  }

  /** Begin the poll loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[QueueProcessor] Starting â€” worker=${this.workerId}`);
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
    console.log(`[QueueProcessor] Proxy pool ready â€” ${proxyStats.active}/${proxyStats.total} active`);

    while (this.running) {
      const item = await this.dequeue();

      if (item === null) {
        if (!this.wasIdle) {
          // Transition from active â†’ idle: clear readiness cache so it's re-checked
          // on the next active period (org profile may have been updated while idle).
          this.orgReadinessCache.clear();
        }
        this.wasIdle = true;

        // Idle-cycle background work: donor_discovery §2B/§2D re-enrichment
        // (enrich_donor_prospect job type). Runs only when submission_queue is
        // empty so it never competes with funder submissions for this process.
        await this.runEnrichDonorProspectJob().catch((e: unknown) => {
          console.warn(
            '[QueueProcessor] enrich_donor_prospect job failed:',
            e instanceof Error ? e.message : String(e),
          );
        });

        // Idle-cycle background work: donor_discovery §2D Claude-rationale
        // (re-)scoring (score_donor_prospect job type). See
        // runScoreDonorProspectJob's doc comment for how this relates to
        // dd-request-processor.ts's own inline scoring stage.
        await this.runScoreDonorProspectJob().catch((e: unknown) => {
          console.warn(
            '[QueueProcessor] score_donor_prospect job failed:',
            e instanceof Error ? e.message : String(e),
          );
        });

        // Idle-cycle background work: donor_discovery §6 BYO-key connector
        // enrichment (run_connector_enrichment job type). Same opportunistic
        // posture as the two jobs above — see
        // runRunConnectorEnrichmentJob's doc comment.
        await this.runRunConnectorEnrichmentJob().catch((e: unknown) => {
          console.warn(
            '[QueueProcessor] run_connector_enrichment job failed:',
            e instanceof Error ? e.message : String(e),
          );
        });

        console.log('[QueueProcessor] Queue empty, sleeping 15s');
        await sleep(SLEEP_MS);
        continue;
      }

      // Transition from idle â†’ active: score and reorder the queue so the
      // highest-value submissions execute first within this active burst.
      if (this.wasIdle) {
        this.wasIdle = false;
        await scoreAndReorderQueue(this.supabase, item.organization_id).catch((e: unknown) => {
          console.warn(
            '[QueueProcessor] Batch scoring failed:',
            e instanceof Error ? e.message : String(e),
          );
        });
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
        if (err instanceof AccountSetupRequiredError) {
          console.log(`[QueueProcessor] Item ${item.id} requires account setup: ${err.message}`);
          await this.supabase
            .from('submission_queue')
            .update({
              status: 'requires_account_setup',
              error_message: err.message,
              completed_at: new Date().toISOString(),
            })
            .eq('id', item.id);
          await heartbeat.incrementProcessed();
        } else if (err instanceof SkipError) {
          console.log(`[QueueProcessor] Item ${item.id} skipped: ${err.message}`);
          await this.supabase
            .from('submission_queue')
            .update({ status: 'skipped', completed_at: new Date().toISOString() })
            .eq('id', item.id);
          await heartbeat.incrementProcessed();
        } else if (err instanceof CaptchaPauseError) {
          console.log(
            `[QueueProcessor] Item ${item.id} paused for verification (${err.pauseReason}) — not solving, awaiting human resume`,
          );
          // Append (not overwrite) so a queue item paused more than once across
          // resume attempts keeps its full pause history — read the current
          // array first since Supabase-js has no jsonb-concat update operator.
          const { data: currentRow } = await this.supabase
            .from('submission_queue')
            .select('paused_history')
            .eq('id', item.id)
            .maybeSingle();
          const priorHistory = Array.isArray(
            (currentRow as { paused_history?: unknown[] } | null)?.paused_history,
          )
            ? ((currentRow as { paused_history: unknown[] }).paused_history)
            : [];
          const pausedAt = new Date().toISOString();
          // Deliberately no completed_at: a paused item is not terminal, it is
          // awaiting a human resume (§10C), which retries from the top on the
          // next queue pass rather than continuing this attempt.
          await this.supabase
            .from('submission_queue')
            .update({
              status: 'paused_verification',
              pause_reason: err.pauseReason,
              paused_at: pausedAt,
              paused_screenshot_path: err.screenshotPath,
              paused_history: [
                ...priorHistory,
                { reason: err.pauseReason, screenshotPath: err.screenshotPath, pausedAt },
              ],
            })
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
   * Atomically claim the next pending item using a two-step SELECT â†’ UPDATE.
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

  /**
   * Wires the `enrich_donor_prospect` job type
   * (DONOR_DISCOVERY_ARCHITECTURE.md §2B/§2D) into this processor's idle
   * cycle. `donor_discovery_directory` re-enrichment isn't AutoApply's
   * concern, but this is the one long-lived worker loop with idle cycles to
   * spare. `worker/dd-request-processor.ts` already runs enrichment inline
   * as part of a request's enumerate -> enrich -> score pipeline (the
   * authoritative, request-scoped path); this is supplementary opportunistic
   * re-enrichment for prospects that have gone stale (>180 days) since a
   * request last touched them, claimed one at a time via
   * `claimNextEnrichDonorProspectJob`.
   */
  private async runEnrichDonorProspectJob(): Promise<void> {
    const job = await claimNextEnrichDonorProspectJob(this.supabase);
    if (job === null) return;

    console.log(`[QueueProcessor] enrich_donor_prospect: processing directory ${job.directoryId}`);
    const result = await handleEnrichDonorProspectJob(this.supabase, job);
    console.log(
      `[QueueProcessor] enrich_donor_prospect: directory ${job.directoryId} â€” ` +
        `${result.scoredProspectCount} prospect(s) re-scored` +
        (result.enrichment.error_reason ? ` (error_reason=${result.enrichment.error_reason})` : ''),
    );
  }

  /**
   * Wires the `score_donor_prospect` job type
   * (DONOR_DISCOVERY_ARCHITECTURE.md Â§2D) into this processor's idle cycle,
   * same posture as `runEnrichDonorProspectJob` above. This is the
   * Claude-rationale `ScoringEngine` (scoring-engine.ts) â€” supplementary to
   * `worker/dd-request-processor.ts`'s inline, deterministic (non-Claude)
   * scoring stage, which already scores every prospect a request surfaces
   * before marking that request complete. This job instead picks up
   * prospects that have never been scored by `ScoringEngine`, or whose
   * `scored_at` has gone stale, one at a time.
   */
  private async runScoreDonorProspectJob(): Promise<void> {
    const job = await claimNextScoreDonorProspectJob(this.supabase);
    if (job === null) return;

    console.log(`[QueueProcessor] score_donor_prospect: processing prospect ${job.prospectId}`);
    const { result } = await handleScoreDonorProspectJob(this.supabase, job);
    console.log(
      `[QueueProcessor] score_donor_prospect: prospect ${job.prospectId} â€” score=${result.score}`,
    );
  }

  /**
   * Wires the `run_connector_enrichment` job type
   * (DONOR_DISCOVERY_ARCHITECTURE.md Â§6) into this processor's idle cycle,
   * same posture as `runEnrichDonorProspectJob`/`runScoreDonorProspectJob`
   * above. Picks up one (prospect, provider) pair at a time for orgs with an
   * active Apollo/Hunter connector whose prospect hasn't been enriched by
   * that provider yet, decrypts the org's stored key, calls the connector,
   * and merges the result into `donor_discovery_prospects.enrichment_private`
   * (tenant-scoped, migration 079) â€” never the shared directory row.
   */
  private async runRunConnectorEnrichmentJob(): Promise<void> {
    const job = await claimNextRunConnectorEnrichmentJob(this.supabase);
    if (job === null) return;

    console.log(
      `[QueueProcessor] run_connector_enrichment: processing prospect ${job.prospectId} via ${job.connectorProvider}`,
    );
    const result = await handleRunConnectorEnrichmentJob(this.supabase, job);
    console.log(
      `[QueueProcessor] run_connector_enrichment: prospect ${job.prospectId} â€” ` +
        `${result.enrichment.contacts.length} decision-maker contact(s) found via ${job.connectorProvider}`,
    );
  }

  private async processItem(item: QueueItem): Promise<void> {
    const { funder_id: funderId, organization_id: orgId, id: queueItemId } = item;

    if (funderId === null) throw new SkipError('no_funder_id');

    // Check queue control plane: platform â†’ domain (unknown at this stage) â†’ funder â†’ tenant.
    // Domain-level check is deferred until after funder record is fetched (portal URL needed).
    const earlyBlock = await this.queueControlPlane.isBlocked({
      orgId,
      funderId,
      supabase: this.supabase,
    }).catch((e: unknown) => {
      console.warn(
        '[QueueProcessor] isBlocked check failed (proceeding):',
        e instanceof Error ? e.message : String(e),
      );
      return null;
    });

    if (earlyBlock !== null && earlyBlock.blocked) {
      throw new SkipError(`control_plane_blocked:${earlyBlock.controlType ?? 'unknown'}: ${earlyBlock.reason ?? 'paused'}`);
    }

    // Fetch funder record (category + type needed for timing score and pitch personalizer)
    const { data: funderData, error: funderError } = await this.supabase
      .from('funders')
      .select('id, name, giving_portal_url, contact_email, category, type, automation_level')
      .eq('id', funderId)
      .maybeSingle();

    if (funderError) throw new SkipError(`funder_fetch_error: ${funderError.message}`);
    if (funderData === null) throw new SkipError('funder_not_found');

    const funder = funderData as FunderRow;
    const portalUrl = funder.giving_portal_url;
    const funderContactEmail = funder.contact_email;
    const funderName = funder.name ?? funderId;

    // Prefer web form; fall back to email; skip if neither is available
    if (!portalUrl && !funderContactEmail) throw new SkipError('no_portal_or_email');
    const submissionChannel: 'web_form' | 'email' = portalUrl ? 'web_form' : 'email';

    // Domain-level control check now that we have the portal URL (web form only).
    const domainBlock = portalUrl !== null ? await this.queueControlPlane.isBlocked({
      portalUrl,
      supabase: this.supabase,
    }).catch(() => null) : null;

    if (domainBlock !== null && domainBlock.blocked && domainBlock.controlType === 'domain') {
      throw new SkipError(`control_plane_blocked:domain: ${domainBlock.reason ?? 'domain paused'}`);
    }

    // Fetch org profile (mission needed for pitch personalizer, tier for controls)
    const { data: orgData } = await this.supabase
      .from('organizations')
      .select('name, mission_statement, subscription_tier, ein, contact_email')
      .eq('id', orgId)
      .maybeSingle();
    const orgProfile = orgData as OrgRow | null;

    // Determine whether to use org-provided API keys for AI calls.
    // Logged here so the worker log reflects key source per submission.
    const ownKeysConfig = await this.usageMeter
      .shouldUseOwnKeys(orgId, this.supabase)
      .catch((_e: unknown) => ({ useOwn: false as const }));
    if (ownKeysConfig.useOwn) {
      console.log(`[QueueProcessor] Org ${orgId} using own API keys`);
    }

    // --- Mutual exclusion vs. the other AutoApply pipeline ("Agent 16" browser
    // automation, /api/agents/automation + automation_sessions) — both can
    // independently target the same org+funder with no shared lock otherwise.
    // Checked per-item (not cached like org readiness below) since a conflict
    // is genuinely per org+funder, not per org.
    const concurrentAutomation = await this.submissionValidator
      .checkConcurrentAutomation(orgId, funderId, this.supabase)
      .catch((e: unknown) => {
        console.warn(
          '[QueueProcessor] concurrent-automation check failed (proceeding):',
          e instanceof Error ? e.message : String(e),
        );
        return { conflict: false as const };
      });
    if (concurrentAutomation.conflict) {
      throw new SkipError(
        `concurrent_automation_conflict: active automation_sessions row ${concurrentAutomation.sessionId ?? 'unknown'} exists for this org+funder`,
      );
    }

    // --- Org readiness (cached per org, cleared on idleâ†’active transition) ---
    let orgReadinessReport: ReadinessReport;
    if (!this.orgReadinessCache.has(orgId)) {
      const readiness = await this.submissionValidator.checkOrgReadiness(orgId, this.supabase);
      this.orgReadinessCache.set(orgId, readiness);
      orgReadinessReport = readiness;
      if (!readiness.ready) {
        console.warn(
          `[QueueProcessor] Org ${orgId} is not ready for AutoApply:`,
          readiness.blockers.join(', '),
        );
        throw new SkipError(`org_not_ready: ${readiness.blockers[0] ?? 'incomplete profile'}`);
      }
    } else {
      orgReadinessReport = this.orgReadinessCache.get(orgId)!;
      if (!orgReadinessReport.ready) {
        throw new SkipError('org_not_ready');
      }
    }

    // --- Usage allowance: enforce monthly + daily tier caps before browser launch ---
    const usageAllowance = await this.usageMeter
      .checkAllowance(orgId, 'automated', this.supabase)
      .catch((_e: unknown) => null);
    if (usageAllowance !== null && !usageAllowance.allowed) {
      throw new SkipError(
        `usage_limit_reached: monthly=${usageAllowance.monthlyCount}/${usageAllowance.monthlyLimit} daily=${usageAllowance.dailyCount}/${usageAllowance.dailyLimit}`,
      );
    }

    // --- Load request profile linked to this queue item ---
    let requestProfile: RequestProfileRow | null = null;
    if (item.request_profile_id) {
      const { data: profileData } = await this.supabase
        .from('request_profiles')
        .select('id, name, request_type, needs_description, pitch_template, form_field_overrides, min_value, max_value')
        .eq('id', item.request_profile_id)
        .maybeSingle();
      requestProfile = profileData as RequestProfileRow | null;
    }

    // --- Submission controls: check before launching a browser session ---
    const funderDomain = portalUrl !== null ? extractDomain(portalUrl) : null;

    const velocityCheck = await this.submissionControls.checkVelocityLimits(orgId, this.supabase);
    if (velocityCheck.blocked) {
      throw new SkipError(`velocity_limit: ${velocityCheck.reason ?? 'daily cap reached'}`);
    }

    // Cross-client dedup and domain throttle only apply to web form submissions
    if (funderDomain !== null && portalUrl !== null) {
      const crossClientCheck = await this.submissionControls.checkCrossClientDedup(
        funderDomain,
        orgId,
        this.supabase,
      );
      if (crossClientCheck.blocked) {
        throw new SkipError(`cross_client_blocked: ${crossClientCheck.reason ?? 'domain recently used by another org'}`);
      }

      const domainThrottle = await this.submissionControls.checkDomainThrottle(portalUrl, this.supabase);
      if (domainThrottle.blocked) {
        throw new SkipError(`domain_throttled: ${domainThrottle.reason ?? 'too many recent submissions to this domain'}`);
      }
    }

    // --- Relationship contact rules: do_not_contact_until + disallowed_request_types ---
    const contactCheck = await this.relationshipManager.checkContactRules(
      orgId,
      funderId,
      this.supabase,
      requestProfile?.request_type,
    ).catch((e: unknown) => {
      console.warn(
        '[QueueProcessor] checkContactRules failed (proceeding):',
        e instanceof Error ? e.message : String(e),
      );
      return null;
    });

    if (contactCheck !== null && !contactCheck.canContact) {
      throw new SkipError(`contact_rules_blocked: ${contactCheck.reason ?? 'funder contact blocked'}`);
    }

    // --- Timing score (for record-keeping and future scheduling intelligence) ---
    const timingResult = getTimingScore({
      funderType: funder.type ?? funder.category ?? 'corporate',
      funderCategory: funder.category,
    });
    const timingScore = timingResult.score;

    // --- A/B test variant selection (before pitch personalization) ---
    // activeVariantId still drives pitch-variant selection and
    // abTestEngine.recordOutcome() below — only the write of this value into
    // autoapply_submissions.variant_id was removed (that column doesn't exist
    // live; confirmed via direct PostgREST query, Postgres error 42703). That
    // write made the insert into autoapply_submissions fail for every
    // web_form/email submission, so no audit row was ever created regardless
    // of outcome — found via src/__tests__/integration/autoapply-queue.test.ts.
    let activeVariantId: string | null = null;
    const abVariant = await this.abTestEngine
      .getVariant(orgId, funder.category ?? '', this.supabase)
      .catch((e: unknown) => {
        console.warn(
          '[QueueProcessor] ABTestEngine.getVariant failed:',
          e instanceof Error ? e.message : String(e),
        );
        return null;
      });

    if (abVariant !== null) {
      activeVariantId = abVariant.id;
      console.log(
        `[QueueProcessor] A/B test variant for ${funderName}: ${abVariant.variantName}`,
      );
    }

    // --- Personalized pitch for description fields ---
    let personalizedPitch: string | null = null;
    const orgMission = orgProfile?.mission_statement ?? '';
    const orgName = orgProfile?.name ?? 'Organization';
    if (orgMission) {
      // Load program names for pitch context (best-effort)
      const { data: programsData } = await this.supabase
        .from('programs')
        .select('name')
        .eq('organization_id', orgId);
      const programs = ((programsData ?? []) as Array<{ name: string | null }>)
        .map((p) => p.name)
        .filter((n): n is string => n !== null);

      personalizedPitch = await personalizePitch({
        orgMission,
        orgPrograms: programs,
        orgName,
        funderName,
        funderPriorities: funder.category ? [funder.category] : [],
        funderCategory: funder.category ?? undefined,
        requestProfile: requestProfile
          ? {
              request_type: requestProfile.request_type,
              needs_description: requestProfile.needs_description,
              pitch_template: requestProfile.pitch_template,
            }
          : null,
        pitchStyle: abVariant?.pitchStyle,
        emphasis: abVariant?.emphasis,
        bypassCache: abVariant !== null,
        organizationId: orgId,
        funderId,
        supabase: this.supabase,
      }).catch((e: unknown) => {
        console.warn(
          '[QueueProcessor] personalizePitch failed (using raw mission):',
          e instanceof Error ? e.message : String(e),
        );
        return null;
      });
    }

    // --- Optimal ask amount for monetary fields ---
    const askAmountResult = await getOptimalAskAmount({
      funderId,
      requestProfile: requestProfile
        ? {
            request_type: requestProfile.request_type,
            min_value: requestProfile.min_value,
            max_value: requestProfile.max_value,
          }
        : null,
      funderCategory: funder.category,
      supabase: this.supabase,
    }).catch((e: unknown) => {
      console.warn(
        '[QueueProcessor] getOptimalAskAmount failed:',
        e instanceof Error ? e.message : String(e),
      );
      return null;
    });
    const optimizedAmount = askAmountResult?.recommended ?? null;

    // Build the FormFillerAgent request profile, injecting the personalized pitch
    // and any overrides from the request profile record.
    const fillerRequestProfile = requestProfile
      ? {
          request_type: requestProfile.request_type,
          name: requestProfile.name,
          needs_description: personalizedPitch ?? requestProfile.needs_description,
          pitch_template: requestProfile.pitch_template,
          form_field_overrides: requestProfile.form_field_overrides ?? undefined,
        }
      : undefined;

    // --- Email submission channel ---
    if (submissionChannel === 'email') {
      if (!process.env['RESEND_API_KEY']) {
        throw new SkipError('email_not_configured');
      }

      const requestType = requestProfile?.request_type ?? 'monetary';
      const pitch = personalizedPitch ?? orgProfile?.mission_statement ?? '';
      const replyTo = orgProfile?.contact_email ?? '';

      let emailStatus = 'failed';
      let emailMessageId: string | null = null;
      let emailError: string | null = null;

      try {
        const result = await submitViaEmail({
          funderEmail: funderContactEmail!,
          funderName,
          organizationName: orgName,
          personalizedPitch: pitch,
          requestType,
          askAmount: optimizedAmount ?? undefined,
          contactEmail: replyTo,
        });
        emailMessageId = result.messageId;
        emailStatus = 'submitted';
        console.log(`[QueueProcessor] Email submitted to ${funderName} (${funderContactEmail}): messageId=${emailMessageId}`);
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
        console.error(`[QueueProcessor] Email submission failed for ${funderName}:`, emailError);
      }

      void this.usageMeter.recordUsage(orgId, 'email', { claude: 0, proxy: 0 }, this.supabase).catch((e: unknown) => {
        console.warn('[QueueProcessor] recordUsage (email) failed:', e instanceof Error ? e.message : String(e));
      });

      const { data: emailSubmission, error: emailSubError } = await this.supabase
        .from('autoapply_submissions')
        .insert({
          organization_id: orgId,
          funder_id: funderId,
          request_profile_id: item.request_profile_id,
          status: emailStatus,
          submission_channel: 'email',
          request_description: pitch,
          personalized_pitch: personalizedPitch,
          optimized_amount: optimizedAmount,
          timing_score: timingScore,
          error_message: emailError,
          submitted_at: emailStatus === 'submitted' ? new Date().toISOString() : null,
        })
        .select('*')
        .single();

      // Record A/B test outcome for the email channel.
      if (activeVariantId !== null) {
        void this.abTestEngine
          .recordOutcome(activeVariantId, emailStatus === 'submitted', this.supabase)
          .catch((e: unknown) => {
            console.warn(
              '[QueueProcessor] ABTestEngine.recordOutcome (email):',
              e instanceof Error ? e.message : String(e),
            );
          });
      }

      if (emailSubError) {
        console.error(`[QueueProcessor] Failed to create email submission record for ${queueItemId}:`, emailSubError.message);
      }

      if (emailSubmission !== null) {
        const emailSubRow = emailSubmission as { id: string };

        await this.supabase
          .from('submission_queue')
          .update({ submission_id: emailSubRow.id })
          .eq('id', queueItemId);

        if (emailStatus === 'submitted') {
          await this.relationshipManager.recordSubmission(
            orgId,
            funderId,
            { request_type: requestType, submitted_at: new Date().toISOString() },
            this.supabase,
          ).catch((e: unknown) => {
            console.warn('[QueueProcessor] relationshipManager.recordSubmission (email):', e instanceof Error ? e.message : String(e));
          });

          void this.webhookNotifier.notify({
            orgId,
            event: 'submission_completed',
            data: {
              submissionId: emailSubRow.id,
              funderName,
              confirmationNumber: emailMessageId,
              requestType,
              submittedAt: new Date().toISOString(),
              channel: 'email',
            },
            supabase: this.supabase,
          }).catch((e: unknown) => {
            console.warn('[QueueProcessor] webhook email submission_completed:', e instanceof Error ? e.message : String(e));
          });
        } else {
          void this.webhookNotifier.notify({
            orgId,
            event: 'submission_failed',
            data: {
              submissionId: emailSubRow.id,
              funderName,
              errorMessage: emailError ?? emailStatus,
              status: emailStatus,
              channel: 'email',
            },
            supabase: this.supabase,
          }).catch((e: unknown) => {
            console.warn('[QueueProcessor] webhook email submission_failed:', e instanceof Error ? e.message : String(e));
          });
        }
      }

      if (emailStatus !== 'submitted') {
        throw new Error(emailError ?? emailStatus);
      }

      return;
    }

    // Quick portal health check before committing to a full browser session
    const portalHealth = await quickHealthCheck(portalUrl!);
    if (portalHealth === 'dead') {
      console.log(`[QueueProcessor] Portal dead for ${funderName} (${portalUrl}) â€” skipping`);
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

    // --- Risk assessment (before browser launch) ---
    const riskAssessment = await assessSubmissionRisk({
      funder: {
        id: funderId,
        name: funderName,
        automation_level: funder.automation_level,
        giving_portal_url: funder.giving_portal_url,
      },
      requestProfile: requestProfile
        ? {
            request_type: requestProfile.request_type,
            min_value: requestProfile.min_value,
            max_value: requestProfile.max_value,
          }
        : undefined,
      formTemplate: existingTemplate
        ? {
            field_count: (existingTemplate['field_count'] as number | null | undefined) ?? null,
            has_file_uploads: Boolean(existingTemplate['requires_file_upload']),
            form_structure: existingTemplate['form_structure'],
          }
        : null,
      orgReadiness: {
        ready: orgReadinessReport.ready,
        missing_required: orgReadinessReport.missing_required,
      },
      crossClientBlocked: false,
      supabase: this.supabase,
    }).catch((e: unknown) => {
      console.warn(
        '[QueueProcessor] assessSubmissionRisk failed (proceeding as auto):',
        e instanceof Error ? e.message : String(e),
      );
      return null;
    });

    if (riskAssessment !== null) {
      console.log(
        `[QueueProcessor] Risk assessment for ${funderName}: score=${riskAssessment.score} classification=${riskAssessment.classification}`,
        riskAssessment.factors.map((f) => `${f.name}(+${f.points})`).join(', ') || 'no factors',
      );

      if (riskAssessment.recommendation === 'manual') {
        // Route to manual queue â€” store risk metadata and skip automated processing
        await this.supabase
          .from('submission_queue')
          .update({
            automation_mode: 'manual',
            status: 'pending_manual',
            risk_score: riskAssessment.score,
            risk_factors: riskAssessment.factors,
          })
          .eq('id', queueItemId);

        if (riskAssessment.shouldNotify) {
          void this.webhookNotifier.notify({
            orgId,
            event: 'review_needed',
            data: {
              funderId,
              funderName,
              riskScore: riskAssessment.score,
              riskClassification: riskAssessment.classification,
              riskFactors: riskAssessment.factors,
              reason: 'risk_engine_manual_route',
            },
            supabase: this.supabase,
          }).catch((e: unknown) => {
            console.warn('[QueueProcessor] webhook review_needed (risk):', e instanceof Error ? e.message : String(e));
          });
        }

        throw new SkipError(`risk_manual_route: score=${riskAssessment.score} (${riskAssessment.classification})`);
      }

      if (riskAssessment.recommendation === 'assisted') {
        console.log(
          `[QueueProcessor] MEDIUM risk for ${funderName} â€” processing with enhanced logging. Factors:`,
          riskAssessment.factors.map((f) => f.description).join(' | '),
        );
      }

      if (riskAssessment.shouldNotify) {
        void this.webhookNotifier.notify({
          orgId,
          event: 'review_needed',
          data: {
            funderId,
            funderName,
            riskScore: riskAssessment.score,
            riskClassification: riskAssessment.classification,
            riskFactors: riskAssessment.factors,
            reason: 'risk_engine_notify',
          },
          supabase: this.supabase,
        }).catch((e: unknown) => {
          console.warn('[QueueProcessor] webhook review_needed (risk notify):', e instanceof Error ? e.message : String(e));
        });
      }
    }

    const proxy = this.proxyManager.rotateForSubmission();
    if (proxy !== null) {
      console.log(`[QueueProcessor] Using proxy for ${funderName}: ${proxy.replace(/:[^:@]+@/, ':***@')}`);
    }

    const stealthBrowser = new StealthBrowser({ headless: true });
    const { browser, page } = await stealthBrowser.launch({ proxy: proxy ?? undefined });

    const submissionStartedAt = Date.now();
    const hasViewers = this.streamServer !== undefined && this.streamServer.getViewerCount(orgId) > 0;
    const broadcastStep = (step: string): void => {
      if (hasViewers && this.streamServer !== undefined) {
        this.streamServer.broadcastStatus(orgId, { step, funderName, elapsed: Date.now() - submissionStartedAt });
      }
    };
    if (hasViewers) {
      await stealthBrowser.startScreencast((frame) => {
        this.streamServer!.broadcastFrame(orgId, frame);
      }).catch((e: unknown) => {
        console.warn('[QueueProcessor] startScreencast failed:', e instanceof Error ? e.message : String(e));
      });
    }

    // Screenshot manager tracks all captures for this submission and back-fills
    // submission_id once the autoapply_submissions record is created.
    const screenshotManager = new ScreenshotManager();

    // Convenience wrapper â€” submissionId is null until the submission record exists.
    const snap = (stage: string): Promise<string> =>
      screenshotManager.captureAndUpload(page, stage, {
        orgId, funderId, submissionId: null, supabase: this.supabase,
      });

    let localRecordingPath: string | null = null;
    let pageLoadPath: string | null = null;
    let preFillPath: string | null = null;
    let postFillPath: string | null = null;
    let postSubmitPath: string | null = null;
    let confirmationPath: string | null = null;
    let errorPath: string | null = null;
    let errorScreenshotBuffer: Buffer | null = null;
    let submissionStatus = 'failed';
    let confirmationNumber: string | null = null;
    let requestDescription: string | null = null;
    let errorMessage: string | null = null;
    let formTemplateId: string | null = existingTemplate?.id ?? null;
    let confirmationData: ConfirmationData | null = null;
    // Set just before fillAndSubmit() â€” see createApprovedAutomationSession() below.
    let autoSessionId: string | null = null;

    try {
      broadcastStep('Analyzing form');
      // Analyze the form if no cached template or template is stale
      if (needsReanalysis) {
        let analyzeResult: { id: string; fieldCount: number };
        try {
          const analyzer = new FormAnalyzerAgent(this.supabase);
          analyzeResult = await analyzer.analyzeAndStore({ page, portalUrl: portalUrl!, funderId, organizationId: orgId });
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

      // --- Pre-submission form data validation ---
      // Validate field format constraints (EIN, email, phone, URL) using the template's
      // form_structure and best-effort org data before launching the browser session.
      if (Array.isArray(template['form_structure'])) {
        const formFields = template['form_structure'] as Array<{
          fieldName: string;
          fieldLabel?: string;
          fieldType?: string;
          required?: boolean;
          selector?: string;
        }>;
        // Build minimal field values from org profile for format-level validation only.
        const fieldValues: Record<string, string> = {};
        if (orgProfile) {
          for (const field of formFields) {
            const label = `${field.fieldLabel ?? ''} ${field.fieldName}`.toLowerCase();
            if ((label.includes('ein') || label.includes('tax id')) && orgProfile.ein) {
              fieldValues[field.fieldName] = orgProfile.ein;
            } else if (label.includes('email') && orgProfile.contact_email) {
              fieldValues[field.fieldName] = orgProfile.contact_email;
            }
          }
        }
        if (Object.keys(fieldValues).length > 0) {
          const validation = await this.submissionValidator.validateFormData(
            formFields as Parameters<typeof this.submissionValidator.validateFormData>[0],
            fieldValues,
            orgProfile,
          ).catch(() => null);
          if (validation && !validation.valid) {
            console.warn(
              `[QueueProcessor] Pre-submission format validation for ${funderName}:`,
              validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
            );
          }
        }
      }

      // For cached templates the FormAnalyzerAgent was skipped, so navigate now.
      if (!needsReanalysis) {
        broadcastStep('Loading portal');
        await page.goto(portalUrl!, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        // Capture page state immediately after navigation
        pageLoadPath = await snap('page_load');
      }

      // Handle portals that require login or registration before the form is reachable
      await this.handleLoginGating(page, orgId, funderId, portalUrl!, orgProfile);

      // Capture page state after login (the portal form, ready to be filled)
      preFillPath = await snap('pre_fill');

      broadcastStep('Checking for CAPTCHA / verification challenge');
      // Per AUTOAPPLY_ARCHITECTURE_V2.md §10B: Benavora does not solve CAPTCHAs or
      // verification challenges. Detection is a union of two signals — either one
      // triggers an unconditional pause, regardless of whether TWOCAPTCHA_API_KEY is
      // configured. There is no auto-solve path here anymore (see captcha-solver.ts's
      // own header for why solveCaptcha()/injectSolution() still exist as methods but
      // are dead from this call site).
      const captchaDetection = await this.captchaSolver.detectCaptcha(page);
      const pageText = await page
        .evaluate(() => document.body?.innerText ?? '')
        .then((t: string) => t.toLowerCase())
        .catch(() => '');
      const verificationPhraseMatch =
        VERIFICATION_CHALLENGE_PHRASES.find((phrase) => pageText.includes(phrase)) ?? null;

      if ((captchaDetection !== null && captchaDetection.type !== null) || verificationPhraseMatch !== null) {
        const pauseReason =
          captchaDetection !== null && captchaDetection.type !== null
            ? ({
                recaptcha_v2: 'captcha_recaptcha_v2',
                recaptcha_v3: 'captcha_recaptcha_v3_unsupported',
                hcaptcha: 'captcha_hcaptcha',
                turnstile: 'captcha_turnstile',
              } as Record<string, string>)[captchaDetection.type] ?? 'captcha_image'
            : 'verification_challenge_detected';

        console.log(
          `[QueueProcessor] Verification challenge detected for ${funderName} (${pauseReason}) — ` +
          `pausing for human review, not solving`,
        );

        // Screenshot while the page is still open — the finally block's browser.close()
        // below would otherwise make this unrecoverable. Same captureAndUpload
        // convention already used for page_load/pre_fill immediately above, tagged
        // 'captcha_detected' per §10B.
        const pausedScreenshotPath = await snap('captcha_detected');

        // Stop the pipeline immediately: createApprovedAutomationSession() below is
        // never reached, so no automation_sessions row exists for this attempt — there
        // is nothing "mid-submission" to roll back. The poll loop's catch persists
        // status='paused_verification' on submission_queue (see CaptchaPauseError).
        throw new CaptchaPauseError(pauseReason, pausedScreenshotPath);
      }

      broadcastStep('Filling form');

      // BEHAVIORAL_CONTRACTS Â§18 / CRITICAL ISSUE #15: fillAndSubmit() now refuses
      // to submit without an approved automation_sessions row. This worker is a
      // fully autonomous per-item pipeline (no human reviews each queue item) â€”
      // approval here reflects that the risk engine above already routed anything
      // it flagged 'manual' to pending_manual before this point, so everything
      // that reaches here was already cleared for automated submission. A real
      // session row is still created and driven through pending -> approved (and
      // finalized to submitted/failed below) so there's a genuine, queryable
      // audit trail rather than a synthetic id or a skipped check.
      autoSessionId = await this.createApprovedAutomationSession({
        orgId,
        funderId,
        portalUrl: portalUrl!,
        queueItemId,
        riskAssessment,
      });

      // Fill and submit the form, passing request profile (with personalized pitch injected)
      const filler = new FormFillerAgent(this.supabase, stealthBrowser);
      const fillResult = await filler.fillAndSubmit({
        page,
        template,
        organizationId: orgId,
        funderId,
        requestProfile: fillerRequestProfile,
        sessionId: autoSessionId,
      });

      confirmationNumber = fillResult.confirmationNumber;
      requestDescription = fillResult.requestDescription;
      submissionStatus = 'submitted';
      broadcastStep('Capturing confirmation');

      // Parse the confirmation page for structured data (confirmation number, next steps, etc.)
      confirmationData = await parseConfirmationPage(page).catch((e: unknown) => {
        console.warn(
          '[QueueProcessor] parseConfirmationPage failed:',
          e instanceof Error ? e.message : String(e),
        );
        return null;
      });

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
      // Re-throw CaptchaPauseError so the loop persists 'paused_verification'
      // instead of creating a generic autoapply_submissions failure record —
      // a pause is not a failure, it's a resumable stop pending a human (§10B).
      if (err instanceof CaptchaPauseError) throw err;

      const message = err instanceof Error ? err.message : String(err);
      errorMessage = message;
      submissionStatus = classifyError(message);

      // Mark proxy as failed if the error looks like an IP block
      if (proxy !== null && isIpBlock(message)) {
        this.proxyManager.markFailed(proxy);
      }

      // Best-effort error screenshot while browser may still be open.
      // Capture as a buffer so the error-annotator can analyze it.
      try {
        const buf = (await page.screenshot({ fullPage: false })) as Buffer;
        errorScreenshotBuffer = buf;
        errorPath = await screenshotManager.uploadAndRecord(buf, 'error', {
          orgId, funderId, submissionId: null, supabase: this.supabase,
        });
      } catch {
        // Browser already closed â€” skip error screenshot
      }
    } finally {
      if (hasViewers) {
        await stealthBrowser.stopScreencast().catch(() => {});
      }
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
      // Retrieve recording path only after browser.close() finalizes the .webm file
      localRecordingPath = await stealthBrowser.getRecordingPath().catch(() => null);
    }

    // Close out the automation_sessions audit trail (if a session was created above â€”
    // it may not have been if the run failed before reaching the fill/submit stage).
    if (autoSessionId !== null) {
      await this.finalizeAutomationSession(
        autoSessionId,
        orgId,
        submissionStatus === 'submitted',
        confirmationNumber,
        errorMessage,
      ).catch((e: unknown) => {
        console.warn(
          '[QueueProcessor] Failed to finalize automation session:',
          e instanceof Error ? e.message : String(e),
        );
      });
    }

    // Persist full submission audit record
    const { data: submission, error: submissionError } = await this.supabase
      .from('autoapply_submissions')
      .insert({
        organization_id: orgId,
        funder_id: funderId,
        form_template_id: formTemplateId,
        request_profile_id: item.request_profile_id,
        status: submissionStatus,
        request_description: requestDescription,
        pre_submit_screenshot_url: preFillPath,
        confirmation_screenshot_url: confirmationPath ?? postSubmitPath,
        confirmation_number: confirmationNumber,
        confirmation_data: confirmationData,
        personalized_pitch: personalizedPitch,
        optimized_amount: optimizedAmount,
        timing_score: timingScore,
        error_message: errorMessage,
        error_screenshot_url: errorPath,
        retry_count: 0,
        submitted_at: submissionStatus === 'submitted' ? new Date().toISOString() : null,
      })
      .select('*')
      .single();

    // Record A/B test outcome now that the submission result is known.
    if (activeVariantId !== null) {
      void this.abTestEngine
        .recordOutcome(activeVariantId, submissionStatus === 'submitted', this.supabase)
        .catch((e: unknown) => {
          console.warn(
            '[QueueProcessor] ABTestEngine.recordOutcome:',
            e instanceof Error ? e.message : String(e),
          );
        });
    }

    if (submissionError) {
      console.error(
        `[QueueProcessor] Failed to create submission record for queue item ${queueItemId}:`,
        submissionError.message,
      );
    }

    // Record usage for billing metering â€” fire-and-forget, never block the queue.
    void this.usageMeter.recordUsage(
      orgId,
      'automated',
      { claude: 0.05, proxy: proxy !== null ? 0.03 : 0 },
      this.supabase,
    ).catch((e: unknown) => {
      console.warn('[QueueProcessor] recordUsage failed:', e instanceof Error ? e.message : String(e));
    });

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

      // Upload session recording to Supabase Storage (fire-and-forget on failure)
      if (localRecordingPath !== null) {
        const storagePath = `${orgId}/${submissionRow.id}.webm`;
        const capturedRecordingPath = localRecordingPath;
        try {
          const recordingBuffer = await fs.readFile(capturedRecordingPath);
          const fileSizeBytes = recordingBuffer.byteLength;
          const durationSeconds = Math.round((Date.now() - submissionStartedAt) / 1000);

          const { error: recUploadErr } = await this.supabase.storage
            .from('session-recordings')
            .upload(storagePath, recordingBuffer, { contentType: 'video/webm', upsert: false });

          if (recUploadErr) {
            console.warn(
              `[QueueProcessor] Recording upload failed for ${queueItemId}:`,
              recUploadErr.message,
            );
          } else {
            await this.supabase.from('session_recordings').insert({
              submission_id: submissionRow.id,
              organization_id: orgId,
              funder_id: funderId,
              storage_path: storagePath,
              duration_seconds: durationSeconds,
              file_size_bytes: fileSizeBytes,
            });
          }
        } catch (recErr) {
          console.warn(
            '[QueueProcessor] Session recording error:',
            recErr instanceof Error ? recErr.message : String(recErr),
          );
        } finally {
          fs.unlink(capturedRecordingPath).catch(() => {});
        }
      }

      // Generate PDF receipt for successful submissions (fire-and-forget â€” never
      // block the queue on a receipt failure).
      if (submissionStatus === 'submitted') {
        generateReceipt({
          supabase: this.supabase,
          submission: submission as Parameters<typeof generateReceipt>[0]['submission'],
          funderName,
          orgName,
          requestProfile: (requestProfile as unknown) as Parameters<typeof generateReceipt>[0]['requestProfile'],
          confirmationData: confirmationData ?? undefined,
          screenshots: [
            ...(pageLoadPath ? [{ stage: 'page_load', path: pageLoadPath }] : []),
            ...(preFillPath ? [{ stage: 'pre_fill', path: preFillPath }] : []),
            ...(postFillPath ? [{ stage: 'post_fill', path: postFillPath }] : []),
            ...(confirmationPath ? [{ stage: 'confirmation', path: confirmationPath }] : []),
          ],
        }).catch((e: unknown) => {
          console.warn(
            '[QueueProcessor] Receipt generation failed:',
            e instanceof Error ? e.message : String(e),
          );
        });
      }

      // Record in cross-client dedup log on successful submission so other tenants
      // avoid submitting to the same domain in the next 7 days.
      if (submissionStatus === 'submitted' && funderDomain !== null) {
        await this.submissionControls.recordSubmission(funderDomain, orgId, this.supabase).catch(
          (e: unknown) => {
            console.warn(
              '[QueueProcessor] recordSubmission failed:',
              e instanceof Error ? e.message : String(e),
            );
          },
        );

        // Update funder relationship: increment total_submissions and last_submission_at.
        await this.relationshipManager.recordSubmission(
          orgId,
          funderId,
          {
            request_type: requestProfile?.request_type,
            submitted_at: new Date().toISOString(),
          },
          this.supabase,
        ).catch((e: unknown) => {
          console.warn(
            '[QueueProcessor] relationshipManager.recordSubmission failed:',
            e instanceof Error ? e.message : String(e),
          );
        });
      }

      // Webhook notifications â€” fire-and-forget, never block the queue.
      if (submissionStatus === 'submitted') {
        void this.webhookNotifier.notify({
          orgId,
          event: 'submission_completed',
          data: {
            submissionId: submissionRow.id,
            funderName,
            confirmationNumber: confirmationNumber ?? null,
            requestType: requestProfile?.request_type ?? 'monetary',
            submittedAt: new Date().toISOString(),
          },
          supabase: this.supabase,
        }).catch((e: unknown) => {
          console.warn('[QueueProcessor] webhook submission_completed:', e instanceof Error ? e.message : String(e));
        });
      } else {
        void this.webhookNotifier.notify({
          orgId,
          event: 'submission_failed',
          data: {
            submissionId: submissionRow.id,
            funderName,
            errorMessage: errorMessage ?? submissionStatus,
            status: submissionStatus,
          },
          supabase: this.supabase,
        }).catch((e: unknown) => {
          console.warn('[QueueProcessor] webhook submission_failed:', e instanceof Error ? e.message : String(e));
        });
      }

      // Error annotation â€” analyze the error screenshot with Claude and store in
      // autoapply_screenshots.metadata for faster manual triage.
      if (errorPath !== null && errorScreenshotBuffer !== null) {
        const capturedErrorPath = errorPath;
        const capturedBuffer = errorScreenshotBuffer;
        const capturedMsg = errorMessage ?? submissionStatus;
        void annotateErrorScreenshot({
          screenshotBuffer: capturedBuffer,
          errorMessage: capturedMsg,
          pageUrl: portalUrl ?? "",
        }).then((annotation) => {
          return this.supabase
            .from('autoapply_screenshots')
            .update({ metadata: { annotation } })
            .eq('storage_path', capturedErrorPath);
        }).catch((e: unknown) => {
          console.warn('[QueueProcessor] annotateErrorScreenshot:', e instanceof Error ? e.message : String(e));
        });
      }

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
        funderName,
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
   * Create an automation_sessions row and drive it straight to 'approved' for
   * this autonomous AutoApply submission. There is no per-item human review in
   * this worker â€” the risk engine already decides upstream whether a submission
   * proceeds at all (a 'manual' recommendation throws SkipError before this is
   * ever called), so this records that decision as a real, auditable session
   * rather than bypassing form-filler-agent.ts's approval check with a synthetic
   * or missing id.
   *
   * `approved_by` is deliberately left null: it's a uuid column meant for a
   * human approver's profile id (see AutomationSessionManager.approve()).
   * session-manager.ts's markAutoSubmitted() writes a non-uuid `system:<level>`
   * string into this same column for the semi_autonomous/autonomous grant-
   * automation path (src/lib/agents/browser-automation.ts) â€” that would fail
   * with an "invalid input syntax for type uuid" error if that code path ever
   * ran against this schema; noted here so the same mistake isn't repeated, not
   * fixed as part of this change since it's a separate, already-shipped file.
   * The actual "who/why" for this auto-approval goes in `notes` instead.
   */
  private async createApprovedAutomationSession(params: {
    orgId: string;
    funderId: string;
    portalUrl: string;
    queueItemId: string;
    riskAssessment: RiskAssessment | null;
  }): Promise<string> {
    const { orgId, funderId, portalUrl, queueItemId, riskAssessment } = params;

    const notes = riskAssessment
      ? `Auto-approved by the AutoApply queue worker for submission_queue item ${queueItemId} ` +
        `(risk score=${riskAssessment.score}, classification=${riskAssessment.classification}, ` +
        `recommendation=${riskAssessment.recommendation}).`
      : `Auto-approved by the AutoApply queue worker for submission_queue item ${queueItemId} ` +
        `(risk assessment unavailable).`;

    const { data, error } = await this.supabase
      .from('automation_sessions')
      .insert({
        organization_id: orgId,
        funder_id: funderId,
        target_url: portalUrl,
        session_type: 'form_fill',
        status: 'pending',
        mapped_fields: [],
        unmapped_fields: [],
        notes,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to create automation session: ${error?.message ?? 'no row returned'}`,
      );
    }

    const sessionId = (data as { id: string }).id;

    const { error: approveError } = await this.supabase
      .from('automation_sessions')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('organization_id', orgId);

    if (approveError) {
      throw new Error(
        `Failed to approve automation session ${sessionId}: ${approveError.message}`,
      );
    }

    return sessionId;
  }

  /** Close out the audit-trail session once the fill/submit attempt finishes. */
  private async finalizeAutomationSession(
    sessionId: string,
    orgId: string,
    submitted: boolean,
    confirmationNumber: string | null,
    errorMessage: string | null,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('automation_sessions')
      .update({
        status: submitted ? 'submitted' : 'failed',
        confirmation_number: submitted ? confirmationNumber : null,
        error_message: submitted ? null : errorMessage,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('organization_id', orgId);

    if (error) {
      throw new Error(`Failed to finalize automation session ${sessionId}: ${error.message}`);
    }
  }

  /**
   * After 3+ consecutive failures for the same funder, inserts (or updates) a
   * record in autoapply_review_queue so a human can investigate.
   */
  private async maybeEnqueueForReview({
    orgId,
    funderId,
    funderName,
    submissionId,
    reason,
  }: {
    orgId: string;
    funderId: string;
    funderName: string;
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
      `[QueueProcessor] Funder ${funderId} has ${failureCount} failures â€” added to review queue`,
    );

    void this.webhookNotifier.notify({
      orgId,
      event: 'review_needed',
      data: { funderId, funderName, failureCount, reason },
      supabase: this.supabase,
    }).catch((e: unknown) => {
      console.warn('[QueueProcessor] webhook review_needed:', e instanceof Error ? e.message : String(e));
    });
  }

  /**
   * Walmart-specific login path used in place of the generic
   * detect-login-or-register flow below. Requires a verified row in
   * org_portal_accounts (portal_type='walmart_sparkgood') created by
   * scripts/setup-sparkgood-account.ts; throws AccountSetupRequiredError
   * otherwise so the queue item surfaces as 'requires_account_setup' rather
   * than a generic failure.
   */
  private async handleWalmartSparkGoodLogin(
    page: any,
    orgId: string,
    funderId: string,
    portalUrl: string,
  ): Promise<void> {
    const setupMessage = 'Run pnpm setup:sparkgood to complete one-time account setup';

    const { data: portalAccount, error: portalAccountError } = await this.supabase
      .from('org_portal_accounts')
      .select('deed_verified')
      .eq('organization_id', orgId)
      .eq('portal_type', WALMART_SPARKGOOD_PORTAL_TYPE)
      .maybeSingle();

    if (portalAccountError) {
      console.warn('[QueueProcessor] org_portal_accounts lookup failed:', portalAccountError.message);
    }

    const verified =
      portalAccount !== null &&
      portalAccount !== undefined &&
      Boolean((portalAccount as { deed_verified: boolean }).deed_verified);

    if (!verified) {
      throw new AccountSetupRequiredError(setupMessage);
    }

    const existing = await this.credentialManager.getCredentials(orgId, funderId);
    if (existing === null) {
      throw new AccountSetupRequiredError(setupMessage);
    }

    const loginDetection = await this.registrationAgent.detectLoginForm(page);
    if (!loginDetection?.hasLoginForm) {
      // Already logged in (or no login gate on this page) â€” nothing to do.
      return;
    }

    const loginSuccess = await this.registrationAgent.login(page, {
      username: existing.username,
      password: existing.password,
    });
    await this.credentialManager.updateLastLogin(existing.id, loginSuccess);

    if (!loginSuccess) {
      throw new Error('account_required: stored Spark Good credentials failed');
    }

    console.log(`[QueueProcessor] Logged in to ${portalUrl} with stored Spark Good credentials`);
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
    orgProfile: OrgRow | null,
  ): Promise<void> {
    // Walmart Spark Good gates new accounts behind a Deed email verification
    // step this worker cannot clear on its own (see
    // scripts/setup-sparkgood-account.ts's doc comment). Never attempt
    // registration against this portal â€” only log in with a pre-verified
    // account, or surface that one-time setup is still needed.
    if (extractDomain(portalUrl) === 'walmart.com') {
      await this.handleWalmartSparkGoodLogin(page, orgId, funderId, portalUrl);
      return;
    }

    const loginDetection = await this.registrationAgent.detectLoginForm(page);
    if (!loginDetection?.hasLoginForm) return;

    console.log(`[QueueProcessor] Login form detected for funder ${funderId} â€” checking credentials`);

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

    // No stored credentials â€” attempt registration
    console.log(`[QueueProcessor] No credentials for funder ${funderId} â€” attempting registration`);

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
      throw new Error(`account_required: registration failed â€” ${regResult.error ?? 'unknown'}`);
    }

    if (regResult.confirmationRequired) {
      // Can't proceed until the user confirms their email â€” skip this item
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

    console.log(`[QueueProcessor] Registered on ${portalUrl} â€” logging in`);

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

export function start(supabase: SupabaseClient, workerId: string, streamServer?: StreamServer): void {
  _processor = new QueueProcessor(supabase, workerId, streamServer);
  _processor.start();
}

export function stop(): void {
  _processor?.stop();
}

export function waitForIdle(): Promise<void> {
  return _processor?.waitForIdle() ?? Promise.resolve();
}

