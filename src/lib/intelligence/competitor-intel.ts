import type { SupabaseClient } from '@supabase/supabase-js'

export interface CompetitorIntelEntry {
  name: string
  total_received: number
  years_funded: number
}

interface RecipientRow {
  recipient_name: string
  amount: number
  fiscal_year: number | null
}

function toRecipientRows(raw: unknown): RecipientRow[] {
  if (!Array.isArray(raw)) return []
  const rows: RecipientRow[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const r = entry as Record<string, unknown>
    const name = r['recipient_name']
    if (typeof name !== 'string' || name.trim() === '') continue
    const amount = typeof r['amount'] === 'number' ? r['amount'] : 0
    const fiscalYear = typeof r['fiscal_year'] === 'number' ? r['fiscal_year'] : null
    rows.push({ recipient_name: name.trim(), amount, fiscal_year: fiscalYear })
  }
  return rows
}

/**
 * Mines a foundation's `enrichment` jsonb (foundation_directory) for 990-derived
 * grant recipient data (grant_recipients — see scripts/enrich-foundations-990.ts
 * for the enrichment writer). Groups by recipient name and sums amounts to
 * surface which organizations most consistently receive funding from this
 * foundation — i.e. competitors for the same dollars. Returns an empty array
 * when the foundation has no recipient-level data.
 */
export async function getCompetitorIntel(
  foundationId: string,
  supabase: SupabaseClient,
): Promise<CompetitorIntelEntry[]> {
  const { data: foundation } = await supabase
    .from('foundation_directory')
    .select('enrichment')
    .eq('id', foundationId)
    .maybeSingle()

  const enrichment = (foundation?.enrichment ?? {}) as Record<string, unknown>
  const recipients = toRecipientRows(enrichment['grant_recipients'])

  if (recipients.length === 0) return []

  const grouped = new Map<string, { name: string; total_received: number; years: Set<number> }>()
  for (const row of recipients) {
    const key = row.recipient_name.toLowerCase()
    const existing = grouped.get(key)
    if (existing) {
      existing.total_received += row.amount
      if (row.fiscal_year !== null) existing.years.add(row.fiscal_year)
    } else {
      grouped.set(key, {
        name: row.recipient_name,
        total_received: row.amount,
        years: new Set(row.fiscal_year !== null ? [row.fiscal_year] : []),
      })
    }
  }

  return Array.from(grouped.values())
    .map((g) => ({
      name: g.name,
      total_received: g.total_received,
      years_funded: g.years.size,
    }))
    .sort((a, b) => b.total_received - a.total_received)
    .slice(0, 10)
}
