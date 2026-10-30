import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface StoreApiKey {
  id: string
  store_id: string
  name: string
  key_prefix: string
  created_by: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export async function getApiKeys(storeId: string): Promise<StoreApiKey[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('store_api_keys')
    .select('id, store_id, name, key_prefix, created_by, created_at, last_used_at, revoked_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as StoreApiKey[]
}
