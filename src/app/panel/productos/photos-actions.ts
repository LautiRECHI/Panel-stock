'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from './actions'

async function resolveStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id').limit(1)
  return (stores as { id: string }[] | null)?.[0]?.id ?? null
}

/**
 * Registra en la BD una imagen ya subida a Storage.
 * La posición se calcula automáticamente (max+1) para evitar condiciones de carrera.
 */
export async function registerPhoto(
  productId: string,
  path: string
): Promise<ActionResult & { id?: string }> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('product_images')
    .select('position')
    .eq('store_id', storeId)
    .eq('product_id', productId)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition =
    ((existing as { position: number }[] | null)?.[0]?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('product_images')
    .insert({ store_id: storeId, product_id: productId, path, position: nextPosition })
    .select('id')
    .single()

  if (error) {
    return { success: false, error: 'No se pudo registrar la foto.' }
  }

  revalidatePath(`/panel/productos/${productId}`)
  revalidatePath('/panel/productos')
  return { success: true, id: (data as { id: string }).id }
}

export async function deletePhoto(photoId: string): Promise<ActionResult> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()

  const { data: photoData, error: fetchError } = await supabase
    .from('product_images')
    .select('path, product_id, position')
    .eq('id', photoId)
    .eq('store_id', storeId)
    .single()

  if (fetchError || !photoData) {
    return { success: false, error: 'No se encontró la foto.' }
  }

  const photo = photoData as { path: string; product_id: string; position: number }

  const { error: storageError } = await supabase.storage
    .from('product-images')
    .remove([photo.path])

  if (storageError) {
    return { success: false, error: 'No se pudo eliminar la imagen del almacenamiento.' }
  }

  const { error: deleteError } = await supabase
    .from('product_images')
    .delete()
    .eq('id', photoId)
    .eq('store_id', storeId)

  if (deleteError) {
    return { success: false, error: 'No se pudo eliminar la foto.' }
  }

  // Renumerar posiciones consecutivamente
  const { data: remaining } = await supabase
    .from('product_images')
    .select('id, position')
    .eq('store_id', storeId)
    .eq('product_id', photo.product_id)
    .order('position', { ascending: true })

  if (remaining?.length) {
    for (let i = 0; i < remaining.length; i++) {
      const row = remaining[i] as { id: string; position: number }
      if (row.position !== i) {
        await supabase
          .from('product_images')
          .update({ position: i })
          .eq('id', row.id)
          .eq('store_id', storeId)
      }
    }
  }

  revalidatePath(`/panel/productos/${photo.product_id}`)
  revalidatePath('/panel/productos')
  return { success: true }
}

export async function bulkSetPhotoPositions(
  updates: { id: string; position: number }[],
  productId: string
): Promise<ActionResult> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()
  for (const { id, position } of updates) {
    await supabase
      .from('product_images')
      .update({ position })
      .eq('id', id)
      .eq('store_id', storeId)
  }
  revalidatePath(`/panel/productos/${productId}`)
  return { success: true }
}

export async function reorderPhoto(
  photoId: string,
  direction: 'left' | 'right'
): Promise<ActionResult> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()

  const { data: photoData, error: fetchError } = await supabase
    .from('product_images')
    .select('position, product_id')
    .eq('id', photoId)
    .eq('store_id', storeId)
    .single()

  if (fetchError || !photoData) {
    return { success: false, error: 'No se encontró la foto.' }
  }

  const photo = photoData as { position: number; product_id: string }
  const neighborPosition =
    direction === 'left' ? photo.position - 1 : photo.position + 1

  const { data: neighborData, error: neighborError } = await supabase
    .from('product_images')
    .select('id')
    .eq('store_id', storeId)
    .eq('product_id', photo.product_id)
    .eq('position', neighborPosition)
    .single()

  if (neighborError || !neighborData) {
    return { success: false, error: 'No hay foto en esa posición.' }
  }

  const neighbor = neighborData as { id: string }

  const { error: e1 } = await supabase
    .from('product_images')
    .update({ position: neighborPosition })
    .eq('id', photoId)
    .eq('store_id', storeId)

  if (e1) return { success: false, error: 'No se pudo reordenar la foto.' }

  const { error: e2 } = await supabase
    .from('product_images')
    .update({ position: photo.position })
    .eq('id', neighbor.id)
    .eq('store_id', storeId)

  if (e2) return { success: false, error: 'No se pudo reordenar la foto.' }

  revalidatePath(`/panel/productos/${photo.product_id}`)
  return { success: true }
}
