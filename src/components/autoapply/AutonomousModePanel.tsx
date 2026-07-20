"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

interface AutonomousStatus {
  auto_autoapply_enabled: boolean;
  max_nightly_autoapply_submissions: number;
  last_run: { completed_at: string | null; count: number } | null;
  tonight_queue_count: number;
}

// "consultant" is not a real subscription_tier value (migration 002 —
// free/starter/professional/enterprise; see project memory
// benavora-corporate-prospects-no-org-id-adjacent deviation notes and
// worker/autoapply-autonomous-orchestrator.ts §3). Checked anyway to mirror
// the same dead-but-harmless "enterprise or consultant" gate already used on
// /autoapply/usage (UsagePageClient.tsx) rather than diverging from it here.
function isEligiblePlan(tier: string | null): boolean {
  return tier === "enterprise" || tier === "consultant";
}

function nextRunDisplay(): string {
  const nowChicago = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }),
  );
  const next = new Date(nowChicago);
  next.setHours(3, 0, 0, 0);
  if (nowChicago >= next) {
    next.setDate(next.getDate() + 1);
  }
  const formatted = next.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatted} CST`;
}

const cardLabelStyle: CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const cardValueStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "13px",
  fontWeight: 600,
  color: "#0F172A",
};

const infoCardStyle: CSSProperties = {
  backgroundColor: "#F7F5F1",
  border: "1px solid #D9D3C5",
  borderRadius: "10px",
  padding: "12px 14px",
};

export function AutonomousModePanel() {
  const [tier, setTier] = useState<string | null>(null);
  const [status, setStatus] = useState<AutonomousStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sliderValue, setSliderValue] = useState(50);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: orgData }, statusRes] = await Promise.all([
        supabase.from("organizations").select("subscription_tier").single(),
        fetch("/api/autoapply/autonomous-status"),
      ]);
      setTier(
        (orgData as { subscription_tier: string | null } | null)?.subscription_tier ?? null,
      );
      if (statusRes.ok) {
        const json = (await statusRes.json()) as AutonomousStatus;
        setStatus(json);
        setSliderValue(json.max_nightly_autoapply_submissions);
      } else {
        setError("Could not load autonomous AutoApply status.");
      }
    } catch {
      setError("Could not load autonomous AutoApply status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchConfig(patch: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/autonomous/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? "Could not update autonomous settings.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (!status) return;
    await patchConfig({ auto_autoapply_enabled: !status.auto_autoapply_enabled });
  }

  async function handleSliderCommit(value: number) {
    if (status && value === status.max_nightly_autoapply_submissions) return;
    await patchConfig({ max_nightly_autoapply_submissions: value });
  }

  const eligible = isEligiblePlan(tier);

  if (loading) {
    return (
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "12px",
          padding: "24px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          border: "1px solid #E2E8F0",
        }}
      >
        <div className="flex items-center gap-2 text-sm" style={{ color: "#64748B" }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading autonomous mode…
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: "12px",
        padding: "24px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        border: "1px solid #E2E8F0",
      }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A" }}>
            Autonomous Mode
          </h2>
          <p style={{ marginTop: "4px", fontSize: "13px", color: "#64748B" }}>
            Let AutoApply queue and submit standard-form applications overnight, unattended.
          </p>
        </div>
        {!eligible && (
          <span
            style={{
              backgroundColor: "#FEF3C7",
              color: "#B45309",
              border: "1px solid #FDE68A",
              borderRadius: "999px",
              padding: "4px 12px",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
            }}
          >
            Upgrade Required
          </span>
        )}
      </div>

      {!eligible ? (
        <p style={{ marginTop: "16px", fontSize: "13px", color: "#64748B" }}>
          Overnight autonomous submissions are available on the Enterprise plan. Upgrade to
          enable this section.
        </p>
      ) : (
        <div style={{ marginTop: "20px" }} className="space-y-5">
          {/* Toggle row */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "#0F172A" }}>
                Enable Overnight Autonomous Submissions
              </p>
              <p style={{ fontSize: "12px", color: "#64748B", marginTop: "2px" }}>
                Standard-form portals only. Every session still respects the human approval
                checkpoint for anything non-standard.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status?.auto_autoapply_enabled ?? false}
              disabled={saving}
              onClick={() => void handleToggle()}
              style={{
                width: "44px",
                height: "24px",
                borderRadius: "999px",
                backgroundColor: status?.auto_autoapply_enabled ? "#10B981" : "#CBD5E1",
                position: "relative",
                border: "none",
                cursor: saving ? "not-allowed" : "pointer",
                flexShrink: 0,
                transition: "background-color 0.15s ease",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "3px",
                  left: status?.auto_autoapply_enabled ? "23px" : "3px",
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  backgroundColor: "#FFFFFF",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  transition: "left 0.15s ease",
                }}
              />
            </button>
          </div>

          {/* Max nightly submissions slider */}
          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="maxNightlySlider"
                style={{ fontSize: "13px", fontWeight: 600, color: "#0F172A" }}
              >
                Max Nightly Submissions
              </label>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#0077B6" }}>
                {sliderValue}
              </span>
            </div>
            <input
              id="maxNightlySlider"
              type="range"
              min={10}
              max={400}
              step={10}
              value={sliderValue}
              disabled={saving}
              onChange={(e) => setSliderValue(Number(e.target.value))}
              onMouseUp={() => void handleSliderCommit(sliderValue)}
              onTouchEnd={() => void handleSliderCommit(sliderValue)}
              style={{ width: "100%", marginTop: "8px", accentColor: "#0077B6" }}
            />
            <div className="flex items-center justify-between" style={{ marginTop: "2px" }}>
              <span style={{ fontSize: "11px", color: "#94A3B8" }}>10</span>
              <span style={{ fontSize: "11px", color: "#94A3B8" }}>400</span>
            </div>
          </div>

          {/* Schedule / last run / next run */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" style={{ marginTop: "8px" }}>
            <div style={infoCardStyle}>
              <p style={cardLabelStyle}>Schedule</p>
              <p style={cardValueStyle}>Nightly at 3:00 AM CST</p>
            </div>
            <div style={infoCardStyle}>
              <p style={cardLabelStyle}>Last Run</p>
              <p style={cardValueStyle}>
                {status?.last_run?.completed_at
                  ? `${new Date(status.last_run.completed_at).toLocaleString()} — ${status.last_run.count} queued`
                  : "No runs yet"}
              </p>
            </div>
            <div style={infoCardStyle}>
              <p style={cardLabelStyle}>Next Run</p>
              <p style={cardValueStyle}>
                {status?.auto_autoapply_enabled ? nextRunDisplay() : "Disabled"}
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ marginTop: "16px", fontSize: "12px", color: "#DC2626" }}>
          {error}
        </p>
      )}
    </div>
  );
}
