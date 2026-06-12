#!/usr/bin/env bash
# Probe every API route. Authenticated via the cookie jar dumped by dump-cookies.mjs.
# Logs: METHOD path -> HTTP status :: body (truncated).
set -u
BASE="http://localhost:3000"
JAR="audit/cookies.txt"
OPP="b98c13d4-919c-4e4e-9832-d0ae27731496"
APP="35f1e058-3edb-4434-889c-098d5cbc4683"
FAKE="00000000-0000-0000-0000-000000000000"
OUT="audit/api-results.txt"
: > "$OUT"

hit() {
  local method="$1" path="$2" body="${3:-}"
  local url="$BASE$path"
  local resp
  if [ -n "$body" ]; then
    resp=$(curl -s -m 60 -b "$JAR" -X "$method" -H "Content-Type: application/json" -d "$body" -w $'\n__STATUS__%{http_code}' "$url")
  else
    resp=$(curl -s -m 60 -b "$JAR" -X "$method" -w $'\n__STATUS__%{http_code}' "$url")
  fi
  local status="${resp##*__STATUS__}"
  local out="${resp%$'\n'__STATUS__*}"
  # collapse whitespace, truncate
  out=$(printf '%s' "$out" | tr '\n' ' ' | tr -s ' ' | cut -c1-300)
  printf '%-7s %-48s -> %s :: %s\n' "$method" "$path" "$status" "$out" | tee -a "$OUT"
}

echo "==== GET routes ====" | tee -a "$OUT"
hit GET  /api/admin/audit-log
hit GET  /api/admin/usage
hit GET  "/api/agents/automation/$FAKE"
hit GET  "/api/agents/campaigns/$FAKE"
hit GET  /api/agents/campaigns
hit GET  /api/agents/research/status
hit GET  /api/billing
hit GET  /api/cron/campaigns
hit GET  /api/cron/reminders
hit GET  /api/cron/research
hit GET  /api/deadlines/check
hit GET  /api/integrations/google
hit GET  /api/integrations/google/calendar
hit GET  /api/users
hit GET  /api/auth/callback

echo "==== POST routes (minimal/empty body — exercises validation/auth, not full execution) ====" | tee -a "$OUT"
hit POST "/api/agents/automation/$FAKE/approve" '{}'
hit POST /api/agents/automation                 "{\"applicationId\":\"$APP\"}"
hit POST /api/agents/campaigns                   '{}'
hit POST /api/agents/eligibility                 "{\"opportunityId\":\"$OPP\"}"
hit POST /api/agents/learning                    '{}'
hit POST /api/agents/outreach                    '{}'
hit POST /api/agents/research                    '{}'
hit POST /api/ai/draft                           '{}'
hit POST /api/ai/fit-analysis                    '{}'
hit POST /api/ai/review                          '{}'
hit POST /api/ai/summarize                       '{}'
hit POST /api/audit                              '{}'
hit POST /api/auth/log-event                     '{"event":"login"}'
hit POST /api/billing                            '{}'
hit POST /api/cron/campaigns                     '{}'
hit POST /api/cron/reminders                     '{}'
hit POST /api/cron/research                      '{}'
hit POST /api/deadlines/check                    '{}'
hit POST /api/documents/quota                    '{}'
hit POST /api/integrations/google                '{}'
hit POST /api/integrations/google/calendar       '{}'
hit POST /api/integrations/google/calendar/sync  '{}'
hit POST /api/integrations/google/sync           '{}'
hit POST /api/users/accept                       '{}'
hit POST /api/users/invite                        '{}'
hit POST /api/webhooks/stripe                     '{}'

echo "==== PUT / other ====" | tee -a "$OUT"
hit PUT  "/api/agents/automation/$FAKE"          '{}'
hit PUT  "/api/agents/campaigns/$FAKE"           '{}'
hit PUT  /api/users                              '{}'

echo "DONE" | tee -a "$OUT"
