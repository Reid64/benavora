import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Enums } from "@/types/database";

// CSV -> funders bulk import, backing the wizard at
// src/app/(dashboard)/import/page.tsx.
//
// POST /api/import/csv
// Body: { records: Record<string, string>[], mapping: Record<string, string> }
//   - records: raw parsed CSV rows keyed by their original column header
//     (the client ships unmapped data; this route does the mapping).
//   - mapping: target field -> CSV column name, for
//     name/email/website/category/phone/state/notes.
//
// Auth: requireRole("writer") authenticates the session and derives
// organization_id from the caller's profile (Behavioral Contracts §2 - never
// trusted from the request body). The bulk write itself then goes through
// the service-role client so it isn't bottlenecked by per-row RLS
// evaluation on a large CSV; every inserted row is still stamped with the
// session-derived organization_id, so this can never write into another
// org's funders even though the client bypasses RLS.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FunderCategory = Enums<"funder_category">;
type FunderInsert = Database["public"]["Tables"]["funders"]["Insert"];

type ImportField = "name" | "email" | "website" | "category" | "phone" | "state" | "notes";

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

// funder_category has no "Other" member in the live enum, so an unmapped or
// unrecognized category falls back to the same neutral default already used
// elsewhere in this codebase (Behavioral Contracts §17) rather than
// inserting a value the column would reject outright.
const DEFAULT_CATEGORY: FunderCategory = "government_grant";

function normalizeCategory(value: string): FunderCategory {
  const norm = value.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if ((VALID_CATEGORIES as readonly string[]).includes(norm)) {
    return norm as FunderCategory;
  }
  return DEFAULT_CATEGORY;
}

function strOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body.", code: "invalid_body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object.", code: "invalid_body" }, { status: 400 });
  }

  const { records, mapping } = body as { records?: unknown; mapping?: unknown };

  if (!Array.isArray(records)) {
    return NextResponse.json(
      { error: "'records' must be an array.", code: "invalid_body" },
      { status: 400 },
    );
  }
  if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) {
    return NextResponse.json(
      { error: "'mapping' must be an object.", code: "invalid_body" },
      { status: 400 },
    );
  }

  const fieldMapping = mapping as Partial<Record<ImportField, string>>;

  const toInsert: FunderInsert[] = [];
  const errors: string[] = [];
  let failed = 0;

  records.forEach((raw, index) => {
    const rowNum = index + 1;
    if (typeof raw !== "object" || raw === null) {
      failed++;
      errors.push(`Row ${rowNum}: not a valid record - skipped`);
      return;
    }
    const record = raw as Record<string, unknown>;

    const valueFor = (field: ImportField): unknown => {
      const col = fieldMapping[field];
      if (!col) return undefined;
      return record[col];
    };

    const name = strOrNull(valueFor("name"));
    if (!name) {
      failed++;
      errors.push(`Row ${rowNum}: name is missing - skipped`);
      return;
    }

    const categoryRaw = strOrNull(valueFor("category"));
    const category = categoryRaw ? normalizeCategory(categoryRaw) : DEFAULT_CATEGORY;

    toInsert.push({
      organization_id: organizationId,
      name,
      category,
      website: strOrNull(valueFor("website")),
      geographic_focus: strOrNull(valueFor("state")),
      notes: strOrNull(valueFor("notes")),
    });
  });

  if (toInsert.length === 0) {
    return NextResponse.json({ imported: 0, failed, errors });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("funders").upsert(toInsert);
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

  return NextResponse.json({ imported: toInsert.length, failed, errors });
}
