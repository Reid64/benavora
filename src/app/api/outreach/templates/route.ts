// GET  /api/outreach/templates — list the org's outreach templates, optionally filtered by channel.
// POST /api/outreach/templates — create a new outreach template.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const VALID_CHANNELS = ["email", "linkedin", "phone_script", "physical_mail"] as const;
type OutreachTemplateChannel = (typeof VALID_CHANNELS)[number];

function isValidChannel(value: unknown): value is OutreachTemplateChannel {
  return typeof value === "string" && (VALID_CHANNELS as readonly string[]).includes(value);
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel");

  const base = supabase
    .from("outreach_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  const { data, error } = await (channel ? base.eq("channel", channel) : base);
  if (error) {
    return jsonError("Failed to load outreach templates.", "db_error", 500);
  }

  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { name, channel, subject, body } = (raw ?? {}) as {
    name?: unknown;
    channel?: unknown;
    subject?: unknown;
    body?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return jsonError("name is required.", "invalid_input", 400);
  }
  if (!isValidChannel(channel)) {
    return jsonError(
      `channel must be one of: ${VALID_CHANNELS.join(", ")}.`,
      "invalid_input",
      400,
    );
  }
  if (typeof body !== "string" || body.trim() === "") {
    return jsonError("body is required.", "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("outreach_templates")
    .insert({
      organization_id: organizationId,
      name: name.trim(),
      channel,
      subject: typeof subject === "string" && subject.trim() !== "" ? subject.trim() : null,
      body: body.trim(),
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to create outreach template.", "db_error", 500);
  }

  return NextResponse.json({ template: data }, { status: 201 });
}
