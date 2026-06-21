/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FunderRelationship {
  id: string;
  organization_id: string;
  funder_id: string;
  relationship_status: string;
  last_submission_at: string | null;
  last_response_at: string | null;
  total_submissions: number;
  total_funded: number;
  preferred_channel: string | null;
  preferred_request_type: string | null;
  do_not_contact_until: string | null;
  contact_notes: string | null;
  board_meeting_months: number[] | null;
  fiscal_year_end_month: number | null;
  response_time_avg_days: number | null;
  funder_preferences: Record<string, unknown>;
  disallowed_request_types: string[] | null;
  max_ask_amount: number | null;
  relationship_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface ContactRulesResult {
  canContact: boolean;
  reason?: string;
}

export interface SubmissionData {
  request_type?: string;
  submitted_at?: string;
}

export interface ResponseData {
  responded_at: string;
  response_type?: string;
}

export class RelationshipManager {
  async getOrCreateRelationship(
    orgId: string,
    funderId: string,
    supabase: any,
  ): Promise<FunderRelationship> {
    const { data, error } = await supabase
      .from('funder_relationships')
      .upsert(
        { organization_id: orgId, funder_id: funderId },
        { onConflict: 'organization_id,funder_id', ignoreDuplicates: false },
      )
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to upsert funder_relationship: ${error.message}`);
    }

    return data as FunderRelationship;
  }

  async recordSubmission(
    orgId: string,
    funderId: string,
    submissionData: SubmissionData,
    supabase: any,
  ): Promise<void> {
    const existing = await this.getOrCreateRelationship(orgId, funderId, supabase);

    const updates: Record<string, unknown> = {
      total_submissions: existing.total_submissions + 1,
      last_submission_at: submissionData.submitted_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (submissionData.request_type) {
      updates['preferred_request_type'] = submissionData.request_type;
    }

    await supabase
      .from('funder_relationships')
      .update(updates)
      .eq('organization_id', orgId)
      .eq('funder_id', funderId);
  }

  async recordResponse(
    orgId: string,
    funderId: string,
    responseData: ResponseData,
    supabase: any,
  ): Promise<void> {
    const existing = await this.getOrCreateRelationship(orgId, funderId, supabase);

    // Compute response time in days from last_submission_at to responded_at.
    let newAvg = existing.response_time_avg_days;
    if (existing.last_submission_at) {
      const submittedMs = new Date(existing.last_submission_at).getTime();
      const respondedMs = new Date(responseData.responded_at).getTime();
      const responseDays = Math.max(0, Math.round((respondedMs - submittedMs) / (24 * 60 * 60 * 1000)));

      if (existing.response_time_avg_days === null) {
        newAvg = responseDays;
      } else {
        // Running average weighted by total_submissions
        const n = existing.total_submissions;
        newAvg = Math.round((existing.response_time_avg_days * (n - 1) + responseDays) / n);
      }
    }

    await supabase
      .from('funder_relationships')
      .update({
        last_response_at: responseData.responded_at,
        response_time_avg_days: newAvg,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', orgId)
      .eq('funder_id', funderId);
  }

  async recordAward(
    orgId: string,
    funderId: string,
    amount: number,
    supabase: any,
  ): Promise<void> {
    const existing = await this.getOrCreateRelationship(orgId, funderId, supabase);

    await supabase
      .from('funder_relationships')
      .update({
        relationship_status: 'funded',
        total_funded: existing.total_funded + amount,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', orgId)
      .eq('funder_id', funderId);
  }

  async checkContactRules(
    orgId: string,
    funderId: string,
    supabase: any,
    requestType?: string,
  ): Promise<ContactRulesResult> {
    const { data } = await supabase
      .from('funder_relationships')
      .select('do_not_contact_until, disallowed_request_types')
      .eq('organization_id', orgId)
      .eq('funder_id', funderId)
      .maybeSingle();

    if (data === null) {
      // No relationship record yet — first contact, always allowed.
      return { canContact: true };
    }

    const row = data as {
      do_not_contact_until: string | null;
      disallowed_request_types: string[] | null;
    };

    if (row.do_not_contact_until && new Date(row.do_not_contact_until) > new Date()) {
      return {
        canContact: false,
        reason: `do_not_contact_until ${row.do_not_contact_until}`,
      };
    }

    if (
      requestType &&
      Array.isArray(row.disallowed_request_types) &&
      row.disallowed_request_types.includes(requestType)
    ) {
      return {
        canContact: false,
        reason: `request_type '${requestType}' is disallowed for this funder`,
      };
    }

    return { canContact: true };
  }

  async getRelationshipSummary(
    orgId: string,
    funderId: string,
    supabase: any,
  ): Promise<FunderRelationship | null> {
    const { data } = await supabase
      .from('funder_relationships')
      .select('*')
      .eq('organization_id', orgId)
      .eq('funder_id', funderId)
      .maybeSingle();

    return (data as FunderRelationship) ?? null;
  }
}
