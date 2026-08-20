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

  let taxonomyNode: { kind: string; code: string } | null = null;
  if (taxonomyId !== null && taxonomyId.trim() !== "") {
    // Taxonomy isn't a column on prospects/directory — it's resolved through
    // the node's kind+code against the shared directory's naics_codes /
    // civic_kind, applied below as a filter on the embedded directory join
    // rather than a separate id-collection query (see WGR-032 in
    // test-evidence/_register/WIRING_GAP_REGISTER.md).
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
    taxonomyNode = node;
  }

  const hasRequestFilter = requestId !== null && requestId.trim() !== "";

  // Both request_id and taxonomy_id filters are pushed into the same query as
  // joins with a filter on the embedded resource (`!inner` + dot-notation),
  // rather than collecting matching ids into a client-side `.in()` list first
  // — see WGR-032. A real production request has up to 133,812 linked
  // prospects; both PostgREST's 1000-row page cap on an unbounded id-
  // collection query AND the practical URL-length ceiling of an `.in()` list
  // that large make the id-list approach silently wrong (or, once paginated,
  // outright unusable) at this org's real scale. The embedded-join filter
  // never materializes an id list — Postgres evaluates the join server-side
  // — so `count: "exact"` stays correct regardless of how many rows match.
  // Live-verified against the real 133,812-linked production request via a
  // direct PostgREST call: `Content-Range: 0-2/133812`, matching the true
  // total exactly.
  const directorySelect = taxonomyNode
    ? "directory:donor_discovery_directory!inner(*)"
    : "directory:donor_discovery_directory(*)";
  const selectColumns = hasRequestFilter
    ? `*, ${directorySelect}, dd_prospect_requests!inner()`
    : `*, ${directorySelect}`;

  let query = supabase
    .from("donor_discovery_prospects")
    .select(selectColumns, { count: "exact" })
    .eq("organization_id", organizationId);

  if (hasRequestFilter) {
    query = query.eq("dd_prospect_requests.request_id", requestId as string);
  }
  if (taxonomyNode) {
    query =
      taxonomyNode.kind === "naics"
        ? query.contains("directory.naics_codes", [taxonomyNode.code])
        : query.eq("directory.civic_kind", taxonomyNode.code);
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
