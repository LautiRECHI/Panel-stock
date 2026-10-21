'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Package, Plus, Search, Pencil, Archive, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ProductWithVariant, ProductFilter } from '@/lib/products-utils'
import type { Category } from '@/lib/categories'
import { LOW_STOCK_THRESHOLD, formatPrice } from '@/lib/products-utils'
import { adjustStock, archiveProduct } from './actions'
import Stepper from '@/components/ui/Stepper'
import Button from '@/components/ui/Button'
import StatusChip from '@/components/ui/StatusChip'
import EmptyState from '@/components/ui/EmptyState'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'

const PAGE_SIZE = 25

type TabStatus = ProductFilter['status']

const TABS: { label: string; status: TabStatus }[] = [
  { label: 'Todos', status: undefined },
  { label: 'Activos', status: 'active' },
  { label: 'Borradores', status: 'draft' },
  { label: 'Poco stock', status: 'low_stock' },
  { label: 'Sin stock', status: 'no_stock' },
]

interface Props {
  products: ProductWithVariant[]
  total: number
  page: number
  categories: Category[]
  currentStatus: TabStatus
  currentSearch?: string
  currentCategoryId?: string
}

function buildUrl(params: {
  status?: TabStatus
  q?: string
  cat?: string
  page?: number
}): string {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.q) sp.set('q', params.q)
  if (params.cat) sp.set('cat', params.cat)
  if (params.page && params.page > 1) sp.set('page', String(params.page))
  const qs = sp.toString()
  return `/panel/productos${qs ? `?${qs}` : ''}`
}

function stockChip(stock: number) {
  if (stock === 0) return <StatusChip status="danger" label="Sin stock" />
  if (stock <= LOW_STOCK_THRESHOLD) return <StatusChip status="warning" label="Poco stock" />
  return <StatusChip status="success" label="En stock" />
}

function statusChip(status: ProductWithVariant['status']) {
  if (status === 'active') return <StatusChip status="success" label="Publicado" />
  if (status === 'draft') return <StatusChip status="neutral" label="Borrador" />
  return <StatusChip status="neutral" label="Archivado" />
}

function ProductThumbnail({ path, name }: { path: string | null; name: string }) {
  if (!path) {
    return (
      <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center flex-shrink-0">
        <Package className="w-4 h-4 text-muted" aria-hidden="true" />
      </div>
    )
  }

  // Build the public URL from storage path
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const url = supabaseUrl
    ? `${supabaseUrl}/storage/v1/object/public/product-images/${path}`
    : ''

  if (!url) {
    return (
      <div className="w-10 h-10 rounded-lg bg-surface border border-border flex items-center justify-center flex-shrink-0">
        <Package className="w-4 h-4 text-muted" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="w-10 h-10 rounded-lg overflow-hidden border border-border flex-shrink-0">
      <Image
        src={url}
        alt={name}
        width={40}
        height={40}
        className="w-full h-full object-cover"
      />
    </div>
  )
}

export default function ProductsClient({
  products,
  total,
  page,
  categories,
  currentStatus,
  currentSearch,
  currentCategoryId,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const searchRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()

  // Optimistic stock map: variantId → stock (only for simple products)
  const [stockMap, setStockMap] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    for (const p of products) {
      if (p.default_variant_id && !p.has_variants) m[p.default_variant_id] = p.total_stock
    }
    return m
  })

  // Archive modal
  type ArchiveState = { open: false } | { open: true; product: ProductWithVariant }
  const [archiveModal, setArchiveModal] = useState<ArchiveState>({ open: false })
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archivePending, startArchiveTransition] = useTransition()

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = searchRef.current?.value?.trim() || undefined
    router.push(buildUrl({ status: currentStatus, q, cat: currentCategoryId, page: 1 }))
  }

  function handleCategoryChange(cat: string) {
    router.push(buildUrl({ status: currentStatus, q: currentSearch, cat: cat || undefined, page: 1 }))
  }

  function getStock(product: ProductWithVariant): number {
    if (product.has_variants) return product.total_stock
    return stockMap[product.default_variant_id] ?? product.total_stock
  }

  function handleStepperChange(variantId: string, currentStock: number, newValue: number) {
    if (newValue < 0) return
    const delta = newValue - currentStock
    if (delta === 0) return

    // Optimistic update
    setStockMap(prev => ({ ...prev, [variantId]: newValue }))

    startTransition(async () => {
      const res = await adjustStock(variantId, delta, 'ajuste manual')
      if (!res.success) {
        setStockMap(prev => ({ ...prev, [variantId]: currentStock }))
        toast(res.error, 'error')
        return
      }
      if (res.newStock !== undefined) {
        setStockMap(prev => ({ ...prev, [variantId]: res.newStock! }))
      }
    })
  }

  function openArchiveModal(product: ProductWithVariant) {
    setArchiveError(null)
    setArchiveModal({ open: true, product })
  }

  function confirmArchive() {
    if (!archiveModal.open) return
    const { product } = archiveModal

    setArchiveError(null)
    startArchiveTransition(async () => {
      const res = await archiveProduct(product.id)
      if (!res.success) { setArchiveError(res.error); return }
      setArchiveModal({ open: false })
      toast('Producto archivado', 'success')
      router.refresh()
    })
  }

  const rootCategories = categories.filter(c => !c.parent_id)

  return (
    <div>
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Productos</h1>
          <p className="text-muted text-sm mt-0.5">
            {total > 0 ? `${total} producto${total !== 1 ? 's' : ''}` : 'Gestioná tu catálogo'}
          </p>
        </div>
        <Link href="/panel/productos/nuevo">
          <Button className="flex-shrink-0">
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Nuevo producto</span>
            <span className="sm:hidden">Nuevo</span>
          </Button>
        </Link>
      </div>

      {/* Filtros */}
      <div className="space-y-3 mb-5">
        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
          {TABS.map(tab => {
            const isActive = tab.status === currentStatus
            return (
              <Link
                key={tab.label}
                href={buildUrl({ status: tab.status, q: currentSearch, cat: currentCategoryId, page: 1 })}
                className={`flex-shrink-0 px-3 h-11 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
                  isActive
                    ? 'bg-foreground text-white'
                    : 'bg-card border border-border text-foreground hover:bg-surface'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>

        {/* Search + category */}
        <div className="flex gap-2">
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                type="search"
                placeholder="Buscar por nombre..."
                defaultValue={currentSearch ?? ''}
                className="w-full h-11 pl-9 pr-3 rounded-input border border-border bg-white text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
              />
            </div>
            <button
              type="submit"
              className="h-11 px-4 rounded-input border border-border bg-white text-sm font-medium text-foreground hover:bg-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 flex-shrink-0"
            >
              Buscar
            </button>
          </form>

          {rootCategories.length > 0 && (
            <div className="relative flex-shrink-0">
              <select
                value={currentCategoryId ?? ''}
                onChange={e => handleCategoryChange(e.target.value)}
                className="h-11 pl-3 pr-8 rounded-input border border-border bg-white text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-foreground/20 transition-colors"
                aria-label="Filtrar por categoría"
              >
                <option value="">Todas las categorías</option>
                {rootCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Lista */}
      {products.length === 0 ? (
        <EmptyState
          icon={<Package className="w-5 h-5" />}
          title={currentSearch || currentStatus ? 'No hay productos que coincidan' : 'Todavía no tenés productos'}
          description={
            currentSearch || currentStatus
              ? 'Probá con otros filtros o buscá por otro nombre.'
              : 'Creá tu primer producto para empezar a gestionar tu catálogo.'
          }
          action={
            !currentSearch && !currentStatus ? (
              <Link href="/panel/productos/nuevo">
                <Button>
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Crear primer producto
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop: tabla */}
          <div className="hidden md:block bg-card rounded-card border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">
                    Producto
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide hidden lg:table-cell">
                    Categoría
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">
                    Estado
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">
                    Precio
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wide">
                    Stock
                  </th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {products.map((product, idx) => {
                  const currentStock = getStock(product)
                  const hasBorder = idx < products.length - 1
                  return (
                    <tr
                      key={product.id}
                      className={`${hasBorder ? 'border-b border-border' : ''} hover:bg-surface/50 transition-colors`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProductThumbnail path={product.cover_image_path} name={product.name} />
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate max-w-[180px]">{product.name}</p>
                            <p className="text-xs text-muted font-mono hidden sm:block">{product.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-muted">
                        {product.category_name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {statusChip(product.status)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        ${formatPrice(product.price)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          {stockChip(currentStock)}
                          {product.has_variants ? (
                            <Link
                              href={`/panel/productos/${product.id}`}
                              className="text-xs text-muted underline hover:text-foreground transition-colors whitespace-nowrap"
                            >
                              Ver variantes
                            </Link>
                          ) : (
                            <Stepper
                              value={currentStock}
                              onChange={v => handleStepperChange(product.default_variant_id, currentStock, v)}
                              min={0}
                              disabled={isPending || !product.default_variant_id}
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/panel/productos/${product.id}`}
                            className="w-11 h-11 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
                            aria-label={`Editar ${product.name}`}
                          >
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => openArchiveModal(product)}
                            disabled={isPending}
                            className="w-11 h-11 flex items-center justify-center rounded-lg text-muted hover:text-stock-none hover:bg-stock-none-bg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stock-none/40 disabled:opacity-30 disabled:cursor-not-allowed"
                            aria-label={`Archivar ${product.name}`}
                          >
                            <Archive className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: tarjetas */}
          <div className="md:hidden space-y-3">
            {products.map(product => {
              const currentStock = getStock(product)
              return (
                <div key={product.id} className="bg-card rounded-card border border-border p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <ProductThumbnail path={product.cover_image_path} name={product.name} />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{product.name}</p>
                        {product.category_name && (
                          <p className="text-xs text-muted mt-0.5">{product.category_name}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0">{statusChip(product.status)}</div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground tabular-nums">
                        ${formatPrice(product.price)}
                      </p>
                      <div className="mt-1">{stockChip(currentStock)}</div>
                    </div>
                    {product.has_variants ? (
                      <Link
                        href={`/panel/productos/${product.id}`}
                        className="text-xs text-muted underline hover:text-foreground transition-colors"
                      >
                        Ver variantes
                      </Link>
                    ) : (
                      <Stepper
                        value={currentStock}
                        onChange={v => handleStepperChange(product.default_variant_id, currentStock, v)}
                        min={0}
                        disabled={isPending || !product.default_variant_id}
                      />
                    )}
                  </div>

                  <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                    <Link href={`/panel/productos/${product.id}`} className="flex-1">
                      <Button variant="secondary" className="w-full">
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                        Editar
                      </Button>
                    </Link>
                    <button
                      type="button"
                      onClick={() => openArchiveModal(product)}
                      disabled={isPending}
                      className="h-11 px-3 rounded-input border border-border bg-white text-muted hover:text-stock-none hover:border-stock-none/30 hover:bg-stock-none-bg transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-stock-none/40"
                      aria-label={`Archivar ${product.name}`}
                    >
                      <Archive className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted">
                Página {page} de {totalPages}
              </p>
              <div className="flex gap-2">
                <Link
                  href={buildUrl({ status: currentStatus, q: currentSearch, cat: currentCategoryId, page: page - 1 })}
                  aria-disabled={page <= 1}
                  tabIndex={page <= 1 ? -1 : undefined}
                  className={`h-11 px-3 flex items-center gap-1 rounded-input border border-border bg-card text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
                    page <= 1 ? 'opacity-40 pointer-events-none' : 'hover:bg-surface text-foreground'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  Anterior
                </Link>
                <Link
                  href={buildUrl({ status: currentStatus, q: currentSearch, cat: currentCategoryId, page: page + 1 })}
                  aria-disabled={page >= totalPages}
                  tabIndex={page >= totalPages ? -1 : undefined}
                  className={`h-11 px-3 flex items-center gap-1 rounded-input border border-border bg-card text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
                    page >= totalPages ? 'opacity-40 pointer-events-none' : 'hover:bg-surface text-foreground'
                  }`}
                >
                  Siguiente
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal: archivar */}
      <Modal
        open={archiveModal.open}
        onClose={() => setArchiveModal({ open: false })}
        title="Archivar producto"
        size="sm"
      >
        {archiveModal.open && (
          <div className="space-y-4">
            {archiveError ? (
              <p className="text-sm bg-stock-none-bg border border-stock-none/20 text-stock-none rounded-input px-3 py-2.5">
                {archiveError}
              </p>
            ) : (
              <p className="text-sm text-foreground">
                ¿Seguro que querés archivar <strong>{archiveModal.product.name}</strong>? El
                producto dejará de ser visible pero su historial de stock se conserva.
              </p>
            )}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setArchiveModal({ open: false })}
                className="flex-1"
              >
                Cancelar
              </Button>
              {!archiveError && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={confirmArchive}
                  loading={archivePending}
                  className="flex-1"
                >
                  Archivar
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
