const fs = require('fs');
const path = require('path');

// Read env
const envPath = path.join(__dirname, '.env.local');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL'];
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY'];
const DB_URL = env['DATABASE_URL'] || env['SUPABASE_DB_URL'] || env['DIRECT_URL'];

async function applyViaRpc() {
  // Try calling a hypothetical exec_sql RPC (some projects have this)
  const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  if (resp.ok) { console.log('[OK] Applied via RPC'); return true; }
  return false;
}

async function applyViaPg() {
  if (!DB_URL) { console.log('[SKIP] No DATABASE_URL in .env.local'); return false; }
  try {
    const { Client } = require('pg');
    const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query(sql);
    await client.end();
    console.log('[OK] Applied via pg direct connection');
    return true;
  } catch (e) {
    console.log('[FAIL] pg:', e.message);
    return false;
  }
}

async function verify() {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/alerts?select=id&limit=0', {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }
  });
  return resp.ok;
}

const sql = fs.readFileSync(path.join(__dirname, 'supabase', 'migrations', '026_fix_alerts_schema.sql'), 'utf8');

(async () => {
  // Check if already exists
  if (await verify()) { console.log('[ALREADY EXISTS] alerts table present — skipping'); process.exit(0); }

  // Try pg module first (most reliable for DDL)
  let ok = false;
  try { ok = await applyViaPg(); } catch(e) { console.log('[SKIP] pg not available'); }
  if (!ok) { ok = await applyViaRpc(); }

  if (ok && await verify()) {
    console.log('[VERIFIED] alerts table now exists');
  } else if (!ok) {
    console.log('[MANUAL REQUIRED] Could not apply automatically.');
    console.log('Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/vbjplpquqxxfbpazyalt/sql');
    console.log('Paste contents of: supabase\\migrations\\026_fix_alerts_schema.sql');
  }
})();
