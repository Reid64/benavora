// GET /api/drafts/queue/stats — queue statistics for the org.
// Derives organization_id from the authenticated session (never the request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { DraftQueueEngine } from "@/lib/drafts/draft-queue-engine";

export const runtime = "nodejs";

export async function GET(_request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const engine = new DraftQueueEngine(supabase);
  const stats = await engine.getQueueStats(organizationId);

  return NextResponse.json({ stats });
}
