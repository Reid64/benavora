// POST /api/autoapply/test — manually queue a one-off AutoApply test submission
// against an arbitrary portal URL. Backs the "Run New Test" button on
// /autoapply/test-results. Mirrors the find-or-create-funder + queue pattern
// already used by /api/autoapply/queue's donor_discovery handoff path and by
// scripts/test-autoapply-walmart.ts.
//
// Derives organization_id from the authenticated session (never the request
// body — BLUEPRINT_v2.md Six Laws #2). This route only ever enqueues; the
// actual browser automation is performed by the already-running
// worker/queue-processor.ts QueueProcessor picking the item up on its next
// poll cycle — this route never launches a browser itself.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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

  const { prospectUrl } = (body ?? {}) as { prospectUrl?: unknown };
  if (!isValidHttpUrl(prospectUrl)) {
    return NextResponse.json(
      { error: "prospectUrl must be a valid http(s) URL." },
      { status: 400 },
    );
  }

  const hostname = new URL(prospectUrl).hostname.replace(/^www\./, "");
  const funderName = `Test: ${hostname}`;

  // Reuse an existing funder for this exact portal URL rather than creating
  // a duplicate on repeat test runs.
  const { data: existingFunder } = await supabase
    .from("funders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("giving_portal_url", prospectUrl)
    .maybeSingle();

  let funderId: string | null = existingFunder?.id ?? null;

  if (!funderId) {
    const { data: newFunder, error: funderError } = await supabase
      .from("funders")
      .insert({
        organization_id: organizationId,
        name: funderName,
        category: "corporate_foundation",
        website: prospectUrl,
        giving_portal_url: prospectUrl,
        has_giving_page: true,
        notes: "Created by the AutoApply test-results manual test tool.",
      })
      .select("id")
      .single();

    if (funderError || !newFunder) {
      return NextResponse.json(
        { error: "Could not create a funder record for this URL." },
        { status: 500 },
      );
    }
    funderId = newFunder.id;
  }

  const { data: existingQueueItem } = await supabase
    .from("submission_queue")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("funder_id", funderId)
    .in("status", ["pending", "processing"])
    .maybeSingle();

  if (existingQueueItem) {
    return NextResponse.json({
      queued: false,
      skipped: true,
      funder_id: funderId,
      queue_id: existingQueueItem.id,
      message: "A test submission for this URL is already queued or processing.",
    });
  }

  const { data: queueItem, error: queueError } = await supabase
    .from("submission_queue")
    .insert({
      organization_id: organizationId,
      funder_id: funderId,
      priority: 1,
      status: "pending",
      automation_mode: "manual_test",
    })
    .select("id")
    .single();

  if (queueError || !queueItem) {
    return NextResponse.json({ error: "Failed to queue test submission." }, { status: 500 });
  }

  return NextResponse.json({
    queued: true,
    skipped: false,
    funder_id: funderId,
    queue_id: queueItem.id,
    message:
      "Queued. The AutoApply worker will pick this item up on its next poll cycle if it is running.",
  });
}
