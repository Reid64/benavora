// GET /api/automation/stats — queue statistics (counts by status) for the org,
// plus daily submission usage vs. tier limit.

import { NextResponse } from "next/server";

import { resolveTier } from "@/lib/billing/usage-tracker";
import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DAILY_LIMITS: Record<string, number> = {
  free: 5,
  starter: 5,
  professional: 25,
  enterprise: 100,
  consultant: -1, // unlimited
};

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Authentication required.", "unauthenticated", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) return jsonError("Profile not found.", "no_profile", 403);
  const organizationId = profile.organization_id as string;

  const [{ data: allItems, error }, tier] = await Promise.all([
    supabase
      .from("automation_queue")
      .select("status, completed_at")
      .eq("organization_id", organizationId),
    resolveTier(supabase, organizationId),
  ]);

  if (error) {
    return jsonError("Failed to fetch queue stats.", "db_error", 500);
  }

  const counts: Record<string, number> = {
    queued: 0,
    processing: 0,
    paused: 0,
    completed: 0,
    failed: 0,
  };

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  let dailyUsed = 0;

  for (const row of allItems ?? []) {
    const s = row.status as string;
    counts[s] = (counts[s] ?? 0) + 1;

    if (
      s === "completed" &&
      row.completed_at &&
      new Date(row.completed_at as string) >= todayStart
    ) {
      dailyUsed++;
    }
  }

  const dailyLimit = DAILY_LIMITS[tier] ?? 5;

  return NextResponse.json({
    stats: counts,
    daily: {
      used: dailyUsed,
      limit: dailyLimit, // -1 = unlimited
      tier,
    },
  });
}
