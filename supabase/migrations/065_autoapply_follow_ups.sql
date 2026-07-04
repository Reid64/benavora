-- 065_autoapply_follow_ups.sql — backing table for the AutoApply follow-up
-- sequence (src/lib/autoapply/follow-up-scheduler.ts and the routes under
-- src/app/api/autoapply/follow-ups/**). Confirmed missing from production via
-- a live schema query during the 2026-07-03 audit fix pass; schema below
-- matches exactly what those routes/the scheduler already read and write.

-- ── Table ─────────────────────────────────────────────────────────────────────
create table public.autoapply_follow_ups (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  submission_id     uuid not null references public.autoapply_submissions(id) on delete cascade,
  funder_id         uuid not null references public.funders(id) on delete cascade,
  sequence_number   integer not null,
  scheduled_at      timestamptz not null,
  sent_at           timestamptz,
  status            text not null default 'pending'
                      check (status in ('pending', 'sent', 'cancelled', 'skipped', 'failed')),
  template_type     text not null
                      check (template_type in ('initial_followup', 'second_followup', 'final_followup')),
  content           text,
  response_received boolean not null default false,
  cancel_reason     text,
  created_at        timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Matches the pattern used in migration 020 (automation_steps/screenshots):
-- org membership is derived from the caller's own profiles row, not a separate
-- organization_members table (which does not exist in this schema).
alter table public.autoapply_follow_ups enable row level security;

create policy "autoapply_follow_ups_org_select" on public.autoapply_follow_ups
  for select using (
    organization_id = (select organization_id from public.profiles where id = auth.uid())
  );

create policy "autoapply_follow_ups_org_insert" on public.autoapply_follow_ups
  for insert with check (
    organization_id = (select organization_id from public.profiles where id = auth.uid())
  );

create policy "autoapply_follow_ups_org_update" on public.autoapply_follow_ups
  for update using (
    organization_id = (select organization_id from public.profiles where id = auth.uid())
  );

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index autoapply_follow_ups_organization_id_idx on public.autoapply_follow_ups(organization_id);
create index autoapply_follow_ups_submission_id_idx on public.autoapply_follow_ups(submission_id);
create index autoapply_follow_ups_funder_id_idx on public.autoapply_follow_ups(funder_id);
-- Matches follow-up-scheduler.ts's due-item query: .eq("status","pending").lte("scheduled_at", now)
create index autoapply_follow_ups_status_scheduled_at_idx on public.autoapply_follow_ups(status, scheduled_at);
