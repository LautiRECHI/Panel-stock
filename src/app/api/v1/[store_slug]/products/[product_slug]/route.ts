import { NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/anon'
import { corsHeaders, preflightResponse, validSlug } from '@/lib/api-cors'

function toImageUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${path}`
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get('Origin'))
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ store_slug: string; product_slug: string }> },
) {
  const { store_slug, product_slug } = await params
  const origin = req.headers.get('Origin')

  if (!validSlug(store_slug) || !validSlug(product_slug)) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400, headers: corsHeaders(origin) })
  }

  const supabase = createAnonClient()
  const { data, error } = await supabase.rpc('public_product', {
    p_store_slug:   store_slug,
    p_product_slug: product_slug,
  })

  if (error) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: corsHeaders(origin) })
  }
  if (!data || (data as unknown[]).length === 0) {
    return NextResponse.json(null, { status: 404, headers: corsHeaders(origin) })
  }

  type ProductRow = {
    images: Array<{ path: string }>
    [key: string]: unknown
  }

  const product = (data as unknown[])[0] as ProductRow
  const transformed = {
    ...product,
    images: product.images.map(img => ({ ...img, url: toImageUrl(img.path) })),
  }

  return NextResponse.json(transformed, {
    headers: { ...corsHeaders(origin), 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
  })
}
