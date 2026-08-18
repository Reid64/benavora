"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button, Modal } from "@/components/ui";

const CATEGORIES = [
  "housing",
  "homelessness",
  "reentry",
  "recovery",
  "workforce",
  "youth",
  "veterans",
  "health",
  "education",
  "faith-based",
  "environment",
  "arts",
  "community-development",
  "other",
] as const;

type Tab = "paste" | "url";

type IngestResult = {
  sections_extracted: number;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function IngestModal({ isOpen, onClose, onSuccess }: Props) {
  const [tab, setTab] = useState<Tab>("paste");

  // Paste Text tab state
  const [funderName, setFunderName] = useState("");
  const [grantProgram, setGrantProgram] = useState("");
  const [awardAmount, setAwardAmount] = useState("");
  const [awardYear, setAwardYear] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [pasteText, setPasteText] = useState("");

  // From URL tab state
  const [url, setUrl] = useState("");

  // Shared state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  function resetForm() {
    setFunderName("");
    setGrantProgram("");
    setAwardAmount("");
    setAwardYear("");
    setSelectedCategories([]);
    setPasteText("");
    setUrl("");
    setError(null);
    setResult(null);
  }

  function handleClose() {
    if (loading) return;
    resetForm();
    onClose();
  }

  function switchTab(t: Tab) {
    setTab(t);
    setError(null);
    setResult(null);
  }

  async function submit() {
    setError(null);
    setResult(null);

    let body: Record<string, unknown>;

    if (tab === "paste") {
      if (!pasteText.trim()) {
        setError("Please paste the proposal text before submitting.");
        return;
      }
      body = {
        source: "manual",
        text: pasteText.trim(),
        metadata: {
          funder_name: funderName.trim() || undefined,
          grant_program: grantProgram.trim() || undefined,
          award_amount: awardAmount ? parseFloat(awardAmount) : undefined,
          award_year: awardYear ? parseInt(awardYear, 10) : undefined,
          category: selectedCategories.length > 0 ? selectedCategories : undefined,
        },
      };
    } else {
      if (!url.trim()) {
        setError("Please enter a URL before submitting.");
        return;
      }
      body = {
        source: "url",
        url: url.trim(),
      };
    }

    setLoading(true);
    try {
      const res = await fetch("/api/intelligence/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as { error?: string; sections_extracted?: number };

      if (!res.ok) {
        setError(data.error ?? `Request failed (HTTP ${res.status}).`);
        return;
      }

      setResult({ sections_extracted: data.sections_extracted ?? 0 });
      onSuccess();
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const fieldClass =
    "w-full rounded-lg border border-navy-200 bg-surface px-3 py-2 text-sm text-navy-900 placeholder:text-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";
  const labelClass = "mb-1 block text-xs font-medium text-navy-600";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add to Library"
      description="Ingest a funded proposal by pasting the text or providing a URL."
      size="lg"
      footer={
        result ? (
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} isLoading={loading} disabled={loading}>
              {loading
                ? "Processing…"
                : tab === "paste"
                  ? "Ingest Proposal"
                  : "Ingest from URL"}
            </Button>
          </>
        )
      }
    >
      {/* Tab bar */}
      <div className="mb-5 flex border-b border-navy-200">
        {(["paste", "url"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTab(t)}
            disabled={loading}
            className={`-mb-px mr-6 border-b-2 pb-2.5 text-sm font-medium transition ${
              tab === t
                ? "border-teal-500 text-teal-600"
                : "border-transparent text-navy-500 hover:border-navy-300 hover:text-navy-700"
            } disabled:opacity-50`}
          >
            {t === "paste" ? "Paste Text" : "From URL"}
          </button>
        ))}
      </div>

      {/* Success state */}
      {result ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-teal-500" aria-hidden />
          <p className="text-base font-semibold text-navy-900">Ingestion complete</p>
          <p className="text-sm text-navy-500">
            {result.sections_extracted} section{result.sections_extracted !== 1 ? "s" : ""} extracted and indexed.
          </p>
        </div>
      ) : (
        <>
          {/* Processing banner */}
          {loading && (
            <div className="mb-4 flex items-center gap-3 rounded-lg bg-teal-50 px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-teal-600" aria-hidden />
              <p className="text-sm text-teal-700">
                Extracting sections and generating embeddings — this may take 30–60 seconds…
              </p>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {tab === "paste" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Funder name</label>
                  <input
                    type="text"
                    placeholder="e.g. Robert Wood Johnson Foundation"
                    value={funderName}
                    onChange={(e) => setFunderName(e.target.value)}
                    disabled={loading}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Grant program</label>
                  <input
                    type="text"
                    placeholder="e.g. Health Equity Grant"
                    value={grantProgram}
                    onChange={(e) => setGrantProgram(e.target.value)}
                    disabled={loading}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Award amount ($)</label>
                  <input
                    type="number"
                    placeholder="e.g. 250000"
                    value={awardAmount}
                    onChange={(e) => setAwardAmount(e.target.value)}
                    disabled={loading}
                    min={0}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Award year</label>
                  <input
                    type="number"
                    placeholder="e.g. 2024"
                    value={awardYear}
                    onChange={(e) => setAwardYear(e.target.value)}
                    disabled={loading}
                    min={1990}
                    max={2030}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Categories</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((cat) => {
                    const selected = selectedCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        disabled={loading}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          selected
                            ? "border-teal-500 bg-teal-50 text-teal-700"
                            : "border-navy-200 bg-surface text-navy-600 hover:border-navy-300 hover:bg-navy-50"
                        } disabled:opacity-50`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  Proposal text <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={12}
                  placeholder="Paste the full text of the funded proposal here…"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  disabled={loading}
                  className={`${fieldClass} resize-y`}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>
                  URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  placeholder="https://example.gov/funded-proposals/2024"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                  className={fieldClass}
                />
              </div>
              <p className="text-xs text-navy-400">
                The URL must be publicly accessible and return text/HTML content. The page will be
                fetched and analyzed to extract proposal sections. Processing may take 30–60 seconds.
              </p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
