/* eslint-disable @typescript-eslint/no-explicit-any */

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

  // Collect funder IDs already pending/processing in the queue
  const { data: pendingRows } = await supabase
    .from('submission_queue')
    .select('funder_id')
    .eq('organization_id', organizationId)
    .in('status', ['pending', 'processing']);

  const pendingSet = toStringSet(pendingRows);

  // Build per-funder classification from submission history
  const { permanentBlockSet, captchaFunderIds, accountFunderIds, tempBlockSet, recentSet } =
    await buildSubmissionSets(supabase, organizationId, dedupWindowDays);

  const userExcludeSet = new Set<string>(filters?.excludeFunderIds ?? []);

  const allExcluded = [
    ...pendingSet,
    ...permanentBlockSet,
    ...tempBlockSet,
    ...recentSet,
    ...userExcludeSet,
  ];
  const uniqueExcluded = [...new Set(allExcluded)];

  // Query eligible funders
  let query = supabase
    .from('funders')
    .select('id, name, category, city, state, giving_portal_url')
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

  const eligible: DryRunFunder[] = funders ?? [];

  // Preview mode: return the candidate funders without writing to the queue.
  if (dry_run) {
    return { funders: eligible, dedupWindowDays };
  }

  if (eligible.length > 0) {
    const inserts = eligible.map(funder => ({
      organization_id: organizationId,
      funder_id: funder.id,
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

    result.queued = eligible.length;
  }

  // Report skip reasons
  for (const id of pendingSet) {
    if (!userExcludeSet.has(id)) {
      bumpReason(result.reasons, 'already_pending');
      result.skipped++;
    }
  }
  for (const id of captchaFunderIds) {
    if (!pendingSet.has(id) && !userExcludeSet.has(id)) {
      bumpReason(result.reasons, 'captcha_blocked_permanent');
      result.skipped++;
    }
  }
  for (const id of accountFunderIds) {
    if (!pendingSet.has(id) && !userExcludeSet.has(id)) {
      bumpReason(result.reasons, 'account_required_permanent');
      result.skipped++;
    }
  }
  for (const id of tempBlockSet) {
    if (!pendingSet.has(id) && !permanentBlockSet.has(id) && !userExcludeSet.has(id)) {
      bumpReason(result.reasons, 'recently_failed');
      result.skipped++;
    }
  }
  for (const id of recentSet) {
    if (!pendingSet.has(id) && !permanentBlockSet.has(id) && !tempBlockSet.has(id) && !userExcludeSet.has(id)) {
      bumpReason(result.reasons, 'recently_submitted');
      result.skipped++;
    }
  }
  for (const id of userExcludeSet) {
    if (!pendingSet.has(id) && !permanentBlockSet.has(id) && !tempBlockSet.has(id) && !recentSet.has(id)) {
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
