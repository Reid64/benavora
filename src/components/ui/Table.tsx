"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export type SortDirection = "asc" | "desc";

export type TableColumn<T> = {
  /** Stable identifier, also used as the sort key. */
  key: string;
  /** Column heading. */
  header: ReactNode;
  /** Cell renderer for a row. */
  render: (row: T) => ReactNode;
  /** Enable click-to-sort on this column. Requires `sortValue`. */
  sortable?: boolean;
  /** Comparable value used when sorting by this column. */
  sortValue?: (row: T) => string | number;
  /** Horizontal alignment. Defaults to "left". */
  align?: "left" | "center" | "right";
  /** Extra classes applied to the header and body cells. */
  className?: string;
};

export type TableProps<T> = {
  columns: TableColumn<T>[];
  data: T[];
  /** Stable React key for each row. */
  rowKey: (row: T) => string;
  /** Rows per page. Pass 0 to disable pagination. Defaults to 10. */
  pageSize?: number;
  /** Optional row click handler; makes rows interactive. */
  onRowClick?: (row: T) => void;
  /** Message shown when there are no rows. */
  emptyMessage?: string;
  /** Show a loading spinner in place of rows. */
  isLoading?: boolean;
  /** Initial sort column and direction (uncontrolled mode). */
  initialSort?: { key: string; direction: SortDirection };
  /**
   * Controlled sort. When `onSortChange` is supplied, the table reads its sort
   * from `sort` instead of internal state - letting a parent persist it (e.g.
   * to the URL). `initialSort` is ignored in controlled mode.
   */
  sort?: { key: string; direction: SortDirection } | null;
  onSortChange?: (sort: { key: string; direction: SortDirection }) => void;
  className?: string;
  /** Override the outer bordered card's classes. Defaults to the standard table card look. */
  containerClassName?: string;
  /** Override the `<table>` element's classes (e.g. to drop the default row dividers). */
  tableClassName?: string;
  /** Override the `<thead>` row's classes. */
  theadClassName?: string;
  /** Override each `<th>`'s classes (alignment classes are still applied on top). */
  thClassName?: string;
  /** Override the `<tbody>`'s classes. */
  tbodyClassName?: string;
  /** Override each data row's classes, replacing the default hover/cursor treatment. */
  rowClassName?: string;
};

const ALIGN_CLASSES = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

/**
 * Sortable, paginated data table. Sorting and pagination run client-side over
 * the provided `data`. Mark columns `sortable` and give them a `sortValue`.
 */
export function Table<T>({
  columns,
  data,
  rowKey,
  pageSize = 10,
  onRowClick,
  emptyMessage = "No records to display.",
  isLoading = false,
  initialSort,
  sort,
  onSortChange,
  className,
  containerClassName,
  tableClassName,
  theadClassName,
  thClassName,
  tbodyClassName,
  rowClassName,
}: TableProps<T>) {
  const controlled = onSortChange != null;
  const [internalKey, setInternalKey] = useState<string | null>(
    initialSort?.key ?? null,
  );
  const [internalDirection, setInternalDirection] = useState<SortDirection>(
    initialSort?.direction ?? "asc",
  );
  const sortKey = controlled ? (sort?.key ?? null) : internalKey;
  const sortDirection = controlled ? (sort?.direction ?? "asc") : internalDirection;
  const [page, setPage] = useState(1);

  const sortedData = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey);
    if (!column?.sortValue) return data;
    const accessor = column.sortValue;
    const factor = sortDirection === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [columns, data, sortKey, sortDirection]);

  const paginate = pageSize > 0;
  const totalPages = paginate ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;
  const currentPage = Math.min(page, totalPages);
  const pageRows = paginate
    ? sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : sortedData;

  function handleSort(column: TableColumn<T>) {
    if (!column.sortable || !column.sortValue) return;
    // Toggle direction when re-clicking the active column; otherwise sort the
    // new column ascending.
    const nextDirection: SortDirection =
      sortKey === column.key && sortDirection === "asc" ? "desc" : "asc";
    if (controlled) {
      onSortChange?.({ key: column.key, direction: nextDirection });
    } else {
      setInternalKey(column.key);
      setInternalDirection(nextDirection);
    }
    setPage(1);
  }

  const colSpan = columns.length;

  return (
    <div className={cn("w-full", className)}>
      <div
        className={
          containerClassName ??
          "overflow-x-auto rounded-xl border border-slate-200 bg-surface shadow-sm"
        }
      >
        <table className={tableClassName ?? "min-w-full divide-y divide-slate-200"}>
          <thead className={theadClassName ?? "bg-surface-sunken"}>
            <tr>
              {columns.map((column) => {
                const isSorted = sortKey === column.key;
                const sortable = column.sortable && Boolean(column.sortValue);
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      isSorted
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={cn(
                      thClassName ??
                        "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600",
                      ALIGN_CLASSES[column.align ?? "left"],
                      column.className,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column)}
                        className="inline-flex items-center gap-1 transition hover:text-slate-900 focus:outline-none focus-visible:text-slate-900"
                      >
                        {column.header}
                        {isSorted ? (
                          sortDirection === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                          )
                        ) : (
                          <ChevronsUpDown
                            className="h-3.5 w-3.5 text-slate-400"
                            aria-hidden
                          />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={tbodyClassName ?? "divide-y divide-slate-200 bg-surface"}>
            {isLoading ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-12">
                  <LoadingSpinner center label="Loading..." />
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpan}
                  className="px-4 py-12 text-center text-sm text-slate-500"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={
                    rowClassName ??
                    cn("transition", onRowClick && "cursor-pointer hover:bg-slate-50")
                  }
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-4 py-3 text-sm text-slate-700",
                        ALIGN_CLASSES[column.align ?? "left"],
                        column.className,
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {paginate && !isLoading && sortedData.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            Showing{" "}
            <span className="font-medium text-slate-700">
              {(currentPage - 1) * pageSize + 1}
            </span>
            -
            <span className="font-medium text-slate-700">
              {Math.min(currentPage * pageSize, sortedData.length)}
            </span>{" "}
            of{" "}
            <span className="font-medium text-slate-700">
              {sortedData.length}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              Previous
            </Button>
            <span className="text-sm text-slate-500">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
