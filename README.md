# Benavora

Nonprofit funding automation — AI-powered grant research, drafting, CRM, document management, deadline tracking, and a recursive learning system. Built per the FORGE governance docs (see `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `PRD.md`).

## Stack

Next.js 14 (App Router) · TypeScript (strict) · Supabase (Postgres + Auth + RLS + Storage) · Anthropic Claude · Tailwind CSS · Playwright · pnpm · Vercel.

## Getting started

```powershell
# 1. Install dependencies
pnpm install

# 2. Configure environment
Copy-Item .env.local.example .env.local
#   then fill in real values in .env.local (never commit it)

# 3. Run the dev server
pnpm dev
```

Open http://localhost:3000.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint (next lint) |
| `pnpm typecheck` | `tsc --noEmit` (zero errors required) |
| `pnpm test` | Playwright E2E tests |

## Quality gates (run in order before every commit)

```powershell
pnpm tsc --noEmit   # compile — zero errors
pnpm run build      # build
pnpm lint           # lint
pnpm test           # Playwright (when tests exist)
```

## Deploy

```powershell
.\deploy.ps1 "[FORGE] <phase>: <description>"
```

Runs compile → build → lint → `vercel --prod` → Playwright → commit + push. Any failed gate aborts the deploy.

## Project layout

See `BLUEPRINT.md` §3.1. Source lives under `src/` (`app/`, `components/`, `lib/`, `types/`). Empty directories carry a `.gitkeep` placeholder until their files are implemented.

## Security

- Secrets live only in `.env.local` (git-ignored). Never hardcode keys.
- The Supabase service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is server-only and used solely by agents via `src/lib/supabase/admin.ts`.
- All tenant data is isolated by `organization_id` via RLS plus server-derived scoping.
