'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { z } from 'zod'

const storeSchema = z.object({
  name: z
    .string()
    .min(1, 'El nombre es requerido')
    .max(100, 'El nombre es demasiado largo'),
  slug: z
    .string()
    .min(2, 'El identificador debe tener al menos 2 caracteres')
    .max(50, 'El identificador es demasiado largo')
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'Solo letras minúsculas, números y guiones (sin empezar ni terminar con guión)'),
})

type ActionState = { error?: string } | null

export async function crearTienda(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = storeSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  })

  if (!result.success) {
    return { error: result.error.issues[0].message }
  }

  const supabase = await createClient()

  const { error } = await supabase.rpc('create_store', {
    p_name: result.data.name,
    p_slug: result.data.slug,
  })

  if (error) {
    if (error.message.includes('slug') || error.code === '23505') {
      return { error: 'Ese identificador ya está en uso. Probá con otro.' }
    }
    return { error: 'No se pudo crear la tienda. Intentá de nuevo.' }
  }

  redirect('/panel')
}
