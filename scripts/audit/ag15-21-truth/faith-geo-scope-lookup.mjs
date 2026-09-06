import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(path) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const profiles = await rest(
    "profiles?email=eq.info@faithfoundationsf.org&select=id,email,organization_id",
  );
  console.log("profile:", JSON.stringify(profiles.body));
  const orgId = profiles.body?.[0]?.organization_id;
  if (!orgId) {
    console.error("no org id found");
    return;
  }

  const org = await rest(`organizations?id=eq.${orgId}&select=id,name,state`);
  console.log("organization:", JSON.stringify(org.body));

  const sp = await rest(
    `search_profiles?organization_id=eq.${orgId}&select=id,name,is_active,categories,geographic_scope,geographic_scopes,excluded_categories,agent_settings,keywords,last_run_at`,
  );
  console.log("search_profiles:", JSON.stringify(sp.body, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
