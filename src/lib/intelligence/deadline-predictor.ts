import type { SupabaseClient } from '@supabase/supabase-js'

export interface DeadlinePrediction {
  predicted_month: number
  month_name: string
  confidence: 'high' | 'medium'
  basis: string
  days_until_next: number
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function daysUntilNextMonth(month: number, today: Date): number {
  const year = today.getUTCFullYear()
  let target = new Date(Date.UTC(year, month - 1, 1))
  if (target.getTime() <= today.getTime()) {
    target = new Date(Date.UTC(year + 1, month - 1, 1))
  }
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((target.getTime() - today.getTime()) / msPerDay)
}

/**
 * Predicts recurring deadline months for a funder by grouping this funder's
 * past opportunities by deadline month. A month that has recurred 2+ times
 * is treated as a pattern (e.g. "posts annually in March"); 3+ recurrences
 * is 'high' confidence, exactly 2 is 'medium'. Returns an empty array when
 * the funder has fewer than two dated opportunities sharing a month.
 */
export async function predictDeadlines(
  funderId: string,
  supabase: SupabaseClient,
): Promise<DeadlinePrediction[]> {
  const { data: opportunities } = await supabase
    .from('opportunities')
    .select('deadline')
    .eq('funder_id', funderId)
    .not('deadline', 'is', null)

  const rows = (opportunities ?? []) as { deadline: string | null }[]

  const counts = new Map<number, number>()
  for (const row of rows) {
    if (!row.deadline) continue
    const parsed = new Date(row.deadline)
    if (Number.isNaN(parsed.getTime())) continue
    const month = parsed.getUTCMonth() + 1
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }

  const today = new Date()
  const predictions: DeadlinePrediction[] = []

  for (const [month, count] of counts.entries()) {
    if (count < 2) continue
    const monthName = MONTH_NAMES[month - 1] ?? String(month)
    predictions.push({
      predicted_month: month,
      month_name: monthName,
      confidence: count >= 3 ? 'high' : 'medium',
      basis: `Deadline fell in ${monthName} in ${count} of ${rows.length} recorded opportunities for this funder.`,
      days_until_next: daysUntilNextMonth(month, today),
    })
  }

  return predictions.sort((a, b) => a.days_until_next - b.days_until_next)
}
