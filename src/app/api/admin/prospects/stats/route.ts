import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { ProspectManager } from "@/lib/admin/prospect-manager";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const listId = searchParams.get("list_id") ?? undefined;

  try {
    const manager = new ProspectManager();
    const stats = await manager.getStats(listId);
    return NextResponse.json({ stats });
  } catch {
    return NextResponse.json(
      { error: "Failed to load prospect stats.", code: "stats_failed" },
      { status: 500 },
    );
  }
}
