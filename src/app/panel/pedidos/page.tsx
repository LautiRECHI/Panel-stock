import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getOrders } from '@/lib/orders'
import type { Order } from '@/lib/orders-utils'
import PedidosClient from './PedidosClient'

export const instant = false

type SearchParams = Promise<{ status?: string; q?: string; page?: string }>

export default async function PedidosPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()

  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id, name').limit(1)
  const store = (stores as { id: string; name: string }[] | null)?.[0]
  if (!store) redirect('/onboarding')

  const params = await searchParams
  const page   = Math.max(1, parseInt(params.page ?? '1', 10) || 1)

  const validStatuses: Order['status'][] = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado']
  const status = validStatuses.includes(params.status as Order['status'])
    ? (params.status as Order['status'])
    : undefined

  const { orders, total, pendingCount } = await getOrders(store.id, {
    status,
    search: params.q,
    page,
  })

  return (
    <Suspense>
      <PedidosClient
        orders={orders}
        total={total}
        page={page}
        currentStatus={status}
        currentSearch={params.q}
        pendingCount={pendingCount}
        storeName={store.name}
      />
    </Suspense>
  )
}
