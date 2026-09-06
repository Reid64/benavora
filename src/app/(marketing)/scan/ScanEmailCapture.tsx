"use client";

import { useState, type CSSProperties } from "react";

import { Display2 } from "@/components/marketing/Section";
import { mk, mkRadius } from "@/lib/marketing/theme";
import { SCAN_REPORT_ACTIONS, type ScanReportAction } from "@/lib/scan/constants";
import type { FundingPotentialScanResult } from "@/lib/scan/scoring-engine";

// Post-report email capture card. Rendered as the last card in ScanReport.tsx,
// after every section of the free report - per the reciprocity principle
// documented there, the report above is already fully visible without an
// email. This card's email ask is only for delivering/saving/sharing a copy
// of that same content (matches the task's "required only to receive the
// complete report as a saved or emailed document").
//
// Three of the four outline options POST to /api/public/scan/capture and are
// stored in scan_report_requests (supabase/migrations/173_scan_report_
// requests.sql) for follow-up. The fourth, "review with a strategist", is a
// plain link to the real /demo booking page (content/marketing/demo.mdx) -
// it needs no email and captures nothing, since it isn't a report-delivery
// action.

const ERROR_COLOR = "#EF4444"; // governance/DESIGN_SYSTEM.md Accent-Red

const cardStyle: CSSProperties = {
  background: mk.surface,
  borderRadius: mkRadius.card,
  padding: 28,
  border: `1px solid ${mk.line}`,
  marginTop: 28,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: 8,
  border: `1px solid ${mk.line}`,
  background: mk.surface,
  color: mk.ink,
  fontSize: 16,
  fontFamily: "inherit",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontWeight: 600,
  fontSize: 14,
  color: mk.ink,
  marginBottom: 6,
};

const actionButtonStyle = (disabled: boolean): CSSProperties => ({
  display: "block",
  width: "100%",
  textAlign: "left",
  background: disabled ? mk.tint : mk.surface,
  color: mk.forest,
  borderRadius: 8,
  padding: "14px 16px",
  fontWeight: 600,
  fontSize: 15,
  border: `1px solid ${mk.line}`,
  cursor: disabled ? "default" : "pointer",
});

const strategistLinkStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  textAlign: "left",
  background: mk.terracotta,
  color: "#FFFFFF",
  borderRadius: 8,
  padding: "14px 16px",
  fontWeight: 600,
  fontSize: 15,
  border: "none",
  textDecoration: "none",
};

const ACTION_CONFIRMATIONS: Record<ScanReportAction, string> = {
  email_report: "Sent - check your inbox for the complete report.",
  save_profile: "Saved. We'll keep this funding profile on file under your email.",
  share_board: "Sent to you and the board emails you listed.",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ScanEmailCaptureProps = {
  scanSubmissionId: string;
  orgNameOrWebsite: string;
  result: FundingPotentialScanResult;
};

export default function ScanEmailCapture({
  scanSubmissionId,
  orgNameOrWebsite,
  result,
}: ScanEmailCaptureProps) {
  const [email, setEmail] = useState("");
  const [boardEmailsRaw, setBoardEmailsRaw] = useState("");
  const [hpToken, setHpToken] = useState("");

  const [emailError, setEmailError] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ScanReportAction | null>(null);
  const [completed, setCompleted] = useState<Partial<Record<ScanReportAction, string>>>({});

  async function runAction(action: ScanReportAction) {
    if (pendingAction) return;

    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);

    let boardEmails: string[] | undefined;
    if (action === "share_board") {
      boardEmails = boardEmailsRaw
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
      const invalid = boardEmails.filter((e) => !EMAIL_PATTERN.test(e));
      if (boardEmails.length === 0) {
        setBoardError("Enter at least one board member email, separated by commas.");
        return;
      }
      if (invalid.length > 0) {
        setBoardError(`Not a valid email: ${invalid[0]}`);
        return;
      }
    }
    setBoardError(null);

    setSubmitError(null);
    setPendingAction(action);
    try {
      const res = await fetch("/api/public/scan/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanSubmissionId,
          orgNameOrWebsite,
          email: trimmedEmail,
          action,
          boardEmails,
          score: result.score,
          tier: result.tier,
          categoriesConsidered: result.categoriesConsidered,
          matchedCount: result.matchedCount,
          degraded: result.degraded,
          amountMin: result.amountRange?.min ?? null,
          amountMax: result.amountRange?.max ?? null,
          hpToken: hpToken || undefined,
        }),
      });

      if (!res.ok) {
        setSubmitError("We couldn't complete that request. Please try again.");
        return;
      }

      const body: { ok: boolean; emailSent: boolean } = await res.json();
      if (!body.ok) {
        setSubmitError("We couldn't complete that request. Please try again.");
        return;
      }

      const needsEmail = action === "email_report" || action === "share_board";
      const message =
        needsEmail && !body.emailSent
          ? "Saved - but we couldn't send the email right now. We'll follow up directly."
          : ACTION_CONFIRMATIONS[action];
      setCompleted((prev) => ({ ...prev, [action]: message }));
    } catch {
      setSubmitError("We couldn't complete that request. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div style={cardStyle}>
      <Display2>Get this as a document</Display2>
      <p style={{ color: mk.muted, fontSize: 14, marginTop: 16, maxWidth: 640 }}>
        The report above is already yours to read - no email required. Add your email below only if
        you want a copy delivered, saved, or shared.
      </p>

      <div
        aria-hidden="true"
        style={{ position: "absolute", left: -9999, top: -9999, height: 0, overflow: "hidden" }}
      >
        <label htmlFor="scan_capture_hp">Leave this field blank</label>
        <input
          id="scan_capture_hp"
          name="scan_capture_hp"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={hpToken}
          onChange={(e) => setHpToken(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 20, maxWidth: 420 }}>
        <label style={labelStyle} htmlFor="captureEmail">
          Email address
        </label>
        <input
          id="captureEmail"
          name="captureEmail"
          type="email"
          style={inputStyle}
          value={email}
          maxLength={200}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourorganization.org"
        />
        {emailError && <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>{emailError}</p>}
      </div>

      <div style={{ marginTop: 16, maxWidth: 420 }}>
        <label style={labelStyle} htmlFor="boardEmails">
          Board member emails{" "}
          <span style={{ fontWeight: 400, color: mk.muted }}>
            (optional, comma-separated - only used if you share with your board)
          </span>
        </label>
        <input
          id="boardEmails"
          name="boardEmails"
          type="text"
          style={inputStyle}
          value={boardEmailsRaw}
          maxLength={500}
          onChange={(e) => setBoardEmailsRaw(e.target.value)}
          placeholder="chair@board.org, treasurer@board.org"
        />
        {boardError && <p style={{ color: ERROR_COLOR, fontSize: 13, marginTop: 6 }}>{boardError}</p>}
      </div>

      {submitError && <p style={{ color: ERROR_COLOR, fontSize: 14, marginTop: 16 }}>{submitError}</p>}

      <div style={{ display: "grid", gap: 12, marginTop: 24, maxWidth: 420 }}>
        {SCAN_REPORT_ACTIONS.map((a) => (
          <div key={a.value}>
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={() => runAction(a.value)}
              style={actionButtonStyle(pendingAction !== null)}
            >
              {pendingAction === a.value ? "Working..." : a.label}
            </button>
            {completed[a.value] && (
              <p style={{ color: mk.forest, fontSize: 13, marginTop: 6, fontWeight: 600 }}>
                {completed[a.value]}
              </p>
            )}
          </div>
        ))}

        <a href="/demo" style={strategistLinkStyle}>
          Review it with a Benavora strategist
        </a>
      </div>
    </div>
  );
}
