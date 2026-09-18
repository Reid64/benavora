// GET /api/intelligence/outreach/prospects — lists corporate prospects for the
// Corporate Outreach composer's prospect selector.
//
// corporate_prospects (SCHEMA_REGISTRY_v2.md #36) has no organization_id — it's
// a shared, cross-org table with no migration file in this repo (applied
// directly via the Management API) and no confirmed RLS policy. Reads go
// through the service-role admin client rather than the session-scoped client,
// same precedent as src/lib/email/template-engine.ts's cross-cutting reads.
//
// intent_score is a best-effort join against corporate_intent_signals
// (migration 093), which is org-scoped but keys rows by `company_name` text,
// not a foreign key to corporate_prospects.id (see AGENTS_v2.md AG-30 spec) —
// matched here case-insensitively against legal_name/dba_name.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const HIGH_INTENT_SIGNAL_LOOKBACK = 500;

interface CorporateProspectRow {
  id: string;
  legal_name: string;
  dba_name: string | null;
  industry_category: string | null;
  naics_description: string | null;
  address_city: string | null;
  address_state: string | null;
  email: string | null;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
  const limitParam = Number(searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const admin = createAdminClient();

  let query = admin
    .from("corporate_prospects")
    .select("id, legal_name, dba_name, industry_category, naics_description, address_city, address_state, email")
    .order("legal_name", { ascending: true })
    .limit(limit);

  if (q) {
    const escaped = q.replace(/[%,]/g, "");
    if (escaped) {
      query = query.or(
        `legal_name.ilike.%${escaped}%,dba_name.ilike.%${escaped}%,industry_category.ilike.%${escaped}%`,
      );
    }
  }

  const [prospectsRes, signalsRes] = await Promise.all([
    query,
    admin
      .from("corporate_intent_signals")
      .select("company_name, intent_score")
      .eq("org_id", organizationId)
      .not("intent_score", "is", null)
      .order("created_at", { ascending: false })
      .limit(HIGH_INTENT_SIGNAL_LOOKBACK),
  ]);

  if (prospectsRes.error) {
    return jsonError("Could not load corporate prospects.", 500);
  }

  const intentByName = new Map<string, number>();
  for (const signal of (signalsRes.data ?? []) as { company_name: string; intent_score: number | null }[]) {
    if (signal.intent_score == null) continue;
    const key = signal.company_name.trim().toLowerCase();
    const existing = intentByName.get(key);
    if (existing === undefined || signal.intent_score > existing) {
      intentByName.set(key, signal.intent_score);
    }
  }

  const prospects = ((prospectsRes.data ?? []) as CorporateProspectRow[]).map((row) => {
    const displayName = row.dba_name?.trim() || row.legal_name;
    const intentScore =
      intentByName.get(row.legal_name.trim().toLowerCase()) ??
      (row.dba_name ? intentByName.get(row.dba_name.trim().toLowerCase()) : undefined) ??
      null;

    return {
      id: row.id,
      legalName: row.legal_name,
      dbaName: row.dba_name,
      displayName,
      industry: row.industry_category || row.naics_description,
      city: row.address_city,
      state: row.address_state,
      email: row.email,
      intentScore,
    };
  });

  return NextResponse.json({ prospects });
}
