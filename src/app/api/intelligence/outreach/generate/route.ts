// POST /api/intelligence/outreach/generate — AI-personalizes a corporate
// outreach email for the Corporate Outreach composer
// (src/app/(dashboard)/donor-discovery/outreach/page.tsx).
//
// organization_id is always derived from the authenticated session
// (requireRole), never trusted from the request body, even though the body
// shape below still accepts an orgId field for the caller's convenience
// (Behavioral Contracts §2).
//
// The generated subject/body use literal {company_name} / {org_name}
// placeholder tokens rather than baked-in values — the same convention as
// src/app/api/donor-discovery/prospects/[id]/route-to-email/route.ts's
// DEFAULT_BODY — so a single generated email can be queued to multiple
// selected prospects and rendered per-recipient by
// EmailTemplateEngine.renderTemplate() at send time.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEMPLATE_LABELS: Record<string, string> = {
  community_investment_intro: "Community Investment Introduction — introduce our organization to their CSR team",
  matching_gift_program: "Matching Gift Program — encourage their employees to enroll our organization for gift matching",
  sponsorship_proposal: "Sponsorship Proposal — propose sponsorship of an event or program",
  grant_followup: "Grant Application Follow-up — a courteous follow-up after submitting through their giving portal",
  custom: "General corporate outreach introduction",
};

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const { prospectId, templateType } = (raw ?? {}) as {
    prospectId?: unknown;
    templateType?: unknown;
  };

  if (!isUuid(prospectId)) {
    return jsonError("prospectId is required.", 400);
  }
  const template = typeof templateType === "string" && templateType in TEMPLATE_LABELS ? templateType : "custom";

  const admin = createAdminClient();

  const [prospectRes, orgRes, kbRes] = await Promise.all([
    admin
      .from("corporate_prospects")
      .select("legal_name, dba_name, industry_category, naics_description, address_city, address_state")
      .eq("id", prospectId)
      .maybeSingle(),
    admin.from("organizations").select("name, mission_statement").eq("id", organizationId).single(),
    admin
      .from("knowledge_base")
      .select("category, content")
      .eq("organization_id", organizationId)
      .in("category", ["impact", "program_description"])
      .order("updated_at", { ascending: false })
      .limit(4),
  ]);

  if (prospectRes.error || !prospectRes.data) {
    return jsonError("Prospect not found.", 404);
  }
  if (orgRes.error || !orgRes.data) {
    return jsonError("Could not load your organization.", 500);
  }

  const prospect = prospectRes.data;
  const companyDisplayName = prospect.dba_name?.trim() || prospect.legal_name;
  const companyIndustry = prospect.industry_category || prospect.naics_description || "their industry";
  const companyLocation = [prospect.address_city, prospect.address_state].filter(Boolean).join(", ");

  const kbRows = (kbRes.data ?? []) as { category: string; content: string }[];
  const impact = kbRows.find((r) => r.category === "impact")?.content ?? "";
  const programDescription = kbRows.find((r) => r.category === "program_description")?.content ?? "";

  const system =
    "You are writing a professional nonprofit outreach email to a corporate CSR team. " +
    "Be specific, concise, and compelling. Reference their company's community presence. " +
    "Keep to 150-200 words. " +
    "Use the literal placeholder tokens {company_name} and {org_name} anywhere the company's name or our " +
    "organization's name would appear, instead of writing them out directly — do not use any other {token} " +
    "placeholders. Respond with ONLY a JSON object: {\"subject\": \"...\", \"body\": \"...\"}.";

  const lines = [
    `Email purpose: ${TEMPLATE_LABELS[template]}`,
    `Our organization's mission: ${orgRes.data.mission_statement || "(not on file)"}`,
    programDescription ? `Our program: ${programDescription}` : null,
    impact ? `Our impact: ${impact}` : null,
    `Target company industry: ${companyIndustry}`,
    companyLocation ? `Target company location: ${companyLocation}` : null,
  ].filter((l): l is string => l !== null);

  const prompt = `Draft the outreach email.\n\n${lines.join("\n")}`;

  let response;
  try {
    response = await callClaude({ prompt, system, maxTokens: 600 });
  } catch {
    return jsonError("AI generation failed.", 502);
  }

  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch?.[0]) {
    return jsonError("AI did not return a usable email.", 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return jsonError("AI response could not be parsed.", 502);
  }

  const { subject, body } = (parsed ?? {}) as { subject?: unknown; body?: unknown };
  if (typeof subject !== "string" || typeof body !== "string" || !subject.trim() || !body.trim()) {
    return jsonError("AI response was missing a subject or body.", 502);
  }

  return NextResponse.json({
    subject: subject.trim(),
    body: body.trim(),
    previewCompanyName: companyDisplayName,
  });
}
