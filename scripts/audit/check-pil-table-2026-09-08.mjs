import fs from "node:fs";
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const res = await fetch(`${base}/rest/v1/pil_submission_queue?select=id&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
});
console.log("status:", res.status);
console.log(JSON.stringify(await res.json()));
