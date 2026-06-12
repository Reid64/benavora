import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit/logger";
import {
  GRANT_SELECT,
  isFunderCategory,
  isOpportunityStatus,
  isUuid,
  isValidDateString,
  resolveGrantOwnership,
  serializeGrant,
  type OpportunityRow,
} from "@/lib/grants/grants-service";

// GET  /api/grants/[id]   — full detail for one org-owned grant
// PATCH /api/grants/[id]  — update mutable fields on one org-owned grant
// (BEHAVIORAL_CONTRACTS "GET/PATCH /api/grants/[id]").
//
// "Grant" maps to the live `opportunities` table; organization_id is derived from
// the session (Six Laws Law 2), never the request body. Ownership is resolved so
// the contract's 403 (exists, other org) and 404 (no such grant) can be
// distinguished — see resolveGrantOwnership. Reads/writes touch ONLY the real
// `opportunities` table.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

type RouteContext = { params: { id: string } };

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const id = params.id;
  if (!isUuid(id)) {
    return jsonError("Grant not found.", "NOT_FOUND", 404);
  }

  // Fetch the grant scoped to the caller's org (RLS is a second barrier).
  const { data, error } = await supabase
    .from("opportunities")
    .select(GRANT_SELECT)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return jsonError("Failed to load the grant.", "DB_ERROR", 500);
  }

  if (!data) {
    // Not visible to this org — is it another org's grant (403) or absent (404)?
    const ownership = await resolveGrantOwnership(createAdminClient(), id, organizationId);
    if (ownership.status === "forbidden") {
      return jsonError(
        "This grant does not belong to your organization.",
        "FORBIDDEN",
        403,
      );
    }
    if (ownership.status === "error") {
      return jsonError("Failed to load the grant.", "DB_ERROR", 500);
    }
    return jsonError("Grant not found.", "NOT_FOUND", 404);
  }

  return NextResponse.json({ data: serializeGrant(data as unknown as OpportunityRow) });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  // Mutating a grant is a write action — viewers are read-only (Contracts).
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const id = params.id;
  if (!isUuid(id)) {
    return jsonError("Grant not found.", "NOT_FOUND", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "VALIDATION_ERROR", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError("Request body must be a JSON object.", "VALIDATION_ERROR", 400);
  }
  const input = body as Record<string, unknown>;

  // Build the partial update from the contract's mutable fields, mapped to real
  // `opportunities` columns. Omitted fields are not modified — no implicit
  // nulling (Contracts conventions). `update` is intentionally `Record<…>`: the
  // 2.108 typed-query inference computes the payload as `never` (see
  // supabase/server.ts), so the row shape is asserted at the .update() call.
  const update: Record<string, unknown> = {};

  if ("source_type" in input && input.source_type !== undefined) {
    const sourceType = input.source_type;
    if (typeof sourceType !== "string" || !isFunderCategory(sourceType)) {
      return jsonError(
        "Provided source_type is not a valid value.",
        "INVALID_SOURCE_TYPE",
        400,
      );
    }
    update.category = sourceType;
  }

  if ("status" in input && input.status !== undefined) {
    const status = input.status;
    if (typeof status !== "string" || !isOpportunityStatus(status)) {
      return jsonError(
        "Provided status is not a valid value.",
        "VALIDATION_ERROR",
        400,
      );
    }
    update.status = status;
  }

  // amount_requested → amount_min, amount_awarded → amount_available (see the
  // mapping in grants-service). Amounts are non-negative integers.
  for (const [field, column] of [
    ["amount_requested", "amount_min"],
    ["amount_awarded", "amount_available"],
  ] as const) {
    if (field in input && input[field] !== undefined) {
      const value = input[field];
      if (value === null) {
        update[column] = null;
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
        return jsonError(
          `${field} must be a non-negative integer.`,
          "VALIDATION_ERROR",
          400,
        );
      }
      update[column] = value;
    }
  }

  if ("deadline" in input && input.deadline !== undefined) {
    const deadline = input.deadline;
    if (deadline === null) {
      update.deadline = null;
    } else if (typeof deadline !== "string" || !isValidDateString(deadline)) {
      return jsonError("deadline must be a valid ISO date.", "VALIDATION_ERROR", 400);
    } else {
      update.deadline = deadline;
    }
  }

  if (Object.keys(update).length === 0) {
    return jsonError(
      "No updatable fields were provided.",
      "VALIDATION_ERROR",
      400,
    );
  }

  // Confirm the grant exists and belongs to this org BEFORE writing, so absent /
  // cross-org targets get the contract's 404 / 403 rather than a silent no-op.
  const ownership = await resolveGrantOwnership(createAdminClient(), id, organizationId);
  if (ownership.status === "forbidden") {
    return jsonError(
      "This grant does not belong to your organization.",
      "FORBIDDEN",
      403,
    );
  }
  if (ownership.status === "not_found") {
    return jsonError("Grant not found.", "NOT_FOUND", 404);
  }
  if (ownership.status === "error") {
    return jsonError("Database update failed.", "DB_ERROR", 500);
  }

  update.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("opportunities")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select(GRANT_SELECT)
    .maybeSingle();

  if (error || !data) {
    return jsonError("Database update failed.", "DB_ERROR", 500);
  }

  // Best-effort audit trail of the mutation (Contracts §24). Never blocks.
  await logAudit(supabase, {
    organizationId,
    userId,
    action: "update",
    entityType: "opportunity",
    entityId: id,
    details: { fields: Object.keys(update).filter((k) => k !== "updated_at") },
    request,
  });

  return NextResponse.json({ data: serializeGrant(data as unknown as OpportunityRow) });
}
