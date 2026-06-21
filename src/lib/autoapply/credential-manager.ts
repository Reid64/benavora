import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new Error("CREDENTIAL_ENCRYPTION_KEY env var is not set");
  const derived = crypto.scryptSync(key, "benavora-cred-salt", 32);
  return derived;
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv, {
    authTagLength: TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export class CredentialManager {
  private supabase: ReturnType<typeof createClient<Database>>;

  constructor(supabase: ReturnType<typeof createClient<Database>>) {
    this.supabase = supabase;
  }

  async storeCredentials(params: {
    organizationId: string;
    funderId: string;
    portalUrl: string;
    username: string;
    password: string;
  }): Promise<void> {
    const encrypted = encrypt(params.password);
    const { error } = await this.supabase
      .from("funder_credentials")
      .upsert(
        {
          organization_id: params.organizationId,
          funder_id: params.funderId,
          portal_url: params.portalUrl,
          username: params.username,
          encrypted_password: encrypted,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,funder_id" }
      );
    if (error) throw new Error(`Failed to store credentials: ${error.message}`);
  }

  async getCredentials(
    organizationId: string,
    funderId: string
  ): Promise<{ id: string; username: string; password: string } | null> {
    const { data, error } = await this.supabase
      .from("funder_credentials")
      .select("id, username, encrypted_password")
      .eq("organization_id", organizationId)
      .eq("funder_id", funderId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch credentials: ${error.message}`);
    if (!data) return null;

    return {
      id: data.id,
      username: data.username,
      password: decrypt(data.encrypted_password),
    };
  }

  async updateLastLogin(
    credentialId: string,
    success: boolean
  ): Promise<void> {
    const { error } = await this.supabase
      .from("funder_credentials")
      .update({
        last_login_at: new Date().toISOString(),
        login_success: success,
        updated_at: new Date().toISOString(),
      })
      .eq("id", credentialId);
    if (error)
      throw new Error(`Failed to update last login: ${error.message}`);
  }
}
