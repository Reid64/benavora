import fs from "node:fs";
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const res = await fetch(`${base}/rest/v1/agent_runs?id=eq.9e7ab1de-e039-45da-a1bd-da7e8541bd90&select=*`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
console.log(JSON.stringify(await res.json(), null, 2));
