import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import ws from "ws";

const FAITH_EMAIL = "info@faithfoundationsf.org";
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws } });
const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: FAITH_EMAIL });
const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
const location = verifyResp.headers.get("location") || "";
const hash = location.split("#")[1];
const params = new URLSearchParams(hash);
const access_token = params.get("access_token");
const refresh_token = params.get("refresh_token");

const setCookies = [];
const authForCookies = createServerClient(url, anonKey, {
  cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  realtime: { transport: ws },
});
await authForCookies.auth.setSession({ access_token, refresh_token });
console.log(JSON.stringify(setCookies.map(c => ({ name: c.name, valueLen: c.value.length, options: c.options })), null, 2));
