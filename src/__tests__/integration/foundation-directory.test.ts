import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts and the other suites in this directory — without
// it, supabase-js's realtime client (constructed eagerly by createClient
// regardless of whether it's used) throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * foundation_directory EIN lookup + enrichment write behavior
 * (TESTING_v2.md §2.1 original intent).
 *
 * Columns below were verified against a live PostgREST OpenAPI introspection
 * of `foundation_directory` on 2026-07-30 — real column set is
 * `enrichment`/`officers`/`programs`/`contact_emails`/`contact_phones`/
 * `enriched_at`/`enriched_990_at`/`enriched_web_at`/`enrichment_source`/
 * `website_discovered_via`, not the `enrichment_version`/
 * `enrichment_completed_at` pair SCHEMA_REGISTRY_v2.md's §24 documents (that
 * doc's own header admits it is stale).
 *
 * The "enrichment jsonb merge behavior" this file was scoped to test was
 * checked against the two live writers of that column tonight —
 * src/lib/scraper/foundation-scraper.ts (`.update({ enrichment: {...} })`)
 * and scripts/enrich-foundations-990.ts (`.upsert(batch, { onConflict: "ein"
 * })` with a freshly-built `enrichment` object per row). Neither does a
 * database-level or application-level read-modify-write merge — both send a
 * complete replacement object, so a Postgres UPDATE/upsert overwrites the
 * whole jsonb column. The test below verifies that REAL (replace, not
 * merge) behavior rather than assuming the merge semantics TESTING_v2.md's
 * original bullet ("Upsert enrichment jsonb merges (does not overwrite)
 * existing fields") described for a different table's write path.
 *
 * Runs against the real project configured in `.env.local` (there is no
 * separate test Supabase project, matching the other suites in this
 * directory). foundation_directory is a large SHARED production table
 * (133,812+ real records, no organization_id) — every row created here uses
 * a synthetic EIN tagged with a random suffix and is deleted in `afterEach`.
 */

function loadLocalEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

const localEnv = loadLocalEnv();
const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY;
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function testEin(tag: string): string {
  // IRS EINs are not validated on this column (text, unique) — a
  // TESTFD-prefixed value keeps synthetic rows unambiguous in production.
  return `TESTFD${tag}`;
}

(CREDS_AVAILABLE ? describe : describe.skip)("foundation_directory EIN lookup and enrichment writes", () => {
  let service: SupabaseClient;
  const createdEins: string[] = [];

  beforeAll(() => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterEach(async () => {
    while (createdEins.length > 0) {
      const ein = createdEins.pop()!;
      const { error } = await service.from("foundation_directory").delete().match({ ein });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[foundation-directory.test] cleanup failed for ein ${ein}: ${error.message}`);
      }
    }
  });

  it("creates a foundation and looks it up by EIN", async () => {
    const tag = randomSuffix();
    const ein = testEin(tag);
    const input = {
      ein,
      name: `FOUNDATION_TEST_${tag}`,
      city: "Waco",
      state: "TX",
      ntee_code: "P20",
    };

    const { data, error } = await service.from("foundation_directory").insert(input).select().single();
    expect(error, error?.message).toBeNull();
    expect(data).not.toBeNull();
    createdEins.push(ein);

    const { data: lookedUp, error: lookupErr } = await service
      .from("foundation_directory")
      .select("*")
      .eq("ein", ein)
      .single();
    expect(lookupErr, lookupErr?.message).toBeNull();
    expect(lookedUp!.name).toBe(input.name);
    expect(lookedUp!.city).toBe(input.city);
    expect(lookedUp!.state).toBe(input.state);
    expect(lookedUp!.ntee_code).toBe(input.ntee_code);
  });

  it("defaults enrichment to {}, officers/contact_emails/contact_phones to [] on insert", async () => {
    const tag = randomSuffix();
    const ein = testEin(tag);
    const { data, error } = await service
      .from("foundation_directory")
      .insert({ ein, name: `FOUNDATION_TEST_DEFAULTS_${tag}` })
      .select()
      .single();
    expect(error, error?.message).toBeNull();
    createdEins.push(ein);

    expect(data!.enrichment).toEqual({});
    expect(data!.officers).toEqual([]);
    expect(data!.contact_emails).toEqual([]);
    expect(data!.contact_phones).toEqual([]);
    expect(data!.enriched_at).toBeNull();
    expect(data!.enriched_990_at).toBeNull();
    expect(data!.enriched_web_at).toBeNull();
  });

  it("enforces the live ein unique constraint (foundation_directory_ein_unique)", async () => {
    const tag = randomSuffix();
    const ein = testEin(tag);
    const { error: firstErr } = await service
      .from("foundation_directory")
      .insert({ ein, name: `FOUNDATION_TEST_DUP_1_${tag}` });
    expect(firstErr, firstErr?.message).toBeNull();
    createdEins.push(ein);

    const { data, error } = await service
      .from("foundation_directory")
      .insert({ ein, name: `FOUNDATION_TEST_DUP_2_${tag}` });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
    expect(error!.message).toContain("foundation_directory_ein_unique");
  });

  it("REPLACES the enrichment jsonb column on update — it does not deep-merge with the prior value", async () => {
    const tag = randomSuffix();
    const ein = testEin(tag);
    const { error: insertErr } = await service.from("foundation_directory").insert({
      ein,
      name: `FOUNDATION_TEST_MERGE_${tag}`,
      enrichment: { fiscal_year: 2024, grant_count: 12 },
    });
    expect(insertErr, insertErr?.message).toBeNull();
    createdEins.push(ein);

    // Mirrors src/lib/scraper/foundation-scraper.ts's contact-page write path
    // (update()'d with a freshly-built object, not a merge of the existing
    // enrichment value).
    const { data: updated, error: updateErr } = await service
      .from("foundation_directory")
      .update({ enrichment: { contact_emails: ["info@example.org"], contact_scraped_at: new Date().toISOString() } })
      .eq("ein", ein)
      .select()
      .single();
    expect(updateErr, updateErr?.message).toBeNull();

    // The real behavior: fiscal_year/grant_count from the original insert are
    // gone — the whole column was overwritten, not merged.
    expect(updated!.enrichment).not.toHaveProperty("fiscal_year");
    expect(updated!.enrichment).not.toHaveProperty("grant_count");
    expect(updated!.enrichment.contact_emails).toEqual(["info@example.org"]);
  });

  it("upsert on conflict(ein) also replaces (not merges) enrichment — matches scripts/enrich-foundations-990.ts", async () => {
    const tag = randomSuffix();
    const ein = testEin(tag);
    const { error: insertErr } = await service.from("foundation_directory").insert({
      ein,
      name: `FOUNDATION_TEST_UPSERT_${tag}`,
      enrichment: { source: "manual_seed" },
      asset_amount: 1000,
    });
    expect(insertErr, insertErr?.message).toBeNull();
    createdEins.push(ein);

    const { data: upserted, error: upsertErr } = await service
      .from("foundation_directory")
      .upsert(
        { ein, name: `FOUNDATION_TEST_UPSERT_${tag}`, enrichment: { fiscal_year: 2024 }, enriched_990_at: new Date().toISOString() },
        { onConflict: "ein" },
      )
      .select()
      .single();
    expect(upsertErr, upsertErr?.message).toBeNull();
    expect(upserted!.enrichment).toEqual({ fiscal_year: 2024 });
    expect(upserted!.enrichment).not.toHaveProperty("source");
    // Columns omitted from the upsert payload (asset_amount) are preserved —
    // only the columns actually present in the payload are overwritten.
    expect(Number(upserted!.asset_amount)).toBe(1000);
  });

  it("persists website + website_discovered_via written by the enrichment waterfall", async () => {
    const tag = randomSuffix();
    const ein = testEin(tag);
    const { error: insertErr } = await service
      .from("foundation_directory")
      .insert({ ein, name: `FOUNDATION_TEST_WEBSITE_${tag}` });
    expect(insertErr, insertErr?.message).toBeNull();
    createdEins.push(ein);

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateErr } = await service
      .from("foundation_directory")
      .update({
        website: "https://example-foundation.org",
        website_discovered_via: "irs_990_xml",
        enriched_web_at: nowIso,
      })
      .eq("ein", ein)
      .select()
      .single();
    expect(updateErr, updateErr?.message).toBeNull();
    expect(updated!.website).toBe("https://example-foundation.org");
    expect(updated!.website_discovered_via).toBe("irs_990_xml");
    expect(updated!.enriched_web_at).toBeTruthy();
  });
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[foundation-directory.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
