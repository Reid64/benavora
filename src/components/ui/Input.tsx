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
          className="mb-1.5 block text-sm font-medium text-navy-700"
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
          "block w-full rounded-lg border bg-white px-3 py-2 text-sm text-navy-900 shadow-sm transition placeholder:text-navy-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-navy-50 disabled:text-navy-500",
          error
            ? "border-red-300 focus:border-red-500 focus:ring-red-500"
            : "border-navy-300 focus:border-teal-500 focus:ring-teal-500",
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : helperText ? (
        <p id={`${inputId}-helper`} className="mt-1.5 text-sm text-navy-500">
          {helperText}
        </p>
      ) : null}
    </div>
  );
});
