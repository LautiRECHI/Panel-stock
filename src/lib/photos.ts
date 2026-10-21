import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type ProductImage = {
  id: string
  product_id: string
  store_id: string
  path: string
  position: number
  url: string
}

export async function getProductImages(
  storeId: string,
  productId: string
): Promise<ProductImage[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('product_images')
    .select('id, product_id, store_id, path, position')
    .eq('store_id', storeId)
    .eq('product_id', productId)
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)
  if (!data?.length) return []

  return (data as { id: string; product_id: string; store_id: string; path: string; position: number }[]).map(
    row => ({
      ...row,
      url: supabase.storage
        .from('product-images')
        .getPublicUrl(row.path).data.publicUrl,
    })
  )
}
