// Seed script — logic model templates for 10 nonprofit program categories.
// Run: npx tsx src/scripts/seed-logic-models.ts
// NOT imported by the Next.js app — excluded via tsconfig.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import ws from 'ws';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import type { Database } from '../types/database';

const CATEGORIES = [
  'homelessness_prevention',
  'reentry_second_chance',
  'addiction_recovery',
  'workforce_development',
  'affordable_housing',
  'youth_mentoring',
  'veterans_services',
  'faith_based_services',
  'food_insecurity',
  'domestic_violence',
] as const;

const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  homelessness_prevention: 'Homelessness Prevention and Intervention',
  reentry_second_chance: 'Reentry / Second Chance Programs',
  addiction_recovery: 'Addiction Recovery and Treatment',
  workforce_development: 'Workforce Development',
  affordable_housing: 'Affordable Housing Development',
  youth_mentoring: 'Youth Programs and Mentoring',
  veterans_services: 'Veterans Services',
  faith_based_services: 'Faith-Based Social Services',
  food_insecurity: 'Food Insecurity Programs',
  domestic_violence: 'Domestic Violence Services',
};

interface LogicModelJson {
  inputs: string[];
  activities: string[];
  outputs: string[];
  outcomes: string[];
  impact: string[];
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (anthropicClient === null) {
    const key = process.env['ANTHROPIC_API_KEY'];
    if (!key) throw new Error('Missing ANTHROPIC_API_KEY');
    anthropicClient = new Anthropic({ apiKey: key });
  }
  return anthropicClient;
}

async function generateLogicModel(category: string, label: string): Promise<LogicModelJson> {
  const message = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system:
      'You are an expert in nonprofit program design and federal grant logic models. ' +
      'Generate a comprehensive logic model for the given program category. ' +
      'Return ONLY valid JSON with no markdown. Structure:\n' +
      '{\n' +
      '  "inputs": ["resource 1", "resource 2", ...],\n' +
      '  "activities": ["activity 1", "activity 2", ...],\n' +
      '  "outputs": ["output 1", "output 2", ...],\n' +
      '  "outcomes": ["short-term outcome 1", "medium-term outcome 2", ...],\n' +
      '  "impact": ["long-term impact 1", "long-term impact 2", ...]\n' +
      '}\n' +
      'Each array should have 5-8 items. ' +
      'Inputs are resources needed. ' +
      'Activities are what the program does. ' +
      'Outputs are direct products (counts). ' +
      'Outcomes are measurable changes. ' +
      'Impact is long-term systemic change.',
    messages: [
      {
        role: 'user',
        content: `Generate a logic model for: ${label}`,
      },
    ],
  });

  const content = message.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('Unexpected Claude response type');
  }

  const jsonText = content.text.trim().replace(/^```json\n?|\n?```$/g, '');
  return JSON.parse(jsonText) as LogicModelJson;
}

function buildEmbeddingText(_category: string, label: string, model: LogicModelJson): string {
  return [
    `Logic model for ${label}:`,
    `Inputs: ${model.inputs.join('. ')}`,
    `Activities: ${model.activities.join('. ')}`,
    `Outputs: ${model.outputs.join('. ')}`,
    `Outcomes: ${model.outcomes.join('. ')}`,
    `Impact: ${model.impact.join('. ')}`,
  ].join(' ');
}

async function main(): Promise<void> {
  const supabaseUrl =
    process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const openaiKey = process.env['OPENAI_API_KEY'];

  if (!supabaseUrl || !supabaseKey) {
    process.stderr.write('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY\n');
    process.exit(1);
  }
  if (!anthropicKey) {
    process.stderr.write('Missing ANTHROPIC_API_KEY\n');
    process.exit(1);
  }
  if (!openaiKey) {
    process.stderr.write('Missing OPENAI_API_KEY\n');
    process.exit(1);
  }

  // Dynamic import AFTER env is loaded — embeddings.ts initialises OpenAI at module load.
  const { generateEmbedding } = await import('../lib/intelligence/embeddings');

  const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
    realtime: { transport: ws as unknown as never },
  });

  log(`Seeding logic model templates for ${CATEGORIES.length} categories...\n`);

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < CATEGORIES.length; i++) {
    const category = CATEGORIES[i];
    if (!category) continue;
    const label = CATEGORY_LABELS[category];

    log(`[${i + 1}/${CATEGORIES.length}] ${label}`);

    try {
      // Dedup: skip if category already exists
      const { data: existing, error: checkError } = await supabase
        .from('intelligence_logic_models')
        .select('id')
        .eq('category', category)
        .maybeSingle();

      if (checkError) {
        process.stderr.write(`  Error checking dedup: ${checkError.message}\n`);
        continue;
      }
      if (existing) {
        log(`  Skipping: already exists (${existing.id})`);
        skipped++;
        continue;
      }

      // Generate via Claude
      log(`  Generating logic model with Claude...`);
      const model = await generateLogicModel(category, label);

      // Generate embedding from summary text
      log(`  Generating embedding...`);
      const embeddingText = buildEmbeddingText(category, label, model);
      const embedding = await generateEmbedding(embeddingText);

      // Insert
      const { data: inserted_row, error: insertError } = await supabase
        .from('intelligence_logic_models')
        .insert({
          category,
          inputs: model.inputs,
          activities: model.activities,
          outputs: model.outputs,
          outcomes: model.outcomes,
          impact: model.impact,
          is_template: true,
          source: 'claude_generated',
          embedding,
        })
        .select('id')
        .single();

      if (insertError || !inserted_row) {
        process.stderr.write(
          `  Error inserting: ${insertError?.message ?? 'no data returned'}\n`,
        );
        continue;
      }

      log(`  Inserted (${inserted_row.id})`);
      inserted++;

      // Polite delay between Claude calls
      if (i < CATEGORIES.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } catch (err) {
      process.stderr.write(
        `  Error processing "${label}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  log(`\nDone. Inserted: ${inserted}, Skipped (already existed): ${skipped}`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
