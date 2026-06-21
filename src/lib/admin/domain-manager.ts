import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, decryptToken } from "@/lib/email/encryption";

export type SendingDomain = {
  id: string;
  domain: string;
  provider: string;
  api_key_encrypted: string | null;
  dns_verified: boolean;
  warmup_status: string;
  warmup_started_at: string | null;
  current_daily_limit: number;
  target_daily_limit: number;
  warmup_day: number;
  total_sent: number;
  total_bounced: number;
  total_complained: number;
  bounce_rate: number;
  complaint_rate: number;
  is_active: boolean;
  health_status: string;
  last_health_check_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DnsRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  status: string;
  ttl?: string;
  priority?: number;
};

export type DomainHealth = {
  domainId: string;
  bounce_rate: number;
  complaint_rate: number;
  status: "healthy" | "warning" | "critical" | "unknown";
};

export type WarmupStatus = {
  warmup_day: number;
  current_daily_limit: number;
  sends_today: number;
  warmup_status: string;
  warmup_started_at: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export class DomainManager {
  private supabase = createAdminClient();

  async addDomain(
    domain: string,
    apiKey: string,
    provider = "resend",
  ): Promise<SendingDomain> {
    const encrypted = encryptToken(apiKey);
    const { data, error } = await this.supabase
      .from("sending_domains")
      .insert({ domain, provider, api_key_encrypted: encrypted })
      .select()
      .single();

    if (error) throw new Error(`Failed to add domain: ${error.message}`);
    return data as SendingDomain;
  }

  async verifyDns(
    domainId: string,
  ): Promise<{ verified: boolean; records: DnsRecord[] }> {
    const { data: row, error } = await this.supabase
      .from("sending_domains")
      .select("domain, api_key_encrypted")
      .eq("id", domainId)
      .single();

    if (error || !row) throw new Error("Domain not found");

    const encryptedKey = (row as { domain: string; api_key_encrypted: string | null }).api_key_encrypted;
    if (!encryptedKey) throw new Error("No API key configured for this domain");

    const apiKey = decryptToken(encryptedKey);
    const domainName = (row as { domain: string }).domain;

    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Resend API error: ${res.status}`);
    }

    const payload = (await res.json()) as {
      data?: Array<{
        name: string;
        status: string;
        records?: DnsRecord[];
      }>;
    };

    const match = payload.data?.find((d) => d.name === domainName);
    const verified = match?.status === "verified";
    const records: DnsRecord[] = match?.records ?? [];

    await this.supabase
      .from("sending_domains")
      .update({ dns_verified: verified, updated_at: new Date().toISOString() })
      .eq("id", domainId);

    return { verified, records };
  }

  async getDomainHealth(domainId: string): Promise<DomainHealth> {
    const { data: sends, error } = await this.supabase
      .from("sales_sends")
      .select("bounced_at, sent_at")
      .eq("sending_domain_id", domainId)
      .not("status", "eq", "queued");

    if (error) throw new Error(`Failed to load sends: ${error.message}`);

    const rows = (sends ?? []) as Array<{ bounced_at: string | null; sent_at: string | null }>;
    const total = rows.filter((r) => r.sent_at !== null).length;
    const bounced = rows.filter((r) => r.bounced_at !== null).length;

    const bounce_rate = total > 0 ? bounced / total : 0;
    // complaint_rate is tracked via webhook events on sending_domains.total_complained
    const { data: domainRow } = await this.supabase
      .from("sending_domains")
      .select("total_complained, total_sent")
      .eq("id", domainId)
      .single();
    const dr = domainRow as { total_complained: number; total_sent: number } | null;
    const complaint_rate =
      dr && dr.total_sent > 0 ? dr.total_complained / dr.total_sent : 0;

    let status: DomainHealth["status"] = "unknown";
    if (total > 0) {
      if (bounce_rate > 0.05) status = "critical";
      else if (bounce_rate > 0.02) status = "warning";
      else status = "healthy";
    }

    await this.supabase
      .from("sending_domains")
      .update({
        bounce_rate,
        complaint_rate,
        health_status: status,
        last_health_check_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", domainId);

    return { domainId, bounce_rate, complaint_rate, status };
  }

  async getWarmupStatus(domainId: string): Promise<WarmupStatus> {
    const { data: row, error } = await this.supabase
      .from("sending_domains")
      .select(
        "warmup_day, current_daily_limit, warmup_status, warmup_started_at",
      )
      .eq("id", domainId)
      .single();

    if (error || !row) throw new Error("Domain not found");

    const domain = row as {
      warmup_day: number;
      current_daily_limit: number;
      warmup_status: string;
      warmup_started_at: string | null;
    };

    const today = todayIso();
    const { count } = await this.supabase
      .from("sales_sends")
      .select("id", { count: "exact", head: true })
      .eq("sending_domain_id", domainId)
      .gte("sent_at", `${today}T00:00:00.000Z`)
      .lt("sent_at", `${today}T23:59:59.999Z`);

    return {
      warmup_day: domain.warmup_day,
      current_daily_limit: domain.current_daily_limit,
      sends_today: count ?? 0,
      warmup_status: domain.warmup_status,
      warmup_started_at: domain.warmup_started_at,
    };
  }

  async rotateDomain(campaignId: string): Promise<SendingDomain | null> {
    const { data: campaign, error: cErr } = await this.supabase
      .from("sales_campaigns")
      .select("sending_domain_ids")
      .eq("id", campaignId)
      .single();

    if (cErr || !campaign) throw new Error("Campaign not found");

    const domainIds: string[] =
      (campaign as { sending_domain_ids: string[] }).sending_domain_ids ?? [];
    if (domainIds.length === 0) return null;

    const { data: domains, error: dErr } = await this.supabase
      .from("sending_domains")
      .select("*")
      .in("id", domainIds)
      .eq("is_active", true)
      .neq("health_status", "critical");

    if (dErr) throw new Error(`Failed to load domains: ${dErr.message}`);

    const activeDomains = (domains ?? []) as SendingDomain[];
    if (activeDomains.length === 0) return null;

    const today = todayIso();

    // Count sends today per domain to find the one with capacity
    const counts = await Promise.all(
      activeDomains.map(async (d) => {
        const { count } = await this.supabase
          .from("sales_sends")
          .select("id", { count: "exact", head: true })
          .eq("sending_domain_id", d.id)
          .gte("sent_at", `${today}T00:00:00.000Z`)
          .lt("sent_at", `${today}T23:59:59.999Z`);
        return { domain: d, sends_today: count ?? 0 };
      }),
    );

    // Pick in round-robin order matching original sending_domain_ids sequence
    const ordered = domainIds
      .map((id) => counts.find((c) => c.domain.id === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    const available = ordered.find(
      (c) => c.sends_today < c.domain.current_daily_limit,
    );

    return available?.domain ?? null;
  }
}
