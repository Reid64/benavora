// POST /api/donor-discovery/requests — create a Donor Discovery request (name,
// taxonomy_ids, geography), enqueued with status 'queued' for the worker's
// dd-request-processor.ts to claim (DONOR_DISCOVERY_ARCHITECTURE.md §3).
// GET /api/donor-discovery/requests — paginated list of the org's requests
// with prospect counts, newest first.
//
// Derives organization_id from the authenticated session (never the request
// body). This route only enqueues — it never runs enumeration/crawling itself
// (architecture doc §3: "Vercel routes only enqueue and read").

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parsePositiveInt(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

interface RadiusGeography {
  center: { lat: number; lng: number };
  radius_mi: number;
}

type DdGeography = RadiusGeography | { states: string[] } | { national: true };

function isRadiusGeography(v: unknown): v is RadiusGeography {
  if (v === null || typeof v !== "object") return false;
  const raw = v as Record<string, unknown>;
  const center = raw["center"];
  return (
    typeof raw["radius_mi"] === "number" &&
    center !== null &&
    typeof center === "object" &&
    typeof (center as Record<string, unknown>)["lat"] === "number" &&
    typeof (center as Record<string, unknown>)["lng"] === "number"
  );
}

function isValidGeography(v: unknown): v is DdGeography {
  if (v === null || typeof v !== "object") return false;
  const raw = v as Record<string, unknown>;
  if (isRadiusGeography(raw)) return true;
  if (Array.isArray(raw["states"]) && raw["states"].every((s) => typeof s === "string")) {
    return true;
  }
  if (raw["national"] === true) return true;
  return false;
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { name, taxonomy_ids, geography } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (
    !Array.isArray(taxonomy_ids) ||
    taxonomy_ids.length === 0 ||
    !taxonomy_ids.every((id) => typeof id === "string" && id.trim().length > 0)
  ) {
    return NextResponse.json(
      { error: "taxonomy_ids must be a non-empty array of taxonomy node ids." },
      { status: 400 },
    );
  }
  if (!isValidGeography(geography)) {
    return NextResponse.json(
      {
        error:
          "geography must be one of {center:{lat,lng}, radius_mi}, {states:[...]}, or {national:true}.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("donor_discovery_requests")
    .insert({
      organization_id: organizationId,
      name: name.trim(),
      taxonomy_ids: taxonomy_ids as string[],
      geography,
      status: "queued",
      counts: {},
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create request." }, { status: 500 });
  }

  return NextResponse.json({ request: data }, { status: 201 });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const params = new URL(request.url).searchParams;
  const page = parsePositiveInt(params.get("page"), 1);
  const limit = Math.min(parsePositiveInt(params.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
  const offset = (page - 1) * limit;

  const { data: requests, error, count } = await supabase
    .from("donor_discovery_requests")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: "Failed to load requests." }, { status: 500 });
  }

  const requestIds = ((requests ?? []) as Array<{ id: string }>).map((r) => r.id);

  // Tally live prospect counts per request via the join table — a reused
  // prospect (donor_discovery_prospects is idempotent per (organization_id,
  // directory_id)) should count under every request that surfaced it, not
  // just the one that originally created the row. RLS on dd_prospect_requests
  // already scopes this to the caller's org via the parent prospect. Scoped
  // to just this page's request ids so the tally never scans the org's full
  // history on later pages.
  const prospectCountByRequest = new Map<string, number>();
  if (requestIds.length > 0) {
    const { data: links } = await supabase
      .from("dd_prospect_requests")
      .select("request_id")
      .in("request_id", requestIds);

    for (const l of (links ?? []) as Array<{ request_id: string }>) {
      prospectCountByRequest.set(l.request_id, (prospectCountByRequest.get(l.request_id) ?? 0) + 1);
    }
  }

  const enriched = ((requests ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    prospect_count: prospectCountByRequest.get(r["id"] as string) ?? 0,
  }));

  return NextResponse.json({ requests: enriched, total: count ?? 0, page, limit });
}
