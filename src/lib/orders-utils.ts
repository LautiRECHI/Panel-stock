export type OrderStatus = 'pendiente' | 'pagado' | 'enviado' | 'entregado' | 'cancelado'
export type DeliveryMethod = 'retiro' | 'domicilio'
export type PaymentMethod = 'transferencia' | 'efectivo' | 'mercadopago' | 'dlocalgo' | 'otro'
export type OrderSource = 'panel' | 'tienda' | 'whatsapp'
export type OrderEventType = 'creado' | 'pagado' | 'estado_cambiado' | 'cancelado' | 'nota'

export interface Order {
  id: string
  store_id: string
  number: number
  status: OrderStatus
  customer_name: string
  customer_email: string | null
  customer_phone: string | null
  delivery_method: DeliveryMethod
  shipping_street: string | null
  shipping_number: string | null
  shipping_floor: string | null
  shipping_city: string | null
  shipping_province: string | null
  shipping_postal_code: string | null
  shipping_notes: string | null
  shipping_cost: number | null
  shipping_carrier: string | null
  tracking_code: string | null
  subtotal: number
  total: number
  currency: string
  payment_method: PaymentMethod | null
  payment_reference: string | null
  paid_at: string | null
  paid_by: string | null
  source: OrderSource
  notes: string | null
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  store_id: string
  order_id: string
  product_id: string | null
  variant_id: string | null
  product_name: string
  variant_label: string
  sku: string
  unit_price: number
  quantity: number
  line_total: number
}

export interface OrderEvent {
  id: string
  store_id: string
  order_id: string
  type: OrderEventType
  from_status: OrderStatus | null
  to_status: OrderStatus | null
  user_id: string | null
  note: string | null
  created_at: string
}

export interface OrderFull extends Order {
  items: OrderItem[]
  events: OrderEvent[]
}

export interface OrderListItem extends Order {
  item_count: number
}

export interface NewOrderItem {
  variant_id: string
  quantity: number
}

export interface NewOrderCustomer {
  name: string
  email?: string
  phone?: string
}

export interface NewOrderDelivery {
  method: DeliveryMethod
  street?: string
  number?: string
  floor?: string
  city?: string
  province?: string
  postal_code?: string
  notes?: string
}

// ─── Formateo ────────────────────────────────────────────────────────────────

export function formatOrderNumber(n: number): string {
  return `#${n}`
}

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pendiente:  'Pendiente',
  pagado:     'Pagado',
  enviado:    'Enviado',
  entregado:  'Entregado',
  cancelado:  'Cancelado',
}

export const ORDER_STATUS_CHIP: Record<OrderStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pendiente: 'warning',
  pagado:    'success',
  enviado:   'neutral',
  entregado: 'success',
  cancelado: 'danger',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transferencia: 'Transferencia',
  efectivo:      'Efectivo',
  mercadopago:   'Mercado Pago',
  dlocalgo:      'dLocal Go',
  otro:          'Otro',
}

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  retiro:    'Retiro',
  domicilio: 'Domicilio',
}

export const ORDER_EVENT_LABELS: Record<OrderEventType, string> = {
  creado:          'Pedido creado',
  pagado:          'Pago confirmado',
  estado_cambiado: 'Estado actualizado',
  cancelado:       'Pedido cancelado',
  nota:            'Nota',
}

export const SOURCE_LABELS: Record<OrderSource, string> = {
  panel:    'Panel',
  tienda:   'Tienda',
  whatsapp: 'WhatsApp',
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

export function buildWhatsAppUrl(phone: string | null, orderNumber: number, storeName: string): string | null {
  if (!phone) return null
  // Normalizar al formato internacional argentino 549XXXXXXXXXX
  const digits = phone.replace(/\D/g, '')
  let normalized = digits
  if (digits.startsWith('0')) {
    normalized = '54' + digits.slice(1)
  } else if (digits.startsWith('15')) {
    normalized = '549' + digits
  } else if (!digits.startsWith('54')) {
    normalized = '549' + digits
  }
  const text = encodeURIComponent(
    `Hola! Te escribimos de ${storeName} por tu pedido ${formatOrderNumber(orderNumber)}.`
  )
  return `https://wa.me/${normalized}?text=${text}`
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

export const ORDER_FILTER_STATUSES: Array<{ label: string; status: OrderStatus | undefined }> = [
  { label: 'Todos',      status: undefined },
  { label: 'Pendientes', status: 'pendiente' },
  { label: 'Pagados',    status: 'pagado' },
  { label: 'Enviados',   status: 'enviado' },
  { label: 'Entregados', status: 'entregado' },
  { label: 'Cancelados', status: 'cancelado' },
]
