import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export const runtime = "nodejs";

// ============================================================================
// GET /api/onboarding
//
// Returns the organization's current onboarding state: step pointer, org
// profile data, and any related records already created during the wizard
// (programs, knowledge base entries, board members, search profiles, docs).
// ============================================================================
export async function GET() {
  const headersList = headers();
  const orgId = headersList.get("x-organization-id");
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient();

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select(
      "id, name, ein, tax_status, mission_statement, service_area, target_population, onboarding_step, onboarding_completed, subscription_tier",
    )
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const [programsRes, kbRes, boardRes, searchRes, docsRes] = await Promise.all([
    supabase
      .from("programs")
      .select("id, name, description, budget, beneficiaries_served")
      .eq("organization_id", orgId)
      .limit(20),
    supabase
      .from("knowledge_base")
      .select("id, category, title, content")
      .eq("organization_id", orgId)
      .in("category", ["mission", "need_statement", "impact"])
      .limit(10),
    supabase
      .from("board_members")
      .select("id, name, title, bio, email")
      .eq("organization_id", orgId)
      .limit(20),
    supabase
      .from("search_profiles")
      .select("id, name, keywords, categories, geographic_scope, min_amount, max_amount")
      .eq("organization_id", orgId)
      .limit(10),
    supabase
      .from("documents")
      .select("id, file_name, category, description, created_at")
      .eq("organization_id", orgId)
      .in("category", ["tax_documents", "legal_documents", "financial_documents"])
      .limit(20),
  ]);

  return NextResponse.json({
    step: org.onboarding_step ?? 0,
    completed: org.onboarding_completed ?? false,
    org: {
      id: org.id,
      name: org.name ?? "",
      ein: org.ein ?? "",
      tax_status: org.tax_status ?? "",
      mission_statement: org.mission_statement ?? "",
      service_area: org.service_area ?? "",
      target_population: org.target_population ?? "",
      subscription_tier: org.subscription_tier ?? "free",
    },
    programs: programsRes.data ?? [],
    knowledge_base: kbRes.data ?? [],
    board_members: boardRes.data ?? [],
    search_profiles: searchRes.data ?? [],
    documents: docsRes.data ?? [],
  });
}

// ============================================================================
// POST /api/onboarding
//
// Saves the data for the given wizard step and advances onboarding_step.
// Body: { step: number, data: object, complete?: boolean }
//
// Each step maps to a different table write:
//   1 â†’ organizations (profile fields)
//   2 â†’ programs (insert rows)
//   3 â†’ knowledge_base (mission, need_statement, impact rows)
//   4 â†’ board_members (insert rows)
//   5 â†’ documents (metadata rows; files already uploaded to Storage by client)
//   6 â†’ search_profiles (insert one profile)
//   7 â†’ marks onboarding_completed = true
//
// company_id is always derived from the session (x-organization-id header),
// never from the request body (Behavioral Contracts Â§2).
// ============================================================================
export async function POST(request: NextRequest) {
  const headersList = headers();
  const orgId = headersList.get("x-organization-id");
  const userId = headersList.get("x-user-id");
  if (!orgId || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient();

  let body: { step: number; data: Record<string, unknown>; complete?: boolean };
  try {
    body = (await request.json()) as { step: number; data: Record<string, unknown>; complete?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { step, data, complete } = body;
  if (typeof step !== "number") {
    return NextResponse.json({ error: "step is required" }, { status: 400 });
  }

  switch (step) {
    case 1: {
      const { error } = await supabase
        .from("organizations")
        .update({
          name: String(data.name ?? ""),
          ein: data.ein ? String(data.ein) : null,
          tax_status: data.tax_status ? String(data.tax_status) : null,
          mission_statement: data.mission_statement ? String(data.mission_statement) : null,
          service_area: data.service_area ? String(data.service_area) : null,
          target_population: data.target_population ? String(data.target_population) : null,
          onboarding_step: 2,
        })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }

    case 2: {
      const programs = (data.programs ?? []) as Array<{
        name: string;
        description: string;
        budget: number | null;
        beneficiaries_served: number | null;
      }>;
      if (programs.length > 0) {
        const rows = programs.map((p) => ({
          organization_id: orgId,
          name: String(p.name),
          description: p.description ? String(p.description) : null,
          budget: p.budget != null ? Number(p.budget) : null,
          beneficiaries_served: p.beneficiaries_served != null ? Number(p.beneficiaries_served) : null,
          status: "active",
        }));
        const { error } = await supabase.from("programs").insert(rows);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 3 })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }

    case 3: {
      type KBCat = Enums<"knowledge_base_category">;
      const entries: { category: KBCat; title: string; content: string }[] = [
        { category: "mission", title: "Mission Statement", content: String(data.mission ?? "") },
        { category: "need_statement", title: "Need Statement", content: String(data.need_statement ?? "") },
        { category: "impact", title: "Impact Statement", content: String(data.impact ?? "") },
      ].filter((e): e is { category: KBCat; title: string; content: string } => e.content.trim().length > 0);

      if (entries.length > 0) {
        const rows = entries.map((e) => ({
          organization_id: orgId,
          category: e.category,
          title: e.title,
          content: e.content,
          created_by: userId,
        }));
        const { error } = await supabase.from("knowledge_base").insert(rows);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 4 })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }

    case 4: {
      const members = (data.board_members ?? []) as Array<{
        name: string;
        title: string;
        bio: string;
        email: string;
      }>;
      if (members.length > 0) {
        const rows = members.map((m) => ({
          organization_id: orgId,
          name: String(m.name),
          title: m.title ? String(m.title) : null,
          bio: m.bio ? String(m.bio) : null,
          email: m.email ? String(m.email) : null,
          is_active: true,
        }));
        const { error } = await supabase.from("board_members").insert(rows);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 5 })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }

    case 5: {
      const documents = (data.documents ?? []) as Array<{
        file_name: string;
        storage_path: string;
        category: string;
        description: string;
        file_size: number | null;
        mime_type: string | null;
      }>;
      if (documents.length > 0) {
        type DocCat = Enums<"document_category">;
        const rows = documents.map((d) => ({
          organization_id: orgId,
          file_name: String(d.file_name),
          storage_path: String(d.storage_path),
          category: String(d.category) as DocCat,
          description: d.description ? String(d.description) : null,
          file_size: d.file_size != null ? Number(d.file_size) : null,
          mime_type: d.mime_type ? String(d.mime_type) : null,
          uploaded_by: userId,
        }));
        const { error } = await supabase.from("documents").insert(rows);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 6 })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }

    case 6: {
      const keywords = (data.keywords ?? []) as string[];
      if (keywords.length > 0) {
        const { error } = await supabase.from("search_profiles").insert({
          organization_id: orgId,
          name: String(data.name ?? "Primary Search Profile"),
          keywords,
          categories: ((data.categories ?? []) as string[]).length > 0
            ? (data.categories as Enums<"funder_category">[])
            : null,
          geographic_scope: data.geographic_scope ? String(data.geographic_scope) : null,
          min_amount: data.min_amount != null ? Number(data.min_amount) : null,
          max_amount: data.max_amount != null ? Number(data.max_amount) : null,
          is_active: true,
          source_type_filters: {},
          focus_areas: {},
          geographic_scopes: [],
          eligibility_filters: {},
          populations_served: [],
          excluded_categories: [],
          excluded_funders: [],
          agent_settings: {},
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 7 })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }

    case 7: {
      const { error } = await supabase
        .from("organizations")
        .update({
          onboarding_step: 7,
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
        })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }

    default:
      return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }

  // complete=true allows any step to immediately mark onboarding finished
  // (used by the "Skip for now" button in step 7).
  if (complete) {
    await supabase
      .from("organizations")
      .update({
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq("id", orgId);
  }

  return NextResponse.json({ ok: true });
}

