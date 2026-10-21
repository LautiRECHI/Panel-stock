'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Tag, Pencil, Trash2, ChevronUp, ChevronDown, Plus } from 'lucide-react'
import type { CategoryNode } from '@/lib/categories'
import {
  createCategory,
  renameCategory,
  deleteCategory,
  moveCategory,
} from './actions'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'

type ModalState =
  | { type: 'closed' }
  | { type: 'create'; parentId?: string; parentName?: string }
  | { type: 'rename'; id: string; currentName: string }
  | { type: 'delete'; id: string; name: string; childrenCount: number }

interface Props {
  tree: CategoryNode[]
}

// Botón de acción: siempre visible, 44×44px touch target
function ActionBtn({
  onClick,
  disabled,
  label,
  danger,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`w-11 h-11 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 ${
        danger
          ? 'text-muted hover:text-stock-none hover:bg-stock-none-bg focus-visible:ring-stock-none/40'
          : 'text-muted hover:text-foreground hover:bg-surface'
      }`}
    >
      {children}
    </button>
  )
}

export default function CategoriesClient({ tree }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [modal, setModal] = useState<ModalState>({ type: 'closed' })
  const [modalError, setModalError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function openCreate(parentId?: string, parentName?: string) {
    setModalError(null)
    setModal({ type: 'create', parentId, parentName })
  }

  function openRename(id: string, currentName: string) {
    setModalError(null)
    setModal({ type: 'rename', id, currentName })
  }

  function openDelete(id: string, name: string, childrenCount: number) {
    setModalError(null)
    setModal({ type: 'delete', id, name, childrenCount })
  }

  function closeModal() {
    setModal({ type: 'closed' })
    setModalError(null)
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = (new FormData(e.currentTarget).get('name') as string) ?? ''
    const parentId = modal.type === 'create' ? modal.parentId : undefined

    startTransition(async () => {
      const res = await createCategory({ name, parentId: parentId ?? null })
      if (!res.success) { setModalError(res.error); return }
      closeModal()
      toast('Categoría creada', 'success')
      router.refresh()
    })
  }

  function handleRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (modal.type !== 'rename') return
    const name = (new FormData(e.currentTarget).get('name') as string) ?? ''

    startTransition(async () => {
      const res = await renameCategory(modal.id, name)
      if (!res.success) { setModalError(res.error); return }
      closeModal()
      toast('Categoría renombrada', 'success')
      router.refresh()
    })
  }

  function handleDelete() {
    if (modal.type !== 'delete') return

    startTransition(async () => {
      const res = await deleteCategory(modal.id)
      if (!res.success) { setModalError(res.error); return }
      closeModal()
      toast('Categoría eliminada', 'success')
      router.refresh()
    })
  }

  function handleMove(id: string, direction: 'up' | 'down') {
    startTransition(async () => {
      await moveCategory(id, direction)
      router.refresh()
    })
  }

  // Lista plana con profundidad y hermanos
  type FlatItem = { node: CategoryNode; depth: number; siblings: CategoryNode[] }
  const flat: FlatItem[] = []
  for (const root of tree) {
    flat.push({ node: root, depth: 0, siblings: tree })
    for (const child of root.children) {
      flat.push({ node: child, depth: 1, siblings: root.children })
    }
  }

  const modalKey =
    modal.type === 'create' ? `create-${modal.parentId ?? 'root'}`
    : modal.type === 'rename' ? `rename-${modal.id}`
    : modal.type === 'delete' ? `delete-${modal.id}`
    : 'closed'

  return (
    <div className="max-w-2xl">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Categorías</h1>
          <p className="text-muted text-sm mt-0.5">
            Organizá tus productos en categorías y subcategorías
          </p>
        </div>
        <Button onClick={() => openCreate()} className="flex-shrink-0">
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Nueva categoría</span>
          <span className="sm:hidden">Nueva</span>
        </Button>
      </div>

      {/* Lista */}
      {tree.length === 0 ? (
        <EmptyState
          icon={<Tag className="w-5 h-5" />}
          title="Todavía no tenés categorías"
          description="Creá tu primera categoría para organizar tus productos."
          action={
            <Button onClick={() => openCreate()}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              Crear primera categoría
            </Button>
          }
        />
      ) : (
        <div className="bg-card rounded-card border border-border overflow-hidden">
          {flat.map(({ node, depth, siblings }, idx) => {
            const isFirst = siblings[0].id === node.id
            const isLast = siblings[siblings.length - 1].id === node.id
            const hasBorder = idx < flat.length - 1

            return (
              <div
                key={node.id}
                className={`flex items-center gap-1 pr-1 min-h-[56px] ${hasBorder ? 'border-b border-border' : ''}`}
                style={{ paddingLeft: `${depth === 0 ? 16 : 40}px` }}
              >
                {depth > 0 && (
                  <span className="text-muted mr-0.5 flex-shrink-0 text-sm select-none" aria-hidden="true">
                    └
                  </span>
                )}

                {/* Nombre y slug */}
                <div className="flex-1 min-w-0 py-3">
                  <span className="text-sm font-medium text-foreground block truncate">
                    {node.name}
                  </span>
                  <span className="text-xs text-muted font-mono hidden sm:block">
                    {node.slug}
                  </span>
                </div>

                {/* Acciones — siempre visibles (touch + desktop) */}
                <div className="flex items-center flex-shrink-0">
                  <ActionBtn
                    onClick={() => handleMove(node.id, 'up')}
                    disabled={isFirst || isPending}
                    label={`Subir ${node.name}`}
                  >
                    <ChevronUp className="w-4 h-4" aria-hidden="true" />
                  </ActionBtn>

                  <ActionBtn
                    onClick={() => handleMove(node.id, 'down')}
                    disabled={isLast || isPending}
                    label={`Bajar ${node.name}`}
                  >
                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                  </ActionBtn>

                  {depth === 0 && (
                    <ActionBtn
                      onClick={() => openCreate(node.id, node.name)}
                      disabled={isPending}
                      label={`Agregar subcategoría a ${node.name}`}
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                    </ActionBtn>
                  )}

                  <ActionBtn
                    onClick={() => openRename(node.id, node.name)}
                    disabled={isPending}
                    label={`Renombrar ${node.name}`}
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </ActionBtn>

                  <ActionBtn
                    onClick={() => openDelete(node.id, node.name, node.children.length)}
                    disabled={isPending}
                    label={`Eliminar ${node.name}`}
                    danger
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </ActionBtn>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: crear */}
      <Modal
        key={modalKey}
        open={modal.type === 'create'}
        onClose={closeModal}
        title={
          modal.type === 'create' && modal.parentId
            ? `Nueva subcategoría de ${modal.parentName ?? ''}`
            : 'Nueva categoría'
        }
        size="sm"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            id="cat-name"
            name="name"
            label="Nombre"
            placeholder="Ej: Raquetas"
            required
            autoFocus
            maxLength={100}
            error={modalError ?? undefined}
          />
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={closeModal} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" loading={isPending} className="flex-1">
              Crear
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: renombrar */}
      <Modal
        key={modalKey}
        open={modal.type === 'rename'}
        onClose={closeModal}
        title="Renombrar categoría"
        size="sm"
      >
        <form onSubmit={handleRename} className="space-y-4">
          <Input
            id="cat-rename"
            name="name"
            label="Nuevo nombre"
            defaultValue={modal.type === 'rename' ? modal.currentName : ''}
            required
            autoFocus
            maxLength={100}
            error={modalError ?? undefined}
          />
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={closeModal} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" loading={isPending} className="flex-1">
              Guardar
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: eliminar */}
      <Modal
        key={modalKey}
        open={modal.type === 'delete'}
        onClose={closeModal}
        title="Eliminar categoría"
        size="sm"
      >
        {modal.type === 'delete' && (
          <div className="space-y-4">
            {modalError ? (
              <p className="text-sm bg-stock-none-bg border border-stock-none/20 text-stock-none rounded-input px-3 py-2.5">
                {modalError}
              </p>
            ) : modal.childrenCount > 0 ? (
              <p className="text-sm text-foreground">
                <strong>{modal.name}</strong> tiene {modal.childrenCount}{' '}
                subcategoría{modal.childrenCount > 1 ? 's' : ''}. Si eliminás,
                quedan como categorías raíz. ¿Querés continuar?
              </p>
            ) : (
              <p className="text-sm text-foreground">
                ¿Seguro que querés eliminar <strong>{modal.name}</strong>? Esta
                acción no se puede deshacer.
              </p>
            )}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={closeModal}
                className="flex-1"
              >
                Cancelar
              </Button>
              {!modalError && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={handleDelete}
                  loading={isPending}
                  className="flex-1"
                >
                  Eliminar
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
