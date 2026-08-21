import ws from "ws";
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
 * THE SHARED FACTORY (WGR-158): this is the single, only place in the
 * codebase that should construct a service-role Supabase client - both
 * `worker/index.ts` (Railway, boot-time client) and every module under
 * `src/lib/` that needs admin access (donor-discovery enumeration,
 * enrichment, agents, cron routes, etc.) call this function rather than
 * building their own. Before this fix, `worker/index.ts` built its own
 * client directly from `SUPABASE_URL` (present in Railway's env, absent in
 * Vercel's) while this factory read only `NEXT_PUBLIC_SUPABASE_URL`
 * (present in Vercel's env, absent in Railway's) - so any worker code path
 * that routed through this factory instead of the worker's own client (every
 * real Donor Discovery request did, via google-places.ts/directory.ts)
 * threw "Missing NEXT_PUBLIC_SUPABASE_URL..." on Railway even though the
 * worker itself had booted successfully. `SUPABASE_URL` is checked first
 * (the server-only name, matches Railway and any other non-Vercel runtime),
 * falling back to `NEXT_PUBLIC_SUPABASE_URL` (Vercel's convention, since
 * Vercel never sets a bare `SUPABASE_URL`) - both env values are always the
 * same Supabase project URL, so either name resolves to the correct client
 * regardless of which platform is running the code.
 *
 * Dependency note: mirrors the workaround in `./client.ts`. `@supabase/supabase-js`
 * resolved to 2.108, whose typed-query inference computes `.from(...)` rows and
 * write payloads as `never` for the hand-authored `Database` shape, breaking
 * `tsc --noEmit`. The generic is kept for intent; the result is surfaced as the
 * base `SupabaseClient` so callers type-check. Runtime behaviour is unchanged.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      // ws's overloaded constructor (incl. `constructor(address: null)`) doesn't
      // structurally match Supabase's WebSocketLikeConstructor; cast is types-only.
      transport: ws as any,
    },
  }) as unknown as SupabaseClient;
}
