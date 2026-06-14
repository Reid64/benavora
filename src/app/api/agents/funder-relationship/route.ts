import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { AgentError } from "@/lib/agents/base-agent";
import {
  FunderRelationshipAgent,
  type FunderRelationshipEvent,
} from "@/lib/agents/funder-relationship";

// POST /api/agents/funder-relationship
// Body: { funderId: string; event: FunderRelationshipEvent }
// Runs the deterministic relationship scoring model for a funder interaction.

export const runtime = "nodejs";

const VALID_EVENTS = new Set<FunderRelationshipEvent>([
  "cold_outreach_sent",
  "response_received",
  "application_submitted",
  "awarded",
  "denied_with_feedback",
  "denied_no_feedback",
  "three_plus_consecutive_denials",
  "renewal_submitted",
  "note_added",
]);

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

const RATE_LIMIT = 200;
const RATE_WINDOW_MS = 60_000 * 60;
const hits = new Map<string, number[]>();

function isRateLimited(orgId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(orgId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(orgId, recent);
    return true;
  }
  recent.push(now);
  hits.set(orgId, recent);
  return false;
}

export async function POST(request: Request) {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { funderId, event } = (body ?? {}) as {
    funderId?: unknown;
    event?: unknown;
  };

  if (typeof funderId !== "string" || funderId.trim() === "") {
    return jsonError("funderId is required.", "invalid_input", 400);
  }
  if (typeof event !== "string" || !VALID_EVENTS.has(event as FunderRelationshipEvent)) {
    return jsonError(
      `event must be one of: ${[...VALID_EVENTS].join(", ")}.`,
      "invalid_input",
      400,
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profile.organization_id as string;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many relationship updates. Please wait and try again.",
      "rate_limited",
      429,
    );
  }

  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  const agent = new FunderRelationshipAgent({
    client: supabase,
    organizationId,
    triggeredBy: profile.id as string,
  });

  try {
    const outcome = await agent.run({
      funderId: funderId.trim(),
      event: event as FunderRelationshipEvent,
    });
    return NextResponse.json({ data: outcome.data });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    return jsonError(
      "Relationship score update failed. Please try again.",
      "agent_failed",
      500,
    );
  }
}
