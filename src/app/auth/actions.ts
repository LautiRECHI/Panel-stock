'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
})

const registroSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
})

const emailSchema = z.object({
  email: z.string().email('Email inválido'),
})

const nuevaContrasenaSchema = z
  .object({
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
    confirmacion: z.string().min(1, 'Confirmá la contraseña'),
  })
  .refine(d => d.password === d.confirmacion, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmacion'],
  })

type ActionState = { error?: string; message?: string } | null

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!result.success) {
    return { error: result.error.issues[0].message }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(result.data)

  if (error) {
    return { error: 'Email o contraseña incorrectos' }
  }

  redirect('/panel')
}

export async function registro(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = registroSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!result.success) {
    return { error: result.error.issues[0].message }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp(result.data)

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      return { error: 'Ya existe una cuenta con ese email' }
    }
    return { error: 'No se pudo crear la cuenta. Intentá de nuevo.' }
  }

  if (data.session) {
    redirect('/onboarding')
  }

  return { message: 'Revisá tu email para confirmar tu cuenta antes de continuar.' }
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function solicitarReset(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const result = emailSchema.safeParse({ email: formData.get('email') })
  if (!result.success) return { error: result.error.issues[0].message }

  const reqHeaders = await headers()
  const host = reqHeaders.get('host') ?? 'localhost:3000'
  const proto =
    host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const origin = `${proto}://${host}`

  const supabase = await createClient()
  await supabase.auth.resetPasswordForEmail(result.data.email, {
    redirectTo: `${origin}/auth/restablecer`,
  })

  // Siempre el mismo mensaje para no revelar si el email existe
  return {
    message:
      'Si ese email tiene una cuenta, vas a recibir un enlace para restablecer tu contraseña.',
  }
}

export async function restablecerContrasena(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const result = nuevaContrasenaSchema.safeParse({
    password: formData.get('password'),
    confirmacion: formData.get('confirmacion'),
  })
  if (!result.success) return { error: result.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: result.data.password })

  if (error) {
    return { error: 'No se pudo actualizar la contraseña. El enlace puede haber expirado.' }
  }

  redirect('/panel')
}

export async function cambiarContrasena(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const result = nuevaContrasenaSchema.safeParse({
    password: formData.get('password'),
    confirmacion: formData.get('confirmacion'),
  })
  if (!result.success) return { error: result.error.issues[0].message }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: result.data.password })

  if (error) return { error: 'No se pudo actualizar la contraseña. Intentá de nuevo.' }

  return { message: 'Contraseña actualizada correctamente.' }
}
