import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env['SUPABASE_URL'] ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Fatal: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

// Parse --limit flag
const limitArg = process.argv.indexOf('--limit');
const limit: number | null = limitArg !== -1 ? parseInt(process.argv[limitArg + 1] ?? '0', 10) : null;

// ---------------------------------------------------------------------------
// Supabase client (service role — bypasses RLS)
// ---------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
} as unknown as Parameters<typeof createClient>[2]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PortalStatus = 'active' | 'redirect' | 'requires_login' | 'dead' | 'error';

interface FunderRow {
  id: string;
  name: string;
  giving_portal_url: string;
}

interface CheckResult {
  status: PortalStatus;
  statusCode: number | null;
  responseTimeMs: number;
  redirectUrl: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 10_000;
const DELAY_BETWEEN_MS = 500;

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

async function checkUrl(url: string): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });

    const responseTimeMs = Date.now() - start;
    const { status } = response;
    const redirectUrl = response.headers.get('location');

    let portalStatus: PortalStatus;
    if (status >= 200 && status < 300) {
      portalStatus = 'active';
    } else if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      portalStatus = 'redirect';
    } else if (status === 401 || status === 403) {
      portalStatus = 'requires_login';
    } else {
      portalStatus = 'dead';
    }

    return { status: portalStatus, statusCode: status, responseTimeMs, redirectUrl };
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    const isDead = /timeout|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(message) ||
      (err instanceof Error && err.name === 'AbortError');

    return {
      status: isDead ? 'dead' : 'error',
      statusCode: null,
      responseTimeMs,
      redirectUrl: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let query = supabase
    .from('funders')
    .select('id, name, giving_portal_url')
    .not('giving_portal_url', 'is', null)
    .order('created_at', { ascending: true });

  if (limit !== null && limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch funders:', error.message);
    process.exit(1);
  }

  const funders = (data ?? []) as FunderRow[];
  const total = funders.length;
  console.log(`Checking ${total} giving portal URLs…\n`);

  const counts: Record<PortalStatus, number> = {
    active: 0,
    redirect: 0,
    requires_login: 0,
    dead: 0,
    error: 0,
  };

  for (let i = 0; i < funders.length; i++) {
    const funder = funders[i];
    if (!funder) continue;

    const result = await checkUrl(funder.giving_portal_url);
    counts[result.status]++;

    const n = i + 1;
    console.log(
      `Checked ${n}/${total}: ${funder.name} → ${result.status}` +
        (result.statusCode !== null ? ` (${result.statusCode})` : '') +
        ` (${result.responseTimeMs}ms)`,
    );

    // Persist results
    const updatePayload: Record<string, unknown> = {
      portal_status: result.status,
      portal_last_checked_at: new Date().toISOString(),
      portal_response_time_ms: result.responseTimeMs,
    };

    if (result.status === 'redirect' && result.redirectUrl) {
      updatePayload['giving_portal_url'] = result.redirectUrl;
      console.log(`  → Updated giving_portal_url to: ${result.redirectUrl}`);
    }

    const { error: updateError } = await supabase
      .from('funders')
      .update(updatePayload)
      .eq('id', funder.id);

    if (updateError) {
      console.warn(`  ! Failed to update funder ${funder.id}: ${updateError.message}`);
    }

    if (i < funders.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, DELAY_BETWEEN_MS));
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Active:          ${counts.active}`);
  console.log(`Redirect:        ${counts.redirect}`);
  console.log(`Requires login:  ${counts.requires_login}`);
  console.log(`Dead:            ${counts.dead}`);
  console.log(`Error:           ${counts.error}`);
  console.log(`Total checked:   ${total}`);
}

void main().catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
