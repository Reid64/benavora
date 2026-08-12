import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { AgentError } from "@/lib/agents/base-agent";
import { EmailParserAgent, type EmailInput } from "@/lib/agents/email-parser";

// Email Parser Agent trigger endpoint.
//
// POST { emails: EmailInput[] } authenticates the user, derives organization_id
// from the session profile (never the body), classifies each email via Claude,
// attempts funder matching, and inserts email_activity rows. Returns the full
// per-email classification result.
//
// Phase 4 will call this from the Gmail webhook; for now the manual
// EmailParserWidget on the dashboard is the entry point.

export const runtime = "nodejs";
export const maxDuration = 300;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
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

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  // Parsing emails is a write action - viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { emails } = (body ?? {}) as { emails?: unknown };

  if (!Array.isArray(emails) || emails.length === 0) {
    return jsonError(
      "emails must be a non-empty array.",
      "invalid_input",
      400,
    );
  }

  const MAX_EMAILS = 50;
  if (emails.length > MAX_EMAILS) {
    return jsonError(
      `Maximum ${MAX_EMAILS} emails per request.`,
      "too_many_emails",
      400,
    );
  }

  // Validate each email object has the required fields.
  for (let i = 0; i < emails.length; i++) {
    const e = emails[i] as Record<string, unknown>;
    if (
      !e ||
      typeof e.from !== "string" ||
      typeof e.subject !== "string" ||
      typeof e.body !== "string"
    ) {
      return jsonError(
        `emails[${i}] must have string fields: from, subject, body.`,
        "invalid_input",
        400,
      );
    }
  }

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profileRow) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profileRow.organization_id as string;
  const triggeredBy = profileRow.id as string;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  // Resolve AI config from platform_config, falling back to defaults.
  const { data: configRows } = await supabase
    .from("platform_config")
    .select("key, value")
    .eq("organization_id", organizationId)
    .in("key", ["ai.model", "ai.max_tokens"]);
  const config = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const model = config.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

  const agent = new EmailParserAgent({
    client: supabase,
    organizationId,
    triggeredBy,
    model,
    maxTokens,
  });

  try {
    const outcome = await agent.run({ emails: emails as EmailInput[] });
    return NextResponse.json({
      runId: outcome.runId,
      status: "completed",
      processed: outcome.data.processed,
      results: outcome.data.results,
      tokensUsed: outcome.tokensUsed,
      durationMs: outcome.durationMs,
    });
  } catch (err) {
    const status = err instanceof AgentError ? err.status : 500;
    return jsonError(
      "Email parsing failed. Please try again.",
      err instanceof AgentError ? err.code : "parse_failed",
      status,
    );
  }
}
