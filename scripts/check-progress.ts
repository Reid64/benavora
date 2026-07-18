import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { realtime: { transport: ws as any } });
  const { count: enriched } = await db.from('nonprofits').select('*', { count: 'exact', head: true }).not('last_enriched_at', 'is', null);
  const { count: total } = await db.from('nonprofits').select('*', { count: 'exact', head: true });
  console.log('Enriched so far:', enriched);
  console.log('Total:', total);
  console.log('Remaining:', (total ?? 0) - (enriched ?? 0));
}
main();