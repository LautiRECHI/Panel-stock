'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, MessageCircle, CreditCard, Truck, CheckCircle2, XCircle, Package,
} from 'lucide-react'
import type { OrderFull, PaymentMethod } from '@/lib/orders-utils'
import {
  ORDER_STATUS_LABELS, ORDER_STATUS_CHIP, PAYMENT_METHOD_LABELS,
  DELIVERY_METHOD_LABELS, ORDER_EVENT_LABELS, formatPrice, formatOrderNumber,
  buildWhatsAppUrl,
} from '@/lib/orders-utils'
import Button from '@/components/ui/Button'
import StatusChip from '@/components/ui/StatusChip'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import {
  markOrderPaid,
  setOrderStatus,
  cancelOrder,
  updateOrderShipping,
} from '../actions'

interface Props {
  order: OrderFull
  storeName: string
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

const PAYMENT_METHODS: PaymentMethod[] = ['transferencia', 'efectivo', 'mercadopago', 'dlocalgo', 'otro']

export default function PedidoDetail({ order, storeName }: Props) {
  const router = useRouter()
  const { toast: showToast } = useToast()
  const [isPending, startTransition] = useTransition()

  // Modales
  const [showPagarModal,    setShowPagarModal]    = useState(false)
  const [showEnviarModal,   setShowEnviarModal]    = useState(false)
  const [showCancelarModal, setShowCancelarModal]  = useState(false)
  const [showEnvioModal,    setShowEnvioModal]     = useState(false)

  // Formulario pago
  const [payMethod,    setPayMethod]    = useState<PaymentMethod>('transferencia')
  const [payReference, setPayReference] = useState('')

  // Formulario envío
  const [carrier,  setCarrier]  = useState(order.shipping_carrier ?? '')
  const [tracking, setTracking] = useState(order.tracking_code ?? '')

  // Formulario cancelación
  const [cancelReason, setCancelReason] = useState('')

  // Formulario costo de envío
  const [shippingCost,    setShippingCost]    = useState(order.shipping_cost?.toString() ?? '')
  const [shippingCarrier, setShippingCarrier] = useState(order.shipping_carrier ?? '')
  const [shippingTrack,   setShippingTrack]   = useState(order.tracking_code ?? '')

  const whatsAppUrl = buildWhatsAppUrl(order.customer_phone, order.number, storeName)

  function handleMarkPaid() {
    startTransition(async () => {
      const res = await markOrderPaid({
        orderId:   order.id,
        method:    payMethod,
        reference: payReference,
      })
      if (res.success) {
        showToast('Pedido marcado como pagado', 'success')
        setShowPagarModal(false)
        router.refresh()
      } else {
        showToast(res.error, 'error')
      }
    })
  }

  function handleMarkSent() {
    startTransition(async () => {
      const res = await setOrderStatus({
        orderId:  order.id,
        status:   'enviado',
        note:     '',
        carrier,
        tracking,
      })
      if (res.success) {
        showToast('Pedido marcado como enviado', 'success')
        setShowEnviarModal(false)
        router.refresh()
      } else {
        showToast(res.error, 'error')
      }
    })
  }

  function handleMarkDelivered() {
    startTransition(async () => {
      const res = await setOrderStatus({ orderId: order.id, status: 'entregado', note: '' })
      if (res.success) {
        showToast('Pedido marcado como entregado', 'success')
        router.refresh()
      } else {
        showToast(res.error, 'error')
      }
    })
  }

  function handleCancel() {
    startTransition(async () => {
      const res = await cancelOrder({ orderId: order.id, reason: cancelReason })
      if (res.success) {
        showToast('Pedido cancelado. El stock fue repuesto.', 'success')
        setShowCancelarModal(false)
        router.refresh()
      } else {
        showToast(res.error, 'error')
      }
    })
  }

  function handleUpdateShipping() {
    const cost = shippingCost.trim() === '' ? null : parseInt(shippingCost, 10)
    if (cost !== null && isNaN(cost)) {
      showToast('El costo de envío debe ser un número entero', 'error')
      return
    }
    startTransition(async () => {
      const res = await updateOrderShipping({
        orderId:      order.id,
        shippingCost: cost,
        carrier:      shippingCarrier,
        tracking:     shippingTrack,
      })
      if (res.success) {
        showToast('Envío actualizado', 'success')
        setShowEnvioModal(false)
        router.refresh()
      } else {
        showToast(res.error, 'error')
      }
    })
  }

  const isClosed = order.status === 'entregado' || order.status === 'cancelado'

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Back + header */}
      <div className="flex items-start gap-3">
        <Link
          href="/panel/pedidos"
          className="mt-0.5 p-2 rounded-lg text-muted hover:text-foreground hover:bg-black/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
          aria-label="Volver a pedidos"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">
              Pedido {formatOrderNumber(order.number)}
            </h1>
            <StatusChip
              status={ORDER_STATUS_CHIP[order.status]}
              label={ORDER_STATUS_LABELS[order.status]}
            />
          </div>
          <p className="text-sm text-muted mt-0.5">{formatDateTime(order.created_at)}</p>
        </div>
      </div>

      {/* Acciones */}
      {!isClosed && (
        <div className="flex flex-wrap gap-2">
          {order.status === 'pendiente' && (
            <Button onClick={() => setShowPagarModal(true)} loading={isPending}>
              <CreditCard className="w-4 h-4" aria-hidden="true" />
              Marcar como pagado
            </Button>
          )}
          {order.status === 'pagado' && (
            <Button onClick={() => setShowEnviarModal(true)} loading={isPending}>
              <Truck className="w-4 h-4" aria-hidden="true" />
              Marcar como enviado
            </Button>
          )}
          {order.status === 'enviado' && (
            <Button onClick={handleMarkDelivered} loading={isPending}>
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Marcar como entregado
            </Button>
          )}
          {order.delivery_method === 'domicilio' && (
            <Button variant="secondary" onClick={() => setShowEnvioModal(true)} loading={isPending}>
              <Truck className="w-4 h-4" aria-hidden="true" />
              Fijar envío
            </Button>
          )}
          <Button variant="danger" onClick={() => setShowCancelarModal(true)} loading={isPending}>
            <XCircle className="w-4 h-4" aria-hidden="true" />
            Cancelar pedido
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cliente */}
        <div className="bg-card rounded-card border border-border p-4 space-y-1">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Cliente</h2>
          <p className="font-medium text-foreground">{order.customer_name}</p>
          {order.customer_email && (
            <p className="text-sm text-muted">{order.customer_email}</p>
          )}
          {order.customer_phone && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted">{order.customer_phone}</p>
              {whatsAppUrl && (
                <a
                  href={whatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#25D366] font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/40 rounded"
                  aria-label="Enviar WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  WhatsApp
                </a>
              )}
            </div>
          )}
        </div>

        {/* Entrega */}
        <div className="bg-card rounded-card border border-border p-4 space-y-1">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Entrega</h2>
          <p className="font-medium text-foreground">{DELIVERY_METHOD_LABELS[order.delivery_method]}</p>
          {order.delivery_method === 'domicilio' && (
            <div className="text-sm text-muted space-y-0.5">
              <p>
                {[order.shipping_street, order.shipping_number, order.shipping_floor]
                  .filter(Boolean).join(' ')}
              </p>
              {order.shipping_city && (
                <p>
                  {[order.shipping_city, order.shipping_province, order.shipping_postal_code]
                    .filter(Boolean).join(', ')}
                </p>
              )}
              {order.shipping_notes && <p className="italic">{order.shipping_notes}</p>}
            </div>
          )}
          {(order.shipping_carrier || order.tracking_code) && (
            <div className="text-sm text-muted pt-1 border-t border-border mt-2 space-y-0.5">
              {order.shipping_carrier && <p>Transportista: {order.shipping_carrier}</p>}
              {order.tracking_code && <p>Seguimiento: {order.tracking_code}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Ítems */}
      <div className="bg-card rounded-card border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Productos</h2>
        </div>
        <div className="divide-y divide-border">
          {order.items.map(item => (
            <div key={item.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center flex-shrink-0">
                <Package className="w-4 h-4 text-muted" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{item.product_name}</p>
                <p className="text-xs text-muted">
                  SKU: {item.sku}
                  {item.variant_label && ` · ${item.variant_label}`}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-medium text-foreground">{formatPrice(item.line_total)}</p>
                <p className="text-xs text-muted">
                  {item.quantity} × {formatPrice(item.unit_price)}
                </p>
              </div>
            </div>
          ))}
        </div>
        {/* Totales */}
        <div className="px-4 py-3 border-t border-border bg-surface space-y-1">
          <div className="flex justify-between text-sm text-muted">
            <span>Subtotal</span>
            <span>{formatPrice(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-muted">
            <span>Envío</span>
            <span>
              {order.delivery_method === 'retiro'
                ? formatPrice(0)
                : order.shipping_cost != null
                  ? formatPrice(order.shipping_cost)
                  : <span className="italic">A confirmar</span>
              }
            </span>
          </div>
          <div className="flex justify-between text-sm font-semibold text-foreground pt-1 border-t border-border">
            <span>Total</span>
            <span>{formatPrice(order.total)}</span>
          </div>
          {order.payment_method && (
            <div className="flex justify-between text-xs text-muted pt-1">
              <span>Método de pago</span>
              <span>{PAYMENT_METHOD_LABELS[order.payment_method]}</span>
            </div>
          )}
          {order.payment_reference && (
            <div className="flex justify-between text-xs text-muted">
              <span>Referencia</span>
              <span className="truncate max-w-[200px]">{order.payment_reference}</span>
            </div>
          )}
        </div>
      </div>

      {/* Notas */}
      {order.notes && (
        <div className="bg-card rounded-card border border-border p-4">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">Notas</h2>
          <p className="text-sm text-foreground whitespace-pre-wrap">{order.notes}</p>
        </div>
      )}

      {/* Timeline de eventos */}
      <div className="bg-card rounded-card border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">Historial</h2>
        <ol className="relative border-l border-border ml-3 space-y-4">
          {order.events.map(ev => (
            <li key={ev.id} className="ml-4">
              <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-border border-2 border-card" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">{ORDER_EVENT_LABELS[ev.type]}</p>
              {ev.note && <p className="text-xs text-muted mt-0.5">{ev.note}</p>}
              <p className="text-xs text-muted mt-0.5">{formatDateTime(ev.created_at)}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Modales ──────────────────────────────────────────────────────────── */}

      {/* Marcar como pagado */}
      <Modal open={showPagarModal} onClose={() => setShowPagarModal(false)} title="Confirmar pago" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="pay-method">
              Método de pago
            </label>
            <select
              id="pay-method"
              value={payMethod}
              onChange={e => setPayMethod(e.target.value as PaymentMethod)}
              className="w-full h-11 px-3 rounded-input border border-border bg-card text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            >
              {PAYMENT_METHODS.map(m => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="pay-ref">
              N° de operación <span className="text-muted font-normal">(opcional)</span>
            </label>
            <input
              id="pay-ref"
              type="text"
              value={payReference}
              onChange={e => setPayReference(e.target.value)}
              placeholder="Ej: OP-12345"
              className="w-full h-11 px-3 rounded-input border border-border bg-card text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setShowPagarModal(false)}>Cancelar</Button>
            <Button onClick={handleMarkPaid} loading={isPending}>Confirmar pago</Button>
          </div>
        </div>
      </Modal>

      {/* Marcar como enviado */}
      <Modal open={showEnviarModal} onClose={() => setShowEnviarModal(false)} title="Marcar como enviado" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="carrier">
              Transportista <span className="text-muted font-normal">(opcional)</span>
            </label>
            <input
              id="carrier"
              type="text"
              value={carrier}
              onChange={e => setCarrier(e.target.value)}
              placeholder="Ej: Andreani"
              className="w-full h-11 px-3 rounded-input border border-border bg-card text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="tracking">
              Código de seguimiento <span className="text-muted font-normal">(opcional)</span>
            </label>
            <input
              id="tracking"
              type="text"
              value={tracking}
              onChange={e => setTracking(e.target.value)}
              placeholder="Ej: AR123456789"
              className="w-full h-11 px-3 rounded-input border border-border bg-card text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setShowEnviarModal(false)}>Cancelar</Button>
            <Button onClick={handleMarkSent} loading={isPending}>Confirmar envío</Button>
          </div>
        </div>
      </Modal>

      {/* Cancelar pedido */}
      <Modal open={showCancelarModal} onClose={() => setShowCancelarModal(false)} title="Cancelar pedido" size="sm"
        description="Se repone el stock de todos los productos del pedido.">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="cancel-reason">
              Motivo <span className="text-muted font-normal">(opcional)</span>
            </label>
            <textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Ej: Cliente cambió de opinión"
              className="w-full px-3 py-2 rounded-input border border-border bg-card text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setShowCancelarModal(false)}>No cancelar</Button>
            <Button variant="danger" onClick={handleCancel} loading={isPending}>Cancelar pedido</Button>
          </div>
        </div>
      </Modal>

      {/* Fijar costo de envío */}
      <Modal open={showEnvioModal} onClose={() => setShowEnvioModal(false)} title="Actualizar envío" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="ship-cost">
              Costo de envío <span className="text-muted font-normal">(dejar vacío = a confirmar)</span>
            </label>
            <input
              id="ship-cost"
              type="number"
              min="0"
              value={shippingCost}
              onChange={e => setShippingCost(e.target.value)}
              placeholder="Ej: 1500"
              className="w-full h-11 px-3 rounded-input border border-border bg-card text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="ship-carrier">
              Transportista <span className="text-muted font-normal">(opcional)</span>
            </label>
            <input
              id="ship-carrier"
              type="text"
              value={shippingCarrier}
              onChange={e => setShippingCarrier(e.target.value)}
              placeholder="Ej: Andreani"
              className="w-full h-11 px-3 rounded-input border border-border bg-card text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="ship-track">
              Código de seguimiento <span className="text-muted font-normal">(opcional)</span>
            </label>
            <input
              id="ship-track"
              type="text"
              value={shippingTrack}
              onChange={e => setShippingTrack(e.target.value)}
              placeholder="Ej: AR123456789"
              className="w-full h-11 px-3 rounded-input border border-border bg-card text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setShowEnvioModal(false)}>Cancelar</Button>
            <Button onClick={handleUpdateShipping} loading={isPending}>Guardar</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
