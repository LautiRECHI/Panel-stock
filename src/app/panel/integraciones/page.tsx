import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getApiKeys } from '@/lib/api-keys'
import IntegracionesClient from './IntegracionesClient'

export const instant = false

export default async function IntegracionesPage() {
  await connection()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: stores } = await supabase
    .from('stores')
    .select('id, name')
    .limit(1)
  const store = stores?.[0]
  if (!store) redirect('/onboarding')

  // Verificar que el usuario es owner
  const { data: membership } = await supabase
    .from('store_members')
    .select('role')
    .eq('store_id', store.id)
    .eq('user_id', user.id)
    .single()

  const isOwner = membership?.role === 'owner'
  const keys = isOwner ? await getApiKeys(store.id) : []

  return (
    <Suspense>
      <IntegracionesClient keys={keys} isOwner={isOwner} />
    </Suspense>
  )
}
