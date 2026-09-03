"use client";

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Visible label rendered above the input. */
  label?: string;
  /** Error message; presence switches the field to its invalid styling. */
  error?: string;
  /** Helper text shown below the input when there is no error. */
  helperText?: string;
};

/**
 * Text input with an optional label, error state, and helper text.
 * Associates the label, error, and helper for screen readers.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, helperText, id, className, required, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = error
    ? `${inputId}-error`
    : helperText
      ? `${inputId}-helper`
      : undefined;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-sm font-medium text-slate-700"
        >
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedById}
        className={cn(
          "block w-full bg-surface border rounded-lg px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 outline-none transition-colors disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
          error
            ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/10"
            : "border-slate-200 focus:border-[#3D6B50] focus:ring-2 focus:ring-[#3D6B50]/10",
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : helperText ? (
        <p id={`${inputId}-helper`} className="mt-1.5 text-sm text-slate-500">
          {helperText}
        </p>
      ) : null}
    </div>
  );
});
