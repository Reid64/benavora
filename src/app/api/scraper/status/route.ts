// GET /api/scraper/status — foundation directory scraper status for the
// dashboard AI Triggers panel status card (STANDING_DIRECTIVES.md Directive 1,
// scripts/run-foundation-scraper.ts, worker/scheduler.ts's
// "foundation-enrichment-weekly" job).
//
// "Total foundations enriched" and "current enrichment rate" are computed
// live against foundation_directory (website IS NOT NULL — the field this
// scraper's Strategy 1/2 waterfall exists to populate; see
// src/lib/scraper/foundation-scraper.ts), not read from
// enrichment-output/scraper-stats.json. That file is written to local disk by
// whichever process ran the scraper (a developer's machine or the Railway
// worker), which does not share a filesystem with this Vercel-hosted route —
// it would read as absent in production almost every time. "Last run
// timestamp" and "last run enrichment rate" are still read from that file on
// a best-effort basis (null when unavailable, never fabricated) since there
// is no DB table recording scraper run history.

import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATS_FILE = path.join(path.resolve("./enrichment-output"), "scraper-stats.json");
const TIMEZONE = "America/Chicago";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface ScraperStatsFile {
  lastRunAt?: string;
  processed?: number;
  enriched?: number;
  enrichmentRate?: number;
  nextOffset?: number;
}

function readStatsFile(): ScraperStatsFile | null {
  if (!fs.existsSync(STATS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, "utf-8")) as ScraperStatsFile;
  } catch {
    return null;
  }
}

/**
 * Next Sunday 3:00 AM America/Chicago at or after `now`, as an ISO string —
 * matches worker/scheduler.ts's "foundation-enrichment-weekly" job (hour 3,
 * minute 0, Sunday-only). Display-only approximation: on the exact calendar
 * date of a US DST transition the computed clock time can be off by an hour;
 * not worth the added complexity for an informational dashboard field, since
 * the actual firing logic lives in worker/scheduler.ts, not here.
 */
function nextSunday3AmChicago(now: Date): string {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(now);
  const todayIdx = WEEKDAYS.indexOf(weekday);

  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => timeParts.find((p) => p.type === type)?.value ?? "00";
  const curHour = parseInt(get("hour"), 10);
  const curMinute = parseInt(get("minute"), 10);

  let daysAhead = (7 - todayIdx) % 7;
  if (daysAhead === 0 && (curHour > 3 || (curHour === 3 && curMinute > 0))) {
    daysAhead = 7;
  }

  const targetInstant = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(targetInstant);
  const y = Number(dateParts.find((p) => p.type === "year")?.value);
  const m = Number(dateParts.find((p) => p.type === "month")?.value);
  const d = Number(dateParts.find((p) => p.type === "day")?.value);

  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(targetInstant);
  const offsetLabel = offsetParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const offsetHours = parseInt(/GMT([+-]\d+)/.exec(offsetLabel)?.[1] ?? "-6", 10);

  // 03:00 local == (03:00 - offsetHours) UTC on the same calendar date.
  const target = new Date(Date.UTC(y, m - 1, d, 3 - offsetHours, 0, 0));
  return target.toISOString();
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const admin = createAdminClient();

  const [{ count: totalFoundations }, { count: totalEnriched }] = await Promise.all([
    admin.from("foundation_directory").select("id", { count: "exact", head: true }),
    admin
      .from("foundation_directory")
      .select("id", { count: "exact", head: true })
      .not("website", "is", null),
  ]);

  const total = totalFoundations ?? 0;
  const enriched = totalEnriched ?? 0;
  const enrichmentRate = total > 0 ? enriched / total : 0;

  const stats = readStatsFile();
  const scraperEnabled = process.env["ENABLE_SCRAPER"] === "true";

  return NextResponse.json({
    lastRunAt: stats?.lastRunAt ?? null,
    lastRunProcessed: stats?.processed ?? null,
    lastRunEnriched: stats?.enriched ?? null,
    lastRunEnrichmentRate: stats?.enrichmentRate ?? null,
    totalFoundations: total,
    totalEnriched: enriched,
    enrichmentRate,
    scraperEnabled,
    nextScheduledRun: scraperEnabled ? nextSunday3AmChicago(new Date()) : null,
  });
}
