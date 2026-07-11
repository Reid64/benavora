"use strict";
// Server-only — AES-256-GCM encryption for client-supplied API keys.
// NEVER import from Client Components.
//
// Requires INTEGRATION_KEY_SECRET env var (32+ characters in production).
// Shorter secrets are padded; the env var must be set — there is no fallback
// key, so encrypt/decrypt throw immediately if it's missing.
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptKey = encryptKey;
exports.decryptKey = decryptKey;
exports.maskKey = maskKey;
const crypto_1 = require("crypto");
const ALGORITHM = "aes-256-gcm";
function getKeyBuf() {
    const secret = process.env.INTEGRATION_KEY_SECRET;
    if (!secret) {
        throw new Error("Missing required env var: INTEGRATION_KEY_SECRET. Encryption cannot proceed without it.");
    }
    // AES-256 needs exactly 32 bytes. Pad with NUL or truncate.
    return Buffer.from(secret.padEnd(32, "\0").slice(0, 32));
}
/**
 * Encrypt `plaintext` and return a base64-encoded blob.
 * Layout: [12-byte IV] [16-byte GCM tag] [ciphertext].
 */
function encryptKey(plaintext) {
    const iv = (0, crypto_1.randomBytes)(12);
    const cipher = (0, crypto_1.createCipheriv)(ALGORITHM, getKeyBuf(), iv);
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
function decryptKey(ciphertext) {
    const buf = Buffer.from(ciphertext, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = (0, crypto_1.createDecipheriv)(ALGORITHM, getKeyBuf(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
/** `****{last4}` — safe for display, reveals only the final 4 characters. */
function maskKey(plaintext) {
    return `****${plaintext.slice(-4) || "xxxx"}`;
}
