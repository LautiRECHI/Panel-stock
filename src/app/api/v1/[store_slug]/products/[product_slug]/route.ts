import { NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/anon'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ store_slug: string; product_slug: string }> }
) {
  const { store_slug, product_slug } = await params
  const supabase = createAnonClient()
  const { data, error } = await supabase.rpc('public_product', {
    p_store_slug:   store_slug,
    p_product_slug: product_slug,
  })

  if (error) return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  if (!data || (data as unknown[]).length === 0) return NextResponse.json(null, { status: 404 })

  return NextResponse.json((data as unknown[])[0], {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
  })
}
