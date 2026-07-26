// ============================================================================
// BENAVORA — seed foundation_directory into Donor Discovery
//
// NOTE on deviation from the original task spec: donor_discovery_prospects
// (migration 067) has NO name/city/state/ein/website/phone/asset_amount/
// giving_total/status/source/prospect_type columns — those don't exist on
// that table. Entity data lives on the shared donor_discovery_directory row
// (legal_name, hq_address, website, phone), linked back to foundation_directory
// via linked_foundation_id (migration 074). donor_discovery_prospects itself
// only holds organization_id/directory_id/request_id/score/pipeline_stage
// (default 'new') — see src/lib/donor-discovery/directory.ts, the module every
// writer is required to go through ("never raw inserts") so the dedup rules
// there are enforced in exactly one place.
//
// This script therefore, for every foundation_directory row:
//   1. upsertDirectoryRecord() — merge-upsert into donor_discovery_directory,
//      tagging the record with linked_foundation_id + linkage_confidence 1
//      (exact link, not the fuzzy trigram match) and enrichment.{ein,
//      asset_amount, giving_total, ntee_code}.
//   2. findOrCreateProspect() — idempotent per (organization_id, directory_id)
//      insert into donor_discovery_prospects, pipeline_stage 'new'.
// Both are upserts, so re-running is safe.
//
// A single donor_discovery_requests row ("Foundation Directory Seed") is
// created up front to satisfy prospects.request_id (NOT NULL FK) — Donor
// Discovery requests always originate a prospect batch, and this bulk seed
// is no exception.
//
//   pnpm seed:foundation-prospects
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import pLimit from "p-limit";

import { createAdminClient } from "../src/lib/supabase/admin";
import { findOrCreateProspect, upsertDirectoryRecord } from "../src/lib/donor-discovery/directory";

const ORGANIZATION_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const BATCH_SIZE = 1000;
const CONCURRENCY = 30;
const SOURCE_ADAPTER = "foundation_directory_seed";

interface FoundationRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  ein: string;
  website: string | null;
  phone: string | null;
  asset_amount: number | null;
  giving_total: number | null;
  ntee_code: string | null;
}

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

function hqAddress(city: string | null, state: string | null): string | null {
  if (city && state) return `${city}, ${state}`;
  return city ?? state ?? null;
}

async function main() {
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    fatal(error instanceof Error ? error.message : String(error));
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", ORGANIZATION_ID)
    .maybeSingle();

  if (orgError) fatal(`org lookup failed: ${orgError.message}`);
  if (!org) fatal(`organization ${ORGANIZATION_ID} not found`);

  ok("org", `seeding into ${(org as { name: string }).name} (${ORGANIZATION_ID})`);

  // Reuse an existing seed request if one is already on file (idempotent re-run).
  const { data: existingRequest, error: existingRequestError } = await supabase
    .from("donor_discovery_requests")
    .select("id")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("name", "Foundation Directory Seed")
    .maybeSingle();

  if (existingRequestError) fatal(`request lookup failed: ${existingRequestError.message}`);

  let requestId: string;
  if (existingRequest) {
    requestId = (existingRequest as { id: string }).id;
    ok("request", `reusing existing seed request ${requestId}`);
  } else {
    const { data: createdRequest, error: createRequestError } = await supabase
      .from("donor_discovery_requests")
      .insert({
        organization_id: ORGANIZATION_ID,
        name: "Foundation Directory Seed",
        taxonomy_ids: [],
        geography: {},
        status: "complete",
        counts: {},
      })
      .select("id")
      .single();

    if (createRequestError || !createdRequest) {
      fatal(`request creation failed: ${createRequestError?.message ?? "no row returned"}`);
    }
    requestId = (createdRequest as { id: string }).id;
    ok("request", `created seed request ${requestId}`);
  }

  const { count: totalFoundations, error: countError } = await supabase
    .from("foundation_directory")
    .select("id", { count: "estimated", head: true });

  if (countError) fatal(`foundation_directory count failed: ${countError.message}`);
  console.log(`\nSeeding ~${(totalFoundations ?? 0).toLocaleString()} foundations into donor_discovery ...\n`);

  const limit = pLimit(CONCURRENCY);

  let cursor: string | null = null;
  let totalRead = 0;
  let totalDirectoryLinked = 0;
  let totalProspectsCreated = 0;
  let totalProspectsExisting = 0;
  let totalFailed = 0;

  for (;;) {
    let pageQuery = supabase
      .from("foundation_directory")
      .select("id, name, city, state, ein, website, phone, asset_amount, giving_total, ntee_code")
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);

    if (cursor) pageQuery = pageQuery.gt("id", cursor);

    const { data: page, error: pageError } = await pageQuery;
    if (pageError) {
      fail("batch read", pageError);
      totalFailed += BATCH_SIZE;
      break;
    }

    const rows = (page ?? []) as FoundationRow[];
    if (rows.length === 0) break;

    const results = await Promise.all(
      rows.map((foundation) =>
        limit(async () => {
          try {
            const directoryRecord = await upsertDirectoryRecord({
              legal_name: foundation.name,
              website: foundation.website,
              hq_address: hqAddress(foundation.city, foundation.state),
              phone: foundation.phone,
              source_adapter: SOURCE_ADAPTER,
              enrichment: {
                ein: foundation.ein,
                asset_amount: foundation.asset_amount,
                giving_total: foundation.giving_total,
                ntee_code: foundation.ntee_code,
              },
            });

            // Foundation linkage is an exact match here (the directory row was
            // derived directly from this foundation_directory row), unlike the
            // fuzzy trigram match donor_discovery_match_foundations does elsewhere.
            await supabase
              .from("donor_discovery_directory")
              .update({ linked_foundation_id: foundation.id, linkage_confidence: 1 })
              .eq("id", directoryRecord.id)
              .is("linked_foundation_id", null);

            const prospect = await findOrCreateProspect(ORGANIZATION_ID, requestId, directoryRecord.id);
            return { ok: true as const, created: prospect.created };
          } catch (error) {
            return { ok: false as const, error };
          }
        }),
      ),
    );

    for (const result of results) {
      if (!result.ok) {
        fail("foundation seed", result.error);
        totalFailed++;
        continue;
      }
      totalDirectoryLinked++;
      if (result.created) {
        totalProspectsCreated++;
      } else {
        totalProspectsExisting++;
      }
    }

    totalRead += rows.length;
    cursor = rows[rows.length - 1]?.id ?? cursor;

    if (totalRead % BATCH_SIZE === 0 || rows.length < BATCH_SIZE) {
      ok(
        "progress",
        `${totalRead.toLocaleString()} read — ${totalProspectsCreated.toLocaleString()} new prospects, ` +
          `${totalProspectsExisting.toLocaleString()} already on file, ${totalFailed.toLocaleString()} failed`,
      );
    }

    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    `\nDone. ${totalRead.toLocaleString()} foundations read, ${totalDirectoryLinked.toLocaleString()} directory records ` +
      `linked, ${totalProspectsCreated.toLocaleString()} new prospects created, ${totalProspectsExisting.toLocaleString()} ` +
      `already on file, ${totalFailed.toLocaleString()} failed.`,
  );
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
