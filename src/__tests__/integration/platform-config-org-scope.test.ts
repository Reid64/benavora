import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import { loadBrandingSettings } from "@/lib/utils/branding";

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
 * Regression test for FEATURE_REGISTRY_v2.md #116: several read call sites
 * (loadBrandingSettings among them) queried `platform_config` by `key` alone
 * with no `organization_id` filter, so a lookup for one org could silently
 * return another org's row. This seeds two real orgs with colliding
 * `platform_config` keys and confirms a query scoped to Org A never returns
 * Org B's row — both directly (raw query) and through the real, now-fixed
 * `loadBrandingSettings` helper.
 *
 * Runs against the real project in `.env.local` (no separate test project
 * exists — see the other suites in this directory for the same pattern).
 * Every row/org created here is deleted in `afterAll`.
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

(CREDS_AVAILABLE ? describe : describe.skip)("platform_config organization scoping", () => {
  let service: SupabaseClient;
  let orgAId: string;
  let orgBId: string;
  const COLLIDING_KEY = "ai.model";

  beforeAll(async () => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tag = randomSuffix();

    const { data: orgA, error: orgAError } = await service
      .from("organizations")
      .insert({ name: `ORG_A_PLATFORM_CONFIG_${tag}`, onboarding_progress: {} })
      .select("id")
      .single();
    expect(orgAError, orgAError?.message).toBeNull();
    orgAId = orgA!.id as string;

    const { data: orgB, error: orgBError } = await service
      .from("organizations")
      .insert({ name: `ORG_B_PLATFORM_CONFIG_${tag}`, onboarding_progress: {} })
      .select("id")
      .single();
    expect(orgBError, orgBError?.message).toBeNull();
    orgBId = orgB!.id as string;

    // Same key, different values, in two different orgs — this collision is
    // exactly what a missing organization_id filter would leak across.
    // upsert (not insert): a live worker (per project memory) can seed
    // default platform_config rows — including "ai.model" — for a freshly
    // created org, sometimes within moments of creation, racing a plain
    // insert into a unique-constraint violation.
    const { error: rowAError } = await service.from("platform_config").upsert(
      [
        { organization_id: orgAId, key: COLLIDING_KEY, value: "org-a-model" },
        { organization_id: orgAId, key: "branding.primary_color", value: "#AAAAAA" },
      ],
      { onConflict: "organization_id,key" },
    );
    expect(rowAError, rowAError?.message).toBeNull();

    const { error: rowBError } = await service.from("platform_config").upsert(
      [
        { organization_id: orgBId, key: COLLIDING_KEY, value: "org-b-model" },
        { organization_id: orgBId, key: "branding.primary_color", value: "#BBBBBB" },
      ],
      { onConflict: "organization_id,key" },
    );
    expect(rowBError, rowBError?.message).toBeNull();
  });

  afterAll(async () => {
    try {
      await service.from("platform_config").delete().eq("organization_id", orgAId);
    } catch {
      // best-effort cleanup
    }
    try {
      await service.from("platform_config").delete().eq("organization_id", orgBId);
    } catch {
      // best-effort cleanup
    }
    try {
      await service.from("organizations").delete().in("id", [orgAId, orgBId]);
    } catch {
      // best-effort cleanup
    }
  });

  it("a raw .eq(organization_id) + .maybeSingle() lookup for Org A returns only Org A's row", async () => {
    const { data, error } = await service
      .from("platform_config")
      .select("value")
      .eq("organization_id", orgAId)
      .eq("key", COLLIDING_KEY)
      .maybeSingle();
    expect(error, error?.message).toBeNull();
    expect(data?.value).toBe("org-a-model");
    expect(data?.value).not.toBe("org-b-model");
  });

  it("a raw .eq(organization_id) + .in(key) lookup for Org B returns only Org B's row", async () => {
    // Only .in() on COLLIDING_KEY — a live worker (see beforeAll comment) can
    // seed other default keys like "ai.max_tokens" for a real org, which
    // would be an unrelated, correctly-scoped row, not a leak.
    const { data, error } = await service
      .from("platform_config")
      .select("key, value")
      .eq("organization_id", orgBId)
      .in("key", [COLLIDING_KEY]);
    expect(error, error?.message).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].value).toBe("org-b-model");
  });

  it("loadBrandingSettings (the real, fixed call site) never mixes Org A's and Org B's branding", async () => {
    const brandingA = await loadBrandingSettings(service, orgAId);
    const brandingB = await loadBrandingSettings(service, orgBId);

    expect(brandingA.primary_color).toBe("#AAAAAA");
    expect(brandingB.primary_color).toBe("#BBBBBB");
    expect(brandingA.primary_color).not.toBe(brandingB.primary_color);
  });
});
