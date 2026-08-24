import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { listAgents } from "@/lib/pil/agent-registry-service";

// GET /api/pil/agents — all agent definitions with status.

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const agents = await listAgents();
  return NextResponse.json({ agents });
}
