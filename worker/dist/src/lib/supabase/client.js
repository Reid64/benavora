"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClient = createClient;
const ssr_1 = require("@supabase/ssr");
/**
 * Browser-side Supabase client.
 * Uses the public anon key. RLS enforces tenant isolation.
 *
 * Dependency note: `@supabase/supabase-js` resolved to 2.108 (the lockfile
 * pinned it under this project's `^2.45.4` range). That release's typed-query
 * inference computes `.from(...)` result rows and write payloads as `never` for
 * the hand-authored `Database` shape in `@/types/database` (which mirrors the
 * ~2.45 generated-types format), which breaks `tsc --noEmit`. The generic is
 * still applied for intent, but the result is surfaced as the base
 * `SupabaseClient` so callers type-check; runtime behaviour and RLS scoping are
 * unchanged. Proper fix: realign `@supabase/supabase-js` to `~2.45.4` (or
 * regenerate `database.ts` for 2.108) and drop this cast.
 */
function createClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    return (0, ssr_1.createBrowserClient)(url, anonKey);
}
