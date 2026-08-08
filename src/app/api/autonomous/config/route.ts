import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET/PATCH /api/autonomous/config - this org's autonomy toggles
// (org_autonomous_config, migration 080). organization_id is always derived
// server-side via requireRole, never from the request body (Contracts §2).
//
// GET   - returns the org's config row, or safe (all-off) defaults if none
//         exists yet (a row is seeded per-org by the migration, but new orgs
//         created afterward may not have one until first PATCH).
// PATCH - partial update. Only recognized org_autonomous_config columns are
//         applied; unknown keys are ignored rather than rejected so callers
//         can send a full settings object without pruning it first.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

const DEFAULT_CONFIG = {
  auto_research_enabled: false,
  auto_score_enabled: false,
  auto_draft_enabled: false,
  auto_draft_threshold: 70,
  auto_reputation_enabled: false,
  auto_relationship_enabled: false,
  auto_deadline_prediction_enabled: false,
  auto_followup_enabled: false,
  auto_autoapply_enabled: false,
  auto_deploy_disaster_response: false,
  max_nightly_autoapply_submissions: 50,
  notify_on_auto_draft: true,
  notify_on_high_score: true,
  notify_digest_time: "07:00",
  max_auto_drafts_per_night: 10,
};

const BOOLEAN_FIELDS = [
  "auto_research_enabled",
  "auto_score_enabled",
  "auto_draft_enabled",
  "auto_reputation_enabled",
  "auto_relationship_enabled",
  "auto_deadline_prediction_enabled",
  "auto_followup_enabled",
  "auto_autoapply_enabled",
  // Row #130 "Auto-Deploy Response" (AGENTS_v2.md AG-25). Default false —
  // deploying a live disaster-response outreach campaign unsupervised is a
  // meaningful behavior change with real money/outreach implications, so
  // this is an explicit per-org opt-in, never auto-enabled (migration 124).
  "auto_deploy_disaster_response",
  "notify_on_auto_draft",
  "notify_on_high_score",
] as const;

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("org_autonomous_config")
    .select(
      "auto_research_enabled, auto_score_enabled, auto_draft_enabled, " +
        "auto_draft_threshold, auto_reputation_enabled, auto_relationship_enabled, " +
        "auto_deadline_prediction_enabled, auto_followup_enabled, " +
        "auto_autoapply_enabled, auto_deploy_disaster_response, " +
        "max_nightly_autoapply_submissions, " +
        "notify_on_auto_draft, notify_on_high_score, notify_digest_time, " +
        "max_auto_drafts_per_night",
    )
    .eq("org_id", organizationId)
    .maybeSingle();

  if (error) {
    return jsonError("Could not load autonomy config.", "load_failed", 500);
  }

  return NextResponse.json({ config: data ?? DEFAULT_CONFIG });
}

export async function PATCH(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError("Request body must be an object.", "invalid_input", 400);
  }
  const input = body as Record<string, unknown>;

  const patch: Record<string, unknown> = {};

  for (const field of BOOLEAN_FIELDS) {
    if (field in input) {
      if (typeof input[field] !== "boolean") {
        return jsonError(`${field} must be a boolean.`, "invalid_input", 400);
      }
      patch[field] = input[field];
    }
  }

  if ("auto_draft_threshold" in input) {
    const threshold = input.auto_draft_threshold;
    if (
      typeof threshold !== "number" ||
      !Number.isFinite(threshold) ||
      threshold < 50 ||
      threshold > 95
    ) {
      return jsonError(
        "auto_draft_threshold must be a number between 50 and 95.",
        "invalid_input",
        400,
      );
    }
    patch.auto_draft_threshold = threshold;
  }

  if ("max_auto_drafts_per_night" in input) {
    const max = input.max_auto_drafts_per_night;
    if (typeof max !== "number" || !Number.isFinite(max) || max < 0) {
      return jsonError(
        "max_auto_drafts_per_night must be a non-negative number.",
        "invalid_input",
        400,
      );
    }
    patch.max_auto_drafts_per_night = max;
  }

  if ("max_nightly_autoapply_submissions" in input) {
    const max = input.max_nightly_autoapply_submissions;
    if (
      typeof max !== "number" ||
      !Number.isFinite(max) ||
      max < 10 ||
      max > 400
    ) {
      return jsonError(
        "max_nightly_autoapply_submissions must be a number between 10 and 400.",
        "invalid_input",
        400,
      );
    }
    patch.max_nightly_autoapply_submissions = max;
  }

  if ("notify_digest_time" in input) {
    if (typeof input.notify_digest_time !== "string") {
      return jsonError(
        "notify_digest_time must be a string.",
        "invalid_input",
        400,
      );
    }
    patch.notify_digest_time = input.notify_digest_time;
  }

  if (Object.keys(patch).length === 0) {
    return jsonError("No recognized fields to update.", "invalid_input", 400);
  }

  patch.org_id = organizationId;
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("org_autonomous_config")
    .upsert(patch, { onConflict: "org_id" })
    .select(
      "auto_research_enabled, auto_score_enabled, auto_draft_enabled, " +
        "auto_draft_threshold, auto_reputation_enabled, auto_relationship_enabled, " +
        "auto_deadline_prediction_enabled, auto_followup_enabled, " +
        "auto_autoapply_enabled, auto_deploy_disaster_response, " +
        "max_nightly_autoapply_submissions, " +
        "notify_on_auto_draft, notify_on_high_score, notify_digest_time, " +
        "max_auto_drafts_per_night",
    )
    .single();

  if (error || !data) {
    return jsonError("Could not save autonomy config.", "save_failed", 500);
  }

  return NextResponse.json({ config: data });
}
