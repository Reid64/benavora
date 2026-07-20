"use client";

// Organizational Digital Twin profile (PLATFORM_VISION_ARCHITECTURE.md Pillar 6,
// AGENTS_v2.md AG-16). Reads the deterministic twin built by
// buildDigitalTwin() via GET /api/intelligence/digital-twin and lets the user
// trigger a fresh rebuild via the same endpoint's POST handler.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Award,
  Banknote,
  BookText,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge, EmptyState, LoadingSpinner } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/layout/PageHeader";
import { createClient } from "@/lib/supabase/client";

interface DigitalTwinProgram {
  title: string;
  description: string;
}

interface DigitalTwinBoardMember {
  name: string;
  title: string | null;
  bio: string | null;
  email: string | null;
}

interface DigitalTwin {
  organization_id: string;
  mission: string | null;
  service_areas: string[];
  programs: DigitalTwinProgram[];
  financial_profile: Record<string, number>;
  board_composition: DigitalTwinBoardMember[];
  proven_narrative_patterns: string[];
  key_strengths: string[];
  twin_completeness_score: number;
  last_rebuilt_at: string;
  stats: {
    outcomes_count: number;
    kb_entries_count: number;
    applications_count: number;
    applications_by_stage: Record<string, number>;
    most_applied_categories: { category: string; count: number }[];
  };
}

interface ChecklistItem {
  label: string;
  met: boolean;
  tip: string;
}

const FINANCIAL_LABELS: Record<string, string> = {
  annual_budget: "Annual Budget",
  total_staff: "Total Staff",
  total_volunteers: "Total Volunteers",
};

const CANVAS = "#D6E4F0";
const CARD_BG = "#FFFFFF";
const BORDER = "#C3D3E2";
const DIVIDER = "#E2E8F0";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const ACCENT = "#0077B6";

function scoreColor(score: number): string {
  if (score >= 80) return "#16A34A";
  if (score >= 60) return "#D97706";
  return "#DC2626";
}

const TWIN_SECTIONS: {
  label: string;
  populated: (twin: DigitalTwin) => boolean;
}[] = [
  { label: "Mission & Vision", populated: (twin) => Boolean(twin.mission) },
  {
    label: "Service Areas",
    populated: (twin) => twin.service_areas.length > 0,
  },
  { label: "Programs", populated: (twin) => twin.programs.length > 0 },
  {
    label: "Financial Profile",
    populated: (twin) => Object.keys(twin.financial_profile).length > 0,
  },
  {
    label: "Board Composition",
    populated: (twin) => twin.board_composition.length > 0,
  },
  {
    label: "Proven Narratives",
    populated: (twin) => twin.proven_narrative_patterns.length > 0,
  },
  {
    label: "Key Strengths",
    populated: (twin) => twin.key_strengths.length > 0,
  },
];

function SectionStatusGrid({ twin }: { twin: DigitalTwin }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: "10px",
      }}
    >
      {TWIN_SECTIONS.map((section) => {
        const populated = section.populated(twin);
        return (
          <div
            key={section.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 12px",
              borderRadius: "8px",
              backgroundColor: populated ? "#DCFCE7" : "#FEE2E2",
              border: `1px solid ${populated ? "#86EFAC" : "#FECACA"}`,
            }}
          >
            {populated ? (
              <CheckCircle2
                className="h-4 w-4 shrink-0"
                style={{ color: "#16A34A" }}
                aria-hidden
              />
            ) : (
              <XCircle
                className="h-4 w-4 shrink-0"
                style={{ color: "#DC2626" }}
                aria-hidden
              />
            )}
            <span
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: populated ? "#166534" : "#991B1B",
              }}
            >
              {section.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function buildChecklist(twin: DigitalTwin): ChecklistItem[] {
  return [
    {
      label: "Mission statement",
      met: Boolean(twin.mission),
      tip: "Add a mission statement in Settings > Organization Profile.",
    },
    {
      label: "Service areas",
      met: twin.service_areas.length > 0,
      tip: "Set a service area or city/state in the organization profile.",
    },
    {
      label: "Programs",
      met: twin.programs.length > 0,
      tip: "Add program description entries to the Knowledge Base.",
    },
    {
      label: "Financial profile",
      met: Object.keys(twin.financial_profile).length > 0,
      tip: "Enter annual budget, staff, or volunteer counts in the organization profile.",
    },
    {
      label: "Board composition",
      met: twin.board_composition.length > 0,
      tip: "Add active board members under Governance.",
    },
    {
      label: "Proven narrative patterns",
      met: twin.proven_narrative_patterns.length > 0,
      tip: "Mark Knowledge Base narratives as proven and record awarded outcomes.",
    },
    {
      label: "Key strengths identified",
      met: twin.key_strengths.length > 0,
      tip: "Record outcomes, programs, and board members so strengths can be derived.",
    },
    {
      label: "Outcome history (5+)",
      met: twin.stats.outcomes_count > 5,
      tip: "Record grant outcomes as applications are decided.",
    },
    {
      label: "Knowledge base depth (10+ entries)",
      met: twin.stats.kb_entries_count > 10,
      tip: "Add more narratives and standard answers to the Knowledge Base.",
    },
    {
      label: "Application history (5+)",
      met: twin.stats.applications_count > 5,
      tip: "Submit applications through the pipeline to build application history.",
    },
  ];
}

function CircularProgress({ score }: { score: number }) {
  const color = scoreColor(score);
  const size = 160;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold" style={{ color }}>
          {score}%
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: TEXT_MUTED }}
        >
          Twin Completeness
        </span>
      </div>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 1px 2px rgba(15,23,42,0.06)" }}
    >
      <div className="flex items-center gap-2" style={{ color: TEXT_PRIMARY }}>
        <Icon className="h-5 w-5" style={{ color: ACCENT }} aria-hidden />
        <h3 className="text-base font-semibold" style={{ color: TEXT_PRIMARY }}>{title}</h3>
      </div>
      {description && (
        <p className="mt-0.5 text-sm" style={{ color: TEXT_SECONDARY }}>{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function DigitalTwinPage() {
  const [orgName, setOrgName] = useState<string | null>(null);
  const [twin, setTwin] = useState<DigitalTwin | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/intelligence/digital-twin");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ??
            "Could not load the digital twin.",
        );
        return;
      }
      setTwin(payload as DigitalTwin);
    } catch {
      setError("Could not reach the digital twin service.");
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .limit(1)
        .maybeSingle();
      if (!active) return;
      setOrgName(org?.name ?? null);
      await load();
      if (!active) return;
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [load]);

  async function handleRebuild() {
    setRebuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/digital-twin", {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ??
            "Rebuild failed. Please try again.",
        );
      } else {
        setTwin(payload as DigitalTwin);
      }
    } catch {
      setError("Could not reach the digital twin service.");
    }
    setRebuilding(false);
  }

  return (
    <div
      className="min-h-screen space-y-6 p-6"
      style={{ backgroundColor: CANVAS }}
    >
      <PageHeader
        title="Digital Twin"
        description="A structured, continuously learning profile of your organization the AI reads before drafting any proposal."
        actions={
          <Button onClick={() => void handleRebuild()} isLoading={rebuilding}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Update Twin
          </Button>
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg px-4 py-3 text-sm"
          style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading digital twin..." />
      ) : !twin ? (
        <EmptyState
          icon={Sparkles}
          title="No digital twin yet"
          description="Rebuild the twin to generate a profile from your organization data."
        />
      ) : (
        <>
          {/* Hero card */}
          <div
            className="rounded-xl p-6"
            style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 4px 20px rgba(15,23,42,0.08)" }}
          >
            <div className="flex flex-wrap items-center gap-6">
              <CircularProgress score={twin.twin_completeness_score} />
              <div className="min-w-0">
                <h2 className="text-xl font-bold" style={{ color: TEXT_PRIMARY }}>
                  {orgName ?? "Your Organization"}
                </h2>
                <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
                  Twin completeness score
                </p>
                <p className="mt-2 text-xs" style={{ color: TEXT_MUTED }}>
                  Last rebuilt{" "}
                  {new Date(twin.last_rebuilt_at).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
            </div>
          </div>

          {twin.twin_completeness_score < 60 && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
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
              <p
                style={{
                  fontSize: "13px",
                  color: "#92400E",
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                <strong>
                  Your AI drafts will be limited until your Digital Twin is
                  complete.
                </strong>{" "}
                Complete now to unlock optimal draft quality.
              </p>
            </div>
          )}

          {/* Section-by-section status */}
          <SectionCard
            icon={Sparkles}
            title="Section Status"
            description="Which parts of the twin are populated vs. still empty."
          >
            <SectionStatusGrid twin={twin} />
          </SectionCard>

          {/* Completeness checklist */}
          <SectionCard
            icon={CheckCircle2}
            title="Completeness Checklist"
            description="What's feeding the twin, and what to add next."
          >
            <ul>
              {buildChecklist(twin).map((item, idx) => (
                <li
                  key={item.label}
                  className="flex items-start gap-3 py-3"
                  style={{ borderTop: idx === 0 ? "none" : `1px solid ${DIVIDER}` }}
                >
                  {item.met ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0"
                      style={{ color: "#16A34A" }}
                      aria-hidden
                    />
                  ) : (
                    <XCircle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      style={{ color: "#DC2626" }}
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>
                      {item.label}
                    </p>
                    {!item.met && (
                      <p className="mt-0.5 text-xs" style={{ color: TEXT_SECONDARY }}>
                        {item.tip}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>

          {/* Mission & Service Area */}
          <SectionCard icon={BookText} title="Mission & Service Area">
            {twin.mission ? (
              <p className="text-sm" style={{ color: TEXT_SECONDARY }}>{twin.mission}</p>
            ) : (
              <p className="text-sm" style={{ color: TEXT_MUTED }}>No mission statement on file.</p>
            )}
            {twin.service_areas.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {twin.service_areas.map((area) => (
                  <Badge key={area} color="gray">
                    {area}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm" style={{ color: TEXT_MUTED }}>
                No service areas on file.
              </p>
            )}
          </SectionCard>

          {/* Programs */}
          <SectionCard icon={Sparkles} title="Programs">
            {twin.programs.length > 0 ? (
              <ul>
                {twin.programs.map((program, idx) => (
                  <li
                    key={program.title}
                    className="py-3"
                    style={{ borderTop: idx === 0 ? "none" : `1px solid ${DIVIDER}` }}
                  >
                    <p className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
                      {program.title}
                    </p>
                    <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
                      {program.description}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: TEXT_MUTED }}>
                No programs documented yet.
              </p>
            )}
          </SectionCard>

          {/* Proven Narrative Patterns */}
          <SectionCard
            icon={Award}
            title="Proven Narrative Patterns"
            description="Knowledge Base entries marked proven whose category overlaps an awarded outcome."
          >
            {twin.proven_narrative_patterns.length > 0 ? (
              <ul className="space-y-2">
                {twin.proven_narrative_patterns.map((pattern) => (
                  <li
                    key={pattern}
                    className="text-sm before:mr-2 before:content-['•']"
                    style={{ color: TEXT_SECONDARY }}
                  >
                    {pattern}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: TEXT_MUTED }}>
                No proven narrative patterns yet.
              </p>
            )}
          </SectionCard>

          {/* Financial Profile */}
          <SectionCard icon={Banknote} title="Financial Profile">
            {Object.keys(twin.financial_profile).length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {Object.entries(twin.financial_profile).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-xs" style={{ color: TEXT_MUTED }}>
                      {FINANCIAL_LABELS[key] ?? key}
                    </p>
                    <p className="text-lg font-bold" style={{ color: TEXT_PRIMARY }}>
                      {key === "annual_budget"
                        ? new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          }).format(value)
                        : value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={{ color: TEXT_MUTED }}>
                No financial data on file.
              </p>
            )}
          </SectionCard>

          {/* Board composition */}
          <SectionCard icon={Users} title="Board Composition">
            {twin.board_composition.length > 0 ? (
              <ul>
                {twin.board_composition.map((member, idx) => (
                  <li
                    key={member.name}
                    className="py-3"
                    style={{ borderTop: idx === 0 ? "none" : `1px solid ${DIVIDER}` }}
                  >
                    <p className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
                      {member.name}
                      {member.title && (
                        <span className="ml-2 font-normal" style={{ color: TEXT_SECONDARY }}>
                          {member.title}
                        </span>
                      )}
                    </p>
                    {member.bio && (
                      <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>{member.bio}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: TEXT_MUTED }}>
                No active board members on file.
              </p>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
