import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

// Unauthenticated monitoring endpoint (allowlisted in middleware.ts
// isPublicPath) - never return raw error messages or other internal detail
// here, only status enums, since anything in the response body is public.
export const dynamic = "force-dynamic";

// heartbeat.ts ticks every 30s (worker/heartbeat.ts); allow a few missed
// ticks before flagging the worker stale.
const WORKER_STALE_MS = 2 * 60 * 1000;

type CheckStatus = "ok" | "warning" | "error";

async function checkDatabase(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ status: CheckStatus }> {
  try {
    const { error } = await supabase
      .from("organizations")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    return { status: "ok" };
  } catch (error) {
    console.error("[health] database check failed:", error);
    return { status: "error" };
  }
}

async function checkWorker(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ status: CheckStatus }> {
  try {
    const { data, error } = await supabase
      .from("worker_status")
      .select("last_heartbeat_at")
      .order("last_heartbeat_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { status: "error" };

    const staleMs = Date.now() - new Date(data.last_heartbeat_at).getTime();
    return { status: staleMs > WORKER_STALE_MS ? "error" : "ok" };
  } catch (error) {
    console.error("[health] worker check failed:", error);
    return { status: "error" };
  }
}

function checkMemory(): { status: CheckStatus; heapUsedMB: number; heapTotalMB: number } {
  const memUsage = process.memoryUsage();
  const heapRatio = memUsage.heapUsed / memUsage.heapTotal;
  return {
    status: heapRatio > 0.9 ? "warning" : "ok",
    heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
  };
}

export async function GET() {
  const supabase = createAdminClient();

  const [database, worker] = await Promise.all([
    checkDatabase(supabase),
    checkWorker(supabase),
  ]);
  const memory = checkMemory();

  const healthy = database.status === "ok" && worker.status === "ok" && memory.status !== "error";

  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks: { database, worker, memory },
    },
    { status: healthy ? 200 : 503 },
  );
}
