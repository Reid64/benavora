// GET /api/admin/command-center — cross-org snapshot refresh for the Platform
// Command Center's live panels (src/app/(dashboard)/command-center/page.tsx).
// Owner-only, same gating precedent as /api/admin/platform-metrics and
// /api/admin/monitor. Called by the client-side Realtime wiring
// (src/components/command-center/CommandCenterLive.tsx) whenever a
// postgres_changes event fires on agent_runs/agent_decisions/applications, so
// the cross-org counts stay accurate (a single realtime row payload can't be
// trusted to update a cross-org aggregate correctly - see that component's
// header comment for the RLS-scope caveat this route exists to work around).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getCommandCenterSnapshot } from "@/lib/command-center/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const snapshot = await getCommandCenterSnapshot();
  return NextResponse.json(snapshot);
}
