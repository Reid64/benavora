import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Nonprofit Lead Scraper
// Queries foundation_directory for ICP-matching nonprofits, enriches each
// record with website, email, phone, executive director, and grant staff via
// Google search + Playwright + Claude.
// Run: npx tsx src/scripts/scrape-nonprofit-leads.ts
// Expected runtime: 3-4 hours (500 records with rate-limit delays).
// ---------------------------------------------------------------------------

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface FoundationRow {
  id: string;
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  ntee_code: string | null;
  revenue_amount: number | null;
  website: string | null;
  email: string | null;
  phone: string | null;
}

interface EnrichedRecord {
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  ntee_code: string | null;
  revenue_amount: number | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  executive_director: string | null;
  grant_staff: string | null;
}

interface ClaudeContactResult {
  email: string | null;
  phone: string | null;
  executiveDirector: string | null;
  grantStaff: string | null;
  website: string | null;
}

// ---------------------------------------------------------------------------
// Constants — ICP filter
// ---------------------------------------------------------------------------
const ICP_NTEE_PREFIXES: readonly string[] = ['L', 'P', 'K', 'F', 'J', 'S', 'X'];
const REVENUE_MIN = 100_000;
const REVENUE_MAX = 10_000_000;
const RECORD_LIMIT = 500;

const SKIP_DOMAINS: readonly string[] = [
  'linkedin.com',
  'facebook.com',
  'youtube.com',
  'twitter.com',
  'instagram.com',
  'yelp.com',
  'google.com',
  'wikipedia.org',
  'guidestar.org',
  'candid.org',
  'charitynavigator.org',
  'propublica.org',
  'irs.gov',
  'nces.ed.gov',
  'indeed.com',
  'glassdoor.com',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\r?\n/g, ' ').trim();
  if (str.includes(',') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function appendRecordsToCSV(records: EnrichedRecord[], filePath: string): void {
  if (records.length === 0) return;
  const lines: string[] = [];
  for (const r of records) {
    lines.push([
      escapeCsvField(r.ein),
      escapeCsvField(r.name),
      escapeCsvField(r.city),
      escapeCsvField(r.state),
      escapeCsvField(r.ntee_code),
      escapeCsvField(r.revenue_amount),
      escapeCsvField(r.website),
      escapeCsvField(r.email),
      escapeCsvField(r.phone),
      escapeCsvField(r.executive_director),
      escapeCsvField(r.grant_staff),
    ].join(','));
  }
  fs.appendFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Google search: return first organic result URL for a nonprofit
// ---------------------------------------------------------------------------
async function searchGoogleForNonprofit(
  page: Page,
  orgName: string,
  city: string | null,
  state: string | null
): Promise<string | null> {
  const locationPart = [city, state].filter(Boolean).join(' ');
  const query = `${orgName}${locationPart ? ` ${locationPart}` : ''} nonprofit`;
  const encoded = encodeURIComponent(query);

  try {
    await page.goto(`https://www.google.com/search?q=${encoded}&num=10&hl=en`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  } catch {
    return null;
  }

  // Handle cookie / consent dialogs
  try {
    const consentSelectors = [
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      'button:has-text("Agree")',
      '#L2AGLb',
    ];
    for (const sel of consentSelectors) {
      const btn = page.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 1500 }).catch(() => false);
      if (visible) {
        await btn.click();
        await sleep(1000);
        break;
      }
    }
  } catch {
    // no consent dialog present
  }

  await sleep(1000);

  const skipList = [...SKIP_DOMAINS];

  const firstUrl = await page.evaluate((domainsToSkip: string[]): string | null => {
    const headings = document.querySelectorAll('#search h3');
    for (let i = 0; i < headings.length; i++) {
      const h3 = headings[i];
      if (!h3) continue;
      const anchor = h3.closest('a');
      if (!anchor) continue;
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('http')) continue;
      const shouldSkip = domainsToSkip.some(domain => href.includes(domain));
      if (shouldSkip) continue;
      return href.split('#').at(0) ?? href;
    }
    return null;
  }, skipList);

  return firstUrl;
}

// ---------------------------------------------------------------------------
// Visit a URL and return up to 10 000 chars of visible page text
// ---------------------------------------------------------------------------
async function getPageText(page: Page, url: string): Promise<string | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(800);
    const text = await page.evaluate((): string => {
      document.querySelectorAll('script, style, nav, header, footer, iframe').forEach(el => el.remove());
      return document.body ? document.body.innerText : '';
    });
    if (!text || text.trim().length < 50) return null;
    return text.substring(0, 10000);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Send page text to Claude to extract nonprofit contact info
// ---------------------------------------------------------------------------
async function extractNonprofitContacts(
  client: Anthropic,
  text: string,
  url: string
): Promise<ClaudeContactResult | null> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Find the contact email address, phone number, executive director name, and any grant-related staff from this nonprofit website. Return JSON: { "email": null, "phone": null, "executiveDirector": null, "grantStaff": null, "website": "${url}" }

Rules:
- Replace null with real values you find in the text.
- For "grantStaff", list any development director, grant writer, or grant-related staff names as a comma-separated string.
- If you cannot find a direct email, use a contact form URL in the "email" field.
- Return null for any field you truly cannot find.
- Return ONLY the JSON object — no markdown fences, no explanation.

Website text:
${text}`,
        },
      ],
    });

    let rawText = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        rawText = block.text.trim();
        break;
      }
    }

    if (!rawText) return null;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const jsonStr = jsonMatch.at(0);
    if (!jsonStr) return null;

    const parsed = JSON.parse(jsonStr) as Partial<ClaudeContactResult>;
    return {
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      executiveDirector: parsed.executiveDirector ?? null,
      grantStaff: parsed.grantStaff ?? null,
      website: parsed.website ?? url,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  loadEnvLocal();

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found in environment or .env.local');
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL not found in environment or .env.local');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not found in environment or .env.local');

  const anthropic = new Anthropic({ apiKey });
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const outputDir = path.resolve(process.cwd(), 'exports');
  const outputPath = path.join(outputDir, 'nonprofit-leads.csv');
  fs.mkdirSync(outputDir, { recursive: true });

  // Write CSV header (overwrites any existing file to start fresh)
  fs.writeFileSync(
    outputPath,
    'ein,name,city,state,ntee_code,revenue_amount,website,email,phone,executive_director,grant_staff\n',
    'utf-8'
  );

  process.stdout.write('=== Nonprofit Lead Scraper ===\n');
  process.stdout.write(`ICP NTEE prefixes: ${ICP_NTEE_PREFIXES.join(', ')}\n`);
  process.stdout.write(`Revenue range: $${REVENUE_MIN.toLocaleString()} – $${REVENUE_MAX.toLocaleString()}\n`);
  process.stdout.write(`Record limit: ${RECORD_LIMIT}\n`);
  process.stdout.write(`Output: ${outputPath}\n\n`);

  // Build NTEE filter: ntee_code.like.L%,ntee_code.like.P%,...
  const nteeFilter = ICP_NTEE_PREFIXES.map(p => `ntee_code.like.${p}%`).join(',');

  process.stdout.write('Querying foundation_directory...\n');

  const { data: rows, error: queryError } = await supabase
    .from('foundation_directory')
    .select('id, ein, name, city, state, ntee_code, revenue_amount, website, email, phone')
    .gte('revenue_amount', REVENUE_MIN)
    .lte('revenue_amount', REVENUE_MAX)
    .or(nteeFilter)
    .limit(RECORD_LIMIT);

  if (queryError) {
    throw new Error(`Supabase query failed: ${queryError.message}`);
  }

  const orgs = (rows ?? []) as FoundationRow[];
  process.stdout.write(`Found ${orgs.length} matching organizations.\n`);
  process.stdout.write('Starting enrichment in 3 seconds...\n\n');
  await sleep(3000);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let processed = 0;
  let enriched = 0;

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    try {
      const page = await context.newPage();

      for (const org of orgs) {
        processed++;

        process.stdout.write(
          `[${processed}/${orgs.length}] ${org.name} | ${org.city ?? '?'}, ${org.state ?? '?'} | NTEE:${org.ntee_code ?? '?'} | Rev:$${(org.revenue_amount ?? 0).toLocaleString()}`
        );

        // 3-second delay between Google searches (rate limiting)
        await sleep(3000);

        const websiteUrl = await searchGoogleForNonprofit(page, org.name, org.city, org.state);

        if (!websiteUrl) {
          process.stdout.write(' -> no website found\n');
          appendRecordsToCSV([{
            ein: org.ein,
            name: org.name,
            city: org.city,
            state: org.state,
            ntee_code: org.ntee_code,
            revenue_amount: org.revenue_amount,
            website: null,
            email: null,
            phone: null,
            executive_director: null,
            grant_staff: null,
          }], outputPath);

          if (processed % 50 === 0) {
            process.stdout.write(`\n--- Progress: ${processed}/${orgs.length} processed | ${enriched} enriched ---\n\n`);
          }
          continue;
        }

        // 2-second delay between page visits (rate limiting)
        await sleep(2000);

        const pageText = await getPageText(page, websiteUrl);

        let contacts: ClaudeContactResult | null = null;
        if (pageText) {
          contacts = await extractNonprofitContacts(anthropic, pageText, websiteUrl);
        }

        const finalWebsite = contacts?.website ?? websiteUrl;
        const finalEmail = contacts?.email ?? null;
        const finalPhone = contacts?.phone ?? null;
        const executiveDirector = contacts?.executiveDirector ?? null;
        const grantStaff = contacts?.grantStaff ?? null;

        // Update foundation_directory with discovered data (only fill empty fields)
        const updatePayload: Record<string, string> = {};
        if (finalWebsite && !org.website) updatePayload['website'] = finalWebsite;
        if (finalEmail && !org.email) updatePayload['email'] = finalEmail;
        if (finalPhone && !org.phone) updatePayload['phone'] = finalPhone;

        if (Object.keys(updatePayload).length > 0) {
          const { error: updateError } = await supabase
            .from('foundation_directory')
            .update(updatePayload)
            .eq('id', org.id);

          if (updateError) {
            process.stdout.write(` [DB err: ${updateError.message}]`);
          } else {
            enriched++;
          }
        }

        appendRecordsToCSV([{
          ein: org.ein,
          name: org.name,
          city: org.city,
          state: org.state,
          ntee_code: org.ntee_code,
          revenue_amount: org.revenue_amount,
          website: finalWebsite,
          email: finalEmail,
          phone: finalPhone,
          executive_director: executiveDirector,
          grant_staff: grantStaff,
        }], outputPath);

        process.stdout.write(
          ` -> ${finalEmail ? 'email' : '–'} | ${finalWebsite ? finalWebsite.substring(0, 50) : 'no site'}\n`
        );

        if (processed % 50 === 0) {
          process.stdout.write(`\n--- Progress: ${processed}/${orgs.length} processed | ${enriched} enriched ---\n\n`);
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  process.stdout.write('\n=== Scraping Complete ===\n');
  process.stdout.write(`Total processed: ${processed}\n`);
  process.stdout.write(`Total DB-enriched: ${enriched}\n`);
  process.stdout.write(`Output file: ${outputPath}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `\nFATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
