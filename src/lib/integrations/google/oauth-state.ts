// Shared HMAC-signed OAuth state helpers for Google integrations.
//
// Two independent Google OAuth flows exist in this codebase and are NOT
// duplicates of each other, despite both talking to Google Calendar:
//   - src/lib/integrations/google/auth.ts — one shared connection PER
//     ORGANIZATION (stored in the `integrations` table), driving both Gmail
//     sync and Calendar sync from a single grant.
//   - src/lib/calendar/gcal-auth.ts — a separate, calendar-only connection
//     PER USER (stored in `calendar_connections`, migration 054), so each
//     team member can connect their own calendar independently.
// Collapsing these into one flow would remove the per-user capability the
// second one exists for, so they keep their own token storage and lifecycle.
// What they DID duplicate — byte-for-byte identical base64url encoding and
// HMAC-SHA256 state sign/verify logic, both keyed on GOOGLE_CLIENT_SECRET — is
// consolidated here so there's exactly one implementation of that primitive.

import crypto from "crypto";

function stateSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("Missing GOOGLE_CLIENT_SECRET");
  return secret;
}

export function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Sign an arbitrary string payload into a "payload.mac" OAuth state token. */
export function signOAuthStatePayload(payload: string): string {
  const encodedPayload = b64url(payload);
  const mac = b64url(
    crypto.createHmac("sha256", stateSecret()).update(encodedPayload).digest(),
  );
  return `${encodedPayload}.${mac}`;
}

/**
 * Verify a "payload.mac" OAuth state token (constant-time MAC comparison) and
 * return the decoded payload, or null if the token is missing/malformed/forged.
 */
export function verifyOAuthStatePayload(state: string): string | null {
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
