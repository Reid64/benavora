import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { templateEngine } from "@/lib/email/template-engine";
import type { TablesUpdate } from "@/types/database";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// GET /api/email/templates — list all active templates for the org.
// Optional query param: template_type filters by type.
export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const templateType = searchParams.get("template_type");

  const base = supabase
    .from("email_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const { data, error } = await (templateType ? base.eq("template_type", templateType) : base);
  if (error) {
    return jsonError("Failed to load templates.", "db_error", 500);
  }

  return NextResponse.json({ templates: data ?? [] });
}

// POST /api/email/templates — create a new template; validates variable placeholders.
export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, userId, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { name, template_type, subject, body: emailBody } = (raw ?? {}) as {
    name?: unknown;
    template_type?: unknown;
    subject?: unknown;
    body?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return jsonError("name is required.", "invalid_input", 400);
  }
  if (typeof subject !== "string" || subject.trim() === "") {
    return jsonError("subject is required.", "invalid_input", 400);
  }
  if (typeof emailBody !== "string" || emailBody.trim() === "") {
    return jsonError("body is required.", "invalid_input", 400);
  }

  const sv = templateEngine.validateTemplate(subject);
  const bv = templateEngine.validateTemplate(emailBody);
  const allVariables = [...new Set([...sv.variables, ...bv.variables])];
  const warnings = [...sv.errors, ...bv.errors];

  const { data, error } = await supabase
    .from("email_templates")
    .insert({
      organization_id: organizationId,
      name: name.trim(),
      template_type: typeof template_type === "string" ? template_type.trim() : null,
      subject: subject.trim(),
      body: emailBody.trim(),
      variables: allVariables,
      is_active: true,
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to create template.", "db_error", 500);
  }

  return NextResponse.json({ template: data, warnings }, { status: 201 });
}

// PATCH /api/email/templates — update an existing template by id.
export async function PATCH(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { id, name, template_type, subject, body: emailBody } = (raw ?? {}) as {
    id?: unknown;
    name?: unknown;
    template_type?: unknown;
    subject?: unknown;
    body?: unknown;
  };

  if (typeof id !== "string" || id.trim() === "") {
    return jsonError("id is required.", "invalid_input", 400);
  }

  const { data: existing, error: fetchError } = await supabase
    .from("email_templates")
    .select("id, subject, body")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (fetchError) {
    return jsonError("Failed to load template.", "db_error", 500);
  }
  if (!existing) {
    return jsonError("Template not found.", "not_found", 404);
  }

  const updates: TablesUpdate<"email_templates"> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof name === "string") updates.name = name.trim();
  if (typeof template_type === "string") updates.template_type = template_type.trim();

  const newSubject = typeof subject === "string" ? subject.trim() : null;
  const newBody = typeof emailBody === "string" ? emailBody.trim() : null;

  if (newSubject !== null) updates.subject = newSubject;
  if (newBody !== null) updates.body = newBody;

  const warnings: string[] = [];
  if (newSubject !== null || newBody !== null) {
    const resolvedSubject = newSubject ?? (existing.subject as string);
    const resolvedBody = newBody ?? (existing.body as string);
    const sv = templateEngine.validateTemplate(resolvedSubject);
    const bv = templateEngine.validateTemplate(resolvedBody);
    updates.variables = [...new Set([...sv.variables, ...bv.variables])];
    warnings.push(...sv.errors, ...bv.errors);
  }

  const { data, error } = await supabase
    .from("email_templates")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return jsonError("Failed to update template.", "db_error", 500);
  }

  return NextResponse.json({ template: data, warnings });
}

// DELETE /api/email/templates — soft delete by setting is_active = false.
export async function DELETE(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { id } = (raw ?? {}) as { id?: unknown };
  if (typeof id !== "string" || id.trim() === "") {
    return jsonError("id is required.", "invalid_input", 400);
  }

  const { data: existing, error: fetchError } = await supabase
    .from("email_templates")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchError) {
    return jsonError("Failed to load template.", "db_error", 500);
  }
  if (!existing) {
    return jsonError("Template not found.", "not_found", 404);
  }

  const { error } = await supabase
    .from("email_templates")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return jsonError("Failed to delete template.", "db_error", 500);
  }

  return NextResponse.json({ deleted: id });
}
