"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Mail, RefreshCw } from "lucide-react";

import { Badge, Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { FOLLOW_UP_NOTE_PREFIX } from "@/lib/agents/follow-up-generator";
import type { FollowUpStep, FollowUpStepType, FollowUpStoredPayload } from "@/lib/agents/follow-up-generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FollowUpRecord {
  noteId: string;
  applicationId: string;
  sequence: FollowUpStoredPayload;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_LABEL: Record<FollowUpStepType, string> = {
  thank_you: "Thank You",
  check_in: "Check-In",
  status_request: "Status Request",
};

const STEP_COLOR: Record<FollowUpStepType, BadgeColor> = {
  thank_you: "green",
  check_in: "blue",
  status_request: "purple",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FollowUpsPage() {
  const [records, setRecords] = useState<FollowUpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { data, error: notesError } = await supabase
      .from("notes")
      .select("id, application_id, content, created_at")
      .like("content", `${FOLLOW_UP_NOTE_PREFIX}%`)
      .order("created_at", { ascending: false });

    if (notesError) {
      setError("Could not load follow-up sequences.");
      setLoading(false);
      return;
    }

    const parsed: FollowUpRecord[] = [];
    for (const row of data ?? []) {
      const note = row as {
        id: string;
        application_id: string | null;
        content: string;
        created_at: string;
      };
      if (!note.application_id) continue;
      try {
        const json = note.content.slice(FOLLOW_UP_NOTE_PREFIX.length);
        const seq = JSON.parse(json) as FollowUpStoredPayload;
        if (!seq.steps || !Array.isArray(seq.steps)) continue;
        parsed.push({
          noteId: note.id,
          applicationId: note.application_id,
          sequence: seq,
          createdAt: note.created_at,
        });
      } catch {
        // skip unparseable notes silently
      }
    }

    setRecords(parsed);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copyToClipboard = useCallback(
    async (stepId: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(stepId);
        setTimeout(() => setCopied((prev) => (prev === stepId ? null : prev)), 2000);
      } catch {
        // clipboard not available
      }
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-red-400">{error}</div>;
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Follow-Up Sequences</h1>
          <p className="mt-1 text-sm text-slate-400">
            Humanized follow-up emails generated for submitted applications.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No follow-up sequences yet"
          description="Generate a sequence by calling POST /api/agents/follow-up with an application_id."
        />
      ) : (
        <div className="space-y-8">
          {records.map((record) => (
            <SequenceCard
              key={record.noteId}
              record={record}
              copied={copied}
              onCopy={copyToClipboard}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SequenceCard
// ---------------------------------------------------------------------------

interface SequenceCardProps {
  record: FollowUpRecord;
  copied: string | null;
  onCopy: (stepId: string, text: string) => Promise<void>;
}

function SequenceCard({ record, copied, onCopy }: SequenceCardProps) {
  const { sequence, createdAt } = record;
  const generatedDate = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">
            {sequence.opportunityName}
          </h2>
          <p className="text-sm text-slate-400">
            {sequence.funderName} &middot; Generated {generatedDate}
          </p>
        </div>
        <Badge color="teal">{sequence.steps.length} steps</Badge>
      </div>

      <div className="space-y-4">
        {sequence.steps.map((step) => (
          <StepRow
            key={step.stepNumber}
            step={step}
            noteId={record.noteId}
            copied={copied}
            onCopy={onCopy}
          />
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// StepRow
// ---------------------------------------------------------------------------

interface StepRowProps {
  step: FollowUpStep;
  noteId: string;
  copied: string | null;
  onCopy: (stepId: string, text: string) => Promise<void>;
}

function StepRow({ step, noteId, copied, onCopy }: StepRowProps) {
  const stepId = `${noteId}-${step.stepNumber}`;
  const isCopied = copied === stepId;
  const fullText = `Subject: ${step.subject}\n\n${step.body}`;

  return (
    <div className="rounded-lg border border-slate-700 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-slate-500">
            Day {step.delayDays}
          </span>
          <Badge color={STEP_COLOR[step.type] ?? "gray"}>
            {STEP_LABEL[step.type] ?? step.type}
          </Badge>
          <span className="text-xs text-slate-600">
            Humanization: {step.humanizationScore}/100
          </span>
        </div>
        <button
          onClick={() => void onCopy(stepId, fullText)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
          aria-label="Copy email to clipboard"
        >
          {isCopied ? (
            <>
              <Check className="h-3 w-3 text-green-400" />
              <span className="text-green-400">Copied</span>
            </>
          ) : (
            "Copy"
          )}
        </button>
      </div>
      <p className="mb-1 text-sm font-medium text-white">{step.subject}</p>
      <p className="line-clamp-4 whitespace-pre-wrap text-sm text-slate-400">
        {step.body}
      </p>
    </div>
  );
}
