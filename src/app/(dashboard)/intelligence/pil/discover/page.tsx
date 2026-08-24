"use client";

// PIL natural-language discovery - POST /api/pil/discover translates the
// query into a DiscoveryResearchPlan via Claude and creates a
// pil_research_runs row carrying it (see that route's header comment).

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui";
import { humanizeEnum } from "@/lib/utils/formatters";

const NAVY = "#101B2D";
const GOLD = "#B88A2E";
const PLUM = "#5B21B6";
const CANVAS = "#D8D3C8";
const CARD_BG = "#F8F5EE";
const TEXT_SECONDARY = "#64748B";
const BORDER = "#D9D3C5";

interface DiscoveryResearchPlan {
  intent: string;
  entities: string[];
  geography: string[];
  time_horizon: string | null;
  cause_taxonomy: string[];
  inclusion_criteria: string[];
  exclusion_criteria: string[];
  required_evidence: string[];
  depth: string;
  candidate_limit: number;
  data_source_plan: string[];
  agent_assignments: string[];
  tool_budgets: Record<string, number>;
  confidence_threshold: number;
  ranking_methodology: string;
  stop_conditions: string[];
}

function PlanList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
        {title}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: `${GOLD}1A`, color: GOLD, borderColor: `${GOLD}40` }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function PilDiscoverPage() {
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ runId: string; plan: DiscoveryResearchPlan } | null>(null);

  async function handleSubmit() {
    if (!query.trim()) {
      setError("Describe who or what you want to discover.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/pil/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const payload = (await res.json().catch(() => ({}))) as
        | { runId: string; plan: DiscoveryResearchPlan }
        | { error?: string };
      if (!res.ok || !("runId" in payload)) {
        setError("error" in payload && payload.error ? payload.error : "Could not build a research plan from that query.");
        setSubmitting(false);
        return;
      }
      setResult(payload);
    } catch {
      setError("Could not reach the server.");
    }
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
      <Link href="/intelligence/pil" className="inline-flex items-center gap-1.5 text-sm" style={{ color: PLUM }}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to PIL Hub
      </Link>

      <div className="mb-6 mt-4" style={{ borderLeft: `4px solid ${PLUM}`, paddingLeft: "1rem" }}>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: NAVY }}>
          Natural Language Discovery
        </h1>
        <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
          Describe who you are looking for in plain English - a research plan and run are created from it.
        </p>
      </div>

      <div className="rounded-xl p-5" style={{ backgroundColor: CARD_BG }}>
        <label className="mb-1.5 block text-sm font-medium" style={{ color: NAVY }} htmlFor="discovery-query">
          Discovery request
        </label>
        <textarea
          id="discovery-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={5}
          placeholder="e.g. Find family foundations in the Pacific Northwest that have funded housing nonprofits in the last two years and have board members with a healthcare background."
          className="block w-full rounded-lg border border-slate-200 bg-surface px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-[#5B21B6] focus:ring-2 focus:ring-[#5B21B6]/10"
        />
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={() => void handleSubmit()} isLoading={submitting} style={{ backgroundColor: PLUM }}>
            <Sparkles className="h-4 w-4" aria-hidden />
            Build Research Plan
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>

      {result && (
        <div className="mt-6 rounded-xl p-5" style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}` }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold" style={{ color: NAVY }}>
              Structured Research Plan
            </h2>
            <Link
              href={`/intelligence/pil/research`}
              className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
              style={{ color: PLUM }}
            >
              Run {result.runId.slice(0, 8)} - Monitor progress
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Intent
              </p>
              <p className="mt-1 text-sm" style={{ color: NAVY }}>
                {result.plan.intent}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Depth / Candidate Limit
              </p>
              <p className="mt-1 text-sm" style={{ color: NAVY }}>
                {humanizeEnum(result.plan.depth)} - up to {result.plan.candidate_limit} candidates
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Confidence Threshold
              </p>
              <p className="mt-1 text-sm" style={{ color: NAVY }}>
                {Math.round(result.plan.confidence_threshold * 100)}%
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                Ranking Methodology
              </p>
              <p className="mt-1 text-sm" style={{ color: NAVY }}>
                {result.plan.ranking_methodology}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <PlanList title="Entities" items={result.plan.entities} />
            <PlanList title="Geography" items={result.plan.geography} />
            <PlanList title="Cause Taxonomy" items={result.plan.cause_taxonomy} />
            <PlanList title="Inclusion Criteria" items={result.plan.inclusion_criteria} />
            <PlanList title="Exclusion Criteria" items={result.plan.exclusion_criteria} />
            <PlanList title="Required Evidence" items={result.plan.required_evidence} />
            <PlanList title="Data Source Plan" items={result.plan.data_source_plan} />
            <PlanList title="Agent Assignments" items={result.plan.agent_assignments} />
            <PlanList title="Stop Conditions" items={result.plan.stop_conditions} />
          </div>
        </div>
      )}
    </div>
  );
}
