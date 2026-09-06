import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } },
);
const orgId = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const { data, error } = await admin
  .from("profiles")
  .select("id, organization_id, role, full_name")
  .eq("organization_id", orgId);
console.log(JSON.stringify(data, null, 2), error);
if (data && data[0]) {
  const { data: u } = await admin.auth.admin.getUserById(data[0].id);
  console.log("email:", u?.user?.email);
}
