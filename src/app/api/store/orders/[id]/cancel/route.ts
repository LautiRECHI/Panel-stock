import { connection } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAnonClient } from '@/lib/supabase/anon'
const bodySchema = z.object({
  reason: z.string().max(500).optional(),
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
    body = {}
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, {
      status: 422,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const { reason } = parsed.data
  const supabase = createAnonClient()

  const { error } = await supabase.rpc('storefront_cancel_order', {
    p_api_key: apiKey,
    p_order_id: id,
    p_reason: reason ?? null,
  })

  if (error) {
    const code = (error as { code?: string }).code
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
    return NextResponse.json({ error: 'Error de validación' }, {
      status: 422,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  return NextResponse.json({ status: 'ok' }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
