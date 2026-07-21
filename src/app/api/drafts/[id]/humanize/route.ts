// POST /api/drafts/[id]/humanize
// Re-runs narrative humanization (src/lib/intelligence/narrative-humanizer.ts)
// against an existing application's draft_content, or — with
// { scoreOnly: true } — re-runs Pass 4 scoring only, against the draft's
// current (already-saved) content. Powers the "Re-Humanize" and "Re-Score"
// actions on the autonomous draft review page (/draft-generator/autonomous).
// Writes applications.metadata.humanization_score /
// .humanization_breakdown (103_narrative_humanizer.sql), mirroring the
// shape draft-generation-agent.ts (ag-05-draft) writes on first generation.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  humanizeNarrative,
  scoreNarrativeQuality,
  type OrgProfile,
  type OpportunityContext,
} from "@/lib/intelligence/narrative-humanizer";

export const runtime = "nodejs";
// The full pass runs up to 3 Claude calls (tell detection, replacement
// generation, voice consistency) plus scoring — same rationale as
// /api/ai/humanize/route.ts's maxDuration.
export const maxDuration = 300;

type RouteContext = { params: { id: string } };

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

const MAX_KB_FACTS = 20;

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const { id } = params;
  if (!isUuid(id)) {
    return jsonError("Draft not found.", "not_found", 404);
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // No/empty body is fine — scoreOnly defaults to false.
  }
  const scoreOnly = (body as { scoreOnly?: unknown }).scoreOnly === true;

  const { data: applicationRow, error: appError } = await supabase
    .from("applications")
    .select("id, draft_content, opportunity_id, metadata")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (appError || !applicationRow) {
    return jsonError("Draft not found.", "not_found", 404);
  }

  const application = applicationRow as {
    id: string;
    draft_content: string | null;
    opportunity_id: string;
    metadata: Record<string, unknown> | null;
  };

  if (!application.draft_content || application.draft_content.trim() === "") {
    return jsonError(
      "This draft has no content to humanize.",
      "empty_draft",
      422,
    );
  }

  const startedAt = Date.now();
  let runId: string | null = null;
  {
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({
        organization_id: organizationId,
        agent_type: "narrative_drafting",
        status: "running",
        triggered_by: userId,
        input_params: {
          applicationId: id,
          pass: scoreOnly ? "rescore" : "re_humanize",
        },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    runId = (run as { id?: string } | null)?.id ?? null;
  }

  try {
    if (scoreOnly) {
      const scoreBreakdown = await scoreNarrativeQuality(
        application.draft_content,
      );
      const humanizationScore = Math.round(
        (scoreBreakdown.human_voice_authenticity +
          scoreBreakdown.organization_specificity +
          scoreBreakdown.ai_phrase_absence +
          scoreBreakdown.narrative_flow) /
          4,
      );

      const updatedMetadata = {
        ...(application.metadata ?? {}),
        humanization_score: humanizationScore,
        humanization_breakdown: scoreBreakdown,
        humanization_updated_at: new Date().toISOString(),
      };

      await supabase
        .from("applications")
        .update({ metadata: updatedMetadata })
        .eq("id", id)
        .eq("organization_id", organizationId);

      if (runId) {
        await supabase
          .from("agent_runs")
          .update({
            status: "completed",
            output_summary: `Re-scored draft quality: ${humanizationScore}/100.`,
            items_found: 1,
            items_processed: 1,
            duration_ms: Date.now() - startedAt,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);
      }

      return NextResponse.json({
        draftContent: application.draft_content,
        humanizationScore,
        scoreBreakdown,
      });
    }

    const [orgRes, kbRes, oppRes] = await Promise.all([
      supabase
        .from("organizations")
        .select("name, mission_statement, service_area, target_population")
        .eq("id", organizationId)
        .single(),
      supabase
        .from("knowledge_base")
        .select("title, category, content")
        .eq("organization_id", organizationId)
        .order("is_proven", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(MAX_KB_FACTS),
      supabase
        .from("opportunities")
        .select("name, category, funder_id")
        .eq("id", application.opportunity_id)
        .eq("organization_id", organizationId)
        .maybeSingle(),
    ]);

    const org = orgRes.data as {
      name: string;
      mission_statement: string | null;
      service_area: string | null;
      target_population: string | null;
    } | null;

    const kbEntries = (kbRes.data ?? []) as {
      title: string;
      category: string;
      content: string;
    }[];

    const opportunity = oppRes.data as {
      name: string;
      category: string | null;
      funder_id: string | null;
    } | null;

    let funderName: string | null = null;
    if (opportunity?.funder_id) {
      const { data: funder } = await supabase
        .from("funders")
        .select("name")
        .eq("id", opportunity.funder_id)
        .eq("organization_id", organizationId)
        .maybeSingle();
      funderName = (funder as { name?: string } | null)?.name ?? null;
    }

    const demographicParts = [
      org?.target_population,
      org?.service_area,
    ].filter((v): v is string => Boolean(v));

    const orgProfile: OrgProfile = {
      name: org?.name ?? "Our organization",
      missionStatement: org?.mission_statement ?? null,
      serviceArea: org?.service_area ?? null,
      targetPopulation: org?.target_population ?? null,
      demographicDetail:
        demographicParts.length > 0 ? demographicParts.join(" in ") : null,
      programNames: kbEntries
        .filter((e) => e.category === "program_description")
        .map((e) => e.title),
      staffQualifications: kbEntries
        .filter((e) => e.category === "capacity")
        .map((e) => e.content),
      impactStats: kbEntries
        .filter((e) => e.category === "impact")
        .map((e) => e.content),
      threeYearProjection: null,
    };

    const opportunityContext: OpportunityContext = {
      name: opportunity?.name ?? "this opportunity",
      category: opportunity?.category ?? null,
      funderName,
    };

    const humanization = await humanizeNarrative(
      application.draft_content,
      orgProfile,
      opportunityContext,
    );

    const updatedMetadata = {
      ...(application.metadata ?? {}),
      humanization_score: humanization.humanizationScore,
      humanization_breakdown: humanization.scoreBreakdown,
      humanization_updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("applications")
      .update({
        draft_content: humanization.humanizedText,
        metadata: updatedMetadata,
      })
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          output_summary: `Re-humanized draft: removed ${humanization.aiTellsRemoved.length} AI tell(s); quality ${humanization.humanizationScore}/100.`,
          items_found: 1,
          items_processed: 1,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    return NextResponse.json({
      draftContent: humanization.humanizedText,
      humanizationScore: humanization.humanizationScore,
      scoreBreakdown: humanization.scoreBreakdown,
      aiTellsRemoved: humanization.aiTellsRemoved,
      wordCountBefore: humanization.wordCountBefore,
      wordCountAfter: humanization.wordCountAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Humanization failed.";
    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          error_message: message,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return jsonError(
      "The draft could not be humanized. Please try again.",
      "humanize_failed",
      500,
    );
  }
}
