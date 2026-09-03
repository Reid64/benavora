"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type SearchBarProps = {
  /** Debounced change handler - fires `delay` ms after typing stops. */
  onSearch: (value: string) => void;
  /** Placeholder text. */
  placeholder?: string;
  /** Initial value for the uncontrolled input. */
  defaultValue?: string;
  /** Debounce delay in milliseconds. Defaults to 300. */
  delay?: number;
  /** Accessible label when no visible label is present. */
  "aria-label"?: string;
  className?: string;
};

/**
 * Search input that debounces calls to `onSearch`, with a clear button.
 */
export function SearchBar({
  onSearch,
  placeholder = "Search...",
  defaultValue = "",
  delay = 300,
  "aria-label": ariaLabel = "Search",
  className,
}: SearchBarProps) {
  const [value, setValue] = useState(defaultValue);
  // Keep the latest callback without re-arming the debounce timer on each render.
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  // Skip firing onSearch for the initial mount value.
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const timer = setTimeout(() => onSearchRef.current(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return (
    <div className={cn("relative w-full", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="block w-full rounded-lg border border-slate-200 bg-surface py-2.5 pl-9 pr-9 text-sm text-slate-700 placeholder-slate-400 outline-none transition-colors focus:border-[#3D6B50] focus:ring-2 focus:ring-[#3D6B50]/10 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D6B50]"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
