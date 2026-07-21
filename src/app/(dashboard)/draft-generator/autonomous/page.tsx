import Link from "next/link";
import { redirect } from "next/navigation";

import { DismissDraftButton } from "@/components/draft-generator/DismissDraftButton";
import { DraftQualityPanel } from "@/components/draft-generator/DraftQualityPanel";
import { createClient } from "@/lib/supabase/server";
import { formatRelative } from "@/lib/utils/formatters";

// Reflects live pending-review state; never cache (CLAUDE.md).
export const dynamic = "force-dynamic";

type ApplicationRow = {
  id: string;
  draft_content: string | null;
  draft_confidence_score: number | null;
  created_at: string;
  opportunity_id: string;
  twin_powered: boolean | null;
  twin_completeness: number | null;
  metadata: Record<string, unknown> | null;
};

type OpportunityRow = {
  id: string;
  name: string;
  funder_id: string | null;
};

// opportunity_probability_scores (migration 093) has no generated type yet
// (see grant-probability-engine.ts — same table, same gap) and is keyed by
// (opportunity_id, organization_id), not a direct FK from applications, so
// it's fetched separately and merged here rather than embedded.
type ProbabilityScoreRow = {
  opportunity_id: string;
  overall_score: number | null;
};

function scoreColor(score: number | null): string {
  if (score == null) return "#6B7280";
  if (score >= 70) return "#10B981";
  if (score >= 50) return "#F59E0B";
  return "#EF4444";
}

function ScoreBadge({ label, score }: { label: string; score: number | null }) {
  return (
    <span
      style={{
        fontSize: "11px",
        fontWeight: 700,
        color: "#FFFFFF",
        backgroundColor: scoreColor(score),
        borderRadius: "999px",
        padding: "3px 10px",
      }}
    >
      {label}: {score != null ? `${score}%` : "-"}
    </span>
  );
}

export default async function AutonomousDraftReviewPage() {
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

  const { data: applicationsData } = await supabase
    .from("applications")
    .select(
      "id, draft_content, draft_confidence_score, created_at, opportunity_id, twin_powered, twin_completeness, metadata",
    )
    .eq("organization_id", orgId)
    .eq("auto_generated", true)
    .eq("pending_review", true)
    .order("created_at", { ascending: false });

  const applications = (applicationsData ?? []) as ApplicationRow[];
  const opportunityIds = Array.from(
    new Set(applications.map((a) => a.opportunity_id).filter(Boolean)),
  );

  const [opportunitiesRes, scoresRes] = await Promise.all([
    opportunityIds.length > 0
      ? supabase
          .from("opportunities")
          .select("id, name, funder_id")
          .in("id", opportunityIds)
      : Promise.resolve({ data: [] as OpportunityRow[] }),
    opportunityIds.length > 0
      ? supabase
          .from("opportunity_probability_scores")
          .select("opportunity_id, overall_score")
          .eq("organization_id", orgId)
          .in("opportunity_id", opportunityIds)
      : Promise.resolve({ data: [] as ProbabilityScoreRow[] }),
  ]);

  const opportunitiesById = new Map(
    ((opportunitiesRes.data ?? []) as OpportunityRow[]).map((o) => [o.id, o]),
  );
  const scoreByOpportunityId = new Map(
    ((scoresRes.data ?? []) as ProbabilityScoreRow[]).map((s) => [
      s.opportunity_id,
      s.overall_score,
    ]),
  );

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#1A2B3C", margin: 0 }}>
          AI-Generated Drafts Awaiting Review
        </h1>
        <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "6px" }}>
          These grant applications were automatically created by your AI
          pipeline. Review each draft before it enters your active pipeline.
        </p>
      </div>

      {applications.length === 0 ? (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#1A2B3C", margin: 0 }}>
            No autonomous drafts pending review.
          </p>
          <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "8px" }}>
            Your AI pipeline will generate drafts overnight for high-probability
            opportunities once you enable agents in{" "}
            <Link href="/settings/agents" style={{ color: "#0077B6", fontWeight: 600 }}>
              Settings
            </Link>
            .
          </p>
        </div>
      ) : (
        applications.map((app) => {
          const opportunity = opportunitiesById.get(app.opportunity_id);
          const probabilityScore = scoreByOpportunityId.get(app.opportunity_id) ?? null;
          const preview = (app.draft_content ?? "").slice(0, 300);

          return (
            <div
              key={app.id}
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                padding: "24px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <span style={{ fontSize: "16px", fontWeight: 700, color: "#1A2B3C" }}>
                    {opportunity?.name ?? "Unknown opportunity"}
                  </span>
                  {app.twin_powered && (
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        color: "#FFFFFF",
                        backgroundColor: "#6B48CC",
                        borderRadius: "999px",
                        padding: "3px 10px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Twin-Powered
                    </span>
                  )}
                </div>
                <ScoreBadge label="Probability" score={probabilityScore} />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginTop: "8px",
                }}
              >
                <span style={{ fontSize: "12px", color: "#6B7280" }}>
                  Auto-generated {formatRelative(app.created_at)} by Benavora AI
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {app.twin_completeness != null && (
                    <ScoreBadge label="Twin" score={app.twin_completeness} />
                  )}
                  <ScoreBadge label="Confidence" score={app.draft_confidence_score} />
                </div>
              </div>

              {app.twin_completeness != null && app.twin_completeness < 60 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    backgroundColor: "#FEF3C7",
                    border: "1px solid #FDE68A",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    marginTop: "10px",
                  }}
                >
                  <span style={{ fontSize: "12px", color: "#92400E", lineHeight: 1.5 }}>
                    Draft generated with incomplete twin data — review carefully.
                  </span>
                </div>
              )}

              <div
                style={{
                  fontSize: "14px",
                  color: "#374151",
                  fontStyle: "italic",
                  backgroundColor: "#F9FAFB",
                  padding: "12px",
                  borderRadius: "8px",
                  marginTop: "12px",
                }}
              >
                {preview || "No draft content available."}
              </div>

              <DraftQualityPanel
                applicationId={app.id}
                initialDraftContent={app.draft_content ?? ""}
                initialMetadata={app.metadata}
              />

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginTop: "16px",
                }}
              >
                <Link
                  href={`/draft-generator/${app.id}`}
                  style={{
                    backgroundColor: "#1A2B3C",
                    color: "#FFFFFF",
                    fontSize: "13px",
                    fontWeight: 600,
                    borderRadius: "8px",
                    padding: "8px 16px",
                    textDecoration: "none",
                  }}
                >
                  Review &amp; Edit
                </Link>
                <DismissDraftButton applicationId={app.id} />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
