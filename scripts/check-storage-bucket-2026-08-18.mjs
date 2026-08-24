import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;
function loadEnv() {
  const raw = readFileSync(".env.local", "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}
const env = loadEnv();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: buckets, error: bucketsErr } = await admin.storage.listBuckets();
console.log("Buckets:", JSON.stringify(buckets?.map(b => ({name: b.name, public: b.public})), null, 2), bucketsErr);

const orgId = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const bucketName = `org-${orgId}`;
const { data: files, error: filesErr } = await admin.storage.from(bucketName).list("branding");
console.log(`Files in ${bucketName}/branding:`, JSON.stringify(files, null, 2), filesErr);
