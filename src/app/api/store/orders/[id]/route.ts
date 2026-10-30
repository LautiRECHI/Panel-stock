import { connection } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/anon'

export async function GET(
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
  const { id: token } = await params

  const supabase = createAnonClient()
  const { data, error } = await supabase.rpc('storefront_get_order', {
    p_api_key: apiKey,
    p_public_token: token,
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
    return NextResponse.json({ error: 'Error interno' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
