/* eslint-disable @typescript-eslint/no-explicit-any */

type PopulateResult = {
  queued: number;
  skipped: number;
  reasons: Record<string, number>;
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

export async function populateQueue(params: {
  organizationId: string;
  supabase: any;
  maxItems?: number;
  filters?: {
    categories?: string[];
    minCompanySize?: string;
    geographicScope?: string[];
    excludeFunderIds?: string[];
  };
}): Promise<PopulateResult> {
  const { organizationId, supabase, maxItems = 50, filters } = params;
  const result: PopulateResult = { queued: 0, skipped: 0, reasons: {} };
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Collect funder IDs already pending/processing in the queue
  const { data: pendingRows } = await supabase
    .from('submission_queue')
    .select('funder_id')
    .eq('organization_id', organizationId)
    .in('status', ['pending', 'processing']);

  const pendingSet = toStringSet(pendingRows);

  // Collect funder IDs with a submission within the last 30 days
  const { data: recentRows } = await supabase
    .from('autoapply_submissions')
    .select('funder_id')
    .eq('organization_id', organizationId)
    .not('submitted_at', 'is', null)
    .gt('submitted_at', thirtyDaysAgo);

  const recentSet = toStringSet(recentRows);
  const userExcludeSet = new Set<string>(filters?.excludeFunderIds ?? []);

  const allExcluded = [...pendingSet, ...recentSet, ...userExcludeSet];

  // Query eligible funders
  let query = supabase
    .from('funders')
    .select('id')
    .eq('organization_id', organizationId)
    .not('giving_portal_url', 'is', null)
    .neq('giving_portal_url', '');

  if (allExcluded.length > 0) {
    query = query.not('id', 'in', `(${allExcluded.join(',')})`);
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

  const eligible: Array<{ id: string }> = funders ?? [];

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

  // Report skip reasons based on which exclusion set each excluded funder fell into
  for (const id of pendingSet) {
    if (!userExcludeSet.has(id)) {
      bumpReason(result.reasons, 'already_pending');
      result.skipped++;
    }
  }
  for (const id of recentSet) {
    if (!pendingSet.has(id) && !userExcludeSet.has(id)) {
      bumpReason(result.reasons, 'recently_submitted');
      result.skipped++;
    }
  }
  for (const id of userExcludeSet) {
    if (!pendingSet.has(id) && !recentSet.has(id)) {
      bumpReason(result.reasons, 'filtered_out');
      result.skipped++;
    }
  }

  return result;
}

export async function getQueueableCount(organizationId: string, supabase: any): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: pendingRows } = await supabase
    .from('submission_queue')
    .select('funder_id')
    .eq('organization_id', organizationId)
    .in('status', ['pending', 'processing']);

  const { data: recentRows } = await supabase
    .from('autoapply_submissions')
    .select('funder_id')
    .eq('organization_id', organizationId)
    .not('submitted_at', 'is', null)
    .gt('submitted_at', thirtyDaysAgo);

  const excluded = [
    ...toStringSet(pendingRows),
    ...toStringSet(recentRows),
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
