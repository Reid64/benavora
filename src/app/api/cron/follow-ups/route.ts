import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { processFollowUps } from "@/lib/autoapply/follow-up-scheduler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const result = await processFollowUps(supabase);
    return NextResponse.json({ ok: true, sent: result.sent, skipped: result.skipped });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
