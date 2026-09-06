import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: ws } });
const { data } = await admin.from("search_profiles").select("id, last_run_at, results_count").eq("id", "f0b59ea6-5b52-4e1c-9ab8-7c5e1b6f2eba").maybeSingle();
console.log(JSON.stringify(data, null, 2));
