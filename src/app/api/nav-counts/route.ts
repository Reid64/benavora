import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const orgId = headers().get("x-organization-id");
  const userRole = headers().get("x-user-role");
  const isPlatformAdmin = userRole === "owner" || userRole === "admin";

  if (!user || !orgId) {
    return NextResponse.json(
      {
        alerts: 0,
        applications: 0,
        documents: 0,
        deadlines: 0,
        autonomousDrafts: 0,
        strategicRecommendations: 0,
        improvementsProposed: 0,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const now = new Date();
  const thirtyDaysOut = new Date(now);
  thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
  const todayStr = now.toISOString().split("T")[0];

  const [
    alertsRes,
    appsRes,
    docsRes,
    deadlinesRes,
    autonomousDraftsRes,
    strategicRecommendationsRes,
    improvementsRes,
  ] = await Promise.all([
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
    supabase
      .from("strategic_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
    // improvement_proposals is platform-wide with no organization_id / RLS
    // (migration 087_continuous_improvement.sql) — only queried for
    // owner/admin, matching the Platform section's own role gate in Sidebar.
    isPlatformAdmin
      ? supabase
          .from("improvement_proposals")
          .select("id", { count: "exact", head: true })
          .eq("status", "proposed")
      : Promise.resolve({ count: 0 }),
  ]);

  return NextResponse.json(
    {
      alerts: alertsRes.count ?? 0,
      applications: appsRes.count ?? 0,
      documents: docsRes.count ?? 0,
      deadlines: deadlinesRes.count ?? 0,
      autonomousDrafts: autonomousDraftsRes.count ?? 0,
      strategicRecommendations: strategicRecommendationsRes.count ?? 0,
      improvementsProposed: improvementsRes.count ?? 0,
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
