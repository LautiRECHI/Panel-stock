import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { LOW_STOCK_THRESHOLD } from '@/lib/products-utils'
import type {
  Product,
  ProductWithVariant,
  ProductVariant,
  ProductImageData,
  ProductFull,
  ProductFilter,
} from '@/lib/products-utils'

export type { Product, ProductWithVariant, ProductVariant, ProductImageData, ProductFull, ProductFilter }
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

  // Obtener todas las variantes activas de estos productos
  const { data: variantsData } = await supabase
    .from('product_variants')
    .select('id, product_id, store_id, sku, attributes, price, stock, is_active')
    .eq('store_id', storeId)
    .in('product_id', productIds)
    .eq('is_active', true)

  // Mapa: product_id → lista de variantes activas
  const variantsByProduct = new Map<string, { id: string; sku: string; attributes: Record<string, string>; price: number | null; stock: number; is_active: boolean }[]>()
  for (const v of (variantsData ?? [])) {
    const row = v as { id: string; product_id: string; store_id: string; sku: string; attributes: Record<string, string>; price: string | null; stock: number; is_active: boolean }
    const list = variantsByProduct.get(row.product_id) ?? []
    list.push({
      id: row.id,
      sku: row.sku,
      attributes: row.attributes ?? {},
      price: row.price != null ? Number(row.price) : null,
      stock: row.stock,
      is_active: row.is_active,
    })
    variantsByProduct.set(row.product_id, list)
  }

  // Obtener imágenes de portada (position=0)
  const { data: coverData } = await supabase
    .from('product_images')
    .select('product_id, path')
    .eq('store_id', storeId)
    .in('product_id', productIds)
    .eq('position', 0)

  const coverMap = new Map<string, string>()
  for (const img of (coverData ?? [])) {
    const row = img as { product_id: string; path: string }
    coverMap.set(row.product_id, row.path)
  }

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
    const variants = variantsByProduct.get(p.id) ?? []
    const defaultVariant = variants.find(v => {
      const attrs = v.attributes
      return Object.keys(attrs).length === 0
    })
    const totalStock = variants.reduce((sum, v) => sum + v.stock, 0)
    const hasVariants = variants.some(v => Object.keys(v.attributes).length > 0)

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
      default_variant_id: defaultVariant?.id ?? '',
      default_sku: defaultVariant?.sku ?? '',
      total_stock: totalStock,
      has_variants: hasVariants,
      cover_image_path: coverMap.get(p.id) ?? null,
      category_name: p.category_id ? (categoryMap.get(p.category_id) ?? null) : null,
    }
  })

  if (status === 'low_stock') {
    products = products.filter(p => p.total_stock > 0 && p.total_stock <= LOW_STOCK_THRESHOLD)
  } else if (status === 'no_stock') {
    products = products.filter(p => p.total_stock === 0)
  }

  const total = stockFilter ? products.length : (count ?? 0)
  if (stockFilter) products = products.slice(from, to + 1)

  return { products, total }
}

export async function getProduct(
  storeId: string,
  id: string
): Promise<ProductFull | null> {
  const supabase = await createClient()

  const [
    { data: productData },
    { data: variantsData },
    { data: imagesData },
  ] = await Promise.all([
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
      .select('id, product_id, store_id, sku, attributes, price, stock, is_active')
      .eq('store_id', storeId)
      .eq('product_id', id)
      .eq('is_active', true),
    supabase
      .from('product_images')
      .select('id, path, position')
      .eq('store_id', storeId)
      .eq('product_id', id)
      .order('position', { ascending: true }),
  ])

  if (!productData) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = productData as any
  const variants: ProductVariant[] = (variantsData ?? []).map(v => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = v as any
    return {
      id: row.id,
      product_id: row.product_id,
      store_id: row.store_id,
      sku: row.sku,
      attributes: row.attributes ?? {},
      price: row.price != null ? Number(row.price) : null,
      stock: row.stock,
      is_active: row.is_active,
    }
  })

  const defaultVariant = variants.find(v => Object.keys(v.attributes).length === 0)
  const totalStock = variants.reduce((sum, v) => sum + v.stock, 0)
  const hasVariants = variants.some(v => Object.keys(v.attributes).length > 0)

  // Imágenes con URL pública
  const images: ProductImageData[] = (imagesData ?? []).map(img => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = img as any
    const url = supabase.storage
      .from('product-images')
      .getPublicUrl(row.path).data.publicUrl
    return {
      id: row.id,
      path: row.path,
      position: row.position,
      url,
    }
  })

  const coverImagePath = images.find(i => i.position === 0)?.path ?? null

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
    default_variant_id: defaultVariant?.id ?? '',
    default_sku: defaultVariant?.sku ?? '',
    total_stock: totalStock,
    has_variants: hasVariants,
    cover_image_path: coverImagePath,
    category_name: categoryName,
    variants,
    images,
  }
}
