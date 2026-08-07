"use client";

// Personalized Match Feed (FEATURE_REGISTRY_v2.md #85) — open opportunities
// ranked by affinity to the org's Organizational Digital Twin, blended with
// AG-15's probability score where one exists. Backed by
// src/lib/intelligence/match-feed.ts (deterministic, no Claude call) via
// GET /api/intelligence/match-feed. See that module's header comment for the
// full weighted formula.

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";

import { formatCurrency, formatRelative } from "@/lib/utils/formatters";

const CANVAS = "#D6E4F0";
const CARD_BG = "#FFFFFF";
const BORDER = "#C3D3E2";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const ACCENT = "#0077B6";
const ACCENT_LIGHT = "#00B4D8";
const WARN_BG = "#FEF3C7";
const WARN_BORDER = "#FDE68A";
const WARN_TEXT = "#92400E";
const ERROR_BG = "#FEE2E2";
const ERROR_BORDER = "#FECACA";
const ERROR_TEXT = "#B91C1C";
const CHIP_BG = "#E0F2FE";
const CHIP_TEXT = "#0369A1";

type PersonalizationLevel = "none" | "limited" | "partial" | "strong";

interface MatchFeedFactor {
  name: "mission_affinity" | "program_affinity" | "geographic_fit";
  weight: number;
  value: number;
  contribution: number;
}

interface MatchFeedEntry {
  opportunityId: string;
  opportunityName: string;
  category: string | null;
  amountMin: number | null;
  amountMax: number | null;
  deadline: string | null;
  funderId: string | null;
  funderName: string | null;
  affinityScore: number;
  probabilityScore: number | null;
  probabilityBlended: boolean;
  combinedScore: number;
  factors: MatchFeedFactor[];
  matchedProgram: string | null;
  reasons: string[];
}

interface MatchFeedResponse {
  personalizationLevel: PersonalizationLevel;
  twinCompletenessScore: number;
  entries: MatchFeedEntry[];
  opportunitiesScanned: number;
  opportunitiesTotal: number;
  error?: string;
  code?: string;
}

const FACTOR_LABELS: Record<MatchFeedFactor["name"], string> = {
  mission_affinity: "Mission",
  program_affinity: "Programs",
  geographic_fit: "Geography",
};

function scoreColor(score: number): string {
  if (score >= 70) return "#15803D";
  if (score >= 40) return ACCENT;
  return TEXT_MUTED;
}

function PersonalizationBanner({
  level,
  completeness,
}: {
  level: PersonalizationLevel;
  completeness: number;
}) {
  if (level === "strong") return null;

  const message =
    level === "none"
      ? "Personalization is unavailable — your organization has no Digital Twin yet. Build one to unlock real matching."
      : `Personalization is limited — your Digital Twin is only ${completeness}% complete. Rankings below rely mostly on neutral defaults until it's filled in further.`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: WARN_BG,
        border: `1px solid ${WARN_BORDER}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 20,
      }}
    >
      <AlertTriangle size={18} color={WARN_TEXT} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: WARN_TEXT, flex: 1 }}>{message}</span>
      <Link
        href="/knowledge-base/edit"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: WARN_TEXT,
          textDecoration: "underline",
          whiteSpace: "nowrap",
        }}
      >
        Improve Digital Twin
      </Link>
    </div>
  );
}

function MatchCard({ entry }: { entry: MatchFeedEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: 20,
        marginBottom: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY, margin: 0 }}>
            {entry.opportunityName}
          </h3>
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            {entry.funderName && (
              <span style={{ fontSize: 13, color: TEXT_SECONDARY }}>{entry.funderName}</span>
            )}
            {entry.category && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: CHIP_TEXT,
                  background: CHIP_BG,
                  borderRadius: 6,
                  padding: "2px 8px",
                  textTransform: "capitalize",
                }}
              >
                {entry.category.replace(/_/g, " ")}
              </span>
            )}
            {(entry.amountMin != null || entry.amountMax != null) && (
              <span style={{ fontSize: 12, color: TEXT_MUTED }}>
                {formatCurrency(entry.amountMin)} – {formatCurrency(entry.amountMax)}
              </span>
            )}
            {entry.deadline && (
              <span style={{ fontSize: 12, color: TEXT_MUTED }}>Due {formatRelative(entry.deadline)}</span>
            )}
          </div>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor(entry.combinedScore), lineHeight: 1 }}>
            {entry.combinedScore}
          </div>
          <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 2 }}>match score</div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {entry.reasons.map((reason, i) => (
          <div key={i} style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 3 }}>
            {reason}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: ACCENT,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {expanded ? "Hide factor breakdown" : "Show factor breakdown"}
        </button>
        {!entry.probabilityBlended && (
          <span style={{ fontSize: 11, color: TEXT_MUTED, fontStyle: "italic" }}>
            Affinity-only — not yet scored by the probability engine
          </span>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: TEXT_MUTED, marginBottom: 8, textTransform: "uppercase" }}>
            Affinity score: {entry.affinityScore} / 100
          </div>
          {entry.factors.map((f) => (
            <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: TEXT_SECONDARY, width: 90, flexShrink: 0 }}>
                {FACTOR_LABELS[f.name]}
              </span>
              <div style={{ flex: 1, height: 6, background: "#EEF2F7", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(f.value * 100)}%`,
                    background: ACCENT_LIGHT,
                    borderRadius: 3,
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: TEXT_MUTED, width: 36, textAlign: "right" }}>
                {Math.round(f.value * 100)}%
              </span>
            </div>
          ))}
          {entry.probabilityBlended && (
            <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 8 }}>
              Blended with AG-15 probability score ({entry.probabilityScore}/100): combined ={" "}
              {entry.affinityScore} × 0.55 + {entry.probabilityScore} × 0.45 = {entry.combinedScore}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MatchFeedPage() {
  const [data, setData] = useState<MatchFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/intelligence/match-feed?limit=25")
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as MatchFeedResponse;
        if (!res.ok) throw new Error(json.error ?? "Failed to load the match feed.");
        setData(json);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load the match feed.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ background: CANVAS, minHeight: "100vh", padding: 32 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={20} color={ACCENT} />
              <h1 style={{ fontSize: 24, fontWeight: 800, color: TEXT_PRIMARY, margin: 0 }}>
                Personalized Match Feed
              </h1>
            </div>
            <p style={{ fontSize: 13, color: TEXT_SECONDARY, marginTop: 4, maxWidth: 560 }}>
              Your open opportunities ranked by how well each one aligns with your Organizational
              Digital Twin's mission, programs, and service areas — blended with the probability
              engine's win-likelihood score where one has been computed.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: ACCENT,
              background: CARD_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: "8px 14px",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
              flexShrink: 0,
            }}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {error && (
          <div
            style={{
              background: ERROR_BG,
              border: `1px solid ${ERROR_BORDER}`,
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 20,
              fontSize: 13,
              color: ERROR_TEXT,
            }}
          >
            {error}
          </div>
        )}

        {data && (
          <PersonalizationBanner level={data.personalizationLevel} completeness={data.twinCompletenessScore} />
        )}

        {loading && !data && (
          <div style={{ textAlign: "center", padding: 60, color: TEXT_MUTED, fontSize: 14 }}>
            Computing your match feed…
          </div>
        )}

        {data && data.entries.length === 0 && !loading && (
          <div
            style={{
              background: CARD_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 40,
              textAlign: "center",
              color: TEXT_MUTED,
              fontSize: 14,
            }}
          >
            No open opportunities found to rank yet.
          </div>
        )}

        {data && data.entries.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 12 }}>
              Ranked {data.entries.length} of {data.opportunitiesTotal} open opportunities.
            </div>
            {data.entries.map((entry) => (
              <MatchCard key={entry.opportunityId} entry={entry} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
