import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { OutcomeBenchmarkEngine } from '@/lib/intelligence/outcome-benchmarks'

export const runtime = 'nodejs'

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(request: Request) {
  const roleCheck = await requireRole('viewer')
  if ('error' in roleCheck) return roleCheck.error

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')?.trim()
  const geography = searchParams.get('geography')?.trim() ?? undefined

  if (!category) {
    return jsonError('category query parameter is required.', 'missing_category', 400)
  }

  const engine = new OutcomeBenchmarkEngine()
  const benchmarks = await engine.getBenchmarks(category, geography)

  return NextResponse.json({ data: benchmarks, count: benchmarks.length, category })
}
