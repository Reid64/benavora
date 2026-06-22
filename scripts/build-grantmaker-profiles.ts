/**
 * Build grantmaker profiles from foundation_directory.
 * Processes foundations in batches: scrapes website priorities and extracts
 * giving patterns from enrichment data, then upserts into
 * intelligence_grantmaker_profiles.
 *
 * Usage:
 *   npx tsx scripts/build-grantmaker-profiles.ts --limit 1000
 */

import { config } from 'dotenv'
import path from 'path'

config({ path: path.resolve(__dirname, '../.env.local') })

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const BATCH_SIZE = 50

interface FoundationRow {
  id: string
  ein: string
  name: string
  website: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  giving_total: number | null
  geographic_focus: string | null
}

interface EnrichmentRow {
  entity_id: string
  found_programs: string[] | null
  found_giving: number | null
  found_revenue: number | null
  raw_data: Record<string, unknown> | null
}

function parseArgs(): { limit: number } {
  const args = process.argv.slice(2)
  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1]!, 10) : 100
  return { limit: isNaN(limit) ? 100 : limit }
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const { limit } = parseArgs()
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  console.log(`Processing up to ${limit} foundations...`)

  let processed = 0
  let offset = 0
  let total = 0

  while (processed < limit) {
    const batchLimit = Math.min(BATCH_SIZE, limit - processed)

    const { data: foundations, error } = await client
      .from('foundation_directory')
      .select('id, ein, name, website, email, phone, city, state, giving_total, geographic_focus')
      .order('imported_at', { ascending: false })
      .range(offset, offset + batchLimit - 1)

    if (error) {
      console.error('Error fetching foundations:', error.message)
      break
    }

    if (!foundations || foundations.length === 0) break

    const foundationIds = foundations.map((f: FoundationRow) => f.id)

    const { data: enrichments } = await client
      .from('enrichment_results')
      .select('entity_id, found_programs, found_giving, found_revenue, raw_data')
      .in('entity_id', foundationIds)

    const enrichmentMap = new Map<string, EnrichmentRow[]>()
    for (const e of enrichments ?? []) {
      const row = e as EnrichmentRow
      const existing = enrichmentMap.get(row.entity_id) ?? []
      existing.push(row)
      enrichmentMap.set(row.entity_id, existing)
    }

    const upsertRows = []
    for (const foundation of foundations as FoundationRow[]) {
      const foundationEnrichments = enrichmentMap.get(foundation.id) ?? []

      const priorities: string[] = []
      let totalGiving = foundation.giving_total ?? null
      const languagePatterns: string[] = []

      for (const e of foundationEnrichments) {
        for (const p of toStringArray(e.found_programs)) {
          if (!priorities.includes(p)) priorities.push(p)
        }
        if (e.found_giving !== null && totalGiving === null) {
          totalGiving = e.found_giving
        }
        const rawPatterns = e.raw_data?.['language_patterns']
        for (const lp of toStringArray(rawPatterns)) {
          if (!languagePatterns.includes(lp)) languagePatterns.push(lp)
        }
      }

      const geoFocus: string[] = foundation.geographic_focus ? [foundation.geographic_focus] : []

      upsertRows.push({
        foundation_id: foundation.id,
        ein: foundation.ein,
        name: foundation.name,
        total_annual_giving: totalGiving,
        geographic_focus: geoFocus,
        program_priorities: priorities,
        language_patterns: languagePatterns,
        last_profiled_at: new Date().toISOString(),
        profile_data: {
          city: foundation.city,
          state: foundation.state,
          website: foundation.website,
          email: foundation.email,
          phone: foundation.phone,
        },
      })
    }

    if (upsertRows.length > 0) {
      const { error: upsertError } = await client
        .from('intelligence_grantmaker_profiles')
        .upsert(upsertRows, { onConflict: 'foundation_id' })

      if (upsertError) {
        console.error('Upsert error:', upsertError.message)
      } else {
        total += upsertRows.length
      }
    }

    processed += foundations.length
    offset += foundations.length
    console.log(`Processed ${processed} / ${limit} (stored ${total})`)

    if (foundations.length < batchLimit) break
  }

  console.log(`Done. Total stored: ${total}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
