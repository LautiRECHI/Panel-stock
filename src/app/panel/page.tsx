import { createClient } from '@/lib/supabase/server'

export default async function PanelPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-foreground mb-1">Inicio</h1>
      <p className="text-muted text-sm mb-8">
        Bienvenido, {user?.email}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card rounded-card border border-border p-5">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Productos</p>
          <p className="text-2xl font-semibold text-foreground">—</p>
          <p className="text-xs text-muted mt-1">Próximamente</p>
        </div>
        <div className="bg-card rounded-card border border-border p-5">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Categorías</p>
          <p className="text-2xl font-semibold text-foreground">—</p>
          <p className="text-xs text-muted mt-1">Próximamente</p>
        </div>
        <div className="bg-card rounded-card border border-border p-5">
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Sin stock</p>
          <p className="text-2xl font-semibold text-foreground">—</p>
          <p className="text-xs text-muted mt-1">Próximamente</p>
        </div>
      </div>
    </div>
  )
}
