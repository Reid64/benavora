import { NextResponse } from "next/server";

import { register } from "@/lib/observability/metrics";

// Prometheus scrape endpoint. Scrapers authenticate with the same
// bearer-token convention as the cron routes (METRICS_SCRAPE_SECRET rather
// than CRON_SECRET, since this is a distinct trust boundary) — there is no
// user session to check requireRole against. No-cache per governance: this
// is a live metrics snapshot, never a cached artifact.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const scrapeSecret = process.env.METRICS_SCRAPE_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!scrapeSecret || authHeader !== `Bearer ${scrapeSecret}`) {
    return NextResponse.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
  }

  const body = await register.metrics();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": register.contentType,
      "Cache-Control": "no-store",
    },
  });
}
