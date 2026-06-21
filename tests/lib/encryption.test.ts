import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken } from "@/lib/email/encryption";

const TEST_KEY = "test-encryption-key-for-vitest-suite";

beforeEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
});

describe("encryptToken / decryptToken", () => {
  it("round-trips plaintext through encrypt then decrypt", () => {
    const plaintext = "super-secret-api-key-12345";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("encrypted output differs from plaintext", () => {
    const plaintext = "api-key-value";
    const encrypted = encryptToken(plaintext);
    expect(encrypted).not.toBe(plaintext);
  });

  it("encrypted output has the expected v1 prefix format", () => {
    const encrypted = encryptToken("value");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("two encryptions of the same plaintext produce different ciphertexts (random IV)", () => {
    const plaintext = "same-value";
    expect(encryptToken(plaintext)).not.toBe(encryptToken(plaintext));
  });

  it("decryptToken with wrong key throws an authentication error", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "correct-key";
    const encrypted = encryptToken("secret-data");

    process.env.CREDENTIAL_ENCRYPTION_KEY = "wrong-key-entirely-different";
    expect(() => decryptToken(encrypted)).toThrow();
  });

  it("decryptToken passes through a non-v1 string unchanged", () => {
    const passthrough = "plain-unencrypted-value";
    expect(decryptToken(passthrough)).toBe(passthrough);
  });
});
