import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCategories, buildCategoryTree } from '@/lib/categories'
import CategoriesClient from './CategoriesClient'

export default async function CategoriasPage() {
  await connection()

  const supabase = await createClient()

  const { data: stores } = await supabase
    .from('stores')
    .select('id')
    .limit(1)

  const storeId = stores?.[0]?.id
  if (!storeId) redirect('/onboarding')

  const categories = await getCategories(storeId)
  const tree = buildCategoryTree(categories)

  return <CategoriesClient tree={tree} />
}
