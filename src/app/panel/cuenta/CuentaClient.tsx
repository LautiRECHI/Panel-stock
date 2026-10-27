'use client'

import { useActionState, useEffect, useRef } from 'react'
import { cambiarContrasena } from '@/app/auth/actions'
import { useToast } from '@/components/ui/Toast'

type ActionState = { error?: string; message?: string } | null

export default function CuentaClient() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    cambiarContrasena,
    null
  )
  const { toast } = useToast()
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.message) {
      toast(state.message, 'success')
      formRef.current?.reset()
    }
  }, [state, toast])

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {state?.error && (
        <div className="bg-stock-none-bg border border-stock-none/20 text-stock-none text-sm rounded-input px-3 py-2.5">
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
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
        className="h-11 px-6 bg-foreground text-white rounded-input font-medium text-sm hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-foreground/50 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isPending ? 'Guardando...' : 'Cambiar contraseña'}
      </button>
    </form>
  )
}
