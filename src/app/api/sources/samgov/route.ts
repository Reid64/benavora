import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { searchSamGovOpportunities } from "@/lib/sources/samgov-client";

// SAM.gov opportunity polling endpoint.
//
// GET /api/sources/samgov?orgId=<uuid>
//
// SYSTEM job: runs under the service-role admin client (Contracts §2 —
// service role is for system jobs, never user-facing routes), gated solely
// by the server-only CRON_SECRET, matching
// src/app/api/sources/grantsgov/route.ts. Every query is manually scoped to
// orgId — RLS does not protect service-role queries.
//
// Results are deduplicated by SAM.gov's noticeId, encoded into the stored
// opportunity's url as `https://sam.gov/opp/<noticeId>` (opportunities has no
// dedicated external_id column, same approach as grantsgov-sync.ts) and
// either inserted as new rows or used to update the matching existing row.

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function externalUrl(externalId: string): string {
  return `https://sam.gov/opp/${externalId}`;
}

function extractExternalId(url: string | null): string {
  if (!url) return "";
  const m = /\/opp\/([^/?]+)/.exec(url);
  return m && m[1] ? decodeURIComponent(m[1]) : "";
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized.", "unauthorized", 401);
  }

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");
  if (!orgId) {
    return jsonError("orgId is required.", "missing_org_id", 400);
  }

  const admin = createAdminClient();

  const hits = await searchSamGovOpportunities();

  const byExternalId = new Map<string, (typeof hits)[number]>();
  for (const hit of hits) {
    if (!byExternalId.has(hit.externalId)) {
      byExternalId.set(hit.externalId, hit);
    }
  }

  const { data: existingRows, error: existingError } = await admin
    .from("opportunities")
    .select("id, url")
    .eq("organization_id", orgId)
    .eq("source", "sam_gov");

  if (existingError) {
    return jsonError("Could not load existing opportunities.", "load_failed", 500);
  }

  const existingByExternalId = new Map<string, string>();
  for (const row of (existingRows ?? []) as { id: string; url: string | null }[]) {
    const externalId = extractExternalId(row.url);
    if (externalId) existingByExternalId.set(externalId, row.id);
  }

  let newCount = 0;
  let updatedCount = 0;

  for (const opp of byExternalId.values()) {
    const existingId = existingByExternalId.get(opp.externalId);

    const patch: Record<string, unknown> = {
      name: opp.name,
      description: opp.description,
      amount_max: opp.amount,
      deadline: opp.deadline,
      source: "sam_gov",
      source_type: "government_federal" as const,
      url: externalUrl(opp.externalId),
    };

    if (existingId) {
      const { error } = await admin
        .from("opportunities")
        .update(patch)
        .eq("id", existingId)
        .eq("organization_id", orgId);
      if (!error) updatedCount++;
    } else {
      const { error } = await admin.from("opportunities").insert({
        ...patch,
        organization_id: orgId,
        category: "government_grant" as const,
        status: "open" as const,
      });
      if (!error) newCount++;
    }
  }

  return NextResponse.json({
    newCount,
    updatedCount,
    fetched: hits.length,
  });
}
