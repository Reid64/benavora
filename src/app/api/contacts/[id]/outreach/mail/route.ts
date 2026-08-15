// POST /api/contacts/[id]/outreach/mail — row #77 Multi-Channel Outreach.
//
// Generates a real, personalized mail-merge letter via Claude, renders it to
// a PDF using the contact's real address context and the org's real
// letterhead/KB content (src/lib/reports/letter-pdf.ts, the same
// @react-pdf/renderer dependency as the Board Report / row #115 document
// engine), uploads it to Storage, and logs a real "mail task" with a due
// date on the contact's record for a human to print and mail manually.
// NEVER submits to any mail-sending API - no automated physical mail.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadContactOutreachContext, daysFromNow } from "@/lib/outreach/contact-context";
import { generateOutreachLetterPDF } from "@/lib/reports/letter-pdf";

export const runtime = "nodejs";
export const maxDuration = 300;

const STORAGE_BUCKET = process.env.STORAGE_DOCUMENTS_BUCKET ?? "documents";

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
    "You are drafting the body of a formal fundraising outreach letter from a nonprofit to a funder contact, " +
    "to be printed and mailed on letterhead. Write 3-4 short paragraphs: an opening referencing something " +
    "specific and real about the recipient or their organization, our mission and program in context, a " +
    "concrete impact point, and a clear closing ask or next step. Do not include a salutation (\"Dear...\") or " +
    "sign-off (\"Sincerely...\") - those are added separately. Write real names directly, not placeholder " +
    'tokens. Respond with ONLY a JSON object: {"paragraphs": ["...", "...", "..."]}.';

  const lines = [
    `Recipient: ${contact.name}${contact.title ? `, ${contact.title}` : ""}`,
    funder ? `Recipient's organization: ${funder.name}${funder.category ? ` (${funder.category})` : ""}` : null,
    funder?.description ? `About their organization: ${funder.description}` : null,
    funder?.notes ? `Our notes on this funder: ${funder.notes}` : null,
    `Our organization: ${organization.name}`,
    organization.mission_statement ? `Our mission: ${organization.mission_statement}` : null,
    programDescription ? `Our program: ${programDescription}` : null,
    impact ? `Our impact: ${impact}` : null,
  ].filter((l): l is string => l !== null);

  const prompt = `Draft the letter body.\n\n${lines.join("\n")}`;

  let response;
  try {
    response = await callClaude({ prompt, system, maxTokens: 700 });
  } catch {
    return jsonError("AI generation failed.", 502);
  }

  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch?.[0]) return jsonError("AI did not return a usable letter.", 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return jsonError("AI response could not be parsed.", 502);
  }

  const { paragraphs } = (parsed ?? {}) as { paragraphs?: unknown };
  if (
    !Array.isArray(paragraphs) ||
    paragraphs.length === 0 ||
    !paragraphs.every((p) => typeof p === "string" && p.trim())
  ) {
    return jsonError("AI response was missing letter paragraphs.", 502);
  }
  const bodyParagraphs = (paragraphs as string[]).map((p) => p.trim());

  const dateLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const cityStateZip = [organization.city, organization.state, organization.zip]
    .filter(Boolean)
    .join(", ")
    .replace(", ", ", ")
    .replace(/,\s*$/, "");

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateOutreachLetterPDF({
      org: {
        name: organization.name,
        addressLine1: organization.address_line1,
        addressLine2: organization.address_line2,
        cityStateZip: cityStateZip || null,
        phone: organization.phone,
        email: organization.email,
      },
      recipientName: contact.name,
      recipientTitle: contact.title,
      recipientOrgName: funder?.name ?? null,
      dateLabel,
      bodyParagraphs,
      signerName: organization.name,
    });
  } catch {
    return jsonError("Letter drafted, but the PDF could not be generated.", 500);
  }

  const storagePath = `${organizationId}/outreach-letters/${contactId}_${Date.now()}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    return jsonError("Letter drafted, but the PDF could not be stored.", 500);
  }

  const { data: task, error: insertError } = await admin
    .from("contact_tasks")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      task_type: "mail_letter",
      subject: `Mail letter to ${contact.name}`,
      content: bodyParagraphs.join("\n\n"),
      asset_path: storagePath,
      due_at: daysFromNow(5),
      created_by: userId,
    })
    .select("*")
    .single();

  if (insertError || !task) {
    return jsonError("Letter generated, but the task could not be saved.", 500);
  }

  return NextResponse.json({ task });
}
