import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { GmailSyncEngine } from "@/lib/email/gmail-sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { userId, organizationId } = gate;

  const body = await request.json().catch(() => ({})) as { full_sync?: boolean };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_connections")
    .select("id, sync_cursor")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("sync_status", "active")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to look up email connection", code: "db_error" },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No active email connection found", code: "no_connection" },
      { status: 404 },
    );
  }

  const connection = data as { id: string; sync_cursor: string | null };
  const engine = new GmailSyncEngine(connection.id);

  const result =
    body.full_sync === true || !connection.sync_cursor
      ? await engine.syncThreads({ maxResults: 100 })
      : await engine.incrementalSync();

  return NextResponse.json(result);
}
