'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from './actions'

async function resolveStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id').limit(1)
  return (stores as { id: string }[] | null)?.[0]?.id ?? null
}

const variantRowSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().min(1, 'El SKU no puede estar vacío'),
  attributes: z.record(z.string(), z.string()),
  price: z.string().nullable(),
  stock: z.number().int().min(0, 'El stock no puede ser negativo'),
})

const upsertSchema = z.object({
  productId: z.string().uuid('ID de producto inválido'),
  variants: z.array(variantRowSchema),
  reason: z.string().min(1),
})

export async function upsertVariants(
  productId: string,
  variants: Array<{
    id?: string
    sku: string
    attributes: Record<string, string>
    price: string | null
    stock: number
  }>,
  reason: string
): Promise<ActionResult> {
  const label = `[upsertVariants pid=${productId.slice(-8)} reason=${reason}]`
  console.time(label)

  try {
    const parsed = upsertSchema.safeParse({ productId, variants, reason })
    if (!parsed.success) {
      console.error(label, 'Zod error:', parsed.error.issues[0].code, parsed.error.issues[0].message)
      console.timeEnd(label)
      return { success: false, error: parsed.error.issues[0].message }
    }

    const storeId = await resolveStoreId()
    if (!storeId) {
      console.error(label, 'resolveStoreId: null — usuario sin tienda o sin sesión')
      console.timeEnd(label)
      return { success: false, error: 'No autenticado.' }
    }

    console.log(label, `variantes a enviar: ${parsed.data.variants.length}`)

    const supabase = await createClient()

    // Convertir a formato compatible con la función SQL
    const rpcVariants = parsed.data.variants.map(v => ({
      ...(v.id ? { id: v.id } : {}),
      sku: v.sku,
      attributes: v.attributes,
      price: v.price,
      stock: v.stock,
    }))

    const { error } = await supabase.rpc('upsert_variants', {
      p_store_id: storeId,
      p_product_id: productId,
      p_variants: rpcVariants,
      p_reason: reason,
    })

    if (error) {
      console.error(label, `RPC error — code: ${error.code} | msg: ${error.message}${error.details ? ` | details: ${error.details}` : ''}`)
      console.timeEnd(label)
      if (error.code === 'P0002') {
        return { success: false, error: 'No tenés acceso a estas variantes.' }
      }
      if (error.code === '23505') {
        return { success: false, error: 'Un SKU ya está en uso. Cambialo e intentá de nuevo.' }
      }
      return { success: false, error: 'No se pudieron guardar las variantes.' }
    }

    console.timeEnd(label)
    revalidatePath('/panel/productos')
    revalidatePath(`/panel/productos/${productId}`)
    return { success: true }
  } catch (e) {
    console.error(label, 'excepción no esperada:', e)
    console.timeEnd(label)
    return { success: false, error: 'Error inesperado al guardar las variantes.' }
  }
}

export async function setVariantStock(
  variantId: string,
  newStock: number,
  reason: string
): Promise<ActionResult> {
  const parsed = z.object({
    variantId: z.string().uuid(),
    newStock: z.number().int().min(0, 'El stock no puede ser negativo'),
    reason: z.string().min(1),
  }).safeParse({ variantId, newStock, reason })

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()

  const { error } = await supabase.rpc('set_stock', {
    p_variant_id: variantId,
    p_new_stock: newStock,
    p_reason: reason,
  })

  if (error) {
    return { success: false, error: 'No se pudo actualizar el stock.' }
  }

  return { success: true }
}

export async function setDefaultVariantStockZero(
  variantId: string,
  reason: string
): Promise<ActionResult> {
  return setVariantStock(variantId, 0, reason)
}
