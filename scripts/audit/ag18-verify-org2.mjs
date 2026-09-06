import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } },
);
const orgId = "bed3e621-d93c-4e89-bfc4-a0fcea61b8fd";
const { data, error } = await admin
  .from("profiles")
  .select("id, organization_id, role, full_name")
  .eq("organization_id", orgId);
console.log(JSON.stringify(data, null, 2), error);
for (const row of data ?? []) {
  const { data: u } = await admin.auth.admin.getUserById(row.id);
  console.log(row.id, "email:", u?.user?.email);
}
