'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Search, ChevronLeft, ChevronRight, ShoppingCart, MessageCircle } from 'lucide-react'
import {
  type OrderListItem,
  type Order,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_CHIP,
  DELIVERY_METHOD_LABELS,
  SOURCE_BADGE,
  SOURCE_LABELS,
  formatPrice,
  formatOrderNumber,
  ORDER_FILTER_STATUSES,
} from '@/lib/orders-utils'
import Button from '@/components/ui/Button'
import StatusChip from '@/components/ui/StatusChip'
import EmptyState from '@/components/ui/EmptyState'
import { useRef } from 'react'

const PAGE_SIZE = 25

interface Props {
  orders: OrderListItem[]
  total: number
  page: number
  currentStatus?: Order['status']
  currentSearch?: string
  pendingCount: number
  storeName: string
}

function buildUrl(params: { status?: Order['status']; q?: string; page?: number }): string {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.q)      sp.set('q', params.q)
  if (params.page && params.page > 1) sp.set('page', String(params.page))
  const qs = sp.toString()
  return `/panel/pedidos${qs ? `?${qs}` : ''}`
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export default function PedidosClient({
  orders,
  total,
  page,
  currentStatus,
  currentSearch,
  pendingCount,
}: Props) {
  const router = useRouter()
  const searchRef = useRef<HTMLInputElement>(null)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = searchRef.current?.value.trim()
    router.push(buildUrl({ status: currentStatus, q: q || undefined }))
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Pedidos</h1>
          {pendingCount > 0 && (
            <p className="text-sm text-muted mt-0.5">
              {pendingCount} {pendingCount === 1 ? 'pedido pendiente' : 'pedidos pendientes'}
            </p>
          )}
        </div>
        <Link href="/panel/pedidos/nuevo">
          <Button variant="primary">
            <Plus className="w-4 h-4" aria-hidden="true" />
            Nuevo pedido
          </Button>
        </Link>
      </div>

      {/* Filtros por estado */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {ORDER_FILTER_STATUSES.map(({ label, status }) => {
          const isActive = currentStatus === status
          return (
            <Link
              key={label}
              href={buildUrl({ status, q: currentSearch })}
              className={`flex-shrink-0 px-3 h-9 inline-flex items-center rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
                isActive
                  ? 'bg-foreground text-white'
                  : 'bg-card border border-border text-muted hover:text-foreground hover:border-foreground/20'
              }`}
            >
              {label}
              {status === 'pendiente' && pendingCount > 0 && (
                <span className={`ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-white/20 text-white' : 'bg-stock-none-bg text-stock-none'
                }`}>
                  {pendingCount}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Búsqueda */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            defaultValue={currentSearch ?? ''}
            placeholder="Buscar por #, nombre o teléfono…"
            className="w-full h-11 pl-9 pr-3 rounded-input border border-border bg-card text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            aria-label="Buscar pedidos"
          />
        </div>
        <Button type="submit" variant="secondary">Buscar</Button>
      </form>

      {/* Tabla / cards */}
      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="w-6 h-6" aria-hidden="true" />}
          title="No hay pedidos"
          description={
            currentStatus || currentSearch
              ? 'Probá con otro filtro o búsqueda.'
              : 'Cuando llegue tu primer pedido aparecerá acá.'
          }
          action={
            !currentStatus && !currentSearch
              ? (
                <Link href="/panel/pedidos/nuevo">
                  <Button>
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Nuevo pedido
                  </Button>
                </Link>
                )
              : undefined
          }
        />
) : (
        <>
          {/* Desktop: tabla */}
          <div className="hidden md:block bg-card rounded-card border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Pedido</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Origen</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Cliente</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Entrega</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Total</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map(order => (
                  <tr
                    key={order.id}
                    className="hover:bg-surface transition-colors cursor-pointer"
                    onClick={() => router.push(`/panel/pedidos/${order.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {formatOrderNumber(order.number)}
                      {order.source === 'tienda' && order.status === 'pendiente' && order.expires_at && (
                        <p className="text-xs text-amber-600 font-normal mt-0.5">
                          Vence {formatDate(order.expires_at)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_BADGE[order.source] ?? 'bg-surface text-muted'}`}>
                        {SOURCE_LABELS[order.source]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">
                      {formatDate(order.created_at)}
                    </td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <p className="font-medium text-foreground truncate">{order.customer_name}</p>
                      {order.customer_phone && (
                        <p className="text-xs text-muted truncate">{order.customer_phone}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {DELIVERY_METHOD_LABELS[order.delivery_method]}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground whitespace-nowrap">
                      {formatPrice(order.total)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip
                        status={ORDER_STATUS_CHIP[order.status]}
                        label={ORDER_STATUS_LABELS[order.status]}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {order.payment_method
                        ? <span className="flex items-center gap-1.5 text-stock-ok">
                            <span className="w-1.5 h-1.5 rounded-full bg-stock-ok flex-shrink-0" />
                            Pagado
                          </span>
                        : <span className="text-muted">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="md:hidden space-y-2">
            {orders.map(order => (
              <Link
                key={order.id}
                href={`/panel/pedidos/${order.id}`}
                className="block bg-card rounded-card border border-border p-4 space-y-2 hover:border-foreground/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-semibold text-foreground">{formatOrderNumber(order.number)}</span>
                    <span className="text-muted text-xs ml-2">{formatDate(order.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SOURCE_BADGE[order.source] ?? 'bg-surface text-muted'}`}>
                      {SOURCE_LABELS[order.source]}
                    </span>
                    <StatusChip
                      status={ORDER_STATUS_CHIP[order.status]}
                      label={ORDER_STATUS_LABELS[order.status]}
                    />
                  </div>
                </div>
                <p className="text-sm font-medium text-foreground">{order.customer_name}</p>
                {order.source === 'tienda' && order.status === 'pendiente' && order.expires_at && (
                  <p className="text-xs text-amber-600">Vence {formatDate(order.expires_at)}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">{DELIVERY_METHOD_LABELS[order.delivery_method]}</span>
                  <span className="text-sm font-semibold text-foreground">{formatPrice(order.total)}</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 pt-2">
              <span className="text-sm text-muted">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={buildUrl({ status: currentStatus, q: currentSearch, page: page - 1 })}>
                    <Button variant="secondary" className="h-9 w-9 p-0">
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                      <span className="sr-only">Anterior</span>
                    </Button>
                  </Link>
                )}
                {page < totalPages && (
                  <Link href={buildUrl({ status: currentStatus, q: currentSearch, page: page + 1 })}>
                    <Button variant="secondary" className="h-9 w-9 p-0">
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                      <span className="sr-only">Siguiente</span>
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Ayuda de WhatsApp si hay pedidos pendientes */}
      {orders.some(o => o.status === 'pendiente') && (
        <p className="text-xs text-muted flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
          Abrí el detalle del pedido para enviar un mensaje por WhatsApp al cliente.
        </p>
      )}
    </div>
  )
}
