import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

// The sales-outreach admin page's Suppression List tab previously called
// /api/admin/sales-outreach/suppression, which never existed. The
// suppression_list table itself is real (populated by ProspectManager and
// the bounce/complaint webhook), it just had no admin-facing CRUD route —
// only a read-only CSV export at /api/admin/sales-analytics/export?type=suppression.

export const runtime = "nodejs";

export async function GET(_request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("suppression_list")
    .select("id, email, reason, source, added_at")
    .order("added_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load suppression list.", code: "load_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  let body: { email?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "bad_request" },
      { status: 400 },
    );
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "email is required.", code: "missing_fields" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("suppression_list")
    .insert({ email, reason: body.reason?.trim() || "manual", source: "admin" })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "Email is already suppressed.", code: "duplicate" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Failed to add to suppression list.", code: "add_failed" },
      { status: 500 },
    );
  }

  // Reflect the suppression onto any matching prospect rows too.
  await supabase
    .from("prospects")
    .update({
      suppressed: true,
      suppressed_reason: body.reason?.trim() || "manual",
      suppressed_at: new Date().toISOString(),
    })
    .eq("email", email);

  return NextResponse.json({ entry: data }, { status: 201 });
}
