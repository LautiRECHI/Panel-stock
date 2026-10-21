// Utilidades y tipos seguros para importar tanto en cliente como en servidor.
// El acceso a datos del lado del servidor vive en @/lib/products (server-only).

export const LOW_STOCK_THRESHOLD = 3

export type Product = {
  id: string
  store_id: string
  category_id: string | null
  name: string
  slug: string
  description: string | null
  brand: string | null
  price: number
  vat_rate: number | null
  status: 'draft' | 'active' | 'archived'
  created_at: string
  updated_at: string
}

export type ProductVariant = {
  id: string
  product_id: string
  store_id: string
  sku: string
  attributes: Record<string, string>
  price: number | null
  stock: number
  is_active: boolean
}

export type ProductImageData = {
  id: string
  path: string
  position: number
  url: string
}

export type ProductWithVariant = Product & {
  default_variant_id: string
  default_sku: string
  /** Suma del stock de todas las variantes activas */
  total_stock: number
  /** true si el producto tiene al menos una variante activa con attributes != '{}' */
  has_variants: boolean
  /** path de la imagen de portada (position=0), o null si no hay fotos */
  cover_image_path: string | null
  category_name: string | null
}

export type ProductFull = ProductWithVariant & {
  variants: ProductVariant[]
  images: ProductImageData[]
}

export type ProductFilter = {
  status?: 'draft' | 'active' | 'archived' | 'low_stock' | 'no_stock'
  search?: string
  categoryId?: string
  page?: number
}

export function parsePrice(raw: string): number {
  const cleaned = raw.trim().replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : Math.round(n * 100) / 100
}

export function formatPrice(value: number): string {
  return value.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function generateSku(name: string): string {
  const base = name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4)
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return base ? `${base}-${rand}` : rand
}

export function generateProductSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || 'producto'
  )
}
