"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  DollarSign,
  ExternalLink,
  FileCheck,
  Lock,
  Sparkles,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";

import { Badge, Button, Card, LoadingSpinner } from "@/components/ui";
import type { RelatedIntelligence, SearchResult } from "@/lib/intelligence/unified-search";

type BriefingResponse = {
  opportunity_id: string;
  opportunity_name: string;
  briefing: RelatedIntelligence;
  total_items: number;
  tier: string;
  tier_sections: string[];
};

type SectionKey = keyof RelatedIntelligence;

const SECTION_CONFIG: {
  key: SectionKey;
  label: string;
  icon: React.ElementType;
  description: string;
  upgradeMessage: string;
}[] = [
  {
    key: "funded_proposals",
    label: "Matching Funded Proposals",
    icon: Star,
    description: "Similar funded applications from the intelligence library",
    upgradeMessage: "Upgrade to Starter to see matching funded proposals.",
  },
  {
    key: "rubrics",
    label: "Applicable Rubrics",
    icon: ClipboardList,
    description: "Scoring dimensions and weights for this funder/program type",
    upgradeMessage: "Upgrade to Professional to see applicable scoring rubrics.",
  },
  {
    key: "need_data",
    label: "Relevant Need Data",
    icon: TrendingUp,
    description: "Statistics for this geography and program category, with citations",
    upgradeMessage: "Upgrade to Professional to see relevant need data with citations.",
  },
  {
    key: "budget_patterns",
    label: "Recommended Budget Template",
    icon: DollarSign,
    description: "Suggested line items for this program category",
    upgradeMessage: "Upgrade to Professional to see recommended budget templates.",
  },
  {
    key: "evaluation_frameworks",
    label: "Evaluation Framework",
    icon: BookOpen,
    description: "Suggested KPIs and data collection methods for this program type",
    upgradeMessage: "Upgrade to Professional to see evaluation frameworks.",
  },
  {
    key: "compliance_requirements",
    label: "Compliance Checklist",
    icon: FileCheck,
    description: "Required documents and regulatory requirements for this grant type",
    upgradeMessage: "Upgrade to Starter to see the compliance checklist.",
  },
  {
    key: "grantmaker_profiles",
    label: "Funder Profile",
    icon: Users,
    description: "Typical award range, priorities, and language patterns",
    upgradeMessage: "Upgrade to Enterprise to see detailed funder profiles.",
  },
];

function CollapsibleSection({
  title,
  icon: Icon,
  description,
  items,
  locked,
  upgradeMessage,
}: {
  title: string;
  icon: React.ElementType;
  description: string;
  items: SearchResult[];
  locked: boolean;
  upgradeMessage: string;
}) {
  const [open, setOpen] = useState(!locked && items.length > 0);

  return (
    <div className="rounded-lg border border-navy-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => { if (!locked) setOpen((prev) => !prev); }}
        aria-expanded={locked ? undefined : open}
        disabled={locked}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-2.5">
          <Icon
            className={`h-4 w-4 shrink-0 ${locked ? "text-navy-300" : "text-teal-600"}`}
            aria-hidden
          />
          <div>
            <span
              className={`text-sm font-semibold ${locked ? "text-navy-400" : "text-navy-900"}`}
            >
              {title}
            </span>
            {!locked && items.length > 0 && (
              <span className="ml-2 text-xs text-navy-500">({items.length})</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {locked ? (
            <Lock className="h-3.5 w-3.5 text-navy-300" aria-hidden />
          ) : open ? (
            <ChevronUp className="h-4 w-4 text-navy-400" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4 text-navy-400" aria-hidden />
          )}
        </div>
      </button>

      {locked && (
        <div className="border-t border-navy-100 px-4 py-3">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-navy-300" aria-hidden />
            <div>
              <p className="text-sm text-navy-500">{upgradeMessage}</p>
              <p className="mt-0.5 text-xs text-navy-400">{description}</p>
            </div>
          </div>
        </div>
      )}

      {!locked && open && (
        <div className="border-t border-navy-100 px-4 py-3">
          {items.length === 0 ? (
            <p className="text-sm text-navy-400">
              No data found for this opportunity.
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => {
                const proposalId =
                  typeof item.metadata?.proposal_id === "string"
                    ? item.metadata.proposal_id
                    : null;
                return (
                  <li key={item.id} className="space-y-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-medium text-navy-800">
                        {item.title}
                      </span>
                      <Badge variant="info" className="shrink-0">
                        {Math.round(item.relevance_score * 100)}%
                      </Badge>
                    </div>
                    {item.excerpt && (
                      <p className="text-xs leading-relaxed text-navy-500">
                        {item.excerpt}
                      </p>
                    )}
                    {proposalId && (
                      <Link
                        href={`/intelligence-library?proposal=${encodeURIComponent(proposalId)}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-700"
                      >
                        View
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function IntelligenceBriefingPanel({
  opportunityId,
}: {
  opportunityId: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [data, setData] = useState<BriefingResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function handleGenerate() {
    setStatus("loading");
    setFetchError(null);
    try {
      const res = await fetch(
        `/api/intelligence/briefing?opportunity_id=${encodeURIComponent(opportunityId)}`,
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Failed to load briefing.");
      }
      const json = (await res.json()) as BriefingResponse;
      setData(json);
      setStatus("loaded");
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Failed to load briefing.",
      );
      setStatus("error");
    }
  }

  const tierSections = new Set(data?.tier_sections ?? []);

  return (
    <div className="space-y-6">
      <Card title="Intelligence Briefing">
        <div className="space-y-4">
          <p className="text-sm text-navy-500">
            Contextual intelligence from the knowledge base — matching funded
            proposals, scoring rubrics, need statistics, budget templates,
            evaluation frameworks, compliance requirements, and funder profile.
            Available sections depend on your subscription tier.
          </p>

          {status === "idle" && (
            <Button onClick={handleGenerate} variant="secondary">
              <Sparkles className="h-4 w-4" aria-hidden />
              Generate Briefing
            </Button>
          )}

          {status === "loading" && (
            <div className="flex items-center gap-2 text-sm text-navy-600">
              <LoadingSpinner />
              <span>Searching knowledge base&hellip;</span>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-3">
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {fetchError}
              </div>
              <Button onClick={handleGenerate} variant="secondary">
                <Sparkles className="h-4 w-4" aria-hidden />
                Retry
              </Button>
            </div>
          )}

          {status === "loaded" && data && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-navy-400 capitalize">
                {data.total_items} item{data.total_items === 1 ? "" : "s"} found
                {data.tier ? ` · ${data.tier} plan` : ""}
              </span>
              <Button onClick={handleGenerate} variant="secondary" size="sm">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Refresh
              </Button>
            </div>
          )}
        </div>
      </Card>

      {status === "loaded" && data && (
        <div className="space-y-3">
          {SECTION_CONFIG.map(({ key, label, icon, description, upgradeMessage }) => {
            const locked = !tierSections.has(key);
            const items = data.briefing[key] ?? [];
            return (
              <CollapsibleSection
                key={key}
                title={label}
                icon={icon}
                description={description}
                items={items}
                locked={locked}
                upgradeMessage={upgradeMessage}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
