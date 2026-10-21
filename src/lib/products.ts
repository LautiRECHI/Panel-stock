import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { LOW_STOCK_THRESHOLD } from '@/lib/products-utils'
import type { Product, ProductWithVariant, ProductFilter } from '@/lib/products-utils'

export type { Product, ProductWithVariant, ProductFilter }
export { LOW_STOCK_THRESHOLD, parsePrice, formatPrice, generateSku, generateProductSlug } from '@/lib/products-utils'

export async function getProducts(
  storeId: string,
  filter: ProductFilter = {}
): Promise<{ products: ProductWithVariant[]; total: number }> {
  const supabase = await createClient()
  const { status, search, categoryId, page = 1 } = filter
  const pageSize = 25
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const stockFilter = status === 'low_stock' || status === 'no_stock'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('products')
    .select(
      'id, store_id, category_id, name, slug, description, brand, price, vat_rate, status, created_at, updated_at',
      { count: 'exact' }
    )
    .eq('store_id', storeId)

  if (stockFilter) {
    query = query.in('status', ['draft', 'active'])
  } else if (status) {
    query = query.eq('status', status)
  } else {
    query = query.neq('status', 'archived')
  }

  if (search) query = query.ilike('name', `%${search}%`)
  if (categoryId) query = query.eq('category_id', categoryId)

  query = query.order('created_at', { ascending: false })
  if (!stockFilter) query = query.range(from, to)

  const { data: productsData, count, error } = await query
  if (error) throw new Error(error.message)
  if (!productsData?.length) return { products: [], total: 0 }

  const productIds = (productsData as { id: string }[]).map(p => p.id)

  const { data: variantsData } = await supabase
    .from('product_variants')
    .select('id, product_id, sku, stock')
    .eq('store_id', storeId)
    .in('product_id', productIds)
    .eq('attributes', '{}')

  const variantMap = new Map(
    (variantsData ?? []).map((v: { product_id: string; id: string; sku: string; stock: number }) => [
      v.product_id,
      v,
    ])
  )

  const categoryIds = [
    ...new Set(
      (productsData as { category_id: string | null }[])
        .map(p => p.category_id)
        .filter((id): id is string => Boolean(id))
    ),
  ]

  const categoryMap = new Map<string, string>()
  if (categoryIds.length > 0) {
    const { data: catsData } = await supabase
      .from('categories')
      .select('id, name')
      .eq('store_id', storeId)
      .in('id', categoryIds)
    for (const c of (catsData ?? [])) {
      categoryMap.set((c as { id: string; name: string }).id, (c as { id: string; name: string }).name)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let products: ProductWithVariant[] = (productsData as any[]).map(p => {
    const v = variantMap.get(p.id) as { id: string; sku: string; stock: number } | undefined
    return {
      id: p.id,
      store_id: p.store_id,
      category_id: p.category_id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      brand: p.brand,
      price: Number(p.price),
      vat_rate: p.vat_rate != null ? Number(p.vat_rate) : null,
      status: p.status as Product['status'],
      created_at: p.created_at,
      updated_at: p.updated_at,
      default_variant_id: v?.id ?? '',
      default_sku: v?.sku ?? '',
      stock: v?.stock ?? 0,
      category_name: p.category_id ? (categoryMap.get(p.category_id) ?? null) : null,
    }
  })

  if (status === 'low_stock') {
    products = products.filter(p => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD)
  } else if (status === 'no_stock') {
    products = products.filter(p => p.stock === 0)
  }

  const total = stockFilter ? products.length : (count ?? 0)
  if (stockFilter) products = products.slice(from, to + 1)

  return { products, total }
}

export async function getProduct(
  storeId: string,
  id: string
): Promise<ProductWithVariant | null> {
  const supabase = await createClient()

  const [{ data: productData }, { data: variantData }] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, store_id, category_id, name, slug, description, brand, price, vat_rate, status, created_at, updated_at'
      )
      .eq('store_id', storeId)
      .eq('id', id)
      .single(),
    supabase
      .from('product_variants')
      .select('id, sku, stock')
      .eq('store_id', storeId)
      .eq('product_id', id)
      .eq('attributes', '{}')
      .maybeSingle(),
  ])

  if (!productData) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = productData as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = variantData as any

  let categoryName: string | null = null
  if (p.category_id) {
    const { data: catData } = await supabase
      .from('categories')
      .select('name')
      .eq('store_id', storeId)
      .eq('id', p.category_id)
      .single()
    categoryName = (catData as { name: string } | null)?.name ?? null
  }

  return {
    id: p.id,
    store_id: p.store_id,
    category_id: p.category_id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    brand: p.brand,
    price: Number(p.price),
    vat_rate: p.vat_rate != null ? Number(p.vat_rate) : null,
    status: p.status as Product['status'],
    created_at: p.created_at,
    updated_at: p.updated_at,
    default_variant_id: v?.id ?? '',
    default_sku: v?.sku ?? '',
    stock: v?.stock ?? 0,
    category_name: categoryName,
  }
}
