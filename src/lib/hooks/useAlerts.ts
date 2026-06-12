"use client";

import { useCallback, useEffect, useState } from "react";

import { EMPTY_COUNTS, type AlertCounts } from "@/lib/alerts/alerts-service";
import type { Tables } from "@/types/database";

export type Alert = Tables<"alerts">;

type UseAlertsResult = {
  alerts: Alert[];
  counts: AlertCounts;
  loading: boolean;
  error: string | null;
  /** Re-run generation and reload the active list + counts. */
  refresh: () => Promise<void>;
};

/**
 * Loads the organization's active alerts and badge counts from GET /api/alerts,
 * which regenerates them from live data on each call (idempotent). Used by the
 * Sidebar for the red nav badges and by the Alerts page for the action list.
 * organization scoping is enforced server-side from the session; nothing here
 * trusts client input.
 */
export function useAlerts(): UseAlertsResult {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [counts, setCounts] = useState<AlertCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) {
        setError("Could not load alerts.");
        return;
      }
      const data = (await res.json()) as { alerts: Alert[]; counts: AlertCounts };
      setAlerts(data.alerts ?? []);
      setCounts(data.counts ?? EMPTY_COUNTS);
      setError(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { alerts, counts, loading, error, refresh };
}
