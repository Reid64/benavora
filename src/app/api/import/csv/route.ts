import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import type { Database, Enums } from "@/types/database";

// Generic CSV → funders import endpoint backing src/app/(dashboard)/import.
//
// POST /api/import/csv
// Body: JSON array of records already mapped client-side to funders fields
// (produced by the wizard's column-mapping step). Every row requires `name`;
// rows missing it are counted as failed, not inserted.
//
// Auth: requireRole("writer") (Behavioral Contracts §2/§16) — the session
// client is RLS-scoped to the caller's organization, so no manual org filter
// is needed on insert. Service-role is reserved for system jobs
// (src/lib/supabase/admin.ts), never user-facing routes like this one.

export const runtime = "nodejs";

type FunderCategory = Enums<"funder_category">;
type FunderInsert = Database["public"]["Tables"]["funders"]["Insert"];

const VALID_CATEGORIES: readonly FunderCategory[] = [
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
];

function normalizeCategory(value: unknown): FunderCategory {
  const norm = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if ((VALID_CATEGORIES as readonly string[]).includes(norm)) {
    return norm as FunderCategory;
  }
  return "government_grant";
}

function strOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "invalid_body" },
      { status: 400 },
    );
  }

  if (!Array.isArray(body)) {
    return NextResponse.json(
      { error: "Body must be a JSON array of records.", code: "invalid_body" },
      { status: 400 },
    );
  }

  const toInsert: FunderInsert[] = [];
  let failed = 0;

  for (const raw of body) {
    if (typeof raw !== "object" || raw === null) {
      failed++;
      continue;
    }
    const record = raw as Record<string, unknown>;
    const name = strOrNull(record["name"]);
    if (!name) {
      failed++;
      continue;
    }

    toInsert.push({
      organization_id: organizationId,
      name,
      category: normalizeCategory(record["category"]),
      website: strOrNull(record["website"]),
      geographic_focus: strOrNull(record["state"]),
      notes: strOrNull(record["notes"]),
    });
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ imported: 0, failed });
  }

  const { error } = await supabase.from("funders").insert(toInsert);
  if (error) {
    return NextResponse.json(
      {
        error: "Database insert failed. Please try again.",
        code: "db_error",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ imported: toInsert.length, failed });
}
