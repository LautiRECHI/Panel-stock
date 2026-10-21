'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { registro } from '@/app/auth/actions'

type ActionState = { error?: string; message?: string } | null

export default function RegistroPage() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(registro, null)

  if (state?.message) {
    return (
      <main className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-card rounded-card border border-border p-8 shadow-sm">
            <div className="w-12 h-12 bg-stock-ok-bg rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-stock-ok" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Revisá tu email</h2>
            <p className="text-muted text-sm">{state.message}</p>
            <Link
              href="/login"
              className="inline-block mt-6 text-sm text-foreground font-medium hover:underline"
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
          <h1 className="text-2xl font-semibold text-foreground">Creá tu cuenta</h1>
          <p className="text-muted text-sm mt-1">Empezá a gestionar tu tienda</p>
        </div>

        <div className="bg-card rounded-card border border-border p-6 shadow-sm">
          {state?.error && (
            <div className="mb-4 bg-stock-none-bg border border-stock-none/20 text-stock-none text-sm rounded-input px-3 py-2.5">
              {state.error}
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full h-11 px-3 rounded-input border border-border bg-white text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
                placeholder="tu@email.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                className="w-full h-11 px-3 rounded-input border border-border bg-white text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
                placeholder="Mínimo 8 caracteres"
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full h-11 bg-foreground text-white rounded-input font-medium text-sm hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground/50 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
            >
              {isPending ? 'Creando cuenta...' : 'Crear cuenta'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="text-foreground font-medium hover:underline">
            Ingresá
          </Link>
        </p>
      </div>
    </main>
  )
}
