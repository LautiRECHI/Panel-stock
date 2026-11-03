// GET /api/v1/[store_slug]/products
// Parámetros de query aceptados:
//   category    — slug de la categoría raíz (opcional)
//   subcategory — slug de la subcategoría; solo filtra cuando category está presente (opcional)
//   search      — texto libre; busca en nombre y marca, máx. 100 chars (opcional)
//   limit       — resultados por página, 1-60, defecto 24 (opcional)
//   offset      — desplazamiento para paginación, defecto 0 (opcional)
// La respuesta incluye `total` (total sin paginar), `cover_url`, `images` (URLs de las primeras
// 5 fotos), `default_variant_id` y `default_max_quantity` por producto.

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
  { params }: { params: Promise<{ store_slug: string }> },
) {
  const { store_slug } = await params
  const origin = req.headers.get('Origin')
  const url = new URL(req.url)
  const q = url.searchParams

  const category    = q.get('category')    ?? null
  const subcategory = q.get('subcategory') ?? null
  const search      = q.get('search')      ?? null

  if (
    !validSlug(store_slug) ||
    (category    && !validSlug(category)) ||
    (subcategory && !validSlug(subcategory)) ||
    (search !== null && search.trim().length > 100)
  ) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400, headers: corsHeaders(origin) })
  }

  const rawLimit  = parseInt(q.get('limit')  ?? '24', 10)
  const rawOffset = parseInt(q.get('offset') ?? '0',  10)
  const limit  = Number.isFinite(rawLimit)  ? Math.min(Math.max(rawLimit,  1), 60) : 24
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0)               : 0

  const supabase = createAnonClient()
  const { data, error } = await supabase.rpc('public_products', {
    p_store_slug:       store_slug,
    p_category_slug:    category,
    p_subcategory_slug: subcategory,
    p_search:           search?.trim() || null,
    p_limit:            limit,
    p_offset:           offset,
  })

  if (error) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500, headers: corsHeaders(origin) })
  }

  const items = (data ?? []) as Record<string, unknown>[]
  const total = items[0]?.total_count ?? 0

  const stripped = items.map(item => {
    const out = { ...item }
    delete out.total_count
    out.cover_url = typeof out.cover_path === 'string' ? toImageUrl(out.cover_path) : null
    const rawPaths = out.image_paths as string[] | null
    out.images = Array.isArray(rawPaths) ? rawPaths.map(p => toImageUrl(p)) : []
    delete out.image_paths
    return out
  })

  return NextResponse.json(
    { items: stripped, total, limit, offset },
    { headers: { ...corsHeaders(origin), 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } },
  )
}
