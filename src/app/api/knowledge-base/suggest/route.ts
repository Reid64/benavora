import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude } from "@/lib/ai/claude";
import { SECTION_KEYS, type SectionKey } from "@/lib/knowledge-base/profile";

// POST /api/knowledge-base/suggest — "AI Assist" for the Knowledge Base
// Editor (/knowledge-base/edit). Given what's already in a section and a
// thin org profile summary, asks Claude for section-specific draft content
// the user can review and edit before it's saved (never auto-submitted or
// treated as verified fact).
//
// Per section this returns a DIFFERENT, narrow JSON shape matching exactly
// the fields that section's `applySuggestion` handler in page.tsx expects —
// see SECTION_SCHEMAS below. Fields that describe a verifiable fact this
// codebase has no way to verify (state registration numbers, audit results,
// specific dates) are deliberately never requested — Claude is told to omit
// anything it cannot reasonably infer rather than invent one, consistent
// with this project's "never fabricate" standard (CLAUDE.md Iron Law #3).

export const runtime = "nodejs";
export const maxDuration = 300;

interface SectionSchema {
  /** Human-readable description of the JSON shape Claude must return. */
  shape: string;
  /** Extra section-specific guidance appended to the base prompt. */
  guidance: string;
}

const SECTION_SCHEMAS: Record<SectionKey, SectionSchema> = {
  mission_and_vision: {
    shape: `{"mission": string, "vision": string, "core_values": string[]}`,
    guidance:
      "Write a specific, funder-ready mission statement (100+ words) and a short vision statement. Suggest 3-5 core values as single words or short phrases.",
  },
  programs_and_services: {
    shape: `{"name": string, "description": string, "target_population": string, "geographic_area": string, "key_outcomes": string}`,
    guidance:
      "Suggest ONE new program this organization plausibly runs given its mission — a specific program name (not generic), a 50+ word description, its target population, geographic area, and 1-2 measurable key outcomes.",
  },
  financial_profile: {
    shape: `{"revenue_sources": [{"source": string, "percentage": number}]}`,
    guidance:
      "Suggest a realistic revenue source mix (e.g. foundation grants, individual donations, government contracts, earned revenue, corporate sponsorships) for an organization of this type, with percentages that sum to roughly 100.",
  },
  leadership_and_board: {
    shape: `{"bio": string}`,
    guidance:
      "Draft a short (40-80 word) professional bio for the Executive Director, in third person, emphasizing relevant leadership experience. Use placeholder phrasing like 'brings over a decade of nonprofit leadership experience' rather than fabricating a specific employer or credential.",
  },
  geographic_service_area: {
    shape: `{"description": string, "counties": string[]}`,
    guidance:
      "Write a 2-3 sentence description of the service area's character (rural/urban, population density, relevant geography). Only suggest specific county names if the org's stated service_area names a real, identifiable region — otherwise return an empty counties array rather than inventing county names.",
  },
  target_population: {
    shape: `{"target_population": string, "demographics": string[]}`,
    guidance:
      "Write a specific 1-2 sentence description of who this org serves, in the concrete terms funders look for. For demographics, choose only from this list: Low-income, Homeless, Veterans, Immigrants, Youth, Seniors, Disabilities, LGBTQ+, Formerly incarcerated, Rural.",
  },
  impact_and_outcomes: {
    shape: `{"kpis": [{"name": string, "measurement": string, "baseline": string, "current": string}], "achievements": string}`,
    guidance:
      "Suggest 2-3 KPIs this type of program would plausibly track (name + how it's measured), with baseline/current left as empty strings since real values can't be invented. Draft a short 'notable achievements' placeholder paragraph the user can replace with real figures.",
  },
  organizational_history: {
    shape: `{"founding_story": string, "milestones": [{"year": null, "milestone": string}]}`,
    guidance:
      "Draft a short founding-story placeholder paragraph in a plausible narrative voice. For milestones, describe 2-3 milestone TYPES a young nonprofit like this would plausibly reach (e.g. 'Program launched serving first cohort', 'Reached 501(c)(3) status') with year left null since a real date can't be invented.",
  },
  partnerships_and_coalitions: {
    shape: `{"partners": [{"name": string, "relationship_type": string, "duration": string}], "coalitions": string[]}`,
    guidance:
      "Suggest 1-2 GENERIC partner organization TYPES (e.g. 'Local food bank', 'Community health clinic') this org's mission would plausibly partner with, not real named organizations, since a real partnership can't be invented. Leave coalitions as an empty array unless the org profile already names one.",
  },
  compliance_and_certifications: {
    shape: `{"tax_status": string}`,
    guidance:
      "Only suggest a tax_status if the org profile gives no indication of one already — in that case suggest '501(c)(3)' as the standard default for a US charitable nonprofit. If a tax status is already set, return {} instead.",
  },
};

interface SuggestBody {
  section: SectionKey;
  currentContent: Record<string, unknown>;
  orgProfile: Record<string, unknown>;
}

function isSuggestBody(value: unknown): value is SuggestBody {
  if (!value || typeof value !== "object") return false;
  const section = (value as { section?: unknown }).section;
  return typeof section === "string" && (SECTION_KEYS as readonly string[]).includes(section);
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;

  const body: unknown = await request.json().catch(() => null);
  if (!isSuggestBody(body)) {
    return NextResponse.json({ error: "Body must include a valid `section`." }, { status: 400 });
  }

  const schema = SECTION_SCHEMAS[body.section];
  const prompt = [
    "You are helping a nonprofit organization fill in its Knowledge Base profile, which feeds AI grant-drafting and fundability scoring.",
    `Section: ${body.section}`,
    "",
    "Organization profile so far:",
    JSON.stringify(body.orgProfile ?? {}, null, 2),
    "",
    "Content already in this section:",
    JSON.stringify(body.currentContent ?? {}, null, 2),
    "",
    schema.guidance,
    "",
    "Be specific and concrete, not generic filler — use realistic language a nonprofit would actually use, grounded in the organization profile above.",
    "Never invent a specific fact you cannot support (a real partner org's name, a specific date, a registration number, a specific statistic) — use plausible placeholder language instead that the user can edit.",
    `Return ONLY a JSON object matching this shape: ${schema.shape}`,
    "If there is nothing you can usefully suggest, return {}. No prose, no markdown fences.",
  ].join("\n");

  try {
    const response = await callClaude({ prompt, maxTokens: 500 });
    const parsed: unknown = JSON.parse(stripCodeFence(response.text));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ suggestion: {} });
    }
    return NextResponse.json({ suggestion: parsed });
  } catch {
    return NextResponse.json(
      { error: "Could not get AI suggestions right now. Try again in a moment." },
      { status: 502 },
    );
  }
}
