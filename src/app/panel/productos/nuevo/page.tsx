import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCategories, buildCategoryTree } from '@/lib/categories'
import ProductForm from '../ProductForm'

export const instant = false

export default async function NuevoProductoPage() {
  await connection()

  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id').limit(1)
  const storeId = (stores as { id: string }[] | null)?.[0]?.id
  if (!storeId) redirect('/onboarding')

  const categories = await getCategories(storeId)
  const tree = buildCategoryTree(categories)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Nuevo producto</h1>
        <p className="text-muted text-sm mt-0.5">Completá la información para crear el producto</p>
      </div>
      <ProductForm categories={tree} />
    </div>
  )
}
