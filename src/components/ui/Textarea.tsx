"use client";

import { forwardRef, useId } from "react";
import type { TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Visible label rendered above the textarea. */
  label?: string;
  /** Error message; presence switches the field to its invalid styling. */
  error?: string;
  /** Helper text shown below the textarea when there is no error. */
  helperText?: string;
};

/**
 * Multiline text input with an optional label, error state, and helper text.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, error, helperText, id, className, required, rows = 4, ...props },
    ref,
  ) {
    const generatedId = useId();
    const textareaId = id ?? generatedId;
    const describedById = error
      ? `${textareaId}-error`
      : helperText
        ? `${textareaId}-helper`
        : undefined;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="mb-1.5 block text-sm font-medium text-slate-700"
          >
            {label}
            {required && <span className="ml-0.5 text-red-500">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedById}
          className={cn(
            "block w-full bg-surface border rounded-lg px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 outline-none transition-colors disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
            error
              ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/10"
              : "border-slate-200 focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/10",
            className,
          )}
          {...props}
        />
        {error ? (
          <p id={`${textareaId}-error`} className="mt-1.5 text-sm text-red-600">
            {error}
          </p>
        ) : helperText ? (
          <p
            id={`${textareaId}-helper`}
            className="mt-1.5 text-sm text-slate-500"
          >
            {helperText}
          </p>
        ) : null}
      </div>
    );
  },
);
