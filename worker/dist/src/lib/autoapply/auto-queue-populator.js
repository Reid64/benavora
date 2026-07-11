"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
Object.defineProperty(exports, "__esModule", { value: true });
exports.populateQueue = populateQueue;
exports.getQueueableCount = getQueueableCount;
const compliance_guard_1 = require("./compliance-guard");
const funder_matcher_1 = require("./funder-matcher");
const submission_controls_1 = require("./submission-controls");
function bumpReason(reasons, key) {
    reasons[key] = (reasons[key] ?? 0) + 1;
}
function toStringSet(rows) {
    return new Set((rows ?? [])
        .map(r => r.funder_id)
        .filter((id) => id !== null));
}
function extractDomainFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    }
    catch {
        return url;
    }
}
async function resolveDedupWindow(supabase, _organizationId, override) {
    if (override !== undefined)
        return override;
    const result = await supabase
        .from('auto_queue_config')
        .select('dedup_window_days')
        .maybeSingle();
    const windowDays = result?.data?.dedup_window_days;
    return windowDays ?? 30;
}
async function buildSubmissionSets(supabase, organizationId, dedupWindowDays) {
    const queryResult = await supabase
        .from('autoapply_submissions')
        .select('funder_id, status, submitted_at')
        .eq('organization_id', organizationId)
        .not('submitted_at', 'is', null)
        .order('submitted_at', { ascending: false });
    const rows = queryResult?.data ?? [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const dedupWindowStart = new Date(Date.now() - dedupWindowDays * 24 * 60 * 60 * 1000).toISOString();
    const permanentBlockSet = new Set();
    const captchaFunderIds = new Set();
    const accountFunderIds = new Set();
    const tempBlockSet = new Set();
    const recentSet = new Set();
    const seen = new Set();
    for (const row of rows) {
        const funderId = row.funder_id;
        if (!funderId || seen.has(funderId))
            continue;
        seen.add(funderId);
        const status = row.status ?? '';
        const submittedAt = row.submitted_at ?? '';
        if (status === 'captcha_blocked') {
            permanentBlockSet.add(funderId);
            captchaFunderIds.add(funderId);
        }
        else if (status === 'account_required') {
            permanentBlockSet.add(funderId);
            accountFunderIds.add(funderId);
        }
        else if ((status === 'site_error' || status === 'timeout') && submittedAt > sevenDaysAgo) {
            tempBlockSet.add(funderId);
        }
        else if (submittedAt > dedupWindowStart) {
            recentSet.add(funderId);
        }
    }
    return { permanentBlockSet, captchaFunderIds, accountFunderIds, tempBlockSet, recentSet };
}
async function populateQueue(params) {
    const { organizationId, supabase, maxItems = 50, dry_run = false, filters } = params;
    const result = { queued: 0, skipped: 0, dedupWindowDays: 30, reasons: {} };
    const dedupWindowDays = await resolveDedupWindow(supabase, organizationId, params.dedupWindowDays);
    result.dedupWindowDays = dedupWindowDays;
    // Load active request profiles for this org — required to determine what to request
    // from each funder via profile matching.
    const { data: profilesData } = await supabase
        .from('request_profiles')
        .select('id, name, request_type, target_funder_categories, target_funder_types, geographic_requirements, active, priority')
        .eq('organization_id', organizationId)
        .eq('active', true);
    const profiles = (profilesData ?? []);
    // Collect funder/profile pairs already pending or processing in the queue.
    // Dedup is per (funder_id, request_profile_id) pair so the same funder can be
    // queued simultaneously with different profiles (e.g. monetary AND land donation).
    const { data: pendingRows } = await supabase
        .from('submission_queue')
        .select('funder_id, request_profile_id')
        .eq('organization_id', organizationId)
        .in('status', ['pending', 'processing']);
    const pendingPairSet = new Set();
    for (const row of (pendingRows ?? [])) {
        if (row.funder_id && row.request_profile_id) {
            pendingPairSet.add(`${row.funder_id}:${row.request_profile_id}`);
        }
    }
    // Build per-funder classification from submission history
    const { permanentBlockSet, captchaFunderIds, accountFunderIds, tempBlockSet, recentSet } = await buildSubmissionSets(supabase, organizationId, dedupWindowDays);
    const userExcludeSet = new Set(filters?.excludeFunderIds ?? []);
    // Pending funders are intentionally NOT excluded from the SQL query — dedup is handled
    // per (funder, profile) pair in the loop below, allowing the same funder to be queued
    // with a different profile if a different pair isn't already pending.
    const allExcluded = [
        ...permanentBlockSet,
        ...tempBlockSet,
        ...recentSet,
        ...userExcludeSet,
    ];
    const uniqueExcluded = [...new Set(allExcluded)];
    // Query eligible funders; include `type` for funder-matcher capability scoring.
    let query = supabase
        .from('funders')
        .select('id, name, category, city, state, giving_portal_url, type')
        .eq('organization_id', organizationId)
        .not('giving_portal_url', 'is', null)
        .neq('giving_portal_url', '');
    if (uniqueExcluded.length > 0) {
        query = query.not('id', 'in', `(${uniqueExcluded.join(',')})`);
    }
    if (filters?.categories && filters.categories.length > 0) {
        query = query.in('category', filters.categories);
    }
    if (filters?.geographicScope && filters.geographicScope.length > 0) {
        const orParts = filters.geographicScope
            .map(scope => `geographic_focus.ilike.%${scope}%`)
            .join(',');
        query = query.or(orParts);
    }
    const { data: funders, error: queryError } = await query.limit(maxItems);
    if (queryError) {
        throw new Error(`Failed to query funders: ${queryError.message}`);
    }
    const allEligible = (funders ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        category: f.category ?? null,
        city: f.city ?? null,
        state: f.state ?? null,
        giving_portal_url: f.giving_portal_url,
        type: f.type ?? null,
        matched_profile_name: null,
        matched_profile_type: null,
        match_score: null,
    }));
    // Compliance filter: skip funders in states where the org isn't registered.
    const guard = new compliance_guard_1.ComplianceGuard();
    const registeredStates = new Set(await guard.getRegisteredStates(organizationId, supabase));
    const complianceHeld = [];
    const eligible = [];
    for (const funder of allEligible) {
        if (funder.state && !registeredStates.has(funder.state)) {
            complianceHeld.push(funder);
        }
        else {
            eligible.push(funder);
        }
    }
    // Velocity check is done once per populate call (no submissions happen during this call,
    // so the 24h rolling count is constant throughout).
    const controls = new submission_controls_1.SubmissionControls();
    const velocityCheck = await controls.checkVelocityLimits(organizationId, supabase);
    const readyFunders = [];
    for (const funder of eligible) {
        // Match funder to the best active request profile.
        const funderForMatch = {
            id: funder.id,
            name: funder.name,
            category: funder.category,
            type: funder.type,
            state: funder.state,
            city: funder.city,
        };
        const bestMatch = (0, funder_matcher_1.getBestProfile)(funderForMatch, profiles);
        if (!bestMatch) {
            bumpReason(result.reasons, 'no_matching_profile');
            result.skipped++;
            continue;
        }
        // Pair-level dedup: skip if this exact (funder, profile) pair is already in the queue.
        const pairKey = `${funder.id}:${bestMatch.profileId}`;
        if (pendingPairSet.has(pairKey)) {
            bumpReason(result.reasons, 'already_pending');
            result.skipped++;
            continue;
        }
        // Rolling 24-hour velocity cap — if already at limit, skip remaining funders.
        if (velocityCheck.blocked) {
            bumpReason(result.reasons, 'velocity_limit');
            result.skipped++;
            continue;
        }
        // Cross-client dedup: block if another org submitted to this domain in the last 7 days.
        const domain = extractDomainFromUrl(funder.giving_portal_url);
        const crossClientResult = await controls.checkCrossClientDedup(domain, organizationId, supabase);
        if (crossClientResult.blocked) {
            bumpReason(result.reasons, 'cross_client_blocked');
            result.skipped++;
            continue;
        }
        // Per-domain submission frequency cap (shared platform or standard portal).
        const domainThrottleResult = await controls.checkDomainThrottle(funder.giving_portal_url, supabase);
        if (domainThrottleResult.blocked) {
            bumpReason(result.reasons, 'domain_throttled');
            result.skipped++;
            continue;
        }
        // All checks passed — record profile match info and add to ready set.
        funder.matched_profile_name = bestMatch.profileName;
        funder.matched_profile_type = bestMatch.requestType;
        funder.match_score = bestMatch.score;
        readyFunders.push({ ...funder, request_profile_id: bestMatch.profileId });
    }
    // Preview mode: return the would-be-queued funders without writing to the queue.
    if (dry_run) {
        return { funders: readyFunders, dedupWindowDays };
    }
    if (readyFunders.length > 0) {
        const inserts = readyFunders.map(funder => ({
            organization_id: organizationId,
            funder_id: funder.id,
            request_profile_id: funder.request_profile_id,
            status: 'pending',
            automation_mode: 'autonomous',
            priority: 100,
        }));
        const { error: insertError } = await supabase
            .from('submission_queue')
            .insert(inserts);
        if (insertError) {
            throw new Error(`Failed to insert into submission_queue: ${insertError.message}`);
        }
        result.queued = readyFunders.length;
    }
    // Report compliance-held skips (fetched from SQL but blocked by state registration).
    for (const funder of complianceHeld) {
        bumpReason(result.reasons, 'compliance_hold');
        result.skipped++;
        // Defensive removal in case a funder appears in multiple sets (edge case).
        permanentBlockSet.delete(funder.id);
        tempBlockSet.delete(funder.id);
        recentSet.delete(funder.id);
        userExcludeSet.delete(funder.id);
    }
    // Report SQL-level exclusion skip reasons.
    // Note: pendingSet no longer contributes to SQL exclusion — pair-level dedup is
    // tracked in the loop above, so there is no risk of double-counting here.
    for (const id of captchaFunderIds) {
        if (!userExcludeSet.has(id)) {
            bumpReason(result.reasons, 'captcha_blocked_permanent');
            result.skipped++;
        }
    }
    for (const id of accountFunderIds) {
        if (!userExcludeSet.has(id)) {
            bumpReason(result.reasons, 'account_required_permanent');
            result.skipped++;
        }
    }
    for (const id of tempBlockSet) {
        if (!permanentBlockSet.has(id) && !userExcludeSet.has(id)) {
            bumpReason(result.reasons, 'recently_failed');
            result.skipped++;
        }
    }
    for (const id of recentSet) {
        if (!permanentBlockSet.has(id) && !tempBlockSet.has(id) && !userExcludeSet.has(id)) {
            bumpReason(result.reasons, 'recently_submitted');
            result.skipped++;
        }
    }
    for (const id of userExcludeSet) {
        if (!permanentBlockSet.has(id) && !tempBlockSet.has(id) && !recentSet.has(id)) {
            bumpReason(result.reasons, 'filtered_out');
            result.skipped++;
        }
    }
    return result;
}
async function getQueueableCount(organizationId, supabase, dedupWindowDays) {
    const windowDays = await resolveDedupWindow(supabase, organizationId, dedupWindowDays);
    const { data: pendingRows } = await supabase
        .from('submission_queue')
        .select('funder_id')
        .eq('organization_id', organizationId)
        .in('status', ['pending', 'processing']);
    const { permanentBlockSet, tempBlockSet, recentSet } = await buildSubmissionSets(supabase, organizationId, windowDays);
    const excluded = [
        ...toStringSet(pendingRows),
        ...permanentBlockSet,
        ...tempBlockSet,
        ...recentSet,
    ];
    const uniqueExcluded = [...new Set(excluded)];
    let query = supabase
        .from('funders')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .not('giving_portal_url', 'is', null)
        .neq('giving_portal_url', '');
    if (uniqueExcluded.length > 0) {
        query = query.not('id', 'in', `(${uniqueExcluded.join(',')})`);
    }
    const { count, error } = await query;
    if (error) {
        throw new Error(`Failed to count queueable funders: ${error.message}`);
    }
    return count ?? 0;
}
