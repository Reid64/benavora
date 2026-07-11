"use strict";
// Database types for Benavora - hand-authored to mirror SCHEMA_REGISTRY.md v1.0.
//
// Shape matches Supabase's generated output (public.Tables.<name>.{Row,Insert,Update},
// public.Enums) so it can be swapped for real generated types after Migration 001:
//   pnpm dlx supabase gen types typescript --project-id <ref> > src/types/database.ts
//
// Conventions:
//   - uuid / text / date / timestamptz  -> string
//   - numeric / integer / bigint        -> number
//   - boolean                           -> boolean
//   - jsonb                             -> Json
//   - NOT NULL columns are required & non-null in Row; nullable columns are `| null`.
//   - Insert: NOT NULL columns without a default are required; everything else optional.
//   - Update: every column optional.
Object.defineProperty(exports, "__esModule", { value: true });
