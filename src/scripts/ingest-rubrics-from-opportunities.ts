// Standalone ingestion script — extracts scoring rubrics from existing opportunities.
// Run: npx tsx src/scripts/ingest-rubrics-from-opportunities.ts [--limit N]
// NOT imported by the Next.js app — excluded via tsconfig (src/scripts/ingest-*.ts).

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { extractRubricFromOpportunity } from '../lib/intelligence/rubric-extractor';

dotenv.config({ path: '.env.local' });

type Json = Database['public']['Tables']['intelligence_scoring_rubrics']['Row']['dimensions'];

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// Minimal .env.local parser — tsx does not auto-load .env files.
// Must be called before any dynamic import that reads process.env at init.
// ---------------------------------------------------------------------------
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main(): Promise<void> {
  // Load env before any dynamic import that initialises clients from env vars.
  loadEnvLocal();

  // Parse --limit flag
  const argv = process.argv.slice(2);
  const limitIdx = argv.indexOf('--limit');
  const limitRaw = limitIdx !== -1 ? argv[limitIdx + 1] : undefined;
  const limitParsed = limitRaw !== undefined ? parseInt(limitRaw, 10) : NaN;
  const limit = !isNaN(limitParsed) ? limitParsed : Infinity;

  const supabaseUrl =
    process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const openaiKey = process.env['OPENAI_API_KEY'];

  if (!supabaseUrl || !supabaseKey) {
    process.stderr.write('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY\n');
    process.exit(1);
  }
  if (!openaiKey) {
    process.stderr.write('Missing OPENAI_API_KEY\n');
    process.exit(1);
  }

  // Dynamic import AFTER env is loaded — embeddings.ts initialises OpenAI client
  // with process.env.OPENAI_API_KEY at module load time.
  const { generateEmbedding } = await import('../lib/intelligence/embeddings');

  // Node < 22 has no native WebSocket; supabase-js's realtime client needs one.
  const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
    realtime: { transport: ws as unknown as never },
  });

  // Fetch opportunities that have content worth extracting a rubric from.
  let query = supabase
    .from('opportunities')
    .select('id, name, description, eligibility_requirements, url, category')
    .order('created_at', { ascending: false });

  if (isFinite(limit)) query = query.limit(limit);

  const { data: opportunities, error: fetchError } = await query;

  if (fetchError) {
    process.stderr.write(`Error fetching opportunities: ${fetchError.message}\n`);
    process.exit(1);
  }

  const total = opportunities?.length ?? 0;
  log(
    `Found ${total} opportunit${total === 1 ? 'y' : 'ies'}${isFinite(limit) ? ` (--limit ${limit})` : ''}`,
  );

  for (let i = 0; i < (opportunities?.length ?? 0); i++) {
    const opp = opportunities?.[i];
    if (!opp) continue;

    log(`\nProcessing opportunity ${i + 1}/${total}: ${opp.name}`);

    try {
      // Dedup check: skip if a rubric already exists for this program or URL.
      const dedupeFilters: string[] = [`grant_program.eq.${opp.name}`];
      if (opp.url) dedupeFilters.push(`source_url.eq.${opp.url}`);

      const { data: existing, error: dedupeError } = await supabase
        .from('intelligence_scoring_rubrics')
        .select('id')
        .or(dedupeFilters.join(','))
        .maybeSingle();

      if (dedupeError) {
        process.stderr.write(`  Error checking for existing rubric: ${dedupeError.message}\n`);
        continue;
      }
      if (existing) {
        log(`  Skipping: rubric already exists (${existing.id})`);
        continue;
      }

      // Extract rubric via Claude — function fetches full opportunity content internally.
      const rubric = await extractRubricFromOpportunity(opp.id, supabase);

      if (!rubric || rubric.dimensions.length === 0) {
        log('  Skipping: no rubric dimensions extracted');
        continue;
      }

      log(`  Extracted ${rubric.dimensions.length} dimension(s) — inserting...`);

      // Build full_text from available content fields for embedding.
      const fullText = [opp.description ?? '', opp.eligibility_requirements ?? '']
        .filter(Boolean)
        .join('\n\n');

      const { data: rubricRow, error: insertError } = await supabase
        .from('intelligence_scoring_rubrics')
        .insert({
          source: 'nofa_parse',
          source_url: opp.url ?? null,
          funder_name: null,
          grant_program: opp.name,
          category: [opp.category],
          dimensions: rubric as unknown as Json,
          full_text: fullText || null,
        })
        .select('id')
        .single();

      if (insertError || !rubricRow) {
        process.stderr.write(
          `  Error inserting rubric: ${insertError?.message ?? 'no data returned'}\n`,
        );
        continue;
      }

      log(`  Inserted rubric ${rubricRow.id}`);

      // Generate and store embedding for semantic retrieval.
      if (fullText.length > 0) {
        const embedding = await generateEmbedding(fullText);
        const { error: updateError } = await supabase
          .from('intelligence_scoring_rubrics')
          .update({ embedding })
          .eq('id', rubricRow.id);

        if (updateError) {
          process.stderr.write(
            `  Error updating embedding: ${updateError.message}\n`,
          );
        } else {
          log('  Embedding stored');
        }
      }

      log(`  Done`);
    } catch (err) {
      process.stderr.write(
        `  Error processing "${opp.name}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  log('\nIngestion complete.');
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
