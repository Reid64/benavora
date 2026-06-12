import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const raw = readFileSync(".env.local","utf8");
const env={}; for(const l of raw.split(/\r?\n/)){ if(!l||l.startsWith("#")||!l.includes("="))continue; const i=l.indexOf("="); env[l.slice(0,i).trim()]=l.slice(i+1).trim();}
const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
// check tables
for (const t of ["organizations","profiles","funders","opportunities","applications","deadlines"]){
  const { error } = await admin.from(t).select("id").limit(1);
  console.log("table", t, error? "ERR: "+error.message : "OK");
}
// check rpc
const { error: rpcErr } = await admin.rpc("register_organization");
console.log("rpc register_organization:", rpcErr? "ERR: "+rpcErr.message : "OK (ran as service role)");
