# Off-provider database backups — AWS setup

One-time infrastructure for `scripts/backup-database.ts` and
`.github/workflows/backup-database.yml`. Supabase PITR only covers
Supabase-side incidents; this gives us a copy of prod outside Supabase
entirely, replicated to a second AWS region.

## What this provisions

- `benavora-prod-backups` (`us-east-1`) — primary bucket, versioned,
  SSE-S3 encrypted, public access blocked, TLS-only bucket policy.
- `benavora-prod-backups-replica` (`us-west-2`) — disaster-recovery
  replica, same settings, fed by cross-region replication (CRR).
- A 90-day `NoncurrentVersionExpiration` lifecycle rule on both buckets —
  once a newer version of an object (or a delete) supersedes an old one,
  that old version is deleted after 90 days. Current/live objects are
  never expired by this rule.
- IAM role `benavora-s3-backup-replication`, assumed by the S3 service
  itself to perform CRR.
- IAM role `benavora-github-backup-role`, assumed by GitHub Actions via
  OIDC (no long-lived AWS access keys stored in GitHub secrets). Scoped to
  `s3:PutObject`/`AbortMultipartUpload`/`PutObjectTagging` on
  `benavora-prod-backups/database-dumps/*` only — it cannot read, delete,
  or touch anything outside that prefix.

## Run it

Requires the AWS CLI configured with credentials that can create S3
buckets and IAM roles/policies (an admin or infra-provisioning IAM
identity — not the GitHub Actions role this script creates).

```bash
bash infra/aws/backup-bucket/setup.sh
```

Safe to re-run — every step checks existing state first (`head-bucket`,
`get-role`, etc.) before creating anything.

## After running

1. Copy the role ARN the script prints and add it as a GitHub repo secret
   named `AWS_BACKUP_ROLE_ARN` (Settings → Secrets and variables →
   Actions).
2. Add a `BACKUP_DATABASE_URL` secret: the Supabase **direct** (non-pooled)
   connection string — Project Settings → Database → Connection string →
   URI → "Direct connection". pg_dump needs a real connection, not the
   PgBouncer pooler.
3. Trigger `.github/workflows/backup-database.yml` manually
   (`workflow_dispatch`) once to confirm it uploads successfully before
   relying on the 2 AM UTC schedule.

## Restore

```bash
aws s3 cp s3://benavora-prod-backups/database-dumps/daily/prod-<timestamp>.sql.gz - \
  | gunzip | psql "$DATABASE_URL"
```

To pull from the DR replica instead (e.g. `us-east-1` is down), same
command against `s3://benavora-prod-backups-replica/...`.
