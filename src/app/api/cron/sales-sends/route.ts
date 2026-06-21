import { NextResponse } from "next/server";

import { SalesCampaignEngine } from "@/lib/admin/sales-campaign-engine";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json(
      { error: "Unauthorized.", code: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const engine = new SalesCampaignEngine();
    const result = await engine.processQueuedSends();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message, code: "process_failed" },
      { status: 500 },
    );
  }
}
