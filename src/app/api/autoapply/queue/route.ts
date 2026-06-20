// POST /api/autoapply/queue — batch-enqueue funders into the AutoApply submission queue.
// Derives organization_id from the authenticated session (never the request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;

  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { funder_ids } = body as { funder_ids?: unknown };
  if (!Array.isArray(funder_ids) || funder_ids.length === 0) {
    return NextResponse.json(
      { error: "funder_ids must be a non-empty array." },
      { status: 400 },
    );
  }

  const ids = funder_ids as string[];

  // Find funders that already have a pending or processing queue item.
  const { data: existing } = await supabase
    .from("submission_queue")
    .select("funder_id")
    .eq("organization_id", organizationId)
    .in("status", ["pending", "processing"])
    .in("funder_id", ids);

  const alreadyQueued = new Set(
    (existing ?? []).map((r) => r.funder_id).filter((id): id is string => id !== null),
  );

  const toInsert = ids.filter((id) => !alreadyQueued.has(id));

  if (toInsert.length === 0) {
    return NextResponse.json({ queued: 0, skipped: ids.length });
  }

  const inserts = toInsert.map((funder_id) => ({
    organization_id: organizationId,
    funder_id,
    priority: 100,
    status: "pending",
    automation_mode: "batch",
  }));

  const { error } = await supabase.from("submission_queue").insert(inserts);
  if (error) {
    return NextResponse.json({ error: "Failed to queue funders." }, { status: 500 });
  }

  return NextResponse.json({
    queued: toInsert.length,
    skipped: ids.length - toInsert.length,
  });
}
