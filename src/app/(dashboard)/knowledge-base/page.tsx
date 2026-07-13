"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Award,
  BookText,
  Building2,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

import { Badge, EmptyState, LoadingSpinner } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { KnowledgeBaseNav } from "@/components/knowledge-base/KnowledgeBaseNav";
import { ProvenBadge } from "@/components/knowledge-base/ProvenBadge";
import { createClient } from "@/lib/supabase/client";
import { STANDARD_ANSWER_CATEGORY } from "@/lib/utils/constants";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

type Summary = {
  narrativeCount: number;
  answerCount: number;
  provenCount: number;
  proven: Tables<"proven_narratives">[];
};

const SHORTCUTS: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    href: "/knowledge-base/profile",
    title: "Organization Profile",
    description: "EIN, mission, programs, board, and budget.",
    icon: Building2,
  },
  {
    href: "/knowledge-base/narratives",
    title: "Narratives",
    description: "Reusable mission, need, impact, and capacity blocks.",
    icon: BookText,
  },
  {
    href: "/knowledge-base/answers",
    title: "Standard Answers",
    description: "Approved answers to recurring grant questions.",
    icon: HelpCircle,
  },
];

/**
 * Knowledge Base overview (BLUEPRINT §4.7): a summary of the org's reusable
 * content plus a window into the narratives the learning system has proven
 * effective, with their effectiveness scores.
 */
export default function KnowledgeBaseOverviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);

      const [kbRes, provenRes] = await Promise.all([
        supabase.from("knowledge_base").select("id, category, is_proven"),
        supabase
          .from("proven_narratives")
          .select("*")
          .order("effectiveness_score", { ascending: false, nullsFirst: false }),
      ]);

      if (!active) return;

      if (kbRes.error) {
        setError("Could not load your knowledge base.");
        setLoading(false);
        return;
      }

      const kb = kbRes.data ?? [];
      setSummary({
        narrativeCount: kb.filter(
          (r) => r.category !== STANDARD_ANSWER_CATEGORY,
        ).length,
        answerCount: kb.filter(
          (r) => r.category === STANDARD_ANSWER_CATEGORY,
        ).length,
        provenCount: kb.filter((r) => r.is_proven).length,
        proven: provenRes.data ?? [],
      });
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen space-y-6 bg-[#EEF2F7] p-6">
      <PageHeader
        title="Knowledge Base"
        description="The verified organizational content the AI draws from - never fabricated beyond what you store here."
      />

      <KnowledgeBaseNav />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading knowledge base..." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MetricCard
              icon={BookText}
              label="Narratives"
              value={summary?.narrativeCount ?? 0}
            />
            <MetricCard
              icon={HelpCircle}
              label="Standard answers"
              value={summary?.answerCount ?? 0}
            />
            <MetricCard
              icon={Award}
              label="Proven narratives"
              value={summary?.provenCount ?? 0}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {SHORTCUTS.map((shortcut) => (
              <Link
                key={shortcut.href}
                href={shortcut.href}
                className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md hover:border-[#00B4D8] transition-all"
              >
                <div className="flex items-center gap-2 text-slate-900">
                  <shortcut.icon className="h-5 w-5 text-[#0077B6]" aria-hidden />
                  <h3 className="text-base font-semibold text-slate-900">
                    {shortcut.title}
                  </h3>
                </div>
                <p className="mt-1.5 text-sm text-slate-500">
                  {shortcut.description}
                </p>
              </Link>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h3 className="text-base font-semibold text-slate-900">
              Proven narratives
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Patterns the learning system extracted from awarded applications, ranked by effectiveness.
            </p>

            {summary && summary.proven.length > 0 ? (
              <ul className="mt-4 divide-y divide-slate-100">
                {summary.proven.map((proven) => (
                  <li
                    key={proven.id}
                    className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {proven.section_type && (
                          <Badge color="indigo">
                            {humanizeEnum(proven.section_type)}
                          </Badge>
                        )}
                        {proven.funder_category && (
                          <Badge color="gray">
                            {humanizeEnum(proven.funder_category)}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">
                        {proven.narrative_text}
                      </p>
                      {proven.last_used_at && (
                        <p className="mt-1 text-xs text-slate-400">
                          Last used {formatRelative(proven.last_used_at)}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      <ProvenBadge
                        isProven
                        provenCount={proven.success_count}
                        effectivenessScore={proven.effectiveness_score}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4">
                <EmptyState
                  icon={Award}
                  title="No proven narratives yet"
                  description="As you record awarded outcomes, the learning system promotes the narratives that won and ranks them here."
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md hover:border-[#00B4D8] transition-all">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#CAF0F8]">
          <Icon className="h-5 w-5 text-[#0077B6]" aria-hidden />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}
