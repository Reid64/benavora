import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export const runtime = "nodejs";

type OnboardingProgress = { completed_steps: string[]; last_step: string };

/**
 * Folds a just-completed step into the progress checklist read by the
 * dashboard resume banner and Settings > Organization Setup. Separate from
 * onboarding_step (the resume pointer) because the checklist needs the full
 * set of completed steps, not just "the next one to do".
 */
function nextOnboardingProgress(
  current: unknown,
  completedStep: number,
  nextStep: number,
): OnboardingProgress {
  const currentSteps =
    current && typeof current === "object" && Array.isArray((current as { completed_steps?: unknown }).completed_steps)
      ? ((current as { completed_steps: unknown[] }).completed_steps.filter((s): s is string => typeof s === "string"))
      : [];
  const completed = new Set(currentSteps);
  completed.add(String(completedStep));
  const ordered = Array.from(completed).sort((a, b) => Number(a) - Number(b));
  return { completed_steps: ordered, last_step: String(nextStep) };
}

/**
 * Normalize the wizard's optional partner input into { name, description }.
 * Accepts an array of plain names or of { name, description } objects so the
 * client can evolve without breaking the write.
 */
function normalizePartners(
  raw: unknown,
): Array<{ name: string; description: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; description: string }> = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ name: item.trim(), description: "" });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (name) {
        out.push({
          name,
          description:
            typeof o.description === "string" ? o.description.trim() : "",
        });
      }
    }
  }
  return out;
}

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
      "id, name, ein, tax_status, mission_statement, service_area, target_population, onboarding_step, onboarding_completed, onboarding_progress, subscription_tier",
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
      .select("id, category, title, content, keywords")
      .eq("organization_id", orgId)
      .in("category", [
        "mission",
        "need_statement",
        "impact",
        "program_description",
        "capacity",
        "sustainability",
        "partnerships",
        "organizational_history",
      ])
      .limit(15),
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
    progress: (org.onboarding_progress as OnboardingProgress | null) ?? { completed_steps: [], last_step: "1" },
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

  // Demo Account Scope (DEMO_ACCOUNT_SCOPE_2026-08-15.md): this route writes
  // every §2.1-§2.6 protected table. This is a first-layer UX nicety - the
  // migration 138 DB triggers are the authoritative block regardless of this
  // check.
  if (headersList.get("x-onboarding-edit-restricted") === "true") {
    return NextResponse.json(
      { error: "This account cannot edit organizational profile data." },
      { status: 403 },
    );
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

  const { data: progressRow } = await supabase
    .from("organizations")
    .select("onboarding_progress")
    .eq("id", orgId)
    .single();
  const nextStep = step < 7 ? step + 1 : 7;
  const progress = nextOnboardingProgress(progressRow?.onboarding_progress, step, nextStep);

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
          onboarding_progress: progress,
        })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
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
        // Idempotent: skip programs whose name already exists for this org, so
        // re-running onboarding never stacks duplicates and never churns ids
        // that budgets/applications may reference.
        const { data: existing } = await supabase
          .from("programs")
          .select("name")
          .eq("organization_id", orgId);
        const seen = new Set((existing ?? []).map((r) => r.name));
        const rows = programs
          .filter((p) => p.name && !seen.has(String(p.name)))
          .map((p) => ({
            organization_id: orgId,
            name: String(p.name),
            description: p.description ? String(p.description) : null,
            budget: p.budget != null ? Number(p.budget) : null,
            beneficiaries_served: p.beneficiaries_served != null ? Number(p.beneficiaries_served) : null,
            status: "active",
          }));
        if (rows.length > 0) {
          const { error } = await supabase.from("programs").insert(rows);
          if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
        }
      }
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 3, onboarding_progress: progress })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
      break;
    }

    case 3: {
      type KBCat = Enums<"knowledge_base_category">;
      const keywords = (data.keywords ?? []) as string[];
      const kw = keywords.length > 0 ? keywords : null;

      const rows: Array<{
        organization_id: string;
        category: KBCat;
        title: string;
        content: string;
        keywords: string[] | null;
        created_by: string;
      }> = [];
      const push = (category: KBCat, title: string, content: string) => {
        const trimmed = content.trim();
        if (trimmed.length > 0) {
          rows.push({ organization_id: orgId, category, title, content: trimmed, keywords: kw, created_by: userId });
        }
      };

      if (Array.isArray(data.narratives)) {
        // AI-generated format: { narratives: [{category, title, content}], keywords: [] }
        for (const n of data.narratives as Array<{ category: string; title: string; content: string }>) {
          if (n.category && n.title && n.content?.trim()) push(n.category as KBCat, n.title, n.content);
        }
      } else {
        // Legacy manual format: { mission, need_statement, impact }
        push("mission" as KBCat, "Mission Statement", String(data.mission ?? ""));
        push("need_statement" as KBCat, "Need Statement", String(data.need_statement ?? ""));
        push("impact" as KBCat, "Impact Statement", String(data.impact ?? ""));
      }

      // Partner organizations -> partnerships KB. Only add a partner not already
      // named in an existing partnerships entry, so the draft prompt sees the
      // named relationships (not just generic partner types).
      const partners = normalizePartners(data.partners);
      if (partners.length > 0) {
        const { data: existingPart } = await supabase
          .from("knowledge_base")
          .select("content")
          .eq("organization_id", orgId)
          .eq("category", "partnerships");
        const existingText = (existingPart ?? [])
          .map((r) => String(r.content ?? "").toLowerCase())
          .join("\n");
        for (const p of partners) {
          if (!existingText.includes(p.name.toLowerCase())) {
            push(
              "partnerships" as KBCat,
              `Strategic Partner: ${p.name}`,
              p.description || `${p.name} is a strategic partner of the organization.`,
            );
          }
        }
      }

      // Accounting software -> custom Q&A KB (the answer to a common funder
      // capacity question). Written only when the wizard supplies it.
      const accounting = data.accounting_software ? String(data.accounting_software).trim() : "";
      if (accounting) push("custom" as KBCat, "What accounting software do you use?", accounting);

      if (rows.length > 0) {
        // Idempotent: replace any existing entries with the same titles so a
        // re-run updates content in place instead of stacking duplicates.
        const titles = rows.map((r) => r.title);
        await supabase.from("knowledge_base").delete().eq("organization_id", orgId).in("title", titles);
        const { error } = await supabase.from("knowledge_base").insert(rows);
        if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
      }
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 4, onboarding_progress: progress })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
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
        // Idempotent: skip members whose name already exists for this org.
        const { data: existing } = await supabase
          .from("board_members")
          .select("name")
          .eq("organization_id", orgId);
        const seen = new Set((existing ?? []).map((r) => r.name));
        const rows = members
          .filter((m) => m.name && !seen.has(String(m.name)))
          .map((m) => ({
            organization_id: orgId,
            name: String(m.name),
            title: m.title ? String(m.title) : null,
            bio: m.bio ? String(m.bio) : null,
            email: m.email ? String(m.email) : null,
            is_active: true,
          }));
        if (rows.length > 0) {
          const { error } = await supabase.from("board_members").insert(rows);
          if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
        }
      }

      // Project board bios into a single capacity KB entry. The draft pipeline
      // reads knowledge_base, not board_members, so without this the board's
      // qualifications never reach a draft. Idempotent by title.
      const { data: board } = await supabase
        .from("board_members")
        .select("name, title, bio")
        .eq("organization_id", orgId)
        .eq("is_active", true);
      const withBio = (board ?? []).filter((b) => b.bio && String(b.bio).trim());
      if (withBio.length > 0) {
        const content = withBio
          .map((b) => `${b.name}${b.title ? `, ${b.title}` : ""}: ${String(b.bio).trim()}`)
          .join("\n\n");
        const title = "Board Leadership & Governance";
        await supabase.from("knowledge_base").delete().eq("organization_id", orgId).eq("title", title);
        const { error: kbError } = await supabase.from("knowledge_base").insert({
          organization_id: orgId,
          category: "capacity",
          title,
          content,
          keywords: null,
          created_by: userId,
        });
        if (kbError) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
      }

      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 5, onboarding_progress: progress })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
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
        if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
      }
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 6, onboarding_progress: progress })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
      break;
    }

    case 6: {
      const keywords = (data.keywords ?? []) as string[];
      if (keywords.length > 0) {
        const name = String(data.name ?? "Primary Search Profile");
        // Idempotent: don't create a second profile with the same name on re-run.
        const { data: existing } = await supabase
          .from("search_profiles")
          .select("id")
          .eq("organization_id", orgId)
          .eq("name", name)
          .maybeSingle();
        if (!existing) {
          // The advanced-config columns (source_type_filters, focus_areas,
          // eligibility_filters, populations_served, excluded_*, agent_settings)
          // are defaulted by the table (migration 011) - onboarding only sets
          // the fields the wizard actually collects. Setting the others here was
          // both redundant and a hard error wherever 011 isn't applied.
          const { error } = await supabase.from("search_profiles").insert({
            organization_id: orgId,
            name,
            keywords,
            categories: ((data.categories ?? []) as string[]).length > 0
              ? (data.categories as Enums<"funder_category">[])
              : null,
            geographic_scope: data.geographic_scope ? String(data.geographic_scope) : null,
            min_amount: data.min_amount != null ? Number(data.min_amount) : null,
            max_amount: data.max_amount != null ? Number(data.max_amount) : null,
            is_active: true,
          });
          if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
        }
      }
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_step: 7, onboarding_progress: progress })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
      break;
    }

    case 7: {
      const { error } = await supabase
        .from("organizations")
        .update({
          onboarding_step: 7,
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          onboarding_progress: progress,
        })
        .eq("id", orgId);
      if (error) return NextResponse.json({ error: "Could not save onboarding data." }, { status: 500 });
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

