"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  BookText,
  Building2,
  FileEdit,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge, EmptyState, LoadingSpinner } from "@/components/ui";
import { ProvenBadge } from "@/components/knowledge-base/ProvenBadge";
import { createClient } from "@/lib/supabase/client";
import { STANDARD_ANSWER_CATEGORY } from "@/lib/utils/constants";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

// Knowledge Base overview (BLUEPRINT §4.7). Two-column layout per the UI
// redesign spec: a left nav card mirroring the same routes
// KnowledgeBaseNav.tsx already exposes (Overview, Organization Profile, Full
// Editor, Narratives, Standard Answers), and a right content column with a
// gradient hero card for the org profile plus the proven-narratives list.
// "Standard Answers" is labeled "Q&A Library" here to match the design
// spec's requested wording -- same real route, no new page.
//
// The hero card's completeness bar reads the real per-section scoring engine
// (src/lib/knowledge-base/profile.ts's computeSectionScores, served by
// GET /api/knowledge-base -- the same score /knowledge-base/edit and
// /intelligence/twin already show) rather than a fabricated percentage.
// Editable fields are NOT duplicated into a second form on this page --
// ProfileEditor.tsx at /knowledge-base/profile is the one real, wired editor
// for those fields; this page links to it instead of forking a disconnected
// copy, matching this project's established "restyle, don't duplicate wired
// functionality" practice.
//
// Every color below is an inline hex value per BLUEPRINT_v2.md §7.5 -- no
// CSS variables, no Tailwind color classes, for anything built directly on
// this page. Shared components (Badge, EmptyState, LoadingSpinner) keep
// their existing bracket-hex Tailwind implementation, unchanged here.

const COLORS = {
  canvas: "#D8D3C8",
  card: "#F8F5EE",
  cardBorder: "rgba(16,27,45,0.15)",
  text: "#101B2D",
  textMuted: "#64748B",
  primary: "#B88A2E",
  accent: "#101B2D",
};

// Draft & Automation section treatment — PAGE_TREATMENT_PROTOCOL_V2.md /
// DESIGN_SYSTEM_V2_ASSIGNMENT.md. Frame: Rich Gold. Full accent family
// available for distinct action buttons. 2026-08-18: confirmed via live
// getComputedStyle audit this page never received the v2 rollout - same
// real gap as AutoApply's.
const SECTION_ACCENT = "#B88A2E";
const SECTION_ACCENT_TINT = "rgba(184,138,46,0.1)";

const CTA_TEAL_BG = "#B88A2E";
const CTA_TEAL_TEXT = "#F8F5EE";

const CARD_SHADOW = "0 4px 20px rgba(184,138,46,0.22)";

type Summary = {
  narrativeCount: number;
  answerCount: number;
  provenCount: number;
  proven: Tables<"proven_narratives">[];
};

interface OrgProfileSnapshot {
  name: string;
  missionStatement: string | null;
  ein: string | null;
  taxStatus: string | null;
  serviceArea: string | null;
  totalStaff: number | null;
  totalVolunteers: number | null;
}

interface KnowledgeBaseApiResponse {
  organization: {
    name: string;
    mission_statement: string | null;
    ein: string | null;
    tax_status: string | null;
    service_area: string | null;
    total_staff: number | null;
    total_volunteers: number | null;
  };
  sectionScores: Record<string, number>;
  twinCompletenessScore: number;
}

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/knowledge-base", label: "Overview", icon: BookText },
  { href: "/knowledge-base/profile", label: "Organization Profile", icon: Building2 },
  { href: "/knowledge-base/edit", label: "Full Editor", icon: FileEdit },
  { href: "/knowledge-base/narratives", label: "Proven Narratives", icon: Award },
  { href: "/knowledge-base/answers", label: "Q&A Library", icon: HelpCircle },
];

export default function KnowledgeBaseOverviewPage() {
  const pathname = usePathname();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [profile, setProfile] = useState<OrgProfileSnapshot | null>(null);
  const [completeness, setCompleteness] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);

      const [kbRes, provenRes, profileRes] = await Promise.all([
        supabase.from("knowledge_base").select("id, category, is_proven"),
        supabase
          .from("proven_narratives")
          .select("*")
          .order("effectiveness_score", { ascending: false, nullsFirst: false })
          .limit(1000),
        fetch("/api/knowledge-base").then((res) => (res.ok ? (res.json() as Promise<KnowledgeBaseApiResponse>) : null)),
      ]);

      if (!active) return;

      if (kbRes.error) {
        setError("Could not load your knowledge base.");
        setLoading(false);
        return;
      }

      const kb = kbRes.data ?? [];
      setSummary({
        narrativeCount: kb.filter((r) => r.category !== STANDARD_ANSWER_CATEGORY).length,
        answerCount: kb.filter((r) => r.category === STANDARD_ANSWER_CATEGORY).length,
        provenCount: kb.filter((r) => r.is_proven).length,
        proven: provenRes.data ?? [],
      });

      if (profileRes) {
        setProfile({
          name: profileRes.organization.name,
          missionStatement: profileRes.organization.mission_statement,
          ein: profileRes.organization.ein,
          taxStatus: profileRes.organization.tax_status,
          serviceArea: profileRes.organization.service_area,
          totalStaff: profileRes.organization.total_staff,
          totalVolunteers: profileRes.organization.total_volunteers,
        });
        const scores = Object.values(profileRes.sectionScores ?? {});
        const avgSectionScore =
          scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
        setCompleteness(profileRes.twinCompletenessScore || avgSectionScore || 0);
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: COLORS.canvas, padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: COLORS.text, margin: 0 }}>Knowledge Base</h1>
        <p style={{ fontSize: 14, color: COLORS.textMuted, marginTop: 6, maxWidth: 640 }}>
          The verified organizational content the AI draws from — never fabricated beyond what you store here.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: "#FEF2F2",
            border: "1px solid #EF4444",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 14,
            color: "#991B1B",
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading knowledge base..." />
      ) : (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* Left nav */}
          <div
            style={{
              flex: "1 1 280px",
              maxWidth: 320,
              background: COLORS.card,
              borderRadius: 12,
              padding: 16,
              boxShadow: CARD_SHADOW,
              border: `1px solid ${COLORS.cardBorder}`,
            }}
          >
            <p
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: COLORS.textMuted,
                textTransform: "uppercase",
                marginBottom: 12,
              }}
            >
              Knowledge Sections
            </p>
            {NAV_ITEMS.map((item) => {
              const active = item.href === "/knowledge-base" ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={
                    {
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 8,
                      padding: "10px 14px",
                      fontWeight: active ? 600 : 500,
                      fontSize: 13,
                      cursor: "pointer",
                      marginBottom: 4,
                      backgroundColor: active ? SECTION_ACCENT_TINT : "transparent",
                      color: active ? SECTION_ACCENT : COLORS.textMuted,
                      textDecoration: "none",
                    } as CSSProperties
                  }
                >
                  <item.icon size={15} aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Right content */}
          <div style={{ flex: "3 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Organization profile hero */}
            <div
              style={{
                background: "linear-gradient(135deg,#B88A2E,#101B2D)",
                borderRadius: 12,
                padding: 24,
                color: "#F8F5EE",
              }}
            >
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.75, textTransform: "uppercase" }}>
                Organization Profile
              </p>
              <h2 style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 800 }}>
                {profile?.name ?? "Your organization"}
              </h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "rgba(255,255,255,0.85)", maxWidth: 560 }}>
                {profile?.missionStatement
                  ? profile.missionStatement.length > 180
                    ? `${profile.missionStatement.slice(0, 180).trimEnd()}…`
                    : profile.missionStatement
                  : "No mission statement recorded yet — add one in the Organization Profile editor."}
              </p>

              <div style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, fontWeight: 600 }}>
                <span>Profile Completeness</span>
                <span>{completeness ?? 0}%</span>
              </div>
              <div style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 3, height: 6, marginTop: 8 }}>
                <div
                  style={{
                    backgroundColor: SECTION_ACCENT,
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.5)",
                    height: 6,
                    borderRadius: 3,
                    width: `${completeness ?? 0}%`,
                    transition: "width 300ms",
                  }}
                />
              </div>

              {profile && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 18 }}>
                  <ProfileFact label="EIN" value={profile.ein ?? "—"} />
                  <ProfileFact label="Tax Status" value={profile.taxStatus ? humanizeEnum(profile.taxStatus) : "—"} />
                  <ProfileFact label="Service Area" value={profile.serviceArea ?? "—"} />
                  <ProfileFact
                    label="Staff / Volunteers"
                    value={`${profile.totalStaff ?? 0} / ${profile.totalVolunteers ?? 0}`}
                  />
                </div>
              )}

              <Link
                href="/knowledge-base/profile"
                style={{
                  display: "inline-block",
                  marginTop: 20,
                  padding: "9px 16px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  background: CTA_TEAL_BG,
                  color: CTA_TEAL_TEXT,
                  textDecoration: "none",
                }}
              >
                Edit Organization Profile
              </Link>
            </div>

            {/* Metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
              <MetricCard icon={BookText} label="Narratives" value={summary?.narrativeCount ?? 0} />
              <MetricCard icon={HelpCircle} label="Standard answers" value={summary?.answerCount ?? 0} />
              <MetricCard icon={Award} label="Proven narratives" value={summary?.provenCount ?? 0} />
            </div>

            {/* Proven narratives */}
            <div
              style={{
                background: COLORS.card,
                borderRadius: 12,
                padding: 20,
                boxShadow: CARD_SHADOW,
                border: `1px solid ${COLORS.cardBorder}`,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 700, color: COLORS.text, margin: 0 }}>Proven narratives</h3>
              <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "4px 0 0" }}>
                Patterns the learning system extracted from awarded applications, ranked by effectiveness.
              </p>

              {summary && summary.proven.length > 0 ? (
                <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  {summary.proven.map((proven) => (
                    <div
                      key={proven.id}
                      style={{
                        backgroundColor: "#F0FDF4",
                        border: "1px solid #BBF7D0",
                        borderRadius: 10,
                        padding: 16,
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 16,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {proven.section_type && <Badge color="indigo">{humanizeEnum(proven.section_type)}</Badge>}
                          {proven.funder_category && <Badge color="gray">{humanizeEnum(proven.funder_category)}</Badge>}
                        </div>
                        <p
                          style={{
                            marginTop: 8,
                            fontSize: 13,
                            color: "#334155",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {proven.narrative_text}
                        </p>
                        {proven.last_used_at && (
                          <p style={{ marginTop: 6, fontSize: 11, color: "#94A3B8" }}>
                            Last used {formatRelative(proven.last_used_at)}
                          </p>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <span
                          style={{
                            backgroundColor: "#16A34A",
                            color: "#FFFFFF",
                            borderRadius: 6,
                            padding: "3px 10px",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {proven.effectiveness_score != null
                            ? `${Math.round(proven.effectiveness_score * 100)}% effective`
                            : "Proven"}
                        </span>
                        <ProvenBadge
                          isProven
                          provenCount={proven.success_count}
                          effectivenessScore={null}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 16 }}>
                  <EmptyState
                    icon={Award}
                    title="No proven narratives yet"
                    description="As you record awarded outcomes, the learning system promotes the narratives that won and ranks them here. Add the narratives your team writes today to build that pool."
                    action={
                      <Link
                        href="/knowledge-base/narratives"
                        style={{
                          display: "inline-block",
                          padding: "9px 18px",
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 700,
                          background: CTA_TEAL_BG,
                          color: CTA_TEAL_TEXT,
                          textDecoration: "none",
                        }}
                      >
                        Add a Narrative
                      </Link>
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "rgba(255,255,255,0.7)", textTransform: "uppercase" }}>
        {label}
      </p>
      <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600 }}>{value}</p>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div
      style={{
        background: COLORS.card,
        borderRadius: 12,
        padding: 20,
        boxShadow: CARD_SHADOW,
        border: `1px solid ${COLORS.cardBorder}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            display: "flex",
            height: 40,
            width: 40,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            backgroundColor: "#CAF0F8",
          }}
        >
          <Icon size={18} color={COLORS.primary} aria-hidden />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: COLORS.text }}>{value}</p>
          <p style={{ margin: 0, fontSize: 11, color: COLORS.textMuted }}>{label}</p>
        </div>
      </div>
    </div>
  );
}
