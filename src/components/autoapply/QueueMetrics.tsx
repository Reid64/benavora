"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Gauge, ListOrdered } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

// Queue health metrics shown as stat cards above the queue table:
//   - Queue depth         = pending submission_queue items
//   - Processing rate      = autoapply_submissions completed per hour over last 24h
//   - Est. completion time = queue depth / processing rate
// Live-updates via Supabase Realtime on both tables, with a 60s safety refresh.

interface Metrics {
  pending: number;
  ratePerHour: number;
  etaHours: number | null;
}

function formatEta(hours: number | null): string {
  if (hours === null) return "—";
  if (hours <= 0) return "0m";
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 48) return `${Math.round(h / 24)}d`;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function QueueMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Counts are RLS-scoped to the org automatically.
    const [pendingRes, completedRes] = await Promise.all([
      supabase
        .from("submission_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("autoapply_submissions")
        .select("id", { count: "exact", head: true })
        .gte("submitted_at", cutoff),
    ]);

    const pending = pendingRes.count ?? 0;
    const completed24h = completedRes.count ?? 0;
    const ratePerHour = completed24h / 24;
    const etaHours = ratePerHour > 0 ? pending / ratePerHour : null;
    setMetrics({ pending, ratePerHour, etaHours });
  }, []);

  useEffect(() => {
    void load();

    const supabase = createClient();
    const channel = supabase
      .channel("queue-metrics-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submission_queue" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "autoapply_submissions" },
        () => void load(),
      )
      .subscribe();

    // Safety net: refresh every 60s even if Realtime isn't enabled on a table.
    const interval = setInterval(() => void load(), 60_000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [load]);

  const cards: {
    label: string;
    value: string;
    sub: string;
    valueClass: string;
    icon: typeof ListOrdered;
  }[] = [
    {
      label: "Queue Depth",
      value: metrics ? String(metrics.pending) : "—",
      sub: "pending items",
      valueClass: "text-navy-900",
      icon: ListOrdered,
    },
    {
      label: "Processing Rate",
      value: metrics ? `${metrics.ratePerHour.toFixed(1)}/hr` : "—",
      sub: "completed, last 24h",
      valueClass: "text-teal-600",
      icon: Gauge,
    },
    {
      label: "Est. Completion",
      value: metrics ? formatEta(metrics.etaHours) : "—",
      sub:
        metrics && metrics.etaHours === null
          ? "no recent activity"
          : "at current rate",
      valueClass: "text-blue-500",
      icon: Clock,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className="rounded-xl border border-border bg-surface px-5 py-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
                {c.label}
              </p>
              <Icon className="h-4 w-4 text-navy-300" aria-hidden />
            </div>
            <p className={`mt-1 text-3xl font-semibold ${c.valueClass}`}>
              {c.value}
            </p>
            <p className="mt-1 text-xs text-navy-400">{c.sub}</p>
          </div>
        );
      })}
    </div>
  );
}
