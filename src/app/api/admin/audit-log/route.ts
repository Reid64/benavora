import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// Audit log reader (BLUEPRINT Phase 5 / Behavioral Contracts §24).
//
// GET → the organization's audit trail, newest first, enriched with each actor's
// name/email. Owner/admin only (Contracts §24: "Only owner and admin can view
// audit logs"); organization_id is derived from the session, never the request.
//
// Optional query params narrow the result set server-side:
//   action, entityType, userId, from (ISO date), to (ISO date), limit (≤1000).

export const runtime = "nodejs";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

export async function GET(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const entityType = url.searchParams.get("entityType");
  const userId = url.searchParams.get("userId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limitParam = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  // Filters must be applied before order()/limit() (those return a transform
  // builder that no longer exposes .eq()/.gte()).
  let query = supabase
    .from("audit_logs")
    .select(
      "id, created_at, user_id, action, entity_type, entity_id, details, ip_address",
    )
    .eq("organization_id", organizationId);

  if (action) query = query.eq("action", action);
  if (entityType) query = query.eq("entity_type", entityType);
  if (userId) query = query.eq("user_id", userId);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json(
      { error: "Could not load the audit log.", code: "load_failed" },
      { status: 500 },
    );
  }
  const rows = (data ?? []) as {
    id: string;
    created_at: string;
    user_id: string | null;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    details: unknown;
    ip_address: string | null;
  }[];

  // Resolve actor names in one query (RLS scopes profiles to the org).
  const userIds = Array.from(
    new Set(rows.map((r) => r.user_id).filter((id): id is string => Boolean(id))),
  );
  const userMap = new Map<string, { name: string | null; email: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    for (const p of (profiles ?? []) as {
      id: string;
      full_name: string | null;
      email: string | null;
    }[]) {
      userMap.set(p.id, { name: p.full_name, email: p.email });
    }
  }

  const entries = rows.map((r) => {
    const actor = r.user_id ? userMap.get(r.user_id) : null;
    return {
      id: r.id,
      createdAt: r.created_at,
      userId: r.user_id,
      userName: actor?.name ?? null,
      userEmail: actor?.email ?? null,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details ?? {},
      ipAddress: r.ip_address,
    };
  });

  // Distinct actors present, for the filter dropdown.
  const actors = Array.from(userMap.entries()).map(([id, v]) => ({
    id,
    name: v.name,
    email: v.email,
  }));

  return NextResponse.json({ entries, actors });
}
