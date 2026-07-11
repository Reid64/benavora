"use strict";
// Browser-automation types - Phase 3 (BLUEPRINT §Phase 3, AGENTS.md Agent 16,
// BEHAVIORAL_CONTRACTS §18).
//
// These mirror the automation_sessions / automation_steps /
// automation_screenshots tables in SCHEMA_REGISTRY.md (Migration 002) and the
// in-memory shapes the automation library passes around (detected form fields,
// field→data mappings, captured screenshots).
//
// The hand-authored Database type (src/types/database.ts) does not yet include
// the Phase 2-5 tables, so the library talks to those tables through the
// untyped base SupabaseClient. The row interfaces here are the typed contract
// the library and its callers use in their place.
Object.defineProperty(exports, "__esModule", { value: true });
