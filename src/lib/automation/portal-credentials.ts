// Portal credential manager - Phase 3 browser automation.
//
// Stores encrypted portal login credentials per funder in the platform_config
// table under key `portal.{funder_id}.credentials`. Uses AES-256-GCM with a
// per-org key derived from PORTAL_ENCRYPT_SECRET (env) + organizationId via
// PBKDF2-SHA256 so every org's ciphertext is unique and independently keyed.
//
// SERVER-ONLY - depends on Node.js `crypto`. Never import from client components.

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// --- public types ------------------------------------------------------------

export interface PortalCredentials {
  username: string;
  password: string;
}

// --- private shapes ----------------------------------------------------------

interface EncryptedPayload {
  iv: string;      // base64
  authTag: string; // base64
  data: string;    // base64 AES-256-GCM ciphertext
}

// --- constants ---------------------------------------------------------------

const ALGORITHM = "aes-256-gcm" as const;
const KEY_ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const CONFIG_KEY_PREFIX = "portal";

// --- main export -------------------------------------------------------------

export class PortalCredentialManager {
  constructor(
    private readonly client: SupabaseClient,
    private readonly organizationId: string,
  ) {}

  /**
   * Encrypt and upsert credentials for `funderId` into platform_config.
   * Existing credentials for this funder are overwritten.
   */
  async saveCredentials(
    funderId: string,
    username: string,
    password: string,
  ): Promise<void> {
    const key = await deriveKey(this.organizationId);
    const payload = encrypt(JSON.stringify({ username, password }), key);
    const configKey = credentialsConfigKey(funderId);
    const value = JSON.stringify(payload);

    const { data: existing } = await this.client
      .from("platform_config")
      .select("id")
      .eq("organization_id", this.organizationId)
      .eq("key", configKey)
      .maybeSingle();

    if (existing) {
      await this.client
        .from("platform_config")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("organization_id", this.organizationId)
        .eq("key", configKey);
    } else {
      await this.client.from("platform_config").insert({
        organization_id: this.organizationId,
        key: configKey,
        value,
      });
    }
  }

  /**
   * Decrypt and return credentials for `funderId`. Returns null when no
   * credentials are stored or when decryption fails.
   */
  async getCredentials(funderId: string): Promise<PortalCredentials | null> {
    const { data } = await this.client
      .from("platform_config")
      .select("value")
      .eq("organization_id", this.organizationId)
      .eq("key", credentialsConfigKey(funderId))
      .maybeSingle();

    if (!data) return null;

    try {
      const payload = JSON.parse((data as { value: string }).value) as EncryptedPayload;
      const key = await deriveKey(this.organizationId);
      return JSON.parse(decrypt(payload, key)) as PortalCredentials;
    } catch {
      return null;
    }
  }

  /** Delete stored credentials for `funderId`. No-op when none exist. */
  async deleteCredentials(funderId: string): Promise<void> {
    await this.client
      .from("platform_config")
      .delete()
      .eq("organization_id", this.organizationId)
      .eq("key", credentialsConfigKey(funderId));
  }
}

// --- private helpers ---------------------------------------------------------

function credentialsConfigKey(funderId: string): string {
  return `${CONFIG_KEY_PREFIX}.${funderId}.credentials`;
}

async function deriveKey(organizationId: string): Promise<Buffer> {
  const secret =
    process.env.PORTAL_ENCRYPT_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "benavora-portal-default";

  return new Promise<Buffer>((resolve, reject) => {
    crypto.pbkdf2(
      secret,
      organizationId,
      KEY_ITERATIONS,
      KEY_LENGTH,
      "sha256",
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      },
    );
  });
}

function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
}

function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.data, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}
