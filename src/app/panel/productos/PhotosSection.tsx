'use client'

import {
  useState, useRef, useCallback, useTransition,
  forwardRef, useImperativeHandle, useEffect,
} from 'react'
import {
  ImageIcon, Trash2, ChevronLeft, ChevronRight, RotateCcw, AlertCircle,
} from 'lucide-react'
import type { ProductImageData } from '@/lib/products-utils'
import { validateImageFile, resizeAndConvert, MAX_PRODUCT_IMAGES } from '@/lib/image-utils'
import { registerPhoto, deletePhoto, bulkSetPhotoPositions } from './photos-actions'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'

const UPLOAD_TIMEOUT_MS = 60_000

function withUploadTimeout<T>(promise: Promise<T>): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error('La subida tardó demasiado. Verificá tu conexión e intentá de nuevo.')),
      UPLOAD_TIMEOUT_MS
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId))
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ExistingItem = { kind: 'existing'; data: ProductImageData }
type LocalItem = {
  kind: 'pending' | 'uploading' | 'error'
  localId: string
  previewUrl: string
  name: string
  blob: Blob
  mimeType: string
  ext: string
  progress?: number
  errorMsg?: string
}
type PhotoItem = ExistingItem | LocalItem

export interface PhotosSectionHandle {
  uploadAllPending: (
    productId: string,
    storeId: string
  ) => Promise<{ uploaded: number; failed: string[] }>
}

interface Props {
  productId?: string
  storeId: string
  initialImages: ProductImageData[]
}

// ── Component ─────────────────────────────────────────────────────────────────

const PhotosSection = forwardRef<PhotosSectionHandle, Props>(function PhotosSection(
  { productId, storeId, initialImages },
  ref
) {
  const [items, setItems] = useState<PhotoItem[]>(
    initialImages.map(d => ({ kind: 'existing' as const, data: d }))
  )
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<ProductImageData | null>(null)
  const [, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDraggingZone, setIsDraggingZone] = useState(false)
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // Siempre tener la lista actualizada en el ref para cerrar la clausura de processFiles
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items }, [items])

  const isUploadingAny = items.some(i => i.kind === 'uploading')
  const total = items.length
  const slotsLeft = MAX_PRODUCT_IMAGES - total

  // ── Upload individual ────────────────────────────────────────────────────

  async function uploadOne(
    localId: string,
    blob: Blob,
    mimeType: string,
    ext: string,
    pid: string,
    sid: string
  ): Promise<{ path: string; dbId: string } | { error: string }> {
    const uuid = crypto.randomUUID()
    const path = `${sid}/products/${pid}/${uuid}.${ext}`

    setItems(prev =>
      prev.map(item =>
        'localId' in item && item.localId === localId
          ? { ...item, kind: 'uploading' as const, progress: 0, errorMsg: undefined }
          : item
      )
    )

    const supabase = createClient()

    // Progreso simulado: avanza hasta 85% mientras dura el upload
    let pct = 0
    const timer = setInterval(() => {
      pct = Math.min(85, pct + (pct < 40 ? 8 : pct < 70 ? 4 : 1))
      setItems(prev =>
        prev.map(item =>
          'localId' in item && item.localId === localId
            ? { ...item, progress: pct }
            : item
        )
      )
    }, 120)

    let uploadError: { message: string } | null = null
    try {
      const result = await withUploadTimeout(
        supabase.storage.from('product-images').upload(path, blob, { contentType: mimeType, upsert: false })
      )
      uploadError = result.error
    } catch (err) {
      clearInterval(timer)
      const msg = err instanceof Error ? err.message : 'Error al subir la imagen. Intentá de nuevo.'
      return { error: msg }
    }

    clearInterval(timer)

    if (uploadError) {
      const msg =
        uploadError.message.toLowerCase().includes('duplicate') ||
        uploadError.message.includes('already exists')
          ? 'La imagen ya existe en el servidor.'
          : uploadError.message.includes('403') ||
            uploadError.message.toLowerCase().includes('unauthorized') ||
            uploadError.message.toLowerCase().includes('not allowed')
          ? 'Sin permiso para subir imágenes en esta tienda.'
          : uploadError.message.toLowerCase().includes('network') ||
            uploadError.message.toLowerCase().includes('fetch')
          ? 'Error de red. Verificá tu conexión e intentá de nuevo.'
          : 'No se pudo subir la imagen. Intentá de nuevo.'
      return { error: msg }
    }

    setItems(prev =>
      prev.map(item =>
        'localId' in item && item.localId === localId
          ? { ...item, progress: 95 }
          : item
      )
    )

    let res: Awaited<ReturnType<typeof registerPhoto>>
    try {
      res = await registerPhoto(pid, path)
    } catch {
      supabase.storage.from('product-images').remove([path])
      return { error: 'Error de red al registrar la foto. Verificá tu conexión e intentá de nuevo.' }
    }
    if (!res.success) {
      supabase.storage.from('product-images').remove([path])
      return { error: res.error ?? 'No se pudo registrar la foto.' }
    }

    return { path, dbId: res.id! }
  }

  function resolveUpload(
    localId: string,
    previewUrl: string,
    path: string,
    dbId: string
  ) {
    setItems(prev =>
      prev.map(item =>
        'localId' in item && item.localId === localId
          ? {
              kind: 'existing' as const,
              data: {
                id: dbId,
                path,
                position: prev.filter(i => i.kind === 'existing').length,
                url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${path}`,
              },
            }
          : item
      )
    )
    URL.revokeObjectURL(previewUrl)
  }

  function rejectUpload(localId: string, errorMsg: string) {
    setItems(prev =>
      prev.map(item =>
        'localId' in item && item.localId === localId
          ? { ...item, kind: 'error' as const, errorMsg, progress: undefined }
          : item
      )
    )
  }

  // ── uploadAllPending (CREATE mode) ────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    async uploadAllPending(pid: string, sid: string) {
      const pending = itemsRef.current.filter(
        (i): i is LocalItem => i.kind === 'pending' || i.kind === 'error'
      )
      let uploaded = 0
      const failed: string[] = []

      for (const item of pending) {
        const result = await uploadOne(item.localId, item.blob, item.mimeType, item.ext, pid, sid)
        if ('error' in result) {
          failed.push(item.name)
          rejectUpload(item.localId, result.error)
        } else {
          uploaded++
          resolveUpload(item.localId, item.previewUrl, result.path, result.dbId)
        }
      }

      return { uploaded, failed }
    },
  }))

  // ── Procesar archivos ────────────────────────────────────────────────────

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArr = Array.from(files)
      const newErrors: string[] = []
      const newItems: LocalItem[] = []
      const currentCount = itemsRef.current.length

      for (const file of fileArr) {
        if (currentCount + newItems.length >= MAX_PRODUCT_IMAGES) {
          newErrors.push(
            `Límite alcanzado: máximo ${MAX_PRODUCT_IMAGES} fotos por producto.`
          )
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
          const localId = crypto.randomUUID()
          newItems.push({
            kind: 'pending',
            localId,
            previewUrl,
            name: file.name,
            blob,
            mimeType,
            ext,
          })
        } catch {
          newErrors.push(`${file.name}: No se pudo procesar la imagen.`)
        }
      }

      setFileErrors(newErrors)
      if (newItems.length === 0) return

      if (productId) {
        // EDIT: subir de inmediato (en paralelo, cada uno es su propia petición)
        setItems(prev => [...prev, ...newItems])
        await Promise.all(
          newItems.map(async item => {
            const result = await uploadOne(
              item.localId,
              item.blob,
              item.mimeType,
              item.ext,
              productId,
              storeId
            )
            if ('error' in result) {
              rejectUpload(item.localId, result.error)
            } else {
              resolveUpload(item.localId, item.previewUrl, result.path, result.dbId)
            }
          })
        )
      } else {
        // CREATE: encolar, el form llama uploadAllPending al crear el producto
        setItems(prev => [...prev, ...newItems])
      }
    },
    [productId, storeId]
  )

  // ── Retry ────────────────────────────────────────────────────────────────

  async function retryUpload(item: LocalItem) {
    if (!productId) return
    setItems(prev =>
      prev.map(i =>
        'localId' in i && i.localId === item.localId
          ? { ...i, kind: 'pending' as const, errorMsg: undefined }
          : i
      )
    )
    const result = await uploadOne(item.localId, item.blob, item.mimeType, item.ext, productId, storeId)
    if ('error' in result) {
      rejectUpload(item.localId, result.error)
    } else {
      resolveUpload(item.localId, item.previewUrl, result.path, result.dbId)
    }
  }

  // ── Eliminar ─────────────────────────────────────────────────────────────

  function removeLocalItem(localId: string, previewUrl: string) {
    URL.revokeObjectURL(previewUrl)
    setItems(prev => prev.filter(i => !('localId' in i) || i.localId !== localId))
  }

  function confirmDeleteExisting() {
    if (!deleteTarget || !productId) return
    const photoId = deleteTarget.id
    setDeleteTarget(null)
    startTransition(async () => {
      const res = await deletePhoto(photoId)
      if (res.success) {
        setItems(prev => prev.filter(i => !(i.kind === 'existing' && i.data.id === photoId)))
      }
    })
  }

  // ── Reordenar (arrastrar) ─────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, idx: number) {
    setDragSrcIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOverItem(e: React.DragEvent, idx: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }

  function handleDragEnd() {
    setDragSrcIdx(null)
    setDragOverIdx(null)
  }

  async function handleDropItem(e: React.DragEvent, dropIdx: number) {
    e.preventDefault()
    const src = dragSrcIdx
    setDragSrcIdx(null)
    setDragOverIdx(null)
    if (src === null || src === dropIdx) return

    setItems(prev => {
      const next = [...prev]
      const [moved] = next.splice(src, 1)
      next.splice(dropIdx, 0, moved)
      return next
    })

    // Persistir posiciones de las existentes
    if (productId) {
      // Leer el estado actualizado via callback para evitar stale closure
      setItems(current => {
        const existingUpdates = current
          .filter((i): i is ExistingItem => i.kind === 'existing')
          .map((i, pos) => ({ id: i.data.id, position: pos }))
        if (existingUpdates.length > 0) {
          bulkSetPhotoPositions(existingUpdates, productId)
        }
        return current
      })
    }
  }

  // ── Reordenar (flechas) ───────────────────────────────────────────────────

  function moveItem(idx: number, direction: 'left' | 'right') {
    const swapIdx = direction === 'left' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= items.length) return

    setItems(prev => {
      const next = [...prev]
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      if (productId) {
        const updates = next
          .filter((i): i is ExistingItem => i.kind === 'existing')
          .map((i, pos) => ({ id: i.data.id, position: pos }))
        if (updates.length > 0) bulkSetPhotoPositions(updates, productId)
      }
      return next
    })
  }

  // ── Input handlers ────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      processFiles(e.target.files)
      e.target.value = ''
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="bg-card rounded-card border border-border p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Fotos</h2>
        <span className="text-xs text-muted">
          {total}/{MAX_PRODUCT_IMAGES} foto{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Errores de validación */}
      {fileErrors.length > 0 && (
        <ul className="space-y-1">
          {fileErrors.map((err, i) => (
            <li
              key={i}
              className="text-sm bg-stock-none-bg border border-stock-none/20 text-stock-none rounded-input px-3 py-2"
            >
              {err}
            </li>
          ))}
        </ul>
      )}

      {/* Zona de drop */}
      {slotsLeft > 0 && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Subir fotos"
          onDragOver={e => { e.preventDefault(); setIsDraggingZone(true) }}
          onDragLeave={() => setIsDraggingZone(false)}
          onDrop={e => {
            e.preventDefault()
            setIsDraggingZone(false)
            if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files)
          }}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
          }}
          className={`border-2 border-dashed rounded-card p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
            isDraggingZone
              ? 'border-foreground/40 bg-surface'
              : 'border-border hover:border-foreground/30 hover:bg-surface/50'
          }`}
        >
          <ImageIcon className="w-8 h-8 text-muted" aria-hidden="true" />
          <p className="text-sm text-muted text-center">
            Arrastrá fotos aquí o{' '}
            <span className="text-foreground font-medium">elegí archivos</span>
          </p>
          <p className="text-xs text-muted">
            JPG, PNG o WebP · se comprimen automáticamente ·{' '}
            {slotsLeft} lugar{slotsLeft !== 1 ? 'es' : ''} disponible{slotsLeft !== 1 ? 's' : ''}
          </p>
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

      {/* Grilla */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {items.map((item, globalIdx) => {
            const isFirst = globalIdx === 0
            const isLast = globalIdx === items.length - 1
            const isExisting = item.kind === 'existing'
            const isUploading = item.kind === 'uploading'
            const isError = item.kind === 'error'
            const isPendingState = item.kind === 'pending'
            const isDragSrc = dragSrcIdx === globalIdx
            const isDragTarget = dragOverIdx === globalIdx && dragSrcIdx !== globalIdx
            const key = isExisting ? item.data.id : item.localId
            const src = isExisting ? item.data.url : item.previewUrl
            const altText = isExisting ? `Foto ${globalIdx + 1}` : item.name

            return (
              <div
                key={key}
                draggable={!isUploading}
                onDragStart={e => handleDragStart(e, globalIdx)}
                onDragOver={e => handleDragOverItem(e, globalIdx)}
                onDragEnd={handleDragEnd}
                onDrop={e => handleDropItem(e, globalIdx)}
                className={`relative group aspect-square rounded-card overflow-hidden border bg-surface transition-transform select-none ${
                  isDragTarget
                    ? 'border-foreground/50 ring-2 ring-foreground/20 scale-[1.03]'
                    : isDragSrc
                    ? 'border-border opacity-40'
                    : 'border-border'
                }`}
              >
                {/* Thumbnail */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={altText}
                  className={`w-full h-full object-cover transition-opacity ${
                    isUploading ? 'opacity-60' : ''
                  }`}
                  draggable={false}
                />

                {/* Badge portada */}
                {globalIdx === 0 && !isError && !isPendingState && (
                  <span className="absolute top-1.5 left-1.5 bg-foreground/80 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                    Portada
                  </span>
                )}

                {/* Overlay pendiente (solo en CREATE mode) */}
                {isPendingState && !productId && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                    <span className="text-white text-[10px] font-medium bg-black/40 px-2 py-0.5 rounded">
                      Pendiente
                    </span>
                  </div>
                )}

                {/* Barra de progreso */}
                {isUploading && (
                  <div className="absolute inset-x-0 bottom-0 pointer-events-none">
                    <div className="h-1.5 bg-white/30">
                      <div
                        className="h-1.5 bg-white transition-all duration-200"
                        style={{ width: `${item.progress ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Overlay de error */}
                {isError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/65 p-2">
                    <AlertCircle
                      className="w-5 h-5 text-red-300 shrink-0"
                      aria-hidden="true"
                    />
                    <p className="text-white text-[10px] text-center leading-tight line-clamp-3">
                      {item.errorMsg}
                    </p>
                    {productId && (
                      <button
                        type="button"
                        onClick={() => retryUpload(item)}
                        aria-label={`Reintentar subida de ${item.name}`}
                        className="mt-0.5 flex items-center gap-1 text-[10px] text-white bg-white/20 hover:bg-white/35 rounded px-2 py-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
                      >
                        <RotateCcw className="w-3 h-3" aria-hidden="true" />
                        Reintentar
                      </button>
                    )}
                  </div>
                )}

                {/* Controles (hover/visible en mobile) */}
                {!isUploading && !isError && (
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-1 bg-black/40 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label="Mover a la izquierda"
                      disabled={isFirst || isUploadingAny}
                      onClick={() => moveItem(globalIdx, 'left')}
                      className="w-11 h-11 flex items-center justify-center text-white disabled:opacity-30 hover:bg-white/10 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      aria-label="Eliminar foto"
                      disabled={isUploadingAny}
                      onClick={() => {
                        if (isExisting && productId) {
                          setDeleteTarget(item.data)
                        } else if (!isExisting) {
                          removeLocalItem(item.localId, item.previewUrl)
                        }
                      }}
                      className="w-11 h-11 flex items-center justify-center text-white hover:text-red-300 hover:bg-white/10 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      aria-label="Mover a la derecha"
                      disabled={isLast || isUploadingAny}
                      onClick={() => moveItem(globalIdx, 'right')}
                      className="w-11 h-11 flex items-center justify-center text-white disabled:opacity-30 hover:bg-white/10 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    >
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
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
              className="flex-1 h-11 px-4 rounded-input bg-stock-none text-white border border-transparent text-sm font-medium hover:bg-stock-none/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stock-none/40"
            >
              Eliminar
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
})

export default PhotosSection
