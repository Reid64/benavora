import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import ws from 'ws';

dotenv.config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const client = createClient(url, anonKey, { realtime: { transport: ws } });
const { data, error, status, statusText } = await client
  .schema('knowledge')
  .from('sources')
  .select('*');

const lines = [
  '',
  '=== STEP 4: anon-key RLS-denial proof against knowledge.sources ===',
  `client: @supabase/supabase-js, anon key, .schema('knowledge').from('sources').select('*')`,
  `status: ${status} ${statusText}`,
  `data: ${JSON.stringify(data)}`,
  `error: ${JSON.stringify(error)}`,
  '',
];

fs.appendFileSync('test-evidence/knowledge/knw-001-verify.txt', lines.join('\n'));
console.log(lines.join('\n'));
