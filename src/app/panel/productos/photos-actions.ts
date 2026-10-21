'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { ActionResult } from './actions'

async function resolveStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id').limit(1)
  return (stores as { id: string }[] | null)?.[0]?.id ?? null
}

export async function uploadPhotos(
  productId: string,
  formData: FormData
): Promise<{ success: boolean; uploaded: number; failed: string[] }> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, uploaded: 0, failed: [] }

  const supabase = await createClient()
  const photos = formData.getAll('photos') as File[]

  if (!photos.length) return { success: true, uploaded: 0, failed: [] }

  // Obtener la última posición usada
  const { data: existing } = await supabase
    .from('product_images')
    .select('position')
    .eq('store_id', storeId)
    .eq('product_id', productId)
    .order('position', { ascending: false })
    .limit(1)

  let nextPosition = ((existing as { position: number }[] | null)?.[0]?.position ?? -1) + 1

  let uploaded = 0
  const failed: string[] = []

  for (const photo of photos) {
    const uuid = crypto.randomUUID()
    // Determinar extensión basada en tipo MIME
    const ext = photo.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${storeId}/products/${productId}/${uuid}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(path, photo, { contentType: photo.type, upsert: false })

    if (uploadError) {
      failed.push(photo.name)
      continue
    }

    const { error: insertError } = await supabase
      .from('product_images')
      .insert({
        store_id: storeId,
        product_id: productId,
        path,
        position: nextPosition,
      })

    if (insertError) {
      // Intentar limpiar el archivo subido
      await supabase.storage.from('product-images').remove([path])
      failed.push(photo.name)
      continue
    }

    nextPosition++
    uploaded++
  }

  revalidatePath(`/panel/productos/${productId}`)
  revalidatePath('/panel/productos')

  return { success: true, uploaded, failed }
}

export async function deletePhoto(photoId: string): Promise<ActionResult> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()

  // Obtener la foto
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

  // Borrar del Storage
  const { error: storageError } = await supabase.storage
    .from('product-images')
    .remove([photo.path])

  if (storageError) {
    return { success: false, error: 'No se pudo eliminar la imagen del almacenamiento.' }
  }

  // Borrar el registro de la BD
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

export async function reorderPhoto(
  photoId: string,
  direction: 'left' | 'right'
): Promise<ActionResult> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()

  // Obtener la foto actual
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
  const neighborPosition = direction === 'left' ? photo.position - 1 : photo.position + 1

  // Obtener el vecino
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

  // Intercambiar posiciones
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
