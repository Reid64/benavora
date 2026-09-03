import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function q(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  return res.json();
}
console.log('QUEUE_ROW:', await q(`submission_queue?id=eq.1efa5169-e21b-4767-8de5-68387eb10499&select=*`));
