-- Migration 111 — AG-27 Board Meeting Packet Agent (AGENTS_v2.md §5, AG-27).
--
-- 1. Adds 'ag-27-board-packet' to the agent_type enum (AGENTS_v2.md §1.2's
--    enum-gap pattern, same root cause as the 15-value fix in
--    fix-agent-type-enum-gap.sql, the ag-18-reputation/ag-32-relationship-graph
--    follow-up, 108_ag10_grant_dna_enum.sql, and 110_ag26_funding_forecast.sql).
--    Without this, BoardPacketAgent.startRun() fails immediately on its first
--    agent_runs insert with "22P02: invalid input value for enum agent_type"
--    on every trigger path.
--
-- 2. Adds UNIQUE(meeting_id) to board_meeting_packets (migration 078, RLS
--    added migration 105) as defense-in-depth idempotency, per the spec's
--    own instruction ("a UNIQUE(meeting_id) constraint should still be
--    added as defense-in-depth — explicitly flagged as part of this agent's
--    own build task, same as AG-26's forecast uniqueness constraint").
--    Confirmed live via direct schema query before writing this file:
--    board_meeting_packets currently has only a primary key on `id` and a
--    plain (non-unique) FK on meeting_id — a second run for the same
--    meeting (the daily schedule and the event-chained safety net racing
--    for the same short-notice meeting, or two concurrent worker ticks)
--    could insert a duplicate packet row without this constraint. The
--    agent's own processOneMeeting() already guards against this with a
--    pre-insert existence check and an explicit 23505-unique-violation
--    catch on the insert itself — this constraint is the real backstop
--    underneath both of those application-level checks, not a substitute
--    for them.

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-27-board-packet';

ALTER TABLE board_meeting_packets
  ADD CONSTRAINT board_meeting_packets_meeting_id_unique
  UNIQUE (meeting_id);
