import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GrantDNAScorer } from '@/lib/intelligence/grant-dna'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as {
    sections?: unknown
    category?: unknown
    grant_type?: unknown
  }
  const { sections, category, grant_type } = body

  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return NextResponse.json(
      { error: 'sections must be a non-empty Record<string, string>' },
      { status: 400 },
    )
  }

  const scorer = new GrantDNAScorer()
  const score = await scorer.scoreProposal(
    sections as Record<string, string>,
    typeof grant_type === 'string' ? grant_type : undefined,
  )
  const benchmark = scorer.benchmarkAgainstFunded(
    score,
    typeof category === 'string' ? category : 'default',
  )

  return NextResponse.json({ ...score, ...benchmark })
}
