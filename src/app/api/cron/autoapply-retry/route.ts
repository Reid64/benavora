import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { runRetrySweep } from "@/lib/autoapply/submission-retry";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const result = await runRetrySweep(admin);

  return NextResponse.json({
    retried: result.retried.length,
    failed: result.failed.length,
    retried_ids: result.retried,
    failed_ids: result.failed,
  });
}
