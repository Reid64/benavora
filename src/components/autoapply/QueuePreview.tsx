"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Clock, ExternalLink, Play, X } from "lucide-react";

import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { populateQueue, getQueueableCount } from "@/lib/autoapply/auto-queue-populator";
import type { DryRunFunder } from "@/lib/autoapply/auto-queue-populator";

type AutoQueueConfig = {
  enabled: boolean;
  schedule: string;
  max_per_batch: number;
  categories: string[] | null;
  exclusion_list: string[] | null;
  dedup_window_days: number;
};

function formatSchedule(cron: string): string {
  // Simple human-readable for common cron patterns
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;
  const [min, hour] = parts;
  if (min === "0" && hour !== "*") {
    const h = parseInt(hour ?? "", 10);
    const period = h >= 12 ? "PM" : "AM";
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${display}:00 ${period} daily`;
  }
  return cron;
}

export function QueuePreview() {
  const { profile } = useProfile();

  const [config, setConfig] = useState<AutoQueueConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  const [previewFunders, setPreviewFunders] = useState<DryRunFunder[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  const [queueing, setQueueing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueSuccess, setQueueSuccess] = useState(false);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("auto_queue_config")
      .select("enabled, schedule, max_per_batch, categories, exclusion_list, dedup_window_days")
      .maybeSingle();
    setConfig(
      data
        ? {
            enabled: data.enabled,
            schedule: data.schedule,
            max_per_batch: data.max_per_batch,
            categories: data.categories,
            exclusion_list: data.exclusion_list,
            dedup_window_days: (data.dedup_window_days as number | null | undefined) ?? 30,
          }
        : null,
    );
    setConfigLoading(false);
  }, []);

  const loadCount = useCallback(async () => {
    if (!profile?.organization_id) return;
    setCountLoading(true);
    try {
      const supabase = createClient();
      const count = await getQueueableCount(profile.organization_id, supabase);
      setEligibleCount(count);
    } catch {
      setEligibleCount(null);
    } finally {
      setCountLoading(false);
    }
  }, [profile?.organization_id]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    void loadCount();
  }, [loadCount]);

  async function handlePreview() {
    if (!profile?.organization_id) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewFunders(null);
    setDeselected(new Set());
    setQueueSuccess(false);
    try {
      const supabase = createClient();
      const result = await populateQueue({
        organizationId: profile.organization_id,
        supabase,
        maxItems: config?.max_per_batch ?? 50,
        dry_run: true,
        dedupWindowDays: config?.dedup_window_days,
        filters: {
          categories: config?.categories ?? undefined,
          excludeFunderIds: config?.exclusion_list ?? undefined,
        },
      });
      if ("funders" in result) {
        setPreviewFunders(result.funders);
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleQueueNow() {
    if (!profile?.organization_id || !previewFunders) return;
    const remaining = previewFunders.filter((f) => !deselected.has(f.id));
    if (remaining.length === 0) return;
    setQueueing(true);
    setQueueError(null);
    try {
      const supabase = createClient();
      await populateQueue({
        organizationId: profile.organization_id,
        supabase,
        maxItems: remaining.length,
        dry_run: false,
        dedupWindowDays: config?.dedup_window_days,
        filters: {
          excludeFunderIds: [
            ...(config?.exclusion_list ?? []),
            ...Array.from(deselected),
          ],
        },
      });
      setQueueSuccess(true);
      setPreviewFunders(null);
      void loadCount();
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : "Failed to queue funders.");
    } finally {
      setQueueing(false);
    }
  }

  function toggleDeselect(id: string) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleFunders = previewFunders?.filter((f) => !deselected.has(f.id)) ?? [];

  if (configLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-4 shadow-sm">
        <p className="text-sm text-navy-400">Loading queue config…</p>
      </div>
    );
  }

  const isDisabled = config !== null && !config.enabled;

  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-navy-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-navy-400" aria-hidden />
          <h2 className="text-sm font-semibold text-navy-900">Queue Preview</h2>
          {config?.schedule && (
            <span className="text-xs text-navy-400">
              — next run: {formatSchedule(config.schedule)}
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Disabled banner */}
        {isDisabled && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Autonomous mode is disabled.{" "}
              <Link href="/autoapply/settings" className="underline hover:text-amber-900">
                Enable it in Settings.
              </Link>
            </span>
          </div>
        )}

        {/* Eligible count */}
        <div className="flex items-baseline gap-3 flex-wrap">
          <p className="text-sm text-navy-600">
            {countLoading ? (
              <span className="text-navy-400">Counting eligible funders…</span>
            ) : eligibleCount !== null ? (
              <span>
                <span className="font-semibold text-navy-900">{eligibleCount}</span>{" "}
                funder{eligibleCount === 1 ? "" : "s"} eligible for auto-queue
              </span>
            ) : (
              <span className="text-navy-400">—</span>
            )}
          </p>
          {config !== null && (
            <span className="text-xs text-navy-400">
              {config.dedup_window_days}-day dedup window
            </span>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handlePreview()}
            isLoading={previewLoading}
            disabled={previewLoading || isDisabled}
          >
            Preview Tonight&apos;s Queue
          </Button>
          {previewFunders && visibleFunders.length > 0 && (
            <Button
              size="sm"
              onClick={() => void handleQueueNow()}
              isLoading={queueing}
              disabled={queueing || visibleFunders.length === 0}
            >
              <Play className="mr-1 h-3.5 w-3.5" />
              Queue Now ({visibleFunders.length})
            </Button>
          )}
        </div>

        {/* Errors */}
        {previewError && (
          <p className="text-sm text-red-500">{previewError}</p>
        )}
        {queueError && (
          <p className="text-sm text-red-500">{queueError}</p>
        )}

        {/* Success */}
        {queueSuccess && (
          <p className="text-sm text-teal-600">Funders queued successfully.</p>
        )}

        {/* Preview table */}
        {previewFunders && (
          <div>
            {previewFunders.length === 0 ? (
              <p className="text-sm text-navy-400">No eligible funders found for this run.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-navy-100">
                <table className="min-w-full divide-y divide-navy-100 text-sm">
                  <thead>
                    <tr className="bg-sidebar">
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        Funder
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        Category
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        Location
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        Portal
                      </th>
                      <th className="w-8 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100 bg-white">
                    {previewFunders.map((funder) => {
                      const excluded = deselected.has(funder.id);
                      const location = [funder.city, funder.state].filter(Boolean).join(", ");
                      return (
                        <tr
                          key={funder.id}
                          className={excluded ? "opacity-40" : "hover:bg-navy-50"}
                        >
                          <td className="px-4 py-2.5 font-medium text-navy-900">
                            {funder.name}
                          </td>
                          <td className="px-4 py-2.5 text-navy-500">
                            {funder.category ?? "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-navy-500">
                            {location || "—"}
                          </td>
                          <td className="max-w-xs px-4 py-2.5">
                            <a
                              href={funder.giving_portal_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-teal-400 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="truncate max-w-[160px] block">
                                {funder.giving_portal_url}
                              </span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          </td>
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              onClick={() => toggleDeselect(funder.id)}
                              className="text-navy-300 hover:text-red-400"
                              aria-label={excluded ? `Re-include ${funder.name}` : `Exclude ${funder.name}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {deselected.size > 0 && (
                  <p className="px-4 py-2 text-xs text-navy-400">
                    {deselected.size} funder{deselected.size === 1 ? "" : "s"} excluded from this run.
                    Click <X className="inline h-3 w-3" /> again to re-include.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
