"use client";

import { useState } from "react";
import {
  FileBarChart2,
  Download,
  Loader2,
  Calendar,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

function defaultDates(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().split("T")[0]!,
    end: end.toISOString().split("T")[0]!,
  };
}

export default function ReportsPage() {
  const defaults = defaultDates();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!startDate || !endDate) return;
    if (startDate > endDate) {
      setError("Start date must be before end date.");
      return;
    }

    setLoading(true);
    setError(null);
    setDownloadUrl(null);
    setGeneratedAt(null);

    try {
      const res = await fetch("/api/reports/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: startDate, end_date: endDate }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Report generation failed.");
      }

      const data = (await res.json()) as {
        downloadUrl: string;
        generatedAt: string;
      };
      setDownloadUrl(data.downloadUrl);
      setGeneratedAt(data.generatedAt);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setLoading(false);
    }
  }

  const rangeLabel = (() => {
    try {
      const s = new Date(startDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const e = new Date(endDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return `${s} - ${e}`;
    } catch {
      return "";
    }
  })();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Page header */}
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100">
          <FileBarChart2 className="h-5 w-5 text-teal-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Board Reports</h1>
          <p className="text-sm text-slate-500">
            Generate a PDF board report with AI-written executive summary,
            pipeline status, financials, and recommendations.
          </p>
        </div>
      </div>

      {/* Date range form */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-teal-600" />
          <h2 className="text-sm font-semibold text-slate-700">Report Period</h2>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="start_date"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Start Date
            </label>
            <input
              id="start_date"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setError(null);
                setDownloadUrl(null);
              }}
              max={endDate}
              disabled={loading}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label
              htmlFor="end_date"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              End Date
            </label>
            <input
              id="end_date"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setError(null);
                setDownloadUrl(null);
              }}
              min={startDate}
              disabled={loading}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
            />
          </div>
        </div>

        {rangeLabel && (
          <p className="mb-5 text-xs text-slate-400">{rangeLabel}</p>
        )}

        <button
          onClick={handleGenerate}
          disabled={loading || !startDate || !endDate}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating Report...
            </>
          ) : (
            <>
              <FileBarChart2 className="h-4 w-4" />
              Generate Board Report
            </>
          )}
        </button>

        {loading && (
          <p className="mt-3 text-center text-xs text-slate-400">
            Aggregating data, generating AI narrative, and building PDF - this
            takes 20-40 seconds.
          </p>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-medium text-red-700">
              Report generation failed
            </p>
            <p className="mt-0.5 text-xs text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* Success state */}
      {downloadUrl && (
        <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-teal-600" />
            <p className="text-sm font-semibold text-teal-800">
              Report ready
              {generatedAt ? ` - generated ${generatedAt}` : ""}
            </p>
          </div>
          <p className="mb-4 text-xs text-teal-700">
            Your board report PDF includes an AI-generated executive summary,
            pipeline snapshot, financial overview, agent performance summary,
            and strategic recommendations.
          </p>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
            download
          >
            <Download className="h-4 w-4" />
            Download PDF
          </a>
          <p className="mt-2 text-xs text-teal-600">
            Download link expires in 1 hour.
          </p>
        </div>
      )}

      {/* Info section */}
      <div className="mt-8 rounded-xl border border-slate-100 bg-slate-50 p-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          What&apos;s included
        </h3>
        <ul className="space-y-1.5">
          {[
            "Executive Summary with key KPIs and highlights",
            "Pipeline Status - applications by stage",
            "Submission Activity - recent applications submitted",
            "Awards and Funding - outcomes and win rate",
            "Agent Performance - AI automation efficiency",
            "Financial Overview - funding by category",
            "Strategic Recommendations from AI analysis",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs text-slate-600">
              <span className="mt-0.5 text-teal-500">✓</span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
