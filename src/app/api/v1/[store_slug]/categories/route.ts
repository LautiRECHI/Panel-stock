import { NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/anon'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ store_slug: string }> }
) {
  const { store_slug } = await params
  const supabase = createAnonClient()
  const { data, error } = await supabase.rpc('public_categories', { p_store_slug: store_slug })

  if (error) return NextResponse.json({ error: 'Error interno' }, { status: 500 })

  return NextResponse.json(data ?? [], {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
