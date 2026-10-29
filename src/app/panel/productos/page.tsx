import { connection } from 'next/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProducts } from '@/lib/products'
import { getCategories } from '@/lib/categories'
import ProductsClient from './ProductsClient'
import type { ProductFilter } from '@/lib/products'

export const instant = false

type SearchParams = Promise<{ status?: string; q?: string; cat?: string; page?: string }>

export default async function ProductosPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()

  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id').limit(1)
  const storeId = (stores as { id: string }[] | null)?.[0]?.id
  if (!storeId) redirect('/onboarding')

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)

  const validStatuses = ['draft', 'active', 'archived', 'low_stock', 'no_stock']
  const status = validStatuses.includes(params.status ?? '')
    ? (params.status as ProductFilter['status'])
    : undefined

  const [{ products, total }, categories] = await Promise.all([
    getProducts(storeId, { status, search: params.q, categoryId: params.cat, page }),
    getCategories(storeId),
  ])

  return (
    <ProductsClient
      products={products}
      total={total}
      page={page}
      categories={categories}
      currentStatus={status}
      currentSearch={params.q}
      currentCategoryId={params.cat}
    />
  )
}
