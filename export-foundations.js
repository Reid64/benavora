const ws = require("ws");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const env = {};
fs.readFileSync(".env.local", "utf8").split("\n").forEach(l => {
  const [k, ...v] = l.split("=");
  if (k && !k.startsWith("#")) env[k.trim()] = v.join("=").trim();
});
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: ws } });

(async () => {
  const batchSize = 1000;
  let offset = 0;
  let all = [];
  while (true) {
    const { data, error } = await sb.from("foundation_directory").select("*").range(offset, offset + batchSize - 1);
    if (error) { console.error(error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    offset += batchSize;
    process.stdout.write("\r" + all.length + " records fetched...");
  }
  console.log("\nTotal:", all.length);
  const headers = Object.keys(all[0]);
  const lines = [headers.join(",")];
  for (const r of all) {
    const row = headers.map(h => {
      const v = String(r[h] ?? "");
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    });
    lines.push(row.join(","));
  }
  fs.writeFileSync("exports/foundation-directory-full.csv", lines.join("\n"));
  console.log("Saved to exports/foundation-directory-full.csv");
  process.exit(0);
})();
