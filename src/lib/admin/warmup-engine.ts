import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type DomainRow = {
  id: string;
  warmup_day: number;
  warmup_status: string;
  current_daily_limit: number;
  target_daily_limit: number;
  bounce_rate: number;
  warmup_started_at: string | null;
};

// Days 1-3: 5, Days 4-7: 10, Days 8-14: 20, Days 15-21: 35, Days 22+: 50
function limitForDay(day: number): number {
  if (day <= 3) return 5;
  if (day <= 7) return 10;
  if (day <= 14) return 20;
  if (day <= 21) return 35;
  return 50;
}

function tierForLimit(limit: number): number {
  if (limit <= 5) return 5;
  if (limit <= 10) return 10;
  if (limit <= 20) return 20;
  if (limit <= 35) return 35;
  return 50;
}

function previousTierLimit(currentLimit: number): number {
  if (currentLimit <= 10) return 5;
  if (currentLimit <= 20) return 10;
  if (currentLimit <= 35) return 20;
  return 35;
}

// Returns the day number at which each tier begins
function dayForLimit(limit: number): number {
  if (limit <= 5) return 1;
  if (limit <= 10) return 4;
  if (limit <= 20) return 8;
  if (limit <= 35) return 15;
  return 22;
}

export class WarmupEngine {
  private supabase = createAdminClient();

  async advanceWarmup(domainId: string): Promise<void> {
    const { data: row, error } = await this.supabase
      .from("sending_domains")
      .select(
        "id, warmup_day, warmup_status, current_daily_limit, target_daily_limit, bounce_rate, warmup_started_at",
      )
      .eq("id", domainId)
      .single();

    if (error || !row) throw new Error(`Domain not found: ${domainId}`);

    const domain = row as DomainRow;

    // Don't advance paused/completed/suspended domains
    if (!["warming", "frozen"].includes(domain.warmup_status)) return;

    const newDay = domain.warmup_day + 1;
    const bounceRate = domain.bounce_rate ?? 0;

    let newLimit = domain.current_daily_limit;
    let newStatus = domain.warmup_status;
    let freezeExtra = 0;

    if (bounceRate > 0.05) {
      // > 5% bounce: regress one tier
      newLimit = previousTierLimit(tierForLimit(domain.current_daily_limit));
      newStatus = "frozen";
    } else if (bounceRate > 0.03) {
      // > 3% bounce: freeze at current level for 3 extra days
      // We do this by NOT advancing the effective day used for limit lookup,
      // but we still increment warmup_day so we know how long we've been frozen.
      newLimit = domain.current_daily_limit;
      newStatus = "frozen";
      freezeExtra = 3;
    } else {
      // Healthy — advance normally
      newLimit = Math.min(limitForDay(newDay), domain.target_daily_limit);
      newStatus = newDay >= 22 && bounceRate < 0.02 ? "complete" : "warming";
    }

    // If frozen from a previous cycle, check if we've waited enough
    if (domain.warmup_status === "frozen" && bounceRate <= 0.03) {
      // Unfreeze and resume from the day the current tier started
      const tierStartDay = dayForLimit(domain.current_daily_limit);
      const daysInTier = newDay - tierStartDay;
      if (daysInTier >= freezeExtra) {
        newLimit = Math.min(limitForDay(newDay), domain.target_daily_limit);
        newStatus = "warming";
      }
    }

    await this.supabase
      .from("sending_domains")
      .update({
        warmup_day: newDay,
        current_daily_limit: newLimit,
        warmup_status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", domainId);
  }

  async getDailyBudget(
    domainId: string,
  ): Promise<{ remaining: number; limit: number; sent_today: number }> {
    const { data: row, error } = await this.supabase
      .from("sending_domains")
      .select("current_daily_limit")
      .eq("id", domainId)
      .single();

    if (error || !row) throw new Error(`Domain not found: ${domainId}`);

    const limit = (row as { current_daily_limit: number }).current_daily_limit;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const { count } = await this.supabase
      .from("sales_sends")
      .select("id", { count: "exact", head: true })
      .eq("sending_domain_id", domainId)
      .gte("sent_at", todayStart.toISOString())
      .lte("sent_at", todayEnd.toISOString());

    const sent_today = count ?? 0;
    const remaining = Math.max(0, limit - sent_today);

    return { remaining, limit, sent_today };
  }

  async isWarmupComplete(domainId: string): Promise<boolean> {
    const { data: row, error } = await this.supabase
      .from("sending_domains")
      .select("warmup_day, bounce_rate, warmup_status")
      .eq("id", domainId)
      .single();

    if (error || !row) return false;

    const domain = row as {
      warmup_day: number;
      bounce_rate: number;
      warmup_status: string;
    };

    return (
      domain.warmup_status === "complete" ||
      (domain.warmup_day >= 22 && (domain.bounce_rate ?? 0) < 0.02)
    );
  }
}
