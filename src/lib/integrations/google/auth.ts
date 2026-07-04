// Google OAuth - token issuance, storage, and refresh (BLUEPRINT Phase 4,
// BEHAVIORAL_CONTRACTS Â§19 "Email Integration").
//
// SERVER-ONLY. Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI
// (never exposed to the client) and persists per-organization OAuth tokens to the
// `integrations` table (provider = 'google'). Refresh tokens are encrypted at
// rest (Contracts Â§19: "OAuth tokens stored encrypted") with AES-256-GCM; the
// access token is encrypted the same way for defense in depth.
//
// Tenant scope: every read/write here is explicitly filtered by organization_id.
// Token persistence uses the service-role admin client - writing OAuth secrets is
// a privileged server operation analogous to agent writes, and it sidesteps RLS
// edge cases on upsert. The organization is always supplied by the caller (the
// route derives it from the session, never from a request body - Contracts Â§2).
//
// PREREQUISITES (manual, Google Cloud Console):
//   - Project with Gmail API + Google Calendar API enabled
//   - OAuth 2.0 "Web application" credentials
//   - Authorized redirect URI: {app}/api/integrations/google/callback
//   - Scopes: gmail.readonly, gmail.send, gmail.modify, calendar.events

import crypto from "crypto";

import { google, type Auth } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/** Provider key used for the `integrations.provider` column. */
export const GOOGLE_PROVIDER = "google";

/**
 * OAuth scopes requested for Phase 4 (Gmail sync/send + Calendar events).
 * Note: no `userinfo.email` scope - the connected address is read from Gmail's
 * users.getProfile after consent instead (works under gmail.readonly).
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
];

/** Refresh slightly before true expiry so in-flight calls don't race the clock. */
const EXPIRY_SKEW_MS = 60_000;

export interface GoogleConnection {
  connected: boolean;
  email: string | null;
}

export interface CallbackResult {
  organizationId: string;
  email: string | null;
}

/** Raw, decrypted credentials for one organization's Google integration. */
interface StoredCredentials {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
}

// --- env / client construction ----------------------------------------------

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** Build a credential-less OAuth2 client from the configured env vars. */
export function getOAuthClient(): Auth.OAuth2Client {
  return new google.auth.OAuth2(
    requiredEnv("GOOGLE_CLIENT_ID"),
    requiredEnv("GOOGLE_CLIENT_SECRET"),
    requiredEnv("GOOGLE_REDIRECT_URI"),
// eslint-disable-next-line @typescript-eslint/no-explicit-any

  ) as any;
}

// --- state (CSRF + org binding) ----------------------------------------------
//
// state = base64url(organizationId) + "." + HMAC-SHA256(payload, secret). The
// HMAC is keyed on GOOGLE_CLIENT_SECRET (always present when OAuth is configured),
// so a forged/tampered state is rejected. The callback route still cross-checks
// the decoded org against the session org before trusting it (Contracts Â§2).

function stateSecret(): string {
  return requiredEnv("GOOGLE_CLIENT_SECRET");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signState(organizationId: string): string {
  const payload = b64url(organizationId);
  const mac = b64url(
    crypto.createHmac("sha256", stateSecret()).update(payload).digest(),
  );
  return `${payload}.${mac}`;
}

/** Verify a state token's HMAC and return the embedded organizationId, or null. */
export function verifyState(state: string): string | null {
  const [payload, mac] = state.split(".");
  if (!payload || !mac) return null;
  const expected = b64url(
    crypto.createHmac("sha256", stateSecret()).update(payload).digest(),
  );
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return null;
  }
}

// --- token encryption (AES-256-GCM) ------------------------------------------
//
// Key material: INTEGRATION_ENCRYPTION_KEY, required (Contracts Â§19 mandates
// encryption at rest) — there is no fallback key, so encrypt/decrypt throw
// immediately if it's missing. Format:
//   "v1:" + ivHex + ":" + authTagHex + ":" + cipherHex

const ENC_PREFIX = "v1";

function encryptionKey(): Buffer {
  const material = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!material) {
    throw new Error(
      "Missing required env var: INTEGRATION_ENCRYPTION_KEY. Encryption cannot proceed without it.",
    );
  }
  // Fixed salt: the key only needs to be stable across processes, not unique.
  return crypto.scryptSync(material, "benavora.integration.v1", 32);
}

function encrypt(plaintext: string | null): string | null {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString(
    "hex",
  )}`;
}

function decrypt(value: string | null): string | null {
  if (value == null) return null;
  const parts = value.split(":");
  // Tolerate a legacy/plaintext value (e.g. seeded manually) by returning it
  // unchanged rather than throwing.
  if (parts.length !== 4 || parts[0] !== ENC_PREFIX) return value;
  const [, ivHex, tagHex, dataHex] = parts;
  if (!ivHex || !tagHex || !dataHex) return value;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

// --- persistence -------------------------------------------------------------

function adminClient(): SupabaseClient {
  return createAdminClient();
}

/** Upsert the org's Google tokens, encrypting access + refresh at rest. */
async function persistTokens(
  organizationId: string,
  tokens: {
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: string | null;
    connectedEmail?: string | null;
    scopes?: string[] | null;
  },
  client: SupabaseClient = adminClient(),
): Promise<void> {
  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = {
    organization_id: organizationId,
    provider: GOOGLE_PROVIDER,
    access_token: encrypt(tokens.accessToken),
    token_expires_at: tokens.expiresAt,
    is_active: true,
    updated_at: nowIso,
  };
  // Only overwrite the refresh token when Google returns one (it omits it on
  // refreshes and on re-consents that reuse the prior grant). Never clobber a
  // good stored refresh token with null.
  if (tokens.refreshToken) row.refresh_token = encrypt(tokens.refreshToken);
  if (tokens.connectedEmail !== undefined) {
    row.connected_email = tokens.connectedEmail;
  }
  if (tokens.scopes !== undefined) row.scopes = tokens.scopes;

  await client
    .from("integrations")
    .upsert(row, { onConflict: "organization_id,provider" });
}

/** Load and decrypt the org's stored Google credentials, or null if none. */
async function loadCredentials(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<StoredCredentials | null> {
  const { data } = await client
    .from("integrations")
    .select("access_token, refresh_token, token_expires_at, is_active")
    .eq("organization_id", organizationId)
    .eq("provider", GOOGLE_PROVIDER)
    .maybeSingle();

  if (!data || data.is_active === false) return null;
  return {
    accessToken: decrypt(data.access_token as string | null),
    refreshToken: decrypt(data.refresh_token as string | null),
    expiresAt: (data.token_expires_at as string | null) ?? null,
  };
}

// --- public API --------------------------------------------------------------

/**
 * Build the Google consent URL for an organization. Requests offline access
 * (so we receive a refresh token) and forces the consent screen so a refresh
 * token is returned even on re-connect.
 */
export function getAuthUrl(organizationId: string): string {
  const oauth = getOAuthClient();
  return oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state: signState(organizationId),
  });
}

/**
 * Handle the OAuth callback: verify state, exchange the code for tokens, read
 * the connected Gmail address, and persist everything. Returns the organization
 * the state was bound to plus the connected email. The caller MUST verify this
 * organization matches the authenticated session before trusting it.
 */
export async function handleCallback(
  code: string,
  state: string,
  client: SupabaseClient = adminClient(),
): Promise<CallbackResult> {
  const organizationId = verifyState(state);
  if (!organizationId) {
    throw new Error("Invalid OAuth state.");
  }

  const oauth = getOAuthClient();
  const { tokens } = await oauth.getToken(code);
  oauth.setCredentials(tokens);

  // The granted scopes don't include userinfo.email; read the address from
  // Gmail's profile instead (available under gmail.readonly).
  let connectedEmail: string | null = null;
  try {
// eslint-disable-next-line @typescript-eslint/no-explicit-any

    const gmail = google.gmail({ version: "v1" as const, auth: oauth as any });
    const profile = await gmail.users.getProfile({ userId: "me" });
    connectedEmail = profile.data.emailAddress ?? null;
  } catch {
    connectedEmail = null;
  }

  await persistTokens(
    organizationId,
    {
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      connectedEmail,
      scopes: tokens.scope ? tokens.scope.split(" ") : GOOGLE_SCOPES,
    },
    client,
  );

  return { organizationId, email: connectedEmail };
}

/**
 * Refresh the org's access token from its stored refresh token, persist the new
 * access token + expiry, and return the fresh access token. Throws if the org
 * has no refresh token on file (the user must (re)connect).
 */
export async function refreshAccessToken(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<string> {
  const creds = await loadCredentials(organizationId, client);
  if (!creds?.refreshToken) {
    throw new Error("Google is not connected for this organization.");
  }

  const oauth = getOAuthClient();
  oauth.setCredentials({ refresh_token: creds.refreshToken });
  const { credentials } = await oauth.refreshAccessToken();

  await persistTokens(
    organizationId,
    {
      accessToken: credentials.access_token ?? null,
      // Google does not return a new refresh token on refresh; persistTokens
      // leaves the stored one intact when this is null.
      refreshToken: credentials.refresh_token ?? null,
      expiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : null,
    },
    client,
  );

  if (!credentials.access_token) {
    throw new Error("Google did not return an access token.");
  }
  return credentials.access_token;
}

/**
 * Return an OAuth2 client with valid credentials for the organization, ready to
 * pass to googleapis service constructors. Auto-refreshes a stale access token
 * and persists any tokens Google rotates mid-flight (via the 'tokens' event).
 * Throws if the org has not connected Google.
 */
export async function getAuthorizedClient(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<Auth.OAuth2Client> {
  const creds = await loadCredentials(organizationId, client);
  if (!creds?.refreshToken && !creds?.accessToken) {
    throw new Error("Google is not connected for this organization.");
  }

  const oauth = getOAuthClient();
  oauth.setCredentials({
    access_token: creds.accessToken ?? undefined,
    refresh_token: creds.refreshToken ?? undefined,
    expiry_date: creds.expiresAt ? new Date(creds.expiresAt).getTime() : undefined,
  });

  // Persist tokens the library rotates while making API calls.
  oauth.on("tokens", (rotated) => {
    void persistTokens(
      organizationId,
      {
        accessToken: rotated.access_token ?? null,
        refreshToken: rotated.refresh_token ?? null,
        expiresAt: rotated.expiry_date
          ? new Date(rotated.expiry_date).toISOString()
          : null,
      },
      client,
    );
  });

  // Proactively refresh if the stored access token is missing or near expiry,
  // so the first API call doesn't fail on an expired token.
  const expiresAtMs = creds.expiresAt ? new Date(creds.expiresAt).getTime() : 0;
  if (!creds.accessToken || expiresAtMs - Date.now() < EXPIRY_SKEW_MS) {
    const fresh = await refreshAccessToken(organizationId, client);
    oauth.setCredentials({
      ...oauth.credentials,
      access_token: fresh,
    });
  }

  return oauth;
}

/** True if the organization has an active Google integration with a usable token. */
export async function isConnected(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<boolean> {
  const creds = await loadCredentials(organizationId, client);
  return Boolean(creds && (creds.refreshToken || creds.accessToken));
}

/** Read the connected Gmail address for the org's Google integration, if any. */
export async function getConnection(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<GoogleConnection> {
  const { data } = await client
    .from("integrations")
    .select("connected_email, refresh_token, access_token, is_active")
    .eq("organization_id", organizationId)
    .eq("provider", GOOGLE_PROVIDER)
    .maybeSingle();

  const connected = Boolean(
    data &&
      data.is_active !== false &&
      (data.refresh_token || data.access_token),
  );
  return {
    connected,
    email: connected ? ((data?.connected_email as string | null) ?? null) : null,
  };
}

