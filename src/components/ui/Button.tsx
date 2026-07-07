import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "purple"
  | "danger"
  | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual style. Defaults to "primary". */
  variant?: ButtonVariant;
  /** Padding/text scale. Defaults to "md". */
  size?: ButtonSize;
  /** Show a spinner and disable interaction. */
  isLoading?: boolean;
  /** Stretch to fill the available width. */
  fullWidth?: boolean;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-accent bg-[length:200%_100%] bg-left text-white shadow-glow-blue hover:bg-right hover:shadow-glow focus-visible:ring-teal-400",
  secondary:
    "border border-white/15 bg-white/5 text-navy-100 backdrop-blur-sm hover:bg-white/10 hover:border-white/25 focus-visible:ring-teal-400",
  purple:
    "bg-gradient-purple text-white shadow-glow-purple hover:brightness-110 focus-visible:ring-primary",
  danger:
    "border border-red-400/30 bg-red-500/90 text-white shadow-sm shadow-red-900/40 hover:bg-red-500 focus-visible:ring-red-400",
  ghost:
    "text-navy-300 hover:bg-white/10 hover:text-white focus-visible:ring-teal-400",
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
    fullWidth = false,
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
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
