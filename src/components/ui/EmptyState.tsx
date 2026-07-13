import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type EmptyStateProps = {
  /** Lucide (or compatible) icon component. Defaults to an inbox. */
  icon?: LucideIcon;
  /** Primary heading. */
  title: string;
  /** Supporting copy under the title. */
  description?: string;
  /** Optional call-to-action (e.g. a "New funder" button). */
  action?: ReactNode;
  className?: string;
};

/**
 * Centered placeholder for empty lists: an illustrative icon, a message,
 * and an optional call-to-action.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <Icon className="h-6 w-6 text-slate-400" aria-hidden />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
