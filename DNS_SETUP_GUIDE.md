# benavora.com DNS Configuration
## Records to add in GoDaddy DNS Manager
### Go to: https://dcc.godaddy.com/manage/benavora.com/dns

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | 76.76.21.21 | 600 |
| CNAME | www | cname.vercel-dns.com | 600 |

### Steps:
1. Log into GoDaddy account
2. Go to My Products -> Domains -> benavora.com -> DNS
3. Delete any existing A record for @
4. Add A record: Host=@, Points to=76.76.21.21, TTL=600 seconds
5. Add CNAME record: Host=www, Points to=cname.vercel-dns.com, TTL=600 seconds
6. Save changes
7. DNS propagation takes 10-30 minutes

### Current status (see STATE_OF_THE_BUILD.md "DOMAIN" section for full detail)

Per the July 21/22 2026 sessions, this configuration was already completed and verified live:
`nslookup benavora.com` resolved to `76.76.21.21`, and `curl -I https://benavora.com` returned
`HTTP/1.1 308` redirecting to `https://www.benavora.com/` with `Server: Vercel`. This guide is
kept as a reference in case DNS ever needs to be reconfigured (e.g. registrar change, record
accidentally deleted), not because propagation is currently pending.

**This session (2026-08-04) could not independently re-verify the above.** The session sandbox
blocks all network-touching commands (`vercel`, `nslookup`, `curl`) pending an approval flow that
this non-interactive session has no way to complete, and this sandbox has no filesystem access
outside `C:\Users\manag\Documents\benavora\` (so the FORGE governance-doc sync step and any
`vercel` project-link check under `C:\Users\manag\Documents\FORGE\` were also not possible from
here). Treat the "live and verified" status above as last confirmed 2026-07-22, not reconfirmed
today. Re-run the verification commands from an unrestricted shell before relying on this as
current-day proof.
