// Google Calendar OAuth 2.0 integration — mirrors GmailAuthManager for calendar scopes.
//
// SERVER-ONLY. Stores per-user tokens in the `calendar_connections` table
// (migration 054). Tokens are AES-256-GCM encrypted via encryptToken before
// persistence. The state parameter encodes { orgId, userId } signed with
// GOOGLE_CLIENT_SECRET so forged callbacks are rejected.
//
// Can share the same Google OAuth client ID/secret as Gmail — Google presents
// a single consent screen when the user has already granted Gmail access.
//
// as any casts on google.auth.OAuth2() are load-bearing: the pinned
// google-auth-library version (10.7.0) diverges from the copy bundled inside
// googleapis, making the types incompatible. Removing the casts breaks the build.

import crypto from "crypto";

import { google } from "googleapis";

import { createAdminClient } from "@/lib/supabase/admin";

import { decryptToken, encryptToken } from "@/lib/email/encryption";

const GCAL_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

const EXPIRY_SKEW_MS = 60_000;

export interface CalendarTokenResult {
  connectionId: string;
  calendarName: string;
  organizationId: string;
  userId: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function stateSecret(): string {
  const s = process.env.GOOGLE_CLIENT_SECRET;
  if (!s) throw new Error("Missing GOOGLE_CLIENT_SECRET");
  return s;
}

export class GCalAuthManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildOAuthClient(redirectUri: string): any {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (google.auth.OAuth2 as any)(clientId, clientSecret, redirectUri);
  }

  generateAuthUrl(orgId: string, userId: string, redirectUri: string): string {
    const oauth = this.buildOAuthClient(redirectUri);
    const payload = b64url(JSON.stringify({ orgId, userId }));
    const mac = b64url(
      crypto.createHmac("sha256", stateSecret()).update(payload).digest(),
    );
    const state = `${payload}.${mac}`;
    return oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GCAL_SCOPES,
      state,
    }) as string;
  }

  private verifyState(
    state: string,
  ): { orgId: string; userId: string } | null {
    const dotIndex = state.lastIndexOf(".");
    if (dotIndex === -1) return null;
    const payload = state.slice(0, dotIndex);
    const mac = state.slice(dotIndex + 1);
    const expected = b64url(
      crypto.createHmac("sha256", stateSecret()).update(payload).digest(),
    );
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      return JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as { orgId: string; userId: string };
    } catch {
      return null;
    }
  }

  async handleCallback(
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<CalendarTokenResult> {
    const decoded = this.verifyState(state);
    if (!decoded) throw new Error("Invalid OAuth state");
    const { orgId, userId } = decoded;

    const oauth = this.buildOAuthClient(redirectUri);
    const { tokens } = (await oauth.getToken(code)) as {
      tokens: {
        access_token?: string | null;
        refresh_token?: string | null;
        expiry_date?: number | null;
        scope?: string;
      };
    };
    oauth.setCredentials(tokens);

    let calendarName = "Primary";
    try {
      const calendar = google.calendar({
        version: "v3" as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        auth: oauth as any,
      });
      const cal = await calendar.calendarList.get({ calendarId: "primary" });
      calendarName = cal.data.summary ?? "Primary";
    } catch {
      calendarName = "Primary";
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("calendar_connections")
      .upsert(
        {
          organization_id: orgId,
          user_id: userId,
          provider: "google",
          calendar_id: "primary",
          calendar_name: calendarName,
          access_token_encrypted: tokens.access_token
            ? encryptToken(tokens.access_token)
            : null,
          refresh_token_encrypted: tokens.refresh_token
            ? encryptToken(tokens.refresh_token)
            : null,
          token_expires_at: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,
          sync_status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,user_id,calendar_id" },
      )
      .select("id")
      .single();

    if (error || !data) throw new Error("Failed to store calendar connection");

    return {
      connectionId: (data as { id: string }).id,
      calendarName,
      organizationId: orgId,
      userId,
    };
  }

  async refreshToken(connectionId: string): Promise<string> {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("calendar_connections")
      .select(
        "access_token_encrypted, refresh_token_encrypted, token_expires_at",
      )
      .eq("id", connectionId)
      .single();

    if (error || !data) throw new Error("Connection not found");

    const row = data as {
      access_token_encrypted: string | null;
      refresh_token_encrypted: string | null;
      token_expires_at: string | null;
    };

    const expiresAt = row.token_expires_at
      ? new Date(row.token_expires_at).getTime()
      : 0;
    const accessToken = row.access_token_encrypted
      ? decryptToken(row.access_token_encrypted)
      : null;

    if (accessToken && expiresAt - Date.now() > EXPIRY_SKEW_MS) {
      return accessToken;
    }

    if (!row.refresh_token_encrypted) {
      throw new Error("No refresh token stored for this connection");
    }
    const refreshToken = decryptToken(row.refresh_token_encrypted);

    const oauth = this.buildOAuthClient("urn:ietf:wg:oauth:2.0:oob");
    oauth.setCredentials({ refresh_token: refreshToken });
    const { credentials } = (await oauth.refreshAccessToken()) as {
      credentials: {
        access_token?: string | null;
        expiry_date?: number | null;
      };
    };

    if (!credentials.access_token) {
      throw new Error("Google did not return a new access token");
    }

    await supabase
      .from("calendar_connections")
      .update({
        access_token_encrypted: encryptToken(credentials.access_token),
        token_expires_at: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    return credentials.access_token;
  }

  async revokeConnection(connectionId: string): Promise<void> {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("calendar_connections")
      .select("access_token_encrypted, refresh_token_encrypted")
      .eq("id", connectionId)
      .single();

    if (data) {
      const row = data as {
        access_token_encrypted: string | null;
        refresh_token_encrypted: string | null;
      };
      const encryptedToken =
        row.refresh_token_encrypted ?? row.access_token_encrypted;
      if (encryptedToken) {
        try {
          const plaintext = decryptToken(encryptedToken);
          const oauth = this.buildOAuthClient("urn:ietf:wg:oauth:2.0:oob");
          await oauth.revokeToken(plaintext);
        } catch {
          // Best-effort — proceed with local cleanup regardless.
        }
      }
    }

    await supabase
      .from("calendar_connections")
      .update({
        sync_status: "disconnected",
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);
  }
}
