import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { Order, OrderFull, OrderListItem, OrderItem, OrderEvent } from '@/lib/orders-utils'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toOrder(row: Record<string, unknown>): Order {
  return {
    id:                   row.id as string,
    store_id:             row.store_id as string,
    number:               row.number as number,
    status:               row.status as Order['status'],
    customer_name:        row.customer_name as string,
    customer_email:       (row.customer_email as string | null) ?? null,
    customer_phone:       (row.customer_phone as string | null) ?? null,
    delivery_method:      row.delivery_method as Order['delivery_method'],
    shipping_street:      (row.shipping_street as string | null) ?? null,
    shipping_number:      (row.shipping_number as string | null) ?? null,
    shipping_floor:       (row.shipping_floor as string | null) ?? null,
    shipping_city:        (row.shipping_city as string | null) ?? null,
    shipping_province:    (row.shipping_province as string | null) ?? null,
    shipping_postal_code: (row.shipping_postal_code as string | null) ?? null,
    shipping_notes:       (row.shipping_notes as string | null) ?? null,
    shipping_cost:        row.shipping_cost != null ? Number(row.shipping_cost) : null,
    shipping_carrier:     (row.shipping_carrier as string | null) ?? null,
    tracking_code:        (row.tracking_code as string | null) ?? null,
    subtotal:             Number(row.subtotal),
    total:                Number(row.total),
    currency:             (row.currency as string) ?? 'ARS',
    payment_method:       (row.payment_method as Order['payment_method']) ?? null,
    payment_reference:    (row.payment_reference as string | null) ?? null,
    paid_at:              (row.paid_at as string | null) ?? null,
    paid_by:              (row.paid_by as string | null) ?? null,
    source:               row.source as Order['source'],
    notes:                (row.notes as string | null) ?? null,
    created_at:           row.created_at as string,
    updated_at:           row.updated_at as string,
  }
}

// ─── getOrders ────────────────────────────────────────────────────────────────

export interface OrderFilter {
  status?: Order['status']
  search?: string
  page?: number
}

const PAGE_SIZE = 25

export async function getOrders(
  storeId: string,
  filter: OrderFilter = {}
): Promise<{ orders: OrderListItem[]; total: number; pendingCount: number }> {
  const supabase = await createClient()
  const { status, search, page = 1 } = filter
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (status) query = query.eq('status', status)
  if (search) {
    const n = parseInt(search.replace('#', ''), 10)
    if (!isNaN(n)) {
      query = query.eq('number', n)
    } else {
      query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`)
    }
  }

  const { data, count, error } = await query
  if (error) throw new Error(error.message)

  // Contar pedidos pendientes (para badge en sidebar)
  const { count: pendingCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('status', 'pendiente')

  // Contar ítems por pedido
  const orderIds = ((data ?? []) as Record<string, unknown>[]).map(o => o.id as string)
  const itemCountMap = new Map<string, number>()
  if (orderIds.length > 0) {
    const { data: itemCounts } = await supabase
      .from('order_items')
      .select('order_id')
      .eq('store_id', storeId)
      .in('order_id', orderIds)
    for (const row of (itemCounts ?? []) as { order_id: string }[]) {
      itemCountMap.set(row.order_id, (itemCountMap.get(row.order_id) ?? 0) + 1)
    }
  }

  const orders: OrderListItem[] = ((data ?? []) as Record<string, unknown>[]).map(row => ({
    ...toOrder(row),
    item_count: itemCountMap.get(row.id as string) ?? 0,
  }))

  return { orders, total: count ?? 0, pendingCount: pendingCount ?? 0 }
}

// ─── getOrder (detalle) ───────────────────────────────────────────────────────

export async function getOrder(storeId: string, id: string): Promise<OrderFull | null> {
  const supabase = await createClient()

  const [{ data: orderData }, { data: itemsData }, { data: eventsData }] = await Promise.all([
    supabase.from('orders').select('*').eq('store_id', storeId).eq('id', id).single(),
    supabase.from('order_items').select('*').eq('store_id', storeId).eq('order_id', id),
    supabase
      .from('order_events')
      .select('*')
      .eq('store_id', storeId)
      .eq('order_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (!orderData) return null

  const items: OrderItem[] = ((itemsData ?? []) as Record<string, unknown>[]).map(row => ({
    id:            row.id as string,
    store_id:      row.store_id as string,
    order_id:      row.order_id as string,
    product_id:    (row.product_id as string | null) ?? null,
    variant_id:    (row.variant_id as string | null) ?? null,
    product_name:  row.product_name as string,
    variant_label: (row.variant_label as string) ?? '',
    sku:           row.sku as string,
    unit_price:    Number(row.unit_price),
    quantity:      row.quantity as number,
    line_total:    Number(row.line_total),
  }))

  const events: OrderEvent[] = ((eventsData ?? []) as Record<string, unknown>[]).map(row => ({
    id:          row.id as string,
    store_id:    row.store_id as string,
    order_id:    row.order_id as string,
    type:        row.type as OrderEvent['type'],
    from_status: (row.from_status as OrderEvent['from_status']) ?? null,
    to_status:   (row.to_status as OrderEvent['to_status']) ?? null,
    user_id:     (row.user_id as string | null) ?? null,
    note:        (row.note as string | null) ?? null,
    created_at:  row.created_at as string,
  }))

  return { ...toOrder(orderData as Record<string, unknown>), items, events }
}

// ─── getPendingOrdersCount ────────────────────────────────────────────────────

export async function getPendingOrdersCount(storeId: string): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('status', 'pendiente')
  return count ?? 0
}

// ─── getVariantsForNewOrder ────────────────────────────────────────────────────

export interface VariantForOrder {
  id: string
  product_id: string
  product_name: string
  sku: string
  attributes: Record<string, string>
  price: number
  stock: number
}

export async function getVariantsForNewOrder(storeId: string): Promise<VariantForOrder[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('product_variants')
    .select('id, product_id, sku, attributes, price, stock, products!inner(name, price, status)')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .neq('products.status', 'archived')
    .order('sku')

  return ((data ?? []) as Record<string, unknown>[]).map(row => {
    const product = row.products as Record<string, unknown>
    const varPrice = row.price != null ? Number(row.price) : null
    const prodPrice = Number(product.price)
    return {
      id:           row.id as string,
      product_id:   row.product_id as string,
      product_name: product.name as string,
      sku:          row.sku as string,
      attributes:   (row.attributes as Record<string, string>) ?? {},
      price:        varPrice ?? prodPrice,
      stock:        row.stock as number,
    }
  })
}
