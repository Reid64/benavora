"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, X } from "lucide-react";

import { Badge, Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

interface AutoQueueConfig {
  id: string;
  organization_id: string;
  enabled: boolean;
  max_per_batch: number;
  schedule: string;
  categories: string[] | null;
  geographic_scope: string[] | null;
  min_company_size: string | null;
  exclusion_list: string[] | null;
  dedup_window_days: number;
  last_run_at: string | null;
  last_run_queued: number | null;
  last_run_skipped: number | null;
  created_at: string;
  updated_at: string;
}

interface FunderOption {
  id: string;
  name: string;
}

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "private_foundation", label: "Private Foundation" },
  { value: "corporate", label: "Corporate" },
  { value: "community_foundation", label: "Community Foundation" },
  { value: "government", label: "Government" },
];

const SCHEDULE_OPTIONS = [
  { value: "nightly", label: "Nightly" },
  { value: "twice_daily", label: "Twice Daily" },
  { value: "weekly", label: "Weekly" },
];

const DEDUP_WINDOW_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
];

const MIN_COMPANY_SIZE_OPTIONS = [
  { value: "", label: "No minimum" },
  { value: "small", label: "Small (< 50 employees)" },
  { value: "medium", label: "Medium (50–500 employees)" },
  { value: "large", label: "Large (500+ employees)" },
];

export default function AutoApplySettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [queueingNow, setQueueingNow] = useState(false);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [queueNowResult, setQueueNowResult] = useState<{ queued: number; skipped: number } | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [schedule, setSchedule] = useState("nightly");
  const [maxPerBatch, setMaxPerBatch] = useState(50);
  const [categories, setCategories] = useState<string[]>([]);
  const [geographicScope, setGeographicScope] = useState<string[]>([]);
  const [geoInput, setGeoInput] = useState("");
  const [minCompanySize, setMinCompanySize] = useState("");
  const [dedupWindowDays, setDedupWindowDays] = useState(30);
  const [exclusionList, setExclusionList] = useState<string[]>([]);

  // Funder lookup for exclusion list display
  const [excludedFunders, setExcludedFunders] = useState<FunderOption[]>([]);
  const [allFunders, setAllFunders] = useState<FunderOption[]>([]);
  const [funderSearch, setFunderSearch] = useState("");

  const loadExcludedFunderNames = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setExcludedFunders([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("funders")
      .select("id, name")
      .in("id", ids);
    setExcludedFunders((data ?? []) as FunderOption[]);
  }, []);

  const loadEligibleCount = useCallback(async (currentExclusionList: string[]) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("funders")
      .select("id")
      .not("giving_portal_url", "is", null);
    const all = (data ?? []) as { id: string }[];
    const exclSet = new Set(currentExclusionList);
    setEligibleCount(all.filter((f) => !exclSet.has(f.id)).length);
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/autoapply/config");
        if (res.ok) {
          const json = (await res.json()) as { config: AutoQueueConfig | null };
          const cfg = json.config;
          if (cfg) {
            setEnabled(cfg.enabled);
            setSchedule(cfg.schedule);
            setMaxPerBatch(cfg.max_per_batch);
            setCategories(cfg.categories ?? []);
            setGeographicScope(cfg.geographic_scope ?? []);
            setGeoInput((cfg.geographic_scope ?? []).join(", "));
            setMinCompanySize(cfg.min_company_size ?? "");
            setDedupWindowDays(cfg.dedup_window_days);
            const excl = cfg.exclusion_list ?? [];
            setExclusionList(excl);
            await loadExcludedFunderNames(excl);
            await loadEligibleCount(excl);
          } else {
            await loadEligibleCount([]);
          }
        }
        // Load all funders for exclusion search
        const supabase = createClient();
        const { data } = await supabase
          .from("funders")
          .select("id, name")
          .not("giving_portal_url", "is", null)
          .order("name");
        setAllFunders((data ?? []) as FunderOption[]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [loadExcludedFunderNames, loadEligibleCount]);

  function toggleCategory(value: string) {
    setCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    );
  }

  function handleGeoInputBlur() {
    const parsed = geoInput
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    setGeographicScope(parsed);
  }

  function removeExclusion(id: string) {
    const next = exclusionList.filter((eid) => eid !== id);
    setExclusionList(next);
    setExcludedFunders((prev) => prev.filter((f) => f.id !== id));
    void loadEligibleCount(next);
  }

  function addExclusion(funder: FunderOption) {
    if (exclusionList.includes(funder.id)) return;
    const nextList = [...exclusionList, funder.id];
    setExclusionList(nextList);
    setExcludedFunders((prev) => [...prev, funder]);
    setFunderSearch("");
    void loadEligibleCount(nextList);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/autoapply/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled,
          max_per_batch: maxPerBatch,
          schedule,
          categories: categories.length > 0 ? categories : null,
          geographic_scope: geographicScope.length > 0 ? geographicScope : null,
          min_company_size: minCompanySize || null,
          exclusion_list: exclusionList.length > 0 ? exclusionList : null,
          dedup_window_days: dedupWindowDays,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(err.error ?? "Failed to save settings.");
        return;
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleQueueNow() {
    setQueueingNow(true);
    setQueueNowResult(null);
    setSaveError(null);
    try {
      const supabase = createClient();

      // Find funders with portal URLs not already pending/processing and not excluded
      const { data: alreadyQueued } = await supabase
        .from("submission_queue")
        .select("funder_id")
        .in("status", ["pending", "processing"]);
      const queuedIds = new Set(
        (alreadyQueued ?? [])
          .map((r) => r.funder_id)
          .filter((id): id is string => id !== null),
      );

      const exclSet = new Set(exclusionList);

      const { data: allEligible } = await supabase
        .from("funders")
        .select("id, category")
        .not("giving_portal_url", "is", null)
        .order("name");

      const categoryMap: Record<string, string[]> = {
        private_foundation: ["private_foundation"],
        corporate: ["corporate_donation", "corporate_sponsorship", "corporate_foundation"],
        community_foundation: ["local_community_grant"],
        government: ["government_grant"],
      };
      const targetCategories = categories.flatMap((c) => categoryMap[c] ?? []);

      const rawEligible = (allEligible ?? []) as { id: string; category: string | null }[];
      const eligibleIds = rawEligible
        .filter((f) => !queuedIds.has(f.id) && !exclSet.has(f.id))
        .filter((f) =>
          targetCategories.length === 0 ||
          (f.category !== null && targetCategories.includes(f.category)),
        )
        .map((f) => f.id)
        .slice(0, maxPerBatch);

      if (eligibleIds.length === 0) {
        setQueueNowResult({ queued: 0, skipped: 0 });
        return;
      }

      const res = await fetch("/api/autoapply/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funder_ids: eligibleIds }),
      });
      if (res.ok) {
        const result = (await res.json()) as { queued: number; skipped: number };
        setQueueNowResult(result);
        await loadEligibleCount(exclusionList);
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(err.error ?? "Failed to queue funders.");
      }
    } catch {
      setSaveError("Could not reach the server. Please try again.");
    } finally {
      setQueueingNow(false);
    }
  }

  const filteredFunderSearch = funderSearch.length >= 2
    ? allFunders.filter(
        (f) =>
          f.name.toLowerCase().includes(funderSearch.toLowerCase()) &&
          !exclusionList.includes(f.id),
      ).slice(0, 8)
    : [];

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-navy-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/autoapply"
          className="flex items-center gap-1.5 text-sm text-navy-400 hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AutoApply
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          AutoApply Settings
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Configure autonomous queue population. When enabled, the system automatically queues eligible funders on the selected schedule.
        </p>
      </div>

      {saveError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div
          role="status"
          className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700"
        >
          Settings saved successfully.
        </div>
      )}

      {/* Stats bar */}
      <div className="flex items-center gap-6 rounded-lg border border-navy-200 bg-navy-50 px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-navy-400">Eligible for Auto-Queue</p>
          <p className="mt-0.5 text-2xl font-semibold text-navy-900">
            {eligibleCount === null ? "—" : eligibleCount.toLocaleString()}
          </p>
          <p className="text-xs text-navy-400">funders with portal URLs</p>
        </div>
        <div className="flex-1" />
        <Button
          onClick={() => void handleQueueNow()}
          isLoading={queueingNow}
          disabled={queueingNow}
        >
          Queue Eligible Funders Now
        </Button>
        {queueNowResult && (
          <p className="text-sm text-navy-500">
            Queued {queueNowResult.queued}, skipped {queueNowResult.skipped} already in queue.
          </p>
        )}
      </div>

      {/* Main settings */}
      <Card title="Autonomous Queue Population">
        <div className="space-y-6">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-navy-900">Enable Autonomous Queue Population</p>
              <p className="mt-0.5 text-xs text-navy-500">
                When on, eligible funders are automatically added to the queue on the selected schedule.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${
                enabled ? "bg-teal-500" : "bg-navy-200"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <hr className="border-navy-100" />

          {/* Schedule */}
          <div>
            <label
              htmlFor="schedule"
              className="block text-sm font-medium text-navy-700"
            >
              Schedule
            </label>
            <select
              id="schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              className="mt-1.5 block w-48 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            >
              {SCHEDULE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Max per batch */}
          <div>
            <label
              htmlFor="maxPerBatch"
              className="block text-sm font-medium text-navy-700"
            >
              Max per Batch
            </label>
            <p className="mt-0.5 text-xs text-navy-500">
              Maximum number of funders queued in a single automated run.
            </p>
            <input
              id="maxPerBatch"
              type="number"
              min={1}
              max={500}
              value={maxPerBatch}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setMaxPerBatch(Math.max(1, Math.min(500, v)));
              }}
              className="mt-1.5 block w-32 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>

          <hr className="border-navy-100" />

          {/* Categories */}
          <div>
            <p className="text-sm font-medium text-navy-700">Categories</p>
            <p className="mt-0.5 text-xs text-navy-500">
              Only queue funders in these categories. Leave unchecked to include all categories.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-3">
              {CATEGORY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-navy-700"
                >
                  <input
                    type="checkbox"
                    checked={categories.includes(opt.value)}
                    onChange={() => toggleCategory(opt.value)}
                    className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Geographic scope */}
          <div>
            <label
              htmlFor="geoScope"
              className="block text-sm font-medium text-navy-700"
            >
              Geographic Scope
            </label>
            <p className="mt-0.5 text-xs text-navy-500">
              State codes to target, comma-separated (e.g. TX, OK, NM). Leave blank for nationwide.
            </p>
            <input
              id="geoScope"
              type="text"
              value={geoInput}
              onChange={(e) => setGeoInput(e.target.value)}
              onBlur={handleGeoInputBlur}
              placeholder="TX, OK, NM"
              className="mt-1.5 block w-72 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            {geographicScope.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {geographicScope.map((s) => (
                  <Badge key={s} variant="neutral" className="gap-1">
                    {s}
                    <button
                      type="button"
                      onClick={() => {
                        const next = geographicScope.filter((x) => x !== s);
                        setGeographicScope(next);
                        setGeoInput(next.join(", "));
                      }}
                      className="ml-0.5 text-text-muted hover:text-text"
                      aria-label={`Remove ${s}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Dedup window */}
          <div>
            <label
              htmlFor="dedupWindow"
              className="block text-sm font-medium text-navy-700"
            >
              Dedup Window
            </label>
            <p className="mt-0.5 text-xs text-navy-500">
              Skip funders that were successfully submitted within this window.
            </p>
            <select
              id="dedupWindow"
              value={dedupWindowDays}
              onChange={(e) => setDedupWindowDays(Number(e.target.value))}
              className="mt-1.5 block w-40 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            >
              {DEDUP_WINDOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Min company size */}
          <div>
            <label
              htmlFor="minSize"
              className="block text-sm font-medium text-navy-700"
            >
              Minimum Company Size
            </label>
            <select
              id="minSize"
              value={minCompanySize}
              onChange={(e) => setMinCompanySize(e.target.value)}
              className="mt-1.5 block w-56 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            >
              {MIN_COMPANY_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Exclusion list */}
      <Card
        title="Exclusion List"
        description="Funders in this list will never be auto-queued."
      >
        <div className="space-y-4">
          {/* Search to add */}
          <div className="relative">
            <label
              htmlFor="funderSearch"
              className="block text-sm font-medium text-navy-700"
            >
              Add funder to exclusion list
            </label>
            <input
              id="funderSearch"
              type="text"
              value={funderSearch}
              onChange={(e) => setFunderSearch(e.target.value)}
              placeholder="Search funder name…"
              className="mt-1.5 block w-72 rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            {filteredFunderSearch.length > 0 && (
              <ul className="absolute z-10 mt-1 w-72 overflow-hidden rounded-md border border-navy-200 bg-white shadow-lg">
                {filteredFunderSearch.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => addExclusion(f)}
                      className="w-full px-4 py-2.5 text-left text-sm text-navy-700 hover:bg-navy-50"
                    >
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Current exclusions */}
          {excludedFunders.length === 0 ? (
            <p className="text-sm text-navy-400">No funders excluded.</p>
          ) : (
            <div className="space-y-1">
              {excludedFunders.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-md border border-navy-100 bg-navy-50 px-3 py-2"
                >
                  <span className="text-sm text-navy-700">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeExclusion(f.id)}
                    className="text-navy-400 hover:text-red-500"
                    aria-label={`Remove ${f.name} from exclusion list`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Compliance link */}
      <div className="flex items-center justify-between rounded-lg border border-navy-200 bg-navy-50 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-navy-900">Solicitation Registrations</p>
          <p className="mt-0.5 text-xs text-navy-500">
            Manage the states where your organization is registered to solicit donations. AutoApply skips funders in unregistered states.
          </p>
        </div>
        <Link href="/autoapply/compliance">
          <Button variant="secondary">Manage</Button>
        </Link>
      </div>

      {/* Save button */}
      <div className="flex justify-end gap-3 pb-8">
        <Link href="/autoapply">
          <Button variant="secondary">Cancel</Button>
        </Link>
        <Button onClick={() => void handleSave()} isLoading={saving} disabled={saving}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}
