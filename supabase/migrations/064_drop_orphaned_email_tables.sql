-- Migration 064: drop orphaned email tables
--
-- email_threads / email_messages were an earlier email-storage design,
-- superseded by synced_email_threads / synced_email_messages (migration 054).
-- No code in src/ references them (verified via grep: zero .from() calls and
-- zero string references), both tables are empty, and no external DB object
-- depends on them:
--   * incoming FKs: only the internal email_messages.thread_id -> email_threads
--   * RLS policies email_messages_org / email_threads_org drop with the tables
--   * no views, no triggers reference either table
--
-- Drop child before parent; CASCADE covers the internal FK and the policies.

DROP TABLE IF EXISTS email_messages CASCADE;
DROP TABLE IF EXISTS email_threads CASCADE;
