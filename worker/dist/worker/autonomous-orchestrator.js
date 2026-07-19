"use strict";
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
//   requested FitAnalysisAgent, RenewalTrackerAgent, OutcomeAnalyzerAgent,
//     DocumentExpiryAgent, KnowledgeGapAgent, SearchProfileOptimizerAgent
//     -> NO IMPLEMENTATION EXISTS ANYWHERE IN THE CODEBASE. Not wired.
//
// "Queue-only" agents are event-driven (e.g. FunderRelationshipAgent scores
// one specific event like "awarded" against one funder) with no meaningful
// blind nightly invocation, so they're imported and routed through
// processAgentQueue() only — never called from the per-org sweep, even when
// their config toggle is on. They're ready for other app code to enqueue a
// real event.
//
// Also corrects a doc error: WORKER_ARCHITECTURE_v2.md describes "active
// orgs" as organizations.stripe_subscription_status IN ('active','trialing')
// AND organizations.status != 'suspended'. Neither column exists anywhere in
// supabase/migrations/ or src/supabase/migrations/ — subscription status
// lives on the separate, 1:1 `subscriptions` table (migration
// 002_phases_2_5.sql), and there is no suspend flag on organizations at all.
// getActiveOrgs() below uses the real schema.
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAutonomousPipeline = runAutonomousPipeline;
exports.stopAgentQueueProcessor = stopAgentQueueProcessor;
exports.processAgentQueue = processAgentQueue;
const SLEEP_BETWEEN_ORGS_MS = 2_000;
const QUEUE_POLL_EMPTY_MS = 30_000;
// Bounds Claude/API cost per org per nightly step. draft_generation uses the
// org's own max_auto_drafts_per_night instead (Contracts-style per-org cap).
const MAX_ITEMS_PER_STEP = 10;
// Reputation checks are external-search + Claude per result — the most
// expensive step per entity — so the nightly sample stays small.
const REPUTATION_SAMPLE_SIZE = 5;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
}
// Mirrors autonomous-base.ts's SAFE_DEFAULT_CONFIG (that const isn't
// exported, so it's duplicated here rather than modifying that file).
const SAFE_DEFAULT_CONFIG = {
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
async function getOrgConfig(supabase, orgId) {
    const { data } = await supabase
        .from('org_autonomous_config')
        .select('auto_research_enabled, auto_score_enabled, auto_draft_enabled, ' +
        'auto_draft_threshold, auto_reputation_enabled, auto_relationship_enabled, ' +
        'auto_deadline_prediction_enabled, auto_followup_enabled, ' +
        'notify_on_auto_draft, notify_on_high_score, max_auto_drafts_per_night')
        .eq('org_id', orgId)
        .maybeSingle();
    if (!data)
        return SAFE_DEFAULT_CONFIG;
    return data;
}
function isAnyAutonomyEnabled(config) {
    return (config.auto_research_enabled ||
        config.auto_score_enabled ||
        config.auto_draft_enabled ||
        config.auto_reputation_enabled ||
        config.auto_relationship_enabled ||
        config.auto_deadline_prediction_enabled ||
        config.auto_followup_enabled);
}
async function getActiveOrgs(supabase) {
    const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('onboarding_completed', true);
    if (!orgs || orgs.length === 0)
        return [];
    const { data: activeSubs } = await supabase
        .from('subscriptions')
        .select('organization_id')
        .in('status', ['active', 'trialing']);
    const activeOrgIds = new Set((activeSubs ?? []).map((s) => s.organization_id));
    return orgs.filter((o) => activeOrgIds.has(o.id));
}
async function insertAlert(supabase, params) {
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
async function runDiscoveryStep(supabase, orgId, log) {
    try {
        const { runOpportunityDiscovery } = await import('../src/lib/agents/opportunity-discovery-agent.js');
        const result = await runOpportunityDiscovery(orgId, supabase);
        log.push(`discovery: ${result.matched} matched / ${result.found} found`);
        return result.matched > 0;
    }
    catch (err) {
        log.push(`discovery: FAILED - ${errMsg(err)}`);
        return false;
    }
}
async function runEligibilityScoringStep(supabase, orgId, log) {
    try {
        const { EligibilityScorer } = await import('../src/lib/agents/eligibility-scorer.js');
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
                await agent.run({ opportunityId: opp.id });
                processed += 1;
            }
            catch (err) {
                log.push(`eligibility_scoring[${opp.id}]: FAILED - ${errMsg(err)}`);
            }
        }
        log.push(`eligibility_scoring: ${processed}/${(opps ?? []).length} scored`);
        return processed > 0;
    }
    catch (err) {
        log.push(`eligibility_scoring: FAILED to load - ${errMsg(err)}`);
        return false;
    }
}
async function runProbabilityScoringStep(supabase, orgId, log) {
    try {
        const { SuccessProbabilityAgent } = await import('../src/lib/agents/success-probability.js');
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
                await agent.run({ applicationId: app.id });
                processed += 1;
            }
            catch (err) {
                log.push(`probability_scoring[${app.id}]: FAILED - ${errMsg(err)}`);
            }
        }
        log.push(`probability_scoring: ${processed}/${(apps ?? []).length} scored`);
        return processed > 0;
    }
    catch (err) {
        log.push(`probability_scoring: FAILED to load - ${errMsg(err)}`);
        return false;
    }
}
async function runDraftGenerationStep(supabase, orgId, config, log) {
    try {
        const { generateDraft } = await import('../src/lib/drafts/generator.js');
        const cap = config.max_auto_drafts_per_night > 0
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
        const oppIds = oppList.map((o) => o.id);
        const { data: existingApps } = await supabase
            .from('applications')
            .select('opportunity_id')
            .in('opportunity_id', oppIds);
        const alreadyHasApp = new Set((existingApps ?? []).map((a) => a.opportunity_id));
        const candidates = oppList
            .filter((o) => !alreadyHasApp.has(o.id))
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
                    opportunityId: opp.id,
                    templateType: 'grant_narrative',
                    createdByUserId: null,
                    draftSource: 'autonomous',
                });
                processed += 1;
                if (config.notify_on_auto_draft) {
                    await insertAlert(supabase, {
                        organizationId: orgId,
                        type: 'draft_review',
                        severity: 'info',
                        message: `Autonomous draft ready for review: "${opp.name ?? 'Untitled opportunity'}" (confidence ${result.confidenceScore}).`,
                        opportunityId: opp.id,
                        applicationId: app?.id ?? undefined,
                    });
                }
            }
            catch (err) {
                log.push(`draft_generation[${opp.id}]: FAILED - ${errMsg(err)}`);
            }
        }
        log.push(`draft_generation: ${processed}/${candidates.length} drafted (${oppList.length} qualifying)`);
        return processed > 0;
    }
    catch (err) {
        log.push(`draft_generation: FAILED to load - ${errMsg(err)}`);
        return false;
    }
}
async function runReputationStep(supabase, orgId, log) {
    try {
        const { checkEntityReputation } = await import('../src/lib/intelligence/reputation-agent.js');
        const { data: funders } = await supabase
            .from('funders')
            .select('id, name')
            .eq('organization_id', orgId)
            .limit(REPUTATION_SAMPLE_SIZE);
        let signalCount = 0;
        for (const funder of funders ?? []) {
            try {
                const signals = (await checkEntityReputation(funder.id, 'funder', funder.name ?? '', supabase));
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
                            message: `Reputation risk detected for funder "${funder.name ?? 'Unknown'}".`,
                        });
                    }
                    signalCount += 1;
                }
            }
            catch (err) {
                log.push(`reputation[${funder.id}]: FAILED - ${errMsg(err)}`);
            }
        }
        log.push(`reputation: ${signalCount} signal(s) from ${(funders ?? []).length} funder(s) checked`);
        return signalCount > 0;
    }
    catch (err) {
        log.push(`reputation: FAILED to load - ${errMsg(err)}`);
        return false;
    }
}
async function runDeadlinePredictionStep(supabase, orgId, log) {
    try {
        const { DeadlinePredictionAgent } = await import('../src/lib/agents/deadline-prediction.js');
        const agent = new DeadlinePredictionAgent({
            client: supabase,
            organizationId: orgId,
            triggeredBy: null,
        });
        const outcome = await agent.run({});
        log.push(`deadline_prediction: completed (tokens=${outcome.tokensUsed})`);
        return true;
    }
    catch (err) {
        log.push(`deadline_prediction: FAILED - ${errMsg(err)}`);
        return false;
    }
}
// --- per-org run -----------------------------------------------------------------
async function runOrgPipeline(supabase, org) {
    const config = await getOrgConfig(supabase, org.id);
    if (!isAnyAutonomyEnabled(config))
        return false;
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
    const runId = runRow?.id ?? null;
    const log = [];
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
    // renewal_tracker, document_expiry, knowledge_gap, search_optimizer: no
    // agent implementation exists anywhere in the codebase for any of these
    // (see file header) — not wired.
    if (runId) {
        await supabase
            .from('agent_runs')
            .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            output_summary: log.join(' | ').slice(0, 2000) || 'No steps enabled produced output.',
        })
            .eq('id', runId);
    }
    return hadActivity;
}
/**
 * Nightly autonomous pipeline: runs the enabled steps for every active org,
 * then sends a morning digest to every org that had real activity.
 */
async function runAutonomousPipeline(supabase) {
    const orgs = await getActiveOrgs(supabase);
    console.log(`[AutonomousOrchestrator] Nightly pipeline starting for ${orgs.length} active org(s).`);
    const orgsWithActivity = [];
    for (const org of orgs) {
        try {
            const hadActivity = await runOrgPipeline(supabase, org);
            if (hadActivity)
                orgsWithActivity.push(org);
        }
        catch (err) {
            console.error(`[AutonomousOrchestrator] Org ${org.id} pipeline failed:`, errMsg(err));
        }
        await sleep(SLEEP_BETWEEN_ORGS_MS);
    }
    console.log(`[AutonomousOrchestrator] ${orgsWithActivity.length}/${orgs.length} org(s) had activity; sending digests.`);
    for (const org of orgsWithActivity) {
        try {
            const { sendMorningDigest } = await import('../src/lib/agents/morning-digest.js');
            await sendMorningDigest(org.id, supabase);
        }
        catch (err) {
            console.error(`[AutonomousOrchestrator] Digest failed for org ${org.id}:`, errMsg(err));
        }
    }
    console.log('[AutonomousOrchestrator] Nightly pipeline complete.');
}
function requireString(payload, key) {
    const value = payload?.[key];
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`agent_queue input_payload.${key} is required and must be a non-empty string.`);
    }
    return value;
}
/** Routes one claimed agent_queue row to the matching real agent/function. */
async function routeQueueItem(supabase, item) {
    const orgId = item.org_id;
    const payload = item.input_payload;
    switch (item.agent_id) {
        case 'opportunity_discovery': {
            const { runOpportunityDiscovery } = await import('../src/lib/agents/opportunity-discovery-agent.js');
            const result = await runOpportunityDiscovery(orgId, supabase);
            return `discovery: ${result.matched} matched / ${result.found} found`;
        }
        case 'eligibility_scoring': {
            const { EligibilityScorer } = await import('../src/lib/agents/eligibility-scorer.js');
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
            const { SuccessProbabilityAgent } = await import('../src/lib/agents/success-probability.js');
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
            const { DeadlineExtractor } = await import('../src/lib/agents/deadline-extractor.js');
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
            const { ComplianceChecker } = await import('../src/lib/agents/compliance-checker.js');
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
            const { BudgetBuilderAgent } = await import('../src/lib/agents/budget-builder.js');
            const agent = new BudgetBuilderAgent({
                client: supabase,
                organizationId: orgId,
                triggeredBy: null,
            });
            const outcome = await agent.run({
                opportunityId: requireString(payload, 'opportunityId'),
                applicationId: typeof payload?.['applicationId'] === 'string'
                    ? payload['applicationId']
                    : undefined,
                requestedAmount: typeof payload?.['requestedAmount'] === 'number'
                    ? payload['requestedAmount']
                    : undefined,
            });
            return `budget_builder completed (tokens=${outcome.tokensUsed})`;
        }
        case 'follow_up_generator': {
            const { FollowUpGeneratorAgent } = await import('../src/lib/agents/follow-up-generator.js');
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
            const { FunderRelationshipAgent } = await import('../src/lib/agents/funder-relationship.js');
            const agent = new FunderRelationshipAgent({
                client: supabase,
                organizationId: orgId,
                triggeredBy: null,
            });
            const outcome = await agent.run({
                funderId: requireString(payload, 'funderId'),
                event: requireString(payload, 'event'),
            });
            return `funder_relationship completed (tokens=${outcome.tokensUsed})`;
        }
        case 'deadline_prediction': {
            const { DeadlinePredictionAgent } = await import('../src/lib/agents/deadline-prediction.js');
            const agent = new DeadlinePredictionAgent({
                client: supabase,
                organizationId: orgId,
                triggeredBy: null,
            });
            const outcome = await agent.run({
                category: typeof payload?.['category'] === 'string'
                    ? payload['category']
                    : undefined,
                daysAhead: typeof payload?.['daysAhead'] === 'number'
                    ? payload['daysAhead']
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
                    : 'grant_narrative'),
                createdByUserId: typeof payload?.['createdByUserId'] === 'string'
                    ? payload['createdByUserId']
                    : null,
                draftSource: 'autonomous',
            });
            return `draft_generation completed (confidence=${result.confidenceScore})`;
        }
        case 'reputation': {
            const { checkEntityReputation } = await import('../src/lib/intelligence/reputation-agent.js');
            const signals = await checkEntityReputation(requireString(payload, 'entityId'), requireString(payload, 'entityType'), requireString(payload, 'entityName'), supabase);
            return `reputation completed (${signals.length} signal(s))`;
        }
        case 'morning_digest': {
            const { sendMorningDigest } = await import('../src/lib/agents/morning-digest.js');
            await sendMorningDigest(orgId, supabase);
            return 'morning_digest completed';
        }
        default:
            throw new Error(`Unknown agent_queue agent_id: "${item.agent_id}".`);
    }
}
/** SELECT-then-compare-and-swap claim, mirroring queue-processor.ts's dequeue(). */
async function claimNextQueueItem(supabase) {
    const { data: candidate } = await supabase
        .from('agent_queue')
        .select('id, org_id, agent_id, input_payload, retry_count, max_retries')
        .eq('status', 'queued')
        .order('priority', { ascending: false })
        .order('queued_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (!candidate)
        return null;
    const { data: claimed, error: claimError } = await supabase
        .from('agent_queue')
        .update({ status: 'processing', started_at: new Date().toISOString() })
        .eq('id', candidate.id)
        .eq('status', 'queued')
        .select('id, org_id, agent_id, input_payload, retry_count, max_retries')
        .maybeSingle();
    if (claimError || !claimed)
        return null;
    return claimed;
}
async function runQueueItem(supabase, item) {
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
    }
    catch (err) {
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
function stopAgentQueueProcessor() {
    queueProcessorStopped = true;
}
/**
 * Polls agent_queue continuously: claims the highest-priority queued item
 * (priority DESC, queued_at ASC), routes it to the matching agent, and
 * updates its status. Sleeps QUEUE_POLL_EMPTY_MS between polls when the
 * queue is empty. Runs until stopAgentQueueProcessor() is called.
 */
async function processAgentQueue(supabase) {
    queueProcessorStopped = false;
    console.log('[AgentQueueProcessor] Started.');
    while (!queueProcessorStopped) {
        let item = null;
        try {
            item = await claimNextQueueItem(supabase);
        }
        catch (err) {
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
