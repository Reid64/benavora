import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { runSignalMonitor } from "@/lib/intelligence/signal-monitor";

// POST /api/intelligence/signal-monitor — Signal Monitoring
// (FEATURE_REGISTRY_v2.md #99, "LinkedIn + news + 990 watching"). This
// route covers NEWS + 990 ONLY — LinkedIn is explicitly deferred pending
// Reid's sign-off on ToS/anti-bot risk, see
// src/lib/intelligence/signal-monitor.ts's file header and
// STATE_OF_THE_BUILD.md's "Signal Monitoring" session entry.
//
// Sweeps up to 15 of the caller's org's `funders` in one call: news via the
// existing checkEntityReputation() (AG-18), 990 via a best-effort
// name-match to foundation_directory plus a deterministic officers/status/
// financial diff against a stored snapshot. Every newly-created signal is
// fanned into org-scoped reputation_alerts, so results surface through the
// existing GET /api/intelligence/reputation endpoint — no separate GET is
// added here.
//
// organizationId is always derived from the session (Behavioral Contracts
// §2), never a client-supplied value.

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  try {
    const summary = await runSignalMonitor(organizationId, supabase);
    return NextResponse.json({ summary });
  } catch {
    return jsonError(
      "Signal monitor run failed.",
      "signal_monitor_failed",
      500,
    );
  }
}
