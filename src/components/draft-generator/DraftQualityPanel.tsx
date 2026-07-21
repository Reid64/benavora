"use client";

// Draft Quality Analysis panel for the autonomous draft review page
// (/draft-generator/autonomous). Reads applications.metadata.humanization_score
// / .humanization_breakdown (103_narrative_humanizer.sql,
// src/lib/intelligence/narrative-humanizer.ts) and lets a reviewer
// re-humanize, edit, or re-score a draft in place. Mirrors the dark-card
// score-panel convention already shipped on /intelligence/twin (colors:
// card #0D1526, bar track #1A2B3C, muted label #8BA8C8, thresholds 80/60).

import { useState } from "react";
import { Loader2 } from "lucide-react";

const CARD_BG = "#0D1526";
const BAR_TRACK = "#1A2B3C";
const TEXT_MUTED = "#8BA8C8";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const RED = "#DC2626";
const CONCERN_THRESHOLD = 70;

interface ScoreBreakdown {
  human_voice_authenticity: number;
  organization_specificity: number;
  ai_phrase_absence: number;
  narrative_flow: number;
  top_concerns: string[];
}

interface DraftQualityPanelProps {
  applicationId: string;
  initialDraftContent: string;
  initialMetadata: Record<string, unknown> | null;
}

function scoreColor(score: number | null): string {
  if (score == null) return "#3A4A5E";
  if (score >= 80) return GREEN;
  if (score >= 60) return AMBER;
  return RED;
}

function parseBreakdown(
  metadata: Record<string, unknown> | null,
): ScoreBreakdown | null {
  const raw = metadata?.humanization_breakdown;
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const humanVoice = num(b.human_voice_authenticity);
  const orgSpecificity = num(b.organization_specificity);
  const aiAbsence = num(b.ai_phrase_absence);
  const flow = num(b.narrative_flow);
  if (humanVoice == null || orgSpecificity == null || aiAbsence == null || flow == null) {
    return null;
  }
  return {
    human_voice_authenticity: humanVoice,
    organization_specificity: orgSpecificity,
    ai_phrase_absence: aiAbsence,
    narrative_flow: flow,
    top_concerns: Array.isArray(b.top_concerns)
      ? b.top_concerns.filter((c): c is string => typeof c === "string")
      : [],
  };
}

function parseOverallScore(metadata: Record<string, unknown> | null): number | null {
  const score = metadata?.humanization_score;
  return typeof score === "number" ? score : null;
}

const DIMENSION_CONCERNS: Record<keyof Omit<ScoreBreakdown, "top_concerns">, string> = {
  human_voice_authenticity:
    "Human Voice is low — this narrative may still read as AI-written.",
  organization_specificity:
    "Org Specificity is low — replace generic language with concrete organizational detail.",
  ai_phrase_absence:
    "AI Phrase Absence is low — stock AI phrasing likely remains in the text.",
  narrative_flow:
    "Narrative Flow is low — sections may not read smoothly end to end.",
};

function buildConcerns(breakdown: ScoreBreakdown | null): string[] {
  if (!breakdown) return [];
  if (breakdown.top_concerns.length > 0) return breakdown.top_concerns;
  return (
    Object.keys(DIMENSION_CONCERNS) as (keyof typeof DIMENSION_CONCERNS)[]
  )
    .filter((key) => breakdown[key] < CONCERN_THRESHOLD)
    .map((key) => DIMENSION_CONCERNS[key]);
}

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  const color = scoreColor(score);
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "6px",
        }}
      >
        <span style={{ fontSize: "11px", color: "#FFFFFF" }}>{label}</span>
        <span style={{ fontSize: "11px", fontWeight: 700, color }}>
          {score != null ? `${score}/100` : "—"}
        </span>
      </div>
      <div
        style={{
          width: "100%",
          height: "6px",
          borderRadius: "3px",
          backgroundColor: BAR_TRACK,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${score ?? 0}%`,
            height: "100%",
            borderRadius: "3px",
            backgroundColor: color,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

function OverallScoreCircle({ score }: { score: number | null }) {
  const color = scoreColor(score);
  return (
    <div
      style={{
        width: "60px",
        height: "60px",
        borderRadius: "50%",
        border: `4px solid ${color}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: "18px", fontWeight: 700, color: "#FFFFFF" }}>
        {score != null ? score : "—"}
      </span>
    </div>
  );
}

function PanelButton({
  onClick,
  disabled,
  loading,
  label,
  variant = "primary",
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        backgroundColor: variant === "primary" ? "#0077B6" : "#1A2B3C",
        color: "#FFFFFF",
        fontSize: "12px",
        fontWeight: 600,
        borderRadius: "6px",
        padding: "6px 12px",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {loading && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      {label}
    </button>
  );
}

export function DraftQualityPanel({
  applicationId,
  initialDraftContent,
  initialMetadata,
}: DraftQualityPanelProps) {
  const [draftContent, setDraftContent] = useState(initialDraftContent);
  const [breakdown, setBreakdown] = useState<ScoreBreakdown | null>(
    parseBreakdown(initialMetadata),
  );
  const [overallScore, setOverallScore] = useState<number | null>(
    parseOverallScore(initialMetadata),
  );
  const [humanizing, setHumanizing] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(initialDraftContent);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const concerns = buildConcerns(breakdown);
  const wordCount =
    editText.trim().length === 0 ? 0 : editText.trim().split(/\s+/).length;

  async function postHumanize(body: Record<string, unknown>) {
    const res = await fetch(`/api/drafts/${applicationId}/humanize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(
        (payload as { error?: string } | null)?.error ?? "Request failed.",
      );
    }
    return res.json();
  }

  async function handleReHumanize() {
    setHumanizing(true);
    setErrorMsg(null);
    try {
      const data = await postHumanize({});
      setDraftContent(data.draftContent);
      setEditText(data.draftContent);
      setOverallScore(data.humanizationScore);
      setBreakdown(data.scoreBreakdown);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Re-humanize failed.");
    } finally {
      setHumanizing(false);
    }
  }

  function startEditing() {
    setEditText(draftContent);
    setErrorMsg(null);
    setEditing(true);
  }

  async function handleSaveChanges() {
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/drafts/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_content: editText }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          (payload as { error?: string } | null)?.error ?? "Save failed.",
        );
      }
      setDraftContent(editText);
      setEditing(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRescore() {
    setRescoring(true);
    setErrorMsg(null);
    try {
      const data = await postHumanize({ scoreOnly: true });
      setOverallScore(data.humanizationScore);
      setBreakdown(data.scoreBreakdown);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Re-score failed.");
    } finally {
      setRescoring(false);
    }
  }

  return (
    <div
      style={{
        backgroundColor: CARD_BG,
        borderRadius: "10px",
        padding: "16px",
        marginTop: "12px",
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
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: TEXT_MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Draft Quality Analysis
        </span>
        <PanelButton
          onClick={handleReHumanize}
          disabled={humanizing || rescoring || saving}
          loading={humanizing}
          label={humanizing ? "Re-Humanizing..." : "Re-Humanize"}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          marginTop: "14px",
        }}
      >
        <OverallScoreCircle score={overallScore} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            flex: 1,
            minWidth: 0,
          }}
        >
          <ScoreBar label="Human Voice" score={breakdown?.human_voice_authenticity ?? null} />
          <ScoreBar label="Org Specificity" score={breakdown?.organization_specificity ?? null} />
          <ScoreBar label="AI Phrase Absence" score={breakdown?.ai_phrase_absence ?? null} />
          <ScoreBar label="Narrative Flow" score={breakdown?.narrative_flow ?? null} />
        </div>
      </div>

      {concerns.length > 0 && (
        <div
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.4)",
            borderRadius: "8px",
            padding: "10px 12px",
            marginTop: "14px",
          }}
        >
          <p
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: AMBER,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: 0,
            }}
          >
            Remaining Concerns
          </p>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: "16px" }}>
            {concerns.map((concern) => (
              <li key={concern} style={{ fontSize: "12px", color: "#FDE68A", lineHeight: 1.5 }}>
                {concern}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errorMsg && (
        <p style={{ fontSize: "12px", color: RED, marginTop: "10px" }}>{errorMsg}</p>
      )}

      <div style={{ marginTop: "14px" }}>
        {!editing ? (
          <PanelButton onClick={startEditing} label="Edit" variant="secondary" />
        ) : (
          <div>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              style={{
                width: "100%",
                minHeight: "400px",
                backgroundColor: "#FFFFFF",
                color: "#1A2B3C",
                fontSize: "13px",
                lineHeight: 1.6,
                borderRadius: "8px",
                border: "1px solid #B8C9D9",
                padding: "12px",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: "8px",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: "11px", color: TEXT_MUTED }}>
                {wordCount} word{wordCount === 1 ? "" : "s"}
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <PanelButton
                  onClick={() => setEditing(false)}
                  disabled={saving || rescoring}
                  label="Cancel"
                  variant="secondary"
                />
                <PanelButton
                  onClick={handleRescore}
                  disabled={rescoring || saving || draftContent !== editText}
                  loading={rescoring}
                  label={rescoring ? "Re-Scoring..." : "Re-Score"}
                  variant="secondary"
                />
                <PanelButton
                  onClick={handleSaveChanges}
                  disabled={saving || rescoring}
                  loading={saving}
                  label={saving ? "Saving..." : "Save Changes"}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
