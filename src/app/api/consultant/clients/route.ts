// Consultant Clients — list and grant endpoints (BLUEPRINT §12, White-Label
// Client Portal). Lets a consultant-tier organization see and manage which
// client organizations it has been granted access to.
//
// GET  — list the caller's granted client organizations.
// POST — grant access to a client org, looked up by a member's email.
//
// requireRole gates on the caller's own org/role via the session client.
// The actual data lookups then use the service-role admin client because
// resolving another organization's name (GET) or finding a profile by email
// across orgs (POST) is cross-tenant by design and RLS would block it.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const admin = createAdminClient();

  const { data: grants, error } = await admin
    .from("consultant_client_access")
    .select("id, client_org_id, access_level, granted_at, active")
    .eq("consultant_org_id", organizationId)
    .order("granted_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load client access grants.", "load_failed", 500);
  }

  const clientOrgIds = (grants ?? []).map((g) => g.client_org_id as string);
  let orgsById: Record<string, { id: string; name: string }> = {};

  if (clientOrgIds.length > 0) {
    const { data: orgs, error: orgsError } = await admin
      .from("organizations")
      .select("id, name")
      .in("id", clientOrgIds);

    if (orgsError) {
      return jsonError("Failed to load client organizations.", "load_failed", 500);
    }

    orgsById = Object.fromEntries(
      (orgs ?? []).map((o) => [o.id as string, o as { id: string; name: string }]),
    );
  }

  const clients = (grants ?? []).map((g) => ({
    id: g.id as string,
    access_level: g.access_level as string,
    granted_at: g.granted_at as string,
    active: g.active as boolean,
    organization: orgsById[g.client_org_id as string] ?? null,
  }));

  return NextResponse.json({ clients });
}

export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  const { email } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || !email.trim()) {
    return jsonError("email is required.", "missing_field", 400);
  }

  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (profileError) {
    return jsonError("Failed to look up that email.", "lookup_failed", 500);
  }
  if (!profile) {
    return jsonError("No user found with that email.", "not_found", 404);
  }

  const clientOrgId = profile.organization_id as string;
  if (clientOrgId === organizationId) {
    return jsonError("You cannot grant access to your own organization.", "self_grant", 400);
  }

  const { data, error } = await admin
    .from("consultant_client_access")
    .upsert(
      {
        consultant_org_id: organizationId,
        client_org_id: clientOrgId,
        access_level: "read",
        active: true,
      },
      { onConflict: "consultant_org_id,client_org_id" },
    )
    .select("id, client_org_id, access_level, granted_at, active")
    .single();

  if (error) {
    return jsonError("Failed to grant client access.", "grant_failed", 500);
  }

  return NextResponse.json({ client: data }, { status: 201 });
}
