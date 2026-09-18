import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';
import { launchChromium } from '@/lib/browser/launch-chromium';

// ---------------------------------------------------------------------------
// Grant Writing Consultant Lead Scraper
// Searches Google for grant writing consultants across all 50 US states,
// scrapes grantprofessionals.org, and exports results to CSV.
// Run: npx tsx src/scripts/scrape-consultants.ts
// Expected runtime: 2-4 hours due to rate-limit delays.
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
interface LeadRecord {
  businessName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  services: string | null;
}

interface LeadWithQuery extends LeadRecord {
  sourceQuery: string;
}

// ---------------------------------------------------------------------------
// 50 state queries
// ---------------------------------------------------------------------------
const STATE_QUERIES: readonly string[] = [
  'grant writing consultant Alabama',
  'grant writing consultant Alaska',
  'grant writing consultant Arizona',
  'grant writing consultant Arkansas',
  'grant writing consultant California',
  'grant writing consultant Colorado',
  'grant writing consultant Connecticut',
  'grant writing consultant Delaware',
  'grant writing consultant Florida',
  'grant writing consultant Georgia',
  'grant writing consultant Hawaii',
  'grant writing consultant Idaho',
  'grant writing consultant Illinois',
  'grant writing consultant Indiana',
  'grant writing consultant Iowa',
  'grant writing consultant Kansas',
  'grant writing consultant Kentucky',
  'grant writing consultant Louisiana',
  'grant writing consultant Maine',
  'grant writing consultant Maryland',
  'grant writing consultant Massachusetts',
  'grant writing consultant Michigan',
  'grant writing consultant Minnesota',
  'grant writing consultant Mississippi',
  'grant writing consultant Missouri',
  'grant writing consultant Montana',
  'grant writing consultant Nebraska',
  'grant writing consultant Nevada',
  'grant writing consultant New Hampshire',
  'grant writing consultant New Jersey',
  'grant writing consultant New Mexico',
  'grant writing consultant New York',
  'grant writing consultant North Carolina',
  'grant writing consultant North Dakota',
  'grant writing consultant Ohio',
  'grant writing consultant Oklahoma',
  'grant writing consultant Oregon',
  'grant writing consultant Pennsylvania',
  'grant writing consultant Rhode Island',
  'grant writing consultant South Carolina',
  'grant writing consultant South Dakota',
  'grant writing consultant Tennessee',
  'grant writing consultant Texas',
  'grant writing consultant Utah',
  'grant writing consultant Vermont',
  'grant writing consultant Virginia',
  'grant writing consultant Washington',
  'grant writing consultant West Virginia',
  'grant writing consultant Wisconsin',
  'grant writing consultant Wyoming',
];

const SKIP_DOMAINS: readonly string[] = [
  'linkedin.com',
  'facebook.com',
  'youtube.com',
  'twitter.com',
  'instagram.com',
  'yelp.com',
  'google.com',
  'wikipedia.org',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'bbb.org',
  'manta.com',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\r?\n/g, ' ').trim();
  if (str.includes(',') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function appendLeadsToCSV(records: LeadWithQuery[], filePath: string): void {
  if (records.length === 0) return;
  const lines: string[] = [];
  for (const r of records) {
    lines.push([
      escapeCsvField(r.businessName),
      escapeCsvField(r.contactName),
      escapeCsvField(r.email),
      escapeCsvField(r.phone),
      escapeCsvField(r.website),
      escapeCsvField(r.city),
      escapeCsvField(r.state),
      escapeCsvField(r.services),
      escapeCsvField(r.sourceQuery),
    ].join(','));
  }
  fs.appendFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Google search: extract organic result URLs
// ---------------------------------------------------------------------------
async function searchGoogle(page: Page, query: string): Promise<string[]> {
  const encoded = encodeURIComponent(query);
  try {
    await page.goto(`https://www.google.com/search?q=${encoded}&num=20&hl=en`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  } catch {
    return [];
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

  await sleep(1500);

  const skipList = [...SKIP_DOMAINS];

  const urls = await page.evaluate((domainsToSkip: string[]): string[] => {
    const results: string[] = [];

    // Organic results always have h3 headings; ads typically do not in the #search area
    const headings = document.querySelectorAll('#search h3');
    headings.forEach(h3 => {
      const anchor = h3.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('http')) return;

      const shouldSkip = domainsToSkip.some(domain => href.includes(domain));
      if (shouldSkip) return;

      // Strip fragment
      const clean = href.split('#').at(0) ?? href;
      if (!results.includes(clean)) results.push(clean);
    });

    return results;
  }, skipList);

  return urls.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Visit a URL and return up to 10 000 chars of visible page text
// ---------------------------------------------------------------------------
async function getPageText(page: Page, url: string): Promise<string | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(800);
    const text = await page.evaluate((): string => {
      // Remove noise elements before extracting text
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
// Send page text to Claude to extract contact info
// ---------------------------------------------------------------------------
async function extractContactsFromText(
  client: Anthropic,
  text: string,
  url: string
): Promise<LeadRecord | null> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Extract contact information from this business website. The website URL is: ${url}

Return ONLY valid JSON in exactly this format (no markdown fences, no explanation):
{"businessName":null,"contactName":null,"email":null,"phone":null,"website":"${url}","city":null,"state":null,"services":null}

Rules:
- Replace null with real values you find in the text.
- For "services", write a 1-sentence description of their grant writing services.
- If you cannot find an email, look for a contact form URL and put that in "email".
- Return null for any field you truly cannot find.
- If this page is not about a grant writing business or consultant, respond with only the word: NULL

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

    if (!rawText || rawText.toUpperCase() === 'NULL') return null;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const jsonStr = jsonMatch.at(0);
    if (!jsonStr) return null;

    const parsed = JSON.parse(jsonStr) as Partial<LeadRecord>;
    return {
      businessName: parsed.businessName ?? null,
      contactName: parsed.contactName ?? null,
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      website: parsed.website ?? url,
      city: parsed.city ?? null,
      state: parsed.state ?? null,
      services: parsed.services ?? null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scrape grantprofessionals.org member directory
// ---------------------------------------------------------------------------
async function scrapeGrantProfessionals(
  page: Page,
  client: Anthropic,
  outputPath: string
): Promise<number> {
  let found = 0;
  process.stdout.write('\n\n--- Phase 2: Scraping grantprofessionals.org ---\n');

  try {
    await page.goto('https://grantprofessionals.org', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await sleep(2000);

    // Find directory / member links on the homepage
    const directoryLinks = await page.evaluate((): string[] => {
      const results: string[] = [];
      const base = 'https://grantprofessionals.org';
      document.querySelectorAll('a[href]').forEach(anchor => {
        const href = anchor.getAttribute('href') ?? '';
        const text = (anchor.textContent ?? '').toLowerCase();
        const isDir =
          text.includes('directory') ||
          text.includes('member') ||
          text.includes('find a grant') ||
          text.includes('consultant') ||
          href.includes('directory') ||
          href.includes('member') ||
          href.includes('find-a-grant');
        if (!isDir) return;

        let full: string;
        if (href.startsWith('http')) {
          full = href;
        } else if (href.startsWith('/')) {
          full = `${base}${href}`;
        } else {
          full = `${base}/${href}`;
        }
        if (!results.includes(full)) results.push(full);
      });
      return results.slice(0, 5);
    });

    // Fallback candidates if nothing found on the homepage
    const candidates =
      directoryLinks.length > 0
        ? directoryLinks
        : [
            'https://grantprofessionals.org/find-a-grant-professional',
            'https://grantprofessionals.org/members',
            'https://grantprofessionals.org/directory',
          ];

    const visited = new Set<string>();

    for (const dirUrl of candidates) {
      if (visited.has(dirUrl)) continue;
      visited.add(dirUrl);
      process.stdout.write(`  Visiting: ${dirUrl}\n`);

      await sleep(2000);
      const text = await getPageText(page, dirUrl);
      if (!text) continue;

      const lead = await extractContactsFromText(client, text, dirUrl);
      if (lead) {
        appendLeadsToCSV([{ ...lead, sourceQuery: 'grantprofessionals.org directory' }], outputPath);
        found++;
      }

      // Look for individual member profile links on this directory page
      const memberLinks = await page.evaluate((): string[] => {
        const links: string[] = [];
        document.querySelectorAll('a[href]').forEach(anchor => {
          const href = anchor.getAttribute('href') ?? '';
          if (!href.startsWith('http')) return;
          const isProfile =
            href.includes('member') ||
            href.includes('profile') ||
            href.includes('consultant') ||
            href.includes('directory/');
          if (!isProfile) return;
          if (!links.includes(href)) links.push(href);
        });
        return links.slice(0, 30);
      });

      for (const memberUrl of memberLinks) {
        if (visited.has(memberUrl)) continue;
        visited.add(memberUrl);
        process.stdout.write(`    Profile: ${memberUrl}\n`);
        await sleep(2000);
        const memberText = await getPageText(page, memberUrl);
        if (!memberText) continue;
        const memberLead = await extractContactsFromText(client, memberText, memberUrl);
        if (memberLead) {
          appendLeadsToCSV(
            [{ ...memberLead, sourceQuery: 'grantprofessionals.org directory' }],
            outputPath
          );
          found++;
        }
      }
    }
  } catch (err) {
    process.stdout.write(
      `  ERROR: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  process.stdout.write(`  Done. Found ${found} leads from grantprofessionals.org\n`);
  return found;
}

// ---------------------------------------------------------------------------
// Search Google for "grant writing firm directory" and scrape top 3 results
// ---------------------------------------------------------------------------
async function scrapeDirectorySearch(
  page: Page,
  client: Anthropic,
  outputPath: string
): Promise<number> {
  let found = 0;
  const sourceQuery = 'grant writing firm directory';
  process.stdout.write('\n--- Phase 3: Grant writing firm directory search ---\n');

  try {
    const urls = await searchGoogle(page, sourceQuery);
    await sleep(3000);

    const top3 = urls.slice(0, 3);
    process.stdout.write(`  Found ${top3.length} directory URLs to scrape\n`);

    for (const url of top3) {
      process.stdout.write(`  Visiting: ${url}\n`);
      await sleep(2000);
      const text = await getPageText(page, url);
      if (!text) continue;

      const lead = await extractContactsFromText(client, text, url);
      if (lead) {
        appendLeadsToCSV([{ ...lead, sourceQuery }], outputPath);
        found++;
      }
    }
  } catch (err) {
    process.stdout.write(
      `  ERROR: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  process.stdout.write(`  Done. Found ${found} leads from directory search\n`);
  return found;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  loadEnvLocal();

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found in environment or .env.local');
  }

  const client = new Anthropic({ apiKey });

  const outputDir = path.resolve(process.cwd(), 'exports');
  const outputPath = path.join(outputDir, 'consultant-leads.csv');
  fs.mkdirSync(outputDir, { recursive: true });

  // Write CSV header (overwrite any existing file to start fresh)
  fs.writeFileSync(
    outputPath,
    'business_name,contact_name,email,phone,website,city,state,services,source_query\n',
    'utf-8'
  );

  process.stdout.write('=== Grant Writing Consultant Lead Scraper ===\n');
  process.stdout.write(`Output: ${outputPath}\n`);
  process.stdout.write('Starting in 3 seconds...\n');
  await sleep(3000);

  const browser = await launchChromium(chromium, {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let totalLeads = 0;

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    try {
      const page = await context.newPage();

      // ---- Phase 1: 50 state Google searches ----
      process.stdout.write('\n--- Phase 1: 50-state Google search ---\n');

      for (let i = 0; i < STATE_QUERIES.length; i++) {
        const query = STATE_QUERIES[i] ?? '';
        if (!query) continue;

        process.stdout.write(`\nState ${i + 1}/50: ${query} ...`);

        const urls = await searchGoogle(page, query);
        process.stdout.write(` ${urls.length} URLs`);

        // 3-second delay between Google searches
        await sleep(3000);

        const stateLeads: LeadWithQuery[] = [];

        for (const url of urls) {
          // 2-second delay between page visits
          await sleep(2000);
          const text = await getPageText(page, url);
          if (!text) continue;

          const lead = await extractContactsFromText(client, text, url);
          if (lead) {
            stateLeads.push({ ...lead, sourceQuery: query });
            totalLeads++;
          }
        }

        if (stateLeads.length > 0) {
          appendLeadsToCSV(stateLeads, outputPath);
        }

        process.stdout.write(` -> ${stateLeads.length} leads (total: ${totalLeads})`);
      }

      // ---- Phase 2: grantprofessionals.org ----
      const gpLeads = await scrapeGrantProfessionals(page, client, outputPath);
      totalLeads += gpLeads;

      // ---- Phase 3: Directory Google search ----
      const dirLeads = await scrapeDirectorySearch(page, client, outputPath);
      totalLeads += dirLeads;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  process.stdout.write('\n\n=== Scraping Complete ===\n');
  process.stdout.write(`Total leads found: ${totalLeads}\n`);
  process.stdout.write(`Output file: ${outputPath}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `\nFATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
