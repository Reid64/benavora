/* eslint-disable @typescript-eslint/no-explicit-any */

// Queue Control Plane — pause/resume controls at platform, domain, funder, and tenant level.
// Governs: AUTOAPPLY_ARCHITECTURE_V2.md §8F.
//
// Control levels are checked in descending precedence:
//   platform → domain → funder → tenant
//
// All state is persisted in the `queue_controls` table (no in-memory state).
// The queue processor calls isBlocked() before processing each item.
//
// Note: queue_controls has no UNIQUE constraint on (control_type, target_id),
// so we use delete-then-insert for idempotent pause operations rather than upsert.

export interface ControlStatus {
  id: string;
  control_type: string;
  target_id: string | null;
  paused: boolean;
  paused_by: string | null;
  paused_at: string | null;
  reason: string | null;
  created_at: string;
}

export interface BlockResult {
  blocked: boolean;
  reason?: string;
  controlType?: string;
}

export class QueueControlPlane {
  async pauseTenant(
    orgId: string,
    reason: string,
    pausedBy: string,
    supabase: any,
  ): Promise<void> {
    await this.setPaused('tenant', orgId, true, reason, pausedBy, supabase);
  }

  async resumeTenant(orgId: string, supabase: any): Promise<void> {
    await supabase
      .from('queue_controls')
      .delete()
      .eq('control_type', 'tenant')
      .eq('target_id', orgId);
  }

  async pauseFunder(
    funderId: string,
    reason: string,
    supabase: any,
    pausedBy?: string,
  ): Promise<void> {
    await this.setPaused('funder', funderId, true, reason, pausedBy ?? null, supabase);
  }

  async resumeFunder(funderId: string, supabase: any): Promise<void> {
    await supabase
      .from('queue_controls')
      .delete()
      .eq('control_type', 'funder')
      .eq('target_id', funderId);
  }

  async pauseDomain(
    domain: string,
    reason: string,
    supabase: any,
    pausedBy?: string,
  ): Promise<void> {
    await this.setPaused('domain', domain, true, reason, pausedBy ?? null, supabase);
  }

  async resumeDomain(domain: string, supabase: any): Promise<void> {
    await supabase
      .from('queue_controls')
      .delete()
      .eq('control_type', 'domain')
      .eq('target_id', domain);
  }

  async pausePlatform(
    reason: string,
    pausedBy: string,
    supabase: any,
  ): Promise<void> {
    console.error(`[QueueControlPlane] PLATFORM PAUSED by ${pausedBy}: ${reason}`);
    await this.setPaused('platform', 'global', true, reason, pausedBy, supabase);
  }

  async resumePlatform(supabase: any): Promise<void> {
    await supabase
      .from('queue_controls')
      .delete()
      .eq('control_type', 'platform')
      .eq('target_id', 'global');
  }

  /**
   * Check all control levels in descending precedence: platform → domain → funder → tenant.
   * Returns the first block found, or { blocked: false } if clear.
   */
  async isBlocked(params: {
    orgId?: string;
    funderId?: string;
    portalUrl?: string;
    supabase: any;
  }): Promise<BlockResult> {
    const { orgId, funderId, portalUrl, supabase } = params;

    // 1. Platform-level kill switch
    const { data: platformRows } = await supabase
      .from('queue_controls')
      .select('reason')
      .eq('control_type', 'platform')
      .eq('target_id', 'global')
      .eq('paused', true)
      .limit(1);

    const platformRow = ((platformRows ?? []) as Array<{ reason: string | null }>)[0];
    if (platformRow !== undefined) {
      return {
        blocked: true,
        reason: platformRow.reason ?? 'Platform is paused (emergency kill switch).',
        controlType: 'platform',
      };
    }

    // 2. Domain-level pause
    if (portalUrl) {
      const domain = extractDomain(portalUrl);
      const { data: domainRows } = await supabase
        .from('queue_controls')
        .select('reason')
        .eq('control_type', 'domain')
        .eq('target_id', domain)
        .eq('paused', true)
        .limit(1);

      const domainRow = ((domainRows ?? []) as Array<{ reason: string | null }>)[0];
      if (domainRow !== undefined) {
        return {
          blocked: true,
          reason: domainRow.reason ?? `Domain "${domain}" is paused.`,
          controlType: 'domain',
        };
      }
    }

    // 3. Funder-level pause
    if (funderId) {
      const { data: funderRows } = await supabase
        .from('queue_controls')
        .select('reason')
        .eq('control_type', 'funder')
        .eq('target_id', funderId)
        .eq('paused', true)
        .limit(1);

      const funderRow = ((funderRows ?? []) as Array<{ reason: string | null }>)[0];
      if (funderRow !== undefined) {
        return {
          blocked: true,
          reason: funderRow.reason ?? 'Funder submissions are paused.',
          controlType: 'funder',
        };
      }
    }

    // 4. Tenant (org) level pause
    if (orgId) {
      const { data: tenantRows } = await supabase
        .from('queue_controls')
        .select('reason')
        .eq('control_type', 'tenant')
        .eq('target_id', orgId)
        .eq('paused', true)
        .limit(1);

      const tenantRow = ((tenantRows ?? []) as Array<{ reason: string | null }>)[0];
      if (tenantRow !== undefined) {
        return {
          blocked: true,
          reason: tenantRow.reason ?? 'Organization submissions are paused.',
          controlType: 'tenant',
        };
      }
    }

    return { blocked: false };
  }

  /** Return all currently active (paused=true) controls. */
  async getStatus(supabase: any): Promise<ControlStatus[]> {
    const { data } = await supabase
      .from('queue_controls')
      .select('*')
      .eq('paused', true)
      .order('created_at', { ascending: false });

    return (data ?? []) as ControlStatus[];
  }

  // Delete any existing rows for this control_type+target_id, then insert a fresh one.
  // Avoids the need for a UNIQUE constraint on (control_type, target_id).
  private async setPaused(
    controlType: string,
    targetId: string,
    paused: boolean,
    reason: string,
    pausedBy: string | null,
    supabase: any,
  ): Promise<void> {
    await supabase
      .from('queue_controls')
      .delete()
      .eq('control_type', controlType)
      .eq('target_id', targetId);

    await supabase.from('queue_controls').insert({
      control_type: controlType,
      target_id: targetId,
      paused,
      paused_by: pausedBy,
      paused_at: new Date().toISOString(),
      reason,
    });
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
