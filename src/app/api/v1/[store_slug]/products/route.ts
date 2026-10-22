import { NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/anon'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ store_slug: string }> }
) {
  const { store_slug } = await params
  const url = new URL(req.url)
  const q = url.searchParams

  const limit  = Math.min(Math.max(parseInt(q.get('limit')  ?? '24', 10) || 24, 1), 60)
  const offset = Math.max(parseInt(q.get('offset') ?? '0',  10) || 0, 0)

  const supabase = createAnonClient()
  const { data, error } = await supabase.rpc('public_products', {
    p_store_slug:       store_slug,
    p_category_slug:    q.get('category')    ?? null,
    p_subcategory_slug: q.get('subcategory') ?? null,
    p_search:           q.get('q')           ?? null,
    p_limit:            limit,
    p_offset:           offset,
  })

  if (error) return NextResponse.json({ error: 'Error interno' }, { status: 500 })

  const items = (data ?? []) as Record<string, unknown>[]
  const total = items[0]?.total_count ?? 0

  const stripped = items.map(item => {
    const out = { ...item }
    delete out.total_count
    return out
  })

  return NextResponse.json(
    { items: stripped, total, limit, offset },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } }
  )
}
