import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions (buttons, widgets). */
  actions?: ReactNode;
  /** Vertical alignment of the title block vs. actions. Defaults to "start"
   * (safe for multi-button/widget action areas); use "center" when there's
   * a single action the same height as the title. */
  align?: "start" | "center";
  className?: string;
};

/**
 * White band with a bottom border, sitting at the top of every dashboard
 * page's content — the first of the three visible layers (gray canvas,
 * white header band, white cards).
 */
export function PageHeader({
  title,
  description,
  actions,
  align = "start",
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-surface px-5 py-4 shadow-sm",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap justify-between gap-4",
          align === "center" ? "items-center" : "items-start",
        )}
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-text-muted">{description}</p>
          )}
        </div>
        {actions && (
          <div className={cn("flex gap-3", align === "center" ? "items-center" : "items-start")}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
