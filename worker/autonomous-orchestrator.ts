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
}

async function getActiveOrgs(supabase: SupabaseClient): Promise<ActiveOrg[]> {
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name')
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
    log.push(`discovery: ${result.matched} matched / ${result.found} found`);
    return result.matched > 0;
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
  if (isFirstOfMonthChicago()) {
    hadActivity =
      (await runRenewalTrackerStep(supabase, org.id, log)) || hadActivity;
    hadActivity =
      (await runSearchProfileOptimizerStep(supabase, org.id, log)) ||
      hadActivity;
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
      return `discovery: ${result.matched} matched / ${result.found} found`;
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
      const { checkEntityReputation } = await import(
        '../src/lib/intelligence/reputation-agent.js'
      );
      const signals = await checkEntityReputation(
        requireString(payload, 'entityId'),
        requireString(payload, 'entityType'),
        requireString(payload, 'entityName'),
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
