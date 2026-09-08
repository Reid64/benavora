"use client";

import { useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

// The 3 funder_category values that mean "corporate" (migration 010's enum),
// plus the one opportunity_source_type value research agents stamp on
// corporate-giving-page discoveries. An opportunity can match on either.
const CORPORATE_CATEGORIES: Enums<"funder_category">[] = [
  "corporate_donation",
  "corporate_sponsorship",
  "corporate_foundation",
];

const WEEKS_TO_SHOW = 53; // ~12 months, GitHub-contributions-style window
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Below this many real logged opportunities across the whole visible window,
// the grid is too sparse to read as an actual pattern. Rather than let a
// near-empty grid imply "nothing's happening," we say so directly.
const SPARSE_DATA_THRESHOLD = 20;

interface DayCell {
  date: Date;
  count: number;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dayKey(d: Date): string {
  return startOfDay(d).toISOString();
}

function bucketColor(count: number): string {
  if (count <= 0) return "#E9E4D8";
  if (count === 1) return "#B7D9C4";
  if (count <= 3) return "#6FAE87";
  if (count <= 6) return "#3D8760";
  return "#2C4E3B";
}

interface CorporateGivingHeatmapProps {
  organizationId: string | null | undefined;
}

/**
 * Real per-organization activity, not a platform-wide aggregate: queries
 * `opportunities` through the RLS-scoped browser client (same access model
 * as the rest of this page), so it only ever shows opportunities this org's
 * own account can already see - no cross-org exposure, no admin client.
 */
export function CorporateGivingHeatmap({ organizationId }: CorporateGivingHeatmapProps) {
  const [rows, setRows] = useState<{ discovered_at: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;

    (async () => {
      const supabase = createClient();
      const { data, error: qError } = await supabase
        .from("opportunities")
        .select("discovered_at")
        .or(`category.in.(${CORPORATE_CATEGORIES.join(",")}),source_type.eq.corporate_giving`)
        .order("discovered_at", { ascending: true });

      if (!active) return;
      if (qError) {
        setError("Could not load corporate giving activity.");
        return;
      }
      setRows(data ?? []);
    })();

    return () => {
      active = false;
    };
  }, [organizationId]);

  const { weeks, monthLabels, totalCount, earliest, latest, todayKey } = useMemo(() => {
    const today = startOfDay(new Date());
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - WEEKS_TO_SHOW * 7);
    // Align to the preceding Sunday so every column is a clean 7-day week.
    windowStart.setDate(windowStart.getDate() - windowStart.getDay());

    const countsByDay = new Map<string, number>();
    let earliestReal: string | null = null;
    let latestReal: string | null = null;

    for (const r of rows ?? []) {
      if (!earliestReal || r.discovered_at < earliestReal) earliestReal = r.discovered_at;
      if (!latestReal || r.discovered_at > latestReal) latestReal = r.discovered_at;
      const key = dayKey(new Date(r.discovered_at));
      countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
    }

    const days: DayCell[] = [];
    const cursor = new Date(windowStart);
    while (cursor <= today) {
      days.push({ date: new Date(cursor), count: countsByDay.get(dayKey(cursor)) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    const weeksArr: DayCell[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeksArr.push(days.slice(i, i + 7));
    }

    let lastMonth = -1;
    const labels = weeksArr.map((week) => {
      const firstDay = week[0]?.date;
      if (!firstDay) return "";
      const m = firstDay.getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        return MONTH_LABELS[m];
      }
      return "";
    });

    // Total real matched rows platform never enters here - only this org's,
    // via RLS - so this count is honest for whoever is looking at it.
    const total = rows?.length ?? 0;

    return { weeks: weeksArr, monthLabels: labels, totalCount: total, earliest: earliestReal, latest: latestReal, todayKey: dayKey(today) };
  }, [rows]);

  if (!organizationId) return null;

  return (
    <div
      style={{
        backgroundColor: "#A4712C",
        borderRadius: "14px",
        boxShadow: "0 4px 20px rgba(164,113,44,0.22)",
        padding: "3px",
        marginBottom: "24px",
      }}
    >
      <div style={{ backgroundColor: "#F8F5EE", borderRadius: "11px", padding: "20px 22px" }}>
        <div style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A" }}>Corporate Giving Activity</div>

        {error ? (
          <p style={{ fontSize: "12px", color: "#B91C1C", marginTop: "8px" }}>{error}</p>
        ) : rows === null ? (
          <p style={{ fontSize: "12px", color: "#94A3B8", marginTop: "8px" }}>Loading&hellip;</p>
        ) : (
          <>
            <p style={{ fontSize: "12px", color: "#64748B", marginTop: "4px", marginBottom: "16px" }}>
              {totalCount === 0
                ? "No corporate-category opportunities logged for your organization yet."
                : `${totalCount} corporate-category opportunit${totalCount === 1 ? "y" : "ies"} discovered for your organization, ${earliest ? `${formatDate(earliest)} – ${formatDate(latest as string)}` : ""}.`}
            </p>

            <div style={{ overflowX: "auto", paddingBottom: "4px" }}>
              <div style={{ display: "inline-flex", gap: "3px", marginBottom: "4px", marginLeft: "18px" }}>
                {monthLabels.map((label, i) => (
                  <div key={i} style={{ width: "12px", fontSize: "10px", color: "#94A3B8", flexShrink: 0 }}>
                    {label}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: "3px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginRight: "3px" }}>
                  {["", "Mon", "", "Wed", "", "Fri", ""].map((label, i) => (
                    <div key={i} style={{ width: "18px", height: "11px", fontSize: "9px", color: "#94A3B8", lineHeight: "11px" }}>
                      {label}
                    </div>
                  ))}
                </div>
                {weeks.map((week, wi) => (
                  <div key={wi} style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                    {week.map((day, di) => {
                      const isFuture = dayKey(day.date) > todayKey;
                      return (
                        <div
                          key={di}
                          title={
                            isFuture
                              ? undefined
                              : `${day.date.toDateString()}: ${day.count} corporate opportunit${day.count === 1 ? "y" : "ies"} discovered`
                          }
                          style={{
                            width: "11px",
                            height: "11px",
                            borderRadius: "2px",
                            backgroundColor: isFuture ? "transparent" : bucketColor(day.count),
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "10px", fontSize: "11px", color: "#94A3B8" }}>
              <span>Less</span>
              {[0, 1, 2, 4, 7].map((c) => (
                <div key={c} style={{ width: "11px", height: "11px", borderRadius: "2px", backgroundColor: bucketColor(c) }} />
              ))}
              <span>More</span>
            </div>

            {totalCount < SPARSE_DATA_THRESHOLD && (
              <div
                role="status"
                style={{
                  marginTop: "14px",
                  backgroundColor: "#FEF3C7",
                  border: "1px solid #FDE68A",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  color: "#92400E",
                  lineHeight: 1.5,
                }}
              >
                Coverage is just getting started. Research agents that discover corporate-category
                opportunities are actively running, but haven&rsquo;t yet accumulated months of history -
                this heatmap will fill in as real opportunities are found, not before.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
