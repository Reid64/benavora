import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { enqueueKnowledgeIndexerTrigger } from "@/lib/agents/knowledge-indexer-agent";

// POST /api/autonomous/knowledge-indexer-trigger - enqueues AG-29 (Knowledge
// Engine Indexer Agent, src/lib/agents/knowledge-indexer-agent.ts) off a new
// `outcomes` insert, mirroring the same convention already established by
// /api/autonomous/grant-dna-trigger (AG-10). Called best-effort from
// src/components/outcomes/OutcomeForm.tsx, the same call site that already
// fires the AG-07 (learning), AG-19 (funder-relationship), and AG-10
// (grant-dna) triggers after an outcome is recorded.
//
// Only "outcomes" is accepted here - foundation_directory and
// intelligence_proposal_sections are written by service-role scripts, not
// browser sessions, so those call enqueueKnowledgeIndexerTrigger() directly
// with the default SYSTEM_ORG_ID (RLS does not apply to a service-role
// client) rather than through this user-facing route.
//
// organization_id is always derived server-side via requireRole, never from
// the request body (Contracts §2), and is passed as the row's org_id to
// satisfy agent_queue's RLS policy - routeQueueItem()'s
// 'ag-29-knowledge-indexer' case ignores item.org_id entirely (this agent is
// platform-wide), so which real org_id satisfies RLS here has no bearing on
// how the row is actually processed.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  if (!checkRateLimit(`knowledge-indexer-trigger:${userId}`)) {
    return jsonError(
      "Too many knowledge indexer triggers. Try again in a bit.",
      "rate_limited",
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { rowId } = (body ?? {}) as { rowId?: unknown };

  if (typeof rowId !== "string" || rowId.trim() === "") {
    return jsonError("rowId is required.", "invalid_input", 400);
  }

  try {
    await enqueueKnowledgeIndexerTrigger(supabase, "outcomes", rowId, organizationId);
  } catch {
    return jsonError(
      "Could not queue the knowledge indexer run.",
      "queue_failed",
      500,
    );
  }

  return NextResponse.json({ queued: true });
}
