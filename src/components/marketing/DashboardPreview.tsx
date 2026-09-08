"use client";

// Embedded, interactive mini-preview of the Opportunities dashboard for
// marketing pages. This component is intentionally self-contained:
//
//   - It imports ONLY React, the marketing site's own icon set, theme tokens, and
//     the hardcoded fixtures in "@/lib/marketing/dashboard-preview-data".
//   - It contains no `fetch`, no Supabase client (`createClient`,
//     `@supabase/*`), no `useEffect` data-loading, no route params, and no
//     `organization_id` of any kind. All interactivity (filtering, expanding
//     a score breakdown) is `useState`/`useMemo` over the local fixture
//     array — nothing here can reach the network or a database.
//   - Every visible name/funder/figure comes from the fictional
//     DEMO_OPPORTUNITIES fixture, never from a live account. A prior
//     incident let a real internal test organization's name leak into a
//     public marketing screenshot; this widget is built so that class of
//     bug is structurally impossible here, not just avoided by convention.
//
// Visually it mirrors src/app/(dashboard)/opportunities/page.tsx (stat
// tiles, filter chips, opportunity cards, score-breakdown panel) so visitors
// can click around something that feels like the real product, without ever
// touching real product data.

import { useMemo, useState } from "react";
import { MkDisclosureIcon, MkInfoIcon } from "@/components/marketing/icons";

import {
  DEMO_DISCLAIMER,
  DEMO_ORG_NAME,
  DEMO_OPPORTUNITIES,
  SOURCE_BUCKET_ACCENT,
  SOURCE_BUCKET_LABEL,
  type DemoOpportunity,
  type DemoSourceBucket,
} from "@/lib/marketing/dashboard-preview-data";
import { mk, mkRadius } from "@/lib/marketing/theme";

const FRAME_ACCENT = "#A4712C";
const PANEL_BG = "#2C4E3B";

const RECOMMENDATION_TONE: Record<DemoOpportunity["probability"]["recommendation"], { bg: string; color: string; label: string }> = {
  apply: { bg: "#F0FDF4", color: "#16A34A", label: "Apply" },
  consider: { bg: "#FEF3C7", color: "#B45309", label: "Consider" },
  skip: { bg: "#FEF2F2", color: "#B91C1C", label: "Skip" },
};

const CONFIDENCE_TONE: Record<DemoOpportunity["probability"]["confidence"], string> = {
  high: "#16A34A",
  medium: "#D97706",
  low: "#94A3B8",
};

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: FRAME_ACCENT, borderRadius: 14, boxShadow: "0 4px 20px rgba(164,113,44,0.22)", padding: 3, flex: 1, minWidth: 140 }}>
      <div style={{ background: "#F8F5EE", borderRadius: 11, padding: "14px 16px" }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: mk.forest }}>{value}</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 6 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

function ScoreBreakdown({ probability }: { probability: DemoOpportunity["probability"] }) {
  const recTone = RECOMMENDATION_TONE[probability.recommendation];
  return (
    <div style={{ marginTop: 14, padding: "16px 18px", borderRadius: 10, background: PANEL_BG }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ background: recTone.bg, color: recTone.color, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
          {recTone.label}
        </span>
        <span style={{ fontSize: 12, color: CONFIDENCE_TONE[probability.confidence], fontWeight: 600 }}>
          {probability.confidence} confidence
        </span>
        <span style={{ fontSize: 12, color: "#CBD5E1" }}>&middot; {probability.estimatedRoi} est. ROI</span>
        <span style={{ fontSize: 12, color: "#CBD5E1" }}>&middot; {probability.timeToComplete}</span>
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        {probability.factors.map((f) => (
          <div key={f.name}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#E2E8F0", marginBottom: 4 }}>
              <span>
                {f.label} <span style={{ color: "#64748B" }}>({Math.round(f.weight * 100)}% weight)</span>
              </span>
              <span style={{ fontWeight: 700 }}>{Math.round(f.value * 100)}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "#334155", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(f.value * 100)}%`, borderRadius: 3, background: FRAME_ACCENT }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#F87171", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            Key Risks
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#CBD5E1", lineHeight: 1.6 }}>
            {probability.keyRisks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#4ADE80", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            Key Strengths
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#CBD5E1", lineHeight: 1.6 }}>
            {probability.keyStrengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function DashboardPreview() {
  const [activeBucket, setActiveBucket] = useState<DemoSourceBucket | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (activeBucket === "all" ? DEMO_OPPORTUNITIES : DEMO_OPPORTUNITIES.filter((o) => o.sourceBucket === activeBucket)),
    [activeBucket],
  );

  const stats = useMemo(() => {
    const openCount = DEMO_OPPORTUNITIES.length;
    const highProbCount = DEMO_OPPORTUNITIES.filter((o) => o.matchPercentage > 70).length;
    const closingThisWeek = DEMO_OPPORTUNITIES.filter((o) => o.deadlineInDays <= 7).length;
    const totalPotential = DEMO_OPPORTUNITIES.reduce((sum, o) => sum + o.amount, 0);
    return { openCount, highProbCount, closingThisWeek, totalPotential };
  }, []);

  const buckets: (DemoSourceBucket | "all")[] = ["all", "federal", "foundation", "corporate", "state"];

  return (
    <div
      style={{
        background: "#F0EBE0",
        borderRadius: mkRadius.card,
        border: `1px solid ${mk.line}`,
        padding: 20,
        maxWidth: 880,
        margin: "0 auto",
      }}
      aria-label="Interactive sample dashboard preview (demo data only)"
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          background: "#FEF3C7",
          border: "1px solid #FDE68A",
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 16,
          fontSize: 12,
          color: "#92400E",
        }}
      >
        <MkInfoIcon size={16} style={{ marginTop: 1 }} />
        <span>{DEMO_DISCLAIMER}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{DEMO_ORG_NAME} &middot; Opportunities</div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#92400E",
            background: "#FEF3C7",
            border: "1px solid #FDE68A",
            borderRadius: 9999,
            padding: "3px 10px",
          }}
        >
          Demo Mode &middot; Sample Data
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
        <StatTile label="Open Opportunities" value={String(stats.openCount)} />
        <StatTile label="High Probability >70%" value={String(stats.highProbCount)} />
        <StatTile label="Closing This Week" value={String(stats.closingThisWeek)} />
        <StatTile label="Total Potential" value={formatCurrency(stats.totalPotential)} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {buckets.map((bucket) => {
          const isActive = activeBucket === bucket;
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => setActiveBucket(bucket)}
              style={{
                border: `1px solid ${isActive ? mk.forest : mk.line}`,
                background: isActive ? mk.forest : mk.surface,
                color: isActive ? mk.heroText : mk.ink,
                borderRadius: 9999,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {bucket === "all" ? "All Sources" : SOURCE_BUCKET_LABEL[bucket]}
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {filtered.map((opp) => {
          const accent = SOURCE_BUCKET_ACCENT[opp.sourceBucket];
          const isExpanded = expandedId === opp.id;
          return (
            <div
              key={opp.id}
              style={{
                background: mk.surface,
                border: `1px solid ${mk.line}`,
                borderLeft: `4px solid ${accent}`,
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: mk.ink }}>{opp.name}</div>
                  <div style={{ fontSize: 12, color: mk.muted, marginTop: 2 }}>{opp.funderName}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: accent,
                      border: `1px solid ${accent}`,
                      borderRadius: 9999,
                      padding: "2px 8px",
                    }}
                  >
                    {SOURCE_BUCKET_LABEL[opp.sourceBucket]}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: mk.forest }}>{formatCurrency(opp.amount)}</span>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10, fontSize: 12, color: mk.muted }}>
                <span>Deadline: in {opp.deadlineInDays} days</span>
                <span>Match: {opp.matchPercentage}%</span>
              </div>

              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : opp.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 10,
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: mk.terracotta,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
                aria-expanded={isExpanded}
              >
                {isExpanded ? "Hide Score Breakdown" : "View Score Breakdown"}
                <MkDisclosureIcon size={14} direction={isExpanded ? "up" : "down"} />
              </button>

              {isExpanded && <ScoreBreakdown probability={opp.probability} />}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: mk.muted, lineHeight: 1.6 }}>
        This widget is self-contained sample data rendered entirely in your browser. It does not query Benavora&rsquo;s
        database or any customer account.
      </div>
    </div>
  );
}
