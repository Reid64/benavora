// Donation Recommendation Marketplace — minimal request/approve/decline flow
// (FEATURE_REGISTRY_v2.md row #124). No receipt generation, no payment/value
// transfer logic — row #125 (IRS-compliant receipt generator) is explicitly
// out of scope for this pass and remains PLANNED.
//
// PATCH body: { action: "request" | "withdraw" | "approve" | "decline" }
//   - "request"/"withdraw" — only the requesting org (match.organization_id)
//     may act, moving suggested -> requested, or requested/suggested ->
//     withdrawn.
//   - "approve"/"decline" — only the org that owns the matched listing may
//     act, moving requested -> approved/declined. Approving also marks the
//     listing itself "matched".
// organization_id is never trusted from the body — the caller's own org is
// derived server-side and compared against the match/listing rows.

import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

const REQUESTER_ACTIONS = new Set(["request", "withdraw"]);
const OWNER_ACTIONS = new Set(["approve", "decline"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const matchId = params.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", "bad_request", 400);
  }

  const action = typeof (body as { action?: unknown }).action === "string"
    ? ((body as { action: string }).action)
    : "";

  if (!REQUESTER_ACTIONS.has(action) && !OWNER_ACTIONS.has(action)) {
    return jsonError(
      "action must be one of: request, withdraw, approve, decline.",
      "invalid_action",
      400,
    );
  }

  const { data: match, error: matchError } = await supabase
    .from("marketplace_matches")
    .select(
      "id, listing_id, organization_id, status, marketplace_listings:listing_id ( id, organization_id )",
    )
    .eq("id", matchId)
    .single();

  if (matchError || !match) {
    return jsonError("Match not found.", "not_found", 404);
  }

  const listingRaw = match.marketplace_listings as unknown;
  const listing = (Array.isArray(listingRaw) ? listingRaw[0] : listingRaw) as
    | { id: string; organization_id: string }
    | null
    | undefined;
  const isRequester = match.organization_id === organizationId;
  const isListingOwner = listing?.organization_id === organizationId;

  if (REQUESTER_ACTIONS.has(action) && !isRequester) {
    return jsonError(
      "Only the requesting organization can perform this action.",
      "forbidden",
      403,
    );
  }
  if (OWNER_ACTIONS.has(action) && !isListingOwner) {
    return jsonError(
      "Only the listing's owning organization can perform this action.",
      "forbidden",
      403,
    );
  }

  const currentStatus = match.status as string;

  if (action === "request" && currentStatus !== "suggested") {
    return jsonError("Only a suggested match can be requested.", "invalid_transition", 409);
  }
  if (action === "withdraw" && !["suggested", "requested"].includes(currentStatus)) {
    return jsonError(
      "Only a suggested or requested match can be withdrawn.",
      "invalid_transition",
      409,
    );
  }
  if ((action === "approve" || action === "decline") && currentStatus !== "requested") {
    return jsonError(
      "Only a requested match can be approved or declined.",
      "invalid_transition",
      409,
    );
  }

  const nowIso = new Date().toISOString();
  const nextStatus =
    action === "request"
      ? "requested"
      : action === "withdraw"
        ? "withdrawn"
        : action === "approve"
          ? "approved"
          : "declined";

  const updatePayload: Record<string, unknown> = { status: nextStatus, updated_at: nowIso };
  if (action === "request") updatePayload.requested_at = nowIso;
  if (action === "approve" || action === "decline") updatePayload.responded_at = nowIso;

  const { error: updateError } = await supabase
    .from("marketplace_matches")
    .update(updatePayload)
    .eq("id", matchId);

  if (updateError) {
    return jsonError("Failed to update match.", "update_failed", 500);
  }

  if (action === "approve" && listing) {
    await supabase
      .from("marketplace_listings")
      .update({ status: "matched", updated_at: nowIso })
      .eq("id", listing.id);
  }

  return NextResponse.json({ data: { id: matchId, status: nextStatus } });
}
