"use client";

import Link from "next/link";

import { Badge, Button } from "@/components/ui";
import type { Tables } from "@/types/database";

type FoundationRow = Tables<"foundation_directory">;

// Research & Discovery section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Bronze. Secondary accent: Slate Blue.
const CTA_TEAL_BG = "#A4712C";
const CTA_TEAL_TEXT = "#F8F5EE";

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
function getAccentColor(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes("COMMUNITY FOUNDATION")) return "#7A5980"; // Plum
  if (/\b(CORP|CORPORATION|COMPANY)\b.*FOUNDATION/.test(upper)) {
    return "#C17817"; // Amber
  }
  return "#A4712C"; // Bronze - private foundation (this section's dominant identity)
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
  const accentColor = getAccentColor(foundation.name);

  return (
    <div
      className="bg-surface rounded-xl shadow-sm border border-border p-5 hover:shadow-md transition-all cursor-pointer card-depth"
      style={{
        borderLeft: `4px solid ${accentColor}`,
        boxShadow: "0 4px 12px rgba(16,27,45,0.10)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <label className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            aria-label={`Select ${foundation.name}`}
            style={{ accentColor }}
            className="h-4 w-4 rounded border-slate-300"
          />
        </label>
        {foundation.ntee_code && <Badge color="navy">{foundation.ntee_code}</Badge>}
      </div>

      <Link
        href={`/foundations/${foundation.id}`}
        onClick={(event) => event.stopPropagation()}
        className="mt-2 block truncate text-base font-semibold text-slate-900 hover:underline"
        style={{ color: "#101B2D" }}
      >
        {foundation.name}
      </Link>
      <p className="text-sm text-slate-400 mt-0.5">{location || "Location unknown"}</p>

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
        <span>EIN {foundation.ein || "—"}</span>
        {foundation.foundation_type && <span>Type {foundation.foundation_type}</span>}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-lg font-bold" style={{ color: accentColor }}>{formatCurrency(foundation.asset_amount)}</p>
          <p className="text-xs text-slate-400">Assets</p>
        </div>
        {isImported ? (
          <Badge color="green">Imported</Badge>
        ) : (
          <Button
            size="sm"
            variant="primary"
            isLoading={isImporting}
            disabled={isImporting || !canImport}
            style={{ backgroundColor: CTA_TEAL_BG, color: CTA_TEAL_TEXT, border: "none" }}
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
