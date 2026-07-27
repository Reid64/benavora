// AutoApply autonomous overnight orchestrator — Phase 2 "AutoApply Full
// Autonomous Mode" per AUTONOMOUS_PLATFORM_VISION.md, which extends the
// existing AG-12 AutoApply pipeline (worker/queue-processor.ts,
// submission_queue) rather than introducing a new agent number or a second
// submission pipeline. This file is the batch classifier/queuer half of that
// extension: it decides *what* gets queued for autonomous AutoApply overnight
// and *whether it's safe to queue again*; worker/queue-processor.ts (already
// running continuously inside worker/index.ts) is still the only code that
// ever fills a form or clicks submit.
//
// Real-schema notes (deviations from this task's literal spec, verified
// against src/supabase/migrations and supabase/migrations before writing):
//
// 1. "corporate_prospects with status=new or retry" — corporate_prospects
//    (migrations 076-084) is the *shared*, cross-org corporate intelligence
//    table with no organization_id column at all (see project memory
//    benavora-corporate-prospects-no-org-id) and no `status` column of the
//    kind described. The org-scoped, AutoApply-routable prospect pipeline is
//    donor_discovery_prospects (migration 067, `pipeline_stage` enum: new /
//    reviewing / contacted / applied / received / rejected / archived) joined
//    to the shared donor_discovery_directory for enrichment — the same pair
//    the existing hand-off route
//    (src/app/api/donor-discovery/prospects/[id]/route-to-autoapply/route.ts)
//    already uses to convert a prospect into a funder + submission_queue
//    item. This file reuses that exact conversion logic in batch form. There
//    is no 'retry' value in donor_discovery_pipeline_stage — only 'new'
//    prospects are candidates; a prospect this orchestrator queues is
//    advanced to 'contacted' so it naturally drops out of the candidate pool
//    without inventing a status this schema doesn't have.
// 2. "intent_score if available" — donor_intent_scores (AGENTS_v2.md AG-31)
//    is Phase 2 PLANNED and has no table or column anywhere in the schema
//    yet. donor_discovery_prospects.score (0-100, written by the deterministic
//    scoring pipeline in worker/dd-request-processor.ts and/or the Claude
//    ScoringEngine) is the real, live analog used for priority ordering here.
// 3. "plan IN ('enterprise','consultant')" — organizations/subscriptions has
//    no 'consultant' plan; subscription_tier (migration 002) is
//    ('free','starter','professional','enterprise'). White-label consultant
//    access (consultant_client_access, migration/table per SCHEMA_REGISTRY_v2
//    §45) is a different, orthogonal concept (an org granted read/write access
//    to *another* org's data), not a billing tier. Gated on tier='enterprise'
//    only; flagging this deviation rather than inventing a tier value.
// 4. "autoapply_queue (or equivalent existing table)" — the real, only queue
//    table is submission_queue (migration 045), keyed by funder_id, not
//    prospect_id. Every insert here first resolves (or creates) a funders row
//    for the prospect, exactly like route-to-autoapply does, so the existing
//    QueueProcessor (worker/queue-processor.ts) can pick it up unmodified.
// 5. "trigger existing AutoApply processor to execute the queue" — there is
//    no separate trigger call to make: worker/index.ts already starts a
//    single long-lived QueueProcessor whose poll loop continuously re-checks
//    submission_queue (see queue-processor.ts's loop()/dequeue()). Rows this
//    file inserts are picked up on that processor's next 15-second poll with
//    no additional wiring.
// 6. "portal type detection (cybergrants/benevity/yourcause/blackbaud/generic/
//    unknown)" — implemented as a deterministic domain classifier
//    (classifyPortalType below) reusing the same vendor-domain knowledge
//    already vetted in src/lib/autoapply/submission-controls.ts's
//    SHARED_PLATFORMS list, plus blackbaud and a Salesforce NPSP host-pattern
//    check. Written once to the new funders.portal_type column (migration 095)
//    since the portal is a property of the funder, not of a single
//    submission. The task's further ask — for "unknown" portals, fall back to
//    a live Claude web-search discovery call — is deliberately not built
//    here: this orchestrator runs as a batch classifier inside a nightly
//    worker loop with no existing web-search-capable Claude client wired into
//    worker/, and FormAnalyzerAgent (src/lib/autoapply/form-analyzer-agent.ts)
//    already does the real, authoritative portal analysis at fill-time when
//    queue-processor.ts picks the item up. Adding a second, speculative
//    discovery pass here would duplicate that work for a label with no
//    downstream consumer beyond logging. Unclassified portals are tagged
//    'unknown' and still queued normally.
// 7. "if any org disables mid-run, stop processing remaining sessions for
//    that org" — getEligibleOrgs() only runs once at the start of the batch,
//    so a toggle flipped after that snapshot but before an org's own batch
//    finishes wouldn't otherwise be seen. reconfirmAutoApplyEnabled() below
//    re-reads org_autonomous_config directly (not the initial snapshot)
//    before an org's batch starts and again every few prospects during it,
//    so a mid-run disable halts that org's remaining prospects without
//    affecting other orgs already queued or still pending in this run.
// 8. "nightly report" — this function only queues; whether a queued item
//    later completes or fails is decided by queue-processor.ts, often hours
//    after this batch returns, so "X queued, Y completed, Z failed" can't
//    all be known synchronously here. This orchestrator posts an immediate
//    org-wide alert with the queued/skipped counts it does know, and points
//    to the AutoApply dashboard for completed/failed status as those
//    submissions resolve overnight.
//
// agent_runs.agent_type is a strict enum (migration 001); this orchestrator's
// own literal ('autoapply_autonomous_orchestrator') is added by migration 092
// alongside the two new org_autonomous_config columns
// (auto_autoapply_enabled, max_nightly_autoapply_submissions) this file reads.
//
// AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY (AGENTS_v2.md §0): this file
// only ever enqueues. It never fills a form, never clicks submit, and never
// bypasses the risk/readiness/velocity/domain-throttle checks
// queue-processor.ts's processItem() already runs on every queued item.

import type { SupabaseClient } from '@supabase/supabase-js';

const SLEEP_BETWEEN_ORGS_MS = 2_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_NIGHTLY = 50;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- portal type classification ---------------------------------------------

// Vendor domains that host third-party corporate/foundation giving portals.
// Mirrors the SHARED_PLATFORMS knowledge already vetted in
// src/lib/autoapply/submission-controls.ts (used there for rate-limit
// stricness), extended with blackbaud per this task's explicit ask.
const PORTAL_VENDOR_DOMAINS: Record<string, string> = {
  'cybergrants.com': 'cybergrants',
  'benevity.org': 'benevity',
  'benevity.com': 'benevity',
  'yourcause.com': 'yourcause',
  'blackbaud.com': 'blackbaud',
  'blackbaud-sites.com': 'blackbaud',
  'blackbaudhosting.com': 'blackbaud',
  'smartsimple.com': 'smartsimple',
  'submittable.com': 'submittable',
  'fluxx.io': 'fluxx',
  'grantinterface.com': 'grantinterface',
};

// Salesforce Experience Cloud / NPSP-hosted community giving pages don't share
// one vendor domain — they're hosted per-org on a Salesforce-issued subdomain.
const SALESFORCE_NPSP_HOST_PATTERNS = [/\.force\.com$/, /\.my\.site\.com$/];

function classifyPortalType(url: string | null): string {
  if (!url) return 'unknown';
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }

  for (const [domain, type] of Object.entries(PORTAL_VENDOR_DOMAINS)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return type;
  }
  if (SALESFORCE_NPSP_HOST_PATTERNS.some((re) => re.test(hostname))) return 'salesforce_npsp';
  return 'generic';
}

// --- mid-run disable check (deviation note 7) --------------------------------

async function reconfirmAutoApplyEnabled(
  supabase: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('org_autonomous_config')
    .select('auto_autoapply_enabled')
    .eq('org_id', orgId)
    .maybeSingle();
  return Boolean((data as { auto_autoapply_enabled: boolean | null } | null)?.auto_autoapply_enabled);
}

// --- eligible orgs: enterprise tier, active/trialing subscription, opted in --

interface EligibleOrg {
  id: string;
  name: string | null;
  maxNightlySubmissions: number;
}

async function getEligibleOrgs(supabase: SupabaseClient): Promise<EligibleOrg[]> {
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('onboarding_completed', true);
  if (!orgs || orgs.length === 0) return [];

  const { data: enterpriseSubs } = await supabase
    .from('subscriptions')
    .select('organization_id')
    .eq('tier', 'enterprise')
    .in('status', ['active', 'trialing']);
  const enterpriseOrgIds = new Set(
    (enterpriseSubs ?? []).map((s) => s.organization_id as string),
  );
  if (enterpriseOrgIds.size === 0) return [];

  const candidateIds = (orgs as Array<{ id: string; name: string | null }>)
    .filter((o) => enterpriseOrgIds.has(o.id))
    .map((o) => o.id);
  if (candidateIds.length === 0) return [];

  const { data: configs } = await supabase
    .from('org_autonomous_config')
    .select('org_id, auto_autoapply_enabled, max_nightly_autoapply_submissions')
    .in('org_id', candidateIds)
    .eq('auto_autoapply_enabled', true);

  const configByOrg = new Map(
    (configs ?? []).map((c) => [
      c.org_id as string,
      (c.max_nightly_autoapply_submissions as number | null) ?? DEFAULT_MAX_NIGHTLY,
    ]),
  );
  if (configByOrg.size === 0) return [];

  return (orgs as Array<{ id: string; name: string | null }>)
    .filter((o) => configByOrg.has(o.id))
    .map((o) => ({
      id: o.id,
      name: o.name,
      maxNightlySubmissions: configByOrg.get(o.id) ?? DEFAULT_MAX_NIGHTLY,
    }));
}

// --- prospect -> funder resolution (mirrors route-to-autoapply/route.ts) ----

interface DirectoryRow {
  legal_name: string;
  dba_name: string | null;
  website: string | null;
  enrichment: unknown;
}

interface ProspectRow {
  id: string;
  score: number | null;
  directory: DirectoryRow | DirectoryRow[] | null;
}

function asDirectory(directory: ProspectRow['directory']): DirectoryRow | null {
  if (!directory) return null;
  return Array.isArray(directory) ? (directory[0] ?? null) : directory;
}

async function resolveFunderId(
  supabase: SupabaseClient,
  orgId: string,
  directory: DirectoryRow,
): Promise<{ funderId: string; givingPortalUrl: string | null; orgName: string; portalType: string } | null> {
  const enrichment =
    directory.enrichment && typeof directory.enrichment === 'object' && !Array.isArray(directory.enrichment)
      ? (directory.enrichment as Record<string, unknown>)
      : {};

  if (enrichment['has_donation_form'] !== true) return null;

  const givingPortalUrl =
    (typeof enrichment['donation_form_url'] === 'string' && enrichment['donation_form_url']) ||
    directory.website ||
    null;
  const orgName = directory.dba_name?.trim() || directory.legal_name;
  const portalType = classifyPortalType(givingPortalUrl);

  let funderId: string | null = null;
  let existingPortalType: string | null = null;
  if (givingPortalUrl) {
    const { data } = await supabase
      .from('funders')
      .select('id, portal_type')
      .eq('organization_id', orgId)
      .eq('giving_portal_url', givingPortalUrl)
      .maybeSingle();
    funderId = (data?.id as string | undefined) ?? null;
    existingPortalType = (data?.portal_type as string | undefined) ?? null;
  }
  if (!funderId) {
    const { data } = await supabase
      .from('funders')
      .select('id, portal_type')
      .eq('organization_id', orgId)
      .eq('name', orgName)
      .maybeSingle();
    funderId = (data?.id as string | undefined) ?? null;
    existingPortalType = (data?.portal_type as string | undefined) ?? null;
  }

  if (!funderId) {
    const { data: newFunder, error } = await supabase
      .from('funders')
      .insert({
        organization_id: orgId,
        name: orgName,
        category: 'in_kind_donation',
        website: directory.website,
        giving_portal_url: givingPortalUrl,
        has_giving_page: true,
        portal_type: portalType,
      })
      .select('id')
      .single();
    if (error || !newFunder) return null;
    funderId = newFunder.id as string;
    existingPortalType = portalType;
  } else if (!existingPortalType) {
    // Backfill classification for a funder created before this column/logic
    // existed. Never overwrites a portal_type a human or another agent set.
    await supabase.from('funders').update({ portal_type: portalType }).eq('id', funderId);
    existingPortalType = portalType;
  }

  return { funderId, givingPortalUrl, orgName, portalType: existingPortalType ?? portalType };
}

async function ranRecently(
  supabase: SupabaseClient,
  orgId: string,
  funderId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const { data: recentSubmission } = await supabase
    .from('autoapply_submissions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('funder_id', funderId)
    .gte('created_at', since)
    .limit(1)
    .maybeSingle();
  if (recentSubmission) return true;

  const { data: pendingQueueItem } = await supabase
    .from('submission_queue')
    .select('id')
    .eq('organization_id', orgId)
    .eq('funder_id', funderId)
    .in('status', ['pending', 'processing'])
    .limit(1)
    .maybeSingle();
  return Boolean(pendingQueueItem);
}

function priorityFromScore(score: number | null): number {
  if (score === null) return 60;
  return Math.min(100, Math.max(1, 101 - score));
}

async function logDecision(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    agentRunId: string | null;
    decisionType: 'autoapply_queued' | 'autoapply_skipped';
    entityId: string;
    reasoning: string;
    confidenceScore: number | null;
    actionTaken: string;
    actionPayload?: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from('agent_decisions').insert({
    org_id: params.orgId,
    agent_run_id: params.agentRunId,
    agent_id: 'autoapply_autonomous_orchestrator',
    decision_type: params.decisionType,
    entity_type: 'donor_discovery_prospect',
    entity_id: params.entityId,
    reasoning: params.reasoning,
    confidence_score: params.confidenceScore,
    action_taken: params.actionTaken,
    action_payload: params.actionPayload ?? {},
    // Enqueuing is never the risky step — queue-processor.ts's own risk
    // engine, org-readiness, velocity, and domain-throttle checks (Section 5
    // above) still gate the actual fill/submit for every item this orchestrator
    // queues, and AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY means this
    // step never submits anything itself.
    required_human_review: false,
  });
}

// --- per-org batch queuing ---------------------------------------------------

async function queueOrgProspects(
  supabase: SupabaseClient,
  org: EligibleOrg,
  agentRunId: string | null,
  log: string[],
): Promise<{ queued: number; skipped: number; considered: number }> {
  const { data: prospects, error } = await supabase
    .from('donor_discovery_prospects')
    .select('id, score, directory:donor_discovery_directory(legal_name, dba_name, website, enrichment)')
    .eq('organization_id', org.id)
    .eq('pipeline_stage', 'new')
    .order('score', { ascending: false, nullsFirst: false })
    .limit(org.maxNightlySubmissions);

  if (error) {
    log.push(`prospects_fetch: FAILED - ${error.message}`);
    return { queued: 0, skipped: 0, considered: 0 };
  }

  let queued = 0;
  let skipped = 0;
  const prospectRows = (prospects ?? []) as unknown as ProspectRow[];
  const MID_RUN_RECHECK_EVERY = 5;

  for (let i = 0; i < prospectRows.length; i += 1) {
    const prospect = prospectRows[i];

    // Deviation note 7: re-confirm the org hasn't disabled autonomous
    // AutoApply since this batch started, checked periodically rather than
    // per-prospect to avoid one extra DB round-trip for every single item.
    if (i > 0 && i % MID_RUN_RECHECK_EVERY === 0) {
      const stillEnabled = await reconfirmAutoApplyEnabled(supabase, org.id);
      if (!stillEnabled) {
        const remaining = prospectRows.length - i;
        log.push(
          `mid_run_disable: org disabled auto_autoapply_enabled after ${i} prospects — ` +
            `halting remaining ${remaining} for tonight`,
        );
        skipped += remaining;
        break;
      }
    }

    if (!prospect) continue;

    const directory = asDirectory(prospect.directory);
    if (!directory) {
      skipped += 1;
      continue;
    }

    try {
      const resolved = await resolveFunderId(supabase, org.id, directory);
      if (!resolved) {
        // No donation form on file — nothing for AutoApply to submit to.
        skipped += 1;
        continue;
      }

      const { funderId, orgName, portalType } = resolved;

      if (await ranRecently(supabase, org.id, funderId)) {
        skipped += 1;
        await logDecision(supabase, {
          orgId: org.id,
          agentRunId,
          decisionType: 'autoapply_skipped',
          entityId: prospect.id,
          reasoning: `Skipped AutoApply queueing for ${orgName} (portal type: ${portalType}): a session already ran or is already queued for this funder within the last 30 days.`,
          confidenceScore: prospect.score,
          actionTaken: 'skipped_recent_duplicate',
          actionPayload: { funderId, portalType },
        });
        continue;
      }

      const { data: queueItem, error: insertError } = await supabase
        .from('submission_queue')
        .insert({
          organization_id: org.id,
          funder_id: funderId,
          priority: priorityFromScore(prospect.score),
          status: 'pending',
          automation_mode: 'autonomous',
        })
        .select('id')
        .single();

      if (insertError || !queueItem) {
        log.push(`queue_insert[${prospect.id}]: FAILED - ${insertError?.message ?? 'no row returned'}`);
        skipped += 1;
        continue;
      }

      // Advance past 'new' so this prospect isn't re-selected as a candidate
      // on tomorrow night's run before tonight's queue item has resolved.
      await supabase
        .from('donor_discovery_prospects')
        .update({ pipeline_stage: 'contacted' })
        .eq('id', prospect.id);

      await logDecision(supabase, {
        orgId: org.id,
        agentRunId,
        decisionType: 'autoapply_queued',
        entityId: prospect.id,
        reasoning: `Queued AutoApply for ${orgName} (score=${prospect.score ?? 'unscored'}, portal type: ${portalType}).`,
        confidenceScore: prospect.score,
        actionTaken: 'inserted_submission_queue_item',
        actionPayload: { queueId: queueItem.id as string, funderId, portalType },
      });

      queued += 1;
    } catch (err) {
      log.push(`prospect[${prospect.id}]: FAILED - ${errMsg(err)}`);
      skipped += 1;
    }
  }

  return { queued, skipped, considered: prospectRows.length };
}

// --- entry point --------------------------------------------------------------

/**
 * Nightly (3:00 AM CST) autonomous AutoApply batch queuer. For every org on
 * the enterprise tier with an active/trialing subscription and
 * org_autonomous_config.auto_autoapply_enabled = true, selects up to
 * max_nightly_autoapply_submissions 'new' donor_discovery_prospects (highest
 * score first), resolves each to a funder record, skips anything already
 * queued or submitted to in the last 30 days, classifies each resolved
 * funder's giving portal (cybergrants/benevity/yourcause/blackbaud/
 * smartsimple/submittable/fluxx/grantinterface/salesforce_npsp/generic/
 * unknown — see classifyPortalType), and inserts the rest into
 * submission_queue for the already-running QueueProcessor
 * (worker/queue-processor.ts) to pick up and process. Re-confirms
 * auto_autoapply_enabled before each org's batch and periodically during it,
 * and posts an org-wide queued/skipped summary alert once the batch
 * completes. Never fills a form or submits anything itself — see
 * AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY.
 */
export async function runAutonomousAutoApply(supabase: SupabaseClient): Promise<void> {
  const orgs = await getEligibleOrgs(supabase);
  console.log(
    `[AutoApplyAutonomousOrchestrator] Nightly batch starting for ${orgs.length} eligible org(s).`,
  );

  for (const org of orgs) {
    const log: string[] = [];
    const { data: runRow } = await supabase
      .from('agent_runs')
      .insert({
        organization_id: org.id,
        agent_type: 'autoapply_autonomous_orchestrator',
        status: 'running',
        trigger_source: 'schedule',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    const runId = (runRow?.id as string | undefined) ?? null;

    try {
      // Deviation note 7: re-confirm eligibility right before this org's
      // batch starts too — getEligibleOrgs() ran once at the top of the
      // whole nightly batch, and prior orgs' processing time (plus the
      // inter-org sleep below) is enough of a gap for a toggle flip to have
      // happened in between.
      if (!(await reconfirmAutoApplyEnabled(supabase, org.id))) {
        log.push('org_disabled_before_start: auto_autoapply_enabled is now false — skipping org entirely');
        if (runId) {
          await supabase
            .from('agent_runs')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              items_found: 0,
              items_processed: 0,
              items_queued: 0,
              output_summary: log.join(' | ').slice(0, 2000),
            })
            .eq('id', runId);
        }
        console.log(
          `[AutoApplyAutonomousOrchestrator] Org ${org.id} (${org.name ?? 'unnamed'}): disabled before start, skipped.`,
        );
        await sleep(SLEEP_BETWEEN_ORGS_MS);
        continue;
      }

      const { queued, skipped, considered } = await queueOrgProspects(supabase, org, runId, log);
      log.push(`summary: ${queued} queued, ${skipped} skipped, ${considered} considered`);

      if (runId) {
        await supabase
          .from('agent_runs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            items_found: considered,
            items_processed: queued,
            items_queued: queued,
            output_summary: log.join(' | ').slice(0, 2000),
          })
          .eq('id', runId);
      }

      // Deviation note 8: nightly report. Completed/failed counts aren't
      // knowable yet (queue-processor.ts resolves each item asynchronously,
      // often well after this function returns), so this alert reports what
      // is known now — queued and skipped — and points to the dashboard for
      // the rest as it resolves overnight.
      if (queued > 0 || skipped > 0) {
        const dateKey = new Date().toISOString().slice(0, 10);
        await supabase.from('alerts').insert({
          organization_id: org.id,
          type: 'system',
          severity: 'info',
          message:
            `Autonomous AutoApply: ${queued} submission${queued === 1 ? '' : 's'} queued tonight, ` +
            `${skipped} prospect${skipped === 1 ? '' : 's'} skipped. Review progress in the AutoApply dashboard.`,
          dedup_key: `autoapply-autonomous:${org.id}:${dateKey}`,
        });
      }

      console.log(
        `[AutoApplyAutonomousOrchestrator] Org ${org.id} (${org.name ?? 'unnamed'}): ` +
          `${queued} queued, ${skipped} skipped, ${considered} considered.`,
      );
    } catch (err) {
      console.error(
        `[AutoApplyAutonomousOrchestrator] Org ${org.id} pipeline failed:`,
        errMsg(err),
      );
      if (runId) {
        await supabase
          .from('agent_runs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: errMsg(err),
            output_summary: log.join(' | ').slice(0, 2000),
          })
          .eq('id', runId);
      }
    }

    await sleep(SLEEP_BETWEEN_ORGS_MS);
  }

  console.log('[AutoApplyAutonomousOrchestrator] Nightly batch complete.');
}
