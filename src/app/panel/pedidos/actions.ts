'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export type ActionResult = { success: true } | { success: false; error: string }

async function resolveStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('stores').select('id').limit(1)
  return (data as { id: string }[] | null)?.[0]?.id ?? null
}

// ─── Crear pedido ─────────────────────────────────────────────────────────────

const newOrderItemSchema = z.object({
  variant_id: z.string().uuid(),
  quantity:   z.number().int().min(1, 'La cantidad debe ser al menos 1'),
})

const newOrderSchema = z.object({
  customer: z.object({
    name:  z.string().min(1, 'El nombre del cliente es requerido').max(200),
    email: z.string().email('Email inválido').max(200).optional().or(z.literal('')),
    phone: z.string().max(50).optional().or(z.literal('')),
  }),
  delivery: z.object({
    method:      z.enum(['retiro', 'domicilio']),
    street:      z.string().max(200).optional().or(z.literal('')),
    number:      z.string().max(20).optional().or(z.literal('')),
    floor:       z.string().max(50).optional().or(z.literal('')),
    city:        z.string().max(100).optional().or(z.literal('')),
    province:    z.string().max(100).optional().or(z.literal('')),
    postal_code: z.string().max(20).optional().or(z.literal('')),
    notes:       z.string().max(500).optional().or(z.literal('')),
  }).refine(
    d => d.method !== 'domicilio' || (d.street && d.street.trim().length > 0),
    { message: 'La calle es requerida para envío a domicilio', path: ['street'] }
  ).refine(
    d => d.method !== 'domicilio' || (d.postal_code && d.postal_code.trim().length > 0),
    { message: 'El código postal es requerido para envío a domicilio', path: ['postal_code'] }
  ),
  items:         z.array(newOrderItemSchema).min(1, 'El pedido debe tener al menos un ítem'),
  notes:         z.string().max(2000).optional().or(z.literal('')),
  source:        z.enum(['panel', 'tienda', 'whatsapp']).default('panel'),
  shipping_cost: z.number().int().min(0, 'El costo de envío no puede ser negativo').nullable().default(null),
})

export async function createOrder(
  input: z.infer<typeof newOrderSchema>
): Promise<ActionResult & { orderId?: string }> {
  const parsed = newOrderSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const { customer, delivery, items, notes, source, shipping_cost } = parsed.data

  const { data, error } = await supabase.rpc('create_order', {
    p_customer:      customer,
    p_delivery:      delivery,
    p_items:         items,
    p_notes:         notes ?? null,
    p_source:        source,
    p_shipping_cost: delivery.method === 'domicilio' ? (shipping_cost ?? null) : null,
  })

  if (error) {
    if (error.message.includes('Stock insuficiente')) return { success: false, error: error.message }
    if (error.message.includes('requerido'))           return { success: false, error: error.message }
    return { success: false, error: 'No se pudo crear el pedido.' }
  }

  revalidatePath('/panel/pedidos')
  return { success: true, orderId: data as string }
}

// ─── Marcar como pagado ───────────────────────────────────────────────────────

const markPaidSchema = z.object({
  orderId:   z.string().uuid(),
  method:    z.enum(['transferencia', 'efectivo', 'mercadopago', 'dlocalgo', 'otro']),
  reference: z.string().max(300).optional().or(z.literal('')),
})

export async function markOrderPaid(input: z.infer<typeof markPaidSchema>): Promise<ActionResult> {
  const parsed = markPaidSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('mark_order_paid', {
    p_order_id:  parsed.data.orderId,
    p_method:    parsed.data.method,
    p_reference: parsed.data.reference ?? null,
  })

  if (error) return { success: false, error: error.message || 'No se pudo marcar como pagado.' }

  revalidatePath('/panel/pedidos')
  revalidatePath(`/panel/pedidos/${parsed.data.orderId}`)
  return { success: true }
}

// ─── Cambiar estado ───────────────────────────────────────────────────────────

const setStatusSchema = z.object({
  orderId:  z.string().uuid(),
  status:   z.enum(['enviado', 'entregado']),
  note:     z.string().max(2000).optional().or(z.literal('')),
  carrier:  z.string().max(100).optional().or(z.literal('')),
  tracking: z.string().max(200).optional().or(z.literal('')),
})

export async function setOrderStatus(input: z.infer<typeof setStatusSchema>): Promise<ActionResult> {
  const parsed = setStatusSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_order_status', {
    p_order_id: parsed.data.orderId,
    p_status:   parsed.data.status,
    p_note:     parsed.data.note ?? null,
    p_carrier:  parsed.data.carrier ?? null,
    p_tracking: parsed.data.tracking ?? null,
  })

  if (error) return { success: false, error: error.message || 'No se pudo cambiar el estado.' }

  revalidatePath('/panel/pedidos')
  revalidatePath(`/panel/pedidos/${parsed.data.orderId}`)
  return { success: true }
}

// ─── Cancelar pedido ──────────────────────────────────────────────────────────

const cancelSchema = z.object({
  orderId: z.string().uuid(),
  reason:  z.string().max(2000).optional().or(z.literal('')),
})

export async function cancelOrder(input: z.infer<typeof cancelSchema>): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_order', {
    p_order_id: parsed.data.orderId,
    p_reason:   parsed.data.reason ?? null,
  })

  if (error) return { success: false, error: error.message || 'No se pudo cancelar el pedido.' }

  revalidatePath('/panel/pedidos')
  revalidatePath(`/panel/pedidos/${parsed.data.orderId}`)
  return { success: true }
}

// ─── Actualizar envío ─────────────────────────────────────────────────────────

const shippingSchema = z.object({
  orderId:      z.string().uuid(),
  shippingCost: z.number().int().min(0, 'El costo no puede ser negativo').nullable(),
  carrier:      z.string().max(100).optional().or(z.literal('')),
  tracking:     z.string().max(200).optional().or(z.literal('')),
})

export async function updateOrderShipping(input: z.infer<typeof shippingSchema>): Promise<ActionResult> {
  const parsed = shippingSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const storeId = await resolveStoreId()
  if (!storeId) return { success: false, error: 'No autenticado.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_order_shipping', {
    p_order_id:      parsed.data.orderId,
    p_shipping_cost: parsed.data.shippingCost,
    p_carrier:       parsed.data.carrier ?? null,
    p_tracking:      parsed.data.tracking ?? null,
  })

  if (error) return { success: false, error: error.message || 'No se pudo actualizar el envío.' }

  revalidatePath('/panel/pedidos')
  revalidatePath(`/panel/pedidos/${parsed.data.orderId}`)
  return { success: true }
}
