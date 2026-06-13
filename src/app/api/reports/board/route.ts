import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import { callClaude, DEFAULT_MODEL, DEFAULT_MAX_TOKENS } from "@/lib/ai/claude";
import { runHumanizer } from "@/lib/agents/humanizer-agent";
import { aggregateBoardReportData } from "@/lib/reports/board-report";
import { generateBoardReportPDF } from "@/lib/reports/pdf-generator";
import type { AISections } from "@/lib/reports/pdf-generator";

export const runtime = "nodejs";

const STORAGE_BUCKET =
  process.env.STORAGE_REPORTS_BUCKET ?? "reports";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

const RATE_LIMIT = 5;
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

function defaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().split("T")[0]!,
    end: end.toISOString().split("T")[0]!,
  };
}

function buildClaudePrompt(
  data: import("@/lib/reports/board-report").BoardReportData,
): string {
  const { organization, executive, pipeline, recentSubmissions, recentAwards, agentActivity, financial, trend, dateRange } = data;

  const winRate =
    executive.awards + executive.denials > 0
      ? Math.round(
          (executive.awards / (executive.awards + executive.denials)) * 100,
        )
      : 0;

  const pipelineSummary = pipeline
    .map((p) => `  ${p.stage}: ${p.count}`)
    .join("\n");

  const submissionsSummary = recentSubmissions
    .slice(0, 5)
    .map(
      (s) =>
        `  - ${s.opportunityName} | $${(s.requestedAmount ?? 0).toLocaleString()} | ${s.stage} | ${s.submittedAt.split("T")[0]}`,
    )
    .join("\n");

  const awardsSummary = recentAwards
    .slice(0, 5)
    .map(
      (a) =>
        `  - ${a.opportunityName} | $${a.awardedAmount.toLocaleString()} | ${a.recordedAt.split("T")[0]}`,
    )
    .join("\n");

  const agentSummary = agentActivity
    .map((a) => `  ${a.agentType}: ${a.runs} runs, ${a.successRate}% success`)
    .join("\n");

  const financialSummary = financial
    .map(
      (f) =>
        `  ${f.category}: $${f.requested.toLocaleString()} requested / $${f.awarded.toLocaleString()} awarded`,
    )
    .join("\n");

  const trendNote = trend.currentPeriod.submitted > 0 || trend.priorPeriod.submitted > 0
    ? `Prior period: ${trend.priorPeriod.submitted} outcomes, $${trend.priorPeriod.awarded.toLocaleString()} awarded`
    : "No prior period data available.";

  return `You are an expert nonprofit consultant writing a professional board report. Generate concise, data-driven content for each section below. Return your response as valid JSON with exactly these keys: executiveSummary, pipelineStatus, submissionActivity, awardsAndFunding, agentPerformance, financialOverview, recommendations.

ORGANIZATION: ${organization.name}
REPORT PERIOD: ${dateRange.start} to ${dateRange.end}
${organization.mission ? `MISSION: ${organization.mission}` : ""}

KEY METRICS:
  Total Opportunities in System: ${executive.totalOpportunities}
  Applications Submitted This Period: ${executive.applicationsSubmitted}
  Awards: ${executive.awards}
  Denials: ${executive.denials}
  Win Rate: ${winRate}%
  Total Funding Requested: $${executive.totalRequested.toLocaleString()}
  Total Funding Awarded: $${executive.totalAwarded.toLocaleString()}

PIPELINE SNAPSHOT (applications by stage):
${pipelineSummary || "  No applications in pipeline."}

RECENT SUBMISSIONS:
${submissionsSummary || "  None in this period."}

RECENT AWARDS:
${awardsSummary || "  None in this period."}

AI AGENT ACTIVITY:
${agentSummary || "  No agent activity in this period."}

FINANCIAL BY CATEGORY:
${financialSummary || "  No financial data."}

TREND (${trendNote}):
  Current: ${trend.currentPeriod.submitted} submitted, $${trend.currentPeriod.awarded.toLocaleString()} awarded
  Prior: ${trend.priorPeriod.submitted} submitted, $${trend.priorPeriod.awarded.toLocaleString()} awarded

INSTRUCTIONS:
- executiveSummary: 2-3 paragraphs covering overall performance and key highlights. Be specific with numbers.
- pipelineStatus: 1-2 paragraphs analyzing the current pipeline health and stage distribution.
- submissionActivity: 1-2 paragraphs reviewing submission volume and quality this period.
- awardsAndFunding: 1-2 paragraphs on award outcomes, success rate, and funding secured.
- agentPerformance: 1-2 paragraphs on AI agent efficiency and automation impact.
- financialOverview: 1-2 paragraphs on funding requests vs. awards by category, trends.
- recommendations: 3-5 numbered, concrete, actionable recommendations based on the data.

Write in a professional, concise, board-ready tone. Use specific numbers. No bullet points in narratives (prose only). Recommendations may be numbered.

Return only valid JSON, no markdown fences.`;
}

function parseSections(raw: string): AISections {
  const fallback: AISections = {
    executiveSummary: raw,
    pipelineStatus: "",
    submissionActivity: "",
    awardsAndFunding: "",
    agentPerformance: "",
    financialOverview: "",
    recommendations: "",
  };

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      executiveSummary: String(parsed.executiveSummary ?? ""),
      pipelineStatus: String(parsed.pipelineStatus ?? ""),
      submissionActivity: String(parsed.submissionActivity ?? ""),
      awardsAndFunding: String(parsed.awardsAndFunding ?? ""),
      agentPerformance: String(parsed.agentPerformance ?? ""),
      financialOverview: String(parsed.financialOverview ?? ""),
      recommendations: String(parsed.recommendations ?? ""),
    };
  } catch {
    return fallback;
  }
}

function humanizeSections(sections: AISections, humanizedText: string): AISections {
  // Distribute the humanized text back to sections proportionally.
  // The humanizer rewrites the full concatenated content; we split on markers.
  const MARKERS: (keyof AISections)[] = [
    "executiveSummary",
    "pipelineStatus",
    "submissionActivity",
    "awardsAndFunding",
    "agentPerformance",
    "financialOverview",
    "recommendations",
  ];

  const delimiters = MARKERS.map((k) => `[[${k}]]`);
  let remaining = humanizedText;
  const result: Partial<AISections> = {};

  for (let i = 0; i < MARKERS.length; i++) {
    const key = MARKERS[i]!;
    const nextDelimiter = i + 1 < MARKERS.length ? delimiters[i + 1]! : null;

    // Strip the leading delimiter for this section
    const startMarker = delimiters[i]!;
    const markerIdx = remaining.indexOf(startMarker);
    if (markerIdx !== -1) {
      remaining = remaining.slice(markerIdx + startMarker.length).trimStart();
    }

    if (nextDelimiter) {
      const endIdx = remaining.indexOf(nextDelimiter);
      if (endIdx !== -1) {
        result[key] = remaining.slice(0, endIdx).trim();
        remaining = remaining.slice(endIdx);
      } else {
        result[key] = sections[key]; // fallback to original if marker missing
      }
    } else {
      result[key] = remaining.trim() || sections[key];
    }
  }

  return {
    executiveSummary: result.executiveSummary ?? sections.executiveSummary,
    pipelineStatus: result.pipelineStatus ?? sections.pipelineStatus,
    submissionActivity: result.submissionActivity ?? sections.submissionActivity,
    awardsAndFunding: result.awardsAndFunding ?? sections.awardsAndFunding,
    agentPerformance: result.agentPerformance ?? sections.agentPerformance,
    financialOverview: result.financialOverview ?? sections.financialOverview,
    recommendations: result.recommendations ?? sections.recommendations,
  };
}

function buildHumanizerInput(sections: AISections): string {
  const MARKERS: (keyof AISections)[] = [
    "executiveSummary",
    "pipelineStatus",
    "submissionActivity",
    "awardsAndFunding",
    "agentPerformance",
    "financialOverview",
    "recommendations",
  ];
  return MARKERS.map((k) => `[[${k}]]\n${sections[k]}`).join("\n\n");
}

export async function POST(request: Request) {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const { start_date, end_date } = (body ?? {}) as {
    start_date?: unknown;
    end_date?: unknown;
  };

  const defaults = defaultDateRange();
  const startDate =
    typeof start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(start_date)
      ? start_date
      : defaults.start;
  const endDate =
    typeof end_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(end_date)
      ? end_date
      : defaults.end;

  if (startDate > endDate) {
    return jsonError("start_date must be before end_date.", "invalid_range", 400);
  }

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profile.organization_id as string;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Report generation rate limit reached. Please wait a minute.",
      "rate_limited",
      429,
    );
  }

  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
  if (overLimit) return overLimit;

  // Resolve model + token config
  const { data: configRows } = await supabase
    .from("platform_config")
    .select("key, value")
    .in("key", ["ai.model", "ai.max_tokens"]);
  const config = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const model = config.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

  const startedAt = Date.now();
  let runId: string | null = null;

  // Log agent run
  const { data: runRow } = await supabase
    .from("agent_runs")
    .insert({
      organization_id: organizationId,
      agent_type: "narrative_drafting",
      status: "running",
      triggered_by: profile.id,
      input_params: { type: "board_report", startDate, endDate },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  runId = runRow?.id ?? null;

  try {
    // Step 1: Aggregate data
    const reportData = await aggregateBoardReportData(
      supabase,
      organizationId,
      startDate,
      endDate,
    );

    // Step 2: Generate report content via Claude
    const claudeRes = await callClaude({
      prompt: buildClaudePrompt(reportData),
      model,
      maxTokens,
      temperature: 0.3,
    });

    const rawSections = parseSections(claudeRes.text);

    // Step 3: Fetch org context for humanizer
    const { data: orgRow } = await supabase
      .from("organizations")
      .select(
        "name, dba, ein, tax_status, mission_statement, vision_statement, service_area, target_population, founder_name, annual_budget",
      )
      .eq("id", organizationId)
      .single();

    const orgContext = orgRow
      ? {
          name: orgRow.name as string,
          dba: (orgRow.dba as string | null) ?? null,
          ein: (orgRow.ein as string | null) ?? null,
          taxStatus: (orgRow.tax_status as string | null) ?? null,
          missionStatement: (orgRow.mission_statement as string | null) ?? null,
          visionStatement: (orgRow.vision_statement as string | null) ?? null,
          serviceArea: (orgRow.service_area as string | null) ?? null,
          targetPopulation: (orgRow.target_population as string | null) ?? null,
          founderName: (orgRow.founder_name as string | null) ?? null,
          annualBudget: (orgRow.annual_budget as number | null) ?? null,
        }
      : null;

    // Step 4: Humanize report content
    const draftForHumanizer = buildHumanizerInput(rawSections);
    const humanizeResult = await runHumanizer({
      draft: draftForHumanizer,
      templateType: "grant_narrative",
      organization: orgContext,
      knowledgeEntries: [],
      provenNarratives: [],
      model,
      maxTokens,
    });

    const finalSections = humanizeSections(rawSections, humanizeResult.content);
    const totalTokens =
      claudeRes.usage.totalTokens + humanizeResult.tokensUsed;

    // Step 5: Generate PDF
    const generatedAt = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const pdfBuffer = await generateBoardReportPDF(
      reportData,
      finalSections,
      generatedAt,
    );

    // Step 6: Upload PDF to Supabase Storage
    const timestamp = Date.now();
    const storagePath = `${organizationId}/reports/board_${timestamp}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // Step 7: Create signed URL (valid 1 hour)
    const { data: signed, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, 3600);

    if (signError || !signed?.signedUrl) {
      throw new Error("Failed to generate download URL.");
    }

    // Mark agent run complete
    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          output_summary: `Board report generated for ${startDate}-${endDate}. PDF: ${storagePath}`,
          items_processed: 1,
          tokens_used: totalTokens,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    await trackUsage(supabase, organizationId, "api_calls", 2);

    return NextResponse.json({
      downloadUrl: signed.signedUrl,
      storagePath,
      dateRange: { start: startDate, end: endDate },
      generatedAt,
      stats: {
        tokensUsed: totalTokens,
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (err) {
    console.error("BOARD_REPORT ERROR:", err);
    const message = err instanceof Error ? err.message : "Report generation failed.";

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
      "Board report could not be generated. Please try again.",
      "report_failed",
      500,
    );
  }
}
