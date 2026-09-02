import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type AutoSaveIndicatorProps = {
  isSaving: boolean;
  lastSaved: Date | null;
  error?: Error | null;
  className?: string;
};

function formatSavedAt(date: Date): string {
  return `Saved at ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * "Saving…" / "Saved at 2:35 PM" status line for use alongside useAutoSave.
 * Renders nothing until the first save attempt so it doesn't imply a save
 * happened before one actually did.
 */
export function AutoSaveIndicator({
  isSaving,
  lastSaved,
  error,
  className,
}: AutoSaveIndicatorProps) {
  if (!isSaving && !lastSaved && !error) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-1.5 text-xs text-navy-500", className)}
    >
      {isSaving ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0077B6]" aria-hidden />
          <span>Saving…</span>
        </>
      ) : error ? (
        <span className="text-red-600">Auto-save failed — your last edits may not be saved.</span>
      ) : lastSaved ? (
        <span>{formatSavedAt(lastSaved)}</span>
      ) : null}
    </div>
  );
}
