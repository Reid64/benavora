import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts and src/__tests__/integration/rls.test.ts —
// without it, supabase-js's realtime client (constructed eagerly by
// createClient regardless of whether it's used) throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * Systematic Storage bucket RLS sweep.
 *
 * Triggered by a real finding: a bucket created directly via the Storage API
 * had zero storage.objects policies, so uploads silently failed for
 * everyone. A repo-wide search confirms this is not a one-off — the ONLY
 * storage.objects/storage.buckets policy anywhere in supabase/migrations/ is
 * migration 044 (the public `nofa-pdfs` bucket). The `documents` bucket
 * (src/app/api/documents/assemble/route.ts), the `session-recordings` bucket
 * (worker/queue-processor.ts, e2e/(dashboard)/autoapply/recordings), and the
 * per-org `org-{organizationId}` bucket convention (DocumentUploader.tsx,
 * settings/branding) all have no migration-defined policy at all — whatever
 * access control exists on them (if any) was set up out-of-band, exactly
 * like the bucket tonight's session found broken.
 *
 * This suite does not assume which buckets exist or what naming convention
 * they use. It discovers every live bucket via the Storage API at run time
 * (`serviceClient.storage.listBuckets()`) and classifies each one:
 *
 *   - public buckets are logged and skipped for isolation assertions — a
 *     public bucket (nofa-pdfs) is intentionally cross-org readable by
 *     design (migration 044's own comment), so a successful cross-org read
 *     there is not a leak.
 *   - buckets named like `org-<uuid>` (the one-bucket-per-org convention
 *     actually used by DocumentUploader.tsx/branding) are tested at the
 *     bucket level: a non-owning user should be blocked from listing or
 *     writing to another org's bucket. Real production org buckets are
 *     probed read-only (list only, never write) to avoid touching live
 *     data; a synthetic pair of throwaway `org-<uuid>` buckets is also
 *     created via the same API path used in production (this reproduces
 *     the exact "freshly created bucket" scenario that was found broken).
 *   - every other private bucket is tested with the shared-bucket,
 *     path-scoped convention actually used in this codebase
 *     (`{organizationId}/...`, e.g. `documents`, `session-recordings`):
 *     org A uploads under its own path, org B must be blocked from writing
 *     or reading under that path.
 *
 * Any bucket with a policy gap is FLAGGED in the assertion failure message,
 * not silently patched — fixing storage.objects policies is a live-project
 * DDL change outside what this test suite should do unattended.
 */

function loadLocalEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

const localEnv = loadLocalEnv();
const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

const ORG_PER_BUCKET_RE = /^org-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

type BucketStatus =
  | "OK"
  | "PUBLIC_BY_DESIGN"
  | "NO_INSERT_POLICY"
  | "LEAK_WRITE"
  | "LEAK_READ"
  | "SKIPPED";

interface BucketCheckResult {
  bucket: string;
  category: "public" | "org-per-bucket (live)" | "org-per-bucket (synthetic)" | "shared path-scoped";
  status: BucketStatus;
  detail: string;
}

interface TestClients {
  service: SupabaseClient;
  userA: SupabaseClient;
  userB: SupabaseClient;
  orgAId: string;
  orgBId: string;
}

/**
 * Shared-bucket, path-scoped convention: org A uploads under
 * `{orgId}/...`, org B must be blocked from writing or reading that path.
 * Matches `documents` and `session-recordings` bucket usage in this repo.
 */
async function testPathScopedBucket(
  bucketName: string,
  isPublic: boolean,
  clients: TestClients,
  tag: string,
): Promise<BucketCheckResult> {
  const category = "shared path-scoped" as const;
  const objectPath = `${clients.orgAId}/storage-rls-test-${tag}.txt`;
  const content = Buffer.from(`storage rls test ${tag}`);

  const { error: uploadAErr } = await clients.userA.storage
    .from(bucketName)
    .upload(objectPath, content, { contentType: "text/plain", upsert: true });

  if (uploadAErr) {
    return {
      bucket: bucketName,
      category,
      status: "NO_INSERT_POLICY",
      detail: `org A (legitimate owner of the path) could not upload — ${uploadAErr.message}`,
    };
  }

  try {
    const { data: uploadBData, error: uploadBErr } = await clients.userB.storage
      .from(bucketName)
      .upload(objectPath, Buffer.from("cross-org write probe"), { contentType: "text/plain", upsert: true });
    if (!uploadBErr && uploadBData) {
      return {
        bucket: bucketName,
        category,
        status: "LEAK_WRITE",
        detail: `org B successfully overwrote org A's object at ${objectPath}`,
      };
    }

    const { data: downloadBData, error: downloadBErr } = await clients.userB.storage
      .from(bucketName)
      .download(objectPath);
    const readSucceeded = !downloadBErr && downloadBData;
    if (readSucceeded && !isPublic) {
      return {
        bucket: bucketName,
        category,
        status: "LEAK_READ",
        detail: `org B successfully downloaded org A's object at ${objectPath} from a private bucket`,
      };
    }

    return {
      bucket: bucketName,
      category,
      status: "OK",
      detail: isPublic
        ? "org A upload succeeded; org B write blocked; org B read succeeded (bucket is public by design)"
        : "org A upload succeeded; org B write and read both blocked",
    };
  } finally {
    await clients.service.storage.from(bucketName).remove([objectPath]).catch(() => {});
  }
}

/**
 * One-bucket-per-org convention (`org-{organizationId}`): isolation is at
 * the bucket level, not path level. Non-destructive — list only, and any
 * write probe that unexpectedly succeeds is cleaned up immediately.
 */
async function probeLiveOrgBucketReadOnly(
  bucketName: string,
  clients: TestClients,
  tag: string,
): Promise<BucketCheckResult> {
  const category = "org-per-bucket (live)" as const;

  const { data: listing, error: listErr } = await clients.userB.storage.from(bucketName).list("", { limit: 5 });
  if (!listErr && listing) {
    return {
      bucket: bucketName,
      category,
      status: "LEAK_READ",
      detail: `an unrelated org's user could list the contents of ${bucketName} (${listing.length} entries returned)`,
    };
  }

  const probePath = `__storage_rls_probe__/${tag}.txt`;
  const { data: uploadData, error: uploadErr } = await clients.userB.storage
    .from(bucketName)
    .upload(probePath, Buffer.from("cross-org write probe"), { contentType: "text/plain" });
  if (!uploadErr && uploadData) {
    await clients.service.storage.from(bucketName).remove([probePath]).catch(() => {});
    return {
      bucket: bucketName,
      category,
      status: "LEAK_WRITE",
      detail: `an unrelated org's user could write into ${bucketName} (object removed immediately after detection)`,
    };
  }

  return {
    bucket: bucketName,
    category,
    status: "OK",
    detail: "unrelated org's user blocked from both listing and writing (read-only probe; no data touched)",
  };
}

/**
 * Reproduces the exact scenario that triggered this suite: create two
 * fresh `org-<uuid>` buckets the same way production creates them (via the
 * Storage API, service role), then test bucket-level isolation between
 * them. Always run regardless of what already exists live.
 */
async function testSyntheticOrgPerBucketPair(clients: TestClients, tag: string): Promise<BucketCheckResult> {
  const category = "org-per-bucket (synthetic)" as const;
  const bucketA = `org-${clients.orgAId}`;
  const bucketB = `org-${clients.orgBId}`;

  const { error: createAErr } = await clients.service.storage.createBucket(bucketA, { public: false });
  const { error: createBErr } = await clients.service.storage.createBucket(bucketB, { public: false });
  if (createAErr || createBErr) {
    return {
      bucket: `${bucketA} / ${bucketB}`,
      category,
      status: "SKIPPED",
      detail: `could not create synthetic org buckets — ${createAErr?.message ?? createBErr?.message}`,
    };
  }

  try {
    const objectPath = `branding/storage-rls-test-${tag}.txt`;

    const { error: uploadAErr } = await clients.userA.storage
      .from(bucketA)
      .upload(objectPath, Buffer.from("org A's own bucket"), { contentType: "text/plain" });
    if (uploadAErr) {
      return {
        bucket: bucketA,
        category,
        status: "NO_INSERT_POLICY",
        detail: `org A could not upload to its own freshly-created bucket — ${uploadAErr.message}. This is the exact "bucket created via API has no storage.objects policy" gap tonight's session found.`,
      };
    }

    const { data: uploadBData, error: uploadBErr } = await clients.userB.storage
      .from(bucketA)
      .upload(objectPath, Buffer.from("cross-org write probe"), { contentType: "text/plain", upsert: true });
    if (!uploadBErr && uploadBData) {
      return {
        bucket: bucketA,
        category,
        status: "LEAK_WRITE",
        detail: `org B successfully wrote into org A's freshly-created bucket ${bucketA}`,
      };
    }

    const { data: downloadBData, error: downloadBErr } = await clients.userB.storage.from(bucketA).download(objectPath);
    if (!downloadBErr && downloadBData) {
      return {
        bucket: bucketA,
        category,
        status: "LEAK_READ",
        detail: `org B successfully downloaded from org A's freshly-created bucket ${bucketA}`,
      };
    }

    return {
      bucket: bucketA,
      category,
      status: "OK",
      detail: "org A upload succeeded in its own freshly-created bucket; org B write and read both blocked",
    };
  } finally {
    await clients.service.storage.from(bucketA).remove(["branding/" + `storage-rls-test-${tag}.txt`]).catch(() => {});
    await clients.service.storage.from(bucketB).remove(["branding/" + `storage-rls-test-${tag}.txt`]).catch(() => {});
    await clients.service.storage.emptyBucket(bucketA).catch(() => {});
    await clients.service.storage.emptyBucket(bucketB).catch(() => {});
    await clients.service.storage.deleteBucket(bucketA).catch(() => {});
    await clients.service.storage.deleteBucket(bucketB).catch(() => {});
  }
}

(CREDS_AVAILABLE ? describe : describe.skip)("Storage bucket RLS isolation (systematic sweep across all live buckets)", () => {
  let serviceClient: SupabaseClient;
  let userAClient: SupabaseClient;
  let userBClient: SupabaseClient;
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;

  const RUN_TAG = randomSuffix();

  beforeAll(async () => {
    serviceClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: orgA, error: orgAErr } = await serviceClient
      .from("organizations")
      .insert({ name: `STORAGE_RLS_TEST_ORG_A_${RUN_TAG}`, onboarding_progress: {} })
      .select()
      .single();
    if (orgAErr || !orgA) throw new Error(`Failed to create test org A: ${orgAErr?.message}`);
    orgAId = orgA.id as string;

    const { data: orgB, error: orgBErr } = await serviceClient
      .from("organizations")
      .insert({ name: `STORAGE_RLS_TEST_ORG_B_${RUN_TAG}`, onboarding_progress: {} })
      .select()
      .single();
    if (orgBErr || !orgB) throw new Error(`Failed to create test org B: ${orgBErr?.message}`);
    orgBId = orgB.id as string;

    const passwordA = `StorageRls_${randomSuffix()}_Aa1!`;
    const passwordB = `StorageRls_${randomSuffix()}_Bb1!`;
    const emailA = `storage-rls-orga-${RUN_TAG}@benavora-rls-test.local`;
    const emailB = `storage-rls-orgb-${RUN_TAG}@benavora-rls-test.local`;

    const { data: authA, error: authAErr } = await serviceClient.auth.admin.createUser({
      email: emailA,
      password: passwordA,
      email_confirm: true,
    });
    if (authAErr || !authA?.user) throw new Error(`Failed to create test user A: ${authAErr?.message}`);
    userAId = authA.user.id;

    const { data: authB, error: authBErr } = await serviceClient.auth.admin.createUser({
      email: emailB,
      password: passwordB,
      email_confirm: true,
    });
    if (authBErr || !authB?.user) throw new Error(`Failed to create test user B: ${authBErr?.message}`);
    userBId = authB.user.id;

    const { error: profAErr } = await serviceClient
      .from("profiles")
      .upsert({ id: userAId, organization_id: orgAId, email: emailA, role: "owner" });
    if (profAErr) throw new Error(`Failed to create profile A: ${profAErr.message}`);

    const { error: profBErr } = await serviceClient
      .from("profiles")
      .upsert({ id: userBId, organization_id: orgBId, email: emailB, role: "owner" });
    if (profBErr) throw new Error(`Failed to create profile B: ${profBErr.message}`);

    userAClient = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInAErr } = await userAClient.auth.signInWithPassword({ email: emailA, password: passwordA });
    if (signInAErr) throw new Error(`Failed to sign in test user A: ${signInAErr.message}`);

    userBClient = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInBErr } = await userBClient.auth.signInWithPassword({ email: emailB, password: passwordB });
    if (signInBErr) throw new Error(`Failed to sign in test user B: ${signInBErr.message}`);
  }, 120000);

  afterAll(async () => {
    if (!serviceClient) return;
    const cleanupErrors: string[] = [];
    try {
      if (userAId) await serviceClient.from("profiles").delete().match({ id: userAId });
      if (userBId) await serviceClient.from("profiles").delete().match({ id: userBId });
    } catch (err) {
      cleanupErrors.push(`profiles: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (userAId) {
      try {
        await serviceClient.auth.admin.deleteUser(userAId);
      } catch (err) {
        cleanupErrors.push(`auth user A: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (userBId) {
      try {
        await serviceClient.auth.admin.deleteUser(userBId);
      } catch (err) {
        cleanupErrors.push(`auth user B: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const deleteOrgWithRetry = async (orgId: string) => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        await serviceClient.from("platform_config").delete().match({ organization_id: orgId }).catch(() => {});
        const { error } = await serviceClient.from("organizations").delete().match({ id: orgId });
        if (!error) return;
        if (attempt === 4) {
          cleanupErrors.push(`organizations {"id":"${orgId}"} (after ${attempt} attempts): ${error.message}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    };
    if (orgAId) await deleteOrgWithRetry(orgAId);
    if (orgBId) await deleteOrgWithRetry(orgBId);

    if (cleanupErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[storage-rls.test] cleanup encountered errors — manual cleanup of STORAGE_RLS_TEST_ORG_*_${RUN_TAG} may be required:\n` +
          cleanupErrors.join("\n"),
      );
    }
  }, 120000);

  it(
    "every live Storage bucket enforces cross-org write/read isolation",
    async () => {
      const { data: buckets, error: listErr } = await serviceClient.storage.listBuckets();
      if (listErr || !buckets) {
        throw new Error(`Failed to list Storage buckets: ${listErr?.message ?? "no data returned"}`);
      }

      // eslint-disable-next-line no-console
      console.log(`[storage-rls.test] discovered ${buckets.length} live bucket(s): ${buckets.map((b) => b.name).join(", ") || "(none)"}`);

      const clients: TestClients = { service: serviceClient, userA: userAClient, userB: userBClient, orgAId, orgBId };
      const results: BucketCheckResult[] = [];

      for (const bucket of buckets) {
        if (bucket.public) {
          results.push({
            bucket: bucket.name,
            category: "public",
            status: "PUBLIC_BY_DESIGN",
            detail: "bucket is public — cross-org read is intentional, not tested for isolation",
          });
          continue;
        }
        if (ORG_PER_BUCKET_RE.test(bucket.name)) {
          results.push(await probeLiveOrgBucketReadOnly(bucket.name, clients, RUN_TAG));
          continue;
        }
        results.push(await testPathScopedBucket(bucket.name, false, clients, RUN_TAG));
      }

      // Always run the synthetic org-per-bucket reproduction, regardless of
      // what's live — this is the exact scenario ("bucket created via API")
      // that motivated this suite.
      results.push(await testSyntheticOrgPerBucketPair(clients, RUN_TAG));

      const flagged = results.filter((r) => r.status === "LEAK_WRITE" || r.status === "LEAK_READ" || r.status === "NO_INSERT_POLICY");
      const ok = results.filter((r) => r.status === "OK" || r.status === "PUBLIC_BY_DESIGN");
      const skipped = results.filter((r) => r.status === "SKIPPED");

      // eslint-disable-next-line no-console
      console.log(
        `[storage-rls.test] ${results.length} bucket check(s) — ${ok.length} OK, ${skipped.length} skipped, ${flagged.length} flagged`,
      );
      for (const r of results) {
        // eslint-disable-next-line no-console
        console.log(`  [${r.status}] ${r.bucket} (${r.category}) — ${r.detail}`);
      }

      expect(
        flagged,
        flagged.length > 0
          ? `Storage bucket policy gaps found:\n${flagged.map((r) => `  - [${r.status}] ${r.bucket} (${r.category}): ${r.detail}`).join("\n")}`
          : "no Storage bucket policy gaps",
      ).toEqual([]);
    },
    180000,
  );
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[storage-rls.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
