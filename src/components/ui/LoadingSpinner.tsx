import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type LoadingSpinnerSize = "sm" | "md" | "lg";

export type LoadingSpinnerProps = {
  /** Spinner diameter. Defaults to "md". */
  size?: LoadingSpinnerSize;
  /** Optional label rendered beside the spinner and used for screen readers. */
  label?: string;
  /** Center the spinner in a tall flex container. */
  center?: boolean;
  className?: string;
};

const SIZE_CLASSES: Record<LoadingSpinnerSize, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

/**
 * An accessible, animated loading indicator with an optional caption.
 */
export function LoadingSpinner({
  size = "md",
  label,
  center = false,
  className,
}: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 text-slate-500",
        center && "min-h-40 w-full justify-center",
        className,
      )}
    >
      <Loader2
        className={cn("animate-spin text-[#3D6B50]", SIZE_CLASSES[size])}
        aria-hidden
      />
      {label && <span className="text-sm">{label}</span>}
      <span className="sr-only">{label ?? "Loading"}</span>
    </div>
  );
}
