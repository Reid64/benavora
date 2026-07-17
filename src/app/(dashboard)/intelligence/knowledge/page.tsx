"use client";

// Funding Knowledge Engine query UI (PLATFORM_VISION_ARCHITECTURE.md Pillar 18,
// AGENTS_v2.md AG-29). Lets a user ask a free-text question and get back
// matching knowledge_patterns + intelligence_funded_proposals via
// POST /api/intelligence/knowledge-query, which wraps
// src/lib/intelligence/knowledge-engine.ts's queryKnowledgeEngine().

import { useEffect, useState } from "react";
import { ExternalLink, Lightbulb, Search, Sparkles } from "lucide-react";

import { Badge, EmptyState, LoadingSpinner } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { PageHeader } from "@/components/layout/PageHeader";
import { createClient } from "@/lib/supabase/client";

interface KnowledgePattern {
  id: string;
  pattern_type: string;
  category: string | null;
  funder_name: string | null;
  pattern_description: string;
  success_rate: number | null;
  sample_count: number | null;
  confidence: string;
}

interface KnowledgeProposal {
  id: string;
  source: string;
  source_url: string | null;
  funder_name: string | null;
  grant_program: string | null;
  award_amount: number | null;
  award_year: number | null;
}

interface KnowledgeEngineResult {
  patterns: KnowledgePattern[];
  proposals: KnowledgeProposal[];
  insights: string[];
}

const SUGGESTED_QUERIES = [
  "What narrative elements most often win HRSA community health grants?",
  "What separates funded vs rejected NIH proposals in community health?",
  "What budget practices increase success rate with federal funders?",
  "Which need statement patterns perform best with NSF reviewers?",
  "What evaluation frameworks do funders expect for housing programs?",
  "What timing patterns increase award rates for federal grants?",
];

function formatCurrency(amount: number | null): string | null {
  if (amount === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function confidenceBadgeColor(confidence: string): "green" | "yellow" | "gray" {
  if (confidence === "high") return "green";
  if (confidence === "medium") return "yellow";
  return "gray";
}

export default function KnowledgeEnginePage() {
  const [proposalsCount, setProposalsCount] = useState<number | null>(null);
  const [patternsCount, setPatternsCount] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KnowledgeEngineResult | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const supabase = createClient();
      const [proposalsRes, patternsRes] = await Promise.all([
        supabase
          .from("intelligence_funded_proposals")
          .select("id", { count: "exact", head: true }),
        supabase
          .from("knowledge_patterns")
          .select("id", { count: "exact", head: true }),
      ]);
      if (!active) return;
      setProposalsCount(proposalsRes.count ?? 0);
      setPatternsCount(patternsRes.count ?? 0);
    })();

    return () => {
      active = false;
    };
  }, []);

  async function runQuery(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/knowledge-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ??
            "Could not query the knowledge engine.",
        );
        setResult(null);
      } else {
        setResult(payload as KnowledgeEngineResult);
      }
    } catch {
      setError("Could not reach the knowledge engine.");
      setResult(null);
    }
    setLoading(false);
  }

  function handleSuggestedClick(suggestion: string) {
    setQuery(suggestion);
  }

  return (
    <div className="min-h-screen space-y-6 bg-[#CBD5E1] p-6">
      <PageHeader
        title="Funding Knowledge Engine"
        description="Ask any question about what gets funded, why, and how to improve your odds."
      />

      <div className="flex flex-wrap gap-3">
        <div
          className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"
          style={{ backgroundColor: "#E0F2FE", color: "#0369A1", borderColor: "#BAE6FD" }}
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {proposalsCount === null ? "—" : proposalsCount.toLocaleString()} funded proposals indexed
        </div>
        <div
          className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold"
          style={{ backgroundColor: "#DCFCE7", color: "#15803D", borderColor: "#BBF7D0" }}
        >
          <Lightbulb className="h-4 w-4" aria-hidden />
          {patternsCount === null ? "—" : patternsCount.toLocaleString()} success patterns learned
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-border p-5">
        <Textarea
          label="Ask the Knowledge Engine"
          placeholder="What narrative elements most often win HRSA community health grants?"
          rows={4}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUERIES.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => handleSuggestedClick(suggestion)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#0077B6] hover:text-[#0077B6]"
                style={{ backgroundColor: "#F1F5F9", borderColor: "#E2E8F0" }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => void runQuery(query)} isLoading={loading}>
            <Search className="h-4 w-4" aria-hidden />
            Ask
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading && <LoadingSpinner center label="Querying the knowledge engine..." />}

      {!loading && result && (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-border p-5">
            <h3 className="text-base font-semibold text-slate-900">Insights</h3>
            {result.insights.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {result.insights.map((insight, index) => (
                  <li
                    key={index}
                    className="text-sm text-slate-600 before:mr-2 before:content-['•']"
                  >
                    {insight}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No insights generated for this query.</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-border p-5">
            <h3 className="text-base font-semibold text-slate-900">Matching Patterns</h3>
            {result.patterns.length > 0 ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {result.patterns.map((pattern) => (
                  <li key={pattern.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {pattern.success_rate !== null && (
                        <Badge color="green">{pattern.success_rate}% success rate</Badge>
                      )}
                      {pattern.sample_count !== null && (
                        <Badge color="gray">{pattern.sample_count} samples</Badge>
                      )}
                      <Badge color={confidenceBadgeColor(pattern.confidence)}>
                        {pattern.confidence} confidence
                      </Badge>
                      {pattern.funder_name && <Badge color="blue">{pattern.funder_name}</Badge>}
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{pattern.pattern_description}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No matching patterns found for this query.</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-border p-5">
            <h3 className="text-base font-semibold text-slate-900">Matching Funded Proposals</h3>
            {result.proposals.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {result.proposals.map((proposal) => (
                  <div
                    key={proposal.id}
                    className="rounded-lg border border-slate-200 p-4"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {proposal.grant_program ?? "Untitled grant program"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {proposal.funder_name ?? "Unknown funder"}
                    </p>
                    {proposal.award_amount !== null && (
                      <p className="mt-1 text-sm font-medium text-slate-700">
                        {formatCurrency(proposal.award_amount)}
                        {proposal.award_year !== null ? ` · ${proposal.award_year}` : ""}
                      </p>
                    )}
                    {proposal.source_url && (
                      <a
                        href={proposal.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-sm font-medium"
                        style={{ color: "#0077B6" }}
                      >
                        View source
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No matching funded proposals found for this query.</p>
            )}
          </div>
        </>
      )}

      {!loading && !result && !error && (
        <EmptyState
          icon={Search}
          title="Ask a question to get started"
          description="Try one of the suggested queries above, or write your own."
        />
      )}
    </div>
  );
}
