import { describe, it, expect, beforeAll, afterEach } from "vitest";
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
 * organizations round-trip (TESTING_v2.md §2.1 original intent).
 *
 * Column names below were verified against a live PostgREST OpenAPI
 * introspection of the `organizations` table on 2026-07-30, not assumed from
 * SCHEMA_REGISTRY_v2.md — that document's own header admits its migration
 * count and table list are stale. Two things the doc's Section 2.1 wording
 * ("subscription_tier defaults to 'free'") got right; `onboarding_progress`
 * is NOT-NULL with no database default, so every insert here supplies it
 * explicitly (matching the pattern already used by rls.test.ts and
 * storage-rls.test.ts in this directory).
 *
 * Runs against the real project configured in `.env.local` (there is no
 * separate test Supabase project — `.env.test` points at a stack that isn't
 * running). Every row created here is deleted in `afterEach`.
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

(CREDS_AVAILABLE ? describe : describe.skip)("organizations round-trip", () => {
  let service: SupabaseClient;
  const createdOrgIds: string[] = [];

  beforeAll(() => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterEach(async () => {
    while (createdOrgIds.length > 0) {
      const id = createdOrgIds.pop()!;
      // A live worker (per project memory) can repopulate platform_config
      // for a freshly created org, sometimes after a short delay — clear it
      // first so the organizations delete itself doesn't get blocked by a
      // stray FK-less race, mirroring the retry pattern in rls.test.ts.
      try {
        await service.from("platform_config").delete().match({ organization_id: id });
      } catch {
        // best-effort cleanup only
      }
      const { error } = await service.from("organizations").delete().match({ id });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[organizations.test] cleanup failed for org ${id}: ${error.message}`);
      }
    }
  });

  it("creates an organization and persists all supplied fields", async () => {
    const tag = randomSuffix();
    const input = {
      name: `ORG_TEST_${tag}`,
      dba: `Faith Foundation DBA ${tag}`,
      ein: "84-1234567",
      tax_status: "508(c)(1)(a)",
      mission_statement: "Providing emergency and transitional housing in rural Texas.",
      vision_statement: "A community where no family sleeps without shelter.",
      service_area: "Rural Texas",
      target_population: "Families experiencing homelessness",
      annual_budget: 250000,
      website: "https://example.org",
      phone: "555-0100",
      email: `org-${tag}@example.org`,
      city: "Waco",
      state: "TX",
      zip: "76701",
      onboarding_progress: {},
    };

    const { data, error } = await service.from("organizations").insert(input).select().single();
    expect(error, error?.message).toBeNull();
    expect(data).not.toBeNull();
    createdOrgIds.push(data!.id as string);

    expect(data!.name).toBe(input.name);
    expect(data!.dba).toBe(input.dba);
    expect(data!.ein).toBe(input.ein);
    expect(data!.tax_status).toBe(input.tax_status);
    expect(data!.mission_statement).toBe(input.mission_statement);
    expect(data!.vision_statement).toBe(input.vision_statement);
    expect(data!.service_area).toBe(input.service_area);
    expect(data!.target_population).toBe(input.target_population);
    expect(Number(data!.annual_budget)).toBe(input.annual_budget);
    expect(data!.website).toBe(input.website);
    expect(data!.phone).toBe(input.phone);
    expect(data!.email).toBe(input.email);
    expect(data!.city).toBe(input.city);
    expect(data!.state).toBe(input.state);
    expect(data!.zip).toBe(input.zip);
    expect(typeof data!.id).toBe("string");
    expect(data!.created_at).toBeTruthy();
    expect(data!.updated_at).toBeTruthy();

    // Round-trip: reselect by id and confirm the persisted row matches.
    const { data: reselected, error: reselectError } = await service
      .from("organizations")
      .select("*")
      .eq("id", data!.id)
      .single();
    expect(reselectError, reselectError?.message).toBeNull();
    expect(reselected!.name).toBe(input.name);
    expect(reselected!.mission_statement).toBe(input.mission_statement);
  });

  it("defaults onboarding_completed to false, subscription_tier to 'free', and onboarding_step to 0", async () => {
    const tag = randomSuffix();
    const { data, error } = await service
      .from("organizations")
      .insert({ name: `ORG_TEST_DEFAULTS_${tag}`, onboarding_progress: {} })
      .select()
      .single();
    expect(error, error?.message).toBeNull();
    expect(data).not.toBeNull();
    createdOrgIds.push(data!.id as string);

    expect(data!.onboarding_completed).toBe(false);
    expect(data!.subscription_tier).toBe("free");
    expect(data!.onboarding_step).toBe(0);
    expect(data!.onboarding_completed_at).toBeNull();
  });

  it("does not silently coerce onboarding_completed=true — it must be set explicitly", async () => {
    const tag = randomSuffix();
    const { data, error } = await service
      .from("organizations")
      .insert({ name: `ORG_TEST_EXPLICIT_${tag}`, onboarding_completed: true, onboarding_progress: {} })
      .select()
      .single();
    expect(error, error?.message).toBeNull();
    expect(data).not.toBeNull();
    createdOrgIds.push(data!.id as string);

    expect(data!.onboarding_completed).toBe(true);
  });
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[organizations.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
