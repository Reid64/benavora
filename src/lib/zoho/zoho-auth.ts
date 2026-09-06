// Zoho Mail OAuth — token issuance, storage, and refresh for the AutoApply
// confirmation monitor's Zoho path (src/lib/autoapply/confirmation-monitor.ts).
// Mirrors src/lib/integrations/google/auth.ts's shape and conventions.
//
// STORAGE DEVIATION FROM THE ORIGINAL TASK SPEC — read before changing this:
// the task asked for the refresh token to be stored "via CredentialManager
// scoped to organization_id." That doesn't fit: CredentialManager
// (src/lib/autoapply/credential-manager.ts) writes to `funder_credentials`,
// whose schema is `UNIQUE(organization_id, funder_id)` with `funder_id uuid
// NOT NULL REFERENCES funders(id)` and a username+password shape (migration
// 050) — there is no funder or portal login involved in connecting a
// mailbox, so there's no real funder_id to key on, and a token pair isn't a
// username/password. The already-live, already-RLS-hardened `integrations`
// table (organization_id, provider, access_token, refresh_token,
// token_expires_at, connected_email, scopes — migration 002) is the actual
// existing mechanism for exactly this shape of credential; it's what
// src/lib/integrations/google/auth.ts already uses for the Gmail/Calendar
// integration. Reused here with provider = 'zoho' instead of inventing a
// second, schema-incompatible credential store.
//
// Endpoints and token-response shape below are taken from Zoho's own
// published API docs (zoho.com/mail/help/api/using-oauth-2.html), fetched
// live while building this — not guessed:
//   Authorize: GET  https://accounts.zoho.com/oauth/v2/auth
//   Token:     POST https://accounts.zoho.com/oauth/v2/token  (both the
//              authorization_code exchange and the refresh_token grant use
//              this same endpoint)
// Region caveat, flagged rather than assumed: accounts.zoho.com is the
// global/US data-center host. If the connecting Zoho account lives on a
// different DC (accounts.zoho.eu / .in / .com.cn / .jp / .com.au), token
// calls must go to that DC's accounts host instead — not something knowable
// from this codebase, and not handled here.

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export const ZOHO_PROVIDER = "zoho";

// Exactly the scopes the task specified — comma-separated per Zoho's scope
// format (Servicename.scopename.Operation), joined with "," in the auth URL.
export const ZOHO_SCOPES = [
  "ZohoMail.messages.READ",
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
];

const ZOHO_ACCOUNTS_HOST = "https://accounts.zoho.com";
/** Refresh slightly before true expiry so in-flight calls don't race the clock. */
const EXPIRY_SKEW_MS = 60_000;

export interface ZohoConnection {
  connected: boolean;
  email: string | null;
}

export interface ZohoCallbackResult {
  organizationId: string;
  email: string | null;
}

interface StoredZohoCredentials {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
  connectedEmail: string | null;
}

interface ZohoTokenResponse {
  access_token?: string;
  refresh_token?: string;
  api_domain?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

// --- env ----------------------------------------------------------------

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

// --- state (CSRF + org binding) ------------------------------------------
//
// Same base64url + HMAC-SHA256 "payload.mac" scheme as
// src/lib/integrations/google/oauth-state.ts, but keyed on ZOHO_CLIENT_SECRET
// — that helper hardcodes GOOGLE_CLIENT_SECRET as its signing key, so it
// can't be reused directly without threading a secret through it. Small
// enough (~20 lines) to duplicate locally rather than refactor a shared
// helper that's only ever been used by one provider.

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function stateSecret(): string {
  return requiredEnv("ZOHO_CLIENT_SECRET");
}

function signState(organizationId: string): string {
  const encodedPayload = b64url(organizationId);
  const mac = b64url(
    crypto.createHmac("sha256", stateSecret()).update(encodedPayload).digest(),
  );
  return `${encodedPayload}.${mac}`;
}

/** Verify a "payload.mac" state token and return the embedded organizationId, or null. */
export function verifyState(state: string): string | null {
  const dotIndex = state.indexOf(".");
  if (dotIndex === -1) return null;
  const encodedPayload = state.slice(0, dotIndex);
  const mac = state.slice(dotIndex + 1);
  if (!encodedPayload || !mac) return null;

  const expected = b64url(
    crypto.createHmac("sha256", stateSecret()).update(encodedPayload).digest(),
  );
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

// --- token encryption (AES-256-GCM) ---------------------------------------
//
// Identical scheme and the SAME INTEGRATION_ENCRYPTION_KEY as
// src/lib/integrations/google/auth.ts — one key for every OAuth token in the
// `integrations` table regardless of provider. That key is required (no
// fallback) and is already set in Vercel production (verified 2026-09-03).

const ENC_PREFIX = "v1";

function encryptionKey(): Buffer {
  const material = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!material) {
    throw new Error(
      "Missing required env var: INTEGRATION_ENCRYPTION_KEY. Encryption cannot proceed without it.",
    );
  }
  return crypto.scryptSync(material, "benavora.integration.v1", 32);
}

function encrypt(plaintext: string | null): string | null {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function decrypt(value: string | null): string | null {
  if (value == null) return null;
  const parts = value.split(":");
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

// --- persistence ------------------------------------------------------------

function adminClient(): SupabaseClient {
  return createAdminClient();
}

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
    provider: ZOHO_PROVIDER,
    access_token: encrypt(tokens.accessToken),
    token_expires_at: tokens.expiresAt,
    is_active: true,
    updated_at: nowIso,
  };
  // Zoho omits refresh_token on a plain refresh-grant response — never
  // clobber a good stored refresh token with null.
  if (tokens.refreshToken) row.refresh_token = encrypt(tokens.refreshToken);
  if (tokens.connectedEmail !== undefined) row.connected_email = tokens.connectedEmail;
  if (tokens.scopes !== undefined) row.scopes = tokens.scopes;

  const { error } = await client
    .from("integrations")
    .upsert(row, { onConflict: "organization_id,provider" });
  if (error) throw new Error(`Failed to persist Zoho tokens: ${error.message}`);
}

async function loadCredentials(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<StoredZohoCredentials | null> {
  const { data } = await client
    .from("integrations")
    .select("access_token, refresh_token, token_expires_at, connected_email, is_active")
    .eq("organization_id", organizationId)
    .eq("provider", ZOHO_PROVIDER)
    .maybeSingle();

  if (!data || data.is_active === false) return null;
  return {
    accessToken: decrypt(data.access_token as string | null),
    refreshToken: decrypt(data.refresh_token as string | null),
    expiresAt: (data.token_expires_at as string | null) ?? null,
    connectedEmail: (data.connected_email as string | null) ?? null,
  };
}

// --- Zoho token-endpoint calls -----------------------------------------------

/** Shape callers of confirmation-monitor.ts's existing error classifiers expect. */
function zohoOAuthError(status: number, body: ZohoTokenResponse): Error & {
  response: { status: number; data: { error?: string } };
} {
  const message = body.error ?? `Zoho token request failed (HTTP ${status})`;
  const err = new Error(message) as Error & {
    response: { status: number; data: { error?: string } };
  };
  err.response = { status, data: { error: body.error } };
  return err;
}

async function postToken(body: URLSearchParams): Promise<ZohoTokenResponse> {
  const res = await fetch(`${ZOHO_ACCOUNTS_HOST}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  let json: ZohoTokenResponse;
  try {
    json = (await res.json()) as ZohoTokenResponse;
  } catch {
    json = {};
  }
  if (!res.ok || json.error || !json.access_token) {
    throw zohoOAuthError(res.status, json);
  }
  return json;
}

// --- public API ---------------------------------------------------------------

/** Build the Zoho consent URL for an organization (offline access, forces consent). */
export function getAuthUrl(organizationId: string): string {
  const clientId = requiredEnv("ZOHO_CLIENT_ID");
  const redirectUri = requiredEnv("ZOHO_REDIRECT_URI");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: ZOHO_SCOPES.join(","),
    access_type: "offline",
    prompt: "consent",
    state: signState(organizationId),
  });
  return `${ZOHO_ACCOUNTS_HOST}/oauth/v2/auth?${params.toString()}`;
}

/**
 * Handle the OAuth callback: verify state, exchange the code for tokens,
 * best-effort read the connected mailbox address, and persist everything.
 * Returns the organization the state was bound to plus the connected email.
 * The caller MUST verify this organization matches the authenticated session
 * before trusting it (Contracts §2), same as the Google callback route does.
 */
export async function handleCallback(
  code: string,
  state: string,
  client: SupabaseClient = adminClient(),
): Promise<ZohoCallbackResult> {
  const organizationId = verifyState(state);
  if (!organizationId) throw new Error("Invalid OAuth state.");

  const clientId = requiredEnv("ZOHO_CLIENT_ID");
  const clientSecret = requiredEnv("ZOHO_CLIENT_SECRET");
  const redirectUri = requiredEnv("ZOHO_REDIRECT_URI");

  const tokens = await postToken(
    new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  );

  // Best-effort: read the connected mailbox's primary address via
  // GET /api/accounts so getConnection() has something to show. A failure
  // here must never fail the whole connect flow — the tokens are already
  // good, and zoho-mail-client.ts re-resolves the account by email lazily
  // on first real use anyway.
  let connectedEmail: string | null = null;
  try {
    const res = await fetch("https://mail.zoho.com/api/accounts", {
      headers: {
        Authorization: `Zoho-oauthtoken ${tokens.access_token}`,
        Accept: "application/json",
      },
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: { primaryEmailAddress?: string }[];
      };
      connectedEmail = json.data?.[0]?.primaryEmailAddress ?? null;
    }
  } catch {
    connectedEmail = null;
  }

  await persistTokens(
    organizationId,
    {
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      connectedEmail,
      scopes: tokens.scope ? tokens.scope.split(",") : ZOHO_SCOPES,
    },
    client,
  );

  return { organizationId, email: connectedEmail };
}

/**
 * Refresh the org's access token from its stored refresh token, persist the
 * new access token + expiry, and return the fresh access token. Throws if
 * the org has no refresh token on file (must (re)connect via /api/zoho/auth).
 */
export async function refreshAccessToken(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<string> {
  const creds = await loadCredentials(organizationId, client);
  if (!creds?.refreshToken) {
    throw new Error("Zoho Mail is not connected for this organization.");
  }

  const clientId = requiredEnv("ZOHO_CLIENT_ID");
  const clientSecret = requiredEnv("ZOHO_CLIENT_SECRET");

  const tokens = await postToken(
    new URLSearchParams({
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  );

  await persistTokens(
    organizationId,
    {
      accessToken: tokens.access_token ?? null,
      // Zoho does not return a new refresh_token on a refresh-grant response;
      // persistTokens leaves the stored one intact when this is null.
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
    },
    client,
  );

  return tokens.access_token as string;
}

/**
 * Return a valid access token for the organization's Zoho Mail connection,
 * refreshing first if the stored one is missing or near expiry. Throws if
 * the org has not connected Zoho.
 */
export async function getAuthorizedAccessToken(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<string> {
  const creds = await loadCredentials(organizationId, client);
  if (!creds?.refreshToken) {
    throw new Error("Zoho Mail is not connected for this organization.");
  }

  const expiresAtMs = creds.expiresAt ? new Date(creds.expiresAt).getTime() : 0;
  if (creds.accessToken && expiresAtMs - Date.now() > EXPIRY_SKEW_MS) {
    return creds.accessToken;
  }
  return refreshAccessToken(organizationId, client);
}

/** True if the organization has an active Zoho Mail connection with a refresh token on file. */
export async function isConnected(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<boolean> {
  const creds = await loadCredentials(organizationId, client);
  return Boolean(creds?.refreshToken);
}

/** Read the connected mailbox address for the org's Zoho integration, if any. */
export async function getConnection(
  organizationId: string,
  client: SupabaseClient = adminClient(),
): Promise<ZohoConnection> {
  const creds = await loadCredentials(organizationId, client);
  return {
    connected: Boolean(creds?.refreshToken),
    email: creds?.refreshToken ? creds.connectedEmail : null,
  };
}

/**
 * Every organization_id with an active Zoho Mail connection — used by
 * confirmation-monitor.ts to know which orgs' inboxes to poll each cycle
 * (the Zoho path is per-org, unlike the Gmail path's single shared inbox).
 */
export async function listConnectedOrganizations(
  client: SupabaseClient = adminClient(),
): Promise<{ organizationId: string; connectedEmail: string | null }[]> {
  const { data, error } = await client
    .from("integrations")
    .select("organization_id, connected_email, refresh_token")
    .eq("provider", ZOHO_PROVIDER)
    .eq("is_active", true)
    .not("refresh_token", "is", null);

  if (error) throw new Error(`Failed to list Zoho-connected organizations: ${error.message}`);

  return ((data ?? []) as { organization_id: string; connected_email: string | null }[]).map(
    (row) => ({ organizationId: row.organization_id, connectedEmail: row.connected_email }),
  );
}
