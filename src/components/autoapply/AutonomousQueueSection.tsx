"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Moon } from "lucide-react";

interface AutonomousStatus {
  auto_autoapply_enabled: boolean;
  max_nightly_autoapply_submissions: number;
  last_run: { completed_at: string | null; count: number } | null;
  tonight_queue_count: number;
}

function estimateCompletion(queueCount: number): string {
  if (queueCount === 0) return "—";
  // Matches the AutoApply rate-limit window documented in
  // WORKER_ARCHITECTURE_v2.md §10: 60-120s (avg ~90s) between submissions.
  const totalMinutes = Math.round((queueCount * 90) / 60);
  if (totalMinutes < 60) return `~${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `~${hours}h` : `~${hours}h ${minutes}m`;
}

/** Renders only while a nightly autonomous batch is actively being worked
 * (i.e. there's a tonight queue and the org hasn't yet had a run complete
 * since it was populated) — a lightweight, no-extra-fetch progress cue built
 * from the same status payload rather than a second polling source. */
function BatchProgress({ status }: { status: AutonomousStatus }) {
  if (status.tonight_queue_count === 0) return null;

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-5 py-4"
      style={{ backgroundColor: "#ECFDF5", border: "1px solid #A7F3D0" }}
    >
      <span
        className="animate-pulse"
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: "#10B981",
          flexShrink: 0,
        }}
        aria-hidden
      />
      <span style={{ fontSize: "13px", fontWeight: 700, color: "#065F46" }}>
        Autonomous batch in progress — {status.tonight_queue_count} submission
        {status.tonight_queue_count === 1 ? "" : "s"} remaining tonight, estimated completion{" "}
        {estimateCompletion(status.tonight_queue_count)}
      </span>
    </div>
  );
}

export function AutonomousQueueSection() {
  const [status, setStatus] = useState<AutonomousStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/autoapply/autonomous-status");
      if (res.ok) {
        setStatus((await res.json()) as AutonomousStatus);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 60_000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading || !status) return null;

  if (!status.auto_autoapply_enabled) {
    return (
      <div
        className="flex items-center justify-between gap-4 flex-wrap"
        style={{
          backgroundColor: "#F7F5F1",
          border: "1px solid #D9D3C5",
          borderRadius: "12px",
          padding: "16px 20px",
        }}
      >
        <div className="flex items-center gap-2">
          <Moon className="h-4 w-4" style={{ color: "#64748B" }} aria-hidden />
          <span style={{ fontSize: "13px", color: "#64748B" }}>
            Autonomous overnight submissions are disabled for this organization.
          </span>
        </div>
        <Link
          href="/autoapply/controls"
          style={{ fontSize: "12px", fontWeight: 700, color: "#0077B6" }}
          className="hover:underline"
        >
          Configure Autonomous Mode
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "12px",
          padding: "20px 24px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          border: "1px solid #E2E8F0",
        }}
      >
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Moon className="h-4 w-4" style={{ color: "#023E8A" }} aria-hidden />
            <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#0F172A" }}>
              Autonomous Queue — Tonight
            </h3>
          </div>
          <Link
            href="/autoapply/controls"
            style={{ fontSize: "12px", fontWeight: 700, color: "#0077B6" }}
            className="hover:underline"
          >
            Manage Settings
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" style={{ marginTop: "16px" }}>
          <div
            style={{
              backgroundColor: "#F7F5F1",
              border: "1px solid #D9D3C5",
              borderRadius: "10px",
              padding: "12px 14px",
            }}
          >
            <p
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#64748B",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Queued Tonight
            </p>
            <p style={{ marginTop: "4px", fontSize: "20px", fontWeight: 900, color: "#0F172A" }}>
              {status.tonight_queue_count}
            </p>
          </div>
          <div
            style={{
              backgroundColor: "#F7F5F1",
              border: "1px solid #D9D3C5",
              borderRadius: "10px",
              padding: "12px 14px",
            }}
          >
            <p
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#64748B",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Status
            </p>
            <p style={{ marginTop: "4px", fontSize: "13px", fontWeight: 600, color: "#0F172A" }}>
              {status.tonight_queue_count > 0 ? "Processing" : "Idle — nothing queued"}
            </p>
          </div>
          <div
            style={{
              backgroundColor: "#F7F5F1",
              border: "1px solid #D9D3C5",
              borderRadius: "10px",
              padding: "12px 14px",
            }}
          >
            <p
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#64748B",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Est. Completion
            </p>
            <p style={{ marginTop: "4px", fontSize: "13px", fontWeight: 600, color: "#0F172A" }}>
              {estimateCompletion(status.tonight_queue_count)}
            </p>
          </div>
        </div>
      </div>

      <BatchProgress status={status} />
    </div>
  );
}
