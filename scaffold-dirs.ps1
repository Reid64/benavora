$dirs = @(
 'src/app/login','src/app/register',
 'src/app/(dashboard)/dashboard',
 'src/app/(dashboard)/funders/new','src/app/(dashboard)/funders/[id]',
 'src/app/(dashboard)/contacts/new','src/app/(dashboard)/contacts/[id]',
 'src/app/(dashboard)/opportunities/new','src/app/(dashboard)/opportunities/[id]',
 'src/app/(dashboard)/applications/list','src/app/(dashboard)/applications/new','src/app/(dashboard)/applications/[id]',
 'src/app/(dashboard)/documents',
 'src/app/(dashboard)/knowledge-base/profile','src/app/(dashboard)/knowledge-base/narratives','src/app/(dashboard)/knowledge-base/answers',
 'src/app/(dashboard)/draft-generator/[id]',
 'src/app/(dashboard)/deadlines',
 'src/app/(dashboard)/outcomes/analytics',
 'src/app/(dashboard)/outreach/campaigns',
 'src/app/(dashboard)/search-profiles',
 'src/app/(dashboard)/settings',
 'src/app/api/auth/callback',
 'src/app/api/ai/draft','src/app/api/ai/summarize','src/app/api/ai/fit-analysis','src/app/api/ai/review',
 'src/app/api/agents/research','src/app/api/agents/eligibility','src/app/api/agents/outreach',
 'src/app/api/documents/upload','src/app/api/documents/download',
 'src/app/api/deadlines/check',
 'src/app/api/webhooks/stripe',
 'src/components/ui','src/components/layout','src/components/dashboard','src/components/funders',
 'src/components/contacts','src/components/opportunities','src/components/applications','src/components/documents',
 'src/components/knowledge-base','src/components/draft-generator','src/components/outcomes','src/components/outreach',
 'src/lib/supabase','src/lib/ai/prompts','src/lib/ai/learning','src/lib/agents','src/lib/utils',
 'src/types',
 'tests','state','reports'
)
foreach ($d in $dirs) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  $keep = Join-Path $d '.gitkeep'
  if (-not (Test-Path $keep)) { New-Item -ItemType File -Path $keep | Out-Null }
}
Write-Output ("Created " + $dirs.Count + " directories with .gitkeep")
