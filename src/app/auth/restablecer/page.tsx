'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { restablecerContrasena } from '@/app/auth/actions'

type ActionState = { error?: string; message?: string } | null
type EstadoEnlace = 'verificando' | 'listo' | 'invalido'

export default function RestablecerPage() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    restablecerContrasena,
    null
  )
  const [estadoEnlace, setEstadoEnlace] = useState<EstadoEnlace>('verificando')

  useEffect(() => {
    const supabase = createClient()

    // PKCE: el enlace trae ?code=xxx
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          setEstadoEnlace('invalido')
        } else {
          setEstadoEnlace('listo')
          // Limpiar el code de la URL sin navegar
          window.history.replaceState({}, '', '/auth/restablecer')
        }
      })
      return
    }

    // Implicit: el SDK detecta #access_token automáticamente vía onAuthStateChange
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setEstadoEnlace('listo')
      }
    })

    // Verificar si ya hay sesión activa (p.ej. navegación directa)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setEstadoEnlace('listo')
      } else {
        // Dar tiempo al SDK para procesar el hash antes de mostrar error
        setTimeout(() => {
          setEstadoEnlace(prev => prev === 'verificando' ? 'invalido' : prev)
        }, 1500)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (estadoEnlace === 'verificando') {
    return (
      <main className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-card rounded-card border border-border p-8 shadow-sm">
            <span
              className="w-8 h-8 border-2 border-foreground border-t-transparent rounded-full animate-spin inline-block"
              aria-hidden="true"
            />
            <p className="text-sm text-muted mt-4">Verificando enlace…</p>
          </div>
        </div>
      </main>
    )
  }

  if (estadoEnlace === 'invalido') {
    return (
      <main className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-card rounded-card border border-border p-8 shadow-sm text-center">
            <div className="w-12 h-12 bg-stock-none-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-stock-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Enlace inválido</h2>
            <p className="text-muted text-sm mb-6">
              El enlace expiró o ya fue usado. Pedí un nuevo email de restablecimiento.
            </p>
            <Link
              href="/login"
              className="text-sm text-foreground font-medium hover:underline focus:outline-none focus-visible:underline"
            >
              Volver al login
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Nueva contraseña</h1>
          <p className="text-muted text-sm mt-1">Elegí una contraseña segura para tu cuenta</p>
        </div>

        <div className="bg-card rounded-card border border-border p-6 shadow-sm">
          {state?.error && (
            <div className="mb-4 bg-stock-none-bg border border-stock-none/20 text-stock-none text-sm rounded-input px-3 py-2.5">
              {state.error}
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Nueva contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full h-11 px-3 rounded-input border border-border bg-white text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
                placeholder="Mínimo 8 caracteres"
              />
            </div>

            <div>
              <label
                htmlFor="confirmacion"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Confirmá la contraseña
              </label>
              <input
                id="confirmacion"
                name="confirmacion"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full h-11 px-3 rounded-input border border-border bg-white text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
                placeholder="Repetí la contraseña"
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full h-11 bg-foreground text-white rounded-input font-medium text-sm hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground/50 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
            >
              {isPending ? 'Guardando...' : 'Guardar contraseña'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
