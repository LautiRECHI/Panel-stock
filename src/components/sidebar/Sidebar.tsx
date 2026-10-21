'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Package, Tag, Settings, LogOut, Menu, X, Store } from 'lucide-react'
import { logout } from '@/app/auth/actions'

interface SidebarProps {
  storeName: string
  userEmail: string
}

const navItems = [
  { href: '/panel/productos', icon: Package, label: 'Productos' },
  { href: '/panel/categorias', icon: Tag, label: 'Categorías' },
  { href: '/panel/configuracion', icon: Settings, label: 'Configuración' },
]

function NavContent({
  storeName,
  pathname,
  onClose,
}: {
  storeName: string
  pathname: string
  onClose?: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo / nombre de tienda */}
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
          <Store className="w-4 h-4 text-sidebar" />
        </div>
        <span className="text-white font-medium text-sm truncate">{storeName}</span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navegación */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 h-11 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-sidebar-active text-accent'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-2 py-4 border-t border-white/10">
        <form action={logout}>
          <button
            type="submit"
            className="flex items-center gap-3 px-3 h-11 w-full rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            Salir
          </button>
        </form>
      </div>
    </div>
  )
}

export default function Sidebar({ storeName }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  return (
    <>
      {/* Botón hamburguesa (mobile) */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-40 w-11 h-11 flex items-center justify-center rounded-lg bg-sidebar text-white shadow-md"
        aria-label="Abrir menú"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Sidebar desktop */}
      <aside className="hidden lg:flex flex-col w-56 bg-sidebar flex-shrink-0 h-screen sticky top-0">
        <NavContent storeName={storeName} pathname={pathname} />
      </aside>

      {/* Drawer mobile */}
      {mobileOpen && (
        <>
          {/* Overlay */}
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          {/* Panel */}
          <aside className="lg:hidden fixed inset-y-0 left-0 z-50 w-64 bg-sidebar flex flex-col shadow-xl">
            <NavContent
              storeName={storeName}
              pathname={pathname}
              onClose={() => setMobileOpen(false)}
            />
          </aside>
        </>
      )}
    </>
  )
}
