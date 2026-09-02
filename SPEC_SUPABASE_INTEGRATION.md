# SPEC_SUPABASE_INTEGRATION.md
## AFS — Supabase Integration
**Applies to ALL phases — foundational spec**

---

## 1. THREE CLIENTS — NEVER MIX THEM

```typescript
// lib/supabase/client.ts — BROWSER ONLY
import { createBrowserClient } from '@supabase/ssr';
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
// Use in: client components that need Realtime, auth state
// NEVER use for: sensitive queries, admin operations

// lib/supabase/server.ts — SERVER ONLY
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll(cs) { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } } }
  );
}
// Use in: server components, API routes (except admin operations)

// lib/supabase/admin.ts — WEBHOOKS AND SCRIPTS ONLY
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
export const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
// Use in: Stripe webhooks, Twilio webhooks, cron jobs, profile creation
// NEVER imported into client bundle
// NEVER used to serve user-requested data
```

---

## 2. STORAGE BUCKETS SETUP

```sql
-- Run in Supabase Storage dashboard:
-- blueprints bucket: private, 50MB max per file
-- documents bucket:  private, 100MB max per file
-- cad-library bucket: private, 250MB max per file
-- orders bucket:     private, 25MB max per file

-- Signed URL expiry:
-- blueprints: 3600s (1 hour for processing)
-- documents:  900s  (15 min for download)
-- cad-library:900s  (15 min for download)
-- orders:     900s  (15 min for download)
```

---

## 3. RLS TESTING REQUIREMENT

```typescript
// Every table in SCHEMA.md has RLS. Test it before building features.

// Test pattern for each table:
// 1. Insert test row as admin
// 2. Query as user who SHOULD see it → verify returned
// 3. Query as user who SHOULD NOT see it → verify empty
// 4. Attempt insert as user who should NOT insert → verify rejected

// Testing approach:
// 1. Supabase Studio → Authentication → Users → create test users
// 2. SQL Editor → SET ROLE anon; → run queries → verify results
// 3. Or Playwright tests with separate test user accounts
```

---

## 4. REALTIME CONFIGURATION

```typescript
// Enable Realtime on these tables only (performance consideration):
// orders — for customer order tracking page and admin production queue
// Enable via Supabase Dashboard → Database → Replication
// Or via SQL:
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

// Do NOT enable Realtime on:
// pricing tables (admin-only, low frequency)
// notifications table (high write volume, not needed client-side)
// audit tables (admin-only)
```

---

## 5. DATABASE MIGRATIONS

```typescript
// File: supabase/migrations/001_initial_schema.sql
// Run once: all tables, RLS, indexes from SCHEMA.md
// Future changes: new migration files 002_, 003_, etc.
// Never edit 001_ after it runs in production
// Local dev: supabase db push
// Production: supabase db push --linked
```

---

## 6. ROW LEVEL SECURITY QUICK-TEST CHECKLIST

Run before starting each feature phase:

```
Phase 1:  [ ] takeoff_uploads RLS  [ ] blueprints bucket access
Phase 2:  [ ] quote_requests RLS   [ ] vault_documents RLS
Phase 3:  [ ] products public read [ ] quotes user-scoped
Phase 4:  [ ] orders user-scoped   [ ] order_line_items scoped
Phase 5:  [ ] cad_library_files    [ ] saved_specifications
Phase 6:  [ ] pricing_rules admin  [ ] commodity_prices admin
```

---

*SPEC_SUPABASE_INTEGRATION.md | AFS | Reid Whitesides | June 2026*
