import { connection } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAnonClient } from '@/lib/supabase/anon'
const bodySchema = z.object({
  provider: z.string().min(1).max(50),
  external_payment_id: z.string().min(1).max(200),
  amount: z.number().positive(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connection()

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Se requiere Authorization: Bearer <clave>' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const apiKey = authHeader.slice(7)
  const { id } = await params

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

  const { provider, external_payment_id, amount } = parsed.data
  const supabase = createAnonClient()

  const { data, error } = await supabase.rpc('storefront_mark_order_paid', {
    p_api_key: apiKey,
    p_order_id: id,
    p_provider: provider,
    p_external_payment_id: external_payment_id,
    p_amount: amount,
  })

  if (error) {
    const code = (error as { code?: string }).code
    const message = (error as { message?: string }).message ?? ''
    if (code === 'P0401') {
      return NextResponse.json({ error: 'Clave de API inválida' }, {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    if (code === 'P0404') {
      return NextResponse.json({ error: 'Pedido no encontrado' }, {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    if (message.includes('AMOUNT_MISMATCH')) {
      return NextResponse.json({ error: 'El monto no coincide con el total del pedido' }, {
        status: 422,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    return NextResponse.json({ error: 'Error de validación' }, {
      status: 422,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
