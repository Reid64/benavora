"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Info, Loader2, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";

// ─── Types ────────────────────────────────────────────────────────────────────

type AutomationLevel = "full_auto" | "assisted" | "manual_only" | null;

interface FunderRow {
  id: string;
  name: string;
  giving_portal_url: string | null;
  automation_level: string | null;
  automation_notes: string | null;
  last_assessed: string | null;
}

type FilterKey = "all" | "full_auto" | "assisted" | "manual_only" | "not_set";

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVEL_OPTIONS: { value: AutomationLevel; label: string }[] = [
  { value: null, label: "Not set" },
  { value: "full_auto", label: "Full Auto" },
  { value: "assisted", label: "Assisted" },
  { value: "manual_only", label: "Manual Only" },
];

const LEVEL_COLORS: Record<string, BadgeColor> = {
  full_auto: "green",
  assisted: "blue",
  manual_only: "orange",
};

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  full_auto: "Full Auto",
  assisted: "Assisted",
  manual_only: "Manual Only",
  not_set: "Not Set",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AutomationSettingsPage() {
  const { profile } = useProfile();
  const [funders, setFunders] = useState<FunderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // funder id being saved
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const supabase = createClient();

  const load = useCallback(async () => {
    if (!profile?.organization_id) return;
    setLoading(true);
    setSaveError(null);

    // Join funders with their most recent form_template to surface last_assessed.
    const { data, error } = await supabase
      .from("funders")
      .select(
        `id, name, giving_portal_url, automation_level, automation_notes,
         form_templates(last_verified_at)`,
      )
      .eq("organization_id", profile.organization_id)
      .not("giving_portal_url", "is", null)
      .order("name");

    if (error) {
      setSaveError("Failed to load funders: " + error.message);
      setLoading(false);
      return;
    }

    type RawFunder = {
      id: string;
      name: string;
      giving_portal_url: string | null;
      automation_level: string | null;
      automation_notes: string | null;
      form_templates: { last_verified_at: string | null }[] | null;
    };

    const rows: FunderRow[] = ((data ?? []) as RawFunder[]).map((f) => {
      const templates = Array.isArray(f.form_templates) ? f.form_templates : [];
      const lastVerified =
        templates.length > 0 ? (templates[0]?.last_verified_at ?? null) : null;
      return {
        id: f.id,
        name: f.name,
        giving_portal_url: f.giving_portal_url,
        automation_level: f.automation_level,
        automation_notes: f.automation_notes,
        last_assessed: lastVerified,
      };
    });

    setFunders(rows);
    setLoading(false);
  }, [profile?.organization_id, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // ─── Update a single funder's level ────────────────────────────────────────

  async function updateLevel(funderId: string, level: AutomationLevel) {
    if (!profile?.organization_id) return;
    setSaving(funderId);
    setSaveError(null);

    const { error } = await supabase
      .from("funders")
      .update({ automation_level: level, updated_at: new Date().toISOString() })
      .eq("id", funderId)
      .eq("organization_id", profile.organization_id);

    if (error) {
      setSaveError("Failed to update: " + error.message);
    } else {
      setFunders((prev) =>
        prev.map((f) =>
          f.id === funderId ? { ...f, automation_level: level } : f,
        ),
      );
    }
    setSaving(null);
  }

  // ─── Bulk update ───────────────────────────────────────────────────────────

  async function bulkUpdate(level: AutomationLevel) {
    if (!profile?.organization_id || selected.size === 0) return;
    setBulkSaving(true);
    setSaveError(null);

    const ids = Array.from(selected);
    const { error } = await supabase
      .from("funders")
      .update({ automation_level: level, updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("organization_id", profile.organization_id);

    if (error) {
      setSaveError("Bulk update failed: " + error.message);
    } else {
      setFunders((prev) =>
        prev.map((f) =>
          selected.has(f.id) ? { ...f, automation_level: level } : f,
        ),
      );
      setSelected(new Set());
    }
    setBulkSaving(false);
  }

  // ─── Selection helpers ─────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((f) => f.id)));
    }
  }

  // ─── Filtering ─────────────────────────────────────────────────────────────

  const filtered = funders.filter((f) => {
    if (filter === "all") return true;
    if (filter === "not_set") return !f.automation_level;
    return f.automation_level === filter;
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function levelBadge(level: string | null) {
    if (!level) {
      return <Badge color="gray">Not set</Badge>;
    }
    const color = LEVEL_COLORS[level] ?? "gray";
    const label =
      LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? level;
    return <Badge color={color}>{label}</Badge>;
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  // ─── Counts for filter pills ────────────────────────────────────────────────

  const counts: Record<FilterKey, number> = {
    all: funders.length,
    full_auto: funders.filter((f) => f.automation_level === "full_auto").length,
    assisted: funders.filter((f) => f.automation_level === "assisted").length,
    manual_only: funders.filter((f) => f.automation_level === "manual_only").length,
    not_set: funders.filter((f) => !f.automation_level).length,
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      {/* Back link */}
      <Link
        href="/autoapply"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to AutoApply
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-primary">
          Automation Level Settings
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Control how AutoApply interacts with each funder's giving portal.
          Portals that prohibit bots are automatically set to Manual Only during
          form analysis.
        </p>
      </div>

      {/* Info banner */}
      <Card>
        <div className="flex gap-3 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
          <div className="space-y-2 text-sm text-navy-700">
            <p className="font-medium text-navy-900">Three automation levels</p>
            <ul className="space-y-1.5">
              <li>
                <span className="font-medium text-green-700">Full Auto</span> —
                AutoApply fills and submits without pausing. Confirmation
                screenshots are captured. Only use for portals you have verified
                allow automation.
              </li>
              <li>
                <span className="font-medium text-blue-700">Assisted</span>{" "}
                (default) — AutoApply fills the form, then pauses for you to
                review and click Submit. Balances efficiency with human
                oversight.
              </li>
              <li>
                <span className="font-medium text-warning-text">
                  Manual Only
                </span>{" "}
                — No automation. AutoApply prepares the submission data (pitch,
                amount, documents) and surfaces it in the Manual Queue. You fill
                and submit the form yourself.
              </li>
            </ul>
            <p className="text-navy-500">
              When form analysis detects anti-automation language on a portal
              (confidence &gt; 70%), it automatically sets that funder to Manual
              Only.
            </p>
          </div>
        </div>
      </Card>

      {/* Error */}
      {saveError && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {saveError}
        </div>
      )}

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => (
          <button
            key={key}
            onClick={() => {
              setFilter(key);
              setSelected(new Set());
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === key
                ? "bg-navy-900 text-white"
                : "border border-navy-200 bg-surface text-navy-600 hover:bg-navy-50"
            }`}
          >
            {FILTER_LABELS[key]}
            <span className="ml-1.5 opacity-60">{counts[key]}</span>
          </button>
        ))}
      </div>

      {/* Bulk action bar — visible when rows are selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
          <span className="text-sm font-medium text-navy-700">
            {selected.size} selected
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkSaving}
              onClick={() => void bulkUpdate("assisted")}
            >
              {bulkSaving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Set Assisted
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkSaving}
              onClick={() => void bulkUpdate("manual_only")}
            >
              {bulkSaving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Set Manual Only
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkSaving}
              onClick={() => void bulkUpdate("full_auto")}
            >
              {bulkSaving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Set Full Auto
            </Button>
          </div>
          <button
            className="ml-auto text-xs text-navy-400 hover:text-navy-600"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-navy-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-navy-400">
            {funders.length === 0
              ? "No funders with giving portal URLs found. Add a portal URL to a funder to manage its automation level."
              : "No funders match the selected filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sidebar text-left text-xs font-medium uppercase tracking-wide text-white">
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={
                        selected.size === filtered.length && filtered.length > 0
                      }
                      onChange={toggleSelectAll}
                      className="rounded border-navy-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-4 py-3">Funder</th>
                  <th className="px-4 py-3">Current Level</th>
                  <th className="px-4 py-3">Override Level</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3">Last Assessed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {filtered.map((funder) => (
                  <tr
                    key={funder.id}
                    className={`transition-colors ${
                      selected.has(funder.id) ? "bg-blue-50" : "hover:bg-navy-25"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(funder.id)}
                        onChange={() => toggleSelect(funder.id)}
                        className="rounded border-navy-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>

                    {/* Funder name + portal link */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-navy-900">
                        {funder.name}
                      </div>
                      {funder.giving_portal_url && (
                        <a
                          href={funder.giving_portal_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-navy-400 hover:text-blue-600"
                        >
                          Portal
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>

                    {/* Current level badge */}
                    <td className="px-4 py-3">
                      {levelBadge(funder.automation_level)}
                    </td>

                    {/* Dropdown to override */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={funder.automation_level ?? ""}
                          disabled={saving === funder.id}
                          onChange={(e) => {
                            const val = e.target.value || null;
                            void updateLevel(
                              funder.id,
                              val as AutomationLevel,
                            );
                          }}
                          className="rounded border border-navy-200 bg-surface py-1 pl-2 pr-7 text-xs text-navy-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                        >
                          {LEVEL_OPTIONS.map((opt) => (
                            <option
                              key={opt.value ?? "null"}
                              value={opt.value ?? ""}
                            >
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        {saving === funder.id && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-navy-400" />
                        )}
                      </div>
                    </td>

                    {/* Notes (from auto-detection) */}
                    <td className="max-w-xs px-4 py-3">
                      {funder.automation_notes ? (
                        <span
                          className="line-clamp-2 text-xs text-navy-500"
                          title={funder.automation_notes}
                        >
                          {funder.automation_notes}
                        </span>
                      ) : (
                        <span className="text-xs text-navy-300">—</span>
                      )}
                    </td>

                    {/* Last assessed date */}
                    <td className="px-4 py-3 text-xs text-navy-400">
                      {formatDate(funder.last_assessed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
