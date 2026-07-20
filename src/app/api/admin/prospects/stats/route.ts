import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { ProspectManager } from "@/lib/admin/prospect-manager";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

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
