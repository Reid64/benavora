"use strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComplianceGuard = void 0;
class ComplianceGuard {
    async canSolicitInState(organizationId, state, supabase) {
        const { data } = await supabase
            .from('solicitation_registrations')
            .select('expires_at, status')
            .eq('organization_id', organizationId)
            .eq('state', state)
            .eq('status', 'active')
            .maybeSingle();
        if (!data) {
            return { allowed: false, reason: 'not_registered_in_state' };
        }
        const row = data;
        if (row.expires_at && new Date(row.expires_at) < new Date()) {
            return { allowed: false, reason: 'registration_expired' };
        }
        return { allowed: true };
    }
    async getRegisteredStates(organizationId, supabase) {
        const { data } = await supabase
            .from('solicitation_registrations')
            .select('state, expires_at')
            .eq('organization_id', organizationId)
            .eq('status', 'active');
        const rows = (data ?? []);
        const now = new Date();
        return rows
            .filter(r => !r.expires_at || new Date(r.expires_at) >= now)
            .map(r => r.state);
    }
}
exports.ComplianceGuard = ComplianceGuard;
