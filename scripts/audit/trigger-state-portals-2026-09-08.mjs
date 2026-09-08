import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import ws from "ws";

const FAITH_EMAIL = "info@faithfoundationsf.org";
const PROD_URL = "https://www.benavora.com";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function mintCookieHeader() {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: FAITH_EMAIL,
  });
  if (linkError || !linkData) throw new Error(`generateLink failed: ${linkError?.message}`);
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const location = verifyResp.headers.get("location") || "";
  const hash = location.split("#")[1];
  if (!hash) throw new Error(`No hash in redirect location: ${location}`);
  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) throw new Error("No tokens in redirect hash");
  const setCookies = [];
  const authForCookies = createServerClient(url, anonKey, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
    realtime: { transport: ws },
  });
  await authForCookies.auth.setSession({ access_token, refresh_token });
  if (setCookies.length === 0) throw new Error("setSession produced zero cookies");
  return setCookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function main() {
  const cookieHeader = await mintCookieHeader();
  console.log("Minted session for", FAITH_EMAIL, "at", new Date().toISOString());

  const res = await fetch(`${PROD_URL}/api/agents/state-portals`, {
    method: "POST",
    headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  console.log("HTTP status:", res.status);
  const text = await res.text();
  console.log("Response body:", text);
  console.log("Completed at", new Date().toISOString());
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
