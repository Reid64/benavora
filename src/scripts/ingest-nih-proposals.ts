// Standalone ingestion script — NIH NIAID funded grant application examples.
// Run: npx tsx src/scripts/ingest-nih-proposals.ts [--limit N]
// NOT imported by the Next.js app — excluded via tsconfig.

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import type { Database } from '../types/database';

const NIAID_PAGE = 'https://www.niaid.nih.gov/grants-contracts/sample-applications';
const NIH_BASE = 'https://www.niaid.nih.gov';

const SECTION_TYPES = [
  'executive_summary',
  'need_statement',
  'problem_framing',
  'program_design',
  'methodology',
  'outcomes',
  'evaluation_plan',
  'sustainability',
  'budget_narrative',
  'capacity',
  'partnerships',
] as const;

type SectionType = (typeof SECTION_TYPES)[number];

interface ExtractedSections {
  executive_summary: string | null;
  need_statement: string | null;
  problem_framing: string | null;
  program_design: string | null;
  methodology: string | null;
  outcomes: string | null;
  evaluation_plan: string | null;
  sustainability: string | null;
  budget_narrative: string | null;
  capacity: string | null;
  partnerships: string | null;
}

interface PdfLink {
  url: string;
  title: string;
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

// ---------------------------------------------------------------------------
// Minimal .env.local parser (tsx does not auto-load .env files).
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

async function fetchPdfLinks(): Promise<PdfLink[]> {
  const response = await fetch(NIAID_PAGE, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BenavoreBot/1.0)' },
  });
  if (!response.ok) throw new Error(`NIAID page returned HTTP ${response.status}`);
  const html = await response.text();

  const links: PdfLink[] = [];
  // Capture href + anchor text for PDF links (absolute or relative)
  const hrefPattern = /<a[^>]+href="([^"]*\.pdf[^"]*)"[^>]*>([^<]*)</gi;
  let match: RegExpExecArray | null;

  while ((match = hrefPattern.exec(html)) !== null) {
    const rawUrl = match[1] ?? '';
    const anchorText = (match[2] ?? '').trim();
    if (!rawUrl) continue;

    const url = rawUrl.startsWith('http')
      ? rawUrl
      : `${NIH_BASE}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;

    links.push({ url, title: anchorText || path.basename(rawUrl, '.pdf') });
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return links.filter(({ url }) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

async function downloadPdf(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BenavoreBot/1.0)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
    throw new Error(`Unexpected content-type "${contentType}" from ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function extractSections(
  anthropic: Anthropic,
  text: string,
): Promise<ExtractedSections> {
  // Truncate to ~100k chars — well within Claude's context window but avoids
  // excessively long prompts for very large applications.
  const truncated =
    text.length > 100_000 ? `${text.slice(0, 100_000)}\n[...truncated...]` : text;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system:
      'You are analyzing a funded NIH grant application. Extract the following sections if present. Return JSON with these keys: executive_summary, need_statement, problem_framing, program_design, methodology, outcomes, evaluation_plan, sustainability, budget_narrative, capacity, partnerships. For each key, provide the relevant text from the application. If a section is not present, set it to null.',
    messages: [
      {
        role: 'user',
        content: `Here is the grant application text:\n\n${truncated}\n\nReturn only valid JSON with the requested keys.`,
      },
    ],
  });

  const content = message.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('Unexpected Claude response type');
  }

  const jsonText = content.text.trim().replace(/^```json\n?|\n?```$/g, '');
  return JSON.parse(jsonText) as ExtractedSections;
}

async function main(): Promise<void> {
  // Load env before any dynamic import that initialises clients from env vars
  loadEnvLocal();

  // parse --limit flag
  const argv = process.argv.slice(2);
  const limitIdx = argv.indexOf('--limit');
  const limitRaw = limitIdx !== -1 ? argv[limitIdx + 1] : undefined;
  const limitParsed = limitRaw !== undefined ? parseInt(limitRaw, 10) : NaN;
  const limit = !isNaN(limitParsed) ? limitParsed : Infinity;

  const supabaseUrl = process.env['SUPABASE_URL'];
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
  const { generateEmbeddingsBatch } = await import('../lib/intelligence/embeddings');

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  log('Fetching NIH NIAID sample applications page...');
  const pdfLinks = await fetchPdfLinks();
  log(`Found ${pdfLinks.length} PDF link(s) on the page`);

  const toProcess = isFinite(limit) ? pdfLinks.slice(0, limit) : pdfLinks;
  log(
    `Processing ${toProcess.length} proposal(s)${isFinite(limit) ? ` (--limit ${limit})` : ''}`,
  );

  for (let i = 0; i < toProcess.length; i++) {
    const link = toProcess[i];
    if (!link) continue;
    log(`\nProcessing proposal ${i + 1}/${toProcess.length}: ${link.title}`);

    try {
      // Step 1: download PDF
      log(`  Downloading ${link.url}`);
      const pdfBuffer = await downloadPdf(link.url);

      // Step 2: extract text — lazy import as required
      log('  Parsing PDF...');
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(pdfBuffer);
      const fullText: string = pdfData.text;

      if (!fullText || fullText.trim().length < 100) {
        log('  Skipping: insufficient text extracted (possibly scanned/protected PDF)');
        continue;
      }
      log(`  Extracted ${fullText.length.toLocaleString()} characters`);

      // Step 3: extract structured sections with Claude
      log('  Extracting sections with Claude...');
      const sections = await extractSections(anthropic, fullText);

      // Step 4: insert into intelligence_funded_proposals
      const { data: proposal, error: proposalError } = await supabase
        .from('intelligence_funded_proposals')
        .insert({
          source: 'NIH',
          source_url: link.url,
          funder_name: 'NIH / NIAID',
          funder_type: 'government',
          grant_program: link.title,
          category: ['health', 'research'],
          full_text: fullText,
          metadata: {
            page_url: NIAID_PAGE,
            file_name: path.basename(link.url),
            text_length: fullText.length,
          },
        })
        .select('id')
        .single();

      if (proposalError || !proposal) {
        process.stderr.write(
          `  Error inserting proposal: ${proposalError?.message ?? 'no data returned'}\n`,
        );
        continue;
      }
      log(`  Inserted proposal ${proposal.id}`);

      // Collect non-null sections
      const sectionInserts: Array<{
        proposal_id: string;
        section_type: string;
        section_text: string;
      }> = [];

      for (const sectionType of SECTION_TYPES) {
        const sectionText = sections[sectionType as SectionType];
        if (sectionText && sectionText.trim().length > 0) {
          sectionInserts.push({
            proposal_id: proposal.id,
            section_type: sectionType,
            section_text: sectionText.trim(),
          });
        }
      }

      if (sectionInserts.length === 0) {
        log('  No sections extracted — skipping embedding step');
        continue;
      }

      // Step 4 (cont): insert sections
      const { data: insertedSections, error: sectionsError } = await supabase
        .from('intelligence_proposal_sections')
        .insert(sectionInserts)
        .select('id, section_text');

      if (sectionsError || !insertedSections) {
        process.stderr.write(
          `  Error inserting sections: ${sectionsError?.message ?? 'no data returned'}\n`,
        );
        continue;
      }
      log(`  Inserted ${insertedSections.length} section(s)`);

      // Step 5: generate embeddings and update each section
      log('  Generating embeddings...');
      const sectionTexts = insertedSections.map((s) => s.section_text);
      const embeddings = await generateEmbeddingsBatch(sectionTexts);

      for (let j = 0; j < insertedSections.length; j++) {
        const section = insertedSections[j];
        const embedding = embeddings[j];
        if (!section || !embedding) continue;

        const { error: updateError } = await supabase
          .from('intelligence_proposal_sections')
          .update({ embedding })
          .eq('id', section.id);

        if (updateError) {
          process.stderr.write(
            `  Error updating embedding for section ${section.id}: ${updateError.message}\n`,
          );
        }
      }

      log(`  Done — ${insertedSections.length} section(s) embedded`);

      // Polite delay between proposals
      if (i < toProcess.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } catch (err) {
      process.stderr.write(
        `  Error processing "${link.title}": ${err instanceof Error ? err.message : String(err)}\n`,
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
