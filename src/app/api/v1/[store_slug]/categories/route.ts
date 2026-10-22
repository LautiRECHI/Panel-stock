import { NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/anon'
import { corsHeaders, preflightResponse, validSlug } from '@/lib/api-cors'

export async function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get('Origin'))
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ store_slug: string }> },
) {
  const { store_slug } = await params
  const origin = req.headers.get('Origin')

  if (!validSlug(store_slug)) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400, headers: corsHeaders(origin) })
  }

  const supabase = createAnonClient()
  const { data, error } = await supabase.rpc('public_categories', { p_store_slug: store_slug })

  if (error) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: corsHeaders(origin) })
  }

  return NextResponse.json(data ?? [], {
    headers: { ...corsHeaders(origin), 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
