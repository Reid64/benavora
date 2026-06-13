import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. Bypasses RLS.
 *
 * SERVER-ONLY. Use ONLY inside agent code (src/lib/agents/*), never in
 * user-facing routes. Every query made with this client MUST manually scope
 * by organization_id - RLS will NOT protect you here.
 *
 * The service role key is read from a server-only env var and is never
 * exposed to the client.
 *
 * Dependency note: mirrors the workaround in `./client.ts`. `@supabase/supabase-js`
 * resolved to 2.108, whose typed-query inference computes `.from(...)` rows and
 * write payloads as `never` for the hand-authored `Database` shape, breaking
 * `tsc --noEmit`. The generic is kept for intent; the result is surfaced as the
 * base `SupabaseClient` so callers type-check. Runtime behaviour is unchanged.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }) as unknown as SupabaseClient;
}
