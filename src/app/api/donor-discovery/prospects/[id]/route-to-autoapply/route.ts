// POST /api/donor-discovery/prospects/[id]/route-to-autoapply — corporate
// donation pipeline handoff (discover/page.tsx prospect cards). Reads the
// prospect's shared directory enrichment; if a donation/sponsorship form was
// found, creates (or reuses) a funder record for it and queues it in
// submission_queue for the AutoApply worker, same convention as the existing
// donor_discovery handoff in /api/autoapply/queue.
// organization_id is always derived from the authenticated session, never the
// request body (Behavioral Contracts §2).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function POST(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  const { data: prospect, error } = await supabase
    .from("donor_discovery_prospects")
    .select("id, directory:donor_discovery_directory(legal_name, dba_name, website, enrichment)")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  const directory = prospect.directory as unknown as {
    legal_name: string;
    dba_name: string | null;
    website: string | null;
    enrichment: unknown;
  } | null;

  if (!directory) {
    return NextResponse.json({ error: "Prospect has no directory record." }, { status: 500 });
  }

  const enrichment =
    directory.enrichment && typeof directory.enrichment === "object" && !Array.isArray(directory.enrichment)
      ? (directory.enrichment as Record<string, unknown>)
      : {};

  const hasDonationForm = enrichment.has_donation_form === true;

  if (!hasDonationForm) {
    return NextResponse.json({ queued: false, reason: "no_giving_form" });
  }

  const givingPortalUrl =
    (typeof enrichment.donation_form_url === "string" && enrichment.donation_form_url) ||
    directory.website ||
    null;
  const orgName = directory.dba_name?.trim() || directory.legal_name;

  // Reuse a previously created funder for this prospect (match by donation
  // form URL first, falling back to an exact name match) instead of creating
  // a duplicate on repeat clicks — same convention as the donor_discovery
  // handoff in /api/autoapply/queue.
  let funderId: string | null = null;
  if (givingPortalUrl) {
    const { data } = await supabase
      .from("funders")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("giving_portal_url", givingPortalUrl)
      .maybeSingle();
    funderId = data?.id ?? null;
  }
  if (!funderId) {
    const { data } = await supabase
      .from("funders")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", orgName)
      .maybeSingle();
    funderId = data?.id ?? null;
  }

  if (!funderId) {
    const { data: newFunder, error: funderError } = await supabase
      .from("funders")
      .insert({
        organization_id: organizationId,
        name: orgName,
        category: "in_kind_donation",
        website: directory.website,
        giving_portal_url: givingPortalUrl,
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
    return NextResponse.json({ queued: true, queueId: existingQueueItem.id });
  }

  const { data: queueItem, error: insertError } = await supabase
    .from("submission_queue")
    .insert({
      organization_id: organizationId,
      funder_id: funderId,
      priority: 100,
      status: "pending",
      automation_mode: "donor_discovery",
    })
    .select("id")
    .single();

  if (insertError || !queueItem) {
    return NextResponse.json({ error: "Failed to queue this prospect." }, { status: 500 });
  }

  return NextResponse.json({ queued: true, queueId: queueItem.id });
}
