'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { generateProductSlug, generateSku, parsePrice } from '@/lib/products-utils'

export type ActionResult = { success: true } | { success: false; error: string }

async function resolveStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id').limit(1)
  return (stores as { id: string }[] | null)?.[0]?.id ?? null
}

// ─── Crear ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(200),
  priceRaw: z.string().min(1, 'El precio es requerido'),
  stock: z.number().int().min(0, 'El stock no puede ser negativo'),
  description: z.string().max(2000).optional(),
  brand: z.string().max(100).optional(),
  status: z.enum(['draft', 'active']),
  categoryId: z.string().uuid().nullable().optional(),
  sku: z.string().max(100).optional(),
})

export async function createProduct(
  input: z.infer<typeof createSchema>
): Promise<ActionResult & { productId?: string }> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const { name, priceRaw, stock, description, brand, status, categoryId, sku } = parsed.data
  const price = parsePrice(priceRaw)

  const supabase = await createClient()

  // Slug único en la tienda
  const base = generateProductSlug(name)
  const { data: existing } = await supabase
    .from('products')
    .select('slug')
    .eq('store_id', storeId)
    .ilike('slug', `${base}%`)

  const usedSlugs = new Set((existing as { slug: string }[] | null ?? []).map(p => p.slug))
  let slug = base
  let counter = 2
  while (usedSlugs.has(slug)) slug = `${base}-${counter++}`

  const finalSku = sku?.trim() || generateSku(name)

  const { data: productId, error } = await supabase.rpc('create_product', {
    p_store_id: storeId,
    p_name: name.trim(),
    p_slug: slug,
    p_price: price,
    p_status: status,
    p_description: description?.trim() || null,
    p_brand: brand?.trim() || null,
    p_category_id: categoryId ?? null,
    p_sku: finalSku,
    p_stock: stock,
  })

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'El SKU ya está en uso. Ingresá uno diferente.' }
    }
    return { success: false, error: 'No se pudo crear el producto.' }
  }

  revalidatePath('/panel/productos')
  return { success: true, productId: productId as string }
}

// ─── Actualizar ───────────────────────────────────────────────────────────────

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'El nombre es requerido').max(200),
  priceRaw: z.string().min(1, 'El precio es requerido'),
  description: z.string().max(2000).optional(),
  brand: z.string().max(100).optional(),
  status: z.enum(['draft', 'active']),
  categoryId: z.string().uuid().nullable().optional(),
  sku: z.string().max(100).optional(),
})

export async function updateProduct(
  input: z.infer<typeof updateSchema>
): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const { id, name, priceRaw, description, brand, status, categoryId, sku } = parsed.data
  const price = parsePrice(priceRaw)
  const supabase = await createClient()

  const { error } = await supabase
    .from('products')
    .update({
      name: name.trim(),
      description: description?.trim() || null,
      brand: brand?.trim() || null,
      price,
      status,
      category_id: categoryId ?? null,
    })
    .eq('id', id)
    .eq('store_id', storeId)

  if (error) {
    console.error(`[updateProduct pid=${id.slice(-8)}] DB error — code: ${error.code} | msg: ${error.message}`)
    return { success: false, error: 'No se pudo actualizar el producto.' }
  }

  if (sku?.trim()) {
    const { error: skuError } = await supabase
      .from('product_variants')
      .update({ sku: sku.trim() })
      .eq('product_id', id)
      .eq('store_id', storeId)
      .eq('attributes', '{}')

    if (skuError) {
      console.error(`[updateProduct pid=${id.slice(-8)}] SKU error — code: ${skuError.code} | msg: ${skuError.message}`)
      if (skuError.code === '23505')
        return { success: false, error: 'El SKU ya está en uso. Ingresá uno diferente.' }
      return { success: false, error: 'No se pudo actualizar el SKU.' }
    }
  }

  revalidatePath('/panel/productos')
  revalidatePath(`/panel/productos/${id}`)
  return { success: true }
}

// ─── Archivar ─────────────────────────────────────────────────────────────────

export async function archiveProduct(id: string): Promise<ActionResult> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('products')
    .update({ status: 'archived' })
    .eq('id', id)
    .eq('store_id', storeId)

  if (error) return { success: false, error: 'No se pudo archivar el producto.' }

  revalidatePath('/panel/productos')
  return { success: true }
}

// ─── Ajustar stock ────────────────────────────────────────────────────────────

export async function adjustStock(
  variantId: string,
  delta: number,
  reason: string
): Promise<ActionResult & { newStock?: number }> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_variant_id: variantId,
    p_delta: delta,
    p_reason: reason,
  })

  if (error) {
    if (error.code === '23514') return { success: false, error: 'El stock no puede ser negativo.' }
    return { success: false, error: 'No se pudo actualizar el stock.' }
  }

  revalidatePath('/panel/productos')
  return { success: true, newStock: data as number }
}
