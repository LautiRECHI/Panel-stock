import { connection } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAnonClient } from '@/lib/supabase/anon'

const itemSchema = z.object({
  variant_id: z.string().uuid(),
  quantity: z.number().int().positive(),
})

const bodySchema = z.object({
  customer: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(200).optional(),
    phone: z.string().max(50).optional(),
  }),
  delivery: z.object({
    method: z.enum(['retiro', 'domicilio']),
    street: z.string().max(200).optional(),
    number: z.string().max(20).optional(),
    floor: z.string().max(50).optional(),
    city: z.string().max(100).optional(),
    province: z.string().max(100).optional(),
    postal_code: z.string().max(20).optional(),
    notes: z.string().max(500).optional(),
    shipping_cost: z.number().int().min(0).optional(),
  }),
  items: z.array(itemSchema).min(1).max(30),
  customer_note: z.string().max(1000).optional(),
  expires_in_hours: z.number().int().min(1).max(720).optional(),
})

export async function POST(req: NextRequest) {
  await connection()

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Se requiere Authorization: Bearer <clave>' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const apiKey = authHeader.slice(7)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, {
      status: 422,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const { customer, delivery, items, customer_note, expires_in_hours } = parsed.data
  const supabase = createAnonClient()

  const { data, error } = await supabase.rpc('storefront_create_order', {
    p_api_key: apiKey,
    p_customer: customer,
    p_delivery: delivery,
    p_items: items,
    p_customer_note: customer_note ?? null,
    p_expires_in_hours: expires_in_hours ?? 48,
  })

  if (error) {
    const code = (error as { code?: string }).code
    if (code === 'P0401') {
      return NextResponse.json({ error: 'Clave de API inválida' }, {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    if (code === 'P0409' || code === 'P0404') {
      return NextResponse.json({ error: 'Stock insuficiente' }, {
        status: 409,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    if (code === 'P0429') {
      return NextResponse.json({ error: 'Límite de pedidos alcanzado. Intentá más tarde.' }, {
        status: 429,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    return NextResponse.json({ error: 'Error de validación' }, {
      status: 422,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  return NextResponse.json(data, {
    status: 201,
    headers: { 'Cache-Control': 'no-store' },
  })
}
