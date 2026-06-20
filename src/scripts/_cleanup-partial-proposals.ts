// One-off cleanup: delete proposals (and their sections) that have NO section
// with a non-null embedding — i.e. the partial rows inserted before embeddings
// were generated. Mirrors the two DELETE statements requested.
import dotenv from 'dotenv';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

dotenv.config({ path: '.env.local' });

async function main(): Promise<void> {
  const url =
    process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    process.stderr.write('Missing Supabase env vars\n');
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key, {
    realtime: { transport: ws as unknown as never },
  });

  // proposal_ids that have at least one embedded section -> keep these
  const { data: embedded, error: embErr } = await supabase
    .from('intelligence_proposal_sections')
    .select('proposal_id')
    .not('embedding', 'is', null);
  if (embErr) {
    process.stderr.write(`Error reading embedded sections: ${embErr.message}\n`);
    process.exit(1);
  }
  const keep = Array.from(
    new Set((embedded ?? []).map((r) => r.proposal_id).filter(Boolean)),
  ) as string[];
  process.stdout.write(`Proposals to keep (have embeddings): ${keep.length}\n`);

  // all proposal ids
  const { data: allProps, error: allErr } = await supabase
    .from('intelligence_funded_proposals')
    .select('id');
  if (allErr) {
    process.stderr.write(`Error reading proposals: ${allErr.message}\n`);
    process.exit(1);
  }
  const toDelete = (allProps ?? [])
    .map((r) => r.id)
    .filter((id) => !keep.includes(id));
  process.stdout.write(`Proposals to delete (no embeddings): ${toDelete.length}\n`);

  if (toDelete.length === 0) {
    process.stdout.write('Nothing to delete.\n');
    return;
  }

  // delete sections first (FK), then proposals
  const { error: delSecErr } = await supabase
    .from('intelligence_proposal_sections')
    .delete()
    .in('proposal_id', toDelete);
  if (delSecErr) {
    process.stderr.write(`Error deleting sections: ${delSecErr.message}\n`);
    process.exit(1);
  }

  const { error: delPropErr } = await supabase
    .from('intelligence_funded_proposals')
    .delete()
    .in('id', toDelete);
  if (delPropErr) {
    process.stderr.write(`Error deleting proposals: ${delPropErr.message}\n`);
    process.exit(1);
  }

  process.stdout.write(`Deleted ${toDelete.length} partial proposal(s) and their sections.\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
