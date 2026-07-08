-- 070_donor_discovery_request_claim.sql — atomic claim RPC for Donor Discovery
-- requests (DONOR_DISCOVERY_ARCHITECTURE.md §3, "Worker model"). PostgREST's
-- query builder can't express `FOR UPDATE SKIP LOCKED`, so the claim has to be
-- a real Postgres function the worker calls via `.rpc()`. This gives
-- worker/dd-request-processor.ts genuine multi-worker-safe locking (unlike
-- the two-step select+conditional-update the AutoApply queue-processor uses
-- as a stand-in — see the comment above its `dequeue()`).
--
-- File only — not applied to production per this task's instructions.

create or replace function public.donor_discovery_claim_request()
returns public.donor_discovery_requests
language plpgsql
as $$
declare
  v_row public.donor_discovery_requests;
begin
  select * into v_row
  from public.donor_discovery_requests
  where status = 'queued'
  order by created_at asc
  limit 1
  for update skip locked;

  if v_row.id is null then
    return null;
  end if;

  update public.donor_discovery_requests
  set status = 'enumerating'
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;
