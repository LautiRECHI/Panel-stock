import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getVariantsForNewOrder } from '@/lib/orders'
import NuevoPedidoClient from './NuevoPedidoClient'

export const instant = false

export default async function NuevoPedidoPage() {
  await connection()

  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id').limit(1)
  const storeId = (stores as { id: string }[] | null)?.[0]?.id
  if (!storeId) redirect('/onboarding')

  const variants = await getVariantsForNewOrder(storeId)

  return <NuevoPedidoClient variants={variants} />
}
