import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: ws } });
const { data, error } = await admin.from("agent_runs").select("*").eq("id", "140d9534-37f1-43a7-80c7-b0ec48cb54aa").maybeSingle();
console.log(JSON.stringify(data, null, 2), error);
