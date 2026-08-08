// Autonomous agent orchestrator — nightly per-org pipeline + the on-demand
// agent_queue processor, both built on migration 080's schema
// (src/supabase/migrations/080_autonomous_agent_infrastructure.sql:
// autonomous_triggers, agent_queue, agent_decisions, org_autonomous_config).
//
// IMPORTANT — real vs. requested agent names:
// This file was scoped against 18 named "autonomous agent classes". Verified
// against the actual codebase, only 2 of those 18 names exist verbatim
// (DeadlinePredictionAgent, BudgetBuilderAgent). The rest either exist under
// a different name, exist as a plain function (not a BaseAgent subclass —
// deliberately: no agent_type enum value, no Claude call to meter), or don't
// exist anywhere at all. Inventing the missing ones would mean writing new
// AI agents from scratch, which is out of scope for "import the existing
// autonomous agent classes" — so this file wires in only what's real:
//
//   requested OpportunityDiscoveryAgent  -> runOpportunityDiscovery()   (fn)
//   requested ProbabilityScoringAgent    -> SuccessProbabilityAgent
//   requested DraftGenerationAgent       -> generateDraft()             (fn)
//   requested ReputationAgent            -> checkEntityReputation()     (fn)
//   requested RelationshipBuilderAgent   -> FunderRelationshipAgent     (queue-only, see below)
//   requested DeadlinePredictionAgent    -> DeadlinePredictionAgent     (exact match)
//   requested FollowupGeneratorAgent     -> FollowUpGeneratorAgent      (queue-only)
//   requested AutonomousDigestAgent      -> sendMorningDigest()         (fn)
//   requested EligibilityScoringAgent    -> EligibilityScorer
//   requested DeadlineExtractionAgent    -> DeadlineExtractor           (queue-only)
//   requested ComplianceCheckAgent       -> ComplianceChecker           (queue-only)
//   requested BudgetBuilderAgent         -> BudgetBuilderAgent          (exact match, queue-only)
//   requested RenewalTrackerAgent        -> RenewalTrackerAgent         (AG-08, exact match)
//   requested OutcomeAnalyzerAgent       -> OutcomeAnalyzerAgent        (AG-09, exact match)
//   requested DocumentExpiryAgent        -> DocumentExpiryAgent         (AG-10, exact match)
//   requested KnowledgeGapAgent          -> KnowledgeGapAgent           (AG-11, exact match)
//   requested SearchProfileOptimizerAgent-> SearchProfileOptimizerAgent (AG-12, exact match)
//   requested FitAnalysisAgent           -> exists (src/lib/agents/fit-analysis-agent.ts,
//     BaseAgent pattern) but wiring it into this orchestrator is out of scope
//     for the AG-08..AG-12 task this file was last updated for. Not wired.
//   requested AG-40 StrategicAdvisorAgent -> StrategicAdvisorAgent (AG-40, exact match)
//     src/lib/agents/strategic-advisor-agent.ts. The spec that added this
//     asked for "weekly Sunday 5:00 AM CST" — there is no such cron slot
//     anywhere in this worker (scheduler.ts fires exactly two fixed jobs:
//     2AM nightly, 7AM digest — see the module note above this one). Wired
//     into the same isSundayChicago() gate as AG-09/AG-11 below instead,
//     inside the single 2AM nightly sweep, matching how AG-08..AG-12 already
//     approximate their own monthly/weekly cadence with no dedicated cron.
//   requested AG-38 SelfImprovementAgent -> SelfImprovementAgent (AG-38, exact match)
//     src/lib/agents/self-improvement-agent.ts. Platform-wide, not per-org —
//     runs once via runSelfImprovementPipeline() below. Its own task spec
//     asked for a dedicated 4:00 AM CST slot, so unlike AG-40 above this one
//     gets a real third entry in worker/scheduler.ts's jobs array rather
//     than being folded into the 2AM sweep.
//   requested AG-29 FundabilityScorerAgent  -> FundabilityScorerAgent (AG-29, exact match)
//     src/lib/agents/fundability-scorer-agent.ts. Wired into the per-org
//     nightly sweep, unconditional (no org_autonomous_config toggle exists
//     for it, same gap as AG-08..AG-12 above).
//   requested AG-30 DonorIntentMonitorAgent -> DonorIntentMonitorAgent (AG-30, exact match)
//     src/lib/agents/donor-intent-monitor-agent.ts. Wired into the per-org
//     nightly sweep, unconditional, same as AG-29 above.
//   requested AG-35 CommunityNeedPredictorAgent -> CommunityNeedPredictorAgent (AG-35, exact match)
//     src/lib/agents/community-need-predictor-agent.ts. Its underlying data
//     sources (census/housing/eviction) update monthly per
//     AUTONOMOUS_PLATFORM_VISION.md, so it's gated on isFirstOfMonthChicago()
//     alongside the other monthly AG-08..AG-12 steps rather than run nightly.
//   requested AG-39 ROIOptimizerAgent -> RoiOptimizerAgent (AG-39, exact match)
//     src/lib/agents/roi-optimizer-agent.ts. Only its correlation-analysis
//     run() path is wired here (its trackSubmissionVariables() telemetry
//     half already has a live call site at
//     /api/autonomous/track-submission). Gated monthly (isFirstOfMonthChicago)
//     to match its own "monthly correlation-analysis pass" design.
//   requested AG-26 FundingForecastAgent -> FundingForecastAgent (AG-26, exact match)
//     src/lib/agents/funding-forecast-agent.ts. Per-org, monthly. Its spec's
//     own "Trigger Type: schedule — monthly, 1st of month, 4:00 AM CST" is
//     honored literally with a real, dedicated worker/scheduler.ts slot
//     (mirrors AG-38's precedent) rather than folded into the 2AM sweep —
//     see runFundingForecastMonthlyPipeline() below.
//   requested AG-36 LearningNetworkAggregatorAgent -> LearningNetworkAggregatorAgent (AG-36, exact match)
//     src/lib/agents/learning-network-aggregator-agent.ts. Platform-wide, not
//     per-org (constructor takes only `supabase`, same shape as AG-38) — runs
//     once via the new runLearningNetworkPipeline() below, self-gated to
//     Sunday only, wired into worker/scheduler.ts as its own daily-checked
//     cron entry (mirrors AG-38's precedent of a dedicated scheduler.ts slot
//     for a platform-level agent).
//   requested AG-37 SimulationAgent -> intentionally NOT wired here.
//     src/lib/agents/simulation-agent.ts is triggered exclusively by
//     src/app/api/reports/simulate/route.ts, which inserts its own
//     agent_queue row directly as status="processing" (never "queued") and
//     calls agent.run("manual") synchronously in the same request — its own
//     code comment states this is deliberate so the background queue
//     processor (claimNextQueueItem() below, which only claims
//     status="queued" rows) never also picks it up. Adding a nightly-sweep
//     or routeQueueItem() entry for it would either duplicate a live request
//     or never fire, so none was added.
//
// Deviation from this task's requested fixed-clock-time schedule (1:00 AM
// discovery, 1:30 eligibility, 2:00 probability, ... 6:00 learning network):
// that schedule doesn't match how this worker actually runs. There is no
// per-agent cron in this codebase — worker/scheduler.ts fires exactly a
// handful of fixed daily jobs (2AM nightly per-org sweep, 3AM AutoApply
// autonomous orchestrator, 4AM AG-38, 7AM digest), and every per-org agent
// above (including the new AG-29/AG-30/AG-35/AG-39) runs sequentially inside
// that single 2AM sweep per org, not at its own wall-clock time — exactly
// the same "single sweep, not per-agent cron" architecture this file's own
// header already documents for AG-08..AG-12 and WORKER_ARCHITECTURE_v2.md
// §11 describes. Restructuring that into eleven separate fixed-time cron
// slots would be a real architecture change with no benefit (wall-clock
// time within the sweep already scales with org count × enabled steps) and
// would contradict the documented design, so per CLAUDE.md's "if an
// ambiguity isn't covered by governance docs, don't guess" rule, the
// existing proven single-sweep pattern was kept and the new agents were
// slotted into it instead of inventing new cron infrastructure. AG-36 is the
// one exception: it's a genuinely new platform-level weekly job that doesn't
// conflict with anything, so its requested "6:00 AM, Sundays only" slot was
// honored literally.
//
// "Queue-only" agents are event-driven (e.g. FunderRelationshipAgent scores
// one specific event like "awarded" against one funder) with no meaningful
// blind nightly invocation, so they're imported and routed through
// processAgentQueue() only — never called from the per-org sweep, even when
// their config toggle is on. They're ready for other app code to enqueue a
// real event.
//
// AG-08 through AG-12 have no org_autonomous_config toggle columns (the
// config table only has the 7 original auto_*_enabled flags) and no fixed
// cron slot of their own — the worker's scheduler.ts only fires a single
// nightly 2AM job. They run inside that same nightly per-org sweep, gated on
// isAnyAutonomyEnabled() like every other step, with their monthly/weekly
// cadence approximated by checking the calendar day in America/Chicago on
// each nightly firing (isFirstOfMonthChicago / isSundayChicago below) rather
// than a real once-a-month/once-a-week cron trigger.
//
// Also corrects a doc error: WORKER_ARCHITECTURE_v2.md describes "active
// orgs" as organizations.stripe_subscription_status IN ('active','trialing')
// AND organizations.status != 'suspended'. Neither column exists anywhere in
// supabase/migrations/ or src/supabase/migrations/ — subscription status
// lives on the separate, 1:1 `subscriptions` table (migration
// 002_phases_2_5.sql), and there is no suspend flag on organizations at all.
// getActiveOrgs() below uses the real schema.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftTemplateType } from '../src/types/ai.js';
import type { FunderRelationshipEvent } from '../src/lib/agents/funder-relationship.js';

const SLEEP_BETWEEN_ORGS_MS = 2_000;
const QUEUE_POLL_EMPTY_MS = 30_000;
// Bounds Claude/API cost per org per nightly step. draft_generation uses the
// org's own max_auto_drafts_per_night instead (Contracts-style per-org cap).
const MAX_ITEMS_PER_STEP = 10;
// Reputation checks are external-search + Claude per result — the most
// expensive step per entity — so the nightly sample stays small.
const REPUTATION_SAMPLE_SIZE = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- calendar gating for the monthly/weekly-only steps -----------------------
// Mirrors worker/scheduler.ts's chicagoParts(): the worker has no per-agent
// cron, only a single fixed 2AM nightly job, so "monthly" / "weekly" agents
// gate themselves on the calendar day of that nightly firing instead.

function chicagoDateParts(now: Date): { day: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(now);
  const day = parseInt(parts.find((p) => p.type === 'day')?.value ?? '0', 10);
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return { day, weekday: weekdayMap[weekdayShort] ?? -1 };
}

function isFirstOfMonthChicago(): boolean {
  return chicagoDateParts(new Date()).day === 1;
}

function isSundayChicago(): boolean {
  return chicagoDateParts(new Date()).weekday === 0;
}

/**
 * Calendar date (YYYY-MM-DD) `addDays` days from `now`, formatted in
 * America/Chicago — used by AG-27's daily scope query (resolveBoardPacketScope)
 * against board_meetings.meeting_date, a DATE column with no time component.
 * Plain ms arithmetic on `now` before formatting is a deliberate, minor
 * approximation (not DST-exact) — acceptable here since the query only needs
 * day granularity, not an exact instant (see board-packet-agent.ts's file
 * header for the full reasoning on why this window is day-granular at all).
 */
function chicagoDateString(now: Date, addDays: number): string {
  const target = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(target);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// --- org_autonomous_config ---------------------------------------------------

interface OrgAutonomousConfig {
  auto_research_enabled: boolean;
  auto_score_enabled: boolean;
  auto_draft_enabled: boolean;
  auto_draft_threshold: number;
  auto_reputation_enabled: boolean;
  auto_relationship_enabled: boolean;
  auto_deadline_prediction_enabled: boolean;
  auto_followup_enabled: boolean;
  notify_on_auto_draft: boolean;
  notify_on_high_score: boolean;
  max_auto_drafts_per_night: number;
}

// Mirrors autonomous-base.ts's SAFE_DEFAULT_CONFIG (that const isn't
// exported, so it's duplicated here rather than modifying that file).
const SAFE_DEFAULT_CONFIG: OrgAutonomousConfig = {
  auto_research_enabled: false,
  auto_score_enabled: false,
  auto_draft_enabled: false,
  auto_draft_threshold: 70,
  auto_reputation_enabled: false,
  auto_relationship_enabled: false,
  auto_deadline_prediction_enabled: false,
  auto_followup_enabled: false,
  notify_on_auto_draft: false,
  notify_on_high_score: false,
  max_auto_drafts_per_night: 10,
};

async function getOrgConfig(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgAutonomousConfig> {
  const { data } = await supabase
    .from('org_autonomous_config')
    .select(
      'auto_research_enabled, auto_score_enabled, auto_draft_enabled, ' +
        'auto_draft_threshold, auto_reputation_enabled, auto_relationship_enabled, ' +
        'auto_deadline_prediction_enabled, auto_followup_enabled, ' +
        'notify_on_auto_draft, notify_on_high_score, max_auto_drafts_per_night',
    )
    .eq('org_id', orgId)
    .maybeSingle();

  if (!data) return SAFE_DEFAULT_CONFIG;
  return data as unknown as OrgAutonomousConfig;
}

function isAnyAutonomyEnabled(config: OrgAutonomousConfig): boolean {
  return (
    config.auto_research_enabled ||
    config.auto_score_enabled ||
    config.auto_draft_enabled ||
    config.auto_reputation_enabled ||
    config.auto_relationship_enabled ||
    config.auto_deadline_prediction_enabled ||
    config.auto_followup_enabled
  );
}

// --- active orgs --------------------------------------------------------------

interface ActiveOrg {
  id: string;
  name: string | null;
  // Only populated because getActiveOrgs() selects it below — added for
  // runDisasterResponsePipeline's state-based declaration matching (row
  // #130 "Auto-Deploy Response"); every other caller of getActiveOrgs()
  // already ignores fields it doesn't use, so this is a safe addition.
  state?: string | null;
}

async function getActiveOrgs(supabase: SupabaseClient): Promise<ActiveOrg[]> {
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, state')
    .eq('onboarding_completed', true);
  if (!orgs || orgs.length === 0) return [];

  const { data: activeSubs } = await supabase
    .from('subscriptions')
    .select('organization_id')
    .in('status', ['active', 'trialing']);
  const activeOrgIds = new Set(
    (activeSubs ?? []).map((s) => s.organization_id as string),
  );

  return (orgs as ActiveOrg[]).filter((o) => activeOrgIds.has(o.id));
}

// --- alerts helper -------------------------------------------------------------
// Real alerts schema (supabase/migrations/026_fix_alerts_schema.sql):
// type is one of deadline_due|new_opportunity|application_action|
// draft_review|system; severity is info|warning|critical; dedup_key is
// NOT NULL.

type AlertType =
  | 'deadline_due'
  | 'new_opportunity'
  | 'application_action'
  | 'draft_review'
  | 'system';
type AlertSeverity = 'info' | 'warning' | 'critical';

async function insertAlert(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    type: AlertType;
    severity: AlertSeverity;
    message: string;
    opportunityId?: string;
    applicationId?: string;
  },
): Promise<void> {
  await supabase.from('alerts').insert({
    organization_id: params.organizationId,
    type: params.type,
    severity: params.severity,
    message: params.message,
    dedup_key: `autonomous-orchestrator:${params.type}:${crypto.randomUUID()}`,
    opportunity_id: params.opportunityId ?? null,
    application_id: params.applicationId ?? null,
  });
}

// --- per-org pipeline steps -----------------------------------------------------

async function runDiscoveryStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { runOpportunityDiscovery } = await import(
      '../src/lib/agents/opportunity-discovery-agent.js'
    );
    const result = await runOpportunityDiscovery(orgId, supabase);
    log.push(`discovery: ${result.itemsFound} matched / ${result.itemsProcessed} found`);
    return result.itemsFound > 0;
  } catch (err) {
    log.push(`discovery: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runEligibilityScoringStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { EligibilityScorer } = await import(
      '../src/lib/agents/eligibility-scorer.js'
    );
    const { data: opps } = await supabase
      .from('opportunities')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'open')
      .is('eligibility_score', null)
      .limit(MAX_ITEMS_PER_STEP);

    let processed = 0;
    for (const opp of opps ?? []) {
      try {
        const agent = new EligibilityScorer({
          client: supabase,
          organizationId: orgId,
          triggeredBy: null,
        });
        await agent.run({ opportunityId: opp.id as string });
        processed += 1;
      } catch (err) {
        log.push(`eligibility_scoring[${opp.id}]: FAILED - ${errMsg(err)}`);
      }
    }
    log.push(
      `eligibility_scoring: ${processed}/${(opps ?? []).length} scored`,
    );
    return processed > 0;
  } catch (err) {
    log.push(`eligibility_scoring: FAILED to load - ${errMsg(err)}`);
    return false;
  }
}

async function runProbabilityScoringStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { SuccessProbabilityAgent } = await import(
      '../src/lib/agents/success-probability.js'
    );
    const { data: apps } = await supabase
      .from('applications')
      .select('id')
      .eq('organization_id', orgId)
      .not('stage', 'in', '(submitted,awarded,denied,reporting_required)')
      .limit(MAX_ITEMS_PER_STEP);

    let processed = 0;
    for (const app of apps ?? []) {
      try {
        const agent = new SuccessProbabilityAgent({
          client: supabase,
          organizationId: orgId,
          triggeredBy: null,
        });
        await agent.run({ applicationId: app.id as string });
        processed += 1;
      } catch (err) {
        log.push(`probability_scoring[${app.id}]: FAILED - ${errMsg(err)}`);
      }
    }
    log.push(
      `probability_scoring: ${processed}/${(apps ?? []).length} scored`,
    );
    return processed > 0;
  } catch (err) {
    log.push(`probability_scoring: FAILED to load - ${errMsg(err)}`);
    return false;
  }
}

async function runDraftGenerationStep(
  supabase: SupabaseClient,
  orgId: string,
  config: OrgAutonomousConfig,
  log: string[],
): Promise<boolean> {
  try {
    const { generateDraft } = await import('../src/lib/drafts/generator.js');
    const cap =
      config.max_auto_drafts_per_night > 0
        ? config.max_auto_drafts_per_night
        : 10;

    const { data: opps } = await supabase
      .from('opportunities')
      .select('id, name')
      .eq('organization_id', orgId)
      .eq('status', 'open')
      .gte('eligibility_score', config.auto_draft_threshold)
      .order('eligibility_score', { ascending: false })
      .limit(cap * 3);

    const oppList = opps ?? [];
    if (oppList.length === 0) {
      log.push('draft_generation: no qualifying opportunities');
      return false;
    }

    const oppIds = oppList.map((o) => o.id as string);
    const { data: existingApps } = await supabase
      .from('applications')
      .select('opportunity_id')
      .in('opportunity_id', oppIds);
    const alreadyHasApp = new Set(
      (existingApps ?? []).map((a) => a.opportunity_id as string),
    );

    const candidates = oppList
      .filter((o) => !alreadyHasApp.has(o.id as string))
      .slice(0, cap);

    let processed = 0;
    for (const opp of candidates) {
      try {
        const { data: app } = await supabase
          .from('applications')
          .insert({
            organization_id: orgId,
            opportunity_id: opp.id,
            stage: 'drafting',
            auto_generated: true,
            pending_review: true,
            draft_source: 'autonomous',
          })
          .select('id')
          .single();

        const result = await generateDraft({
          supabase,
          organizationId: orgId,
          opportunityId: opp.id as string,
          templateType: 'grant_narrative' as DraftTemplateType,
          createdByUserId: null,
          draftSource: 'autonomous',
        });

        processed += 1;

        if (config.notify_on_auto_draft) {
          await insertAlert(supabase, {
            organizationId: orgId,
            type: 'draft_review',
            severity: 'info',
            message: `Autonomous draft ready for review: "${
              (opp.name as string) ?? 'Untitled opportunity'
            }" (confidence ${result.confidenceScore}).`,
            opportunityId: opp.id as string,
            applicationId: (app?.id as string) ?? undefined,
          });
        }
      } catch (err) {
        log.push(`draft_generation[${opp.id}]: FAILED - ${errMsg(err)}`);
      }
    }
    log.push(
      `draft_generation: ${processed}/${candidates.length} drafted (${oppList.length} qualifying)`,
    );
    return processed > 0;
  } catch (err) {
    log.push(`draft_generation: FAILED to load - ${errMsg(err)}`);
    return false;
  }
}

async function runReputationStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { checkEntityReputation } = await import(
      '../src/lib/intelligence/reputation-agent.js'
    );
    const { data: funders } = await supabase
      .from('funders')
      .select('id, name')
      .eq('organization_id', orgId)
      .limit(REPUTATION_SAMPLE_SIZE);

    let signalCount = 0;
    for (const funder of funders ?? []) {
      try {
        const signals = (await checkEntityReputation(
          funder.id as string,
          'funder',
          (funder.name as string) ?? '',
          supabase,
        )) as Array<{ id: string; severity: string }>;

        for (const signal of signals) {
          await supabase.from('reputation_alerts').insert({
            org_id: orgId,
            signal_id: signal.id,
            status: 'unread',
          });
          // AGENTS_v2.md AG-18: send an immediate notice for RED/ORANGE
          // (critical/high) severity signals.
          if (signal.severity === 'critical' || signal.severity === 'high') {
            await insertAlert(supabase, {
              organizationId: orgId,
              type: 'system',
              severity: 'critical',
              message: `Reputation risk detected for funder "${
                (funder.name as string) ?? 'Unknown'
              }".`,
            });
          }
          signalCount += 1;
        }
      } catch (err) {
        log.push(`reputation[${funder.id}]: FAILED - ${errMsg(err)}`);
      }
    }
    log.push(
      `reputation: ${signalCount} signal(s) from ${(funders ?? []).length} funder(s) checked`,
    );
    return signalCount > 0;
  } catch (err) {
    log.push(`reputation: FAILED to load - ${errMsg(err)}`);
    return false;
  }
}

async function runDeadlinePredictionStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { DeadlinePredictionAgent } = await import(
      '../src/lib/agents/deadline-prediction.js'
    );
    const agent = new DeadlinePredictionAgent({
      client: supabase,
      organizationId: orgId,
      triggeredBy: null,
    });
    const outcome = await agent.run({});
    log.push(`deadline_prediction: completed (tokens=${outcome.tokensUsed})`);
    return true;
  } catch (err) {
    log.push(`deadline_prediction: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runRenewalTrackerStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { RenewalTrackerAgent } = await import(
      '../src/lib/agents/renewal-tracker-agent.js'
    );
    const agent = new RenewalTrackerAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(`renewal_tracker: ${result.itemsQueued} renewal(s) created`);
    return result.itemsQueued > 0;
  } catch (err) {
    log.push(`renewal_tracker: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runOutcomeAnalyzerStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { OutcomeAnalyzerAgent } = await import(
      '../src/lib/agents/outcome-analyzer-agent.js'
    );
    const agent = new OutcomeAnalyzerAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(`outcome_analyzer: ${result.itemsProcessed} outcome(s) analyzed`);
    return result.itemsProcessed > 0;
  } catch (err) {
    log.push(`outcome_analyzer: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runDocumentExpiryStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { DocumentExpiryAgent } = await import(
      '../src/lib/agents/document-expiry-agent.js'
    );
    const agent = new DocumentExpiryAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(`document_expiry: ${result.itemsQueued} document(s) notified`);
    return result.itemsQueued > 0;
  } catch (err) {
    log.push(`document_expiry: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runKnowledgeGapStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { KnowledgeGapAgent } = await import(
      '../src/lib/agents/knowledge-gap-agent.js'
    );
    const agent = new KnowledgeGapAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(`knowledge_gap: ${result.itemsQueued} gap(s) identified`);
    return result.itemsQueued > 0;
  } catch (err) {
    log.push(`knowledge_gap: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runSearchProfileOptimizerStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { SearchProfileOptimizerAgent } = await import(
      '../src/lib/agents/search-profile-optimizer-agent.js'
    );
    const agent = new SearchProfileOptimizerAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(
      `search_optimizer: ${result.itemsQueued} profile(s) flagged underperforming`,
    );
    return result.itemsQueued > 0;
  } catch (err) {
    log.push(`search_optimizer: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runStrategicAdvisorStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { StrategicAdvisorAgent } = await import(
      '../src/lib/agents/strategic-advisor-agent.js'
    );
    const agent = new StrategicAdvisorAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(
      `strategic_advisor: ${result.itemsProcessed} recommendation(s) generated`,
    );
    return result.itemsProcessed > 0;
  } catch (err) {
    log.push(`strategic_advisor: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runFundabilityScorerStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { FundabilityScorerAgent } = await import(
      '../src/lib/agents/fundability-scorer-agent.js'
    );
    const agent = new FundabilityScorerAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(
      `fundability_scorer: ${result.itemsProcessed}/${result.itemsFound} opportunity(ies) scored`,
    );
    return result.itemsProcessed > 0;
  } catch (err) {
    log.push(`fundability_scorer: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runDonorIntentStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { DonorIntentMonitorAgent } = await import(
      '../src/lib/agents/donor-intent-monitor-agent.js'
    );
    const agent = new DonorIntentMonitorAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(
      `donor_intent: ${result.itemsQueued} signal(s) from ${result.itemsProcessed}/${result.itemsFound} prospect(s)`,
    );
    return result.itemsQueued > 0;
  } catch (err) {
    log.push(`donor_intent: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runCommunityNeedStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { CommunityNeedPredictorAgent } = await import(
      '../src/lib/agents/community-need-predictor-agent.js'
    );
    const agent = new CommunityNeedPredictorAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(`community_need: ${result.itemsProcessed} need signal(s) recorded`);
    return result.itemsProcessed > 0;
  } catch (err) {
    log.push(`community_need: FAILED - ${errMsg(err)}`);
    return false;
  }
}

async function runRoiOptimizerStep(
  supabase: SupabaseClient,
  orgId: string,
  log: string[],
): Promise<boolean> {
  try {
    const { RoiOptimizerAgent } = await import(
      '../src/lib/agents/roi-optimizer-agent.js'
    );
    const agent = new RoiOptimizerAgent(orgId, supabase);
    const result = await agent.run('schedule');
    log.push(`roi_optimizer: ${result.itemsProcessed} insight(s) computed`);
    return result.itemsProcessed > 0;
  } catch (err) {
    log.push(`roi_optimizer: FAILED - ${errMsg(err)}`);
    return false;
  }
}

// --- per-org run -----------------------------------------------------------------

async function runOrgPipeline(
  supabase: SupabaseClient,
  org: ActiveOrg,
): Promise<boolean> {
  const config = await getOrgConfig(supabase, org.id);
  if (!isAnyAutonomyEnabled(config)) return false;

  const { data: runRow } = await supabase
    .from('agent_runs')
    .insert({
      organization_id: org.id,
      agent_type: 'autonomous_orchestrator',
      status: 'running',
      trigger_source: 'schedule',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  const runId = (runRow?.id as string | undefined) ?? null;

  const log: string[] = [];
  let hadActivity = false;

  // Order per spec: discovery -> eligibility_scoring -> probability_scoring
  // -> draft_generation -> reputation -> relationship -> deadline_prediction
  // -> renewal_tracker -> document_expiry -> knowledge_gap -> search_optimizer.
  if (config.auto_research_enabled) {
    hadActivity = (await runDiscoveryStep(supabase, org.id, log)) || hadActivity;
  }
  if (config.auto_score_enabled) {
    hadActivity =
      (await runEligibilityScoringStep(supabase, org.id, log)) || hadActivity;
    hadActivity =
      (await runProbabilityScoringStep(supabase, org.id, log)) || hadActivity;
  }
  if (config.auto_draft_enabled) {
    hadActivity =
      (await runDraftGenerationStep(supabase, org.id, config, log)) ||
      hadActivity;
  }
  if (config.auto_reputation_enabled) {
    hadActivity = (await runReputationStep(supabase, org.id, log)) || hadActivity;
  }
  // relationship (FunderRelationshipAgent): deterministic score delta for one
  // specific event against one funder — no meaningful blind nightly call.
  // Queue-routed only; see routeQueueItem() below.
  if (config.auto_deadline_prediction_enabled) {
    hadActivity =
      (await runDeadlinePredictionStep(supabase, org.id, log)) || hadActivity;
  }

  // AG-08..AG-12: no per-agent toggle or cron slot exists (see file header) —
  // all run inside this same nightly sweep, cadence approximated by calendar
  // day. document_expiry is nightly; the rest gate on the 1st of the month
  // or Sunday.
  hadActivity = (await runDocumentExpiryStep(supabase, org.id, log)) || hadActivity;
  // AG-29/AG-30: same no-toggle nightly precedent as AG-08..AG-12 above.
  hadActivity =
    (await runFundabilityScorerStep(supabase, org.id, log)) || hadActivity;
  hadActivity = (await runDonorIntentStep(supabase, org.id, log)) || hadActivity;
  if (isFirstOfMonthChicago()) {
    hadActivity =
      (await runRenewalTrackerStep(supabase, org.id, log)) || hadActivity;
    hadActivity =
      (await runSearchProfileOptimizerStep(supabase, org.id, log)) ||
      hadActivity;
    // AG-35/AG-39: monthly cadence matches their own design (Community Need's
    // underlying public data sources update monthly; ROI Optimizer's
    // correlation pass is designed as a monthly analysis run).
    hadActivity =
      (await runCommunityNeedStep(supabase, org.id, log)) || hadActivity;
    hadActivity = (await runRoiOptimizerStep(supabase, org.id, log)) || hadActivity;
  }
  if (isSundayChicago()) {
    hadActivity =
      (await runOutcomeAnalyzerStep(supabase, org.id, log)) || hadActivity;
    hadActivity =
      (await runKnowledgeGapStep(supabase, org.id, log)) || hadActivity;
    hadActivity =
      (await runStrategicAdvisorStep(supabase, org.id, log)) || hadActivity;
  }

  if (runId) {
    await supabase
      .from('agent_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        output_summary:
          log.join(' | ').slice(0, 2000) || 'No steps enabled produced output.',
      })
      .eq('id', runId);
  }

  return hadActivity;
}

/**
 * Nightly autonomous pipeline: runs the enabled steps for every active org,
 * then sends a morning digest to every org that had real activity.
 */
export async function runAutonomousPipeline(
  supabase: SupabaseClient,
): Promise<void> {
  const orgs = await getActiveOrgs(supabase);
  console.log(
    `[AutonomousOrchestrator] Nightly pipeline starting for ${orgs.length} active org(s).`,
  );

  const orgsWithActivity: ActiveOrg[] = [];

  for (const org of orgs) {
    try {
      const hadActivity = await runOrgPipeline(supabase, org);
      if (hadActivity) orgsWithActivity.push(org);
    } catch (err) {
      console.error(
        `[AutonomousOrchestrator] Org ${org.id} pipeline failed:`,
        errMsg(err),
      );
    }
    await sleep(SLEEP_BETWEEN_ORGS_MS);
  }

  console.log(
    `[AutonomousOrchestrator] ${orgsWithActivity.length}/${orgs.length} org(s) had activity; sending digests.`,
  );

  for (const org of orgsWithActivity) {
    try {
      const { sendMorningDigest } = await import(
        '../src/lib/agents/morning-digest.js'
      );
      await sendMorningDigest(org.id, supabase);
    } catch (err) {
      console.error(
        `[AutonomousOrchestrator] Digest failed for org ${org.id}:`,
        errMsg(err),
      );
    }
  }

  console.log('[AutonomousOrchestrator] Nightly pipeline complete.');
}

/**
 * Morning digest pipeline: runs AutonomousDigestAgent (an AI-written summary
 * of overnight agent_decisions activity — see
 * src/lib/agents/autonomous-digest-agent.ts) for every active org. Separate
 * from the plain sendMorningDigest() call at the end of runAutonomousPipeline
 * above, which is a no-Claude alerts rollup, not an agent_runs-logged agent.
 */
export async function runDigestPipeline(supabase: SupabaseClient): Promise<void> {
  const orgs = await getActiveOrgs(supabase);
  console.log(
    `[AutonomousOrchestrator] Morning digest pipeline starting for ${orgs.length} active org(s).`,
  );

  for (const org of orgs) {
    try {
      const { AutonomousDigestAgent } = await import(
        '../src/lib/agents/autonomous-digest-agent.js'
      );
      const agent = new AutonomousDigestAgent(org.id, supabase);
      await agent.run('schedule');
    } catch (err) {
      console.error(
        `[AutonomousOrchestrator] Digest agent failed for org ${org.id}:`,
        errMsg(err),
      );
    }
    await sleep(SLEEP_BETWEEN_ORGS_MS);
  }

  console.log('[AutonomousOrchestrator] Morning digest pipeline complete.');
}

/**
 * AG-38 Self-Improvement Agent pipeline: unlike every step above, this runs
 * ONCE at the platform level, not per-org (src/lib/agents/self-improvement-
 * agent.ts's own header explains why it doesn't extend AutonomousAgent).
 * Wired into its own fixed 4:00 AM CST scheduler slot (worker/scheduler.ts)
 * rather than folded into the 2AM per-org sweep, per this agent's explicit
 * task spec — the first agent in this worker with a dedicated cron slot of
 * its own since the original 2AM/7AM pair.
 */
export async function runSelfImprovementPipeline(
  supabase: SupabaseClient,
): Promise<void> {
  console.log('[AutonomousOrchestrator] AG-38 self-improvement pipeline starting.');
  try {
    const { SelfImprovementAgent } = await import(
      '../src/lib/agents/self-improvement-agent.js'
    );
    const agent = new SelfImprovementAgent(supabase);
    const result = await agent.run('schedule');
    console.log(
      `[AutonomousOrchestrator] AG-38 complete: ${result.itemsFound} metric row(s) calculated, ` +
        `${result.itemsProcessed} proposal(s) generated, success=${result.success}.`,
    );
  } catch (err) {
    console.error('[AutonomousOrchestrator] AG-38 self-improvement pipeline failed:', errMsg(err));
  }
}

/**
 * AG-36 Learning Network Aggregator pipeline: platform-level, not per-org
 * (src/lib/agents/learning-network-aggregator-agent.ts's constructor takes
 * only `supabase`, same shape as AG-38's SelfImprovementAgent — it
 * self-creates a synthetic SYSTEM_ORG_ID row to satisfy FK constraints since
 * it aggregates cross-org patterns rather than acting for one org). Unlike
 * every other agent in this file, this one is self-gated to Sunday only
 * (isSundayChicago()) rather than running every time its scheduler slot
 * fires — worker/scheduler.ts has no day-of-week concept, only fixed
 * hour:minute jobs that fire once per calendar day, so weekly cadence is
 * approximated the same way the per-org sweep already approximates
 * "Sunday-only" for AG-09/AG-11/AG-40 above.
 */
export async function runLearningNetworkPipeline(
  supabase: SupabaseClient,
): Promise<void> {
  if (!isSundayChicago()) {
    console.log(
      '[AutonomousOrchestrator] AG-36 learning network pipeline skipped (not Sunday, America/Chicago).',
    );
    return;
  }

  console.log('[AutonomousOrchestrator] AG-36 learning network pipeline starting.');
  try {
    const { LearningNetworkAggregatorAgent } = await import(
      '../src/lib/agents/learning-network-aggregator-agent.js'
    );
    const agent = new LearningNetworkAggregatorAgent(supabase);
    const result = await agent.run('schedule');
    console.log(
      `[AutonomousOrchestrator] AG-36 complete: ${result.itemsProcessed}/${result.itemsFound} pattern(s) aggregated, success=${result.success}.`,
    );
  } catch (err) {
    console.error('[AutonomousOrchestrator] AG-36 learning network pipeline failed:', errMsg(err));
  }
}

/**
 * AG-42 Change Monitor Agent (CM-01) pipeline: platform-level, not per-org
 * (src/lib/agents/change-monitor-agent.ts's constructor takes only
 * `supabase`, same shape as AG-36/AG-38 — it self-creates its own synthetic
 * system-org row since foundation_directory/corporate_prospects are shared,
 * cross-tenant reference data, not org-scoped). Unlike AG-36/AG-38, this
 * one is NOT day-of-week gated — it runs unconditionally every time its
 * daily 5:00 AM CST scheduler slot fires (AGENTS_v2.md AG-42 spec: "Schedule
 * only — daily... unconditional daily sweep, capped at 200 entities/run").
 */
export async function runChangeMonitorDailyPipeline(
  supabase: SupabaseClient,
): Promise<void> {
  console.log('[AutonomousOrchestrator] AG-42 change monitor daily pipeline starting.');
  try {
    const { ChangeMonitorAgent } = await import(
      '../src/lib/agents/change-monitor-agent.js'
    );
    const agent = new ChangeMonitorAgent(supabase);
    const result = await agent.run('schedule');
    console.log(
      `[AutonomousOrchestrator] AG-42 complete: ${result.itemsProcessed}/${result.itemsFound} entity(s) checked, ` +
        `success=${result.success}.`,
    );
  } catch (err) {
    console.error('[AutonomousOrchestrator] AG-42 change monitor daily pipeline failed:', errMsg(err));
  }
}

/**
 * AG-25 Disaster Response Agent — Auto-Deploy Response pipeline
 * (AGENTS_v2.md AG-25 spec; FEATURE_REGISTRY_v2.md row #130). Gives
 * pollFEMADeclarations()/deployDisasterResponse() (src/lib/agents/
 * disaster-response-agent.ts — both real, previously reachable only via the
 * manual POST/GET /api/agents/disaster route, per AGENT_VERIFICATION_LOG.md
 * rows #126/#128) their first unattended trigger.
 *
 * Platform-level for the poll step (FEMA declarations aren't org-scoped),
 * same shape as AG-36/AG-38/AG-42 above. For each newly-inserted
 * declaration this run, matches it against active orgs by
 * organizations.state overlapping the declaration's affected_states, then
 * per matched org:
 *   - org_autonomous_config.auto_deploy_disaster_response = true (explicit
 *     per-org opt-in, migration 124, default false everywhere) -> calls the
 *     real deployDisasterResponse() directly and logs an agent_decisions
 *     row with required_human_review=false.
 *   - otherwise (the default) -> logs a pending agent_decisions row
 *     (required_human_review=true, decision_type='disaster_response_deploy',
 *     action_payload.declarationId) instead of deploying. Approving that row
 *     via the existing Decision Log UI (/settings/agents) performs the real
 *     deploy — see PATCH /api/autonomous/decisions's deploy-on-approve
 *     branch. This agent never deploys unsupervised for an org that hasn't
 *     explicitly opted in.
 */
export async function runDisasterResponsePipeline(
  supabase: SupabaseClient,
): Promise<void> {
  console.log(
    '[AutonomousOrchestrator] Disaster response pipeline starting (FEMA poll).',
  );

  const { pollFEMADeclarations, deployDisasterResponse } = await import(
    '../src/lib/agents/disaster-response-agent.js'
  );

  let pollResult: { newCount: number; newDeclarationIds: string[] };
  try {
    pollResult = await pollFEMADeclarations(supabase);
  } catch (err) {
    console.error('[AutonomousOrchestrator] FEMA poll failed:', errMsg(err));
    return;
  }

  if (pollResult.newDeclarationIds.length === 0) {
    console.log(
      '[AutonomousOrchestrator] Disaster response pipeline complete — no new FEMA declarations.',
    );
    return;
  }

  console.log(
    `[AutonomousOrchestrator] ${pollResult.newDeclarationIds.length} new FEMA declaration(s) found.`,
  );

  const orgs = (await getActiveOrgs(supabase)).filter(
    (o) => typeof o.state === 'string' && o.state.trim() !== '',
  );

  for (const declarationId of pollResult.newDeclarationIds) {
    const { data: declaration } = await supabase
      .from('disaster_declarations')
      .select('id, fema_disaster_number, disaster_type, incident_type, affected_states')
      .eq('id', declarationId)
      .single();

    const affectedStatesRaw = (declaration?.affected_states ?? null) as
      | string[]
      | null;
    if (!declaration || !affectedStatesRaw || affectedStatesRaw.length === 0) {
      continue;
    }
    const affectedStates = affectedStatesRaw.map((s) => s.trim().toUpperCase());

    const matchedOrgs = orgs.filter((o) =>
      affectedStates.includes(String(o.state).trim().toUpperCase()),
    );

    for (const org of matchedOrgs) {
      try {
        const { data: cfg } = await supabase
          .from('org_autonomous_config')
          .select('auto_deploy_disaster_response')
          .eq('org_id', org.id)
          .maybeSingle();
        const autoDeployEnabled = cfg?.auto_deploy_disaster_response === true;

        const reasoning =
          `FEMA declaration ${declaration.fema_disaster_number} ` +
          `(${declaration.disaster_type ?? declaration.incident_type ?? 'disaster'}) ` +
          `affects ${affectedStates.join(', ')}, matching org ${org.name ?? org.id}'s service state.`;

        if (autoDeployEnabled) {
          const result = await deployDisasterResponse(declarationId, org.id, supabase);
          await supabase.from('agent_decisions').insert({
            org_id: org.id,
            agent_id: 'ag-25-disaster-response',
            decision_type: 'disaster_response_deploy',
            entity_type: 'disaster_declaration',
            entity_id: declarationId,
            reasoning,
            confidence_score: 85,
            action_taken: 'deployed_automatically',
            action_payload: {
              declarationId,
              femaDisasterNumber: declaration.fema_disaster_number,
              affectedStates,
              deployment_result: result,
            },
            required_human_review: false,
          });
          console.log(
            `[AutonomousOrchestrator] Auto-deployed disaster response for org ${org.id}, declaration ${declarationId}.`,
          );
        } else {
          await supabase.from('agent_decisions').insert({
            org_id: org.id,
            agent_id: 'ag-25-disaster-response',
            decision_type: 'disaster_response_deploy',
            entity_type: 'disaster_declaration',
            entity_id: declarationId,
            reasoning,
            confidence_score: 85,
            action_taken: 'pending_approval',
            action_payload: {
              declarationId,
              femaDisasterNumber: declaration.fema_disaster_number,
              affectedStates,
            },
            required_human_review: true,
          });
          console.log(
            `[AutonomousOrchestrator] Queued disaster response approval for org ${org.id}, declaration ${declarationId}.`,
          );
        }
      } catch (err) {
        console.error(
          `[AutonomousOrchestrator] Disaster response step failed for org ${org.id}, declaration ${declarationId}:`,
          errMsg(err),
        );
      }
    }
  }

  console.log('[AutonomousOrchestrator] Disaster response pipeline complete.');
}

/**
 * AG-10 Grant DNA Analysis Agent weekly pipeline: unlike AG-36/AG-38 (which
 * are platform-level, not per-org), AG-10's output (funder_dna_profiles) is
 * scoped per (organization_id, funder_id) — so this iterates every active
 * org and runs GrantDnaAgent's 'schedule' scope (every funder with new
 * opportunities since last analysis, capped at MAX_FUNDERS_PER_SCHEDULED_RUN)
 * for each. Self-gated to Sunday only (isSundayChicago()), same
 * approximation of weekly cadence as the AG-36 pipeline above —
 * worker/scheduler.ts has no day-of-week concept, only fixed hour:minute
 * jobs that fire once per calendar day.
 */
export async function runGrantDnaWeeklyPipeline(
  supabase: SupabaseClient,
): Promise<void> {
  if (!isSundayChicago()) {
    console.log(
      '[AutonomousOrchestrator] AG-10 grant DNA weekly pipeline skipped (not Sunday, America/Chicago).',
    );
    return;
  }

  const orgs = await getActiveOrgs(supabase);
  console.log(
    `[AutonomousOrchestrator] AG-10 grant DNA weekly pipeline starting for ${orgs.length} active org(s).`,
  );

  const { GrantDnaAgent } = await import('../src/lib/agents/grant-dna-agent.js');

  for (const org of orgs) {
    try {
      const agent = new GrantDnaAgent(org.id, supabase);
      const result = await agent.run('schedule');
      console.log(
        `[AutonomousOrchestrator] AG-10 org ${org.id} complete: ${result.itemsProcessed}/${result.itemsFound} profile(s) updated, success=${result.success}.`,
      );
    } catch (err) {
      console.error(
        `[AutonomousOrchestrator] AG-10 grant DNA pipeline failed for org ${org.id}:`,
        errMsg(err),
      );
    }
    await sleep(SLEEP_BETWEEN_ORGS_MS);
  }

  console.log('[AutonomousOrchestrator] AG-10 grant DNA weekly pipeline complete.');
}

/**
 * AG-26 Funding Forecast Agent monthly pipeline: per AGENTS_v2.md's AG-26
 * spec ("Trigger Type: schedule — monthly, 1st of month, 4:00 AM CST...
 * Trigger Condition: all orgs, unconditionally"). Unlike AG-10/AG-36 (Sunday
 * -gated), this self-gates on isFirstOfMonthChicago() — worker/scheduler.ts
 * has no month-of-year concept, only fixed hour:minute jobs that fire once
 * per calendar day, so monthly cadence is approximated the same way this
 * file's own isFirstOfMonthChicago() already approximates it for the
 * AG-08..AG-12/AG-35/AG-39 steps folded into the 2AM sweep — the difference
 * here is AG-26 gets its own dedicated 4:00 AM scheduler.ts slot (spec's
 * explicit fixed clock time) rather than sharing the 2AM per-org sweep.
 * Runs unconditionally for every active org — a zero-opportunity org still
 * gets an honest $0 forecast, per the spec's own step 2 branch a.
 */
export async function runFundingForecastMonthlyPipeline(
  supabase: SupabaseClient,
): Promise<void> {
  if (!isFirstOfMonthChicago()) {
    console.log(
      '[AutonomousOrchestrator] AG-26 funding forecast monthly pipeline skipped (not the 1st of the month, America/Chicago).',
    );
    return;
  }

  const orgs = await getActiveOrgs(supabase);
  console.log(
    `[AutonomousOrchestrator] AG-26 funding forecast monthly pipeline starting for ${orgs.length} active org(s).`,
  );

  const { FundingForecastAgent } = await import(
    '../src/lib/agents/funding-forecast-agent.js'
  );

  for (const org of orgs) {
    try {
      const agent = new FundingForecastAgent(org.id, supabase);
      const result = await agent.run('schedule');
      console.log(
        `[AutonomousOrchestrator] AG-26 org ${org.id} complete: ${result.itemsProcessed} row-set(s) written, success=${result.success}.`,
      );
    } catch (err) {
      console.error(
        `[AutonomousOrchestrator] AG-26 funding forecast pipeline failed for org ${org.id}:`,
        errMsg(err),
      );
    }
    await sleep(SLEEP_BETWEEN_ORGS_MS);
  }

  console.log('[AutonomousOrchestrator] AG-26 funding forecast monthly pipeline complete.');
}

// Per-org cap on how many incremental board-member candidates get processed
// in a single daily pass — mirrors AG-10's MAX_FUNDERS_PER_SCHEDULED_RUN
// design (a bounded scheduled run regardless of platform growth; any
// remaining candidates roll to the next day's run rather than growing one
// run unboundedly). Board rosters change rarely, so this should rarely bind
// in practice — it exists as a safety cap, not a tuned throughput target.
const MAX_BOARD_MEMBERS_PER_INCREMENTAL_RUN = 25;

interface IncrementalBoardMemberCandidate {
  id: string;
  organization_id: string;
}

/**
 * Resolves AG-23's incremental scope query (AGENTS_v2.md §5, AG-23 spec):
 * "board member with no pig_nodes row yet, or updated since their existing
 * node". Implemented client-side (fetch both sides, diff in JS) rather than
 * a single SQL NOT EXISTS/LEFT JOIN, since supabase-js has no join syntax
 * for this shape and every other cross-table diff in this codebase's agents
 * (e.g. relationship-graph-builder-agent.ts's own rules 5-8) already uses
 * this same fetch-then-filter pattern.
 *
 * Scoped to `activeOrgIds` (onboarding_completed + active/trialing
 * subscription, per getActiveOrgs() — the same scoping every other per-org
 * nightly step in this file already applies) so this never processes a
 * board member belonging to an inactive or unonboarded org.
 *
 * Returns candidates grouped by org — one entry in the returned map per org
 * that has at least one board member needing processing. An org with zero
 * candidates is simply absent from the map (not an empty array), so the
 * caller only invokes the agent for orgs that actually have real work.
 */
async function resolveIncrementalBoardMemberScope(
  supabase: SupabaseClient,
  activeOrgIds: Set<string>,
): Promise<Map<string, string[]>> {
  const { data: boardRows, error: boardError } = await supabase
    .from('board_members')
    .select('id, organization_id, updated_at')
    .eq('is_active', true);

  if (boardError || !boardRows || boardRows.length === 0) {
    if (boardError) {
      console.error(
        '[AutonomousOrchestrator] AG-23 scope resolution failed to load board_members:',
        boardError.message,
      );
    }
    return new Map();
  }

  const { data: nodeRows, error: nodeError } = await supabase
    .from('pig_nodes')
    .select('entity_id, updated_at')
    .eq('entity_table', 'board_members');

  if (nodeError) {
    console.error(
      '[AutonomousOrchestrator] AG-23 scope resolution failed to load pig_nodes:',
      nodeError.message,
    );
    return new Map();
  }

  const nodeUpdatedAtByEntityId = new Map<string, string>(
    (nodeRows ?? []).map((n) => [n.entity_id as string, n.updated_at as string]),
  );

  const candidates: IncrementalBoardMemberCandidate[] = [];
  for (const member of boardRows as Array<{
    id: string;
    organization_id: string;
    updated_at: string;
  }>) {
    if (!activeOrgIds.has(member.organization_id)) continue;

    const nodeUpdatedAt = nodeUpdatedAtByEntityId.get(member.id);
    const needsProcessing =
      !nodeUpdatedAt || new Date(member.updated_at) > new Date(nodeUpdatedAt);
    if (needsProcessing) {
      candidates.push({ id: member.id, organization_id: member.organization_id });
    }
  }

  const byOrg = new Map<string, string[]>();
  for (const candidate of candidates) {
    const existing = byOrg.get(candidate.organization_id);
    if (existing) {
      if (existing.length < MAX_BOARD_MEMBERS_PER_INCREMENTAL_RUN) {
        existing.push(candidate.id);
      }
    } else {
      byOrg.set(candidate.organization_id, [candidate.id]);
    }
  }
  return byOrg;
}

/**
 * AG-23/AG-32 Relationship Mapper — daily incremental pipeline
 * (AGENTS_v2.md §5, AG-23 spec). Resolves resolveIncrementalBoardMemberScope()
 * above, then runs RelationshipGraphBuilderAgent (the real AG-32
 * implementation AG-23's own spec identifies as this capability — see that
 * file's header) once per org that has at least one candidate, scoped to
 * just those board member ids via the new optional run() parameter. Org-
 * level rules 5-8 and the corporate_intent_signals seed still run every
 * time the agent runs for an org, per the agent's own design — only the
 * Claude+web-search board-member connection discovery (rules 1-4) is scoped
 * incrementally.
 *
 * Unlike AG-10/AG-36 above, this is NOT gated to a single day of the week —
 * AG-23's spec calls for a daily sweep specifically because it's
 * incremental (only orgs/board-members with real new signal do any work),
 * not a periodic full rebuild.
 */
export async function runRelationshipGraphIncrementalPipeline(
  supabase: SupabaseClient,
): Promise<void> {
  const activeOrgs = await getActiveOrgs(supabase);
  const activeOrgIds = new Set(activeOrgs.map((o) => o.id));

  const scopeByOrg = await resolveIncrementalBoardMemberScope(supabase, activeOrgIds);
  if (scopeByOrg.size === 0) {
    console.log(
      '[AutonomousOrchestrator] AG-23 relationship graph incremental pipeline: no board members need processing today.',
    );
    return;
  }

  console.log(
    `[AutonomousOrchestrator] AG-23 relationship graph incremental pipeline starting for ${scopeByOrg.size} org(s).`,
  );

  const { RelationshipGraphBuilderAgent } = await import(
    '../src/lib/agents/relationship-graph-builder-agent.js'
  );

  for (const [orgId, boardMemberIds] of scopeByOrg) {
    try {
      const agent = new RelationshipGraphBuilderAgent(orgId, supabase);
      const result = await agent.run('schedule', boardMemberIds);
      console.log(
        `[AutonomousOrchestrator] AG-23 org ${orgId} complete: ${boardMemberIds.length} board member(s) scoped, ` +
          `${result.itemsProcessed}/${result.itemsFound} item(s) processed, success=${result.success}.`,
      );
    } catch (err) {
      console.error(
        `[AutonomousOrchestrator] AG-23 relationship graph incremental pipeline failed for org ${orgId}:`,
        errMsg(err),
      );
    }
    await sleep(SLEEP_BETWEEN_ORGS_MS);
  }

  console.log('[AutonomousOrchestrator] AG-23 relationship graph incremental pipeline complete.');
}

/**
 * Resolves AG-27's daily schedule scope (AGENTS_v2.md §5, AG-27 spec):
 * board_meetings with status='scheduled', meeting_date within
 * [today, today+2 days] (America/Chicago, inclusive — see
 * board-packet-agent.ts's file header for why this is a widened window
 * rather than the spec's literal "exactly 47-49 hours out"), and no
 * board_meeting_packets row yet for meeting_id. Fetch-then-filter (not a
 * single SQL join), matching every other cross-table scope query already
 * established in this file (resolveIncrementalBoardMemberScope above).
 *
 * Scoped to `activeOrgIds` (onboarding_completed + active/trialing
 * subscription, per getActiveOrgs()) so this never processes a meeting
 * belonging to an inactive or unonboarded org.
 *
 * Returns meeting ids grouped by org — an org with zero candidates is
 * simply absent from the map, so the caller only invokes the agent for
 * orgs that actually have a meeting due a packet.
 */
async function resolveBoardPacketScope(
  supabase: SupabaseClient,
  activeOrgIds: Set<string>,
): Promise<Map<string, string[]>> {
  const todayStr = chicagoDateString(new Date(), 0);
  const windowEndStr = chicagoDateString(new Date(), 2);

  const { data: meetingRows, error: meetingError } = await supabase
    .from('board_meetings')
    .select('id, org_id')
    .eq('status', 'scheduled')
    .gte('meeting_date', todayStr)
    .lte('meeting_date', windowEndStr);

  if (meetingError || !meetingRows || meetingRows.length === 0) {
    if (meetingError) {
      console.error(
        '[AutonomousOrchestrator] AG-27 scope resolution failed to load board_meetings:',
        meetingError.message,
      );
    }
    return new Map();
  }

  const scoped = (meetingRows as { id: string; org_id: string }[]).filter((m) =>
    activeOrgIds.has(m.org_id),
  );
  if (scoped.length === 0) return new Map();

  const meetingIds = scoped.map((m) => m.id);
  const { data: packetRows, error: packetError } = await supabase
    .from('board_meeting_packets')
    .select('meeting_id')
    .in('meeting_id', meetingIds);

  if (packetError) {
    console.error(
      '[AutonomousOrchestrator] AG-27 scope resolution failed to load board_meeting_packets:',
      packetError.message,
    );
    return new Map();
  }

  const alreadyPacketed = new Set(
    (packetRows ?? [])
      .map((p) => p.meeting_id as string | null)
      .filter((id): id is string => typeof id === 'string'),
  );

  const byOrg = new Map<string, string[]>();
  for (const m of scoped) {
    if (alreadyPacketed.has(m.id)) continue;
    const existing = byOrg.get(m.org_id);
    if (existing) existing.push(m.id);
    else byOrg.set(m.org_id, [m.id]);
  }
  return byOrg;
}

/**
 * AG-27 Board Meeting Packet Agent — daily schedule pipeline (AGENTS_v2.md
 * §5, AG-27 spec). Resolves resolveBoardPacketScope() above, then runs
 * BoardPacketAgent once per org that has ≥1 meeting due a packet, scoped to
 * just those meeting ids via run()'s optional meetingIds parameter — same
 * convention as runRelationshipGraphIncrementalPipeline (AG-23) above.
 *
 * Not gated to a single day of the week — unlike AG-10/AG-36, a board
 * meeting's 48-hour lead time genuinely needs a daily check, not a periodic
 * sweep.
 */
export async function runBoardPacketDailyPipeline(
  supabase: SupabaseClient,
): Promise<void> {
  const activeOrgs = await getActiveOrgs(supabase);
  const activeOrgIds = new Set(activeOrgs.map((o) => o.id));

  const scopeByOrg = await resolveBoardPacketScope(supabase, activeOrgIds);
  if (scopeByOrg.size === 0) {
    console.log(
      '[AutonomousOrchestrator] AG-27 board packet daily pipeline: no meetings need a packet today.',
    );
    return;
  }

  console.log(
    `[AutonomousOrchestrator] AG-27 board packet daily pipeline starting for ${scopeByOrg.size} org(s).`,
  );

  const { BoardPacketAgent } = await import(
    '../src/lib/agents/board-packet-agent.js'
  );

  for (const [orgId, meetingIds] of scopeByOrg) {
    try {
      const agent = new BoardPacketAgent(orgId, supabase);
      const result = await agent.run('schedule', meetingIds);
      console.log(
        `[AutonomousOrchestrator] AG-27 org ${orgId} complete: ${meetingIds.length} meeting(s) scoped, ` +
          `${result.itemsProcessed}/${result.itemsFound} packet(s) written, success=${result.success}.`,
      );
    } catch (err) {
      console.error(
        `[AutonomousOrchestrator] AG-27 board packet daily pipeline failed for org ${orgId}:`,
        errMsg(err),
      );
    }
    await sleep(SLEEP_BETWEEN_ORGS_MS);
  }

  console.log('[AutonomousOrchestrator] AG-27 board packet daily pipeline complete.');
}

// --- agent_queue processor --------------------------------------------------------

interface AgentQueueRow {
  id: string;
  org_id: string;
  agent_id: string;
  input_payload: Record<string, unknown> | null;
  retry_count: number;
  max_retries: number;
}

function requireString(
  payload: Record<string, unknown> | null,
  key: string,
): string {
  const value = payload?.[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `agent_queue input_payload.${key} is required and must be a non-empty string.`,
    );
  }
  return value;
}

/** Routes one claimed agent_queue row to the matching real agent/function. */
async function routeQueueItem(
  supabase: SupabaseClient,
  item: AgentQueueRow,
): Promise<string> {
  const orgId = item.org_id;
  const payload = item.input_payload;

  switch (item.agent_id) {
    case 'opportunity_discovery': {
      const { runOpportunityDiscovery } = await import(
        '../src/lib/agents/opportunity-discovery-agent.js'
      );
      const result = await runOpportunityDiscovery(orgId, supabase);
      return `discovery: ${result.itemsFound} matched / ${result.itemsProcessed} found`;
    }
    case 'eligibility_scoring': {
      const { EligibilityScorer } = await import(
        '../src/lib/agents/eligibility-scorer.js'
      );
      const agent = new EligibilityScorer({
        client: supabase,
        organizationId: orgId,
        triggeredBy: null,
      });
      const outcome = await agent.run({
        opportunityId: requireString(payload, 'opportunityId'),
      });
      return `eligibility_scoring completed (tokens=${outcome.tokensUsed})`;
    }
    case 'success_probability': {
      const { SuccessProbabilityAgent } = await import(
        '../src/lib/agents/success-probability.js'
      );
      const agent = new SuccessProbabilityAgent({
        client: supabase,
        organizationId: orgId,
        triggeredBy: null,
      });
      const outcome = await agent.run({
        applicationId: requireString(payload, 'applicationId'),
      });
      return `success_probability completed (tokens=${outcome.tokensUsed})`;
    }
    case 'deadline_extraction': {
      const { DeadlineExtractor } = await import(
        '../src/lib/agents/deadline-extractor.js'
      );
      const agent = new DeadlineExtractor({
        client: supabase,
        organizationId: orgId,
        triggeredBy: null,
      });
      const outcome = await agent.run({
        opportunityId: requireString(payload, 'opportunityId'),
      });
      return `deadline_extraction completed (tokens=${outcome.tokensUsed})`;
    }
    case 'compliance_check': {
      const { ComplianceChecker } = await import(
        '../src/lib/agents/compliance-checker.js'
      );
      const agent = new ComplianceChecker({
        client: supabase,
        organizationId: orgId,
        triggeredBy: null,
      });
      const outcome = await agent.run({
        applicationId: requireString(payload, 'applicationId'),
      });
      return `compliance_check completed (tokens=${outcome.tokensUsed})`;
    }
    case 'budget_builder': {
      const { BudgetBuilderAgent } = await import(
        '../src/lib/agents/budget-builder.js'
      );
      const agent = new BudgetBuilderAgent({
        client: supabase,
        organizationId: orgId,
        triggeredBy: null,
      });
      const outcome = await agent.run({
        opportunityId: requireString(payload, 'opportunityId'),
        applicationId:
          typeof payload?.['applicationId'] === 'string'
            ? (payload['applicationId'] as string)
            : undefined,
        requestedAmount:
          typeof payload?.['requestedAmount'] === 'number'
            ? (payload['requestedAmount'] as number)
            : undefined,
      });
      return `budget_builder completed (tokens=${outcome.tokensUsed})`;
    }
    case 'follow_up_generator': {
      const { FollowUpGeneratorAgent } = await import(
        '../src/lib/agents/follow-up-generator.js'
      );
      const agent = new FollowUpGeneratorAgent({
        client: supabase,
        organizationId: orgId,
        triggeredBy: null,
      });
      const outcome = await agent.run({
        applicationId: requireString(payload, 'applicationId'),
      });
      return `follow_up_generator completed (tokens=${outcome.tokensUsed})`;
    }
    case 'funder_relationship': {
      const { FunderRelationshipAgent } = await import(
        '../src/lib/agents/funder-relationship.js'
      );
      const agent = new FunderRelationshipAgent({
        client: supabase,
        organizationId: orgId,
        triggeredBy: null,
      });
      const outcome = await agent.run({
        funderId: requireString(payload, 'funderId'),
        event: requireString(payload, 'event') as FunderRelationshipEvent,
      });
      return `funder_relationship completed (tokens=${outcome.tokensUsed})`;
    }
    case 'deadline_prediction': {
      const { DeadlinePredictionAgent } = await import(
        '../src/lib/agents/deadline-prediction.js'
      );
      const agent = new DeadlinePredictionAgent({
        client: supabase,
        organizationId: orgId,
        triggeredBy: null,
      });
      const outcome = await agent.run({
        category:
          typeof payload?.['category'] === 'string'
            ? (payload['category'] as string)
            : undefined,
        daysAhead:
          typeof payload?.['daysAhead'] === 'number'
            ? (payload['daysAhead'] as number)
            : undefined,
      });
      return `deadline_prediction completed (tokens=${outcome.tokensUsed})`;
    }
    case 'draft_generation': {
      const { generateDraft } = await import('../src/lib/drafts/generator.js');
      const result = await generateDraft({
        supabase,
        organizationId: orgId,
        opportunityId: requireString(payload, 'opportunityId'),
        templateType: (typeof payload?.['templateType'] === 'string'
          ? payload['templateType']
          : 'grant_narrative') as DraftTemplateType,
        createdByUserId:
          typeof payload?.['createdByUserId'] === 'string'
            ? (payload['createdByUserId'] as string)
            : null,
        draftSource: 'autonomous',
      });
      return `draft_generation completed (confidence=${result.confidenceScore})`;
    }
    case 'reputation': {
      const entityType = requireString(payload, 'entityType');
      const entityId = requireString(payload, 'entityId');
      const entityName = requireString(payload, 'entityName');

      // Funders route through ReputationIntelligenceAgent's single-entity
      // entry point so this path gets the same reputation_alerts row +
      // agent_decisions entry + CRITICAL notification + HIGH/CRITICAL
      // relationship_memory write the nightly org-wide sweep produces —
      // not just the bare signal detection the plain checkEntityReputation()
      // call below provides. Other entity types (none currently enqueue this
      // case) fall back to the plain, unscoped check.
      if (entityType === 'funder') {
        const { ReputationIntelligenceAgent } = await import(
          '../src/lib/intelligence/reputation-agent.js'
        );
        const agent = new ReputationIntelligenceAgent(orgId, supabase);
        const result = await agent.runForFunder(entityId, entityName, 'event');
        return `reputation completed (${result.itemsProcessed} signal(s), ${result.itemsQueued} alert(s))`;
      }

      const { checkEntityReputation } = await import(
        '../src/lib/intelligence/reputation-agent.js'
      );
      const signals = await checkEntityReputation(
        entityId,
        entityType,
        entityName,
        supabase,
      );
      return `reputation completed (${signals.length} signal(s))`;
    }
    case 'morning_digest': {
      const { sendMorningDigest } = await import(
        '../src/lib/agents/morning-digest.js'
      );
      await sendMorningDigest(orgId, supabase);
      return 'morning_digest completed';
    }
    case 'ag-28-followup': {
      // AG-28, src/lib/agents/followup-generator-agent.ts - event-driven off
      // a pipeline stage transition (/api/autonomous/followup-trigger).
      // Distinct from the 'follow_up_generator' case above.
      const { FollowupGeneratorAgent } = await import(
        '../src/lib/agents/followup-generator-agent.js'
      );
      const agent = new FollowupGeneratorAgent(orgId, supabase);
      const result = await agent.run('event');
      return `ag-28-followup completed (itemsQueued=${result.itemsQueued})`;
    }
    case 'ag-17-discovery': {
      // Same self-identifying agentId OpportunityDiscoveryAgent passes to
      // super() (src/lib/agents/opportunity-discovery-agent.ts) — alias of
      // the 'opportunity_discovery' case above, same underlying call, so a
      // manual trigger by the class's own agent_type literal also works.
      const { runOpportunityDiscovery } = await import(
        '../src/lib/agents/opportunity-discovery-agent.js'
      );
      const result = await runOpportunityDiscovery(orgId, supabase, 'manual');
      return `discovery: ${result.itemsProcessed} matched / ${result.itemsFound} found`;
    }
    case 'ag-15-probability': {
      // AG-15 (canonical), src/lib/agents/probability-scoring-agent.ts —
      // opportunity-level grant probability scoring (computeGrantProbability
      // wrapper) + auto-draft chaining. Distinct from 'success_probability'
      // above (application-keyed, SuccessProbabilityAgent) — see
      // AGENTS_v2.md AG-15 spec. Previously unreachable from any live path.
      const { ProbabilityScoringAgent } = await import(
        '../src/lib/agents/probability-scoring-agent.js'
      );
      const agent = new ProbabilityScoringAgent(orgId, supabase);
      const result = await agent.run('manual');
      return `ag-15-probability completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-29-fundability': {
      // Also wired into the nightly per-org sweep and reachable manually via
      // /api/intelligence/fundability — added here too so a manual trigger
      // by this agent's own agentId literal works like every other agent.
      const { FundabilityScorerAgent } = await import(
        '../src/lib/agents/fundability-scorer-agent.js'
      );
      const agent = new FundabilityScorerAgent(orgId, supabase);
      const result = await agent.run('manual');
      return `ag-29-fundability completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-30-donor-intent': {
      const { DonorIntentMonitorAgent } = await import(
        '../src/lib/agents/donor-intent-monitor-agent.js'
      );
      const agent = new DonorIntentMonitorAgent(orgId, supabase);
      const result = await agent.run('manual');
      return `ag-30-donor-intent completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-35-community-need': {
      const { CommunityNeedPredictorAgent } = await import(
        '../src/lib/agents/community-need-predictor-agent.js'
      );
      const agent = new CommunityNeedPredictorAgent(orgId, supabase);
      const result = await agent.run('manual');
      return `ag-35-community-need completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-36-learning-network': {
      // Platform-wide, not per-org (constructor takes only `supabase`, same
      // shape as ag-38-self-improvement below) — item.org_id is ignored.
      // Already wired to a Sunday-gated schedule via
      // runLearningNetworkPipeline(); this adds an on-demand path.
      const { LearningNetworkAggregatorAgent } = await import(
        '../src/lib/agents/learning-network-aggregator-agent.js'
      );
      const agent = new LearningNetworkAggregatorAgent(supabase);
      const result = await agent.run('manual');
      return `ag-36-learning-network completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-38-self-improvement': {
      // Platform-wide, not per-org — item.org_id is ignored. Already wired
      // to its own 4AM scheduler.ts slot via runSelfImprovementPipeline();
      // this adds an on-demand path.
      const { SelfImprovementAgent } = await import(
        '../src/lib/agents/self-improvement-agent.js'
      );
      const agent = new SelfImprovementAgent(supabase);
      const result = await agent.run('manual');
      return `ag-38-self-improvement completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-39-roi-optimizer': {
      // Correlation-analysis run() path only — trackSubmissionVariables()
      // telemetry half has its own live call site at
      // /api/autonomous/track-submission and is unaffected by this case.
      const { RoiOptimizerAgent } = await import(
        '../src/lib/agents/roi-optimizer-agent.js'
      );
      const agent = new RoiOptimizerAgent(orgId, supabase);
      const result = await agent.run('manual');
      return `ag-39-roi-optimizer completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-40-strategic-advisor': {
      // Also wired into the nightly per-org sweep and reachable manually via
      // /api/intelligence/strategic-advisor — added here too for consistency.
      const { StrategicAdvisorAgent } = await import(
        '../src/lib/agents/strategic-advisor-agent.js'
      );
      const agent = new StrategicAdvisorAgent(orgId, supabase);
      const result = await agent.run('manual');
      return `ag-40-strategic-advisor completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-digest': {
      // Already wired to the fixed 7AM digest pipeline
      // (runDigestPipeline()); this adds an on-demand path.
      const { AutonomousDigestAgent } = await import(
        '../src/lib/agents/autonomous-digest-agent.js'
      );
      const agent = new AutonomousDigestAgent(orgId, supabase);
      const result = await agent.run('manual');
      return `ag-digest completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-10-grant-dna': {
      // AG-10, src/lib/agents/grant-dna-agent.ts — event-driven off a new
      // `outcomes` insert (POST /api/autonomous/grant-dna-trigger, enqueues
      // input_payload: { funderId }), same convention as 'ag-28-followup'
      // above. Also wired into a dedicated Sunday 3AM CST weekly slot via
      // runGrantDnaWeeklyPipeline() — this case adds the on-demand/event path.
      const { GrantDnaAgent } = await import(
        '../src/lib/agents/grant-dna-agent.js'
      );
      const agent = new GrantDnaAgent(orgId, supabase);
      const result = await agent.run('event');
      return `ag-10-grant-dna completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-27-board-packet': {
      // AG-27, src/lib/agents/board-packet-agent.ts — event-chained safety
      // net for a meeting created/rescheduled with less than 48 hours'
      // notice (POST /api/autonomous/board-packet-trigger). Also wired into
      // a dedicated daily 2AM CST slot via runBoardPacketDailyPipeline() —
      // this case adds the event/on-demand path.
      const { BoardPacketAgent } = await import(
        '../src/lib/agents/board-packet-agent.js'
      );
      const agent = new BoardPacketAgent(orgId, supabase);
      const result = await agent.run('event');
      return `ag-27-board-packet completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'ag-29-knowledge-indexer': {
      // AG-29, src/lib/agents/knowledge-indexer-agent.ts — platform-wide, not
      // per-org (constructor takes only `supabase`, same shape as
      // ag-36-learning-network/ag-38-self-improvement above) — item.org_id is
      // ignored. Continuous poll loop already runs this agent independently
      // via worker/knowledge-indexer-processor.ts, started at worker boot;
      // this case handles event-triggered rows enqueued by
      // enqueueKnowledgeIndexerTrigger() (outcomes insert, NIH proposal
      // ingestion) and adds an on-demand path for the same agentId literal.
      const { KnowledgeIndexerAgent } = await import(
        '../src/lib/agents/knowledge-indexer-agent.js'
      );
      const agent = new KnowledgeIndexerAgent(supabase);
      const result = await agent.run('event');
      return `ag-29-knowledge-indexer completed (itemsProcessed=${result.itemsProcessed}/${result.itemsFound})`;
    }
    case 'foundation-990-enrichment': {
      // AG-42 Change Monitor's chain target for a detected
      // foundation_directory change (queueChainedAgent(
      // 'foundation-990-enrichment', 50, {foundationId}),
      // change-monitor-agent.ts). Routes to foundation-scraper.ts's
      // existing, proven waterfall (processFoundation/buildEinIndex,
      // unchanged) for just this one row, out-of-cycle from the weekly
      // full-directory sweep — not org-scoped, foundation_directory has no
      // organization_id.
      const foundationId = requireString(item.input_payload, 'foundationId');
      const { enrichSingleFoundation } = await import(
        '../src/lib/scraper/foundation-scraper.js'
      );
      const result = await enrichSingleFoundation(foundationId);
      return `foundation-990-enrichment completed for ${foundationId} (enriched=${result?.enriched ?? false}, strategy=${result?.strategy ?? 'none'})`;
    }
    default:
      throw new Error(`Unknown agent_queue agent_id: "${item.agent_id}".`);
  }
}

/** SELECT-then-compare-and-swap claim, mirroring queue-processor.ts's dequeue(). */
async function claimNextQueueItem(
  supabase: SupabaseClient,
): Promise<AgentQueueRow | null> {
  const { data: candidate } = await supabase
    .from('agent_queue')
    .select('id, org_id, agent_id, input_payload, retry_count, max_retries')
    .eq('status', 'queued')
    .order('priority', { ascending: false })
    .order('queued_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!candidate) return null;

  const { data: claimed, error: claimError } = await supabase
    .from('agent_queue')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', candidate.id as string)
    .eq('status', 'queued')
    .select('id, org_id, agent_id, input_payload, retry_count, max_retries')
    .maybeSingle();

  if (claimError || !claimed) return null;
  return claimed as unknown as AgentQueueRow;
}

async function runQueueItem(
  supabase: SupabaseClient,
  item: AgentQueueRow,
): Promise<void> {
  try {
    const summary = await routeQueueItem(supabase, item);
    await supabase
      .from('agent_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        output_payload: { summary },
      })
      .eq('id', item.id);
  } catch (err) {
    const nextRetryCount = (item.retry_count ?? 0) + 1;
    const maxRetries = item.max_retries ?? 3;
    const failedForGood = nextRetryCount >= maxRetries;
    await supabase
      .from('agent_queue')
      .update({
        status: failedForGood ? 'failed' : 'queued',
        retry_count: nextRetryCount,
        error_message: errMsg(err),
        completed_at: failedForGood ? new Date().toISOString() : null,
      })
      .eq('id', item.id);
  }
}

let queueProcessorStopped = false;

/** Signals processAgentQueue()'s loop to exit after its current item. */
export function stopAgentQueueProcessor(): void {
  queueProcessorStopped = true;
}

/**
 * Polls agent_queue continuously: claims the highest-priority queued item
 * (priority DESC, queued_at ASC), routes it to the matching agent, and
 * updates its status. Sleeps QUEUE_POLL_EMPTY_MS between polls when the
 * queue is empty. Runs until stopAgentQueueProcessor() is called.
 */
export async function processAgentQueue(supabase: SupabaseClient): Promise<void> {
  queueProcessorStopped = false;
  console.log('[AgentQueueProcessor] Started.');

  while (!queueProcessorStopped) {
    let item: AgentQueueRow | null = null;
    try {
      item = await claimNextQueueItem(supabase);
    } catch (err) {
      console.error('[AgentQueueProcessor] Claim failed:', errMsg(err));
    }

    if (!item) {
      await sleep(QUEUE_POLL_EMPTY_MS);
      continue;
    }

    await runQueueItem(supabase, item);
  }

  console.log('[AgentQueueProcessor] Stopped.');
}
