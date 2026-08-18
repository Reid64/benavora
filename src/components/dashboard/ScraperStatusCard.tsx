"use client";

// Foundation directory scraper status — small bespoke card in the AI
// Triggers panel (STANDING_DIRECTIVES.md Directive 1), same pattern as the
// AutoApply Engine card already in that panel: not part of the uniform
// AiTrigger post/link shape (AiTriggerPanel.tsx), because this card needs
// live progress data fetched from /api/scraper/status rather than a single
// static yield line computed once server-side.

import { useEffect, useState } from "react";
import Link from "next/link";

interface ScraperStatus {
  lastRunAt: string | null;
  totalFoundations: number;
  totalEnriched: number;
  enrichmentRate: number;
  scraperEnabled: boolean;
  nextScheduledRun: string | null;
}

type FetchState = "loading" | "done" | "error";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "No run recorded yet";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ScraperStatusCard() {
  const [state, setState] = useState<FetchState>("loading");
  const [status, setStatus] = useState<ScraperStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scraper/status")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ScraperStatus) => {
        if (cancelled) return;
        setStatus(data);
        setState("done");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pct = status ? Math.round(status.enrichmentRate * 100) : 0;

  return (
    <div
      style={{
        backgroundColor: "rgba(16,27,45,0.04)",
        border: "1px solid rgba(16,27,45,0.08)",
        borderLeft: "2px solid #10B981",
        borderRadius: "10px",
        padding: "12px 14px",
        marginBottom: "8px",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#101B2D", marginBottom: "4px" }}>
        Foundation Scraper
      </div>

      {state === "loading" && (
        <div style={{ fontSize: "11px", color: "rgba(16,27,45,0.55)" }}>Loading status…</div>
      )}
      {state === "error" && (
        <div style={{ fontSize: "11px", color: "#EF4444" }}>Could not load scraper status.</div>
      )}

      {state === "done" && status && (
        <>
          <div style={{ fontSize: "11px", color: "rgba(16,27,45,0.55)", marginBottom: "6px", lineHeight: 1.4 }}>
            {status.totalEnriched.toLocaleString()} / {status.totalFoundations.toLocaleString()} foundations have a
            website on file
          </div>

          <div
            style={{
              backgroundColor: "rgba(16,27,45,0.08)",
              borderRadius: "4px",
              overflow: "hidden",
              height: "6px",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                backgroundColor: "#10B981",
                borderRadius: "4px",
              }}
            />
          </div>

          <div style={{ fontSize: "12px", fontWeight: 700, color: "#10B981", marginBottom: "6px" }}>
            {pct}% enriched
          </div>

          <div style={{ fontSize: "11px", color: "rgba(16,27,45,0.55)", marginBottom: "2px" }}>
            Last run: {formatTimestamp(status.lastRunAt)}
          </div>
          <div style={{ fontSize: "11px", color: "rgba(16,27,45,0.55)", marginBottom: "8px" }}>
            {status.scraperEnabled
              ? `Next run: ${formatTimestamp(status.nextScheduledRun)}`
              : "Weekly run disabled (ENABLE_SCRAPER is not set)"}
          </div>
        </>
      )}

      <Link
        href="/foundations"
        style={{
          display: "inline-block",
          background: "linear-gradient(135deg,#10B981,#059669)",
          color: "#F8F5EE",
          borderRadius: "6px",
          padding: "6px 12px",
          fontSize: "11px",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        View Foundations
      </Link>
    </div>
  );
}
