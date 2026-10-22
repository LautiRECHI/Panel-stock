'use client'

import { useState, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import type { ProductVariant } from '@/lib/products-utils'
import { formatPrice } from '@/lib/products-utils'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'

export type VariantRowData = {
  id?: string
  sku: string
  attributes: Record<string, string>
  priceRaw: string
  stock: number
}

interface OptionDef {
  name: string
  values: string[]
}

type RemovalPending =
  | { kind: 'chip';   optIdx: number; valIdx: number; count: number; totalStock: number }
  | { kind: 'option'; optIdx: number;                 count: number; totalStock: number }
  | { kind: 'toggle';                                 count: number; totalStock: number }

interface Props {
  productId?: string
  initialVariants: ProductVariant[]
  productPrice: number
  onVariantsChange: (variants: VariantRowData[]) => void
  onEnabledChange: (enabled: boolean) => void
}

function attrsKey(attrs: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(attrs).sort()))
}

function generateCombinations(options: OptionDef[]): Record<string, string>[] {
  const activeOptions = options.filter(o => o.name.trim() && o.values.length > 0)
  if (!activeOptions.length) return []

  const [first, ...rest] = activeOptions
  let combos: Record<string, string>[] = first.values.map(v => ({ [first.name]: v }))

  for (const opt of rest) {
    const next: Record<string, string>[] = []
    for (const combo of combos) {
      for (const v of opt.values) {
        next.push({ ...combo, [opt.name]: v })
      }
    }
    combos = next
  }

  return combos
}

function mergeRows(
  combos: Record<string, string>[],
  existing: VariantRowData[]
): VariantRowData[] {
  const existingByKey = new Map<string, VariantRowData>()
  for (const row of existing) {
    existingByKey.set(attrsKey(row.attributes), row)
  }
  return combos.map(attrs => {
    const key = attrsKey(attrs)
    const prev = existingByKey.get(key)
    if (prev) return { ...prev, attributes: attrs }
    const label = Object.values(attrs).join('-').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12)
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
    return { sku: label ? `${label}-${rand}` : rand, attributes: attrs, priceRaw: '', stock: 0 }
  })
}

function rowsWithStock(rows: VariantRowData[]): { count: number; totalStock: number } {
  const matching = rows.filter(r => r.stock > 0)
  return { count: matching.length, totalStock: matching.reduce((s, r) => s + r.stock, 0) }
}

export default function VariantsSection({
  initialVariants,
  productPrice,
  onVariantsChange,
  onEnabledChange,
}: Props) {
  const hasRealVariants = initialVariants.some(v => Object.keys(v.attributes).length > 0)
  const defaultVariant = initialVariants.find(v => Object.keys(v.attributes).length === 0)

  function buildInitialOptions(): OptionDef[] {
    if (!hasRealVariants) return [{ name: '', values: [] }]
    const optionMap = new Map<string, Set<string>>()
    for (const v of initialVariants.filter(x => Object.keys(x.attributes).length > 0)) {
      for (const [k, val] of Object.entries(v.attributes)) {
        if (!optionMap.has(k)) optionMap.set(k, new Set())
        optionMap.get(k)!.add(String(val))
      }
    }
    const result: OptionDef[] = []
    for (const [name, values] of optionMap.entries()) {
      result.push({ name, values: [...values] })
    }
    return result.length > 0 ? result : [{ name: '', values: [] }]
  }

  function buildInitialRows(): VariantRowData[] {
    if (!hasRealVariants) return []
    return initialVariants
      .filter(v => Object.keys(v.attributes).length > 0)
      .map(v => ({
        id: v.id,
        sku: v.sku,
        attributes: v.attributes as Record<string, string>,
        priceRaw: v.price != null ? formatPrice(v.price) : '',
        stock: v.stock,
      }))
  }

  const [enabled, setEnabled] = useState(hasRealVariants)
  const [options, setOptions] = useState<OptionDef[]>(buildInitialOptions)
  const [variantRows, setVariantRows] = useState<VariantRowData[]>(buildInitialRows)
  const [newValueInputs, setNewValueInputs] = useState<string[]>(['', ''])
  const [removalPending, setRemovalPending] = useState<RemovalPending | null>(null)

  const prevOptionsRef = useRef<OptionDef[]>(options)

  function syncRows(newOptions: OptionDef[], currentRows: VariantRowData[]): VariantRowData[] {
    const combos = generateCombinations(newOptions)
    if (!combos.length) return []
    return mergeRows(combos, currentRows)
  }

  // ── Acciones directas (sin guard) ───────────────────────────────────────────

  function doToggleOff() {
    setEnabled(false)
    onEnabledChange(false)
    setVariantRows([])
    onVariantsChange([])
  }

  function doToggleOn() {
    setEnabled(true)
    onEnabledChange(true)
    const rows = syncRows(options, variantRows)
    setVariantRows(rows)
    onVariantsChange(rows)
  }

  function applyOptionsChange(newOptions: OptionDef[]) {
    prevOptionsRef.current = newOptions
    setOptions(newOptions)
    if (enabled) {
      const rows = syncRows(newOptions, variantRows)
      setVariantRows(rows)
      onVariantsChange(rows)
    }
  }

  function doRemoveOptionValue(optIdx: number, valIdx: number) {
    applyOptionsChange(
      options.map((o, i) =>
        i === optIdx ? { ...o, values: o.values.filter((_, vi) => vi !== valIdx) } : o
      )
    )
  }

  function doRemoveOption(optIdx: number) {
    applyOptionsChange(options.filter((_, i) => i !== optIdx))
    setNewValueInputs(prev => prev.filter((_, i) => i !== optIdx))
  }

  // ── Handlers con guard de stock ─────────────────────────────────────────────

  function handleToggle() {
    if (enabled) {
      const { count, totalStock } = rowsWithStock(variantRows)
      if (count > 0) {
        setRemovalPending({ kind: 'toggle', count, totalStock })
      } else {
        doToggleOff()
      }
    } else {
      doToggleOn()
    }
  }

  function handleRemoveChip(optIdx: number, valIdx: number) {
    const optName = options[optIdx].name
    const val = options[optIdx].values[valIdx]
    const affected = variantRows.filter(r => r.attributes[optName] === val && r.stock > 0)
    if (affected.length > 0) {
      const totalStock = affected.reduce((s, r) => s + r.stock, 0)
      setRemovalPending({ kind: 'chip', optIdx, valIdx, count: affected.length, totalStock })
    } else {
      doRemoveOptionValue(optIdx, valIdx)
    }
  }

  function handleRemoveOption(optIdx: number) {
    const optName = options[optIdx].name
    const affected = variantRows.filter(r => optName in r.attributes && r.stock > 0)
    if (affected.length > 0) {
      const totalStock = affected.reduce((s, r) => s + r.stock, 0)
      setRemovalPending({ kind: 'option', optIdx, count: affected.length, totalStock })
    } else {
      doRemoveOption(optIdx)
    }
  }

  function confirmRemoval() {
    if (!removalPending) return
    if (removalPending.kind === 'chip') {
      doRemoveOptionValue(removalPending.optIdx, removalPending.valIdx)
    } else if (removalPending.kind === 'option') {
      doRemoveOption(removalPending.optIdx)
    } else {
      doToggleOff()
    }
    setRemovalPending(null)
  }

  // ── Resto de handlers ───────────────────────────────────────────────────────

  function handleOptionNameChange(idx: number, name: string) {
    applyOptionsChange(options.map((o, i) => i === idx ? { ...o, name } : o))
  }

  function addOptionValue(optIdx: number) {
    const raw = newValueInputs[optIdx]?.trim()
    if (!raw) return
    const newOptions = options.map((o, i) =>
      i === optIdx && !o.values.includes(raw)
        ? { ...o, values: [...o.values, raw] }
        : o
    )
    setNewValueInputs(prev => prev.map((v, i) => i === optIdx ? '' : v))
    applyOptionsChange(newOptions)
  }

  function addOption() {
    if (options.length >= 2) return
    applyOptionsChange([...options, { name: '', values: [] }])
    setNewValueInputs(prev => [...prev, ''])
  }

  function updateRow(idx: number, field: keyof VariantRowData, value: string | number) {
    const next = variantRows.map((r, i) =>
      i === idx ? { ...r, [field]: value } : r
    )
    setVariantRows(next)
    onVariantsChange(next)
  }

  const showConversionWarning = enabled && !hasRealVariants && (defaultVariant?.stock ?? 0) > 0

  return (
    <section className="bg-card rounded-card border border-border p-5 space-y-4">
      <h2 className="text-sm font-semibold text-foreground">Variantes</h2>

      {/* Toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative flex-shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            onChange={handleToggle}
            className="sr-only"
          />
          <div className={`w-10 h-6 rounded-full transition-colors ${enabled ? 'bg-foreground' : 'bg-border'}`} />
          <div
            className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </div>
        <span className="text-sm text-foreground">
          Este producto tiene talles, colores u otras opciones
        </span>
      </label>

      {/* Advertencia de conversión */}
      {showConversionWarning && (
        <div className="bg-stock-low-bg border border-stock-low/30 text-stock-low rounded-input px-3 py-2.5 text-sm">
          El stock actual ({defaultVariant!.stock} unidades) de la variante por defecto pasará a 0 al guardar.
          Repartí ese stock entre las nuevas variantes.
        </div>
      )}

      {enabled && (
        <div className="space-y-5">
          <p className="text-xs text-muted">Agregá hasta 2 opciones (por ejemplo: Talle, Color)</p>

          {options.map((opt, optIdx) => (
            <div key={optIdx} className="space-y-3 p-4 bg-surface rounded-card border border-border">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    id={`opt-name-${optIdx}`}
                    label={`Opción ${optIdx + 1}`}
                    value={opt.name}
                    onChange={e => handleOptionNameChange(optIdx, e.target.value)}
                    placeholder="Ej: Talle"
                    maxLength={50}
                  />
                </div>
                {options.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveOption(optIdx)}
                    aria-label={`Eliminar opción ${optIdx + 1}`}
                    className="w-11 h-11 flex items-center justify-center text-muted hover:text-stock-none hover:bg-stock-none-bg rounded-input transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-stock-none/40 flex-shrink-0"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              {/* Chips de valores */}
              {opt.values.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {opt.values.map((val, valIdx) => (
                    <button
                      key={valIdx}
                      type="button"
                      onClick={() => handleRemoveChip(optIdx, valIdx)}
                      aria-label={`Eliminar ${val}`}
                      className="inline-flex items-center gap-1.5 px-3 h-11 bg-card border border-border rounded-full text-sm text-foreground hover:bg-stock-none-bg hover:text-stock-none hover:border-stock-none/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
                    >
                      {val}
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}

              {/* Input para agregar valor */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newValueInputs[optIdx] ?? ''}
                  onChange={e => setNewValueInputs(prev => prev.map((v, i) => i === optIdx ? e.target.value : v))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOptionValue(optIdx) } }}
                  placeholder={`Agregar valor (Ej: ${optIdx === 0 ? 'M' : 'Rojo'})`}
                  maxLength={50}
                  className="flex-1 h-11 px-3 rounded-input border border-border bg-white text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors text-sm"
                />
                <button
                  type="button"
                  onClick={() => addOptionValue(optIdx)}
                  className="h-11 px-3 rounded-input border border-border bg-white text-sm text-foreground hover:bg-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 flex-shrink-0"
                >
                  Agregar
                </button>
              </div>
            </div>
          ))}

          {options.length < 2 && (
            <button
              type="button"
              onClick={addOption}
              className="flex items-center gap-2 text-sm text-foreground hover:text-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 rounded"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Agregar otra opción
            </button>
          )}

          {/* Tabla de combinaciones */}
          {variantRows.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">
                Combinaciones
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-border rounded-card overflow-hidden">
                  <thead>
                    <tr className="bg-surface border-b border-border">
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted">Variante</th>
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted">SKU</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted">Stock</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted">
                        Precio (si difiere del producto)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {variantRows.map((row, rowIdx) => {
                      const variantLabel = Object.values(row.attributes).join(' / ')
                      return (
                        <tr
                          key={rowIdx}
                          className={`${rowIdx < variantRows.length - 1 ? 'border-b border-border' : ''}`}
                        >
                          <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">
                            {variantLabel}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={row.sku}
                              onChange={e => updateRow(rowIdx, 'sku', e.target.value)}
                              maxLength={100}
                              aria-label={`SKU para ${variantLabel}`}
                              className="w-28 h-9 px-2 rounded-input border border-border bg-white text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors font-mono"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end">
                              <input
                                type="number"
                                value={row.stock}
                                min={0}
                                onChange={e => updateRow(rowIdx, 'stock', Math.max(0, parseInt(e.target.value, 10) || 0))}
                                aria-label={`Stock para ${variantLabel}`}
                                className="w-20 h-9 px-2 rounded-input border border-border bg-white text-foreground text-sm text-right focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-muted text-xs">$</span>
                              <input
                                type="text"
                                value={row.priceRaw}
                                onChange={e => updateRow(rowIdx, 'priceRaw', e.target.value)}
                                placeholder={formatPrice(productPrice)}
                                aria-label={`Precio para ${variantLabel}`}
                                className="w-28 h-9 px-2 rounded-input border border-border bg-white text-foreground text-sm text-right focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/40 transition-colors"
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: confirmación al desactivar variantes con stock */}
      <Modal
        open={!!removalPending}
        onClose={() => setRemovalPending(null)}
        title="Desactivar variantes"
        size="sm"
      >
        {removalPending && (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Se van a desactivar{' '}
              <strong>{removalPending.count} variante{removalPending.count !== 1 ? 's' : ''}</strong>
              {' '}con{' '}
              <strong>{removalPending.totalStock} unidad{removalPending.totalStock !== 1 ? 'es' : ''}</strong>
              {' '}en total. ¿Querés continuar?
            </p>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRemovalPending(null)}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={confirmRemoval}
                className="flex-1"
              >
                Confirmar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}
