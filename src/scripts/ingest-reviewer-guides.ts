// Standalone ingestion script — federal reviewer guidance documents.
// Run: npx tsx src/scripts/ingest-reviewer-guides.ts [--dry-run]
// NOT imported by the Next.js app — excluded via tsconfig.

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import type { Database } from '../types/database';

dotenv.config({ path: '.env.local' });

type Json = Database['public']['Tables']['intelligence_scoring_rubrics']['Row']['dimensions'];

interface ReviewerGuideSource {
  url: string;
  funder: string;
  program: string;
}

const REVIEWER_GUIDE_SOURCES: ReviewerGuideSource[] = [
  {
    url: 'https://grants.nih.gov/grants/peer/guidelines_general/Review_Criteria_at_a_Glance.pdf',
    funder: 'NIH',
    program: 'General R01',
  },
  {
    url: 'https://grants.nih.gov/grants/peer/reviewer_guidelines.htm',
    funder: 'NIH',
    program: 'Peer Review Guidelines',
  },
  {
    url: 'https://www.nsf.gov/bfa/dias/policy/merit_review/',
    funder: 'NSF',
    program: 'Merit Review Criteria',
  },
  {
    url: 'https://www.samhsa.gov/grants/applying/review-process',
    funder: 'SAMHSA',
    program: 'Review Process',
  },
  {
    url: 'https://www.hud.gov/program_offices/spm/gmomgmt/grantsinfo/conductgrantreviews',
    funder: 'HUD',
    program: 'Grant Review Conduct',
  },
];

interface ExtractedReviewerIntelligence {
  rubric: {
    dimensions: Array<{
      name: string;
      max_points: number;
      weight_percentage: number;
      description: string;
      common_deductions: string[];
      inferred?: boolean;
    }>;
    total_points: number;
    review_type: string;
    notes: string;
  };
  reviewer_tips: string[];
  common_mistakes: string[];
  formatting_preferences: string[];
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

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

async function fetchContent(url: string): Promise<{ text: string; isPdf: boolean }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BenavoreBot/1.0; grant research)',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isPdf =
    contentType.includes('pdf') ||
    contentType.includes('octet-stream') ||
    url.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const buffer = Buffer.from(await response.arrayBuffer());
    // Lazy import: pdf-parse index.js runs a debug block that reads a test PDF at load time
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const pdfData = await pdfParse(buffer);
    return { text: pdfData.text as string, isPdf: true };
  }

  const html = await response.text();
  // Strip HTML tags and condense whitespace for plain-text extraction
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { text, isPdf: false };
}

async function extractReviewerIntelligence(
  anthropic: Anthropic,
  text: string,
  funder: string,
  program: string,
): Promise<ExtractedReviewerIntelligence> {
  const truncated =
    text.length > 80_000 ? `${text.slice(0, 80_000)}\n[...truncated...]` : text;

  const systemPrompt = `You are an expert in federal grant review processes. Analyze this reviewer guidance document and extract structured intelligence. Return ONLY valid JSON with no markdown formatting:
{
  "rubric": {
    "dimensions": [
      {
        "name": "string",
        "max_points": number,
        "weight_percentage": number,
        "description": "what earns full marks for this dimension",
        "common_deductions": ["string"],
        "inferred": boolean
      }
    ],
    "total_points": number,
    "review_type": "string (peer_review, panel_review, merit_review, internal)",
    "notes": "string"
  },
  "reviewer_tips": ["string — actionable tips for what reviewers look for"],
  "common_mistakes": ["string — what applicants do that loses points"],
  "formatting_preferences": ["string — formatting, length, structure preferences reviewers have"]
}
If scoring dimensions are not explicitly stated, infer them from context and set inferred: true.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Funder: ${funder}\nProgram: ${program}\n\n${truncated}`,
      },
    ],
  });

  const block = response.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('Unexpected Claude response type');
  }

  let raw = block.text.trim();
  const fenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (fenceMatch) {
    raw = fenceMatch[1]?.trim() ?? raw;
  }

  return JSON.parse(raw) as ExtractedReviewerIntelligence;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');

  if (dryRun) {
    log('DRY RUN — no database writes will occur\n');
    log('Sources that would be fetched:');
    for (const source of REVIEWER_GUIDE_SOURCES) {
      const type = source.url.toLowerCase().endsWith('.pdf') ? 'PDF' : 'HTML';
      log(`  [${type}] ${source.funder} / ${source.program}`);
      log(`         ${source.url}`);
    }
    log(`\nTotal: ${REVIEWER_GUIDE_SOURCES.length} source(s)`);
    return;
  }

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

  // Dynamic import AFTER env is loaded — embeddings.ts initialises OpenAI client
  // with process.env.OPENAI_API_KEY at module load time.
  const { generateEmbedding } = await import('../lib/intelligence/embeddings');

  // Lazy client initialisation for Anthropic (constructed after env is loaded)
  let _anthropicInstance: Anthropic | null = null;
  const getAnthropic = (): Anthropic => {
    if (_anthropicInstance === null) {
      _anthropicInstance = createTrackedAnthropic({ apiKey: anthropicKey }, "ingest-reviewer-guides");
    }
    return _anthropicInstance;
  };

  // Node < 22 has no native WebSocket; supabase-js realtime client needs one.
  const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
    realtime: { transport: ws as unknown as never },
  });

  log(`Processing ${REVIEWER_GUIDE_SOURCES.length} reviewer guide source(s)...\n`);

  for (let i = 0; i < REVIEWER_GUIDE_SOURCES.length; i++) {
    const source = REVIEWER_GUIDE_SOURCES[i];
    if (!source) continue;

    log(`[${i + 1}/${REVIEWER_GUIDE_SOURCES.length}] ${source.funder} — ${source.program}`);
    log(`  URL: ${source.url}`);

    try {
      // Dedup check: skip if a rubric for this source URL already exists.
      const { data: existing, error: dedupeError } = await supabase
        .from('intelligence_scoring_rubrics')
        .select('id')
        .eq('source_url', source.url)
        .maybeSingle();

      if (dedupeError) {
        process.stderr.write(`  Error checking dedup: ${dedupeError.message}\n`);
        continue;
      }
      if (existing) {
        log(`  Skipping: already ingested (${existing.id})`);
        continue;
      }

      // Step 1: fetch content
      log('  Fetching content...');
      const { text, isPdf } = await fetchContent(source.url);

      if (!text || text.trim().length < 100) {
        log('  Skipping: insufficient content extracted');
        continue;
      }
      log(`  Fetched ${text.length.toLocaleString()} chars (${isPdf ? 'PDF' : 'HTML'})`);

      // Step 2: extract rubric + reviewer intelligence via Claude
      log('  Extracting rubric and reviewer intelligence with Claude...');
      const anthropic = getAnthropic();
      const intelligence = await extractReviewerIntelligence(
        anthropic,
        text,
        source.funder,
        source.program,
      );

      const { rubric, reviewer_tips, common_mistakes, formatting_preferences } = intelligence;

      log(`  Extracted ${rubric.dimensions.length} dimension(s), ${reviewer_tips.length} tips`);

      // Build full_text that combines all extracted intelligence for embedding.
      const embeddingText = [
        `${source.funder} ${source.program} Reviewer Guide`,
        rubric.notes,
        rubric.dimensions.map((d) => `${d.name}: ${d.description}`).join('\n'),
        reviewer_tips.join('\n'),
        common_mistakes.join('\n'),
        formatting_preferences.join('\n'),
      ]
        .filter(Boolean)
        .join('\n\n');

      // Step 3: insert into intelligence_scoring_rubrics
      const dimensionsJson = {
        dimensions: rubric.dimensions,
        total_points: rubric.total_points,
        review_type: rubric.review_type,
        notes: rubric.notes,
        reviewer_tips,
        common_mistakes,
        formatting_preferences,
      };

      const { data: rubricRow, error: insertError } = await supabase
        .from('intelligence_scoring_rubrics')
        .insert({
          source: 'reviewer_guide',
          source_url: source.url,
          funder_name: source.funder,
          grant_program: source.program,
          category: [source.funder.toLowerCase()],
          dimensions: dimensionsJson as unknown as Json,
          full_text: text.slice(0, 50_000),
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

      // Step 4: generate and store embedding
      log('  Generating embedding...');
      const embedding = await generateEmbedding(embeddingText);
      const { error: updateError } = await supabase
        .from('intelligence_scoring_rubrics')
        .update({ embedding })
        .eq('id', rubricRow.id);

      if (updateError) {
        process.stderr.write(`  Error updating embedding: ${updateError.message}\n`);
      } else {
        log('  Embedding stored');
      }

      log('  Done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Gracefully handle 404s and network errors — log and continue
      if (
        msg.includes('HTTP 404') ||
        msg.includes('HTTP 403') ||
        msg.includes('fetch failed') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('AbortError')
      ) {
        process.stderr.write(
          `  Skipping (network/availability error): ${msg}\n`,
        );
      } else {
        process.stderr.write(`  Error: ${msg}\n`);
      }
    }

    // Polite delay between sources
    if (i < REVIEWER_GUIDE_SOURCES.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
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
