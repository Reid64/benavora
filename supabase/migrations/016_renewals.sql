-- 016_renewals.sql — renewal tracking for recurring awarded grants
-- Auto-creates a renewal record when an outcome of 'awarded' is recorded
-- for a recurring opportunity (opportunities.recurrence IS NOT NULL / non-empty).

-- ── Table ─────────────────────────────────────────────────────────────────────
create table public.renewals (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  application_id       uuid not null references public.applications(id) on delete cascade,
  opportunity_id       uuid not null references public.opportunities(id),
  funder_id            uuid references public.funders(id),
  renewal_type         text not null default 'annual',
  reporting_deadline   date,
  renewal_window_start date,
  renewal_window_end   date,
  compliance_status    text not null default 'pending',
  compliance_notes     text,
  auto_narrative_draft text,
  alert_sent_60d       boolean not null default false,
  alert_sent_30d       boolean not null default false,
  alert_sent_14d       boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.renewals enable row level security;

create policy "org_isolation" on public.renewals
  using (organization_id = public.current_org_id());

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index renewals_organization_id_idx    on public.renewals(organization_id);
create index renewals_application_id_idx     on public.renewals(application_id);
create index renewals_reporting_deadline_idx on public.renewals(reporting_deadline);

-- ── updated_at trigger ────────────────────────────────────────────────────────
create or replace function public.renewals_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger renewals_updated_at
  before update on public.renewals
  for each row execute function public.renewals_set_updated_at();

-- ── Auto-create renewal on awarded outcome for a recurring opportunity ────────
-- Fires after INSERT on outcomes. Idempotent: skipped if a renewal already
-- exists for the same application_id.
create or replace function public.auto_create_renewal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp_id      uuid;
  v_funder_id   uuid;
  v_recurrence  text;
begin
  if new.result <> 'awarded' then
    return new;
  end if;

  select a.opportunity_id
  into   v_opp_id
  from   applications a
  where  a.id = new.application_id
  limit  1;

  if v_opp_id is null then
    return new;
  end if;

  select o.recurrence, o.funder_id
  into   v_recurrence, v_funder_id
  from   opportunities o
  where  o.id = v_opp_id
  limit  1;

  -- Only create for recurring opportunities
  if v_recurrence is null or trim(v_recurrence) = '' then
    return new;
  end if;

  -- Skip if renewal already exists for this application
  if exists (select 1 from renewals r where r.application_id = new.application_id) then
    return new;
  end if;

  insert into renewals (
    organization_id,
    application_id,
    opportunity_id,
    funder_id,
    renewal_type,
    reporting_deadline,
    renewal_window_start,
    renewal_window_end,
    compliance_status
  ) values (
    new.organization_id,
    new.application_id,
    v_opp_id,
    v_funder_id,
    v_recurrence,
    (current_date + interval '1 year')::date,
    (current_date + interval '9 months')::date,
    (current_date + interval '11 months')::date,
    'pending'
  );

  return new;
end;
$$;

create trigger auto_create_renewal_on_outcome
  after insert on public.outcomes
  for each row execute function public.auto_create_renewal();
