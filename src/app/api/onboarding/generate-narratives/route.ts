import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/ai/claude";

export const runtime = "nodejs";

export async function POST() {
  const headersList = headers();
  const orgId = headersList.get("x-organization-id");
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Demo Account Scope (DEMO_ACCOUNT_SCOPE_2026-08-15.md): this route only
  // generates draft narrative suggestions for the onboarding wizard's step 3
  // (nothing is persisted here), but its output only has a home via
  // POST /api/onboarding, which is itself blocked for a restricted profile -
  // so there is no reachable, non-wasted use of this route for one.
  if (headersList.get("x-onboarding-edit-restricted") === "true") {
    return NextResponse.json(
      { error: "This account cannot edit organizational profile data." },
      { status: 403 },
    );
  }

  const supabase = createClient();

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select(
      "name, mission_statement, service_area, target_population, founding_date, founder_name, founder_bio, annual_budget, total_staff, total_volunteers"
    )
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const { data: programs } = await supabase
    .from("programs")
    .select("name, description, budget, beneficiaries_served")
    .eq("organization_id", orgId)
    .limit(10);

  const programLines = (programs ?? [])
    .map(
      (p, i) =>
        `Program ${i + 1}: ${p.name}` +
        (p.description ? ` — ${p.description}` : "") +
        (p.beneficiaries_served ? ` (serves ${p.beneficiaries_served}/year)` : "") +
        (p.budget ? `, $${p.budget} annual budget` : "")
    )
    .join("\n");

  const prompt = `You are an expert nonprofit grant writer. Using the organization profile below, generate 7 grant-ready narrative drafts and 10-15 keyword suggestions. Write in a compelling, professional voice. Where specific data is missing, use [PLACEHOLDER] notation (e.g., "[PLACEHOLDER: number of clients served]").

ORGANIZATION PROFILE:
Name: ${org.name ?? ""}
Mission: ${org.mission_statement ?? ""}
Service Area: ${org.service_area ?? ""}
Target Population: ${org.target_population ?? ""}
Staff: ${org.total_staff ?? 0} staff, ${org.total_volunteers ?? 0} volunteers${org.founding_date ? `\nFounded: ${org.founding_date}` : ""}${org.founder_name ? `\nFounder: ${org.founder_name}${org.founder_bio ? ` — ${org.founder_bio}` : ""}` : ""}${org.annual_budget ? `\nAnnual Budget: $${org.annual_budget}` : ""}

PROGRAMS:
${programLines || "No programs specified yet."}

Return ONLY a valid JSON object with this exact structure (no markdown fences, no explanation outside the JSON):
{
  "narratives": [
    {"category": "mission", "title": "Mission Statement", "content": "2-3 paragraphs describing why the organization exists and what it is working to change"},
    {"category": "need_statement", "title": "Need Statement", "content": "2-3 paragraphs explaining the problem, who is affected, and why action is needed now"},
    {"category": "program_description", "title": "Program Description", "content": "2-3 paragraphs describing the programs, how they work, and how they address the need"},
    {"category": "capacity", "title": "Organizational Capacity", "content": "1-2 paragraphs on staff expertise, volunteer network, board governance, and operational track record"},
    {"category": "sustainability", "title": "Sustainability Plan", "content": "1-2 paragraphs on long-term funding strategy, revenue diversification, and financial stability"},
    {"category": "partnerships", "title": "Partnerships & Collaborations", "content": "1-2 paragraphs on community partnerships, referral networks, and collaborative relationships"},
    {"category": "organizational_history", "title": "Organizational History", "content": "1-2 paragraphs on the founding story, key milestones, and growth trajectory"}
  ],
  "keywords": ["keyword1", "keyword2", "...up to 15 grant-relevant keywords reflecting the work, population, geography, and funding categories"]
}`;

  try {
    const response = await callClaude({
      prompt,
      model: "claude-sonnet-4-6",
      maxTokens: 4096,
    });

    const text = response.text.trim();
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error("No JSON found in AI response");
    }

    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
      narratives: { category: string; title: string; content: string }[];
      keywords: string[];
    };

    if (!Array.isArray(parsed.narratives) || !Array.isArray(parsed.keywords)) {
      throw new Error("Invalid response structure");
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[generate-narratives]", err);
    return NextResponse.json(
      { error: "Generation failed. You can enter narratives manually below." },
      { status: 500 }
    );
  }
}
