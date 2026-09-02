#!/usr/bin/env bash
# ==============================================================================
# BENAVORA — one-time AWS provisioning for off-provider database backups.
#
# Creates:
#   - benavora-prod-backups        (us-east-1, primary — pg_dump target)
#   - benavora-prod-backups-replica (us-west-2, disaster-recovery replica)
# with versioning, default SSE-S3 encryption, blocked public access, a
# 90-day noncurrent-version lifecycle rule, cross-region replication from
# primary -> replica, and a least-privilege IAM role for GitHub Actions
# (assumed via OIDC — no long-lived AWS keys in GitHub secrets).
#
# Requires the AWS CLI (`aws configure` or equivalent) with an identity that
# can create S3 buckets and IAM roles/policies. Safe to re-run: every step
# checks current state first. Run from repo root:
#
#   bash infra/aws/backup-bucket/setup.sh
#
# After this completes, set the GitHub repo secrets it prints (Settings ->
# Secrets and variables -> Actions):
#   AWS_BACKUP_ROLE_ARN   — printed at the end
#   BACKUP_DATABASE_URL   — Supabase direct (non-pooled) connection string
# ==============================================================================
set -euo pipefail

PRIMARY_BUCKET="benavora-prod-backups"
PRIMARY_REGION="us-east-1"
REPLICA_BUCKET="benavora-prod-backups-replica"
REPLICA_REGION="us-west-2"
NONCURRENT_EXPIRY_DAYS=90
GITHUB_REPO="Reid64/benavora"
REPLICATION_ROLE_NAME="benavora-s3-backup-replication"
GITHUB_ROLE_NAME="benavora-github-backup-role"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "AWS account: ${ACCOUNT_ID}"

# ------------------------------------------------------------------------------
# 1. Buckets
# ------------------------------------------------------------------------------
create_bucket_if_missing() {
  local bucket=$1 region=$2
  if aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
    echo "[skip] bucket exists: $bucket"
    return
  fi
  echo "[create] bucket: $bucket ($region)"
  if [ "$region" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$bucket" --region "$region"
  else
    aws s3api create-bucket --bucket "$bucket" --region "$region" \
      --create-bucket-configuration LocationConstraint="$region"
  fi
}

create_bucket_if_missing "$PRIMARY_BUCKET" "$PRIMARY_REGION"
create_bucket_if_missing "$REPLICA_BUCKET" "$REPLICA_REGION"

for bucket in "$PRIMARY_BUCKET" "$REPLICA_BUCKET"; do
  echo "[configure] $bucket: versioning, encryption, public access block"

  aws s3api put-bucket-versioning --bucket "$bucket" \
    --versioning-configuration Status=Enabled

  aws s3api put-bucket-encryption --bucket "$bucket" \
    --server-side-encryption-configuration '{
      "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
    }'

  aws s3api put-public-access-block --bucket "$bucket" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

  aws s3api put-bucket-lifecycle-configuration --bucket "$bucket" \
    --lifecycle-configuration '{
      "Rules": [{
        "ID": "expire-noncurrent-versions-90d",
        "Status": "Enabled",
        "Filter": {},
        "NoncurrentVersionExpiration": {"NoncurrentDays": '"$NONCURRENT_EXPIRY_DAYS"'},
        "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
      }]
    }'

  aws s3api put-bucket-policy --bucket "$bucket" --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::'"$bucket"'", "arn:aws:s3:::'"$bucket"'/*"],
      "Condition": {"Bool": {"aws:SecureTransport": "false"}}
    }]
  }'
done

# ------------------------------------------------------------------------------
# 2. Cross-region replication (primary -> replica)
# ------------------------------------------------------------------------------
echo "[configure] IAM role for replication: $REPLICATION_ROLE_NAME"

if ! aws iam get-role --role-name "$REPLICATION_ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$REPLICATION_ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "s3.amazonaws.com"},
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null
fi

aws iam put-role-policy --role-name "$REPLICATION_ROLE_NAME" \
  --policy-name "${REPLICATION_ROLE_NAME}-policy" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetReplicationConfiguration", "s3:ListBucket"],
        "Resource": "arn:aws:s3:::'"$PRIMARY_BUCKET"'"
      },
      {
        "Effect": "Allow",
        "Action": ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"],
        "Resource": "arn:aws:s3:::'"$PRIMARY_BUCKET"'/*"
      },
      {
        "Effect": "Allow",
        "Action": ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"],
        "Resource": "arn:aws:s3:::'"$REPLICA_BUCKET"'/*"
      }
    ]
  }'

REPLICATION_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${REPLICATION_ROLE_NAME}"

aws s3api put-bucket-replication --bucket "$PRIMARY_BUCKET" --replication-configuration '{
  "Role": "'"$REPLICATION_ROLE_ARN"'",
  "Rules": [{
    "ID": "replicate-to-us-west-2",
    "Status": "Enabled",
    "Priority": 1,
    "Filter": {},
    "DeleteMarkerReplication": {"Status": "Enabled"},
    "Destination": {
      "Bucket": "arn:aws:s3:::'"$REPLICA_BUCKET"'",
      "StorageClass": "STANDARD_IA"
    }
  }]
}'

# ------------------------------------------------------------------------------
# 3. GitHub Actions OIDC role (no long-lived AWS keys in GitHub secrets)
# ------------------------------------------------------------------------------
OIDC_PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_PROVIDER_ARN" >/dev/null 2>&1; then
  echo "[create] GitHub OIDC provider"
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" >/dev/null
else
  echo "[skip] GitHub OIDC provider exists"
fi

echo "[configure] IAM role for GitHub Actions: $GITHUB_ROLE_NAME"

if ! aws iam get-role --role-name "$GITHUB_ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$GITHUB_ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Federated": "'"$OIDC_PROVIDER_ARN"'"},
        "Action": "sts:AssumeRoleWithWebIdentity",
        "Condition": {
          "StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"},
          "StringLike": {"token.actions.githubusercontent.com:sub": "repo:'"$GITHUB_REPO"':ref:refs/heads/main"}
        }
      }]
    }' >/dev/null
fi

# Scoped to the primary bucket only — the workflow never needs to touch the
# replica; CRR (above) is what gets objects there.
aws iam put-role-policy --role-name "$GITHUB_ROLE_NAME" \
  --policy-name "${GITHUB_ROLE_NAME}-policy" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:AbortMultipartUpload", "s3:PutObjectTagging", "s3:ListMultipartUploadParts"],
      "Resource": "arn:aws:s3:::'"$PRIMARY_BUCKET"'/database-dumps/*"
    }]
  }'

echo ""
echo "Done. Set this as the AWS_BACKUP_ROLE_ARN GitHub repo secret:"
echo "  arn:aws:iam::${ACCOUNT_ID}:role/${GITHUB_ROLE_NAME}"
