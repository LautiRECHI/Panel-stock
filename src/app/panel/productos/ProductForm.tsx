'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ProductFull } from '@/lib/products-utils'
import type { CategoryNode } from '@/lib/categories'
import { formatPrice, parsePrice } from '@/lib/products-utils'
import { createProduct, updateProduct } from './actions'
import { uploadPhotos } from './photos-actions'
import { upsertVariants, setDefaultVariantStockZero } from './variants-actions'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Select from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import PhotosSection, { type PendingPhoto } from './PhotosSection'
import VariantsSection, { type VariantRowData } from './VariantsSection'

interface Props {
  product?: ProductFull
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
  const [description, setDescription] = useState(product?.description ?? '')
  const [brand, setBrand] = useState(product?.brand ?? '')
  const [sku, setSku] = useState(product?.default_sku ?? '')

  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([])
  const [variantRows, setVariantRows] = useState<VariantRowData[]>([])

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
      const hasVariantsEnabled = variantRows.some(r => Object.keys(r.attributes).length > 0)

      if (isEdit && product) {
        // Actualizar metadatos del producto
        const res = await updateProduct({
          id: product.id,
          name,
          priceRaw,
          description,
          brand,
          status,
          categoryId,
          sku,
        })
        if (!res.success) { setFormError(res.error); return }

        // Subir fotos pendientes
        if (pendingPhotos.length > 0) {
          const fd = new FormData()
          for (const p of pendingPhotos) {
            const file = new File([p.blob], `${crypto.randomUUID()}.${p.ext}`, { type: p.mimeType })
            fd.append('photos', file)
          }
          const photoRes = await uploadPhotos(product.id, fd)
          if (photoRes.failed.length > 0) {
            toast(`Se subieron ${photoRes.uploaded} fotos. Fallaron: ${photoRes.failed.join(', ')}`, 'warning')
          }
        }

        // Upsert de variantes si hay datos
        if (variantRows.length > 0 || hasVariantsEnabled) {
          // Si se está convirtiendo de simple a variantes, resetear stock del default
          const isConverting = !product.has_variants && hasVariantsEnabled
          if (isConverting && product.default_variant_id && product.total_stock > 0) {
            await setDefaultVariantStockZero(product.default_variant_id, 'conversión a variantes')
          }

          if (variantRows.length > 0) {
            const varRes = await upsertVariants(
              product.id,
              variantRows.map(r => ({
                id: r.id,
                sku: r.sku,
                attributes: r.attributes,
                price: r.priceRaw.trim() || null,
                stock: r.stock,
              })),
              'edición de producto'
            )
            if (!varRes.success) { setFormError(varRes.error); return }
          }
        }

        toast('Producto actualizado', 'success')
        router.push('/panel/productos')
      } else {
        // Crear producto
        const initialStock = hasVariantsEnabled ? 0 : (variantRows[0]?.stock ?? 0)

        const res = await createProduct({
          name,
          priceRaw,
          stock: initialStock,
          description,
          brand,
          status,
          categoryId,
          sku,
        })
        if (!res.success) { setFormError(res.error); return }

        const productId = res.productId!

        // Subir fotos
        if (pendingPhotos.length > 0) {
          const fd = new FormData()
          for (const p of pendingPhotos) {
            const file = new File([p.blob], `${crypto.randomUUID()}.${p.ext}`, { type: p.mimeType })
            fd.append('photos', file)
          }
          const photoRes = await uploadPhotos(productId, fd)
          if (photoRes.failed.length > 0) {
            toast(`Se subieron ${photoRes.uploaded} fotos. Fallaron: ${photoRes.failed.join(', ')}`, 'warning')
          }
        }

        // Upsert de variantes si hay opciones
        if (hasVariantsEnabled && variantRows.length > 0) {
          const varRes = await upsertVariants(
            productId,
            variantRows.map(r => ({
              sku: r.sku,
              attributes: r.attributes,
              price: r.priceRaw.trim() || null,
              stock: r.stock,
            })),
            'creación de producto'
          )
          if (!varRes.success) {
            // El producto fue creado pero las variantes fallaron
            toast('Producto creado, pero no se pudieron guardar las variantes.', 'warning')
            router.push(`/panel/productos/${productId}`)
            return
          }
        }

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

      {/* Fotos */}
      <PhotosSection
        productId={product?.id}
        initialImages={product?.images ?? []}
        onPendingChange={setPendingPhotos}
      />

      {/* Variantes */}
      <VariantsSection
        productId={product?.id}
        initialVariants={product?.variants ?? []}
        productPrice={parsePrice(priceRaw) || product?.price || 0}
        onVariantsChange={setVariantRows}
      />

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
