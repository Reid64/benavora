import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const orgId = headers().get("x-organization-id");

  if (!user || !orgId) {
    return NextResponse.json(
      {
        alerts: 0,
        applications: 0,
        documents: 0,
        deadlines: 0,
        autonomousDrafts: 0,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const now = new Date();
  const thirtyDaysOut = new Date(now);
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
  const todayStr = now.toISOString().split("T")[0];

  const [alertsRes, appsRes, docsRes, deadlinesRes, autonomousDraftsRes] = await Promise.all([
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("is_read", false)
      .eq("is_dismissed", false),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .in("stage", [
        "awaiting_documents",
        "follow_up_due",
        "reporting_required",
        "ready_for_review",
      ]),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .not("expiration_date", "is", null)
      .gte("expiration_date", now.toISOString().split("T")[0])
      .lte("expiration_date", thirtyDaysOut.toISOString().split("T")[0]),
    supabase
      .from("deadlines")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .lt("due_date", todayStr)
      .not("is_completed", "eq", true),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("auto_generated", true)
      .eq("pending_review", true),
  ]);

  return NextResponse.json(
    {
      alerts: alertsRes.count ?? 0,
      applications: appsRes.count ?? 0,
      documents: docsRes.count ?? 0,
      deadlines: deadlinesRes.count ?? 0,
      autonomousDrafts: autonomousDraftsRes.count ?? 0,
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
