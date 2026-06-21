import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { sequenceEngine } from "@/lib/email/sequence-engine";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// POST /api/email/sequences/[id]/enroll
// Body: { contacts: Array<{ email, contact_id?, funder_id?, variables }> }
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { contacts } = (raw ?? {}) as { contacts?: unknown };
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return jsonError("contacts must be a non-empty array.", "invalid_input", 400);
  }

  // Verify sequence belongs to this org
  const { data: seq, error: seqErr } = await supabase
    .from("email_campaign_sequences")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (seqErr) return jsonError("Failed to verify sequence.", "db_error", 500);
  if (!seq) return jsonError("Sequence not found.", "not_found", 404);

  const results: Array<{ email: string; status: "enrolled" | "duplicate" | "error"; error?: string }> = [];

  for (const contact of contacts) {
    const c = contact as Record<string, unknown>;
    const email = typeof c.email === "string" ? c.email.trim() : "";

    if (!email) {
      results.push({ email: "", status: "error", error: "email is required" });
      continue;
    }

    const variables =
      c.variables != null && typeof c.variables === "object" && !Array.isArray(c.variables)
        ? (c.variables as Record<string, string>)
        : {};

    try {
      await sequenceEngine.enrollContact(params.id, {
        email,
        contact_id: typeof c.contact_id === "string" ? c.contact_id : undefined,
        funder_id: typeof c.funder_id === "string" ? c.funder_id : undefined,
        variables,
      });
      results.push({ email, status: "enrolled" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Enrollment failed";
      // Surface duplicate-enrollment as a non-error status
      if (msg.toLowerCase().includes("duplicate") || msg.includes("23505")) {
        results.push({ email, status: "duplicate" });
      } else {
        results.push({ email, status: "error", error: msg });
      }
    }
  }

  const enrolled = results.filter((r) => r.status === "enrolled").length;
  const duplicates = results.filter((r) => r.status === "duplicate").length;
  const errors = results.filter((r) => r.status === "error").length;

  return NextResponse.json({ results, summary: { enrolled, duplicates, errors } }, { status: 201 });
}
