import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type DraftQueueRow = Database['public']['Tables']['draft_queue']['Row'];
type AppUpdate = Database['public']['Tables']['applications']['Update'];
type PipelineStage = Database['public']['Enums']['pipeline_stage'];
type DraftTemplateType = Database['public']['Enums']['draft_template_type'];
type DraftQueueStatus = Database['public']['Enums']['draft_queue_status'];

export interface BridgeResult {
  success: boolean;
  application_id?: string;
  submission_queue_id?: string;
  error?: string;
}

const ADVANCED_STAGES: PipelineStage[] = [
  'ready_for_review',
  'submitted',
  'follow_up_due',
  'awarded',
  'denied',
  'reporting_required',
  'renewal_opportunity',
];

function mapAutomationMode(funderLevel: string | null | undefined): string {
  switch (funderLevel) {
    case 'full_auto': return 'autonomous';
    case 'manual_only': return 'manual';
    default: return 'batch';
  }
}

type DraftQueueWithRelations = DraftQueueRow & {
  opportunity: {
    id: string;
    name: string;
    funder_id: string | null;
    funder: { id: string; name: string; automation_level: string | null } | null;
  } | null;
};

export class SubmissionBridge {
  private readonly supabase: SupabaseClient<Database>;

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase;
  }

  async bridgeToSubmission(queueItemId: string): Promise<BridgeResult> {
    // 1. Fetch the draft queue item with its draft and opportunity.
    const { data: raw, error: fetchError } = await this.supabase
      .from('draft_queue')
      .select('*, opportunity:opportunities(id, name, funder_id, funder:funders(id, name, automation_level))')
      .eq('id', queueItemId)
      .maybeSingle();

    if (fetchError || !raw) {
      return { success: false, error: 'Draft queue item not found.' };
    }

    const item = raw as unknown as DraftQueueWithRelations;
    const orgId = item.organization_id;
    const opp = item.opportunity;

    if (!opp) {
      return { success: false, error: 'Opportunity not found for this draft queue item.' };
    }

    const funderId = opp.funder_id;
    if (!funderId) {
      return { success: false, error: 'Opportunity has no linked funder.' };
    }

    // Fetch draft content from draft_versions if a draft was generated.
    let draftContent: string | null = null;
    let draftConfidence: number | null = null;
    let draftSources: Database['public']['Tables']['applications']['Row']['draft_knowledge_sources'] = null;

    if (item.draft_id) {
      const { data: draftVersion } = await this.supabase
        .from('draft_versions')
        .select('content, confidence_score, knowledge_sources')
        .eq('id', item.draft_id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (draftVersion) {
        draftContent = draftVersion.content;
        draftConfidence = draftVersion.confidence_score ?? null;
        draftSources = draftVersion.knowledge_sources ?? null;
      }
    }

    const templateType = item.template_type as DraftTemplateType | null;
    const now = new Date().toISOString();

    // 2 & 3. Find or create the application for this opportunity; verify draft is linked.
    let applicationId: string | null = item.application_id ?? null;

    if (!applicationId) {
      const { data: existing } = await this.supabase
        .from('applications')
        .select('id, stage, draft_content')
        .eq('opportunity_id', opp.id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (existing) {
        applicationId = existing.id;
        const updates: AppUpdate = { updated_at: now };
        if (!ADVANCED_STAGES.includes(existing.stage)) updates.stage = 'ready_for_review';
        if (draftContent !== null && existing.draft_content === null) {
          updates.draft_content = draftContent;
          updates.draft_template_type = templateType;
          updates.draft_confidence_score = draftConfidence;
          updates.draft_knowledge_sources = draftSources;
        }
        await this.supabase.from('applications').update(updates).eq('id', applicationId);
      } else {
        const { data: created, error: createError } = await this.supabase
          .from('applications')
          .insert({
            organization_id: orgId,
            opportunity_id: opp.id,
            stage: 'ready_for_review' as PipelineStage,
            draft_content: draftContent,
            draft_template_type: templateType,
            draft_confidence_score: draftConfidence,
            draft_knowledge_sources: draftSources,
          })
          .select('id')
          .single();

        if (createError || !created) {
          return { success: false, error: 'Failed to create application.' };
        }
        applicationId = created.id;
      }
    } else {
      // Application already linked — update stage and draft content if needed.
      const { data: app } = await this.supabase
        .from('applications')
        .select('id, stage, draft_content')
        .eq('id', applicationId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (app) {
        const updates: AppUpdate = { updated_at: now };
        if (!ADVANCED_STAGES.includes(app.stage)) updates.stage = 'ready_for_review';
        if (draftContent !== null && app.draft_content === null) {
          updates.draft_content = draftContent;
          updates.draft_template_type = templateType;
          updates.draft_confidence_score = draftConfidence;
          updates.draft_knowledge_sources = draftSources;
        }
        await this.supabase.from('applications').update(updates).eq('id', applicationId);
      }
    }

    // Link draft_version.application_id if not already linked.
    if (item.draft_id && applicationId) {
      await this.supabase
        .from('draft_versions')
        .update({ application_id: applicationId })
        .eq('id', item.draft_id)
        .eq('organization_id', orgId)
        .is('application_id', null);
    }

    // Back-fill draft_queue.application_id so the linkage is bidirectional.
    if (!item.application_id && applicationId) {
      await this.supabase
        .from('draft_queue')
        .update({ application_id: applicationId, updated_at: now })
        .eq('id', queueItemId);
    }

    // 4. Create submission_queue entry.
    // submission_queue is funder-scoped (no application_id column); the draft_queue row
    // carries application_id providing the draft→application→queue linkage.
    const automationMode = mapAutomationMode(opp.funder?.automation_level);
    const priority = item.priority ?? 100;

    const { data: sqEntry, error: sqError } = await this.supabase
      .from('submission_queue')
      .insert({
        organization_id: orgId,
        funder_id: funderId,
        priority,
        status: 'pending',
        automation_mode: automationMode,
      })
      .select('id')
      .single();

    if (sqError || !sqEntry) {
      return { success: false, error: 'Failed to create AutoApply queue entry.' };
    }

    // 5. Mark draft queue item as submitted.
    await this.supabase
      .from('draft_queue')
      .update({
        status: 'submitted' as DraftQueueStatus,
        submitted_to_autoapply_at: now,
        updated_at: now,
      })
      .eq('id', queueItemId);

    // 6. Create notification.
    await this.supabase.from('automation_notifications').insert({
      organization_id: orgId,
      event_type: 'draft_submitted_to_autoapply',
      title: 'Draft submitted to AutoApply',
      message: `Draft for "${opp.name}" has been submitted to AutoApply queue.`,
      is_read: false,
      sent_via: 'in_app',
      related_entity_type: 'draft_queue',
      related_entity_id: queueItemId,
    });

    return {
      success: true,
      application_id: applicationId ?? undefined,
      submission_queue_id: sqEntry.id,
    };
  }

  async bulkBridge(orgId: string): Promise<{ bridged: number; failed: number }> {
    const { data: items } = await this.supabase
      .from('draft_queue')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'approved' as DraftQueueStatus)
      .is('submitted_to_autoapply_at', null);

    let bridged = 0;
    let failed = 0;

    for (const item of (items ?? []) as { id: string }[]) {
      const result = await this.bridgeToSubmission(item.id);
      if (result.success) bridged++;
      else failed++;
    }

    return { bridged, failed };
  }

  async canBridge(queueItemId: string): Promise<{ canBridge: boolean; reason?: string }> {
    const { data: raw, error } = await this.supabase
      .from('draft_queue')
      .select('id, organization_id, status, application_id, opportunity:opportunities(id, funder_id)')
      .eq('id', queueItemId)
      .maybeSingle();

    if (error || !raw) {
      return { canBridge: false, reason: 'Draft queue item not found.' };
    }

    const item = raw as unknown as Pick<DraftQueueRow, 'id' | 'organization_id' | 'status' | 'application_id'> & {
      opportunity: { id: string; funder_id: string | null } | null;
    };

    // Check 1: Draft must be in approved state.
    if (item.status !== 'approved') {
      return {
        canBridge: false,
        reason: `Draft must be approved before bridging (current status: ${item.status ?? 'unknown'}).`,
      };
    }

    const funderId = item.opportunity?.funder_id ?? null;

    if (funderId) {
      // Check 2: Funder must not be paused in queue_controls.
      const { data: control } = await this.supabase
        .from('queue_controls')
        .select('paused')
        .eq('control_type', 'funder')
        .eq('target_id', funderId)
        .eq('paused', true)
        .maybeSingle();

      if (control) {
        return { canBridge: false, reason: 'Funder is paused in the AutoApply queue.' };
      }

      // Check 3: No duplicate pending submission for this funder.
      const { data: duplicate } = await this.supabase
        .from('submission_queue')
        .select('id')
        .eq('organization_id', item.organization_id)
        .eq('funder_id', funderId)
        .in('status', ['pending', 'processing'])
        .maybeSingle();

      if (duplicate) {
        return {
          canBridge: false,
          reason: 'This funder already has a pending AutoApply submission in the queue.',
        };
      }
    }

    // Check 4: If an application exists, it must have at least one document attached.
    const applicationId = item.application_id;
    if (applicationId) {
      const { data: docs } = await this.supabase
        .from('application_documents')
        .select('id')
        .eq('application_id', applicationId)
        .limit(1);

      if (!docs || docs.length === 0) {
        return {
          canBridge: false,
          reason: 'No documents are attached to this application. Attach required documents before submitting.',
        };
      }
    }

    return { canBridge: true };
  }
}
