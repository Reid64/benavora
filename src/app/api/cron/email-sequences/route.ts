import { NextResponse } from "next/server";

import { sequenceEngine } from "@/lib/email/sequence-engine";

export const runtime = "nodejs";
export const maxDuration = 120;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

async function runSweep(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized.", "unauthorized", 401);
  }

  try {
    const result = await sequenceEngine.processScheduledSends();
    return NextResponse.json({ mode: "cron", ...result });
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Sequence sweep failed.",
      "sweep_failed",
      500,
    );
  }
}

export async function GET(request: Request) {
  return runSweep(request);
}

export async function POST(request: Request) {
  return runSweep(request);
}
