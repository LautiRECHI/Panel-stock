'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ProductWithVariant } from '@/lib/products-utils'
import type { CategoryNode } from '@/lib/categories'
import { formatPrice } from '@/lib/products-utils'
import { createProduct, updateProduct } from './actions'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Select from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'

interface Props {
  product?: ProductWithVariant
  categories: CategoryNode[]
}

export default function ProductForm({ product, categories }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [formError, setFormError] = useState<string | null>(null)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

  const isEdit = !!product

  const [name, setName] = useState(product?.name ?? '')
  const [priceRaw, setPriceRaw] = useState(product ? formatPrice(product.price) : '')
  const [stock, setStock] = useState(product?.stock ?? 0)
  const [description, setDescription] = useState(product?.description ?? '')
  const [brand, setBrand] = useState(product?.brand ?? '')
  const [sku, setSku] = useState(product?.default_sku ?? '')

  const findCategorySelection = (): { rootId: string; subId: string } => {
    if (!product?.category_id) return { rootId: '', subId: '' }
    if (categories.some(c => c.id === product.category_id)) {
      return { rootId: product.category_id, subId: '' }
    }
    for (const root of categories) {
      if (root.children.some(c => c.id === product.category_id)) {
        return { rootId: root.id, subId: product.category_id }
      }
    }
    return { rootId: '', subId: '' }
  }

  const initial = findCategorySelection()
  const [rootCategoryId, setRootCategoryId] = useState(initial.rootId)
  const [subCategoryId, setSubCategoryId] = useState(initial.subId)

  const selectedRoot = categories.find(c => c.id === rootCategoryId)
  const subcategories = selectedRoot?.children ?? []

  function handleRootChange(id: string) {
    setRootCategoryId(id)
    setSubCategoryId('')
  }

  function effectiveCategoryId(): string | null {
    return subCategoryId || rootCategoryId || null
  }

  function submit(status: 'draft' | 'active') {
    setFormError(null)
    startTransition(async () => {
      const categoryId = effectiveCategoryId()

      if (isEdit && product) {
        const res = await updateProduct({
          id: product.id,
          name,
          priceRaw,
          description,
          brand,
          status,
          categoryId,
          sku,
          stock,
          variantId: product.default_variant_id || undefined,
        })
        if (!res.success) { setFormError(res.error); return }
        toast('Producto actualizado', 'success')
        router.push('/panel/productos')
      } else {
        const res = await createProduct({ name, priceRaw, stock, description, brand, status, categoryId, sku })
        if (!res.success) { setFormError(res.error); return }
        toast('Producto creado', 'success')
        router.push('/panel/productos')
      }
    })
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {formError && (
        <p className="text-sm bg-stock-none-bg border border-stock-none/20 text-stock-none rounded-input px-3 py-2.5">
          {formError}
        </p>
      )}

      {/* Información básica */}
      <section className="bg-card rounded-card border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Información básica</h2>

        <Input
          id="prod-name"
          label="Nombre"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Ej: Pala de pádel HEAD Delta Pro"
          required
          maxLength={200}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            id="prod-price"
            label="Precio"
            value={priceRaw}
            onChange={e => setPriceRaw(e.target.value)}
            placeholder="Ej: 89.999,00"
            required
            hint="Formato: 89.999,00"
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="prod-stock" className="text-sm font-medium text-foreground">
              Stock
            </label>
            <input
              id="prod-stock"
              type="number"
              value={stock}
              onChange={e => setStock(Math.max(0, parseInt(e.target.value, 10) || 0))}
              min={0}
              className="h-11 px-3 rounded-input border border-border bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
            />
          </div>
        </div>

        <Textarea
          id="prod-description"
          label="Descripción"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describí el producto..."
          rows={3}
          maxLength={2000}
        />
      </section>

      {/* Categoría */}
      <section className="bg-card rounded-card border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Categoría</h2>

        <Select
          id="prod-category"
          label="Categoría"
          value={rootCategoryId}
          onChange={e => handleRootChange(e.target.value)}
          placeholder="Sin categoría"
        >
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>

        {subcategories.length > 0 && (
          <Select
            id="prod-subcategory"
            label="Subcategoría"
            value={subCategoryId}
            onChange={e => setSubCategoryId(e.target.value)}
            placeholder="Sin subcategoría"
          >
            {subcategories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        )}
      </section>

      {/* Avanzado (colapsable) */}
      <section className="bg-card rounded-card border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setIsAdvancedOpen(p => !p)}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-foreground hover:bg-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/40"
        >
          Avanzado
          {isAdvancedOpen
            ? <ChevronUp className="w-4 h-4 text-muted" aria-hidden="true" />
            : <ChevronDown className="w-4 h-4 text-muted" aria-hidden="true" />}
        </button>
        {isAdvancedOpen && (
          <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
            <Input
              id="prod-brand"
              label="Marca"
              value={brand}
              onChange={e => setBrand(e.target.value)}
              placeholder="Ej: HEAD"
              maxLength={100}
            />
            <Input
              id="prod-sku"
              label="SKU"
              value={sku}
              onChange={e => setSku(e.target.value)}
              placeholder="Se genera automáticamente si lo dejás vacío"
              maxLength={100}
              hint="Código único del producto. Se genera automáticamente si lo dejás vacío."
            />
          </div>
        )}
      </section>

      {/* Próximamente */}
      <section className="bg-card rounded-card border border-border p-5 opacity-50 pointer-events-none select-none">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-foreground">Fotos</h2>
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-border text-muted px-1.5 py-0.5 rounded">
            Próximamente
          </span>
        </div>
        <p className="text-sm text-muted">La carga de fotos estará disponible próximamente.</p>
      </section>

      <section className="bg-card rounded-card border border-border p-5 opacity-50 pointer-events-none select-none">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-foreground">Variantes</h2>
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-border text-muted px-1.5 py-0.5 rounded">
            Próximamente
          </span>
        </div>
        <p className="text-sm text-muted">Talle, color y otras variantes estarán disponibles próximamente.</p>
      </section>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3 pt-1 pb-8">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <div className="flex-1" />
        <Button
          type="button"
          variant="secondary"
          onClick={() => submit('draft')}
          loading={isPending}
        >
          Guardar borrador
        </Button>
        <Button
          type="button"
          onClick={() => submit('active')}
          loading={isPending}
        >
          Publicar
        </Button>
      </div>
    </div>
  )
}
