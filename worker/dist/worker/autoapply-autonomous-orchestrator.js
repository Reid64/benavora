"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAutonomousAutoApply = runAutonomousAutoApply;
const SLEEP_BETWEEN_ORGS_MS = 2_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_NIGHTLY = 50;
function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function getEligibleOrgs(supabase) {
    const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('onboarding_completed', true);
    if (!orgs || orgs.length === 0)
        return [];
    const { data: enterpriseSubs } = await supabase
        .from('subscriptions')
        .select('organization_id')
        .eq('tier', 'enterprise')
        .in('status', ['active', 'trialing']);
    const enterpriseOrgIds = new Set((enterpriseSubs ?? []).map((s) => s.organization_id));
    if (enterpriseOrgIds.size === 0)
        return [];
    const candidateIds = orgs
        .filter((o) => enterpriseOrgIds.has(o.id))
        .map((o) => o.id);
    if (candidateIds.length === 0)
        return [];
    const { data: configs } = await supabase
        .from('org_autonomous_config')
        .select('org_id, auto_autoapply_enabled, max_nightly_autoapply_submissions')
        .in('org_id', candidateIds)
        .eq('auto_autoapply_enabled', true);
    const configByOrg = new Map((configs ?? []).map((c) => [
        c.org_id,
        c.max_nightly_autoapply_submissions ?? DEFAULT_MAX_NIGHTLY,
    ]));
    if (configByOrg.size === 0)
        return [];
    return orgs
        .filter((o) => configByOrg.has(o.id))
        .map((o) => ({
        id: o.id,
        name: o.name,
        maxNightlySubmissions: configByOrg.get(o.id) ?? DEFAULT_MAX_NIGHTLY,
    }));
}
function asDirectory(directory) {
    if (!directory)
        return null;
    return Array.isArray(directory) ? (directory[0] ?? null) : directory;
}
async function resolveFunderId(supabase, orgId, directory) {
    const enrichment = directory.enrichment && typeof directory.enrichment === 'object' && !Array.isArray(directory.enrichment)
        ? directory.enrichment
        : {};
    if (enrichment['has_donation_form'] !== true)
        return null;
    const givingPortalUrl = (typeof enrichment['donation_form_url'] === 'string' && enrichment['donation_form_url']) ||
        directory.website ||
        null;
    const orgName = directory.dba_name?.trim() || directory.legal_name;
    let funderId = null;
    if (givingPortalUrl) {
        const { data } = await supabase
            .from('funders')
            .select('id')
            .eq('organization_id', orgId)
            .eq('giving_portal_url', givingPortalUrl)
            .maybeSingle();
        funderId = data?.id ?? null;
    }
    if (!funderId) {
        const { data } = await supabase
            .from('funders')
            .select('id')
            .eq('organization_id', orgId)
            .eq('name', orgName)
            .maybeSingle();
        funderId = data?.id ?? null;
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
        })
            .select('id')
            .single();
        if (error || !newFunder)
            return null;
        funderId = newFunder.id;
    }
    return { funderId, givingPortalUrl, orgName };
}
async function ranRecently(supabase, orgId, funderId) {
    const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
    const { data: recentSubmission } = await supabase
        .from('autoapply_submissions')
        .select('id')
        .eq('organization_id', orgId)
        .eq('funder_id', funderId)
        .gte('created_at', since)
        .limit(1)
        .maybeSingle();
    if (recentSubmission)
        return true;
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
function priorityFromScore(score) {
    if (score === null)
        return 60;
    return Math.min(100, Math.max(1, 101 - score));
}
async function logDecision(supabase, params) {
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
async function queueOrgProspects(supabase, org, agentRunId, log) {
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
    const prospectRows = (prospects ?? []);
    for (const prospect of prospectRows) {
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
            const { funderId, orgName } = resolved;
            if (await ranRecently(supabase, org.id, funderId)) {
                skipped += 1;
                await logDecision(supabase, {
                    orgId: org.id,
                    agentRunId,
                    decisionType: 'autoapply_skipped',
                    entityId: prospect.id,
                    reasoning: `Skipped AutoApply queueing for ${orgName}: a session already ran or is already queued for this funder within the last 30 days.`,
                    confidenceScore: prospect.score,
                    actionTaken: 'skipped_recent_duplicate',
                    actionPayload: { funderId },
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
                reasoning: `Queued AutoApply for ${orgName} (score=${prospect.score ?? 'unscored'}).`,
                confidenceScore: prospect.score,
                actionTaken: 'inserted_submission_queue_item',
                actionPayload: { queueId: queueItem.id, funderId },
            });
            queued += 1;
        }
        catch (err) {
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
 * queued or submitted to in the last 30 days, and inserts the rest into
 * submission_queue for the already-running QueueProcessor
 * (worker/queue-processor.ts) to pick up and process. Never fills a form or
 * submits anything itself — see AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY.
 */
async function runAutonomousAutoApply(supabase) {
    const orgs = await getEligibleOrgs(supabase);
    console.log(`[AutoApplyAutonomousOrchestrator] Nightly batch starting for ${orgs.length} eligible org(s).`);
    for (const org of orgs) {
        const log = [];
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
        const runId = runRow?.id ?? null;
        try {
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
            console.log(`[AutoApplyAutonomousOrchestrator] Org ${org.id} (${org.name ?? 'unnamed'}): ` +
                `${queued} queued, ${skipped} skipped, ${considered} considered.`);
        }
        catch (err) {
            console.error(`[AutoApplyAutonomousOrchestrator] Org ${org.id} pipeline failed:`, errMsg(err));
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
