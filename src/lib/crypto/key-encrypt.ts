// Server-only — AES-256-GCM encryption for client-supplied API keys.
// NEVER import from Client Components.
//
// Requires INTEGRATION_KEY_SECRET env var (32+ characters in production).
// Shorter secrets are padded; missing secret falls back to zeros (insecure —
// always set the env var in deployed environments).

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKeyBuf(): Buffer {
  const secret = process.env.INTEGRATION_KEY_SECRET ?? "";
  // AES-256 needs exactly 32 bytes. Pad with NUL or truncate.
  return Buffer.from(secret.padEnd(32, "\0").slice(0, 32));
}

/**
 * Encrypt `plaintext` and return a base64-encoded blob.
 * Layout: [12-byte IV] [16-byte GCM tag] [ciphertext].
 */
export function encryptKey(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKeyBuf(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypt a blob produced by `encryptKey`. Throws on auth-tag mismatch
 * (tampered data or wrong secret).
 */
export function decryptKey(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, getKeyBuf(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

/** `****{last4}` — safe for display, reveals only the final 4 characters. */
export function maskKey(plaintext: string): string {
  return `****${plaintext.slice(-4) || "xxxx"}`;
}
