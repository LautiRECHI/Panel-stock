'use client'

import { useState, useTransition, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Minus, Trash2, Search } from 'lucide-react'
import type { VariantForOrder } from '@/lib/orders'
import type { DeliveryMethod, OrderSource } from '@/lib/orders-utils'
import { formatPrice } from '@/lib/orders-utils'
import Button from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { createOrder } from '../actions'

interface OrderLine {
  variant: VariantForOrder
  quantity: number
}

interface Props {
  variants: VariantForOrder[]
}

const DELIVERY_OPTIONS: { value: DeliveryMethod; label: string }[] = [
  { value: 'retiro',    label: 'Retiro por el local' },
  { value: 'domicilio', label: 'Envío a domicilio' },
]

const SOURCE_OPTIONS: { value: OrderSource; label: string }[] = [
  { value: 'panel',    label: 'Panel (presencial)' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'tienda',   label: 'Tienda online' },
]

function variantDisplayName(v: VariantForOrder): string {
  const attrs = Object.values(v.attributes)
  return attrs.length > 0
    ? `${v.product_name} — ${attrs.join(' / ')}`
    : v.product_name
}

export default function NuevoPedidoClient({ variants }: Props) {
  const router = useRouter()
  const { toast: showToast } = useToast()
  const [isPending, startTransition] = useTransition()

  // Buscador de variantes
  const [search, setSearch] = useState('')

  // Líneas del pedido
  const [lines, setLines] = useState<OrderLine[]>([])

  // Cliente
  const [name,  setName]  = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // Entrega
  const [delivery, setDelivery] = useState<DeliveryMethod>('retiro')
  const [street,   setStreet]   = useState('')
  const [houseNum, setHouseNum] = useState('')
  const [floor,    setFloor]    = useState('')
  const [city,     setCity]     = useState('')
  const [province, setProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')

  // Envío y extras
  const [shippingCost, setShippingCost] = useState('')
  const [notes,  setNotes]  = useState('')
  const [source, setSource] = useState<OrderSource>('panel')

  // Filtrar variantes disponibles por búsqueda
  const filteredVariants = useMemo(() => {
    const q = search.toLowerCase()
    return variants.filter(v =>
      variantDisplayName(v).toLowerCase().includes(q) ||
      v.sku.toLowerCase().includes(q)
    )
  }, [variants, search])

  function addVariant(v: VariantForOrder) {
    if (v.stock <= 0) return
    setLines(prev => {
      const existing = prev.find(l => l.variant.id === v.id)
      if (existing) {
        return prev.map(l =>
          l.variant.id === v.id
            ? { ...l, quantity: Math.min(l.quantity + 1, v.stock) }
            : l
        )
      }
      return [...prev, { variant: v, quantity: 1 }]
    })
    setSearch('')
  }

  function updateQty(variantId: string, delta: number) {
    setLines(prev =>
      prev.map(l => l.variant.id === variantId
        ? { ...l, quantity: Math.max(1, Math.min(l.quantity + delta, l.variant.stock)) }
        : l
      )
    )
  }

  function removeLine(variantId: string) {
    setLines(prev => prev.filter(l => l.variant.id !== variantId))
  }

  const subtotal = lines.reduce((s, l) => s + l.variant.price * l.quantity, 0)
  const shipNum  = shippingCost.trim() === '' ? null : parseInt(shippingCost, 10)
  const total    = subtotal + (shipNum ?? 0)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (lines.length === 0) { showToast('Agregá al menos un producto', 'error'); return }
    if (!name.trim())        { showToast('El nombre del cliente es requerido', 'error'); return }
    if (delivery === 'domicilio') {
      if (!street.trim())     { showToast('La calle es requerida para envío a domicilio', 'error'); return }
      if (!postalCode.trim()) { showToast('El código postal es requerido para envío a domicilio', 'error'); return }
    }
    if (shipNum !== null && isNaN(shipNum)) { showToast('El costo de envío debe ser un número entero', 'error'); return }

    startTransition(async () => {
      const res = await createOrder({
        customer: { name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined },
        delivery: {
          method:      delivery,
          street:      street.trim()      || undefined,
          number:      houseNum.trim()    || undefined,
          floor:       floor.trim()       || undefined,
          city:        city.trim()        || undefined,
          province:    province.trim()    || undefined,
          postal_code: postalCode.trim()  || undefined,
          notes:       deliveryNotes.trim() || undefined,
        },
        items:         lines.map(l => ({ variant_id: l.variant.id, quantity: l.quantity })),
        notes:         notes.trim() || undefined,
        source,
        shipping_cost: delivery === 'domicilio' ? (shipNum ?? null) : null,
      })

      if (res.success) {
        showToast('Pedido creado correctamente', 'success')
        router.push(`/panel/pedidos/${res.orderId}`)
      } else {
        showToast(res.error, 'error')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/panel/pedidos"
          className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-black/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
          aria-label="Volver a pedidos"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Nuevo pedido</h1>
      </div>

      {/* ── Productos ──────────────────────────────────────────────────────────── */}
      <div className="bg-card rounded-card border border-border p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Productos</h2>

        {/* Buscador */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar producto o SKU…"
            className="w-full h-11 pl-9 pr-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            aria-label="Buscar variante"
          />
        </div>

        {/* Resultados */}
        {search.length > 0 && (
          <ul className="bg-surface border border-border rounded-input divide-y divide-border max-h-64 overflow-y-auto" role="listbox">
            {filteredVariants.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted">No se encontraron resultados.</li>
            ) : filteredVariants.slice(0, 20).map(v => (
              <li key={v.id}>
                <button
                  type="button"
                  disabled={v.stock <= 0}
                  onClick={() => addVariant(v)}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-card disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
                  aria-label={`Agregar ${variantDisplayName(v)}`}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{variantDisplayName(v)}</p>
                    <p className="text-xs text-muted">SKU: {v.sku} · Stock: {v.stock}</p>
                  </div>
                  <span className="text-sm font-medium text-foreground flex-shrink-0 ml-4">
                    {formatPrice(v.price)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Líneas del pedido */}
        {lines.length > 0 && (
          <div className="space-y-2">
            {lines.map(line => (
              <div key={line.variant.id} className="flex items-center gap-3 bg-surface rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {variantDisplayName(line.variant)}
                  </p>
                  <p className="text-xs text-muted">
                    {formatPrice(line.variant.price)} · Stock disponible: {line.variant.stock}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => updateQty(line.variant.id, -1)}
                    disabled={line.quantity <= 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted hover:text-foreground hover:bg-card transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
                    aria-label="Reducir cantidad"
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <span className="w-8 text-center text-sm font-medium text-foreground">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQty(line.variant.id, 1)}
                    disabled={line.quantity >= line.variant.stock}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted hover:text-foreground hover:bg-card transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
                    aria-label="Aumentar cantidad"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLine(line.variant.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-border text-muted hover:text-stock-none hover:bg-stock-none-bg transition-colors ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
                    aria-label="Quitar del pedido"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
                <p className="text-sm font-semibold text-foreground flex-shrink-0 w-20 text-right">
                  {formatPrice(line.variant.price * line.quantity)}
                </p>
              </div>
            ))}
          </div>
        )}

        {lines.length === 0 && search.length === 0 && (
          <p className="text-sm text-muted text-center py-4">
            Buscá un producto para agregarlo al pedido.
          </p>
        )}

        {/* Totales en vivo */}
        {lines.length > 0 && (
          <div className="border-t border-border pt-3 space-y-1">
            <div className="flex justify-between text-sm text-muted">
              <span>Subtotal</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            {shipNum !== null && !isNaN(shipNum) && (
              <div className="flex justify-between text-sm text-muted">
                <span>Envío</span>
                <span>{formatPrice(shipNum)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-semibold text-foreground">
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Cliente ────────────────────────────────────────────────────────────── */}
      <div className="bg-card rounded-card border border-border p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Cliente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="c-name">
              Nombre <span className="text-stock-none">*</span>
            </label>
            <input
              id="c-name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: María García"
              className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="c-phone">
              Teléfono
            </label>
            <input
              id="c-phone"
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Ej: 1122334455"
              className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="c-email">
              Email
            </label>
            <input
              id="c-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Ej: cliente@mail.com"
              className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
        </div>
      </div>

      {/* ── Entrega ────────────────────────────────────────────────────────────── */}
      <div className="bg-card rounded-card border border-border p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Entrega</h2>

        <div className="grid grid-cols-2 gap-2">
          {DELIVERY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDelivery(opt.value)}
              className={`h-11 rounded-input border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
                delivery === opt.value
                  ? 'bg-foreground text-white border-transparent'
                  : 'bg-surface text-foreground border-border hover:border-foreground/20'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {delivery === 'domicilio' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1" htmlFor="d-street">
                Calle <span className="text-stock-none">*</span>
              </label>
              <input
                id="d-street"
                type="text"
                value={street}
                onChange={e => setStreet(e.target.value)}
                placeholder="Ej: Av. Corrientes"
                className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1" htmlFor="d-number">
                Número
              </label>
              <input
                id="d-number"
                type="text"
                value={houseNum}
                onChange={e => setHouseNum(e.target.value)}
                placeholder="Ej: 1234"
                className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1" htmlFor="d-floor">
                Piso / Dpto
              </label>
              <input
                id="d-floor"
                type="text"
                value={floor}
                onChange={e => setFloor(e.target.value)}
                placeholder="Ej: 3ro B"
                className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1" htmlFor="d-cp">
                Código postal <span className="text-stock-none">*</span>
              </label>
              <input
                id="d-cp"
                type="text"
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                placeholder="Ej: 1043"
                className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1" htmlFor="d-city">
                Ciudad / Localidad
              </label>
              <input
                id="d-city"
                type="text"
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder="Ej: CABA"
                className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1" htmlFor="d-province">
                Provincia
              </label>
              <input
                id="d-province"
                type="text"
                value={province}
                onChange={e => setProvince(e.target.value)}
                placeholder="Ej: Buenos Aires"
                className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1" htmlFor="d-notes">
                Indicaciones adicionales
              </label>
              <input
                id="d-notes"
                type="text"
                value={deliveryNotes}
                onChange={e => setDeliveryNotes(e.target.value)}
                placeholder="Ej: Tocar timbre 3B"
                className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
              />
            </div>
          </div>
        )}

        {/* Costo de envío — solo para domicilio */}
        {delivery === 'domicilio' && (
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
              className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
        )}
      </div>

      {/* ── Extras ─────────────────────────────────────────────────────────────── */}
      <div className="bg-card rounded-card border border-border p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Origen y notas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="source">
              Origen del pedido
            </label>
            <select
              id="source"
              value={source}
              onChange={e => setSource(e.target.value as OrderSource)}
              className="w-full h-11 px-3 rounded-input border border-border bg-surface text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            >
              {SOURCE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="order-notes">
              Notas internas
            </label>
            <textarea
              id="order-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Visible solo en el panel"
              className="w-full px-3 py-2 rounded-input border border-border bg-surface text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            />
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-3 justify-end">
        <Link href="/panel/pedidos">
          <Button type="button" variant="secondary">Cancelar</Button>
        </Link>
        <Button type="submit" loading={isPending} disabled={lines.length === 0}>
          Crear pedido
        </Button>
      </div>
    </form>
  )
}
