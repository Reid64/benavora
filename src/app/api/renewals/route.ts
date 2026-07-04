import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET /api/renewals — active renewal obligations for the org, sorted by
// nearest reporting deadline. Backs src/app/(dashboard)/renewals/page.tsx,
// which previously called this exact path with no route behind it at all.
// The `renewals` table (migration-tracked, org-scoped) already existed and is
// read directly elsewhere (Deadlines/Financials pages) — this route was
// simply never built.

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("renewals")
    .select(
      "id, application_id, opportunity_id, funder_id, renewal_type, reporting_deadline, renewal_window_start, renewal_window_end, compliance_status, compliance_notes, auto_narrative_draft, created_at, " +
        "opportunities:opportunity_id ( id, name, recurrence ), " +
        "funders:funder_id ( id, name ), " +
        "applications:application_id ( id, draft_content, awarded_amount )",
    )
    .eq("organization_id", organizationId)
    .order("reporting_deadline", { ascending: true, nullsFirst: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load renewals.", code: "load_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] });
}
