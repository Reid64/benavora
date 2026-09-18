// POST /api/contacts/[id]/outreach/linkedin — row #77 Multi-Channel Outreach.
//
// Generates a real, personalized LinkedIn connection-request note via Claude
// (same personalization pattern as row #118's
// src/app/api/intelligence/outreach/generate/route.ts, adapted to a CRM
// contact/funder instead of a corporate_prospects row) and logs a real
// contact_tasks row for a human to copy and send manually inside LinkedIn.
// NEVER calls the LinkedIn API - no automated connection requests are sent.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadContactOutreachContext, daysFromNow } from "@/lib/outreach/contact-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId, userId } = gate;
  const { id: contactId } = await params;

  const admin = createAdminClient();
  const context = await loadContactOutreachContext(admin, contactId, organizationId);
  if (!context) return jsonError("Contact not found.", 404);

  const { contact, funder, organization, impact, programDescription } = context;

  const system =
    "You are writing a LinkedIn connection-request note from a nonprofit development professional to a " +
    "funder contact. LinkedIn connection notes have a hard 300-character limit - stay under it. Be warm, " +
    "specific, and reference something real and relevant about the recipient or their organization, not a " +
    "generic template. Never use placeholder tokens like {name} - write the actual names directly, since this " +
    "is a one-off draft for a single named recipient, not a reusable template. Respond with ONLY a JSON " +
    'object: {"message": "..."}.';

  const lines = [
    `Recipient: ${contact.name}${contact.title ? `, ${contact.title}` : ""}`,
    funder ? `Recipient's organization: ${funder.name}${funder.category ? ` (${funder.category})` : ""}` : null,
    funder?.description ? `About their organization: ${funder.description}` : null,
    funder?.notes ? `Our notes on this funder: ${funder.notes}` : null,
    contact.relationship ? `Current relationship stage: ${contact.relationship}` : null,
    `Our organization: ${organization.name}`,
    organization.mission_statement ? `Our mission: ${organization.mission_statement}` : null,
    programDescription ? `Our program: ${programDescription}` : null,
    impact ? `Our impact: ${impact}` : null,
  ].filter((l): l is string => l !== null);

  const prompt = `Draft the LinkedIn connection request note.\n\n${lines.join("\n")}`;

  let response;
  try {
    response = await callClaude({ prompt, system, maxTokens: 300 });
  } catch {
    return jsonError("AI generation failed.", 502);
  }

  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch?.[0]) return jsonError("AI did not return a usable message.", 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return jsonError("AI response could not be parsed.", 502);
  }

  const { message } = (parsed ?? {}) as { message?: unknown };
  if (typeof message !== "string" || !message.trim()) {
    return jsonError("AI response was missing a message.", 502);
  }

  const { data: task, error: insertError } = await admin
    .from("contact_tasks")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      task_type: "linkedin_message",
      content: message.trim(),
      due_at: daysFromNow(2),
      created_by: userId,
    })
    .select("*")
    .single();

  if (insertError || !task) {
    return jsonError("Draft generated, but the task could not be saved.", 500);
  }

  return NextResponse.json({ task });
}
