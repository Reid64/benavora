import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import type { Database, Enums } from "@/types/database";

export const runtime = "nodejs";

type FunderCategory = Enums<"funder_category">;
type FunderInsert = Database["public"]["Tables"]["funders"]["Insert"];

// Cap on how many of a CSV import's newly-created funders get an immediate
// reputation-monitoring enqueue (FEATURE_REGISTRY_v2.md #151). A single
// import can bring in hundreds of rows — enqueueing a real DuckDuckGo+Claude
// check for every one of them in a single request would be an unbounded
// batch, not a bounded background job. The rest are still covered by the
// nightly sweep, just not enrolled immediately.
const MAX_MONITORING_ENROLLMENTS = 25;

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

function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] ?? "";
    if (ch === '"') {
      if (inQuotes && src[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if (ch === "\n" && !inQuotes) {
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) result.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) result.push(row);
  }
  return result;
}

function normalizeCategory(value: string): FunderCategory {
  const norm = value
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  if ((VALID_CATEGORIES as readonly string[]).includes(norm)) {
    return norm as FunderCategory;
  }
  // Default per Behavioral Contracts §17.
  return "government_grant";
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data.", code: "invalid_body" },
      { status: 400 },
    );
  }

  const fileEntry = formData.get("file");
  const mappingRaw = formData.get("mapping");

  if (!(fileEntry instanceof File)) {
    return NextResponse.json(
      { error: "CSV file is required.", code: "missing_file" },
      { status: 400 },
    );
  }
  if (fileEntry.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File exceeds the 10 MB limit.", code: "file_too_large" },
      { status: 400 },
    );
  }
  if (typeof mappingRaw !== "string") {
    return NextResponse.json(
      { error: "Column mapping is required.", code: "missing_mapping" },
      { status: 400 },
    );
  }

  let mapping: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(mappingRaw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    mapping = parsed as Record<string, string>;
  } catch {
    return NextResponse.json(
      { error: "Invalid column mapping JSON.", code: "invalid_mapping" },
      { status: 400 },
    );
  }

  const csvText = await fileEntry.text();
  const rows = parseCSV(csvText);

  if (rows.length < 2) {
    return NextResponse.json(
      {
        error: "CSV must have a header row and at least one data row.",
        code: "empty_file",
      },
      { status: 400 },
    );
  }

  const headers = (rows[0] ?? []).map((h) => h.trim());
  const dataRows = rows.slice(1);

  const nameCol = mapping["name"];
  if (!nameCol) {
    return NextResponse.json(
      { error: "The 'name' column mapping is required.", code: "missing_name_mapping" },
      { status: 400 },
    );
  }

  const nameIdx = headers.indexOf(nameCol);
  if (nameIdx === -1) {
    return NextResponse.json(
      {
        error: `CSV column "${nameCol}" not found in headers.`,
        code: "column_not_found",
      },
      { status: 400 },
    );
  }

  const colIdx = (funderField: string): number => {
    const col = mapping[funderField];
    if (!col) return -1;
    return headers.indexOf(col);
  };

  const categoryIdx = colIdx("category");
  const descIdx = colIdx("description");
  const websiteIdx = colIdx("website");
  const portalIdx = colIdx("giving_portal_url");
  const budgetIdx = colIdx("annual_giving_budget");
  const geoIdx = colIdx("geographic_focus");
  const notesIdx = colIdx("notes");

  const toInsert: FunderInsert[] = [];
  const errors: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row) continue;
    const rowNum = i + 2;

    const name = (row[nameIdx] ?? "").trim();
    if (!name) {
      errors.push(`Row ${rowNum}: name is empty — skipped`);
      continue;
    }

    const categoryRaw = categoryIdx >= 0 ? (row[categoryIdx] ?? "").trim() : "";
    const category = categoryRaw ? normalizeCategory(categoryRaw) : "government_grant";

    const str = (idx: number): string | null => {
      if (idx < 0) return null;
      const v = (row[idx] ?? "").trim();
      return v || null;
    };

    let annual_giving_budget: number | null = null;
    if (budgetIdx >= 0) {
      const raw = (row[budgetIdx] ?? "").replace(/[$,\s]/g, "");
      if (raw) {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed)) annual_giving_budget = parsed;
      }
    }

    toInsert.push({
      organization_id: organizationId,
      name,
      category,
      description: str(descIdx),
      website: str(websiteIdx),
      giving_portal_url: str(portalIdx),
      annual_giving_budget,
      geographic_focus: str(geoIdx),
      notes: str(notesIdx),
    });
  }

  // Abort if >20% of rows fail validation (Behavioral Contracts §22).
  if (dataRows.length > 0 && errors.length / dataRows.length > 0.2) {
    return NextResponse.json(
      {
        imported: 0,
        errors: [
          `Import aborted: ${errors.length} of ${dataRows.length} rows failed (>${Math.round((errors.length / dataRows.length) * 100)}%). Fix the errors and retry.`,
          ...errors.slice(0, 20),
        ],
      },
      { status: 422 },
    );
  }

  if (toInsert.length === 0) {
    return NextResponse.json(
      { imported: 0, errors: ["No valid rows found to import."] },
      { status: 400 },
    );
  }

  const { data: insertedRows, error: insertError } = await supabase
    .from("funders")
    .insert(toInsert)
    .select("id, name");
  if (insertError) {
    return NextResponse.json(
      {
        error: "Database insert failed. Please try again.",
        code: "db_error",
      },
      { status: 500 },
    );
  }

  // Enroll the imported funders in reputation monitoring (FEATURE_REGISTRY_v2.md
  // #151) instead of waiting for the nightly sweep's 5-funder/night sample. A
  // CSV import can bring in hundreds of rows in one request — capped to the
  // first MAX_MONITORING_ENROLLMENTS to avoid enqueueing an unbounded batch of
  // real DuckDuckGo+Claude checks off a single import; the rest are still
  // reachable by the nightly sweep like any other funder. Best-effort: a
  // failed enqueue never fails the import itself, since the funders are
  // already committed.
  const toEnroll = (insertedRows ?? []).slice(0, MAX_MONITORING_ENROLLMENTS);
  if (toEnroll.length > 0) {
    const { error: queueError } = await supabase.from("agent_queue").insert(
      toEnroll.map((funder) => ({
        org_id: organizationId,
        agent_id: "reputation",
        priority: 5,
        status: "queued" as const,
        trigger_source: "event" as const,
        input_payload: {
          entityId: funder.id,
          entityType: "funder",
          entityName: funder.name,
        },
      })),
    );
    if (queueError) {
      errors.push(
        `Reputation monitoring enrollment failed (funders were still imported): ${queueError.message}`,
      );
    }
  }

  return NextResponse.json({ imported: toInsert.length, errors });
}
