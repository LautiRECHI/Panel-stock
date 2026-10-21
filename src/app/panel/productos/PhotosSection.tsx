'use client'

import { useState, useRef, useCallback, useTransition } from 'react'
import { ImageIcon, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ProductImageData } from '@/lib/products-utils'
import { validateImageFile, resizeAndConvert } from '@/lib/image-utils'
import { deletePhoto, reorderPhoto } from './photos-actions'
import Modal from '@/components/ui/Modal'

export type PendingPhoto = {
  blob: Blob
  mimeType: string
  ext: string
  previewUrl: string
  name: string
}

interface Props {
  productId?: string
  initialImages: ProductImageData[]
  onPendingChange: (pending: PendingPhoto[]) => void
}

const MAX_PHOTOS = 8

export default function PhotosSection({ productId, initialImages, onPendingChange }: Props) {
  const [existing, setExisting] = useState<ProductImageData[]>(initialImages)
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<ProductImageData | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const total = existing.length + pending.length

  function updatePending(next: PendingPhoto[]) {
    setPending(next)
    onPendingChange(next)
  }

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files)
    const newErrors: string[] = []
    const newPhotos: PendingPhoto[] = []

    for (const file of fileArr) {
      if (existing.length + pending.length + newPhotos.length >= MAX_PHOTOS) {
        newErrors.push(`Solo se pueden subir hasta ${MAX_PHOTOS} fotos por producto.`)
        break
      }

      const err = validateImageFile(file)
      if (err) {
        newErrors.push(`${file.name}: ${err}`)
        continue
      }

      try {
        const { blob, mimeType, ext } = await resizeAndConvert(file)
        const previewUrl = URL.createObjectURL(blob)
        newPhotos.push({ blob, mimeType, ext, previewUrl, name: file.name })
      } catch {
        newErrors.push(`${file.name}: No se pudo procesar la imagen.`)
      }
    }

    setErrors(newErrors)
    if (newPhotos.length > 0) {
      const next = [...pending, ...newPhotos]
      updatePending(next)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.length, pending])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      processFiles(e.target.files)
      e.target.value = ''
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() {
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files?.length) {
      processFiles(e.dataTransfer.files)
    }
  }

  // ── Reordenar (existentes) ────────────────────────────────────────────────

  function handleReorderExisting(photoId: string, direction: 'left' | 'right') {
    startTransition(async () => {
      const res = await reorderPhoto(photoId, direction)
      if (res.success) {
        setExisting(prev => {
          const arr = [...prev]
          const idx = arr.findIndex(p => p.id === photoId)
          if (idx === -1) return prev
          const swapIdx = direction === 'left' ? idx - 1 : idx + 1
          if (swapIdx < 0 || swapIdx >= arr.length) return prev
          ;[arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]]
          return arr.map((p, i) => ({ ...p, position: i }))
        })
      }
    })
  }

  // ── Reordenar (pendientes) ────────────────────────────────────────────────

  function handleReorderPending(idx: number, direction: 'left' | 'right') {
    const swapIdx = direction === 'left' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= pending.length) return
    const next = [...pending]
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    updatePending(next)
  }

  // ── Borrar (existentes) ───────────────────────────────────────────────────

  function confirmDeleteExisting() {
    if (!deleteTarget || !productId) return
    const photoId = deleteTarget.id
    setDeleteTarget(null)
    startTransition(async () => {
      const res = await deletePhoto(photoId)
      if (res.success) {
        setExisting(prev => prev.filter(p => p.id !== photoId).map((p, i) => ({ ...p, position: i })))
      }
    })
  }

  // ── Borrar (pendientes) ───────────────────────────────────────────────────

  function handleDeletePending(idx: number) {
    const next = pending.filter((_, i) => i !== idx)
    // Revocar URL de objeto para liberar memoria
    URL.revokeObjectURL(pending[idx].previewUrl)
    updatePending(next)
  }

  // Combinar lista para mostrar
  const allPhotos: Array<
    | { kind: 'existing'; data: ProductImageData; idx: number }
    | { kind: 'pending'; data: PendingPhoto; idx: number }
  > = [
    ...existing.map((d, idx) => ({ kind: 'existing' as const, data: d, idx })),
    ...pending.map((d, idx) => ({ kind: 'pending' as const, data: d, idx })),
  ]

  return (
    <section className="bg-card rounded-card border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Fotos</h2>
        <span className="text-xs text-muted">{total}/{MAX_PHOTOS} fotos</span>
      </div>

      {errors.length > 0 && (
        <ul className="space-y-1">
          {errors.map((err, i) => (
            <li
              key={i}
              className="text-sm bg-stock-none-bg border border-stock-none/20 text-stock-none rounded-input px-3 py-2"
            >
              {err}
            </li>
          ))}
        </ul>
      )}

      {/* Drop zone */}
      {total < MAX_PHOTOS && (
        <div
          ref={dropZoneRef}
          role="button"
          tabIndex={0}
          aria-label="Subir fotos"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
          className={`border-2 border-dashed rounded-card p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
            isDragging ? 'border-foreground/40 bg-surface' : 'border-border hover:border-foreground/30 hover:bg-surface/50'
          }`}
        >
          <ImageIcon className="w-8 h-8 text-muted" aria-hidden="true" />
          <p className="text-sm text-muted text-center">
            Arrastrá fotos aquí o <span className="text-foreground font-medium">elegí archivos</span>
          </p>
          <p className="text-xs text-muted">JPG, PNG o WebP · máx. 10 MB por foto</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
      />

      {/* Grilla de fotos */}
      {allPhotos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {allPhotos.map((item, globalIdx) => {
            const isFirst = globalIdx === 0
            const isLast = globalIdx === allPhotos.length - 1
            const src =
              item.kind === 'existing' ? item.data.url : item.data.previewUrl

            return (
              <div
                key={item.kind === 'existing' ? item.data.id : `pending-${item.idx}`}
                className="relative group aspect-square rounded-card overflow-hidden border border-border bg-surface"
              >
                {/* Thumbnail */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={item.kind === 'pending' ? item.data.name : `Foto ${globalIdx + 1}`}
                  className="w-full h-full object-cover"
                />

                {/* Badge portada */}
                {globalIdx === 0 && (
                  <span className="absolute top-1.5 left-1.5 bg-foreground/80 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                    Portada
                  </span>
                )}

                {/* Controles (visibles en hover o en mobile siempre) */}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-1 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity sm:flex">
                  <button
                    type="button"
                    aria-label="Mover a la izquierda"
                    disabled={isFirst || isPending}
                    onClick={() => {
                      if (item.kind === 'existing') {
                        handleReorderExisting(item.data.id, 'left')
                      } else {
                        handleReorderPending(item.idx, 'left')
                      }
                    }}
                    className="w-11 h-11 flex items-center justify-center text-white disabled:opacity-30 hover:bg-white/10 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    aria-label="Eliminar foto"
                    disabled={isPending}
                    onClick={() => {
                      if (item.kind === 'existing') {
                        if (productId) setDeleteTarget(item.data)
                      } else {
                        handleDeletePending(item.idx)
                      }
                    }}
                    className="w-11 h-11 flex items-center justify-center text-white hover:text-red-300 hover:bg-white/10 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    aria-label="Mover a la derecha"
                    disabled={isLast || isPending}
                    onClick={() => {
                      if (item.kind === 'existing') {
                        handleReorderExisting(item.data.id, 'right')
                      } else {
                        handleReorderPending(item.idx, 'right')
                      }
                    }}
                    className="w-11 h-11 flex items-center justify-center text-white disabled:opacity-30 hover:bg-white/10 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal confirmación borrar foto existente */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Eliminar foto"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            ¿Seguro que querés eliminar esta foto? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="flex-1 h-11 px-4 rounded-input border border-[#D5D3CB] bg-white text-sm font-medium text-foreground hover:bg-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmDeleteExisting}
              disabled={isPending}
              className="flex-1 h-11 px-4 rounded-input bg-stock-none text-white border border-transparent text-sm font-medium hover:bg-stock-none/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stock-none/40"
            >
              Eliminar
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
