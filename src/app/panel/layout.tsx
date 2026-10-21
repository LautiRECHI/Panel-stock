import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/sidebar/Sidebar'

export const instant = false

interface PanelLayoutProps {
  children: React.ReactNode
}

export default async function PanelLayout({ children }: PanelLayoutProps) {
  await connection()

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, accent_color')
    .limit(1)

  const store = stores?.[0] ?? null

  if (!store) {
    redirect('/onboarding')
  }

  return (
    <div
      className="flex min-h-screen"
      style={{ '--color-accent': store.accent_color } as React.CSSProperties}
    >
      <Sidebar storeName={store.name} userEmail={user.email ?? ''} />

      <div className="flex-1 flex flex-col min-w-0 lg:pl-0 pl-0">
        {/* Espaciado para el botón hamburguesa en mobile */}
        <div className="lg:hidden h-16" />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
