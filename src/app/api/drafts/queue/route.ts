// GET  /api/drafts/queue — list the org's draft automation queue with joins.
// POST /api/drafts/queue — manually add an opportunity to the draft queue.
// Derives organization_id from the authenticated session (never the request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const VALID_SORTS = ["deadline", "priority", "created"] as const;
type SortOption = (typeof VALID_SORTS)[number];

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function calculatePriority(deadlineDate: string | null | undefined): number {
  if (!deadlineDate) return 5;
  const daysUntil = Math.ceil(
    (new Date(deadlineDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (daysUntil <= 7) return 1;
  if (daysUntil <= 14) return 2;
  if (daysUntil <= 30) return 3;
  return 4;
}

export async function GET(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const priorityParam = url.searchParams.get("priority");
  const rawSort = url.searchParams.get("sort") ?? "priority";
  const sort: SortOption = (VALID_SORTS as readonly string[]).includes(rawSort)
    ? (rawSort as SortOption)
    : "priority";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

  let query = supabase
    .from("draft_queue")
    .select(
      "*, opportunity:opportunities(id, name, deadline, funder_id, funder:funders(id, name))",
      { count: "exact" },
    )
    .eq("organization_id", organizationId)
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }
  if (priorityParam !== null) {
    const p = Number(priorityParam);
    if (!Number.isNaN(p)) {
      query = query.eq("priority", p);
    }
  }

  if (sort === "deadline") {
    query = query
      .order("deadline_date", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: true });
  } else if (sort === "created") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query
      .order("priority", { ascending: true })
      .order("deadline_date", { ascending: true, nullsFirst: false });
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to load draft queue." }, { status: 500 });
  }

  return NextResponse.json({ items: data ?? [], total: count ?? 0, limit, offset });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const { opportunity_id: opportunityId, template_type, priority: priorityInput } = input;

  if (!isUuid(opportunityId)) {
    return NextResponse.json(
      { error: "opportunity_id must be a valid UUID." },
      { status: 400 },
    );
  }

  const templateType =
    typeof template_type === "string" && template_type.trim()
      ? template_type.trim()
      : "full_proposal";

  const explicitPriority =
    typeof priorityInput === "number"
      ? Math.min(5, Math.max(1, Math.round(priorityInput)))
      : null;

  // Verify the opportunity belongs to this org.
  const { data: opp, error: oppError } = await supabase
    .from("opportunities")
    .select("id, deadline")
    .eq("id", opportunityId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (oppError || !opp) {
    return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  }

  const deadlineDate = (opp as { id: string; deadline?: string | null }).deadline ?? null;
  const priority = explicitPriority ?? calculatePriority(deadlineDate);

  // Deduplicate by org + opportunity + template.
  const { data: existing } = await supabase
    .from("draft_queue")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("opportunity_id", opportunityId)
    .eq("template_type", templateType)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "This opportunity + template combination is already in the queue.", code: "duplicate" },
      { status: 409 },
    );
  }

  const { data: newItem, error: insertError } = await supabase
    .from("draft_queue")
    .insert({
      organization_id: organizationId,
      opportunity_id: opportunityId,
      status: "pending",
      trigger_reason: "manual",
      template_type: templateType,
      priority,
      deadline_date: deadlineDate,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: "Failed to add to draft queue." }, { status: 500 });
  }

  return NextResponse.json({ item: newItem }, { status: 201 });
}
