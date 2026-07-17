-- Migration 092: constrain consultant_client_access.access_level to a fixed
-- set of values. Migration 086 created the column as plain `text` with no
-- CHECK constraint; the application only ever writes 'read' today, but the
-- column is meant to hold read/write/admin (BLUEPRINT §12).

ALTER TABLE consultant_client_access
  DROP CONSTRAINT IF EXISTS consultant_client_access_access_level_check;

ALTER TABLE consultant_client_access
  ADD CONSTRAINT consultant_client_access_access_level_check
  CHECK (access_level IN ('read', 'write', 'admin'));
