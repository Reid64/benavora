import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AgentError } from "@/lib/agents/base-agent";
import {
  approveAndSubmit,
  parseStoredMappings,
} from "@/lib/agents/browser-automation";
import {
  AutomationSessionManager,
  AutomationSessionError,
} from "@/lib/automation/session-manager";
import type { FormField } from "@/types/automation";

// Automation session detail + control endpoint (AGENTS.md Agent 16,
// BEHAVIORAL_CONTRACTS §18).
//
//   GET  — full session with its steps and screenshots (org-scoped).
//   PUT  — control the session: "reject" cancels it, "update_fields" records
//          human-entered values for unmapped fields, and "approve" runs the
//          human-approved submission (owner/admin only — Contracts §6).
//
// Both verbs authenticate via the session and derive organization_id from the
// caller's profile; every read/write is re-scoped by organization_id.

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

interface Caller {
  organizationId: string;
  profileId: string;
  role: string;
}

/** Authenticate and resolve the caller's org, profile id, and role. */
async function resolveCaller(
  supabase: ReturnType<typeof createClient>,
): Promise<Caller | { error: ReturnType<typeof jsonError> }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: jsonError("Authentication required.", "unauthenticated", 401) };
  }
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", user.id)
    .single();
  if (error || !profile) {
    return { error: jsonError("Could not resolve your profile.", "no_profile", 403) };
  }
  return {
    organizationId: profile.organization_id as string,
    profileId: profile.id as string,
    role: (profile.role as string | null) ?? "viewer",
  };
}

export async function GET(
  _request: Request,
  { params }: { params: { sessionId: string } },
) {
  const supabase = createClient();
  const caller = await resolveCaller(supabase);
  if ("error" in caller) return caller.error;

  const manager = new AutomationSessionManager({
    client: supabase,
    organizationId: caller.organizationId,
  });

  const session = await manager
    .getSession(params.sessionId)
    .catch(() => null);
  if (!session) {
    return jsonError("Automation session not found.", "not_found", 404);
  }

  // Steps and screenshots key off session_id; the session has already been
  // confirmed to belong to this organization above (manager.getSession is
  // org-scoped under RLS). automation_steps / automation_screenshots have no
  // organization_id of their own and — unlike every sibling child table — carry
  // no org-isolation RLS policy, so a session-bound (RLS) read returns zero rows
  // and the detail page renders empty "No steps / No screenshots" states. Read
  // them with the service-role client, still strictly scoped to the already
  // verified session_id, so the caller sees their own session's children. The
  // accompanying migration adds the missing policies for fresh deploys.
  const admin = createAdminClient();
  const [{ data: steps }, { data: screenshots }] = await Promise.all([
    admin
      .from("automation_steps")
      .select("*")
      .eq("session_id", params.sessionId)
      .order("step_number", { ascending: true }),
    admin
      .from("automation_screenshots")
      .select("*")
      .eq("session_id", params.sessionId)
      .order("captured_at", { ascending: true }),
  ]);

  return NextResponse.json({
    session,
    steps: steps ?? [],
    screenshots: screenshots ?? [],
  });
}

export async function PUT(
  request: Request,
  { params }: { params: { sessionId: string } },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { action, fieldValues, notes } = (body ?? {}) as {
    action?: unknown;
    fieldValues?: unknown;
    notes?: unknown;
  };
  if (action !== "approve" && action !== "reject" && action !== "update_fields") {
    return jsonError(
      'action must be one of: "approve", "reject", "update_fields".',
      "invalid_input",
      400,
    );
  }

  const supabase = createClient();
  const caller = await resolveCaller(supabase);
  if ("error" in caller) return caller.error;

  const manager = new AutomationSessionManager({
    client: supabase,
    organizationId: caller.organizationId,
  });

  // Confirm the session belongs to the caller's org before any mutation.
  const existing = await manager
    .getSession(params.sessionId)
    .catch(() => null);
  if (!existing) {
    return jsonError("Automation session not found.", "not_found", 404);
  }

  try {
    if (action === "reject") {
      await manager.markCancelled(
        params.sessionId,
        typeof notes === "string" ? notes : "Rejected by reviewer.",
      );
      const session = await manager.getSession(params.sessionId);
      return NextResponse.json({ session });
    }

    if (action === "update_fields") {
      const session = await mergeManualFields(
        manager,
        params.sessionId,
        fieldValues,
      );
      return NextResponse.json({ session });
    }

    // action === "approve": submitting requires owner/admin (Contracts §6).
    if (caller.role !== "owner" && caller.role !== "admin") {
      return jsonError(
        "Only an owner or admin can approve a submission.",
        "forbidden",
        403,
      );
    }
    const result = await approveAndSubmit({
      client: supabase,
      organizationId: caller.organizationId,
      sessionId: params.sessionId,
      approvedBy: caller.profileId,
    });
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    if (err instanceof AutomationSessionError) {
      return jsonError(err.message, err.code, 409);
    }
    return jsonError("Failed to update session.", "update_failed", 500);
  }
}

/**
 * Fold human-entered values into the session's field split: each value is
 * matched to a still-unmapped field (by selector, then field name), promoted to
 * a mapped FormMapping (source "manual"), and removed from the unmapped list so
 * the approval replay will type it in.
 */
async function mergeManualFields(
  manager: AutomationSessionManager,
  sessionId: string,
  fieldValues: unknown,
) {
  if (!Array.isArray(fieldValues) || fieldValues.length === 0) {
    throw new AgentError(
      "fieldValues must be a non-empty array of { selector | fieldName, value }.",
      "invalid_input",
      400,
    );
  }

  const session = await manager.getSession(sessionId);
  const mapped = parseStoredMappings(session.mapped_fields);
  const unmapped = parseStoredFields(session.unmapped_fields);

  for (const entry of fieldValues) {
    if (!entry || typeof entry !== "object") continue;
    const { selector, fieldName, value } = entry as {
      selector?: unknown;
      fieldName?: unknown;
      value?: unknown;
    };
    if (typeof value !== "string" || value.trim() === "") continue;

    const idx = unmapped.findIndex(
      (f) =>
        (typeof selector === "string" && f.selector === selector) ||
        (typeof fieldName === "string" && f.fieldName === fieldName),
    );
    if (idx === -1) continue;

    const [field] = unmapped.splice(idx, 1);
    if (!field) continue;
    mapped.push({ field, value: value.trim(), source: "manual" });
  }

  await manager.saveFieldMapping(sessionId, mapped, unmapped);
  return manager.getSession(sessionId);
}

/** Re-hydrate FormField[] stored in automation_sessions.unmapped_fields. */
function parseStoredFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  const fields: FormField[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.selector === "string" && typeof obj.fieldType === "string") {
      fields.push(obj as unknown as FormField);
    }
  }
  return fields;
}
