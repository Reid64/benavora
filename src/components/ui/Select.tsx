"use client";

import { forwardRef, useId } from "react";
import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type SelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Visible label rendered above the select. */
  label?: string;
  /** Error message; presence switches the field to its invalid styling. */
  error?: string;
  /** Helper text shown below the select when there is no error. */
  helperText?: string;
  /** Options to render. Children take precedence if both are provided. */
  options?: SelectOption[];
  /** Placeholder rendered as a disabled first option. */
  placeholder?: string;
};

/**
 * Dropdown select with an optional label, error state, and helper text.
 * Pass `options` for the common case or `children` for full control.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    error,
    helperText,
    options,
    placeholder,
    id,
    className,
    required,
    children,
    defaultValue,
    value,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const describedById = error
    ? `${selectId}-error`
    : helperText
      ? `${selectId}-helper`
      : undefined;
  // Stay uncontrolled unless a `value` is supplied; default an uncontrolled
  // select to the placeholder option when no `defaultValue` is given.
  const isControlled = value !== undefined;
  const resolvedDefault = isControlled
    ? undefined
    : (defaultValue ?? (placeholder ? "" : undefined));

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={selectId}
          className="mb-1.5 block text-sm font-medium text-slate-700"
        >
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedById}
          value={value}
          defaultValue={resolvedDefault}
          className={cn(
            "block w-full appearance-none bg-white border rounded-lg py-2.5 pl-3 pr-9 text-sm text-slate-700 outline-none transition-colors disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
            error
              ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/10"
              : "border-slate-200 focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/10",
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {children ??
            options?.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
      </div>
      {error ? (
        <p id={`${selectId}-error`} className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : helperText ? (
        <p id={`${selectId}-helper`} className="mt-1.5 text-sm text-slate-500">
          {helperText}
        </p>
      ) : null}
    </div>
  );
});
