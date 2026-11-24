'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ProductFull } from '@/lib/products-utils'
import type { CategoryNode } from '@/lib/categories'
import { formatPrice, parsePrice } from '@/lib/products-utils'
import { createProduct, updateProduct } from './actions'
import { upsertVariants, setDefaultVariantStockZero, setVariantStock } from './variants-actions'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Select from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import PhotosSection, { type PhotosSectionHandle } from './PhotosSection'
import VariantsSection, { type VariantRowData } from './VariantsSection'

interface Props {
  product?: ProductFull
  categories: CategoryNode[]
  storeId: string
}

export default function ProductForm({ product, categories, storeId }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [formError, setFormError] = useState<string | null>(null)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const photosSectionRef = useRef<PhotosSectionHandle>(null)
  // Guard anti-duplicado: una vez que createProduct tuvo éxito, guardamos el id
  // y cualquier reintento redirige al edit en vez de crear otro producto.
  const createdProductIdRef = useRef<string | null>(null)

  // En React 19, router.push() dentro de startTransition extiende isPending hasta
  // que la navegación se confirma (nuevo RSC payload descargado y renderizado).
  // Si el caché fue invalidado por revalidatePath, eso puede tardar indefinidamente.
  // Solución: acumular la URL destino en un ref y navegar DESPUÉS de que el
  // transition termine (isPending → false), desde fuera del transition.
  const redirectAfterTransitionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isPending && redirectAfterTransitionRef.current) {
      const url = redirectAfterTransitionRef.current
      redirectAfterTransitionRef.current = null
      router.push(url)
    }
  }, [isPending, router])

  const isEdit = !!product

  const [name, setName] = useState(product?.name ?? '')
  const [priceRaw, setPriceRaw] = useState(product ? formatPrice(product.price) : '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [brand, setBrand] = useState(product?.brand ?? '')
  const [sku, setSku] = useState(product?.default_sku ?? '')

  const defaultVariantStock =
    product?.variants?.find(v => Object.keys(v.attributes).length === 0)?.stock ?? 0
  const [stock, setStock] = useState(!product?.has_variants ? defaultVariantStock : 0)

  const [variantsEnabled, setVariantsEnabled] = useState(product?.has_variants ?? false)
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
    // Anti-duplicado: si createProduct ya corrió, ir a edición en lugar de crear otro.
    if (createdProductIdRef.current) {
      router.push(`/panel/productos/${createdProductIdRef.current}`)
      return
    }

    redirectAfterTransitionRef.current = null
    setFormError(null)
    startTransition(async () => {
      try {
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
          })
          if (!res.success) { setFormError(res.error ?? 'No se pudo guardar el producto.'); return }

          if (!variantsEnabled && product.default_variant_id && stock !== defaultVariantStock) {
            const stockRes = await setVariantStock(
              product.default_variant_id,
              stock,
              'edición de producto'
            )
            if (!stockRes.success) { setFormError(stockRes.error ?? 'No se pudo actualizar el stock.'); return }
          }

          // En EDIT las fotos se suben de inmediato al seleccionarlas; nada que hacer aquí.

          if (variantsEnabled || variantRows.length > 0) {
            const isConverting = !product.has_variants && variantsEnabled
            if (isConverting && product.default_variant_id && product.total_stock > 0) {
              const zeroRes = await setDefaultVariantStockZero(product.default_variant_id, 'conversión a variantes')
              if (!zeroRes.success) {
                console.error('[ProductForm] setDefaultVariantStockZero failed:', zeroRes.error)
              }
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
                isConverting ? 'conversión a variantes' : 'edición de variantes'
              )
              if (!varRes.success) { setFormError(varRes.error ?? 'No se pudieron guardar las variantes.'); return }
            }
          }

          toast('Producto actualizado', 'success')
          redirectAfterTransitionRef.current = '/panel/productos'
        } else {
          // ── CREATE ────────────────────────────────────────────────────────────
          const initialStock = variantsEnabled ? 0 : stock

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
          if (!res.success) { setFormError(res.error ?? 'No se pudo crear el producto.'); return }

          // A partir de aquí el producto existe. Guardamos el id antes de cualquier
          // operación posterior para que un segundo clic nunca cree un duplicado.
          const productId = res.productId!
          createdProductIdRef.current = productId

          // Fotos: no bloquean la publicación. Si fallan, se avisa y se redirige al edit.
          let photoRes = { uploaded: 0, failed: [] as string[] }
          try {
            if (photosSectionRef.current) {
              photoRes = await photosSectionRef.current.uploadAllPending(productId, storeId)
            }
          } catch {
            photoRes = { uploaded: 0, failed: ['Error inesperado. Podés agregarlas desde edición.'] }
          }

          if (photoRes.failed.length > 0) {
            const cuantas = photoRes.failed.length
            toast(
              `Producto creado. No se ${cuantas === 1 ? 'pudo subir 1 foto' : `pudieron subir ${cuantas} fotos`}. Podés agregarlas desde "Editar".`,
              'warning'
            )
            redirectAfterTransitionRef.current = `/panel/productos/${productId}`
            return
          }

          if (variantsEnabled && variantRows.length > 0) {
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
              toast('Producto creado, pero no se pudieron guardar las variantes. Editalo para agregarlas.', 'warning')
              redirectAfterTransitionRef.current = `/panel/productos/${productId}`
              return
            }
          }

          toast('Producto creado', 'success')
          redirectAfterTransitionRef.current = '/panel/productos'
        }
      } catch (err) {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Ocurrió un error inesperado. Intentá de nuevo.'

        console.error('[ProductForm] submit error:', err)

        if (createdProductIdRef.current) {
          // El producto ya fue creado; llevamos al edit con un aviso para no perder trabajo.
          toast(msg, 'error')
          redirectAfterTransitionRef.current = `/panel/productos/${createdProductIdRef.current}`
        } else {
          setFormError(msg)
        }
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

          {!variantsEnabled && (
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
          )}
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
        ref={photosSectionRef}
        productId={product?.id}
        storeId={storeId}
        initialImages={product?.images ?? []}
      />

      {/* Variantes */}
      <VariantsSection
        productId={product?.id}
        initialVariants={product?.variants ?? []}
        productPrice={parsePrice(priceRaw) || product?.price || 0}
        onVariantsChange={setVariantRows}
        onEnabledChange={setVariantsEnabled}
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
