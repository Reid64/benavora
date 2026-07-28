// SAM.gov Research Agent trigger — AGENTS.md Agent 16.
//
// POST — authenticates the caller, resolves an API key (org's own
// integration_keys row first, then SAM_GOV_API_KEY as a platform fallback),
// instantiates SamGovResearchAgent, and runs a live search.
// Returns the full list of discovered opportunities plus the agent run ID.
//
// Body: { keywords?: string[], postedFrom?: string, postedTo?: string }
//   - keywords defaults to the org's active search_profiles when omitted
//     (the settings-page "Run Now" trigger sends an empty body).
// Response: { opportunities: [...], count: number, opportunitiesCreated: number, agent_run_id: string | null }

import { NextRequest, NextResponse } from "next/server";

import { SamGovResearchAgent } from "@/lib/agents/sam-gov";
import { getDefaultResearchKeywords } from "@/lib/agents/org-defaults";
import { requireRole } from "@/lib/auth/role-gate";
import { AgentError } from "@/lib/agents/base-agent";
import { decryptKey } from "@/lib/crypto/key-encrypt";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// Behavioral Contracts §18: "SAM.gov API key stored encrypted in
// integration_keys table" — the org's own self-connected key (entered on
// Settings → Integrations) takes precedence. Falls back to the
// platform-level SAM_GOV_API_KEY env var for orgs that haven't self-connected
// one, so existing platform-managed usage keeps working.
async function resolveSamGovApiKey(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("integration_keys")
    .select("encrypted_key")
    .eq("organization_id", organizationId)
    .eq("service_name", "sam_gov")
    .eq("is_active", true)
    .maybeSingle();

  if (data?.encrypted_key) {
    try {
      return decryptKey(data.encrypted_key as string);
    } catch {
      // Auth-tag failure (different INTEGRATION_KEY_SECRET) — fall through
      // to the env var rather than failing the whole request.
    }
  }

  return process.env.SAM_GOV_API_KEY ?? null;
}

export async function POST(req: NextRequest) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const apiKey = await resolveSamGovApiKey(supabase, organizationId);
  if (!apiKey) {
    return jsonError(
      "No SAM.gov API key configured. Add one under Settings → Integrations, " +
        "or set SAM_GOV_API_KEY.",
      "key_missing",
      500,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", "bad_request", 400);
  }

  const parsed = body as {
    keywords?: unknown;
    postedFrom?: unknown;
    postedTo?: unknown;
  };

  const bodyKeywords = Array.isArray(parsed.keywords)
    ? (parsed.keywords as unknown[]).map(String).filter(Boolean)
    : typeof parsed.keywords === "string" && parsed.keywords.trim()
      ? [parsed.keywords.trim()]
      : [];

  const keywords =
    bodyKeywords.length > 0
      ? bodyKeywords
      : await getDefaultResearchKeywords(supabase, organizationId);

  const postedFrom =
    typeof parsed.postedFrom === "string" ? parsed.postedFrom : undefined;
  const postedTo =
    typeof parsed.postedTo === "string" ? parsed.postedTo : undefined;

  const agent = new SamGovResearchAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ apiKey, keywords, postedFrom, postedTo });
    return NextResponse.json({
      opportunities: outcome.data.opportunities,
      count: outcome.data.count,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    const message =
      err instanceof Error ? err.message : "SAM.gov agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
