import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  ELIGIBILITY_FLAGS,
  GRANT_SELECT,
  isFunderCategory,
  isOpportunityStatus,
  isValidDateString,
  serializeGrant,
  type EligibilityFlag,
  type OpportunityRow,
} from "@/lib/grants/grants-service";

// GET /api/grants — list grants for the authenticated organization with optional
// filters (source_type, eligibility_flag, status, deadline range) and pagination
// (BEHAVIORAL_CONTRACTS "GET /api/grants").
//
// "Grant" maps to the live `opportunities` table; organization_id is derived from
// the session (Six Laws Law 2), never the request. RLS scopes every row to the
// org as a second barrier; the explicit `.eq("organization_id", …)` is the first.
// See `@/lib/grants/grants-service` for the full contract⇄schema mapping.

export const runtime = "nodejs";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function jsonError(message: string, code: string, status: number) {
  // Flat error shape used by every route in this codebase (Contracts §16).
  return NextResponse.json({ error: message, code }, { status });
}

/** Parse a positive integer query param, falling back to `fallback`. */
function parsePositiveInt(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function GET(request: Request) {
  // Read access — any authenticated member of the org (Contracts: grants_manager,
  // executive_director, grant_researcher all map to ≥ viewer in the live model).
  const gate = await requireRole("viewer");
  if ("error" in gate) {
    // Surface the contract's UNAUTHORIZED code for the unauthenticated case while
    // keeping requireRole's status (401/403).
    return gate.error;
  }
  const { supabase, organizationId } = gate;

  const url = new URL(request.url);
  const params = url.searchParams;

  // --- validate & collect filters (invalid enum/date → 400 INVALID_FILTER) ----
  const sourceTypeParam = params.get("source_type");
  let sourceTypes: string[] | null = null;
  if (sourceTypeParam !== null && sourceTypeParam.trim() !== "") {
    sourceTypes = sourceTypeParam
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const invalid = sourceTypes.filter((s) => !isFunderCategory(s));
    if (invalid.length > 0) {
      return jsonError(
        `Invalid source_type value(s): ${invalid.join(", ")}.`,
        "INVALID_FILTER",
        400,
      );
    }
  }

  const eligibilityFlagParam = params.get("eligibility_flag");
  let eligibilityFlag: EligibilityFlag | null = null;
  if (eligibilityFlagParam !== null && eligibilityFlagParam.trim() !== "") {
    if (!(ELIGIBILITY_FLAGS as readonly string[]).includes(eligibilityFlagParam)) {
      return jsonError(
        `Invalid eligibility_flag value: ${eligibilityFlagParam}.`,
        "INVALID_FILTER",
        400,
      );
    }
    eligibilityFlag = eligibilityFlagParam as EligibilityFlag;
  }

  const statusParam = params.get("status");
  if (statusParam !== null && statusParam.trim() !== "" && !isOpportunityStatus(statusParam)) {
    return jsonError(
      `Invalid status value: ${statusParam}.`,
      "INVALID_FILTER",
      400,
    );
  }
  const status = statusParam && statusParam.trim() !== "" ? statusParam : null;

  const from = params.get("from");
  if (from !== null && from.trim() !== "" && !isValidDateString(from)) {
    return jsonError(`Invalid 'from' date: ${from}.`, "INVALID_FILTER", 400);
  }
  const to = params.get("to");
  if (to !== null && to.trim() !== "" && !isValidDateString(to)) {
    return jsonError(`Invalid 'to' date: ${to}.`, "INVALID_FILTER", 400);
  }

  const page = parsePositiveInt(params.get("page"), 1);
  const limit = Math.min(parsePositiveInt(params.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
  const offset = (page - 1) * limit;

  // --- build the query (filters BEFORE order()/range()) -----------------------
  let query = supabase
    .from("opportunities")
    .select(GRANT_SELECT, { count: "exact" })
    .eq("organization_id", organizationId);

  if (sourceTypes && sourceTypes.length > 0) {
    query = query.in("category", sourceTypes);
  }
  if (status) {
    query = query.eq("status", status);
  }
  if (from && from.trim() !== "") {
    query = query.gte("deadline", from);
  }
  if (to && to.trim() !== "") {
    query = query.lte("deadline", to);
  }

  // eligibility_flag is derived from the numeric eligibility_score, so translate
  // the requested bucket into score predicates (a `.lt(…)` excludes NULLs in PG).
  if (eligibilityFlag === "high_match") {
    query = query.gte("eligibility_score", 80);
  } else if (eligibilityFlag === "moderate_match") {
    query = query.gte("eligibility_score", 60).lt("eligibility_score", 80);
  } else if (eligibilityFlag === "low_match") {
    query = query.lt("eligibility_score", 60);
  } else if (eligibilityFlag === "unscored") {
    query = query.is("eligibility_score", null);
  }

  const { data, error, count } = await query
    // Default sort: best match first (unscored last), then newest (Match
    // Percentage feature — opportunity lists sort by match by default).
    .order("match_percentage", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return jsonError("Failed to load grants.", "DB_ERROR", 500);
  }

  const grants = ((data ?? []) as unknown as OpportunityRow[]).map(serializeGrant);

  return NextResponse.json({
    data: grants,
    total: count ?? 0,
    page,
    limit,
  });
}
