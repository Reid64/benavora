# Alerting

- `prometheus.rules.yaml` — alert rules for critical failures (agent family error rate, API p95 latency, auth failure spikes, slow Supabase queries).
- `alertmanager.yml` — routes `severity="critical"` alerts to the `#benavora-alerts` Slack channel.

## Applying

Vercel doesn't run Prometheus itself, so wire these into whichever Prometheus is actually scraping the app's `/metrics` endpoint:

- **Self-hosted Prometheus/Alertmanager**: load `prometheus.rules.yaml` via `rule_files:` in `prometheus.yml`, load `alertmanager.yml` as-is, and put the Slack webhook URL at the path referenced by `api_url_file` (mount it as a secret, don't commit it).
- **Provider-managed (Grafana Cloud, Datadog, etc.)**: import the rules from `prometheus.rules.yaml` through the provider's UI/API, and recreate the Slack route as a contact point/notification policy there instead of using `alertmanager.yml` directly — most managed offerings don't accept a raw Alertmanager config file.

Either way, the Slack webhook URL is a secret — store it in the provider's secret manager, not in these files or in Vercel env vars that reach the client.
