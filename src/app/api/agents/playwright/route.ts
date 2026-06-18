// POST /api/agents/playwright
//
// URL-based browser automation endpoint for corporate giving portals.
// Accepts a portal URL and runs the PlaywrightAgent in one of two modes:
//
//   discover - navigate the URL and extract opportunity details only; no form
//              filling and no automation session created for submission.
//   apply    - detect form fields via Claude, map the org profile to those
//              fields, pause for human approval. NEVER submits without an
//              approved automation_sessions row.
//
// The org's profile data (templateData) is always loaded server-side from the
// database - it is never trusted from the request body (BEHAVIORAL_CONTRACTS §2).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { AgentError } from "@/lib/agents/base-agent";
import { PlaywrightAgent } from "@/lib/agents/playwright-agent";
import type { TemplateData } from "@/lib/agents/playwright-agent";
import { withUsageCheck } from "@/lib/billing/usage-middleware";

export const runtime = "nodejs";
// Browser automation may take up to ~5 minutes (BEHAVIORAL_CONTRACTS §18).
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

const RATE_LIMIT = 10;
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

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const parsed = (body ?? {}) as {
    url?: unknown;
    keywords?: unknown;
    mode?: unknown;
  };

  if (typeof parsed.url !== "string" || parsed.url.trim() === "") {
    return jsonError("url is required.", "invalid_input", 400);
  }
  const url = parsed.url.trim();

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return jsonError(
      "url must start with http:// or https://",
      "invalid_input",
      400,
    );
  }

  const mode = parsed.mode;
  if (mode !== "discover" && mode !== "apply") {
    return jsonError(
      "mode must be 'discover' or 'apply'.",
      "invalid_input",
      400,
    );
  }

  const keywords: string[] = Array.isArray(parsed.keywords)
    ? parsed.keywords.filter((k): k is string => typeof k === "string")
    : [];

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many playwright agent runs. Please wait a moment.",
      "rate_limited",
      429,
    );
  }

  const runLimitBlocked = await withUsageCheck(
    supabase,
    organizationId,
    "agent_runs",
  );
  if (runLimitBlocked) return runLimitBlocked;

  // Load org profile data server-side to build templateData.
  const { data: org } = await supabase
    .from("organizations")
    .select(
      "name, ein, mission_statement, address_line1, city, state, zip, phone, email, website, tax_status, service_area, target_population",
    )
    .eq("id", organizationId)
    .maybeSingle();

  let contactName: string | undefined;
  let contactEmail: string | undefined;
  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    contactName = (profile?.full_name as string | null) ?? undefined;
    contactEmail = (profile?.email as string | null) ?? undefined;
  }

  const templateData: TemplateData = {
    orgName: (org?.name as string | null) ?? undefined,
    ein: (org?.ein as string | null) ?? undefined,
    mission: (org?.mission_statement as string | null) ?? undefined,
    address: (org?.address_line1 as string | null) ?? undefined,
    city: (org?.city as string | null) ?? undefined,
    state: (org?.state as string | null) ?? undefined,
    zip: (org?.zip as string | null) ?? undefined,
    phone: (org?.phone as string | null) ?? undefined,
    email: (org?.email as string | null) ?? undefined,
    website: (org?.website as string | null) ?? undefined,
    taxStatus: (org?.tax_status as string | null) ?? undefined,
    serviceArea: (org?.service_area as string | null) ?? undefined,
    targetPopulation: (org?.target_population as string | null) ?? undefined,
    contactName,
    contactEmail,
  };

  const agent = new PlaywrightAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ url, keywords, mode, templateData });
    return NextResponse.json({
      status: outcome.data.status,
      screenshots: outcome.data.screenshots,
      formData: outcome.data.formData,
      approvalId: outcome.data.approvalId,
      skipReason: outcome.data.skipReason ?? null,
      discovered: outcome.data.discovered ?? null,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    return jsonError(
      "Playwright agent failed. Please try again.",
      "agent_failed",
      500,
    );
  }
}
