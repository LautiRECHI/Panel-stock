'use server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function createApiKey(name: string): Promise<{ secret: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_store_api_key', { p_name: name })
  if (error) throw new Error(error.message)
  return { secret: (data as { secret: string }).secret }
}

export async function revokeApiKey(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('revoke_store_api_key', { p_id: id })
  if (error) throw new Error(error.message)
  revalidatePath('/panel/integraciones')
}
