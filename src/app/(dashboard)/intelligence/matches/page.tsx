"use client";

// Semantic Funder Matches page — runs the semantic-matching agent and shows
// the ranked list of funders with alignment scores and reasoning.

import { useState } from "react";
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";

import { useProfile, canEdit } from "@/lib/hooks/useProfile";

interface FunderMatch {
  funderId: string;
  funderName: string;
  score: number;
  reasoning: string;
}

interface MatchResponse {
  matches: FunderMatch[];
  tokensUsed?: number;
  error?: string;
}

function ScoreBadge({ score }: { score: number }) {
  let colorClass = "bg-green-100 text-green-700";
  if (score < 60) colorClass = "bg-yellow-100 text-yellow-700";
  if (score < 40) colorClass = "bg-red-100 text-red-700";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${colorClass}`}
    >
      {score}%
    </span>
  );
}

export default function MatchesPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [matches, setMatches] = useState<FunderMatch[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  async function handleRun() {
    if (!editable || running) return;
    setRunning(true);
    setError(null);

    try {
      const res = await fetch("/api/agents/semantic-matching", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topN: 20 }),
      });
      const payload = (await res.json().catch(() => ({}))) as MatchResponse;
      if (!res.ok) {
        setError(payload.error ?? "The semantic matching agent failed. Please try again.");
      } else {
        setMatches(payload.matches ?? []);
        setRan(true);
      }
    } catch {
      setError("Could not reach the semantic matching agent.");
    }

    setRunning(false);
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Semantic Funder Matches
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Claude scores each funder by how well your mission, programs, and service area
            align with their priorities and geographic focus.
          </p>
        </div>
        {editable && (
          <button
            onClick={() => void handleRun()}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {running ? "Analyzing…" : "Run Analysis"}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Empty / not-yet-run state */}
      {!running && !ran && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-navy-200 bg-navy-50 py-20 text-center">
          <Sparkles className="mb-4 h-10 w-10 text-navy-300" />
          <p className="text-base font-semibold text-navy-700">
            No match analysis yet
          </p>
          <p className="mt-2 max-w-sm text-sm text-navy-500">
            Click &ldquo;Run Analysis&rdquo; to score each of your funders by semantic alignment
            with your organization profile.
          </p>
        </div>
      )}

      {/* Empty after run */}
      {ran && matches.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-navy-200 bg-navy-50 py-20 text-center">
          <Sparkles className="mb-4 h-10 w-10 text-navy-300" />
          <p className="text-base font-semibold text-navy-700">No strong matches found</p>
          <p className="mt-2 max-w-sm text-sm text-navy-500">
            No funders scored above 40%. Add funder profiles or enrich funder intelligence
            to improve match accuracy.
          </p>
        </div>
      )}

      {/* Results */}
      {matches.length > 0 && (
        <div className="rounded-xl border border-navy-200 bg-white">
          <div className="divide-y divide-navy-100">
            {matches.map((match, index) => (
              <div key={match.funderId} className="flex items-start gap-4 px-5 py-4">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-600">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-navy-900">{match.funderName}</p>
                    <ScoreBadge score={match.score} />
                  </div>
                  <p className="mt-1 text-sm text-navy-600">{match.reasoning}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
