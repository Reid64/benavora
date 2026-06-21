import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { GCalSyncEngine } from "@/lib/calendar/gcal-sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("calendar_connections")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("sync_status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to look up calendar connection", code: "db_error" },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No active calendar connection found", code: "no_connection" },
      { status: 404 },
    );
  }

  const connection = data as { id: string };
  const engine = new GCalSyncEngine();
  const result = await engine.syncDeadlinesOut(
    organizationId,
    connection.id,
  );

  return NextResponse.json(result);
}
