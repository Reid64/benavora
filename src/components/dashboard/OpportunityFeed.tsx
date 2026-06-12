import Link from "next/link";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";

export type OpportunityFeedItem = {
  id: string;
  name: string;
  category: string;
  /** Resolved funder name, if the opportunity is linked to a funder. */
  funderName: string | null;
  /** Best available request amount, pre-formatted (e.g. "$25,000") or null. */
  amountLabel: string | null;
  /** Application deadline (ISO) or null. */
  deadline: string | null;
  /** When the opportunity was discovered (ISO). */
  discoveredAt: string;
};

/**
 * Recent opportunities feed (BLUEPRINT §4.1): the last 10 discovered
 * opportunities, newest first. Data is loaded server-side and passed in.
 */
export function OpportunityFeed({ items }: { items: OpportunityFeedItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Search className="h-6 w-6 text-navy-300" aria-hidden />
        <p className="mt-2 text-sm text-navy-500">
          No opportunities discovered yet.
        </p>
        <Link
          href="/opportunities/new"
          className="mt-1 text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          Add your first opportunity
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-navy-100">
      {items.map((opp) => (
        <li key={opp.id}>
          <Link
            href={`/opportunities/${opp.id}`}
            className="-mx-2 flex items-start justify-between gap-3 rounded-lg px-2 py-3 transition hover:bg-navy-50"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-navy-900">
                {opp.name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-navy-500">
                <Badge color="gray">{humanizeEnum(opp.category)}</Badge>
                {opp.funderName && <span className="truncate">{opp.funderName}</span>}
                {opp.amountLabel && (
                  <span className="font-medium text-navy-600">
                    {opp.amountLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right text-xs text-navy-400">
              <div>{formatRelative(opp.discoveredAt)}</div>
              {opp.deadline && (
                <div className="mt-0.5">Due {formatDate(opp.deadline)}</div>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
