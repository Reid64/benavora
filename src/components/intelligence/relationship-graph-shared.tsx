"use client";

// Shared types/components for the Relationship Intelligence Graph feature
// (src/app/(dashboard)/intelligence/relationship-graph/page.tsx and its
// force-directed graph view, RelationshipGraphViz.tsx). Split out so both
// the existing card-list view and the new graph view render the exact same
// connection card — one component, not two divergent copies of the same
// markup. Every color is an inline hex value per BLUEPRINT_v2.md §7.5.

import { Loader2, Users } from "lucide-react";

import { humanizeEnum } from "@/lib/utils/formatters";

export type IntroductionStrength = "direct" | "one_hop" | "two_hop";

export interface Connection {
  id: string;
  sourceLabel: string;
  sourceType: string;
  targetLabel: string;
  targetNodeType: string;
  relationshipType: string;
  introductionStrength: IntroductionStrength;
  warmIntroductionPath: string | null;
  confidence: number | null;
  weight: number | null;
  verified: boolean;
  introductionRequested: boolean;
  discoveredAt: string;
}

export const STRENGTH_COLOR: Record<IntroductionStrength, string> = {
  direct: "#10B981",
  one_hop: "#0EA5E9",
  two_hop: "#F59E0B",
};

export const STRENGTH_LABEL: Record<IntroductionStrength, string> = {
  direct: "Direct Introduction",
  one_hop: "One-Hop",
  two_hop: "Two-Hop",
};

export function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        backgroundColor: "#F8F5EE",
        borderRadius: "14px",
        padding: "20px 24px",
        boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
        flex: "1 1 200px",
      }}
    >
      <p
        style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "#64748B",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>
      <p style={{ fontSize: "28px", fontWeight: 900, color, margin: 0 }}>
        {value}
      </p>
    </div>
  );
}

export function ConnectionCard({
  connection,
  onRequestIntroduction,
  requesting,
}: {
  connection: Connection;
  onRequestIntroduction: (edgeId: string) => void;
  requesting: boolean;
}) {
  const accentColor =
    STRENGTH_COLOR[connection.introductionStrength] ?? "#6B7280";

  return (
    <div
      style={{
        display: "flex",
        backgroundColor: "#F8F5EE",
        borderRadius: "12px",
        overflow: "hidden",
        marginBottom: "12px",
        boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
      }}
    >
      <div
        style={{ width: "6px", flexShrink: 0, backgroundColor: accentColor }}
        aria-hidden
      />
      <div style={{ flex: 1, padding: "20px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            marginBottom: "10px",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11px",
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: "#1A2B3C",
              borderRadius: "999px",
              padding: "3px 10px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            <Users size={11} aria-hidden />
            {humanizeEnum(connection.sourceType)}
          </span>

          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: accentColor,
              borderRadius: "999px",
              padding: "3px 10px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {STRENGTH_LABEL[connection.introductionStrength]}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            fontSize: "14px",
            fontWeight: 700,
            color: "#0F172A",
            marginBottom: "8px",
          }}
        >
          <span>{connection.sourceLabel}</span>
          <span style={{ color: "#94A3B8", fontWeight: 400 }}>&rarr;</span>
          <span style={{ color: "#7A5980" }}>
            {humanizeEnum(connection.relationshipType)}
          </span>
          <span style={{ color: "#94A3B8", fontWeight: 400 }}>&rarr;</span>
          <span>{connection.targetLabel}</span>
        </div>

        {connection.warmIntroductionPath && (
          <p
            style={{
              fontSize: "13px",
              fontStyle: "italic",
              color: "#64748B",
              margin: "0 0 14px",
            }}
          >
            {connection.warmIntroductionPath}
          </p>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: "#334155",
              borderRadius: "999px",
              padding: "3px 10px",
            }}
          >
            {connection.confidence != null
              ? `${connection.confidence}% confidence`
              : "Confidence unknown"}
          </span>

          <button
            type="button"
            onClick={() => onRequestIntroduction(connection.id)}
            disabled={requesting || connection.introductionRequested}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: connection.introductionRequested
                ? "#94A3B8"
                : "#10B981",
              color: "#FFFFFF",
              fontSize: "12px",
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              cursor:
                requesting || connection.introductionRequested
                  ? "default"
                  : "pointer",
              opacity: requesting ? 0.7 : 1,
            }}
          >
            {requesting ? <Loader2 size={13} className="animate-spin" /> : null}
            {connection.introductionRequested
              ? "Introduction Requested"
              : "Request Introduction"}
          </button>
        </div>
      </div>
    </div>
  );
}
