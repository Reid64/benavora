-- 071_donor_discovery_directory_dedup.sql — Donor Discovery shared-directory
-- fuzzy dedup + idempotent per-org prospect linkage
-- (DONOR_DISCOVERY_ARCHITECTURE.md §3 "Compounding moat", §8 Phase 2:
-- "directory dedup (name+domain fuzzy)"). Backs
-- src/lib/donor-discovery/directory.ts.
--
-- Two independent pieces:
--
-- 1. Fuzzy directory dedup. Migration 069's donor_discovery_upsert_directory
--    only matches on exact (legal_name, website domain). This adds a second
--    match tier — trigram name similarity (pg_trgm) within a 25km radius,
--    used only when the incoming record and the candidate both have website
--    or geo data respectively — plus a merge-upsert function that folds in
--    civic_kind and enrichment (never overwriting a non-null enrichment
--    value already on file).
--
-- 2. dd_prospect_requests join table. donor_discovery_prospects.request_id
--    (migration 067) recorded only the request that first created a
--    prospect. Since the shared directory means a second request from the
--    same org can now resolve to a company already in that org's pipeline,
--    prospects must become idempotent per (organization_id, directory_id) —
--    a second hit reuses the row and just appends a request linkage here,
--    rather than creating a duplicate prospect. request_id stays on
--    donor_discovery_prospects unchanged as "which request created this
--    prospect"; "which requests surfaced this prospect" is answered by this
--    join table (and RLS on it defers to the parent prospect's org).
--
-- File only — not applied to production per this task's instructions.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── donor_discovery_geo_distance_km ──────────────────────────────────────────
-- Haversine great-circle distance in km between two points stored as
-- point(lng, lat) (see migration 069's comment on the `geo` column
-- convention). IMMUTABLE, no table access, safe to use in a WHERE clause.
create or replace function public.donor_discovery_geo_distance_km(a point, b point)
returns double precision
language sql
immutable
as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians((b[1] - a[1]) / 2)), 2) +
    cos(radians(a[1])) * cos(radians(b[1])) *
    power(sin(radians((b[0] - a[0]) / 2)), 2)
  ));
$$;

-- ── donor_discovery_upsert_directory_record ─────────────────────────────────
-- Dedup priority: 1) exact normalized-domain match (donor_discovery_extract_
-- domain, same as migration 069), 2) fuzzy legal_name match — trigram
-- similarity() > 0.65 — within 25km, only attempted when neither side is
-- missing a domain match candidate and both the incoming record and the
-- candidate have geo. On match: merge (union naics_codes/source_adapters,
-- coalesce scalar fields onto existing-wins-if-non-null, enrichment merged
-- so existing non-null keys are never overwritten). On miss: insert.
create or replace function public.donor_discovery_upsert_directory_record(
  p_legal_name text,
  p_website text,
  p_hq_address text,
  p_lat double precision,
  p_lng double precision,
  p_phone text,
  p_naics_codes text[],
  p_civic_kind text,
  p_source_adapter text,
  p_enrichment jsonb
) returns public.donor_discovery_directory
language plpgsql
as $$
declare
  v_domain text;
  v_match_id uuid;
  v_row public.donor_discovery_directory;
begin
  v_domain := public.donor_discovery_extract_domain(p_website);

  if v_domain is not null then
    select id into v_match_id
    from public.donor_discovery_directory
    where public.donor_discovery_extract_domain(website) = v_domain
    limit 1;
  end if;

  if v_match_id is null and p_lat is not null and p_lng is not null then
    select d.id into v_match_id
    from public.donor_discovery_directory d
    where d.geo is not null
      and similarity(lower(d.legal_name), lower(p_legal_name)) > 0.65
      and public.donor_discovery_geo_distance_km(d.geo, point(p_lng, p_lat)) <= 25
    order by similarity(lower(d.legal_name), lower(p_legal_name)) desc
    limit 1;
  end if;

  if v_match_id is not null then
    update public.donor_discovery_directory d
    set
      website = coalesce(d.website, p_website),
      hq_address = coalesce(d.hq_address, p_hq_address),
      geo = coalesce(d.geo, case when p_lat is not null and p_lng is not null then point(p_lng, p_lat) else null end),
      phone = coalesce(d.phone, p_phone),
      civic_kind = coalesce(d.civic_kind, p_civic_kind),
      naics_codes = (select array(select distinct unnest(d.naics_codes || coalesce(p_naics_codes, '{}')))),
      source_adapters = (select array(select distinct unnest(d.source_adapters || array[p_source_adapter]))),
      enrichment = coalesce(p_enrichment, '{}'::jsonb) || jsonb_strip_nulls(d.enrichment),
      enriched_at = case when p_enrichment is not null then now() else d.enriched_at end
    where d.id = v_match_id
    returning * into v_row;

    return v_row;
  end if;

  insert into public.donor_discovery_directory as d
    (legal_name, website, hq_address, geo, phone, civic_kind, naics_codes, source_adapters, enrichment, enriched_at)
  values (
    p_legal_name,
    p_website,
    p_hq_address,
    case when p_lat is not null and p_lng is not null then point(p_lng, p_lat) else null end,
    p_phone,
    p_civic_kind,
    coalesce(p_naics_codes, '{}'),
    array[p_source_adapter],
    coalesce(p_enrichment, '{}'::jsonb),
    case when p_enrichment is not null then now() else null end
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ── donor_discovery_prospects: idempotent per (organization_id, directory_id) ──
create unique index donor_discovery_prospects_org_directory_uidx
  on public.donor_discovery_prospects (organization_id, directory_id);

-- ── dd_prospect_requests ─────────────────────────────────────────────────────
-- Tenant-scoped (via the parent prospect, which is itself org-scoped — see
-- the RLS policy below); tracks every request that has surfaced a given
-- prospect, so a reused prospect still shows up under each request that
-- found it.
create table public.dd_prospect_requests (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.donor_discovery_prospects(id) on delete cascade,
  request_id   uuid not null references public.donor_discovery_requests(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (prospect_id, request_id)
);

alter table public.dd_prospect_requests enable row level security;

create policy "dd_prospect_requests_org_isolation" on public.dd_prospect_requests
  using (
    exists (
      select 1 from public.donor_discovery_prospects p
      where p.id = dd_prospect_requests.prospect_id
        and p.organization_id = public.current_org_id()
    )
  );

create index dd_prospect_requests_request_id_idx on public.dd_prospect_requests(request_id);
create index dd_prospect_requests_prospect_id_idx on public.dd_prospect_requests(prospect_id);

-- Backfill: every existing prospect's creating request is also a linkage.
insert into public.dd_prospect_requests (prospect_id, request_id)
select id, request_id from public.donor_discovery_prospects
on conflict (prospect_id, request_id) do nothing;
