// GET   /api/drafts/queue/config — get draft automation config; creates default if none exists.
// PATCH /api/drafts/queue/config — update config with validation.
// Derives organization_id from the authenticated session (never the request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const DEFAULT_CONFIG = {
  is_enabled: false,
  min_eligibility_score: 70,
  auto_generate_on_discovery: false,
  auto_generate_on_deadline_days: 14,
  daily_draft_limit: 10,
  preferred_template_rules: null,
  excluded_categories: null,
  excluded_funder_ids: null,
  require_approval_before_submit: true,
  auto_submit_above_confidence: null,
  notification_on_generation: false,
  notification_on_deadline: false,
} as const;

export async function GET(_request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("draft_automation_config")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to load draft automation config." }, { status: 500 });
  }

  if (data) {
    return NextResponse.json({ config: data });
  }

  // Create default config if none exists.
  const { data: created, error: insertError } = await supabase
    .from("draft_automation_config")
    .insert({ organization_id: organizationId, ...DEFAULT_CONFIG })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to initialize draft automation config." },
      { status: 500 },
    );
  }

  return NextResponse.json({ config: created });
}

export async function PATCH(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;

  // Validate numeric range constraints.
  if (input.min_eligibility_score !== undefined) {
    const v = Number(input.min_eligibility_score);
    if (Number.isNaN(v) || v < 0 || v > 100) {
      return NextResponse.json(
        { error: "min_eligibility_score must be between 0 and 100." },
        { status: 422 },
      );
    }
  }
  if (input.daily_draft_limit !== undefined) {
    const v = Number(input.daily_draft_limit);
    if (Number.isNaN(v) || v < 1 || v > 50) {
      return NextResponse.json(
        { error: "daily_draft_limit must be between 1 and 50." },
        { status: 422 },
      );
    }
  }
  if (input.auto_submit_above_confidence !== undefined && input.auto_submit_above_confidence !== null) {
    const v = Number(input.auto_submit_above_confidence);
    if (Number.isNaN(v) || v < 0 || v > 100) {
      return NextResponse.json(
        { error: "auto_submit_above_confidence must be between 0 and 100." },
        { status: 422 },
      );
    }
  }
  if (input.auto_generate_on_deadline_days !== undefined) {
    const v = Number(input.auto_generate_on_deadline_days);
    if (Number.isNaN(v) || v < 1) {
      return NextResponse.json(
        { error: "auto_generate_on_deadline_days must be a positive number." },
        { status: 422 },
      );
    }
  }

  // Build the update payload from allowed fields only.
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof input.is_enabled === "boolean") update.is_enabled = input.is_enabled;
  if (typeof input.min_eligibility_score === "number") update.min_eligibility_score = input.min_eligibility_score;
  if (typeof input.auto_generate_on_discovery === "boolean") update.auto_generate_on_discovery = input.auto_generate_on_discovery;
  if (typeof input.auto_generate_on_deadline_days === "number") update.auto_generate_on_deadline_days = input.auto_generate_on_deadline_days;
  if (typeof input.daily_draft_limit === "number") update.daily_draft_limit = input.daily_draft_limit;
  if (input.preferred_template_rules !== undefined) update.preferred_template_rules = input.preferred_template_rules;
  if (Array.isArray(input.excluded_categories)) update.excluded_categories = input.excluded_categories as string[];
  if (Array.isArray(input.excluded_funder_ids)) update.excluded_funder_ids = input.excluded_funder_ids as string[];
  if (typeof input.require_approval_before_submit === "boolean") update.require_approval_before_submit = input.require_approval_before_submit;
  if (input.auto_submit_above_confidence !== undefined) {
    update.auto_submit_above_confidence =
      input.auto_submit_above_confidence === null
        ? null
        : Number(input.auto_submit_above_confidence);
  }
  if (typeof input.notification_on_generation === "boolean") update.notification_on_generation = input.notification_on_generation;
  if (typeof input.notification_on_deadline === "boolean") update.notification_on_deadline = input.notification_on_deadline;

  const { data, error } = await supabase
    .from("draft_automation_config")
    .upsert(
      { organization_id: organizationId, ...update },
      { onConflict: "organization_id" },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to update draft automation config." }, { status: 500 });
  }

  return NextResponse.json({ config: data });
}
