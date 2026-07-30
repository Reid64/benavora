import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { DomainManager } from "@/lib/admin/domain-manager";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(_request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sending_domains")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load domains.", code: "load_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ domains: data });
}

export async function POST(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  let body: { domain?: string; api_key?: string; provider?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "bad_request" },
      { status: 400 },
    );
  }

  const { domain, api_key, provider } = body;
  if (!domain || !api_key) {
    return NextResponse.json(
      { error: "domain and api_key are required.", code: "missing_fields" },
      { status: 400 },
    );
  }

  try {
    const manager = new DomainManager();
    const record = await manager.addDomain(domain, api_key, provider);
    return NextResponse.json({ domain: record }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add domain.";
    return NextResponse.json(
      { error: message, code: "add_failed" },
      { status: 500 },
    );
  }
}
