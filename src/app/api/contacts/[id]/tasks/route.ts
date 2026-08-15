// GET /api/contacts/[id]/tasks — row #77 Multi-Channel Outreach.
// Lists the real outreach tasks (LinkedIn, call, mail) logged against a
// contact, RLS-scoped via the session client (no admin client needed - a
// plain read).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;
  const { id: contactId } = await params;

  const { data, error } = await supabase
    .from("contact_tasks")
    .select("*")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });

  if (error) return jsonError("Could not load tasks.", 500);

  return NextResponse.json({ tasks: data ?? [] });
}
