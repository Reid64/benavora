// GET /api/donor-discovery/prospects — filterable, paginated list of the org's
// prospects (request_id, taxonomy_id, stage, min_score), joined with the
// shared directory record for display fields (legal_name, website, etc).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const PIPELINE_STAGES = [
  "new",
  "reviewing",
  "contacted",
  "applied",
  "received",
  "rejected",
  "archived",
] as const;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
// Never matches a real row — used to make an empty prospectIds list produce
// zero results rather than an unfiltered `.in()` call.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const url = new URL(request.url);
  const params = url.searchParams;

  const requestId = params.get("request_id");
  const taxonomyId = params.get("taxonomy_id");

  const stageParam = params.get("stage");
  if (stageParam !== null && !(PIPELINE_STAGES as readonly string[]).includes(stageParam)) {
    return jsonError(
      `Invalid stage value: ${stageParam}. Must be one of: ${PIPELINE_STAGES.join(", ")}.`,
      "INVALID_FILTER",
      400,
    );
  }

  const minScoreParam = params.get("min_score");
  let minScore: number | null = null;
  if (minScoreParam !== null && minScoreParam.trim() !== "") {
    const parsed = Number(minScoreParam);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      return jsonError("min_score must be an integer between 0 and 100.", "INVALID_FILTER", 400);
    }
    minScore = parsed;
  }

  const page = parsePositiveInt(params.get("page"), 1);
  const limit = Math.min(parsePositiveInt(params.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
  const offset = (page - 1) * limit;

  let query = supabase
    .from("donor_discovery_prospects")
    .select("*, directory:donor_discovery_directory(*)", { count: "exact" })
    .eq("organization_id", organizationId);

  if (requestId !== null && requestId.trim() !== "") {
    // A prospect can be linked to more than one request (donor_discovery_
    // prospects is idempotent per (organization_id, directory_id) — a reused
    // prospect's original request_id column no longer reflects every request
    // that surfaced it, so filter through the join table instead. RLS on
    // dd_prospect_requests already scopes this to the caller's org.
    const { data: links, error: linksError } = await supabase
      .from("dd_prospect_requests")
      .select("prospect_id")
      .eq("request_id", requestId);

    if (linksError) {
      return jsonError("Failed to load prospects.", "DB_ERROR", 500);
    }

    const prospectIds = (links ?? []).map((l: { prospect_id: string }) => l.prospect_id);
    query = query.in("id", prospectIds.length > 0 ? prospectIds : [NIL_UUID]);
  }
  if (taxonomyId !== null && taxonomyId.trim() !== "") {
    // Taxonomy isn't a column on prospects/directory — it's resolved through
    // the node's kind+code against the shared directory's naics_codes /
    // civic_kind, then narrowed to matching directory ids (same join-filter
    // shape as the request_id branch above).
    const { data: node, error: nodeError } = await supabase
      .from("donor_discovery_taxonomy")
      .select("kind, code")
      .eq("id", taxonomyId)
      .maybeSingle();

    if (nodeError) {
      return jsonError("Failed to load prospects.", "DB_ERROR", 500);
    }
    if (!node) {
      return jsonError("Invalid taxonomy_id.", "INVALID_FILTER", 400);
    }

    const directoryQuery =
      node.kind === "naics"
        ? supabase.from("donor_discovery_directory").select("id").contains("naics_codes", [node.code])
        : supabase.from("donor_discovery_directory").select("id").eq("civic_kind", node.code);

    const { data: directoryRows, error: directoryError } = await directoryQuery;
    if (directoryError) {
      return jsonError("Failed to load prospects.", "DB_ERROR", 500);
    }

    const directoryIds = (directoryRows ?? []).map((d: { id: string }) => d.id);
    query = query.in("directory_id", directoryIds.length > 0 ? directoryIds : [NIL_UUID]);
  }
  if (stageParam !== null) {
    query = query.eq("pipeline_stage", stageParam);
  }
  if (minScore !== null) {
    query = query.gte("score", minScore);
  }

  const { data, error, count } = await query
    .order("score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return jsonError("Failed to load prospects.", "DB_ERROR", 500);
  }

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}
