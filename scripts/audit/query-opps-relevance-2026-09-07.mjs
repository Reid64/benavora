import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
});

const { data: orgs } = await supabase.from('organizations').select('id, name, mission_statement, target_population, service_area').ilike('name', '%faith%').limit(5);

for (const org of orgs ?? []) {
  console.log('\n=== ORG', org.id, org.name, '===');

  const { data: sps } = await supabase.from('search_profiles').select('id, is_active, keywords, categories').eq('organization_id', org.id);
  console.log('SEARCH_PROFILES:', JSON.stringify(sps));

  const { count: kbCount } = await supabase.from('knowledge_base').select('*', { count: 'exact', head: true }).eq('organization_id', org.id);
  console.log('KB_COUNT:', kbCount);

  const { data: allOpps } = await supabase.from('opportunities').select('id, name, source, source_type, eligibility_score, created_at').eq('organization_id', org.id).limit(1000);
  console.log('TOTAL_OPPS:', allOpps?.length);
  for (const o of allOpps ?? []) {
    console.log(`  [${o.source}] score=${o.eligibility_score} :: ${o.name}`);
  }
}
