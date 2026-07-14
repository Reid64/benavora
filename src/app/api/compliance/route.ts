import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET   /api/compliance - aggregate compliance obligations from existing tables
//       plus manually tracked ones in compliance_requirements.
// POST  /api/compliance - create a manually tracked compliance_requirements row.
// PATCH /api/compliance - update a compliance_requirements row's status (e.g. Mark Submitted).
// Sources: deadlines (reporting_deadline type), renewals (reporting_deadline +
// compliance_status), documents (expiration_date), compliance_requirements
// (obligations that aren't derivable from those tables - matching funds,
// regulatory filings, custom reporting asks).

export const runtime = "nodejs";

const STATUS_VALUES = ["upcoming", "due_soon", "overdue", "submitted"] as const;

export type ComplianceItem = {
  id: string;
  type: string;
  title: string;
  due_date: string;
  status: string;
  entity_type: "deadline" | "renewal" | "document" | "requirement";
  entity_id: string;
  application_id: string | null;
  opportunity_id: string | null;
  notes?: string | null;
};

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const [deadlinesResult, renewalsResult, documentsResult, requirementsResult] =
    await Promise.all([
      supabase
        .from("deadlines")
        .select(
          "id, title, due_date, is_completed, application_id, opportunity_id",
        )
        .eq("deadline_type", "reporting_deadline")
        .order("due_date", { ascending: true }),
      supabase
        .from("renewals")
        .select(
          "id, application_id, opportunity_id, reporting_deadline, compliance_status, opportunities(title)",
        )
        .not("reporting_deadline", "is", null)
        .order("reporting_deadline", { ascending: true }),
      supabase
        .from("documents")
        .select("id, file_name, category, expiration_date")
        .not("expiration_date", "is", null)
        .order("expiration_date", { ascending: true }),
      supabase
        .from("compliance_requirements")
        .select("id, application_id, requirement_type, title, due_date, status, notes")
        .eq("organization_id", organizationId)
        .order("due_date", { ascending: true }),
    ]);

  const items: ComplianceItem[] = [];

  for (const d of deadlinesResult.data ?? []) {
    items.push({
      id: `deadline-${d.id}`,
      type: "reporting_deadline",
      title: d.title,
      due_date: d.due_date,
      status: d.is_completed ? "completed" : "pending",
      entity_type: "deadline",
      entity_id: d.id,
      application_id: d.application_id ?? null,
      opportunity_id: d.opportunity_id ?? null,
    });
  }

  type RenewalRow = {
    id: string;
    application_id: string;
    opportunity_id: string;
    reporting_deadline: string | null;
    compliance_status: string;
    opportunities: { title: string } | null;
  };

  for (const r of (renewalsResult.data ?? []) as unknown as RenewalRow[]) {
    if (!r.reporting_deadline) continue;
    const grantName = r.opportunities?.title ?? "Grant";
    items.push({
      id: `renewal-${r.id}-report`,
      type: "renewal_reporting",
      title: `${grantName} - Compliance Report`,
      due_date: r.reporting_deadline,
      status: r.compliance_status,
      entity_type: "renewal",
      entity_id: r.id,
      application_id: r.application_id,
      opportunity_id: r.opportunity_id,
    });
  }

  type DocumentRow = {
    id: string;
    file_name: string;
    category: string;
    expiration_date: string | null;
  };

  for (const doc of (documentsResult.data ?? []) as unknown as DocumentRow[]) {
    if (!doc.expiration_date) continue;
    items.push({
      id: `document-${doc.id}`,
      type: "document_expiration",
      title: `${doc.file_name} (${doc.category})`,
      due_date: doc.expiration_date,
      status: "active",
      entity_type: "document",
      entity_id: doc.id,
      application_id: null,
      opportunity_id: null,
    });
  }

  type RequirementRow = {
    id: string;
    application_id: string | null;
    requirement_type: string;
    title: string;
    due_date: string;
    status: string;
    notes: string | null;
  };

  for (const req of (requirementsResult.data ?? []) as unknown as RequirementRow[]) {
    items.push({
      id: `requirement-${req.id}`,
      type: req.requirement_type,
      title: req.title,
      due_date: req.due_date,
      status: req.status,
      entity_type: "requirement",
      entity_id: req.id,
      application_id: req.application_id,
      opportunity_id: null,
      notes: req.notes,
    });
  }

  items.sort((a, b) => a.due_date.localeCompare(b.due_date));

  return NextResponse.json({ data: items });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const {
    application_id: applicationId,
    requirement_type: requirementType,
    title,
    due_date: dueDate,
    notes,
  } = (raw ?? {}) as {
    application_id?: unknown;
    requirement_type?: unknown;
    title?: unknown;
    due_date?: unknown;
    notes?: unknown;
  };

  if (typeof requirementType !== "string" || requirementType.trim() === "") {
    return jsonError("requirement_type is required.", "invalid_input", 400);
  }
  if (typeof title !== "string" || title.trim() === "") {
    return jsonError("title is required.", "invalid_input", 400);
  }
  if (typeof dueDate !== "string" || dueDate.trim() === "") {
    return jsonError("due_date is required.", "invalid_input", 400);
  }
  if (applicationId !== undefined && applicationId !== null && typeof applicationId !== "string") {
    return jsonError("application_id must be a string.", "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("compliance_requirements")
    .insert({
      organization_id: organizationId,
      application_id: typeof applicationId === "string" ? applicationId : null,
      requirement_type: requirementType.trim(),
      title: title.trim(),
      due_date: dueDate.trim(),
      notes: typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null,
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to create compliance requirement.", "db_error", 500);
  }

  return NextResponse.json({ requirement: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { id, status } = (raw ?? {}) as { id?: unknown; status?: unknown };

  if (typeof id !== "string" || id.trim() === "") {
    return jsonError("id is required.", "invalid_input", 400);
  }
  if (typeof status !== "string" || !STATUS_VALUES.includes(status as (typeof STATUS_VALUES)[number])) {
    return jsonError(`status must be one of: ${STATUS_VALUES.join(", ")}.`, "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("compliance_requirements")
    .update({
      status,
      submitted_at: status === "submitted" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select()
    .single();

  if (error) {
    return jsonError("Failed to update compliance requirement.", "db_error", 500);
  }

  return NextResponse.json({ requirement: data });
}
