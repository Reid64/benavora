// POST /api/agents/keyword-expansion — overnight-006
//
// Suggests additional search keywords for a search profile using Claude.
// Accepts a profile_id and returns a list of suggested keywords the user
// can accept or reject before saving them back to the profile.
//
// The profile data (existing keywords, categories, focus areas) is loaded
// server-side so the client cannot inject arbitrary context.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { expandKeywords } from "@/lib/research/keyword-expander";
import { parseFocusAreas } from "@/lib/research/profile-config";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

interface ProfileRow {
  id: string;
  keywords: string[] | null;
  categories: string[] | null;
  geographic_scope: string | null;
  focus_areas: Json | null;
  populations_served: string[] | null;
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const parsed = (body ?? {}) as { profile_id?: unknown; count?: unknown };

  if (typeof parsed.profile_id !== "string" || parsed.profile_id.trim() === "") {
    return jsonError("profile_id is required.", "invalid_input", 400);
  }
  const profileId = parsed.profile_id.trim();

  const count =
    typeof parsed.count === "number" && parsed.count > 0
      ? Math.min(parsed.count, 20)
      : 10;

  // Load profile org-scoped (Contracts §2).
  const { data: profileData, error: profileError } = await supabase
    .from("search_profiles")
    .select(
      "id, keywords, categories, geographic_scope, focus_areas, populations_served",
    )
    .eq("organization_id", organizationId)
    .eq("id", profileId)
    .maybeSingle();

  if (profileError || !profileData) {
    return jsonError("Search profile not found.", "not_found", 404);
  }

  const profile = profileData as ProfileRow;

  // Load org mission for context.
  const { data: org } = await supabase
    .from("organizations")
    .select("mission_statement, service_area")
    .eq("id", organizationId)
    .maybeSingle();

  const orgData = org as {
    mission_statement: string | null;
    service_area: string | null;
  } | null;

  const focusAreas = parseFocusAreas(profile.focus_areas);

  const result = await expandKeywords({
    existingKeywords: profile.keywords ?? [],
    missionStatement: orgData?.mission_statement ?? null,
    geographicScope: profile.geographic_scope ?? null,
    focusAreaLabels: focusAreas.map((f) => f.label),
    populationsServed: (profile.populations_served ?? []).filter(
      (s) => typeof s === "string",
    ),
    categories: (profile.categories ?? []).map((c) =>
      c.replace(/_/g, " "),
    ),
    count,
  });

  return NextResponse.json({
    suggested: result.suggested,
    tokensUsed: result.tokensUsed,
  });
}
