// Donation Recommendation Marketplace — Listings (FEATURE_REGISTRY_v2.md rows
// #121-125, Pillar 9). MVP scope: real schema + browse + rule-based match.
// Row #125 (IRS-compliant receipt generator) and the AI half of row #123 are
// NOT built here — still PLANNED.
//
// GET  — browse: listings visible to the caller's org (its own postings,
//        plus any listing it has been matched to — see RLS policy
//        marketplace_listings_org_select, migration 125). Session client
//        (RLS-enforced), matching this project's convention.
// POST — create a listing for the caller's org (organization_id always
//        derived server-side, never from the body — Behavioral Contracts
//        §2), then runs the rule-based matcher against every other org's
//        active search_profiles on the service-role client (must bypass RLS
//        to write match rows on behalf of orgs other than the caller).

import { NextRequest, NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { runMarketplaceMatching } from "@/lib/marketplace/matcher";

export const dynamic = "force-dynamic";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

const VALID_CATEGORIES = new Set([
  "corporate_donation",
  "corporate_sponsorship",
  "corporate_foundation",
  "private_foundation",
  "government_grant",
  "local_community_grant",
  "housing_grant",
  "education_grant",
  "faith_compatible_grant",
  "in_kind_donation",
  "materials_donation",
  "down_payment_assistance",
]);

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  const { data, error } = await supabase
    .from("marketplace_listings")
    .select(
      "id, organization_id, title, description, category, item_type, quantity, estimated_value, geographic_scope, status, expires_at, is_seed_data, created_at, " +
        "organizations:organization_id ( name )",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load marketplace listings.", "load_failed", 500);
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", "bad_request", 400);
  }

  const parsed = body as {
    title?: unknown;
    description?: unknown;
    category?: unknown;
    itemType?: unknown;
    quantity?: unknown;
    estimatedValue?: unknown;
    geographicScope?: unknown;
    expiresAt?: unknown;
  };

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const category = typeof parsed.category === "string" ? parsed.category : "";

  if (!title) {
    return jsonError("A title is required.", "no_title", 400);
  }
  if (!VALID_CATEGORIES.has(category)) {
    return jsonError("A valid category is required.", "invalid_category", 400);
  }

  const estimatedValue =
    typeof parsed.estimatedValue === "number" && Number.isFinite(parsed.estimatedValue)
      ? parsed.estimatedValue
      : null;

  const { data: listing, error } = await supabase
    .from("marketplace_listings")
    .insert({
      organization_id: organizationId,
      title,
      description: typeof parsed.description === "string" ? parsed.description : null,
      category,
      item_type: typeof parsed.itemType === "string" ? parsed.itemType : null,
      quantity: typeof parsed.quantity === "string" ? parsed.quantity : null,
      estimated_value: estimatedValue,
      geographic_scope:
        typeof parsed.geographicScope === "string" ? parsed.geographicScope : null,
      expires_at: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null,
    })
    .select("id, organization_id, category, geographic_scope")
    .single();

  if (error || !listing) {
    return jsonError("Failed to create listing.", "create_failed", 500);
  }

  // Rule-based matching must read/write other orgs' rows — service role only.
  const admin = createAdminClient();
  const matches = await runMarketplaceMatching(admin, {
    id: listing.id as string,
    organization_id: listing.organization_id as string,
    category: listing.category as string,
    geographic_scope: listing.geographic_scope as string | null,
  });

  return NextResponse.json({ data: { listingId: listing.id, matchesCreated: matches.length } });
}
