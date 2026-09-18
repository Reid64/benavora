import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { WarmupEngine } from "@/lib/admin/warmup-engine";

// Daily domain warmup advancement (BLUEPRINT §8 / Contracts §33).
// Vercel Cron hits this with GET once per day at midnight CT (see vercel.json).
// Processes all active sending_domains whose warmup_status is 'warming' or 'frozen'.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

async function runWarmup(_request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return jsonError("CRON_SECRET not configured", "misconfigured", 500);
  }

  const supabase = createAdminClient();
  const engine = new WarmupEngine();

  const { data: domains, error } = await supabase
    .from("sending_domains")
    .select("id")
    .eq("is_active", true)
    .in("warmup_status", ["warming", "frozen"]);

  if (error) {
    return jsonError(
      `Failed to load domains: ${error.message}`,
      "db_error",
      500,
    );
  }

  const rows = (domains ?? []) as Array<{ id: string }>;

  let advanced = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    try {
      await engine.advanceWarmup(row.id);
      advanced++;
    } catch (err) {
      errors.push({
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    advanced,
    errors,
  });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized", "unauthorized", 401);
  }

  return runWarmup(request);
}
