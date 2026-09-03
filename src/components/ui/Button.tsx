import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual style. Defaults to "primary". */
  variant?: ButtonVariant;
  /** Padding/text scale. Defaults to "md". */
  size?: ButtonSize;
  /** Show a spinner and disable interaction. */
  isLoading?: boolean;
  /** @deprecated Full-width stretching was removed — buttons are now capped at
   * 180px (primary/danger) or 160px (secondary/ghost). Kept as a no-op prop
   * so existing callers don't need to be touched. */
  fullWidth?: boolean;
};

/**
 * `primary` is the default for every card CTA — Run, Apply, Add to Queue,
 * Re-score, and any other primary action, not just form submits.
 * `secondary` is a visible gray chip (never a borderless white-on-white
 * button). `ghost` has no border or background of its own — reserve it for
 * buttons inside a colored header/banner that already provides definition;
 * on the plain page background or a white card it has too little affordance.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-[#3D6B50] hover:bg-[#2C4E3B] text-white shadow-sm focus-visible:ring-[#3D6B50] max-w-[180px]",
  secondary:
    "bg-surface border border-slate-200 text-slate-700 hover:border-[#3D6B50] hover:text-[#3D6B50] focus-visible:ring-[#3D6B50] max-w-[160px]",
  danger:
    "bg-[#EF4444] hover:bg-[#B91C1C] text-white shadow-sm focus-visible:ring-[#EF4444] max-w-[180px]",
  ghost: "text-primary hover:bg-primary/10 focus-visible:ring-primary max-w-[160px]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-base",
};

/**
 * Primary action button with variant, size, and loading states.
 * Forwards refs and all native button attributes.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    isLoading = false,
    fullWidth: _fullWidth = false,
    disabled,
    className,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
