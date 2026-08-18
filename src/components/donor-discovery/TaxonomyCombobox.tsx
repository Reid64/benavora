"use client";

// Multi-select taxonomy picker for the New Discovery wizard step 1
// (DONOR_DISCOVERY_ARCHITECTURE.md §4.2). Debounces free-text queries against
// GET /api/donor-discovery/taxonomy/search, which ranks alias hits above
// label hits and returns each match's ancestry breadcrumb.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Loader2, Search, X } from "lucide-react";

import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export interface TaxonomyComboboxOption {
  id: string;
  code: string;
  label: string;
  kind: string;
  ancestry_label: string | null;
  matched_alias: string | null;
}

interface TaxonomySearchResponse {
  results?: TaxonomyComboboxOption[];
  error?: string;
}

const DEBOUNCE_MS = 300;

const POPULAR_CATEGORIES = [
  "Construction Trades",
  "Site Services",
  "Food Services",
  "Professional Services",
  "Manufacturing",
];

export interface TaxonomyComboboxProps {
  selected: TaxonomyComboboxOption[];
  onChange: (selected: TaxonomyComboboxOption[]) => void;
  placeholder?: string;
  className?: string;
}

export function TaxonomyCombobox({
  selected,
  onChange,
  placeholder = "Search by trade service or material",
  className,
}: TaxonomyComboboxProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<TaxonomyComboboxOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against an earlier, slower request clobbering a later one's results.
  const requestIdRef = useRef(0);

  const selectedIds = useMemo(() => new Set(selected.map((option) => option.id)), [selected]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/donor-discovery/taxonomy/search?q=${encodeURIComponent(debouncedQuery)}`);
        const payload = (await res.json().catch(() => ({}))) as TaxonomySearchResponse;
        if (cancelled || requestId !== requestIdRef.current) return;
        if (!res.ok) {
          setError(payload.error ?? "Failed to search taxonomy.");
          setResults([]);
        } else {
          setResults(payload.results ?? []);
        }
      } catch {
        if (cancelled || requestId !== requestIdRef.current) return;
        setError("Could not reach the search service.");
        setResults([]);
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [results]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectOption = useCallback(
    (option: TaxonomyComboboxOption) => {
      if (!selectedIds.has(option.id)) {
        onChange([...selected, option]);
      }
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setIsOpen(false);
      inputRef.current?.focus();
    },
    [onChange, selected, selectedIds],
  );

  const removeOption = useCallback(
    (id: string) => {
      onChange(selected.filter((option) => option.id !== id));
    },
    [onChange, selected],
  );

  function selectPopularCategory(label: string) {
    setQuery(label);
    setDebouncedQuery(label);
    setIsOpen(true);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (results.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % results.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) return;
      if (results.length > 0) {
        setHighlightedIndex((prev) => (prev - 1 + results.length) % results.length);
      }
    } else if (event.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < results.length) {
        const option = results[highlightedIndex];
        if (option) {
          event.preventDefault();
          selectOption(option);
        }
      }
    } else if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
      }
    } else if (event.key === "Backspace" && query.length === 0 && selected.length > 0) {
      const last = selected[selected.length - 1];
      if (last) removeOption(last.id);
    }
  }

  const showEmptyState = isOpen && debouncedQuery.length === 0;
  const showResults = isOpen && debouncedQuery.length > 0;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {selected.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((option) => (
            <Badge key={option.id} color="teal" className="gap-1 pr-1">
              {option.label}
              <button
                type="button"
                onClick={() => removeOption(option.id)}
                className="rounded-full p-0.5 hover:bg-black/10"
                aria-label={`Remove ${option.label}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mb-2 text-xs font-medium text-text-muted">All industries</p>
      )}

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls="taxonomy-combobox-listbox"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="block w-full rounded-lg border border-navy-300 bg-surface py-2 pl-9 pr-9 text-sm text-navy-900 shadow-sm transition placeholder:text-navy-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        {loading && (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-navy-400"
            aria-hidden
          />
        )}
      </div>

      {(showEmptyState || showResults) && (
        <div
          id="taxonomy-combobox-listbox"
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
        >
          {showEmptyState ? (
            <div className="p-3">
              <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                Popular categories
              </p>
              <div className="flex flex-wrap gap-1.5 px-1">
                {POPULAR_CATEGORIES.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => selectPopularCategory(label)}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-text hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : error ? (
            <p className="px-4 py-6 text-center text-sm text-red-600">{error}</p>
          ) : loading && results.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Searching…
            </div>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted">
              No matches for &ldquo;{debouncedQuery}&rdquo;.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((option, index) => {
                const isSelected = selectedIds.has(option.id);
                const isHighlighted = index === highlightedIndex;
                return (
                  <li key={option.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => selectOption(option)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      disabled={isSelected}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left",
                        isHighlighted ? "bg-teal-50" : "hover:bg-surface-sunken",
                        isSelected && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="text-sm font-semibold text-text">
                        {option.matched_alias ?? option.label}
                      </span>
                      {option.ancestry_label && (
                        <span className="text-xs text-text-muted">{option.ancestry_label}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
