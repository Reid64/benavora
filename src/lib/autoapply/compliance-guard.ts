/* eslint-disable @typescript-eslint/no-explicit-any */

export type ComplianceCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'registration_expired' | 'not_registered_in_state' };

export class ComplianceGuard {
  async canSolicitInState(
    organizationId: string,
    state: string,
    supabase: any,
  ): Promise<ComplianceCheckResult> {
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

    const row = data as { expires_at: string | null; status: string };
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return { allowed: false, reason: 'registration_expired' };
    }

    return { allowed: true };
  }

  async getRegisteredStates(
    organizationId: string,
    supabase: any,
  ): Promise<string[]> {
    const { data } = await supabase
      .from('solicitation_registrations')
      .select('state, expires_at')
      .eq('organization_id', organizationId)
      .eq('status', 'active');

    const rows = (data ?? []) as Array<{ state: string; expires_at: string | null }>;
    const now = new Date();
    return rows
      .filter(r => !r.expires_at || new Date(r.expires_at) >= now)
      .map(r => r.state);
  }
}
