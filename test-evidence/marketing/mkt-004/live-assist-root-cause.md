Live evidence note - Benavora Assist public API failure on production

Captured 2026-08-22/23 while gathering STEP 4 live evidence against https://www.benavora.com.

## What was found

POST https://www.benavora.com/api/public/assist with a valid body returns
HTTP 500 `{"error":"assist-unavailable"}`. See live-assist-response.json.

## Root cause chain (both confirmed live via `npx vercel logs`)

1. First attempt: `DATABASE_URL` was not set in Vercel production at all
   (`npx vercel env ls production` had no DATABASE_URL row), so `pg.Pool` in
   `src/lib/knowledge/db.ts` fell back to its default and tried
   `127.0.0.1:5432` -> `ECONNREFUSED`.
   FIX APPLIED: added `DATABASE_URL` to Vercel production env from the same
   value already used locally in `.env.local`, then `npx vercel deploy --prod`
   to pick it up.

2. After the fix, the error changed to
   `getaddrinfo ENOTFOUND db.vbjplpquqxxfbpazyalt.supabase.co`. This is a
   known Supabase-on-Vercel failure mode: Supabase's direct database host
   (`db.<ref>.supabase.co:5432`) is IPv6-only for projects without the IPv4
   add-on, and Vercel's serverless runtime has no outbound IPv6 route, so DNS
   resolution fails from inside the function even though the same hostname
   resolves fine from a normal machine (confirmed: `pnpm run knowledge:ingest`
   connects to this same DATABASE_URL successfully from this local machine).
   NOT FIXED - the standard fix is to point DATABASE_URL (or a
   Vercel-only-scoped second connection string) at Supabase's connection
   pooler (`aws-0-<region>.pooler.supabase.com:6543`, user
   `postgres.<project-ref>`, `pgbouncer=true`), which is IPv4-reachable. The
   pooler is region-specific and the region for this project could not be
   determined from local `.env.local` contents or by trying all twelve AWS
   regions Supabase currently runs poolers in (all connection attempts
   returned `Tenant or user not found`, meaning none of the guessed regions
   host this project). Resolving this requires either the project's region
   from the Supabase dashboard/Management API (no PAT was available in this
   session's `.env.local` under any of the documented directive-017 variable
   names) or Reid supplying the pooler connection string directly.

## Scope note

`src/lib/knowledge/db.ts`'s direct-Postgres-connection design (bypassing
PostgREST because the `knowledge` schema is intentionally not exposed to it)
was already committed in the knw-001/knw-002/knw-003 queue prompts before
this session started. This live evidence gathering pass surfaced a real
production defect in that already-shipped design, it did not introduce one.
Recommend a follow-up FORGE prompt once the pooler connection string is
available: swap `knowledgePool()` in `src/lib/knowledge/db.ts` to use it (set
only in Vercel prod env, `.env.local` can keep the direct connection since
local/CI can resolve it).

## Screenshot evidence

`/resources` was screenshotted with the inline Assist widget in its real
current state, which is the error state ("Assist is unavailable right now.")
produced by this exact bug - see resources-assist-error.png in this
directory. This is accurate live evidence, not a placeholder.
