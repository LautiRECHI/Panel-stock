'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { generateSlug } from '@/lib/categories'

export type ActionResult = { success: true } | { success: false; error: string }

// Obtiene el store_id de la tienda activa del usuario autenticado.
// Nunca confía en parámetros del cliente.
async function resolveStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: stores } = await supabase
    .from('stores')
    .select('id')
    .limit(1)
  return stores?.[0]?.id ?? null
}

// ─── Crear ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(100),
  parentId: z.string().uuid().nullable().optional(),
})

export async function createCategory(input: {
  name: string
  parentId?: string | null
}): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { name, parentId = null } = parsed.data

  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()

  // Slug único entre hermanos (mismo parent_id), no en toda la tienda
  const base = generateSlug(name)

  let sibSlugQuery = supabase
    .from('categories')
    .select('slug')
    .eq('store_id', storeId)

  sibSlugQuery = parentId
    ? sibSlugQuery.eq('parent_id', parentId)
    : sibSlugQuery.is('parent_id', null)

  const { data: sibSlugs } = await sibSlugQuery
  const used = new Set(sibSlugs?.map((c) => c.slug) ?? [])

  let slug = base
  let counter = 2
  while (used.has(slug)) slug = `${base}-${counter++}`

  // Posición al final del grupo de hermanos
  let posQuery = supabase
    .from('categories')
    .select('position')
    .eq('store_id', storeId)

  posQuery = parentId
    ? posQuery.eq('parent_id', parentId)
    : posQuery.is('parent_id', null)

  const { data: siblings } = await posQuery
  const maxPos = siblings?.length
    ? Math.max(...siblings.map((s) => s.position))
    : -1

  const { error } = await supabase.from('categories').insert({
    store_id: storeId,
    name: name.trim(),
    slug,
    parent_id: parentId,
    position: maxPos + 1,
  })

  if (error) return { success: false, error: 'No se pudo crear la categoría.' }

  revalidatePath('/panel/categorias')
  return { success: true }
}

// ─── Renombrar ────────────────────────────────────────────────────────────────

const renameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'El nombre es requerido').max(100),
})

export async function renameCategory(
  id: string,
  name: string
): Promise<ActionResult> {
  const parsed = renameSchema.safeParse({ id, name })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('categories')
    .update({ name: name.trim() })
    .eq('id', id)
    .eq('store_id', storeId)

  if (error) return { success: false, error: 'No se pudo renombrar la categoría.' }

  revalidatePath('/panel/categorias')
  return { success: true }
}

// ─── Mover (subir / bajar) ────────────────────────────────────────────────────

export async function moveCategory(
  id: string,
  direction: 'up' | 'down'
): Promise<ActionResult> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()

  const { data: cat } = await supabase
    .from('categories')
    .select('id, parent_id, position')
    .eq('id', id)
    .eq('store_id', storeId)
    .single()

  if (!cat) return { success: false, error: 'Categoría no encontrada.' }

  let sibQuery = supabase
    .from('categories')
    .select('id, position')
    .eq('store_id', storeId)
    .order('position', { ascending: true })
    .order('name', { ascending: true })

  sibQuery = cat.parent_id
    ? sibQuery.eq('parent_id', cat.parent_id)
    : sibQuery.is('parent_id', null)

  const { data: rawSiblings } = await sibQuery
  if (!rawSiblings?.length) return { success: true }

  // Normalizar posiciones para evitar empates antes del swap
  const siblings = rawSiblings.map((s, i) => ({ id: s.id, position: i }))
  const idx = siblings.findIndex((s) => s.id === id)

  if (direction === 'up' && idx <= 0) return { success: true }
  if (direction === 'down' && idx >= siblings.length - 1) return { success: true }

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  siblings[idx].position = swapIdx
  siblings[swapIdx].position = idx

  for (const s of siblings) {
    await supabase
      .from('categories')
      .update({ position: s.position })
      .eq('id', s.id)
      .eq('store_id', storeId)
  }

  revalidatePath('/panel/categorias')
  return { success: true }
}

// ─── Eliminar ─────────────────────────────────────────────────────────────────

export async function deleteCategory(id: string): Promise<ActionResult> {
  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()

  // Bloquear si tiene productos asociados
  const { count } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', id)
    .eq('store_id', storeId)

  if (count && count > 0) {
    return {
      success: false,
      error: `Esta categoría tiene ${count} producto${count > 1 ? 's' : ''} asociado${count > 1 ? 's' : ''}. Desasociá los productos antes de eliminarla.`,
    }
  }

  // Las subcategorías quedan con parent_id = null por FK SET NULL
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id)
    .eq('store_id', storeId)

  if (error) return { success: false, error: 'No se pudo eliminar la categoría.' }

  revalidatePath('/panel/categorias')
  return { success: true }
}
