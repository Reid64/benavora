"use client";

// Organizational Digital Twin profile (PLATFORM_VISION_ARCHITECTURE.md Pillar 6,
// AGENTS_v2.md AG-16/AG-29). Reads the 10-section diagnostic report from
// GET /api/intelligence/twin/completeness (twin-completeness.ts's
// calculateTwinCompleteness()) and lets the user trigger autonomous gap-filling
// via POST /api/intelligence/twin/auto-populate (twin-auto-populate.ts's
// autoPopulateTwin()).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingSpinner } from "@/components/ui";
import type {
  TwinCompletenessReport,
  TwinSectionReport,
} from "@/lib/intelligence/twin-completeness";

// Intelligence & Reports section treatment — PAGE_TREATMENT_PROTOCOL_V2.md /
// DESIGN_SYSTEM_V2_ASSIGNMENT.md. Frame: Plum. Secondary accent: Slate
// Blue. 2026-08-18: confirmed via live getComputedStyle audit this page
// never received the v2 rollout - same real gap as AutoApply's. scoreColor
// below is real semantic (completeness thresholds), untouched.
const SECTION_FRAME = "#7A5980";
const CANVAS = "#F0EBE0";
const HEADER_CARD_BG = "#F8F5EE";
const HEADER_BORDER = "rgba(44,78,59,0.15)";
const SECTION_CARD_BG = "#F8F5EE";
const SECTION_BAR_TRACK = "rgba(44,78,59,0.1)";
const TEXT_MUTED = "#64748B";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const RED = "#DC2626";

function scoreColor(score: number): string {
  if (score >= 80) return GREEN;
  if (score >= 60) return AMBER;
  return RED;
}

const SECTION_LABELS: Record<string, string> = {
  mission_and_vision: "Mission & Vision",
  programs_and_services: "Programs & Services",
  financial_profile: "Financial Profile",
  leadership_and_board: "Leadership & Board",
  geographic_service_area: "Geographic Service Area",
  target_population: "Target Population",
  impact_and_outcomes: "Impact & Outcomes",
  organizational_history: "Organizational History",
  partnerships_and_coalitions: "Partnerships & Coalitions",
  compliance_and_certifications: "Compliance & Certifications",
};

// Mirrors computeBlockingAgents() in twin-completeness.ts -- that function
// only ever emits these 7 agent ids, each tied to exactly one of 4 gap
// conditions, so a static reason lookup is accurate as long as that function
// doesn't change. Re-check against the source if this ever drifts.
const BLOCKING_AGENT_INFO: Record<string, { name: string; reason: string }> = {
  "draft-generation": {
    name: "Draft Generation Agent",
    reason: "Mission statement is under 50 words",
  },
  "fundability-scorer": {
    name: "Fundability Scorer Agent",
    reason: "Mission statement is under 50 words",
  },
  "simulation-agent": {
    name: "Simulation Agent",
    reason: "Financial profile is empty",
  },
  "probability-scorer": {
    name: "Probability Scorer Agent",
    reason: "Financial profile is empty",
  },
  "relationship-builder": {
    name: "Relationship Builder Agent",
    reason: "No board members on record",
  },
  "community-need-predictor": {
    name: "Community Need Predictor Agent",
    reason: "No service areas defined",
  },
  "opportunity-discovery": {
    name: "Opportunity Discovery Agent",
    reason: "No service areas defined",
  },
};

function humanizeField(field: string): string {
  return field
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function CompletenessCircle({ score }: { score: number }) {
  const color = scoreColor(score);
  const size = 160;
  const ringOffset = 14;
  const outerSize = size + ringOffset * 2;

  return (
    <div
      className="relative shrink-0"
      style={{ width: outerSize, height: outerSize }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: `2px dashed ${color}`,
          opacity: 0.45,
          animation: "twin-ring-spin 14s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: ringOffset,
          left: ringOffset,
          width: size,
          height: size,
          borderRadius: "50%",
          border: `6px solid ${color}`,
          backgroundColor: "#2C4E3B",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: "48px",
            fontWeight: 700,
            color: "#FFFFFF",
            lineHeight: 1,
          }}
        >
          {score}
        </span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: TEXT_MUTED,
            marginTop: "8px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Twin Completeness
        </span>
      </div>
      <style>{`
        @keyframes twin-ring-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function SectionGridCard({
  section,
  expanded,
  onToggle,
}: {
  section: TwinSectionReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = scoreColor(section.score);
  const label = SECTION_LABELS[section.name] ?? humanizeField(section.name);

  return (
    <div style={{ backgroundColor: SECTION_FRAME, borderRadius: "14px", boxShadow: "0 4px 16px rgba(122,89,128,0.2)", padding: "3px" }}>
    <div
      style={{
        backgroundColor: SECTION_CARD_BG,
        borderRadius: "11px",
        padding: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "#2C4E3B",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </span>
          {section.score === 100 && (
            <CheckCircle2
              className="h-4 w-4 shrink-0"
              style={{ color: GREEN }}
              aria-hidden
            />
          )}
        </div>
        <span style={{ fontSize: "14px", fontWeight: 700, color, flexShrink: 0 }}>
          {section.score}%
        </span>
      </div>

      <div
        style={{
          marginTop: "10px",
          width: "100%",
          height: "6px",
          borderRadius: "3px",
          backgroundColor: SECTION_BAR_TRACK,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${section.score}%`,
            height: "100%",
            borderRadius: "3px",
            backgroundColor: color,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {section.score < 80 && section.missing_fields.length > 0 && (
        <ul style={{ margin: "10px 0 0 0", paddingLeft: "16px" }}>
          {section.missing_fields.map((field) => (
            <li
              key={field}
              style={{ fontSize: "11px", color: AMBER, marginTop: "3px" }}
            >
              {humanizeField(field)}
            </li>
          ))}
        </ul>
      )}

      {section.recommendations.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <button
            type="button"
            onClick={onToggle}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 600,
              color: TEXT_MUTED,
            }}
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden />
            )}
            Recommendations ({section.recommendations.length})
          </button>
          {expanded && (
            <ul style={{ margin: "8px 0 0 0", paddingLeft: "16px" }}>
              {section.recommendations.map((rec, idx) => (
                <li
                  key={idx}
                  style={{
                    fontSize: "12px",
                    color: "#475569",
                    marginTop: "5px",
                    lineHeight: 1.45,
                  }}
                >
                  {rec}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
    </div>
  );
}

export default function DigitalTwinPage() {
  const [orgName, setOrgName] = useState<string | null>(null);
  const [report, setReport] = useState<TwinCompletenessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [populating, setPopulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/intelligence/twin/completeness");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ??
            "Could not load the digital twin.",
        );
        return;
      }
      setOrgName((payload as { orgName?: string }).orgName ?? null);
      setReport((payload as { report: TwinCompletenessReport }).report);
    } catch {
      setError("Could not reach the digital twin service.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await load();
      if (!active) return;
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  async function handleAutoPopulate() {
    setPopulating(true);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/twin/auto-populate", {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ??
            "Auto-populate failed. Please try again.",
        );
      } else {
        await load();
      }
    } catch {
      setError("Could not reach the digital twin service.");
    }
    setPopulating(false);
  }

  function toggleSection(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  return (
    <div className="min-h-screen space-y-6 p-6" style={{ backgroundColor: CANVAS }}>
      <PageHeader
        title="Organization Profile"
        description={
          orgName
            ? `A structured, continuously learning profile of ${orgName} the AI reads before drafting any proposal.`
            : "A structured, continuously learning profile of your organization the AI reads before drafting any proposal."
        }
      />

      {error && (
        <div
          role="alert"
          style={{
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "14px",
            border: "1px solid #FECACA",
            backgroundColor: "#FEF2F2",
            color: "#B91C1C",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading digital twin..." />
      ) : !report ? (
        <div
          style={{
            borderRadius: "12px",
            padding: "40px",
            textAlign: "center",
            backgroundColor: HEADER_CARD_BG,
            border: `1px solid ${HEADER_BORDER}`,
          }}
        >
          <Sparkles className="mx-auto h-8 w-8" style={{ color: SECTION_FRAME }} aria-hidden />
          <p style={{ marginTop: "12px", fontSize: "14px", color: "#64748B" }}>
            No digital twin data yet. Auto-populate to get started.
          </p>
        </div>
      ) : (
        <>
          {/* Header: circle + actions + revenue impact */}
          <div style={{ backgroundColor: SECTION_FRAME, borderRadius: "15px", boxShadow: "0 4px 20px rgba(122,89,128,0.22)", padding: "4px" }}>
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: HEADER_CARD_BG,
              borderRadius: "12px",
            }}
          >
            <div className="flex flex-wrap items-center gap-8">
              <CompletenessCircle score={report.overall_score} />

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => void handleAutoPopulate()}
                  disabled={populating}
                  style={{
                    backgroundColor: SECTION_FRAME,
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "10px",
                    padding: "12px 22px",
                    fontSize: "14px",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    cursor: populating ? "not-allowed" : "pointer",
                    opacity: populating ? 0.7 : 1,
                  }}
                >
                  {populating ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden />
                  )}
                  Auto-Populate Twin
                </button>

                <Link
                  href="/settings/organization-setup"
                  style={{
                    backgroundColor: "#4F6D8F",
                    color: "#FFFFFF",
                    borderRadius: "10px",
                    padding: "12px 22px",
                    fontSize: "14px",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    textDecoration: "none",
                  }}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Update Twin
                </Link>
              </div>
            </div>

            {report.overall_score < 80 && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  marginTop: "20px",
                  backgroundColor: "#FEF3C7",
                  border: "1px solid #FDE68A",
                  borderRadius: "12px",
                  padding: "16px",
                }}
              >
                <AlertTriangle
                  className="h-5 w-5 shrink-0"
                  style={{ color: "#B45309" }}
                  aria-hidden
                />
                <p style={{ fontSize: "13px", color: "#92400E", margin: 0, lineHeight: 1.5 }}>
                  <strong>
                    Incomplete Twin is estimated to cost{" "}
                    {formatCurrency(report.estimated_revenue_impact)}/month in
                    reduced grant probability.
                  </strong>{" "}
                  Complete your profile to maximize AI performance.
                </p>
              </div>
            )}
          </div>
          </div>

          {/* Section grid: 2 columns x 5 rows */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "16px",
            }}
          >
            {report.sections.map((section) => (
              <SectionGridCard
                key={section.name}
                section={section}
                expanded={expanded.has(section.name)}
                onToggle={() => toggleSection(section.name)}
              />
            ))}
          </div>

          {/* Blocking agents */}
          {report.blocking_agents.length > 0 && (
            <div
              style={{
                backgroundColor: HEADER_CARD_BG,
                border: `1px solid ${HEADER_BORDER}`,
                borderRadius: "12px",
                padding: "20px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                <Bot className="h-5 w-5" style={{ color: RED }} aria-hidden />
                <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", margin: 0 }}>
                  Blocking Agents
                </h3>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {report.blocking_agents.map((agentId) => {
                  const info = BLOCKING_AGENT_INFO[agentId] ?? {
                    name: humanizeField(agentId),
                    reason: "Organization profile data incomplete.",
                  };
                  return (
                    <div
                      key={agentId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        backgroundColor: SECTION_CARD_BG,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                        <AlertTriangle
                          className="h-4 w-4 shrink-0"
                          style={{ color: RED }}
                          aria-hidden
                        />
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: "13px", fontWeight: 600, color: "#2C4E3B", margin: 0 }}>
                            {info.name}
                          </p>
                          <p style={{ fontSize: "11px", color: AMBER, margin: "2px 0 0 0" }}>
                            Blocked by: {info.reason}
                          </p>
                        </div>
                      </div>
                      <Link
                        href="/settings/organization-setup"
                        style={{
                          flexShrink: 0,
                          backgroundColor: "#7A5980",
                          color: "#FFFFFF",
                          fontSize: "12px",
                          fontWeight: 600,
                          padding: "8px 14px",
                          borderRadius: "8px",
                          textDecoration: "none",
                        }}
                      >
                        Fix Now
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
