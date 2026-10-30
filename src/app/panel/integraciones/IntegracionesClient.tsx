'use client'

import { useState, useCallback } from 'react'
import { KeyRound, Plus, Eye, EyeOff, Copy, Check, Trash2, AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import EmptyState from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { createApiKey, revokeApiKey } from './actions'
import type { StoreApiKey } from '@/lib/api-keys'

interface Props {
  keys: StoreApiKey[]
  isOwner: boolean
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function KeyRow({
  apiKey,
  onRevoke,
}: {
  apiKey: StoreApiKey
  onRevoke: (id: string, name: string) => void
}) {
  const revoked = apiKey.revoked_at != null
  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl border ${revoked ? 'border-border bg-surface opacity-60' : 'border-border bg-card'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground">{apiKey.name}</span>
          {revoked ? (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Revocada</span>
          ) : (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Activa</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
          <span>Prefijo: <code className="font-mono">{apiKey.key_prefix}...</code></span>
          <span>Creada: {formatDate(apiKey.created_at)}</span>
          {apiKey.last_used_at && (
            <span>Último uso: {formatDate(apiKey.last_used_at)}</span>
          )}
          {revoked && apiKey.revoked_at && (
            <span>Revocada: {formatDate(apiKey.revoked_at)}</span>
          )}
        </div>
      </div>
      {!revoked && (
        <button
          onClick={() => onRevoke(apiKey.id, apiKey.name)}
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-muted hover:text-red-600 hover:bg-red-50 transition-colors"
          aria-label={`Revocar clave ${apiKey.name}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

export default function IntegracionesClient({ keys: initialKeys, isOwner }: Props) {
  const { toast: showToast } = useToast()
  const [keys, setKeys] = useState<StoreApiKey[]>(initialKeys)

  // Modal crear clave
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [secretVisible, setSecretVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  // Modal revocar clave
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null)
  const [revoking, setRevoking] = useState(false)

  const handleOpenCreate = useCallback(() => {
    setCreateName('')
    setNewSecret(null)
    setSecretVisible(false)
    setCopied(false)
    setShowCreate(true)
  }, [])

  const handleCloseCreate = useCallback(() => {
    if (newSecret) {
      // Si ya se mostró el secreto, recargar la lista al cerrar
      window.location.reload()
    }
    setShowCreate(false)
  }, [newSecret])

  const handleCreate = async () => {
    if (!createName.trim()) return
    setCreating(true)
    try {
      const { secret } = await createApiKey(createName.trim())
      setNewSecret(secret)
    } catch (err) {
      showToast((err as Error).message || 'Error al crear la clave', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = async () => {
    if (!newSecret) return
    try {
      await navigator.clipboard.writeText(newSecret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('No se pudo copiar. Copiá manualmente.', 'error')
    }
  }

  const handleRevokeRequest = useCallback((id: string, name: string) => {
    setRevokeTarget({ id, name })
  }, [])

  const handleRevokeConfirm = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await revokeApiKey(revokeTarget.id)
      setKeys(prev => prev.map(k =>
        k.id === revokeTarget.id ? { ...k, revoked_at: new Date().toISOString() } : k
      ))
      showToast('Clave revocada correctamente', 'success')
    } catch (err) {
      showToast((err as Error).message || 'Error al revocar', 'error')
    } finally {
      setRevoking(false)
      setRevokeTarget(null)
    }
  }

  if (!isOwner) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-foreground mb-6">Integraciones</h1>
        <div className="bg-card border border-border rounded-card p-6 text-sm text-muted">
          Solo el dueño de la tienda puede gestionar las claves de API.
        </div>
      </div>
    )
  }

  const activeKeys = keys.filter(k => !k.revoked_at)
  const revokedKeys = keys.filter(k => k.revoked_at)

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Integraciones</h1>
          <p className="text-sm text-muted mt-0.5">
            Claves de API para que tu tienda online cree pedidos directamente en el panel.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="flex-shrink-0">
          <Plus className="w-4 h-4 mr-1" />
          Nueva clave
        </Button>
      </div>

      {activeKeys.length === 0 && revokedKeys.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="w-6 h-6" />}
          title="Sin claves de API"
          description="Creá una clave para que tu tienda online pueda enviar pedidos al panel."
          action={
            <Button onClick={handleOpenCreate}>
              <Plus className="w-4 h-4 mr-1" />
              Crear clave
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {activeKeys.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted uppercase tracking-wide">Activas</p>
              {activeKeys.map(k => (
                <KeyRow key={k.id} apiKey={k} onRevoke={handleRevokeRequest} />
              ))}
            </div>
          )}
          {revokedKeys.length > 0 && (
            <div className="space-y-2 mt-4">
              <p className="text-xs font-medium text-muted uppercase tracking-wide">Revocadas</p>
              {revokedKeys.map(k => (
                <KeyRow key={k.id} apiKey={k} onRevoke={handleRevokeRequest} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal crear clave */}
      <Modal
        open={showCreate}
        onClose={handleCloseCreate}
        title={newSecret ? 'Guardá tu clave' : 'Nueva clave de API'}
        description={
          newSecret
            ? 'Esta es la única vez que vas a ver el secreto completo. Guardalo en las variables de entorno de tu tienda.'
            : 'Dale un nombre descriptivo para identificarla después.'
        }
        size="md"
      >
        {!newSecret ? (
          <div className="space-y-4">
            <Input
              label="Nombre"
              placeholder="Ej: Tienda producción"
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={handleCloseCreate} disabled={creating}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
                {creating ? 'Creando...' : 'Crear clave'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-2 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>No guardés este secreto en el navegador ni lo compartas. Usalo solo en variables de entorno de tu servidor.</span>
            </div>

            <div className="relative">
              <label className="text-xs font-medium text-muted mb-1.5 block">Secreto</label>
              <div className="flex items-center gap-2 p-3 bg-surface rounded-lg border border-border font-mono text-xs break-all pr-20">
                <span className="flex-1">
                  {secretVisible ? newSecret : '•'.repeat(Math.min(newSecret.length, 40))}
                </span>
                <div className="absolute right-2 top-7 flex gap-1">
                  <button
                    onClick={() => setSecretVisible(v => !v)}
                    className="p-1.5 rounded hover:bg-border transition-colors"
                    aria-label={secretVisible ? 'Ocultar' : 'Mostrar'}
                  >
                    {secretVisible ? <EyeOff className="w-3.5 h-3.5 text-muted" /> : <Eye className="w-3.5 h-3.5 text-muted" />}
                  </button>
                  <button
                    onClick={handleCopy}
                    className="p-1.5 rounded hover:bg-border transition-colors"
                    aria-label="Copiar"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5 text-muted" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleCloseCreate}>
                Ya lo guardé, cerrar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal revocar */}
      <Modal
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Revocar clave"
        description={`¿Estás seguro de que querés revocar "${revokeTarget?.name}"? Esta acción no se puede deshacer y dejará de funcionar de inmediato.`}
        size="sm"
      >
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={() => setRevokeTarget(null)} disabled={revoking}>
            Cancelar
          </Button>
          <Button
            onClick={handleRevokeConfirm}
            disabled={revoking}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {revoking ? 'Revocando...' : 'Revocar clave'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
