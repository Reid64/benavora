// POST /api/autoapply/queue — batch-enqueue funders into the AutoApply submission queue.
// Derives organization_id from the authenticated session (never the request body).
//
// Two request shapes:
//   { funder_ids: string[] }  — batch mode, funders already exist (funders/page.tsx,
//                               autoapply/settings/page.tsx).
//   { source: "donor_discovery", prospect_id, form_url, org_name } — Donor Discovery
//                               handoff (DONOR_DISCOVERY_ARCHITECTURE.md §7): creates
//                               (or reuses) a funder record for the prospect, then
//                               queues it the same way as the batch path.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";
import { resolveTier } from "@/lib/billing/usage-tracker";

export const runtime = "nodejs";

// Max funders that may be enqueued in a single batch, per subscription tier.
// Enterprise is configurable; 200 is the default. Consultant is unlimited (null).
const BATCH_CAPS: Record<string, number | null> = {
  free: 5,
  starter: 10,
  professional: 50,
  enterprise: 200,
  consultant: null,
};

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

async function handleDonorDiscoveryHandoff(
  supabase: SupabaseClient,
  organizationId: string,
  body: Record<string, unknown>,
) {
  const { prospect_id, form_url, org_name } = body;

  if (!isUuid(prospect_id)) {
    return NextResponse.json({ error: "prospect_id must be a valid id." }, { status: 400 });
  }
  if (typeof org_name !== "string" || !org_name.trim()) {
    return NextResponse.json({ error: "org_name is required." }, { status: 400 });
  }
  if (form_url !== undefined && form_url !== null && typeof form_url !== "string") {
    return NextResponse.json({ error: "form_url must be a string or null." }, { status: 400 });
  }

  const { data: prospect } = await supabase
    .from("donor_discovery_prospects")
    .select("id")
    .eq("id", prospect_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!prospect) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  const formUrl = (form_url as string | null | undefined) ?? null;

  // Reuse a previously created funder for this prospect (match by donation
  // form URL first, falling back to an exact name match) instead of creating
  // a duplicate on repeat clicks.
  let funderId: string | null = null;
  if (formUrl) {
    const { data } = await supabase
      .from("funders")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("giving_portal_url", formUrl)
      .maybeSingle();
    funderId = data?.id ?? null;
  }
  if (!funderId) {
    const { data } = await supabase
      .from("funders")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", org_name)
      .maybeSingle();
    funderId = data?.id ?? null;
  }

  if (!funderId) {
    const { data: newFunder, error: funderError } = await supabase
      .from("funders")
      .insert({
        organization_id: organizationId,
        name: org_name,
        category: "in_kind_donation",
        website: formUrl,
        giving_portal_url: formUrl,
        has_giving_page: true,
      })
      .select("id")
      .single();

    if (funderError || !newFunder) {
      return NextResponse.json(
        { error: "Could not create a funder record for this prospect." },
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
    return NextResponse.json({ queued: 0, skipped: 1, funder_id: funderId });
  }

  const { error: insertError } = await supabase.from("submission_queue").insert({
    organization_id: organizationId,
    funder_id: funderId,
    priority: 100,
    status: "pending",
    automation_mode: "donor_discovery",
  });

  if (insertError) {
    return NextResponse.json({ error: "Failed to queue this funder." }, { status: 500 });
  }

  return NextResponse.json({ queued: 1, skipped: 0, funder_id: funderId });
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

  if (
    body &&
    typeof body === "object" &&
    (body as Record<string, unknown>).source === "donor_discovery"
  ) {
    return handleDonorDiscoveryHandoff(supabase, organizationId, body as Record<string, unknown>);
  }

  const { funder_ids } = body as { funder_ids?: unknown };
  if (!Array.isArray(funder_ids) || funder_ids.length === 0) {
    return NextResponse.json(
      { error: "funder_ids must be a non-empty array." },
      { status: 400 },
    );
  }

  const ids = funder_ids as string[];

  // Enforce the per-tier batch-size cap before doing any work.
  const tier = await resolveTier(supabase, organizationId);
  const cap = tier in BATCH_CAPS ? BATCH_CAPS[tier] : BATCH_CAPS.free;
  if (cap != null && ids.length > cap) {
    return NextResponse.json(
      {
        error: `Your ${tier} plan allows up to ${cap} funders per batch (you selected ${ids.length}). Reduce the selection or upgrade your plan.`,
        code: "batch_cap_exceeded",
        tier,
        cap,
        requested: ids.length,
      },
      { status: 422 },
    );
  }

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
