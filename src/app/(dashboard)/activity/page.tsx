"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Bell, Bot, FileText, Search, type LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { LoadingSpinner } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";

// Organization activity feed (build task: "activity and audit system").
// Distinct from /admin/audit-log — visible to every org role, not just
// owner/admin, and shows product events (agent runs, drafts, discovered
// opportunities, alerts) rather than a compliance trail. Polls every 30s.

// Draft & Automation section treatment — PAGE_TREATMENT_PROTOCOL_V2.md /
// DESIGN_SYSTEM_V2_ASSIGNMENT.md. Frame: Rich Gold. 2026-08-18: confirmed
// via live getComputedStyle audit this page never received the v2 rollout.
const CANVAS = "#D8D3C8";
const CARD = "#F8F5EE";
const BORDER = "rgba(16,27,45,0.15)";
const TEXT_PRIMARY = "#101B2D";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const ACCENT = "#B88A2E";
const SHADOW = "0 4px 20px rgba(184,138,46,0.22)";

const POLL_MS = 30_000;

type ActivityType = "agent_run" | "draft" | "opportunity" | "alert";

type ActivityItem = {
  id: string;
  type: ActivityType;
  title: string;
  description: string | null;
  createdAt: string;
  href: string | null;
};

const TYPE_ICON: Record<ActivityType, LucideIcon> = {
  agent_run: Bot,
  draft: FileText,
  opportunity: Search,
  alert: Bell,
};

const TYPE_COLOR: Record<ActivityType, string> = {
  agent_run: "#0077B6",
  draft: "#6B48CC",
  opportunity: "#0EA5E9",
  alert: "#F59E0B",
};

const TYPE_BG: Record<ActivityType, string> = {
  agent_run: "#E0F2FE",
  draft: "#EDE9FE",
  opportunity: "#E0F2FE",
  alert: "#FEF3C7",
};

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | { items?: ActivityItem[]; error?: string }
        | null;
      if (!res.ok || !json) {
        setLoadError(json?.error ?? "Could not load activity.");
        return;
      }
      setLoadError(null);
      setItems(json.items ?? []);
    } catch {
      setLoadError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div style={{ backgroundColor: CANVAS, minHeight: "100vh" }} className="space-y-6 p-6">
      <PageHeader
        title="Activity"
        accent={ACCENT}
        description="What's happened in your organization recently — agents, drafts, discoveries, and alerts. Updates automatically every 30 seconds."
      />

      <div style={{ backgroundColor: ACCENT, borderRadius: 16, boxShadow: SHADOW, padding: 4 }}>
      <div
        style={{
          backgroundColor: CARD,
          borderRadius: 13,
          padding: 24,
        }}
      >
        {loading ? (
          <LoadingSpinner center label="Loading activity..." />
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertCircle className="h-8 w-8" style={{ color: "#EF4444" }} aria-hidden />
            <p style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>Could not load activity</p>
            <p style={{ color: TEXT_SECONDARY, fontSize: 14 }}>{loadError}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Bell className="h-8 w-8" style={{ color: TEXT_MUTED }} aria-hidden />
            <p style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>No activity yet</p>
            <p style={{ color: TEXT_SECONDARY, fontSize: 14 }}>
              Agent runs, drafts, discovered opportunities, and alerts will show up here as they
              happen.
            </p>
          </div>
        ) : (
          <ul>
            {items.map((item) => {
              const Icon = TYPE_ICON[item.type];
              const body = (
                <div className="flex items-start gap-3 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: TYPE_BG[item.type], color: TYPE_COLOR[item.type] }}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p style={{ color: TEXT_PRIMARY, fontWeight: 600, fontSize: 14 }} className="truncate">
                      {item.title}
                    </p>
                    {item.description && (
                      <p style={{ color: TEXT_SECONDARY, fontSize: 13 }} className="truncate">
                        {item.description}
                      </p>
                    )}
                  </div>
                  <span style={{ color: TEXT_MUTED, fontSize: 12 }} className="shrink-0 whitespace-nowrap">
                    {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                  </span>
                </div>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link href={item.href} className="block hover:opacity-80">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </div>
    </div>
  );
}
