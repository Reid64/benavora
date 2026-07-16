"use client";

import { Badge, Button } from "@/components/ui";
import type { Tables } from "@/types/database";

type FoundationRow = Tables<"foundation_directory">;

function formatCurrency(amount: number | null): string {
  if (amount === null) return "—";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

/**
 * foundation_directory only stores the raw IRS foundation code, not a
 * private/community/corporate label — the legal name is the one place that
 * distinction reliably shows up (e.g. "X COMMUNITY FOUNDATION"), so the
 * accent stripe is inferred from it rather than from a dedicated column.
 */
function getAccentClass(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes("COMMUNITY FOUNDATION")) return "border-l-4 border-[#7C3AED]";
  if (/\b(CORP|CORPORATION|COMPANY)\b.*FOUNDATION/.test(upper)) {
    return "border-l-4 border-[#F59E0B]";
  }
  return "border-l-4 border-[#0077B6]";
}

export type FoundationCardProps = {
  foundation: FoundationRow;
  isImported: boolean;
  isImporting: boolean;
  isSelected: boolean;
  canImport: boolean;
  onToggleSelect: () => void;
  onImport: () => void;
};

/** Card view of a foundation directory entry (Elevated Slate design system). */
export function FoundationCard({
  foundation,
  isImported,
  isImporting,
  isSelected,
  canImport,
  onToggleSelect,
  onImport,
}: FoundationCardProps) {
  const location = [foundation.city, foundation.state].filter(Boolean).join(", ");

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-border p-5 hover:shadow-md hover:border-[#00B4D8] transition-all cursor-pointer card-depth border-l-blue border-accent-blue ${getAccentClass(foundation.name)}`}
      style={{
        borderLeft: "4px solid #0077B6",
        boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <label className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            aria-label={`Select ${foundation.name}`}
            className="h-4 w-4 rounded border-slate-300 text-[#0077B6] accent-[#0077B6] focus:ring-[#0077B6]"
          />
        </label>
        {foundation.ntee_code && <Badge color="navy">{foundation.ntee_code}</Badge>}
      </div>

      <h3 className="text-base font-semibold text-slate-900 mt-2 truncate">{foundation.name}</h3>
      <p className="text-sm text-slate-400 mt-0.5">{location || "Location unknown"}</p>

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
        <span>EIN {foundation.ein || "—"}</span>
        {foundation.foundation_type && <span>Type {foundation.foundation_type}</span>}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-lg font-bold text-[#0077B6]">{formatCurrency(foundation.asset_amount)}</p>
          <p className="text-xs text-slate-400">Assets</p>
        </div>
        {isImported ? (
          <Badge color="green">Imported</Badge>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            isLoading={isImporting}
            disabled={isImporting || !canImport}
            onClick={(event) => {
              event.stopPropagation();
              onImport();
            }}
          >
            Import as Funder
          </Button>
        )}
      </div>
    </div>
  );
}
