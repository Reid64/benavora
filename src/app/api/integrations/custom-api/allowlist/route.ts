import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { normalizeDomain } from "@/lib/security/custom-connector-allowlist";

// Custom Connector Domain Allowlist — list and create endpoints.
//
// Shared by both Custom API Connectors and Scraping Targets
// (custom_connector_allowlist, migration 132): a domain must be listed here,
// by an admin/owner, before any writer can point a connector or scrape
// target at it. This is the deliberately-not-end-user-configurable control
// requested for rows #59/#60's SSRF hardening — a writer can create
// connectors, but only against a domain an admin has already approved.
//
// GET  — any org member (viewer+) can see which domains are allowlisted.
// POST — admins and owners only.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("custom_connector_allowlist")
    .select("id, domain, label, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    return jsonError("Failed to load the domain allowlist.", "db_error", 500);
  }

  return NextResponse.json({ domains: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  const { domain, label } = (body ?? {}) as Record<string, unknown>;

  if (typeof domain !== "string" || !domain.trim()) {
    return jsonError("domain is required.", "missing_field", 400);
  }

  const normalized = normalizeDomain(domain);
  if (!normalized || !normalized.includes(".")) {
    return jsonError("Enter a valid domain (e.g. api.example.gov).", "invalid_domain", 400);
  }

  const { data, error } = await supabase
    .from("custom_connector_allowlist")
    .insert({
      organization_id: organizationId,
      domain: normalized,
      label: typeof label === "string" && label.trim() ? label.trim() : null,
      created_by: userId,
    })
    .select("id, domain, label, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return jsonError("This domain is already allowlisted.", "duplicate_domain", 409);
    }
    return jsonError("Failed to add the domain.", "db_error", 500);
  }

  return NextResponse.json({ domain: data }, { status: 201 });
}
