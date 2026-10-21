'use client'

import { useActionState, useRef } from 'react'
import { crearTienda } from './actions'

type ActionState = { error?: string } | null

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
}

export default function OnboardingPage() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(crearTienda, null)
  const slugRef = useRef<HTMLInputElement>(null)

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (slugRef.current) {
      slugRef.current.value = toSlug(e.target.value)
    }
  }

  return (
    <main className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Creá tu tienda</h1>
          <p className="text-muted text-sm mt-1">
            Después podés agregar productos, categorías y más
          </p>
        </div>

        <div className="bg-card rounded-card border border-border p-6 shadow-sm">
          {state?.error && (
            <div className="mb-4 bg-stock-none-bg border border-stock-none/20 text-stock-none text-sm rounded-input px-3 py-2.5">
              {state.error}
            </div>
          )}

          <form action={formAction} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1.5">
                Nombre de la tienda
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                autoFocus
                autoComplete="off"
                maxLength={100}
                onChange={handleNameChange}
                className="w-full h-11 px-3 rounded-input border border-border bg-white text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
                placeholder="Ej: Punto de Oro"
              />
            </div>

            <div>
              <label htmlFor="slug" className="block text-sm font-medium text-foreground mb-1.5">
                Identificador único
                <span className="text-muted font-normal ml-1">(URL de tu tienda)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm select-none">
                  panel.app/
                </span>
                <input
                  ref={slugRef}
                  id="slug"
                  name="slug"
                  type="text"
                  required
                  autoComplete="off"
                  maxLength={50}
                  pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]|[a-z0-9]"
                  className="w-full h-11 pl-[82px] pr-3 rounded-input border border-border bg-white text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
                  placeholder="punto-de-oro"
                />
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Solo letras minúsculas, números y guiones
              </p>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full h-11 bg-foreground text-white rounded-input font-medium text-sm hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground/50 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
            >
              {isPending ? 'Creando tienda...' : 'Crear tienda'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
