import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { addDays, differenceInCalendarDays, format } from "date-fns";

import { FlightPathHUD } from "@/components/dashboard/FlightPathHUD";
import {
  DeadlineWidget,
  type DeadlineWidgetItem,
} from "@/components/dashboard/DeadlineWidget";
import { PipelineSummary } from "@/components/dashboard/PipelineSummary";
import type { PipelineStage } from "@/components/applications/pipeline";
import { createClient } from "@/lib/supabase/server";
import {
  analyzeOutcomes,
  type OutcomeInput,
} from "@/lib/ai/learning/outcome-analyzer";
import { PIPELINE_STAGES } from "@/lib/utils/constants";
import { formatCurrency } from "@/lib/utils/formatters";

// Dashboard reflects live session-scoped data; never cache (CLAUDE.md).
export const dynamic = "force-dynamic";

type ApplicationRow = {
  id: string;
  stage: PipelineStage;
  requested_amount: number | null;
  submitted_at: string | null;
  draft_content: string | null;
};

type DeadlineRow = {
  id: string;
  title: string;
  deadline_type: string;
  due_date: string;
  application_id: string | null;
  opportunity_id: string | null;
};

/** Returns "-" instead of "0" so empty metrics don't imply active tracking. */
function metricCount(n: number): string {
  return n === 0 ? "-" : String(n);
}

function metricCurrency(n: number): string {
  return n === 0 ? "-" : formatCurrency(n);
}

/**
 * Main dashboard (BLUEPRINT §4.1). All data is read server-side via the
 * session-bound Supabase client; organization_id derived from the authenticated
 * user's profile (never from a request body), with RLS as the second barrier.
 */
export default async function DashboardPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.organization_id) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        We couldn&rsquo;t resolve your organization. Please sign in again.
      </div>
    );
  }

  const orgId = profile.organization_id;
  const now = new Date();
  const horizon = format(addDays(now, 7), "yyyy-MM-dd");

  const [oppCountRes, applicationsRes, deadlinesRes, outcomesRes] =
    await Promise.all([
      supabase
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId),
      supabase
        .from("applications")
        .select("id, stage, requested_amount, submitted_at, draft_content")
        .eq("organization_id", orgId),
      supabase
        .from("deadlines")
        .select(
          "id, title, deadline_type, due_date, application_id, opportunity_id",
        )
        .eq("organization_id", orgId)
        .or("is_completed.is.null,is_completed.eq.false")
        .lte("due_date", horizon)
        .order("due_date", { ascending: true }),
      supabase
        .from("outcomes")
        .select(
          "result, awarded_amount, requested_amount, funder_category, opportunity_category, denial_reason, recorded_at",
        )
        .eq("organization_id", orgId),
    ]);

  const totalOpportunities = oppCountRes.count ?? 0;
  const applications = (applicationsRes.data ?? []) as ApplicationRow[];
  const deadlines = (deadlinesRes.data ?? []) as DeadlineRow[];
  const outcomes = (outcomesRes.data ?? []) as OutcomeInput[];

  // --- metrics ---------------------------------------------------------------
  const submittedCount = applications.filter(
    (a) => a.submitted_at !== null,
  ).length;
  const draftsGenerated = applications.filter(
    (a) => a.draft_content !== null && a.draft_content.trim().length > 0,
  ).length;
  const totalRequested = applications.reduce(
    (sum, a) => sum + (a.requested_amount ?? 0),
    0,
  );
  const deadlinesThisWeek = deadlines.filter((d) => {
    const days = differenceInCalendarDays(new Date(d.due_date), now);
    return days >= 0 && days <= 7;
  }).length;

  const analysis = analyzeOutcomes(outcomes);
  const { summary } = analysis;
  const successRateValue =
    summary.successRate != null ? `${summary.successRate}%` : "-";

  // --- pipeline counts -------------------------------------------------------
  const pipelineCounts = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = 0;
      return acc;
    },
    {} as Record<PipelineStage, number>,
  );
  for (const app of applications) {
    if (app.stage in pipelineCounts) {
      pipelineCounts[app.stage] += 1;
    }
  }

  // --- widget data -----------------------------------------------------------
  const deadlineItems: DeadlineWidgetItem[] = deadlines
    .slice(0, 5)
    .map((d) => ({
      id: d.id,
      title: d.title,
      deadlineType: d.deadline_type,
      dueDate: d.due_date,
      href: d.application_id
        ? `/applications/${d.application_id}`
        : d.opportunity_id
          ? `/opportunities/${d.opportunity_id}`
          : "/deadlines",
    }));

  const hasNoData =
    totalOpportunities === 0 &&
    applications.length === 0 &&
    deadlines.length === 0 &&
    outcomes.length === 0;

  const heroChips = [
    { label: "Active Apps", value: metricCount(applications.length) },
    { label: "Submitted", value: metricCount(submittedCount) },
    { label: "Drafts", value: metricCount(draftsGenerated) },
    { label: "Deadlines", value: metricCount(deadlinesThisWeek) },
  ];

  const actionItems = [
    { dot: "#EF4444", text: "Parsed emails awaiting review", count: "-", href: "/emails" },
    { dot: "#F59E0B", text: "New opportunities discovered", count: metricCount(totalOpportunities), href: "/opportunities" },
    { dot: "#6B48CC", text: "Drafts needing attention", count: metricCount(draftsGenerated), href: "/draft-generator" },
    { dot: "#0077B6", text: "Deadlines approaching", count: metricCount(deadlinesThisWeek), href: "/deadlines" },
    { dot: "#0096C7", text: "Applications missing documents", count: "-", href: "/applications" },
    { dot: "#10B981", text: "AutoApply gates awaiting approval", count: "-", href: "/admin/autoapply-ops" },
    { dot: "#1A2B3C", text: "Research runs completed", count: metricCount(submittedCount), href: "/research" },
  ];

  const fundingSummaryRows = [
    { label: "Total Requested", value: metricCurrency(totalRequested) },
    { label: "Total Awarded", value: metricCurrency(summary.totalAwarded) },
    { label: "Success Rate", value: successRateValue },
  ];

  const sectionHeaderStyle = {
    fontSize: "13px",
    fontWeight: 700,
    color: "#0F172A",
    marginBottom: "16px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  };

  const trayStyle = {
    backgroundColor: "#B8C4CC",
    borderRadius: "16px",
    padding: "16px",
    boxShadow: "inset 0 2px 8px rgba(0,0,0,0.10)",
  };

  return (
    <div style={{ backgroundColor: "#C8D4DC", minHeight: "100vh", padding: "32px" }}>
      {/* Hero banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #1A2B3C 0%, #0077B6 100%)",
          borderRadius: "20px",
          padding: "0",
          marginBottom: "20px",
          display: "flex",
          alignItems: "stretch",
          overflow: "hidden",
          height: "200px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
          position: "relative",
        }}
      >
        <div style={{ width: "260px", flexShrink: 0, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 0 16px" }}>
          <Image
            src="/hero-illustration.png"
            alt="Funding manager"
            width={240}
            height={190}
            style={{ objectFit: "contain", objectPosition: "bottom center" }}
          />
        </div>
        <div style={{ flex: 1, padding: "32px 40px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.02em", margin: "0 0 4px 0" }}>
            Your Task Management Area
          </h1>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", margin: "0 0 20px 0" }}>
            Faith Foundation &middot; {format(now, "MMMM d, yyyy")}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", maxWidth: "360px" }}>
            {heroChips.map((chip) => (
              <div
                key={chip.label}
                style={{
                  backgroundColor: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  {chip.label}
                </div>
                <div style={{ fontSize: "20px", fontWeight: 900, color: "#FFFFFF", lineHeight: 1, marginTop: "2px" }}>
                  {chip.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {hasNoData && (
        <div
          style={{
            backgroundColor: "#F0FDFA",
            border: "1px solid #99F6E4",
            borderRadius: "12px",
            padding: "16px 20px",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#134E4A", margin: 0 }}>
            Welcome to Benavora
          </h2>
          <p style={{ fontSize: "14px", color: "#0F766E", marginTop: "4px" }}>
            You don&rsquo;t have any data yet. Start by adding a funding
            opportunity or completing your organization profile in the Knowledge
            Base &mdash; the metrics and charts below fill in as you work.
          </p>
        </div>
      )}

      {/* Mission Control lifecycle HUD */}
      <FlightPathHUD />

      {/* Three column grid: action items | pipeline | upcoming deadlines */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        {/* Today's Action Items */}
        <div style={trayStyle}>
          <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", overflow: "hidden", padding: "20px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "#FFFFFF",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                backgroundColor: "#6B48CC",
                padding: "14px 20px",
                margin: "0",
              }}
            >
              Today&rsquo;s Action Items
            </div>
            {actionItems.map((item) => (
              <Link key={item.text} href={item.href} style={{ textDecoration: "none", display: "block" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 0",
                    borderBottom: "1px solid #F1F5F9",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, backgroundColor: item.dot }} />
                  <div style={{ flex: 1, fontSize: "13px", color: "#334155" }}>{item.text}</div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      backgroundColor: item.dot,
                      borderRadius: "999px",
                      padding: "2px 8px",
                    }}
                  >
                    {item.count}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Pipeline (compact) */}
        <div style={trayStyle}>
          <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
            <div style={sectionHeaderStyle}>Pipeline</div>
            <PipelineSummary counts={pipelineCounts} />
          </div>
        </div>

        {/* Upcoming deadlines */}
        <div
          style={{
            backgroundColor: "#1A2B3C",
            borderRadius: "16px",
            padding: "0",
            overflow: "hidden",
            boxShadow: "0 4px 16px rgba(26,43,60,0.2)",
          }}
        >
          <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex items-center justify-between">
              <h2
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "#FFFFFF",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Upcoming Deadlines
              </h2>
              <Link
                href="/deadlines"
                className="text-xs font-medium"
                style={{ color: "#FFFFFF" }}
              >
                View all
              </Link>
            </div>
          </div>
          <div style={{ padding: "8px 0" }}>
            <DeadlineWidget items={deadlineItems} dark />
          </div>
        </div>
      </div>

      {/* Bottom two column grid: quick actions | funding summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Quick actions */}
        <div
          style={{
            backgroundColor: "#0077B6",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 4px 16px rgba(0,119,182,0.3)",
          }}
        >
          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF", marginBottom: "16px" }}>
            Quick Actions
          </h3>
          <div>
            <Link
              href="/research"
              style={{
                display: "block",
                width: "100%",
                padding: "12px 16px",
                backgroundColor: "rgba(255,255,255,0.15)",
                borderRadius: "8px",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 600,
                marginBottom: "8px",
                border: "1px solid rgba(255,255,255,0.2)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Run Research
            </Link>
            <Link
              href="/draft-generator"
              style={{
                display: "block",
                width: "100%",
                padding: "12px 16px",
                backgroundColor: "rgba(255,255,255,0.15)",
                borderRadius: "8px",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 600,
                marginBottom: "8px",
                border: "1px solid rgba(255,255,255,0.2)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Generate Drafts
            </Link>
            <Link
              href="/draft-generator/queue"
              style={{
                display: "block",
                width: "100%",
                padding: "12px 16px",
                backgroundColor: "rgba(255,255,255,0.15)",
                borderRadius: "8px",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 600,
                marginBottom: "8px",
                border: "1px solid rgba(255,255,255,0.2)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Review Queue
            </Link>
          </div>
        </div>

        {/* Funding Summary (compact) */}
        <div style={trayStyle}>
          <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "20px" }}>
            <div style={sectionHeaderStyle}>Funding Summary</div>
            {fundingSummaryRows.map((row) => (
              <div key={row.label}>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#64748B",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {row.label}
                </div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#0F172A", marginTop: "2px", marginBottom: "12px" }}>
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// redeploy 07/16/2026 18:25:17
