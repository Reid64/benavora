import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(url + '/rest/v1/', {
  headers: { apikey: key, Authorization: 'Bearer ' + key },
});
const spec = await res.json();
const tables = ['documents', 'programs', 'request_profiles', 'form_templates', 'funders', 'submission_queue', 'automation_sessions', 'organizations', 'submission_usage'];
for (const t of tables) {
  const def = spec.definitions ? spec.definitions[t] : null;
  if (!def) { console.log('--- ' + t + ': NOT FOUND ---'); continue; }
  console.log('--- ' + t + ' ---');
  console.log('required:', def.required || []);
  for (const col of Object.keys(def.properties || {})) {
    const meta = def.properties[col];
    console.log('  ' + col + ': ' + meta.type + (meta.format ? '/' + meta.format : '') + (meta.default !== undefined ? ' default=' + JSON.stringify(meta.default) : ''));
  }
}
