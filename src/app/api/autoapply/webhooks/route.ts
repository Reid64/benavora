// GET  /api/autoapply/webhooks — list webhook configs for the org.
// POST /api/autoapply/webhooks — create a new webhook config.
// DELETE /api/autoapply/webhooks?id=<uuid> — remove a webhook config.

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const VALID_TYPES = ["slack", "generic"] as const;

const VALID_EVENTS = [
  "submission_completed",
  "submission_failed",
  "queue_populated",
  "review_needed",
  "agreement_received",
] as const;

type WebhookType = (typeof VALID_TYPES)[number];

function isValidType(v: unknown): v is WebhookType {
  return typeof v === "string" && (VALID_TYPES as readonly string[]).includes(v);
}

function isValidEventsArray(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (e) =>
        typeof e === "string" &&
        (VALID_EVENTS as readonly string[]).includes(e),
    )
  );
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: configs, error } = await supabase
    .from("webhook_configs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load webhook configs." },
      { status: 500 },
    );
  }

  return NextResponse.json({ configs: configs ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const { type, webhook_url, events } = raw;

  if (!isValidType(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(", ")}.` },
      { status: 400 },
    );
  }

  if (typeof webhook_url !== "string" || webhook_url.trim().length === 0) {
    return NextResponse.json(
      { error: "webhook_url is required." },
      { status: 400 },
    );
  }

  try {
    new URL(webhook_url);
  } catch {
    return NextResponse.json(
      { error: "webhook_url must be a valid URL." },
      { status: 400 },
    );
  }

  if (!isValidEventsArray(events)) {
    return NextResponse.json(
      {
        error: `events must be a non-empty array containing values from: ${VALID_EVENTS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("webhook_configs")
    .insert({
      organization_id: organizationId,
      type,
      webhook_url: webhook_url.trim(),
      events,
      is_active: true,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create webhook config." },
      { status: 500 },
    );
  }

  return NextResponse.json({ config: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "id query parameter is required." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("webhook_configs")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete webhook config." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
