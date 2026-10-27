import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import CuentaClient from './CuentaClient'

export default async function CuentaPage() {
  await connection()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-foreground mb-1">Mi cuenta</h1>
      <p className="text-muted text-sm mb-8">{user?.email}</p>

      <div className="bg-card rounded-card border border-border p-6">
        <h2 className="text-base font-semibold text-foreground mb-1">Cambiar contraseña</h2>
        <p className="text-muted text-sm mb-5">
          La nueva contraseña debe tener al menos 8 caracteres.
        </p>
        <CuentaClient />
      </div>
    </div>
  )
}
