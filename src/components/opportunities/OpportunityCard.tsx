"use client";

import Link from "next/link";
import { Building2, CalendarClock } from "lucide-react";

import { Badge } from "@/components/ui";
import {
  EligibilityBar,
  HighPriorityBadge,
  MatchBadge,
  OPPORTUNITY_STATUS_VARIANT,
  RecommendationBadge,
} from "@/components/opportunities/eligibility";
import { SourceTypeBadge } from "@/components/opportunities/SourceTypeBadge";
import type { OpportunityRow } from "@/components/opportunities/OpportunityTable";
import { decodeHtmlEntities, formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";

export type OpportunityCardProps = {
  opportunity: OpportunityRow;
};

/**
 * Card view of an opportunity (task spec) - the grid alternative to the table on
 * the Opportunities list. Leads with the funding source_type badge, then the
 * category and status, and shows the funder, amount, deadline, and the agent's
 * eligibility score + recommendation. The whole card links to the detail view.
 */
export function OpportunityCard({ opportunity }: OpportunityCardProps) {
  const amount = opportunity.amount_max ?? opportunity.amount_available;

  return (
    <Link
      href={`/opportunities/${opportunity.id}`}
      className="group flex h-full flex-col gap-3 rounded-xl border border-navy-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
    >
      <div className="flex flex-wrap items-center gap-2">
        <MatchBadge percentage={opportunity.match_percentage} />
        {opportunity.is_high_priority && <HighPriorityBadge />}
        <SourceTypeBadge sourceType={opportunity.source_type} />
        <Badge variant="neutral">{humanizeEnum(opportunity.category)}</Badge>
        {opportunity.status && (
          <Badge variant={OPPORTUNITY_STATUS_VARIANT[opportunity.status]}>
            {humanizeEnum(opportunity.status)}
          </Badge>
        )}
      </div>

      <div className="min-w-0">
        <h3 className="line-clamp-2 font-medium text-navy-900 group-hover:text-teal-700">
          {decodeHtmlEntities(opportunity.name)}
        </h3>
        {opportunity.funderName && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-navy-500">
            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{opportunity.funderName}</span>
          </p>
        )}
      </div>

      <div className="mt-auto space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-navy-600">
          <span className="font-medium text-navy-800">
            {amount != null ? formatCurrency(amount) : "Amount -"}
          </span>
          <span className="flex items-center gap-1 text-xs text-navy-500">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {opportunity.deadline ? formatDate(opportunity.deadline) : "No deadline"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <EligibilityBar score={opportunity.eligibility_score} />
          {opportunity.recommendation && (
            <RecommendationBadge recommendation={opportunity.recommendation} />
          )}
        </div>
      </div>
    </Link>
  );
}
