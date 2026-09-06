// One-off, read-then-run live smoke test for the state-portal.ts extension
// (profile-driven geographic_scope mode). Reads Faith Foundation's REAL
// search_profiles row, then invokes the real StatePortalResearchAgent against
// it exactly as the /api/cron/research sweep would, to observe real output.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Missing Supabase env vars");

const admin = createClient(url, serviceKey, { realtime: { transport: ws } });

const { data: orgs, error: profileErr } = await admin
  .from("organizations")
  .select("id, name")
  .ilike("name", "%faith foundation%");

if (profileErr || !orgs || orgs.length === 0) {
  console.error("Could not find Faith Foundation org:", profileErr);
  process.exit(1);
}
console.log("Orgs matching 'faith foundation':", orgs);

// Disambiguate the two identically-named orgs via the real login
// (info@faithfoundationsf.org) -> profiles.organization_id.
const { data: authUsers, error: authErr } = await admin.auth.admin.listUsers();
if (authErr) {
  console.error("listUsers error:", authErr);
  process.exit(1);
}
const authUser = authUsers.users.find(
  (u) => u.email === "info@faithfoundationsf.org",
);
console.log("Auth user:", authUser?.id, authUser?.email);

let targetOrgId = null;
if (authUser) {
  const { data: prof, error: profErr } = await admin
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profErr) console.error("profiles lookup error:", profErr);
  console.log("profiles row:", prof);
  targetOrgId = prof?.organization_id ?? null;
}

for (const org of orgs) {
  const { data: profiles, error: spErr } = await admin
    .from("search_profiles")
    .select(
      "id, name, is_active, categories, geographic_scope, geographic_scopes, agent_settings",
    )
    .eq("organization_id", org.id);
  console.log(
    `\n--- org ${org.id}${org.id === targetOrgId ? " (REAL login's org)" : ""} ---`,
  );
  if (spErr) console.error("search_profiles query error:", spErr);
  console.log(JSON.stringify(profiles, null, 2));
}
