import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude } from "@/lib/ai/claude";
import { createClient } from "@/lib/supabase/server";

export const VALID_SOURCE_KEYS = [
  "grants_gov",
  "sam_gov",
  "simpler_grants",
  "hud",
  "tdhca",
  "state_scrapers",
  "corporate",
] as const;

export type SourceKey = (typeof VALID_SOURCE_KEYS)[number];

export interface ResearchConfig {
  recommended_sources: SourceKey[];
  primary_keywords: string[];
  irrelevant_sources: Array<{ key: string; reason: string }>;
  generated_at: string;
}

export const RESEARCH_CONFIG_KEY = "research_config";

export async function generateOrgResearchConfig(
  organizationId: string,
  client?: SupabaseClient,
): Promise<ResearchConfig> {
  const supabase = client ?? createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("mission_statement, service_area, target_population")
    .eq("id", organizationId)
    .single();

  const orgData = org as {
    mission_statement: string | null;
    service_area: string | null;
    target_population: string | null;
  } | null;

  const { data: profileRows } = await supabase
    .from("search_profiles")
    .select("name, keywords, categories, geographic_scope")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .limit(5);

  const profiles = (profileRows ?? []) as Array<{
    name: string;
    keywords: string[] | null;
    categories: string[] | null;
    geographic_scope: string | null;
  }>;

  const profileSummary =
    profiles
      .map(
        (p) =>
          `- ${p.name}: keywords=[${(p.keywords ?? []).join(", ")}], scope=${p.geographic_scope ?? "national"}`,
      )
      .join("\n") || "None configured";

  const prompt = `You are analyzing a nonprofit organization to determine which grant research sources are most relevant.

Organization:
- Mission: ${orgData?.mission_statement ?? "Not provided"}
- Service Area: ${orgData?.service_area ?? "Not provided"}
- Target Population: ${orgData?.target_population ?? "Not provided"}

Active Search Profiles:
${profileSummary}

Available grant sources:
- grants_gov: Federal grants portal (broad federal funding across all categories)
- sam_gov: Federal contracts and grants via SAM.gov
- simpler_grants: HHS Simpler Grants portal (health and human services focus)
- hud: HUD housing and community development grants
- tdhca: Texas Dept of Housing and Community Affairs (Texas organizations only)
- state_scrapers: State-level government grant portals outside Texas
- corporate: Corporate giving programs and foundations

Analyze the organization and return ONLY valid JSON (no markdown, no explanation):
{
  "recommended_sources": ["source_key1", "source_key2"],
  "primary_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6", "keyword7", "keyword8", "keyword9", "keyword10"],
  "irrelevant_sources": [{"key": "source_key", "reason": "brief reason"}]
}

Rules:
- recommended_sources: subset of the source keys above that best match this org's profile
- primary_keywords: exactly 10 search terms most likely to find relevant grants for this org
- irrelevant_sources: sources NOT in recommended_sources, each with a concise reason
- Every source key must appear in exactly one list`;

  let config: ResearchConfig;

  try {
    const response = await callClaude({ prompt, maxTokens: 1024, temperature: 0 });

    const parsed = JSON.parse(response.text) as Partial<{
      recommended_sources: string[];
      primary_keywords: string[];
      irrelevant_sources: Array<{ key: string; reason: string }>;
    }>;

    const validKeys = new Set<string>(VALID_SOURCE_KEYS);
    const recommended = (parsed.recommended_sources ?? []).filter((k) =>
      validKeys.has(k),
    ) as SourceKey[];

    config = {
      recommended_sources:
        recommended.length > 0 ? recommended : [...VALID_SOURCE_KEYS],
      primary_keywords: (parsed.primary_keywords ?? []).slice(0, 10),
      irrelevant_sources: (parsed.irrelevant_sources ?? []).filter(
        (s) => s.key && s.reason,
      ),
      generated_at: new Date().toISOString(),
    };
  } catch {
    // Fall back to all sources if AI call or JSON parsing fails.
    config = {
      recommended_sources: [...VALID_SOURCE_KEYS],
      primary_keywords: [],
      irrelevant_sources: [],
      generated_at: new Date().toISOString(),
    };
  }

  // Upsert into platform_config — update if exists, insert otherwise.
  const { data: existing } = await supabase
    .from("platform_config")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("key", RESEARCH_CONFIG_KEY)
    .maybeSingle();

  const existingRow = existing as { id: string } | null;

  if (existingRow?.id) {
    await supabase
      .from("platform_config")
      .update({ value: JSON.stringify(config) })
      .eq("id", existingRow.id);
  } else {
    await supabase.from("platform_config").insert({
      organization_id: organizationId,
      key: RESEARCH_CONFIG_KEY,
      value: JSON.stringify(config),
    });
  }

  return config;
}

export async function getOrgResearchConfig(
  organizationId: string,
  client?: SupabaseClient,
): Promise<ResearchConfig | null> {
  const supabase = client ?? createClient();

  const { data } = await supabase
    .from("platform_config")
    .select("value")
    .eq("organization_id", organizationId)
    .eq("key", RESEARCH_CONFIG_KEY)
    .maybeSingle();

  const row = data as { value: string } | null;
  if (!row?.value) return null;

  try {
    return JSON.parse(row.value) as ResearchConfig;
  } catch {
    return null;
  }
}
