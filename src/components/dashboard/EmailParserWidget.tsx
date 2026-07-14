"use client";

import { useState } from "react";
import { Mail, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import type { ParsedEmailResult, EmailType } from "@/lib/agents/email-parser";

// Badge variant keyed by email type.
const TYPE_STYLES: Record<EmailType, { variant: BadgeVariant; label: string }> = {
  award_notification: {
    variant: "success",
    label: "Award",
  },
  rejection: { variant: "error", label: "Rejection" },
  acknowledgment: { variant: "info", label: "Acknowledgment" },
  information_request: {
    variant: "warning",
    label: "Info Request",
  },
  follow_up: { variant: "info", label: "Follow-up" },
  general: { variant: "neutral", label: "General" },
};

const URGENCY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-yellow-500",
  low: "bg-green-500",
};

interface ParseResult {
  runId: string | null;
  processed: number;
  results: ParsedEmailResult[];
  tokensUsed: number;
  durationMs: number;
}

export function EmailParserWidget() {
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  async function handleParse() {
    setError(null);
    setResult(null);

    if (!from.trim()) {
      setError("From address is required.");
      return;
    }
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (!body.trim()) {
      setError("Email body is required.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/agents/email-parser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: [{ from: from.trim(), subject: subject.trim(), body: body.trim() }],
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Parsing failed. Please try again.");
        return;
      }

      setResult(data as ParseResult);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setFrom("");
    setSubject("");
    setBody("");
    setResult(null);
    setError(null);
  }

  const parsed = result?.results[0] ?? null;

  return (
    <div className="space-y-4">
      {/* Input form */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-navy-700 mb-1">
            From
          </label>
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="sender@foundation.org"
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-navy-700 mb-1">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="RE: Your Grant Application"
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-navy-700 mb-1">
            Email Body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste the email content here..."
            rows={6}
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-y"
            disabled={loading}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleParse}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Parsing...
            </>
          ) : (
            <>
              <Mail className="h-4 w-4" aria-hidden />
              Parse Email
            </>
          )}
        </button>

        {(result || error) && (
          <button
            type="button"
            onClick={handleClear}
            disabled={loading}
            className="inline-flex items-center rounded-md border border-navy-200 px-4 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50 focus:outline-none focus:ring-2 focus:ring-navy-300 focus:ring-offset-1 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" aria-hidden />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Result */}
      {parsed && (
        <div className="rounded-md border border-border bg-surface overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-navy-50 border-b border-navy-200">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-teal-600" aria-hidden />
              <span className="text-sm font-medium text-navy-900">
                Parsed
              </span>
            </div>
            <span className="text-xs text-navy-500">
              {result?.tokensUsed} tokens · {result?.durationMs}ms
            </span>
          </div>

          <div className="px-4 py-3 space-y-3">
            {/* Type + urgency */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={TYPE_STYLES[parsed.emailType]?.variant ?? "neutral"}>
                {TYPE_STYLES[parsed.emailType]?.label ?? parsed.emailType}
              </Badge>

              <span className="inline-flex items-center gap-1 text-xs text-navy-600">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    URGENCY_DOT[parsed.urgency] ?? "bg-green-500",
                  )}
                  aria-hidden
                />
                {parsed.urgency} urgency
              </span>

              <span
                className={cn(
                  "text-xs",
                  parsed.sentiment === "positive"
                    ? "text-green-600"
                    : parsed.sentiment === "negative"
                      ? "text-red-600"
                      : "text-navy-500",
                )}
              >
                {parsed.sentiment} sentiment
              </span>
            </div>

            {/* Funder match */}
            <div className="text-sm">
              <span className="text-navy-500">Funder: </span>
              {parsed.matchedFunderName ? (
                <span className="font-medium text-teal-700">
                  {parsed.matchedFunderName}{" "}
                  <span className="text-xs text-teal-600 font-normal">(matched)</span>
                </span>
              ) : parsed.funderName ? (
                <span className="text-navy-700">
                  {parsed.funderName}{" "}
                  <span className="text-xs text-navy-400">(not in your funders)</span>
                </span>
              ) : (
                <span className="text-navy-400">Not identified</span>
              )}
            </div>

            {/* Opportunity reference */}
            {parsed.opportunityReference && (
              <div className="text-sm">
                <span className="text-navy-500">Opportunity: </span>
                <span className="text-navy-700">{parsed.opportunityReference}</span>
              </div>
            )}

            {/* Action required */}
            {parsed.actionRequired && (
              <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800">
                <span className="font-medium">Action required: </span>
                {parsed.actionDescription ?? "See email for details."}
              </div>
            )}

            {/* Outcome flag */}
            {parsed.flaggedForOutcomeRecording && (
              <div className="rounded-md bg-teal-50 border border-teal-200 px-3 py-2 text-sm text-teal-800">
                Flagged for outcome recording - record the result in the
                Outcomes section.
              </div>
            )}

            {/* Details toggle */}
            <button
              type="button"
              onClick={() =>
                setExpandedIndex(expandedIndex === 0 ? null : 0)
              }
              className="flex items-center gap-1 text-xs text-navy-500 hover:text-navy-700 transition-colors"
            >
              {expandedIndex === 0 ? (
                <ChevronUp className="h-3 w-3" aria-hidden />
              ) : (
                <ChevronDown className="h-3 w-3" aria-hidden />
              )}
              {expandedIndex === 0 ? "Hide details" : "Show details"}
            </button>

            {expandedIndex === 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-navy-100 pt-3">
                <dt className="text-navy-500">Activity ID</dt>
                <dd className="text-navy-700 font-mono break-all">
                  {parsed.emailActivityId}
                </dd>
                <dt className="text-navy-500">Email index</dt>
                <dd className="text-navy-700">{parsed.emailIndex}</dd>
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
