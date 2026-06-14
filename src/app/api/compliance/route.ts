import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET /api/compliance - aggregate compliance obligations from existing tables.
// Sources: deadlines (reporting_deadline type), renewals (reporting_deadline +
// compliance_status), documents (expiration_date). No compliance_obligations
// table exists; this is a read-only aggregation view.

export const runtime = "nodejs";

export type ComplianceItem = {
  id: string;
  type: "reporting_deadline" | "renewal_reporting" | "document_expiration";
  title: string;
  due_date: string;
  status: string;
  entity_type: "deadline" | "renewal" | "document";
  entity_id: string;
  application_id: string | null;
  opportunity_id: string | null;
};

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  const [deadlinesResult, renewalsResult, documentsResult] = await Promise.all([
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

  items.sort((a, b) => a.due_date.localeCompare(b.due_date));

  return NextResponse.json({ data: items });
}
