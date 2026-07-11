"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelationshipManager = void 0;
class RelationshipManager {
    async getOrCreateRelationship(orgId, funderId, supabase) {
        const { data, error } = await supabase
            .from('funder_relationships')
            .upsert({ organization_id: orgId, funder_id: funderId }, { onConflict: 'organization_id,funder_id', ignoreDuplicates: false })
            .select('*')
            .single();
        if (error) {
            throw new Error(`Failed to upsert funder_relationship: ${error.message}`);
        }
        return data;
    }
    async recordSubmission(orgId, funderId, submissionData, supabase) {
        const existing = await this.getOrCreateRelationship(orgId, funderId, supabase);
        const updates = {
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
    async recordResponse(orgId, funderId, responseData, supabase) {
        const existing = await this.getOrCreateRelationship(orgId, funderId, supabase);
        // Compute response time in days from last_submission_at to responded_at.
        let newAvg = existing.response_time_avg_days;
        if (existing.last_submission_at) {
            const submittedMs = new Date(existing.last_submission_at).getTime();
            const respondedMs = new Date(responseData.responded_at).getTime();
            const responseDays = Math.max(0, Math.round((respondedMs - submittedMs) / (24 * 60 * 60 * 1000)));
            if (existing.response_time_avg_days === null) {
                newAvg = responseDays;
            }
            else {
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
    async recordAward(orgId, funderId, amount, supabase) {
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
    async checkContactRules(orgId, funderId, supabase, requestType) {
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
        const row = data;
        if (row.do_not_contact_until && new Date(row.do_not_contact_until) > new Date()) {
            return {
                canContact: false,
                reason: `do_not_contact_until ${row.do_not_contact_until}`,
            };
        }
        if (requestType &&
            Array.isArray(row.disallowed_request_types) &&
            row.disallowed_request_types.includes(requestType)) {
            return {
                canContact: false,
                reason: `request_type '${requestType}' is disallowed for this funder`,
            };
        }
        return { canContact: true };
    }
    async getRelationshipSummary(orgId, funderId, supabase) {
        const { data } = await supabase
            .from('funder_relationships')
            .select('*')
            .eq('organization_id', orgId)
            .eq('funder_id', funderId)
            .maybeSingle();
        return data ?? null;
    }
}
exports.RelationshipManager = RelationshipManager;
