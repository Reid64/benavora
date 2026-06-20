"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface WorkerRow {
  id: string;
  worker_id: string;
  status: string;
  last_heartbeat_at: string;
  current_item_id: string | null;
  items_processed: number;
  items_failed: number;
}

type HeartbeatState = "online" | "stale" | "offline";

function getHeartbeatState(row: WorkerRow): HeartbeatState {
  if (row.status === "offline") return "offline";
  const ageMs = Date.now() - new Date(row.last_heartbeat_at).getTime();
  const ageMin = ageMs / 60_000;
  if (ageMin > 5) return "offline";
  if (ageMin > 2) return "stale";
  return "online";
}

function formatAge(isoString: string): string {
  const ageMs = Date.now() - new Date(isoString).getTime();
  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec < 60) return `${ageSec}s ago`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m ago`;
  return `${Math.floor(ageMin / 60)}h ago`;
}

export function WorkerStatus() {
  const [worker, setWorker] = useState<WorkerRow | null>(null);
  const [currentFunderName, setCurrentFunderName] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const supabase = createClient();

    async function fetchWorker() {
      const { data } = await supabase
        .from("worker_status")
        .select("id, worker_id, status, last_heartbeat_at, current_item_id, items_processed, items_failed")
        .order("last_heartbeat_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setWorker(data as WorkerRow);
    }

    void fetchWorker();

    const channel = supabase
      .channel("worker-status-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "worker_status" },
        (payload) => {
          if (payload.new && typeof payload.new === "object") {
            setWorker(payload.new as WorkerRow);
          }
        },
      )
      .subscribe();

    const ticker = setInterval(() => setTick((n) => n + 1), 15_000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(ticker);
    };
  }, []);

  useEffect(() => {
    if (!worker?.current_item_id) {
      setCurrentFunderName(null);
      return;
    }
    const supabase = createClient();
    void supabase
      .from("submission_queue")
      .select("funders(name)")
      .eq("id", worker.current_item_id)
      .maybeSingle()
      .then(({ data }) => {
        const funders = (data as { funders?: { name?: string } | null } | null)?.funders;
        setCurrentFunderName(funders?.name ?? null);
      });
  }, [worker?.current_item_id]);

  if (!worker) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-navy-100 bg-white px-3 py-2 text-xs text-navy-400 shadow-sm">
        <span className="h-2 w-2 rounded-full bg-navy-200" />
        No worker data
      </div>
    );
  }

  const state = getHeartbeatState(worker);

  const dotClass =
    state === "online"
      ? "bg-green-500"
      : state === "stale"
        ? "bg-yellow-400"
        : "bg-red-500";

  const labelClass =
    state === "online"
      ? "text-green-700"
      : state === "stale"
        ? "text-yellow-700"
        : "text-red-700";

  const label =
    state === "online"
      ? "Worker Online"
      : state === "stale"
        ? "Worker Stale"
        : "Worker Offline";

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-navy-100 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
        <span className={`font-medium ${labelClass}`}>{label}</span>
      </div>
      <div className="text-navy-400">
        Heartbeat: {formatAge(worker.last_heartbeat_at)}
      </div>
      <div className="text-navy-500">
        {worker.items_processed} processed &middot; {worker.items_failed} failed
      </div>
      {worker.current_item_id && (
        <div className="truncate text-navy-500">
          Processing: {currentFunderName ?? worker.current_item_id}
        </div>
      )}
    </div>
  );
}
