import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Server-side Supabase client (Server Components, Route Handlers, Server Actions).
 * Uses the public anon key bound to the authenticated user's session cookies.
 * organization_id is ALWAYS derived from the session, never from request bodies.
 *
 * Dependency note: mirrors the workaround in `./client.ts`. `@supabase/supabase-js`
 * resolved to 2.108 (the lockfile pinned it under this project's `^2.45.4` range).
 * That release's typed-query inference computes `.from(...)` result rows and write
 * payloads as `never` for the hand-authored `Database` shape in `@/types/database`
 * (which mirrors the ~2.45 generated-types format), which breaks `tsc --noEmit`.
 * The generic is still applied for intent, but the result is surfaced as the base
 * `SupabaseClient` so server-side callers type-check; runtime behaviour and RLS
 * scoping are unchanged. Proper fix: realign `@supabase/supabase-js` to `~2.45.4`
 * (or regenerate `database.ts` for 2.108) and drop this cast.
 */
export function createClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  const cookieStore = cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // The `setAll` method is called from a Server Component where cookies
          // cannot be set. Safe to ignore when middleware refreshes the session.
        }
      },
    },
  }) as unknown as SupabaseClient;
}
