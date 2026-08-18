"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Card, Button } from "@/components/ui";
import { useProfile } from "@/lib/hooks/useProfile";

type AutoapplyMode = "manual" | "semi_auto" | "autonomous";

const MODE_LABELS: Record<AutoapplyMode, string> = {
  manual: "Manual",
  semi_auto: "Semi-Auto",
  autonomous: "Autonomous",
};

export function ModeSelector() {
  const { profile } = useProfile();

  const [mode, setMode] = useState<AutoapplyMode>("manual");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAutonomous, setPendingAutonomous] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/autoapply/mode")
      .then((res) => res.json())
      .then((data: { autoapply_mode?: AutoapplyMode }) => {
        if (active && data.autoapply_mode) setMode(data.autoapply_mode);
      })
      .catch(() => {
        if (active) setError("Could not load the current AutoApply mode.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function applyMode(next: AutoapplyMode) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/autoapply/mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoapply_mode: next }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? "Could not update AutoApply mode.");
        return;
      }
      setMode(next);
      setPendingAutonomous(false);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleSelect(next: AutoapplyMode) {
    if (next === mode) return;
    if (next === "autonomous") {
      setPendingAutonomous(true);
      return;
    }
    setPendingAutonomous(false);
    void applyMode(next);
  }

  const isOwner = profile?.role === "owner";

  return (
    <Card
      title="AutoApply Mode"
      description="Controls how much autonomy the AutoApply engine has when submitting applications."
    >
      <div className="flex flex-wrap items-center gap-2">
        {(["manual", "semi_auto", "autonomous"] as AutoapplyMode[])
          .filter((m) => m !== "autonomous" || isOwner)
          .map((m) => (
            <button
              key={m}
              type="button"
              disabled={loading || saving}
              onClick={() => handleSelect(m)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                mode === m
                  ? m === "autonomous"
                    ? "bg-red-600 text-white shadow-sm"
                    : m === "semi_auto"
                      ? "bg-amber-500 text-white shadow-sm"
                      : "bg-teal-600 text-white shadow-sm"
                  : "border border-navy-200 bg-surface text-navy-600 hover:bg-navy-50"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        {saving && <Loader2 className="h-4 w-4 animate-spin text-navy-400" />}
      </div>

      {mode === "semi_auto" && !pendingAutonomous && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Semi-Auto submits applications automatically when field-mapping confidence is high, and pauses for your
          review otherwise.
        </p>
      )}

      {mode === "autonomous" && !pendingAutonomous && (
        <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Autonomous mode submits applications without any human review. Use with caution.
        </p>
      )}

      {pendingAutonomous && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-100 p-4">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Enable Autonomous mode?
          </p>
          <p className="mb-3 text-xs text-red-700">
            AutoApply will fill out and submit applications on this organization&apos;s behalf without pausing for
            human review. This cannot be undone after a submission is sent.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void applyMode("autonomous")}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-800 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirm Autonomous Mode
            </button>
            <Button variant="secondary" onClick={() => setPendingAutonomous(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600">
          {error}
        </p>
      )}
    </Card>
  );
}
