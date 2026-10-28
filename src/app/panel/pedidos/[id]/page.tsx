import { connection } from 'next/server'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrder } from '@/lib/orders'
import PedidoDetail from './PedidoDetail'

type Props = { params: Promise<{ id: string }> }

export default async function PedidoPage({ params }: Props) {
  await connection()

  const { id } = await params

  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id, name').limit(1)
  const store = (stores as { id: string; name: string }[] | null)?.[0]
  if (!store) redirect('/onboarding')

  const order = await getOrder(store.id, id)
  if (!order) notFound()

  return <PedidoDetail order={order} storeName={store.name} />
}
