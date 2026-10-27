'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  Tag,
  ArrowLeftRight,
  MessageSquare,
  Settings,
  User,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { logout } from '@/app/auth/actions'

interface SidebarProps {
  storeName: string
  userEmail: string
}

type NavItem = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
  disabled?: boolean
  exact?: boolean
}

const navItems: NavItem[] = [
  { href: '/panel', icon: LayoutDashboard, label: 'Resumen', exact: true },
  { href: '/panel/productos', icon: Package, label: 'Productos' },
  { href: '/panel/categorias', icon: Tag, label: 'Categorías' },
  { icon: ArrowLeftRight, label: 'Movimientos de stock', disabled: true },
  { icon: MessageSquare, label: 'Consultas', disabled: true },
  { href: '/panel/cuenta', icon: User, label: 'Mi cuenta' },
  { icon: Settings, label: 'Configuración', disabled: true },
]

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

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
      {/* Cabecera con iniciales / logo */}
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-white/10 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
          <span className="text-[11px] font-bold text-sidebar leading-none select-none">
            {getInitials(storeName)}
          </span>
        </div>
        <span className="text-white font-medium text-sm truncate flex-1">{storeName}</span>
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
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto" aria-label="Navegación principal">
        {navItems.map((item) => {
          if (item.disabled || !item.href) {
            return (
              <div
                key={item.label}
                className="flex items-center gap-3 px-3 h-11 rounded-lg text-sm font-medium text-white/30 cursor-not-allowed select-none"
                aria-disabled="true"
              >
                <item.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate">{item.label}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-white/10 text-white/30 px-1.5 py-0.5 rounded flex-shrink-0">
                  Pronto
                </span>
              </div>
            )
          }

          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 h-11 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                isActive
                  ? 'bg-sidebar-active text-accent'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-2 py-4 border-t border-white/10 flex-shrink-0">
        <form action={logout}>
          <button
            type="submit"
            className="flex items-center gap-3 px-3 h-11 w-full rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
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
        className="lg:hidden fixed top-4 left-4 z-40 w-11 h-11 flex items-center justify-center rounded-lg bg-sidebar text-white shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        aria-label="Abrir menú"
        aria-expanded={mobileOpen}
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
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
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
