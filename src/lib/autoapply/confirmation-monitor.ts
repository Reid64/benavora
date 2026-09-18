// Gmail Confirmation Monitor — AUTOAPPLY_ARCHITECTURE_V2.md §10A.
//
// Read-only poller against exactly one dedicated, Benavora-owned inbox
// (apply@benavora.com). This is a SEPARATE OAuth grant from the per-org
// Gmail integrations at src/lib/email/gmail-sync.ts / gmail-auth.ts (those
// authenticate as an org's own connected mailbox for outreach-thread sync —
// a different feature entirely, never reused or imported here). The only
// scope ever requested against this inbox is
// https://www.googleapis.com/auth/gmail.readonly — no send/modify/settings
// scope, and this module never labels, archives, sends, or deletes a
// message, only lists and reads.
//
// google.auth.OAuth2()/google.gmail({auth}) as-any casts mirror gmail-auth.ts
// / gmail-sync.ts's own documented reasoning: the pinned google-auth-library
// version diverges from the copy bundled inside googleapis, so the
// constructor return types are incompatible — load-bearing, do not remove.
//
// Credentials: reuses the same Google Cloud OAuth client already registered
// for gmail-auth.ts (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — legitimately
// the same app, just authorized by a different Google account) plus one new,
// monitor-specific env var, GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN. That
// refresh token can only be produced by a human completing the OAuth consent
// screen once, signed in as apply@benavora.com — there is no way to automate
// that single step, so until it's set this module degrades to a no-op each
// cycle (logged once) rather than crashing the worker.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { gmail_v1, google } from 'googleapis';
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { withClaudeLimit } from './claude-concurrency';

import { CredentialManager } from './credential-manager';
import type { Database } from '@/types/database';
import { causeOf, withCause } from '@/lib/agents/base-agent';

// --- Config -----------------------------------------------------------------

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const CANDIDATE_WINDOW_DAYS = 21;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
// Defensive cap on a single poll cycle's Gmail list pagination — a dedicated,
// low-volume inbox should never need more than this in a 5-minute window;
// not specified by §10A, added so one pathological cycle can't run unbounded.
const MAX_LIST_PAGES = 3;
const GMAIL_PAGE_SIZE = 100;
// A normalized org name shorter than this is too generic to safely use as a
// substring match (e.g. an org literally named "The" or "A") — defensive
// guard against false-positive matches, not specified by §10A verbatim.
const ORG_NAME_MIN_LEN = 3;
const ORG_SUFFIXES = ['inc.', 'inc', 'foundation', 'corp.', 'corp', 'corporation'];

const SOURCE = 'gmail-confirmation-monitor';

// --- Types --------------------------------------------------------------------

interface MatchCandidate {
  submissionId: string;
  organizationId: string;
  funderId: string;
  portalUrl: string | null;
  portalDomain: string | null;
  normalizedOrgName: string;
}

interface CycleResult {
  skipped: string | null;
  messagesListed: number;
  messagesProcessed: number;
  matched: number;
  ambiguous: number;
  noMatch: number;
}

class OAuthRefreshFailure extends Error {}

// --- Credential / client setup -------------------------------------------------

function hasCredentials(): boolean {
  return Boolean(
    process.env['GOOGLE_CLIENT_ID'] &&
      process.env['GOOGLE_CLIENT_SECRET'] &&
      process.env['GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN'],
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildGmailClient(): any {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const refreshToken = process.env['GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oauth = new (google.auth.OAuth2 as any)(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return google.gmail({ version: 'v1' as const, auth: oauth as any });
}

// --- Error classification ------------------------------------------------------

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function responseStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

function responseErrorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
}

function isOAuthRefreshFailure(err: unknown): boolean {
  const code = responseErrorCode(err);
  if (code && ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(code)) {
    return true;
  }
  const message = describeError(err).toLowerCase();
  return (
    message.includes('invalid_grant') ||
    message.includes('refresh token') ||
    message.includes('refresh_token')
  );
}

function isRetryableStatus(err: unknown): boolean {
  const status = responseStatus(err);
  return status === 429 || (status !== undefined && status >= 500 && status < 600);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logSystemError(
  supabase: SupabaseClient,
  params: { errorType: string; message: string; severity: 'error' | 'critical' },
): Promise<void> {
  try {
    await supabase.from('system_errors').insert({
      source: SOURCE,
      error_type: params.errorType,
      message: params.message,
      severity: params.severity,
    });
  } catch (err) {
    // Never let a failed audit-log write take down the poll cycle itself.
    console.error(`[${SOURCE}] Failed to write system_errors row:`, describeError(err));
  }
}

// --- Message parsing ------------------------------------------------------------

function b64urlDecode(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractBodyParts(
  payload: gmail_v1.Schema$MessagePart | null | undefined,
): { text: string | null; html: string | null } {
  if (!payload) return { text: null, html: null };

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return { text: b64urlDecode(payload.body.data), html: null };
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return { text: null, html: b64urlDecode(payload.body.data) };
  }

  let text: string | null = null;
  let html: string | null = null;

  for (const part of payload.parts ?? []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text ??= b64urlDecode(part.body.data);
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html ??= b64urlDecode(part.body.data);
    } else if (part.mimeType?.startsWith('multipart/')) {
      const nested = extractBodyParts(part);
      text ??= nested.text;
      html ??= nested.html;
    }
  }

  return { text, html };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string | null {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function emailDomainFromHeader(fromHeader: string | null): string | null {
  if (!fromHeader) return null;
  const match = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/(\S+@\S+)/);
  const address = (match?.[1] ?? fromHeader).trim();
  const at = address.lastIndexOf('@');
  if (at === -1) return null;
  return stripWww(address.slice(at + 1).toLowerCase().replace(/[>,]+$/, ''));
}

function stripWww(domain: string): string {
  return domain.startsWith('www.') ? domain.slice(4) : domain;
}

function domainFromPortalUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return stripWww(new URL(url).hostname.toLowerCase());
  } catch {
    try {
      return stripWww(new URL(`https://${url}`).hostname.toLowerCase());
    } catch {
      return null;
    }
  }
}

function isSubdomainOrEqual(fromDomain: string, portalDomain: string): boolean {
  return fromDomain === portalDomain || fromDomain.endsWith(`.${portalDomain}`);
}

function normalizeOrgName(name: string): string {
  let n = name.trim().toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ORG_SUFFIXES) {
      const escaped = suffix.replace('.', '\\.');
      const re = new RegExp(`[,\\s]+${escaped}$`, 'i');
      if (re.test(n)) {
        n = n.replace(re, '').trim();
        changed = true;
      }
    }
  }
  return n.replace(/\s+/g, ' ').trim();
}

function findMatches(
  fromDomain: string | null,
  subjectAndBody: string,
  candidates: MatchCandidate[],
): string[] {
  if (!fromDomain) return [];
  const haystack = subjectAndBody.toLowerCase();
  return candidates
    .filter((c) => c.portalDomain !== null && isSubdomainOrEqual(fromDomain, c.portalDomain))
    .filter((c) => c.normalizedOrgName.length >= ORG_NAME_MIN_LEN && haystack.includes(c.normalizedOrgName))
    .map((c) => c.submissionId);
}

// --- Confirmation-detail extraction (single Claude call, §10A step 4) ----------

interface ExtractedConfirmation {
  confirmationNumber: string | null;
  summary: string | null;
  loginCredentials: { username: string; password: string } | null;
}

const EMPTY_EXTRACTION: ExtractedConfirmation = {
  confirmationNumber: null,
  summary: null,
  loginCredentials: null,
};

async function extractConfirmationDetails(emailText: string): Promise<ExtractedConfirmation> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return EMPTY_EXTRACTION;

  try {
    const client = createTrackedAnthropic({ apiKey }, "confirmation-monitor");
    const response = await withClaudeLimit(() =>
      client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `This is a grant-application confirmation email. Extract the following. Return null for anything not present.

- confirmation_number: any confirmation number, reference ID, or tracking number
- summary: one short sentence summarizing the confirmation (status, next steps, deadlines mentioned)
- login_username: a portal login username or email explicitly given for future access, if present
- login_password: a portal login password or temporary password explicitly given, if present

Respond with JSON only, no markdown, no explanation:
{"confirmation_number": "<value or null>", "summary": "<value or null>", "login_username": "<value or null>", "login_password": "<value or null>"}

Email:
${emailText.slice(0, 6000)}`,
        },
      ],
      }),
    );

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return EMPTY_EXTRACTION;
    const parsed = JSON.parse(jsonMatch[0]) as {
      confirmation_number?: string | null;
      summary?: string | null;
      login_username?: string | null;
      login_password?: string | null;
    };

    const loginCredentials =
      parsed.login_username && parsed.login_password
        ? { username: parsed.login_username, password: parsed.login_password }
        : null;

    return {
      confirmationNumber: parsed.confirmation_number ?? null,
      summary: parsed.summary ?? null,
      loginCredentials,
    };
  } catch (err) {
    // Extraction failure never blocks the match itself (§10A step 4) — the
    // definitive signal is confirmation_email_received, not the number.
    console.error(`[${SOURCE}] Confirmation-detail extraction failed:`, describeError(err));
    return EMPTY_EXTRACTION;
  }
}

// --- Candidate loading ----------------------------------------------------------

async function loadCandidates(supabase: SupabaseClient): Promise<MatchCandidate[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('autoapply_submissions')
    .select(
      'id, organization_id, funder_id, submitted_at, funders(giving_portal_url), organizations(name)',
    )
    .gte('submitted_at', cutoff.toISOString())
    .lte('submitted_at', now.toISOString())
    .eq('confirmation_email_received', false);

  if (error) {
    console.error(`[${SOURCE}] loadCandidates query failed: ${causeOf(error)}`);
    throw new Error(withCause('Failed to load candidate submissions.', error));
  }
  if (!data) {
    return [];
  }

  type CandidateRow = {
    id: string;
    organization_id: string;
    funder_id: string;
    funders: { giving_portal_url: string | null } | { giving_portal_url: string | null }[] | null;
    organizations: { name: string } | { name: string }[] | null;
  };

  return (data as CandidateRow[])
    .map((row) => {
      const funder = Array.isArray(row.funders) ? row.funders[0] : row.funders;
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      const portalUrl = funder?.giving_portal_url ?? null;
      const portalDomain = domainFromPortalUrl(portalUrl);
      const normalizedOrgName = org?.name ? normalizeOrgName(org.name) : '';
      return {
        submissionId: row.id,
        organizationId: row.organization_id,
        funderId: row.funder_id,
        portalUrl,
        portalDomain,
        normalizedOrgName,
      };
    })
    .filter((c) => c.portalDomain !== null);
}

// --- Ledger bound ---------------------------------------------------------------

async function getAfterBoundUnixSeconds(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from('autoapply_confirmation_processed_messages')
    .select('processed_at')
    .order('processed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const maxProcessedAt = (data as { processed_at?: string } | null)?.processed_at;
  const defaultCutoff = Date.now() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // Small safety buffer so a message processed right at the boundary of a
  // prior cycle is never silently skipped by Gmail's second-precision filter.
  const BUFFER_MS = 60_000;

  const boundMs = maxProcessedAt ? new Date(maxProcessedAt).getTime() - BUFFER_MS : defaultCutoff;
  return Math.floor(boundMs / 1000);
}

// --- Core cycle body (retried as a whole on transient failure) -----------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function doGmailWork(supabase: SupabaseClient, gmail: any): Promise<CycleResult> {
  const afterSeconds = await getAfterBoundUnixSeconds(supabase);

  const messageIds: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${afterSeconds}`,
      maxResults: GMAIL_PAGE_SIZE,
      pageToken,
    });
    const ids = ((listRes.data.messages ?? []) as { id?: string }[])
      .map((m) => m.id)
      .filter((id: string | undefined): id is string => Boolean(id));
    messageIds.push(...ids);
    pageToken = listRes.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  if (messageIds.length === 0) {
    return { skipped: null, messagesListed: 0, messagesProcessed: 0, matched: 0, ambiguous: 0, noMatch: 0 };
  }

  // Idempotency: filter out ids already in the ledger BEFORE any matching
  // logic runs (§10A "Idempotency" section) — this also makes a retried
  // attempt naturally resume from where a prior, partially-failed attempt
  // left off, since messages it already ledgered are excluded here too.
  const { data: alreadyProcessed, error: ledgerErr } = await supabase
    .from('autoapply_confirmation_processed_messages')
    .select('gmail_message_id')
    .in('gmail_message_id', messageIds);

  if (ledgerErr) {
    throw new Error(`Failed to read processed-message ledger: ${ledgerErr.message}`);
  }

  const processedSet = new Set(
    ((alreadyProcessed ?? []) as { gmail_message_id: string }[]).map((r) => r.gmail_message_id),
  );
  const newIds = messageIds.filter((id) => !processedSet.has(id));

  if (newIds.length === 0) {
    return {
      skipped: null,
      messagesListed: messageIds.length,
      messagesProcessed: 0,
      matched: 0,
      ambiguous: 0,
      noMatch: 0,
    };
  }

  const candidates = await loadCandidates(supabase);

  let matched = 0;
  let ambiguous = 0;
  let noMatch = 0;

  for (const messageId of newIds) {
    const msgRes = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const headers = (msgRes.data.payload?.headers ?? []) as gmail_v1.Schema$MessagePartHeader[];
    const fromHeader = getHeader(headers, 'From');
    const subject = getHeader(headers, 'Subject') ?? '';
    const dateHeader = getHeader(headers, 'Date');

    const { text, html } = extractBodyParts(msgRes.data.payload);
    const bodyText = text ?? (html ? stripHtml(html) : '');
    const fromDomain = emailDomainFromHeader(fromHeader);

    const matchedIds = findMatches(fromDomain, `${subject} ${bodyText}`, candidates);

    const receivedAt = dateHeader
      ? new Date(dateHeader).toISOString()
      : msgRes.data.internalDate
        ? new Date(Number(msgRes.data.internalDate)).toISOString()
        : null;

    if (matchedIds.length === 0) {
      await supabase.from('autoapply_confirmation_processed_messages').insert({
        gmail_message_id: messageId,
        match_status: 'no_match',
      });
      noMatch++;
      continue;
    }

    if (matchedIds.length > 1) {
      await supabase.from('autoapply_confirmation_ambiguous_matches').insert({
        gmail_message_id: messageId,
        candidate_submission_ids: matchedIds,
        sender: fromHeader,
        subject,
        received_at: receivedAt,
        status: 'needs_manual_match',
      });
      await supabase.from('autoapply_confirmation_processed_messages').insert({
        gmail_message_id: messageId,
        match_status: 'ambiguous',
      });
      ambiguous++;
      continue;
    }

    // Exactly one match.
    const submissionId = matchedIds[0] as string;
    const candidate = candidates.find((c) => c.submissionId === submissionId);
    const { confirmationNumber, summary, loginCredentials } = await extractConfirmationDetails(
      `${subject}\n\n${bodyText}`,
    );

    const update: Record<string, unknown> = {
      confirmation_email_received: true,
      confirmation_received_at: new Date().toISOString(),
      confirmation_data: {
        source: 'email',
        gmail_message_id: messageId,
        from: fromHeader,
        subject,
        received_at: receivedAt,
        summary,
        credentials_extracted: loginCredentials !== null,
      },
    };
    if (confirmationNumber !== null) {
      update['confirmation_number'] = confirmationNumber;
    }

    await supabase.from('autoapply_submissions').update(update).eq('id', submissionId);

    if (loginCredentials && candidate?.portalUrl) {
      try {
        // Same AES-256-GCM store already used for autoapply's own portal
        // logins (funder_credentials) — reused here rather than inventing a
        // second credential store for the same secret shape.
        const credentialManager = new CredentialManager(
          supabase as unknown as ReturnType<typeof createClient<Database>>,
        );
        await credentialManager.storeCredentials({
          organizationId: candidate.organizationId,
          funderId: candidate.funderId,
          portalUrl: candidate.portalUrl,
          username: loginCredentials.username,
          password: loginCredentials.password,
        });
      } catch (err) {
        console.error(`[${SOURCE}] Failed to store extracted login credentials:`, describeError(err));
      }
    }

    await supabase.from('autoapply_confirmation_processed_messages').insert({
      gmail_message_id: messageId,
      match_status: 'matched',
      matched_submission_id: submissionId,
    });
    matched++;
  }

  return {
    skipped: null,
    messagesListed: messageIds.length,
    messagesProcessed: newIds.length,
    matched,
    ambiguous,
    noMatch,
  };
}

// --- Retry wrapper (§10A "Failure / backoff handling") --------------------------

async function runWithBackoff(supabase: SupabaseClient): Promise<CycleResult> {
  const gmail = buildGmailClient();
  let backoff = INITIAL_BACKOFF_MS;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await doGmailWork(supabase, gmail);
    } catch (err) {
      if (isOAuthRefreshFailure(err)) {
        await logSystemError(supabase, {
          errorType: 'oauth_refresh_failure',
          message: describeError(err),
          severity: 'critical',
        });
        throw new OAuthRefreshFailure(describeError(err));
      }

      lastErr = err;
      const retryable = isRetryableStatus(err);
      if (!retryable || attempt === MAX_RETRIES) {
        if (retryable) {
          await logSystemError(supabase, {
            errorType: 'gmail_api_retries_exhausted',
            message: describeError(err),
            severity: 'error',
          });
        }
        throw err;
      }

      await sleep(Math.min(backoff, MAX_BACKOFF_MS));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }

  throw lastErr;
}

// --- Public: single cycle (exported for tests / manual invocation) -------------

export async function runConfirmationMonitorCycle(supabase: SupabaseClient): Promise<CycleResult> {
  if (!hasCredentials()) {
    console.warn(
      `[${SOURCE}] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / ` +
        `GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a ` +
        `one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`,
    );
    return {
      skipped: 'missing_credentials',
      messagesListed: 0,
      messagesProcessed: 0,
      matched: 0,
      ambiguous: 0,
      noMatch: 0,
    };
  }

  try {
    const result = await runWithBackoff(supabase);
    if (result.messagesProcessed > 0) {
      console.log(
        `[${SOURCE}] Cycle complete — ${result.messagesProcessed}/${result.messagesListed} new ` +
          `(matched=${result.matched} ambiguous=${result.ambiguous} no_match=${result.noMatch})`,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof OAuthRefreshFailure) {
      // Already logged to system_errors inside runWithBackoff — never retried
      // silently forever, per §10A: a dead refresh token needs a human.
      return {
        skipped: 'oauth_refresh_failure',
        messagesListed: 0,
        messagesProcessed: 0,
        matched: 0,
        ambiguous: 0,
        noMatch: 0,
      };
    }
    console.error(`[${SOURCE}] Cycle failed:`, describeError(err));
    return {
      skipped: 'error',
      messagesListed: 0,
      messagesProcessed: 0,
      matched: 0,
      ambiguous: 0,
      noMatch: 0,
    };
  }
}

// --- Module-level start()/stop()/waitForIdle() (worker/index.ts calls these) ---
//
// Literal setInterval, not a continuous poll loop, per §10A: "every 5
// minutes, via setInterval inside the existing Railway worker process" —
// this is the one processor in worker/ that's fixed-cadence rather than
// claim-and-immediately-repoll (contrast worker/knowledge-indexer-processor.ts).

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let currentRun: Promise<void> | null = null;

async function tick(supabase: SupabaseClient): Promise<void> {
  if (currentRun) {
    console.warn(`[${SOURCE}] Previous cycle still running — skipping this tick.`);
    return;
  }
  currentRun = runConfirmationMonitorCycle(supabase)
    .then(() => undefined)
    .finally(() => {
      currentRun = null;
    });
  await currentRun;
}

export function start(supabase: SupabaseClient): void {
  if (intervalHandle) return;
  console.log(`[${SOURCE}] Starting — polling every ${POLL_INTERVAL_MS / 60_000} minute(s)`);
  void tick(supabase);
  intervalHandle = setInterval(() => {
    void tick(supabase);
  }, POLL_INTERVAL_MS);
}

export function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function waitForIdle(): Promise<void> {
  return currentRun ?? Promise.resolve();
}
