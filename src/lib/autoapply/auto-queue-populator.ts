/* eslint-disable @typescript-eslint/no-explicit-any */

import { ComplianceGuard } from './compliance-guard';
import { getBestProfile, type FunderForMatching, type RequestProfile } from './funder-matcher';
import { SubmissionControls } from './submission-controls';

export type PopulateResult = {
  queued: number;
  skipped: number;
  dedupWindowDays: number;
  reasons: Record<string, number>;
};

export type DryRunFunder = {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  state: string | null;
  giving_portal_url: string;
  matched_profile_name: string | null;
  matched_profile_type: string | null;
  match_score: number | null;
};

export type DryRunResult = {
  funders: DryRunFunder[];
  dedupWindowDays: number;
};

type PopulateParams = {
  organizationId: string;
  supabase: any;
  maxItems?: number;
  dry_run?: boolean;
  dedupWindowDays?: number;
  filters?: {
    categories?: string[];
    minCompanySize?: string;
    geographicScope?: string[];
    excludeFunderIds?: string[];
  };
};

type SubmissionRow = {
  funder_id: string | null;
  status: string | null;
  submitted_at: string | null;
};

type SubmissionSets = {
  permanentBlockSet: Set<string>;
  captchaFunderIds: Set<string>;
  accountFunderIds: Set<string>;
  tempBlockSet: Set<string>;
  recentSet: Set<string>;
};

function bumpReason(reasons: Record<string, number>, key: string): void {
  reasons[key] = (reasons[key] ?? 0) + 1;
}

function toStringSet(rows: Array<{ funder_id: string | null }> | null): Set<string> {
  return new Set(
    (rows ?? [])
      .map(r => r.funder_id)
      .filter((id): id is string => id !== null)
  );
}

function extractDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function resolveDedupWindow(
  supabase: any,
  _organizationId: string,
  override?: number,
): Promise<number> {
  if (override !== undefined) return override;
  const result = await supabase
    .from('auto_queue_config')
    .select('dedup_window_days')
    .maybeSingle();
  const windowDays = result?.data?.dedup_window_days as number | null | undefined;
  return windowDays ?? 30;
}

async function buildSubmissionSets(
  supabase: any,
  organizationId: string,
  dedupWindowDays: number,
): Promise<SubmissionSets> {
  const queryResult = await supabase
    .from('autoapply_submissions')
    .select('funder_id, status, submitted_at')
    .eq('organization_id', organizationId)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false });

  const rows: SubmissionRow[] = queryResult?.data ?? [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dedupWindowStart = new Date(Date.now() - dedupWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const permanentBlockSet = new Set<string>();
  const captchaFunderIds = new Set<string>();
  const accountFunderIds = new Set<string>();
  const tempBlockSet = new Set<string>();
  const recentSet = new Set<string>();
  const seen = new Set<string>();

  for (const row of rows) {
    const funderId = row.funder_id;
    if (!funderId || seen.has(funderId)) continue;
    seen.add(funderId);

    const status = row.status ?? '';
    const submittedAt = row.submitted_at ?? '';

    if (status === 'captcha_blocked') {
      permanentBlockSet.add(funderId);
      captchaFunderIds.add(funderId);
    } else if (status === 'account_required') {
      permanentBlockSet.add(funderId);
      accountFunderIds.add(funderId);
    } else if ((status === 'site_error' || status === 'timeout') && submittedAt > sevenDaysAgo) {
      tempBlockSet.add(funderId);
    } else if (submittedAt > dedupWindowStart) {
      recentSet.add(funderId);
    }
  }

  return { permanentBlockSet, captchaFunderIds, accountFunderIds, tempBlockSet, recentSet };
}

export async function populateQueue(params: PopulateParams & { dry_run: true }): Promise<DryRunResult>;
export async function populateQueue(params: PopulateParams & { dry_run?: false }): Promise<PopulateResult>;
export async function populateQueue(params: PopulateParams): Promise<PopulateResult | DryRunResult> {
  const { organizationId, supabase, maxItems = 50, dry_run = false, filters } = params;
  const result: PopulateResult = { queued: 0, skipped: 0, dedupWindowDays: 30, reasons: {} };

  const dedupWindowDays = await resolveDedupWindow(supabase, organizationId, params.dedupWindowDays);
  result.dedupWindowDays = dedupWindowDays;

  // Load active request profiles for this org — required to determine what to request
  // from each funder via profile matching.
  const { data: profilesData } = await supabase
    .from('request_profiles')
    .select('id, name, request_type, target_funder_categories, target_funder_types, geographic_requirements, active, priority')
    .eq('organization_id', organizationId)
    .eq('active', true);
  const profiles: RequestProfile[] = (profilesData ?? []) as RequestProfile[];

  // Collect funder/profile pairs already pending or processing in the queue.
  // Dedup is per (funder_id, request_profile_id) pair so the same funder can be
  // queued simultaneously with different profiles (e.g. monetary AND land donation).
  const { data: pendingRows } = await supabase
    .from('submission_queue')
    .select('funder_id, request_profile_id')
    .eq('organization_id', organizationId)
    .in('status', ['pending', 'processing']);

  const pendingPairSet = new Set<string>();
  for (const row of (pendingRows ?? []) as Array<{ funder_id: string | null; request_profile_id: string | null }>) {
    if (row.funder_id && row.request_profile_id) {
      pendingPairSet.add(`${row.funder_id}:${row.request_profile_id}`);
    }
  }

  // Build per-funder classification from submission history
  const { permanentBlockSet, captchaFunderIds, accountFunderIds, tempBlockSet, recentSet } =
    await buildSubmissionSets(supabase, organizationId, dedupWindowDays);

  const userExcludeSet = new Set<string>(filters?.excludeFunderIds ?? []);

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

  type FunderRow = DryRunFunder & { type: string | null };

  const allEligible: FunderRow[] = ((funders ?? []) as any[]).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    category: (f.category as string | null) ?? null,
    city: (f.city as string | null) ?? null,
    state: (f.state as string | null) ?? null,
    giving_portal_url: f.giving_portal_url as string,
    type: (f.type as string | null) ?? null,
    matched_profile_name: null,
    matched_profile_type: null,
    match_score: null,
  }));

  // Compliance filter: skip funders in states where the org isn't registered.
  const guard = new ComplianceGuard();
  const registeredStates = new Set(await guard.getRegisteredStates(organizationId, supabase));
  const complianceHeld: FunderRow[] = [];
  const eligible: FunderRow[] = [];
  for (const funder of allEligible) {
    if (funder.state && !registeredStates.has(funder.state)) {
      complianceHeld.push(funder);
    } else {
      eligible.push(funder);
    }
  }

  // Velocity check is done once per populate call (no submissions happen during this call,
  // so the 24h rolling count is constant throughout).
  const controls = new SubmissionControls();
  const velocityCheck = await controls.checkVelocityLimits(organizationId, supabase);

  // Per-funder: profile matching → pair dedup → submission controls.
  type ReadyFunder = FunderRow & { request_profile_id: string };
  const readyFunders: ReadyFunder[] = [];

  for (const funder of eligible) {
    // Match funder to the best active request profile.
    const funderForMatch: FunderForMatching = {
      id: funder.id,
      name: funder.name,
      category: funder.category,
      type: funder.type,
      state: funder.state,
      city: funder.city,
    };
    const bestMatch = getBestProfile(funderForMatch, profiles);
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

export async function getQueueableCount(
  organizationId: string,
  supabase: any,
  dedupWindowDays?: number,
): Promise<number> {
  const windowDays = await resolveDedupWindow(supabase, organizationId, dedupWindowDays);

  const { data: pendingRows } = await supabase
    .from('submission_queue')
    .select('funder_id')
    .eq('organization_id', organizationId)
    .in('status', ['pending', 'processing']);

  const { permanentBlockSet, tempBlockSet, recentSet } =
    await buildSubmissionSets(supabase, organizationId, windowDays);

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
