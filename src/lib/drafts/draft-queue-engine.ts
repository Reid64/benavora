import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { TemplateSelector } from './template-selector';
import type { DraftAutomationConfig } from './template-selector';

type DraftQueueRow = Database['public']['Tables']['draft_queue']['Row'];
type DraftQueueInsert = Database['public']['Tables']['draft_queue']['Insert'];
type DraftQueueUpdate = Database['public']['Tables']['draft_queue']['Update'];
type Opportunity = Database['public']['Tables']['opportunities']['Row'];
type DraftQueueStatus = Database['public']['Enums']['draft_queue_status'];

export interface QueueResult {
  queued: number;
  skipped_low_score: number;
  skipped_excluded: number;
  skipped_duplicate: number;
}

export type DraftQueueItem = DraftQueueRow & {
  opportunity: Opportunity | null;
};

export interface QueueStats {
  pending: number;
  generating: number;
  generated: number;
  in_review: number;
  approved: number;
  rejected: number;
  submitted: number;
  failed: number;
  total: number;
  avg_confidence: number;
  by_priority: Record<string, number>;
}

function calculatePriority(deadlineDate: string | null): number {
  if (!deadlineDate) return 5;
  const now = new Date();
  const deadline = new Date(deadlineDate);
  const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil <= 7) return 1;
  if (daysUntil <= 14) return 2;
  if (daysUntil <= 30) return 3;
  return 4;
}

function toTemplateConfig(config: { preferred_template_rules: unknown }): DraftAutomationConfig {
  const rules = config.preferred_template_rules;
  return {
    preferred_template_rules:
      rules !== null && typeof rules === 'object' && !Array.isArray(rules)
        ? (rules as Record<string, string>)
        : null,
  };
}

export class DraftQueueEngine {
  private readonly supabase: SupabaseClient;
  private readonly templateSelector: TemplateSelector;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.templateSelector = new TemplateSelector();
  }

  async processNewOpportunities(orgId: string): Promise<QueueResult> {
    const result: QueueResult = {
      queued: 0,
      skipped_low_score: 0,
      skipped_excluded: 0,
      skipped_duplicate: 0,
    };

    const { data: config } = await this.supabase
      .from('draft_automation_config')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!config?.is_enabled) return result;

    const minScore = (config.min_eligibility_score ?? 70) as number;
    const excludedCategories: string[] = (config.excluded_categories as string[] | null) ?? [];
    const templateConfig = toTemplateConfig(config);

    const { data: opportunities } = await this.supabase
      .from('opportunities')
      .select('*')
      .eq('organization_id', orgId);

    for (const opp of (opportunities ?? []) as Opportunity[]) {
      if (excludedCategories.includes(opp.category as string)) {
        result.skipped_excluded++;
        continue;
      }

      if (opp.eligibility_score === null) {
        result.skipped_low_score++;
        continue;
      }

      if (opp.eligibility_score < minScore) {
        result.skipped_low_score++;
        continue;
      }

      const selection = this.templateSelector.selectTemplate(opp, templateConfig);

      const { data: existing } = await this.supabase
        .from('draft_queue')
        .select('id')
        .eq('organization_id', orgId)
        .eq('opportunity_id', opp.id)
        .eq('template_type', selection.template_type)
        .maybeSingle();

      if (existing) {
        result.skipped_duplicate++;
        continue;
      }

      const priority = calculatePriority(opp.deadline);

      const insertRow: DraftQueueInsert = {
        organization_id: orgId,
        opportunity_id: opp.id,
        status: 'pending',
        trigger_reason: 'eligibility_threshold',
        template_type: selection.template_type,
        priority,
        deadline_date: opp.deadline,
      };

      await this.supabase.from('draft_queue').insert(insertRow);
      result.queued++;
    }

    return result;
  }

  async processDeadlineApproaching(orgId: string): Promise<QueueResult> {
    const result: QueueResult = {
      queued: 0,
      skipped_low_score: 0,
      skipped_excluded: 0,
      skipped_duplicate: 0,
    };

    const { data: config } = await this.supabase
      .from('draft_automation_config')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (!config?.is_enabled) return result;

    const minScore = (config.min_eligibility_score ?? 70) as number;
    const excludedCategories: string[] = (config.excluded_categories as string[] | null) ?? [];
    const deadlineDays = (config.auto_generate_on_deadline_days ?? 14) as number;
    const templateConfig = toTemplateConfig(config);

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + deadlineDays);

    const { data: opportunities } = await this.supabase
      .from('opportunities')
      .select('*')
      .eq('organization_id', orgId)
      .not('deadline', 'is', null)
      .gte('deadline', now.toISOString())
      .lte('deadline', cutoff.toISOString());

    for (const opp of (opportunities ?? []) as Opportunity[]) {
      if (excludedCategories.includes(opp.category as string)) {
        result.skipped_excluded++;
        continue;
      }

      if (opp.eligibility_score === null || opp.eligibility_score < minScore) {
        result.skipped_low_score++;
        continue;
      }

      const selection = this.templateSelector.selectTemplate(opp, templateConfig);

      const { data: existing } = await this.supabase
        .from('draft_queue')
        .select('id')
        .eq('organization_id', orgId)
        .eq('opportunity_id', opp.id)
        .eq('template_type', selection.template_type)
        .maybeSingle();

      if (existing) {
        result.skipped_duplicate++;
        continue;
      }

      const priority = calculatePriority(opp.deadline);
      const elevatedPriority = Math.max(1, priority - 1);

      const insertRow: DraftQueueInsert = {
        organization_id: orgId,
        opportunity_id: opp.id,
        status: 'pending',
        trigger_reason: 'deadline_approaching',
        template_type: selection.template_type,
        priority: elevatedPriority,
        deadline_date: opp.deadline,
      };

      await this.supabase.from('draft_queue').insert(insertRow);
      result.queued++;
    }

    return result;
  }

  async getQueueForOrg(
    orgId: string,
    filters?: { status?: DraftQueueStatus; priority?: number }
  ): Promise<DraftQueueItem[]> {
    let query = this.supabase
      .from('draft_queue')
      .select('*, opportunity:opportunities(*)')
      .eq('organization_id', orgId)
      .order('priority', { ascending: true })
      .order('deadline_date', { ascending: true });

    if (filters?.status !== undefined) {
      query = query.eq('status', filters.status);
    }
    if (filters?.priority !== undefined) {
      query = query.eq('priority', filters.priority);
    }

    const { data } = await query;
    return (data ?? []) as unknown as DraftQueueItem[];
  }

  async updateQueueItemStatus(
    itemId: string,
    status: string,
    metadata?: object
  ): Promise<void> {
    const now = new Date().toISOString();
    const update: DraftQueueUpdate = {
      status: status as DraftQueueStatus,
      updated_at: now,
    };

    if (status === 'review') update.reviewed_at = now;
    else if (status === 'approved') update.approved_at = now;
    else if (status === 'generated') update.auto_generated_at = now;
    else if (status === 'submitted') update.submitted_to_autoapply_at = now;

    const merged: DraftQueueUpdate = metadata
      ? { ...update, ...(metadata as DraftQueueUpdate) }
      : update;

    await this.supabase.from('draft_queue').update(merged).eq('id', itemId);
  }

  async getQueueStats(orgId: string): Promise<QueueStats> {
    const { data } = await this.supabase
      .from('draft_queue')
      .select('status, priority, confidence_score')
      .eq('organization_id', orgId);

    const rows = (data ?? []) as Array<{
      status: DraftQueueStatus | null;
      priority: number | null;
      confidence_score: number | null;
    }>;

    const stats: QueueStats = {
      pending: 0,
      generating: 0,
      generated: 0,
      in_review: 0,
      approved: 0,
      rejected: 0,
      submitted: 0,
      failed: 0,
      total: rows.length,
      avg_confidence: 0,
      by_priority: {},
    };

    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const row of rows) {
      switch (row.status) {
        case 'pending': stats.pending++; break;
        case 'generating': stats.generating++; break;
        case 'generated': stats.generated++; break;
        case 'review': stats.in_review++; break;
        case 'approved': stats.approved++; break;
        case 'rejected': stats.rejected++; break;
        case 'submitted': stats.submitted++; break;
        case 'failed': stats.failed++; break;
      }

      const p = String(row.priority ?? 5);
      stats.by_priority[p] = (stats.by_priority[p] ?? 0) + 1;

      if (row.confidence_score !== null) {
        confidenceSum += row.confidence_score;
        confidenceCount++;
      }
    }

    stats.avg_confidence =
      confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : 0;

    return stats;
  }
}
