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
            className="mb-1.5 block text-sm font-medium text-navy-700"
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
            "block w-full rounded-lg border bg-white px-3 py-2 text-sm text-navy-900 shadow-sm transition placeholder:text-navy-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-navy-50 disabled:text-navy-500",
            error
              ? "border-red-300 focus:border-red-500 focus:ring-red-500"
              : "border-navy-300 focus:border-teal-500 focus:ring-teal-500",
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
            className="mt-1.5 text-sm text-navy-500"
          >
            {helperText}
          </p>
        ) : null}
      </div>
    );
  },
);
