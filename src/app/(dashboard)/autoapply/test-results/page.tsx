"use client";

// AutoApply test-results dashboard — shows the org's last 10
// autoapply_submissions rows (the real table; `autoapply_sessions` does not
// exist in this schema) so a manual test run's outcome (submitted /
// captcha_blocked / account_required / site_error / failed / queued /
// in_progress / already_submitted — see supabase/migrations/045 and 051's
// CHECK constraint + worker/queue-processor.ts's classifyError()) can be
// reviewed without a database client. Every color on this page is an inline
// hex value per BLUEPRINT_v2.md §7.5 — no CSS variables, no Tailwind color
// classes.

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

interface SubmissionRow {
  id: string;
  status: string;
  request_description: string | null;
  confirmation_number: string | null;
  confirmation_screenshot_url: string | null;
  pre_submit_screenshot_url: string | null;
  error_screenshot_url: string | null;
  error_message: string | null;
  submission_channel: string | null;
  submitted_at: string | null;
  created_at: string;
  funders: { name: string | null; giving_portal_url: string | null } | null;
}

interface StatusStyle {
  label: string;
  color: string;
  background: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  submitted: { label: "Submitted", color: "#10B981", background: "#ECFDF5" },
  already_submitted: { label: "Already Submitted", color: "#10B981", background: "#ECFDF5" },
  account_required: { label: "Pending Verification", color: "#F59E0B", background: "#FFFBEB" },
  captcha_blocked: { label: "CAPTCHA Blocked", color: "#EF4444", background: "#FEF2F2" },
  site_error: { label: "Site Error", color: "#EF4444", background: "#FEF2F2" },
  failed: { label: "Failed", color: "#6B7280", background: "#F9FAFB" },
  queued: { label: "Queued", color: "#0077B6", background: "#EFF8FC" },
  in_progress: { label: "In Progress", color: "#0077B6", background: "#EFF8FC" },
};

function statusStyle(status: string): StatusStyle {
  return (
    STATUS_STYLES[status] ?? { label: status, color: "#6B7280", background: "#F9FAFB" }
  );
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(createdAt: string, submittedAt: string | null): string {
  if (!submittedAt) return "—";
  const startMs = new Date(createdAt).getTime();
  const endMs = new Date(submittedAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return "—";
  const totalSeconds = Math.round((endMs - startMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function screenshotFor(row: SubmissionRow): string | null {
  return row.confirmation_screenshot_url ?? row.error_screenshot_url ?? row.pre_submit_screenshot_url;
}

export default function AutoApplyTestResultsPage() {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [prospectUrl, setProspectUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const supabase = createClient();
    try {
      const { data, error: err } = await supabase
        .from("autoapply_submissions")
        .select(
          "id, status, request_description, confirmation_number, confirmation_screenshot_url, pre_submit_screenshot_url, error_screenshot_url, error_message, submission_channel, submitted_at, created_at, funders(name, giving_portal_url)",
        )
        .order("created_at", { ascending: false })
        .limit(10);
      if (err) throw err;
      setRows((data ?? []) as unknown as SubmissionRow[]);
    } catch {
      setError("Could not load AutoApply test results.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRunTest() {
    if (!prospectUrl.trim()) {
      setRunError("Enter a portal URL to test.");
      return;
    }
    setRunning(true);
    setRunError(null);
    setRunNotice(null);
    try {
      const res = await fetch("/api/autoapply/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospectUrl: prospectUrl.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunError((payload as { error?: string }).error ?? "Failed to queue test.");
        return;
      }
      setRunNotice(
        (payload as { message?: string }).message ?? "Test submission queued.",
      );
      setProspectUrl("");
      setLoading(true);
      await load();
    } catch {
      setRunError("Could not reach the AutoApply test service.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "28px",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "#0F172A",
              margin: 0,
            }}
          >
            AutoApply Test Results
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", margin: "6px 0 0" }}>
            Last 10 AutoApply submission attempts for your organization.
          </p>
        </div>
      </div>

      {/* Run New Test panel */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "16px",
          padding: "20px 24px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          marginBottom: "24px",
        }}
      >
        <p
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: "0 0 12px",
          }}
        >
          Run New Test
        </p>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="url"
            value={prospectUrl}
            onChange={(e) => setProspectUrl(e.target.value)}
            placeholder="https://www.example.com/nonprofits"
            style={{
              flex: "1 1 320px",
              padding: "10px 14px",
              borderRadius: "10px",
              border: "1px solid #B8C9D9",
              fontSize: "14px",
              color: "#0F172A",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => void handleRunTest()}
            disabled={running}
            style={{
              backgroundColor: running ? "#94A3B8" : "#0077B6",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "10px",
              padding: "11px 22px",
              fontSize: "14px",
              fontWeight: 700,
              cursor: running ? "default" : "pointer",
            }}
          >
            {running ? "Queueing…" : "Run New Test"}
          </button>
        </div>
        {runNotice && (
          <p style={{ fontSize: "13px", color: "#10B981", margin: "12px 0 0", fontWeight: 600 }}>
            {runNotice}
          </p>
        )}
        {runError && (
          <p style={{ fontSize: "13px", color: "#EF4444", margin: "12px 0 0", fontWeight: 600 }}>
            {runError}
          </p>
        )}
        <p style={{ fontSize: "12px", color: "#94A3B8", margin: "10px 0 0" }}>
          This queues the submission only. The result appears below once the AutoApply worker
          has processed it.
        </p>
      </div>

      {/* Content */}
      {error ? (
        <div
          style={{
            backgroundColor: "#FEF2F2",
            border: "1px solid #FCA5A5",
            borderRadius: "12px",
            padding: "20px",
            color: "#DC2626",
            fontSize: "14px",
          }}
        >
          {error}
        </div>
      ) : loading ? (
        <div style={{ display: "grid", gap: "16px" }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: "16px",
                height: "120px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
                opacity: 0.6,
              }}
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "16px",
            padding: "48px 24px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          }}
        >
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", margin: "0 0 6px" }}>
            No AutoApply test results yet
          </p>
          <p style={{ fontSize: "14px", color: "#64748B", margin: 0 }}>
            Run a new test above, or queue one with{" "}
            <code style={{ fontSize: "13px" }}>pnpm test:autoapply</code>.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "16px" }}>
          {rows.map((row) => {
            const style = statusStyle(row.status);
            const companyName = row.funders?.name ?? "Unknown Funder";
            const portalUrl = row.funders?.giving_portal_url;
            const screenshot = screenshotFor(row);
            const duration = formatDuration(row.created_at, row.submitted_at);

            return (
              <div
                key={row.id}
                style={{
                  backgroundColor: "#FFFFFF",
                  borderRadius: "16px",
                  padding: "20px 24px",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                  display: "flex",
                  gap: "20px",
                  flexWrap: "wrap",
                }}
              >
                {screenshot && (
                  <a
                    href={screenshot}
                    target="_blank"
                    rel="noreferrer"
                    style={{ flex: "0 0 160px" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={screenshot}
                      alt={`${companyName} submission screenshot`}
                      style={{
                        width: "160px",
                        height: "110px",
                        objectFit: "cover",
                        borderRadius: "10px",
                        border: "1px solid #E2E8F0",
                      }}
                    />
                  </a>
                )}

                <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      flexWrap: "wrap",
                      marginBottom: "8px",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "16px",
                        fontWeight: 700,
                        color: "#0F172A",
                        margin: 0,
                      }}
                    >
                      {companyName}
                    </p>
                    <span
                      style={{
                        backgroundColor: style.background,
                        color: style.color,
                        fontSize: "11px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        padding: "4px 10px",
                        borderRadius: "999px",
                      }}
                    >
                      {style.label}
                    </span>
                    {row.submission_channel && (
                      <span style={{ fontSize: "12px", color: "#94A3B8" }}>
                        via {row.submission_channel}
                      </span>
                    )}
                  </div>

                  {portalUrl && (
                    <p
                      style={{
                        fontSize: "12px",
                        color: "#64748B",
                        margin: "0 0 8px",
                        wordBreak: "break-all",
                      }}
                    >
                      {portalUrl}
                    </p>
                  )}

                  {row.status === "submitted" && row.confirmation_number && (
                    <p style={{ fontSize: "13px", color: "#0F172A", margin: "0 0 6px" }}>
                      Confirmation #: <strong>{row.confirmation_number}</strong>
                    </p>
                  )}

                  {row.error_message && (
                    <p
                      style={{
                        fontSize: "13px",
                        color: "#EF4444",
                        margin: "0 0 6px",
                        wordBreak: "break-word",
                      }}
                    >
                      {row.error_message}
                    </p>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: "16px",
                      fontSize: "12px",
                      color: "#94A3B8",
                      marginTop: "8px",
                    }}
                  >
                    <span>Queued: {formatDateTime(row.created_at)}</span>
                    <span>Duration: {duration}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
