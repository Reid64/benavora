"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDomain = normalizeDomain;
exports.parseGeo = parseGeo;
exports.upsertDirectoryRecord = upsertDirectoryRecord;
exports.findOrCreateProspect = findOrCreateProspect;
const admin_1 = require("../../lib/supabase/admin");
/**
 * Donor Discovery shared directory (DONOR_DISCOVERY_ARCHITECTURE.md §3
 * "compounding moat"). This is the module every acquisition adapter and the
 * request worker should go through to write into `donor_discovery_directory`
 * and `donor_discovery_prospects` — never raw inserts — so the dedup rules
 * below are enforced in exactly one place.
 *
 * Nothing in this module runs at import time: `createAdminClient()` is only
 * called inside the exported functions, matching the lazy-init convention
 * used by the other donor-discovery modules (crawler-core.ts,
 * adapters/google-places.ts).
 */
// ── normalizeDomain ──────────────────────────────────────────────────────────
/**
 * Strips protocol/www/path/query/fragment down to a bare, lowercased host.
 * Mirrors the SQL `donor_discovery_extract_domain` function (migration 067)
 * exactly, so a domain computed here and one computed by Postgres always
 * agree. Returns null for empty/missing input — nulls intentionally don't
 * collide with each other (a company with no website on file shouldn't be
 * fuzzy-matched to every other company with no website on file).
 */
function normalizeDomain(url) {
    if (!url)
        return null;
    const trimmed = url.trim();
    if (!trimmed)
        return null;
    const match = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?([^/:?#]+)/i);
    const host = match?.[1] ?? trimmed;
    return host.toLowerCase();
}
/** Parses the raw `point` column value PostgREST returns into {lat, lng}. Exported so callers reading `donor_discovery_directory.geo` directly (e.g. the scoring stage) don't duplicate this parsing. */
function parseGeo(raw) {
    if (raw == null)
        return null;
    if (typeof raw === "string") {
        // PostgREST serializes `point` as its text form, "(x,y)" = "(lng,lat)".
        const match = raw.match(/(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)/);
        if (!match)
            return null;
        return { lng: Number(match[1]), lat: Number(match[2]) };
    }
    if (typeof raw === "object" && "x" in raw) {
        const point = raw;
        return { lng: point.x, lat: point.y };
    }
    return null;
}
function toDirectoryRecord(row) {
    return {
        id: row.id,
        legal_name: row.legal_name,
        dba_name: row.dba_name ?? null,
        naics_codes: row.naics_codes ?? [],
        civic_kind: row.civic_kind ?? null,
        website: row.website ?? null,
        hq_address: row.hq_address ?? null,
        geo: parseGeo(row.geo),
        phone: row.phone ?? null,
        enrichment: row.enrichment ?? {},
        enriched_at: row.enriched_at ?? null,
        source_adapters: row.source_adapters ?? [],
        created_at: row.created_at,
    };
}
/**
 * Merge-upserts `record` into the shared directory via the
 * `donor_discovery_upsert_directory_record` RPC (migration 071), which does
 * the actual dedup match + merge/insert atomically in Postgres — a fuzzy
 * `similarity()` + geo-radius match can't be expressed as a plain
 * `.upsert(onConflict:)` call, and doing the match-then-write as two
 * separate round trips from here would race against concurrent adapters.
 *
 * Dedup priority: 1) exact normalized-domain match, 2) fuzzy legal_name
 * match (trigram similarity > 0.65) within 25km, only when both the incoming
 * record and the candidate have geo. On match, fields are merged (existing
 * non-null values win, arrays are unioned, enrichment keys already on file
 * are never overwritten). On miss, a new directory row is inserted.
 */
async function upsertDirectoryRecord(record) {
    const supabase = (0, admin_1.createAdminClient)();
    const { data, error } = await supabase.rpc("donor_discovery_upsert_directory_record", {
        p_legal_name: record.legal_name,
        p_website: record.website ?? null,
        p_hq_address: record.hq_address ?? null,
        p_lat: record.geo?.lat ?? null,
        p_lng: record.geo?.lng ?? null,
        p_phone: record.phone ?? null,
        p_naics_codes: record.naics_codes ?? [],
        p_civic_kind: record.civic_kind ?? null,
        p_source_adapter: record.source_adapter,
        p_enrichment: record.enrichment ?? null,
    });
    if (error || !data) {
        throw new Error(`directory_upsert_failed: ${error?.message ?? "no row returned"}`);
    }
    return toDirectoryRecord(data);
}
const UNIQUE_VIOLATION = "23505";
/**
 * Idempotent per (organization_id, directory_id) — DONOR_DISCOVERY_
 * ARCHITECTURE.md §3. A second request from the same org that resolves to a
 * company already in that org's directory-linked prospects reuses the
 * existing prospect row and just appends the request linkage in
 * `dd_prospect_requests` (migration 071), instead of creating a duplicate.
 *
 * `donor_discovery_prospects_org_directory_uidx` (migration 071) makes the
 * insert race-safe: if two workers hit this concurrently for the same
 * (org, directory), one insert wins and the other falls back to re-selecting
 * the row the winner created.
 */
async function findOrCreateProspect(organizationId, requestId, directoryId) {
    const supabase = (0, admin_1.createAdminClient)();
    let prospectId;
    let created = false;
    const { data: existing, error: findError } = await supabase
        .from("donor_discovery_prospects")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("directory_id", directoryId)
        .maybeSingle();
    if (findError) {
        throw new Error(`prospect_lookup_failed: ${findError.message}`);
    }
    if (existing) {
        prospectId = existing.id;
    }
    else {
        const { data: inserted, error: insertError } = await supabase
            .from("donor_discovery_prospects")
            .insert({
            organization_id: organizationId,
            directory_id: directoryId,
            request_id: requestId,
            pipeline_stage: "new",
        })
            .select("id")
            .single();
        if (insertError) {
            if (insertError.code !== UNIQUE_VIOLATION) {
                throw new Error(`prospect_insert_failed: ${insertError.message}`);
            }
            // Lost a race to another worker inserting the same (org, directory) pair.
            const { data: retry, error: retryError } = await supabase
                .from("donor_discovery_prospects")
                .select("id")
                .eq("organization_id", organizationId)
                .eq("directory_id", directoryId)
                .single();
            if (retryError || !retry) {
                throw new Error(`prospect_insert_race_failed: ${retryError?.message ?? "row not found after race"}`);
            }
            prospectId = retry.id;
        }
        else {
            prospectId = inserted.id;
            created = true;
        }
    }
    const { error: linkError } = await supabase
        .from("dd_prospect_requests")
        .upsert({ prospect_id: prospectId, request_id: requestId }, { onConflict: "prospect_id,request_id", ignoreDuplicates: true });
    if (linkError) {
        throw new Error(`prospect_request_link_failed: ${linkError.message}`);
    }
    return { id: prospectId, created };
}
