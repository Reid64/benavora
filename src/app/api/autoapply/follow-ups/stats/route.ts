import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET /api/autoapply/follow-ups/stats — total pending, sent this month, and
// response rate for the Follow-Ups dashboard cards.

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [pendingRes, sentThisMonthRes, sentRowsRes] = await Promise.all([
    supabase
      .from("autoapply_follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending"),
    supabase
      .from("autoapply_follow_ups")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "sent")
      .gte("sent_at", monthStart.toISOString()),
    supabase
      .from("autoapply_follow_ups")
      .select("response_received")
      .eq("organization_id", organizationId)
      .eq("status", "sent"),
  ]);

  const sentRows = (sentRowsRes.data ?? []) as Array<{ response_received: boolean | null }>;
  const totalSent = sentRows.length;
  const responded = sentRows.filter((r) => r.response_received === true).length;
  const responseRate = totalSent > 0 ? responded / totalSent : null;

  return NextResponse.json({
    total_pending: pendingRes.count ?? 0,
    sent_this_month: sentThisMonthRes.count ?? 0,
    response_rate: responseRate,
  });
}
