// POST /api/contacts/[id]/outreach/call — row #77 Multi-Channel Outreach.
//
// Generates real call talking points via Claude, referencing the contact and
// funder's actual known context, and logs a real "call task" with a due date
// on the contact's record for a human to place manually. NEVER dials - no
// automated telephony of any kind.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadContactOutreachContext, daysFromNow } from "@/lib/outreach/contact-context";

export const runtime = "nodejs";
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
    "You are preparing call talking points for a nonprofit development professional about to call a funder " +
    "contact by phone. Write 4-6 short bullet points: an opening line referencing something specific and real " +
    "about the recipient or their organization, 2-3 substantive points to raise, and a clear ask or next step " +
    "to close on. Be concrete, not generic - use the real details given, not placeholder language. Respond " +
    'with ONLY a JSON object: {"talkingPoints": "..."} where the value is the bullet points as a single ' +
    "string separated by newlines (each line starting with \"- \").";

  const lastContacted = contact.last_contacted_at
    ? `Last contacted: ${new Date(contact.last_contacted_at).toLocaleDateString()}`
    : "Never contacted before";

  const lines = [
    `Recipient: ${contact.name}${contact.title ? `, ${contact.title}` : ""}`,
    contact.phone ? `Recipient phone: ${contact.phone}` : null,
    funder ? `Recipient's organization: ${funder.name}${funder.category ? ` (${funder.category})` : ""}` : null,
    funder?.description ? `About their organization: ${funder.description}` : null,
    funder?.notes ? `Our notes on this funder: ${funder.notes}` : null,
    `Relationship stage: ${contact.relationship ?? "cold"}`,
    lastContacted,
    `Our organization: ${organization.name}`,
    organization.mission_statement ? `Our mission: ${organization.mission_statement}` : null,
    programDescription ? `Our program: ${programDescription}` : null,
    impact ? `Our impact: ${impact}` : null,
  ].filter((l): l is string => l !== null);

  const prompt = `Draft the call talking points.\n\n${lines.join("\n")}`;

  let response;
  try {
    response = await callClaude({ prompt, system, maxTokens: 500 });
  } catch {
    return jsonError("AI generation failed.", 502);
  }

  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch?.[0]) return jsonError("AI did not return usable talking points.", 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return jsonError("AI response could not be parsed.", 502);
  }

  const { talkingPoints } = (parsed ?? {}) as { talkingPoints?: unknown };
  if (typeof talkingPoints !== "string" || !talkingPoints.trim()) {
    return jsonError("AI response was missing talking points.", 502);
  }

  const { data: task, error: insertError } = await admin
    .from("contact_tasks")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      task_type: "call",
      subject: `Call ${contact.name}`,
      content: talkingPoints.trim(),
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
