import { connection } from 'next/server'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCategories, buildCategoryTree } from '@/lib/categories'
import { getProduct } from '@/lib/products'
import ProductForm from '../ProductForm'

export const instant = false

type Props = { params: Promise<{ id: string }> }

export default async function EditarProductoPage({ params }: Props) {
  await connection()

  const { id } = await params

  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id').limit(1)
  const storeId = (stores as { id: string }[] | null)?.[0]?.id
  if (!storeId) redirect('/onboarding')

  const [product, categories] = await Promise.all([
    getProduct(storeId, id),
    getCategories(storeId),
  ])

  if (!product) notFound()

  const tree = buildCategoryTree(categories)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Editar producto</h1>
        <p className="text-muted text-sm mt-0.5 truncate">{product.name}</p>
      </div>
      <ProductForm product={product} categories={tree} />
    </div>
  )
}
