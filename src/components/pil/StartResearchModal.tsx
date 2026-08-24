"use client";

import { useState } from "react";

import { Button, Modal, Select } from "@/components/ui";

const PLUM = "#5B21B6";

const DEPTH_OPTIONS = [
  { value: "shallow", label: "Shallow" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep" },
];

export interface StartResearchModalProps {
  prospectId: string | null;
  prospectName: string;
  onClose: (startedRunId: string | null) => void;
}

/** POST /api/pil/research with a goal + depth. Shared by the prospect list's
 * quick action and the dossier's Actions tab — same call, same body shape. */
export function StartResearchModal({ prospectId, prospectName, onClose }: StartResearchModalProps) {
  const [goal, setGoal] = useState(`Deepen intelligence on ${prospectName}`);
  const [depth, setDepth] = useState("standard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!goal.trim()) {
      setError("A research goal is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pil/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospectId,
          goal,
          depthTarget: DEPTH_OPTIONS.findIndex((d) => d.value === depth) + 1,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !payload.runId) {
        setError(payload.error ?? "Could not start research.");
        setSubmitting(false);
        return;
      }
      onClose(payload.runId);
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(null)}
      title={`Start Research — ${prospectName}`}
      description="Kicks off a new pil_research_runs row for this prospect."
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose(null)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} isLoading={submitting} style={{ backgroundColor: PLUM }}>
            Start Research
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="research-goal">
            Research goal
          </label>
          <textarea
            id="research-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="block w-full rounded-lg border border-slate-200 bg-surface px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-[#5B21B6] focus:ring-2 focus:ring-[#5B21B6]/10"
          />
        </div>
        <Select label="Depth" options={DEPTH_OPTIONS} value={depth} onChange={(e) => setDepth(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
