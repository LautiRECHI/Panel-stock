'use client'

import { useRef, useState, useTransition } from 'react'
import {
  Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle,
  AlertTriangle, X, ChevronDown, ChevronUp
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { parseImportFile, importBatch } from './import-actions'
import type { ParseResult, ImportError } from './import-actions'

// ─── Tipos de estado interno ───────────────────────────────────────────────────

type Step = 'upload' | 'preview' | 'importing' | 'done'

interface FinalReport {
  creados: number
  salteados: number
  errores: number
  errorDetails: { nombre: string; slug: string; error: string }[]
  systemError?: string
}

interface Props {
  open: boolean
  onClose: () => void
}

const BATCH_SIZE = 50

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeForCsv(value: string): string {
  // Sanitizar fórmulas que empiezan con =, +, -, @
  let v = value
  if (/^[=+\-@]/.test(v)) v = `'${v}`
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    v = `"${v.replace(/"/g, '""')}"`
  }
  return v
}

function downloadErrorsCsv(
  errors: { nombre: string; slug: string; error: string }[]
): void {
  const header = ['Producto', 'Slug', 'Error']
  const rows = errors.map(e => [
    escapeForCsv(e.nombre),
    escapeForCsv(e.slug),
    escapeForCsv(e.error),
  ])
  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'errores-importacion.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Componentes internos ─────────────────────────────────────────────────────

function ErrorRow({ err }: { err: ImportError }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-3 text-xs text-muted tabular-nums">{err.fila}</td>
      <td className="py-2 pr-3 text-xs text-foreground max-w-[140px] truncate">{err.producto}</td>
      <td className="py-2 text-xs">
        <span className={err.tipo === 'error'
          ? 'text-stock-none'
          : 'text-stock-low'
        }>
          {err.tipo === 'aviso' ? '⚠ ' : '✗ '}{err.motivo}
        </span>
      </td>
    </tr>
  )
}

function CollapsibleSection({
  title,
  count,
  variant,
  children,
}: {
  title: string
  count: number
  variant: 'error' | 'warning' | 'info'
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const colorMap = {
    error: 'text-stock-none bg-stock-none-bg border-stock-none/20',
    warning: 'text-stock-low bg-stock-low-bg border-stock-low/20',
    info: 'text-foreground bg-surface border-border',
  }
  return (
    <div className={`rounded-input border text-sm ${colorMap[variant]}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 rounded-input"
      >
        <span>{title} ({count})</span>
        {open ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-current/10">
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export default function ImportarModal({ open, onClose }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [parseError, setParseError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ParseResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [report, setReport] = useState<FinalReport | null>(null)
  const [isParsing, startParsing] = useTransition()
  const [isDragging, setIsDragging] = useState(false)

  function resetState() {
    setStep('upload')
    setParseError(null)
    setPreview(null)
    setProgress(0)
    setReport(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleClose() {
    resetState()
    onClose()
  }

  async function handleFile(file: File) {
    setParseError(null)
    const fd = new FormData()
    fd.append('file', file)

    startParsing(async () => {
      const result = await parseImportFile(fd)
      if ('error' in result) {
        setParseError(result.error)
        return
      }
      setPreview(result)
      setStep('preview')
    })
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  async function handleImport() {
    if (!preview) return
    const { products } = preview
    if (products.length === 0) return

    setStep('importing')
    setProgress(0)

    const totalBatches = Math.ceil(products.length / BATCH_SIZE)
    let totalCreados = 0
    let totalSalteados = 0
    const allErrorDetails: { nombre: string; slug: string; error: string }[] = []

    for (let i = 0; i < totalBatches; i++) {
      const batch = products.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
      const result = await importBatch(batch)

      if ('error' in result) {
        // Error de sistema (p.ej. RPC caído): abortar y mostrar el mensaje una sola vez
        setReport({
          creados: totalCreados,
          salteados: totalSalteados,
          errores: allErrorDetails.length,
          errorDetails: allErrorDetails,
          systemError: result.error,
        })
        setStep('done')
        return
      }

      totalCreados += result.creados.length
      totalSalteados += result.salteados.length
      allErrorDetails.push(...result.errores)

      setProgress(Math.round(((i + 1) / totalBatches) * 100))
    }

    setReport({
      creados: totalCreados,
      salteados: totalSalteados,
      errores: allErrorDetails.length,
      errorDetails: allErrorDetails,
    })
    setStep('done')
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Importar productos"
      description="Cargá un archivo Excel (.xlsx) o CSV con tu catálogo"
      size="md"
    >
      {/* ── Paso 1: Subir archivo ─────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Zona de drop */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-card p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-foreground bg-surface'
                : 'border-border hover:border-foreground/40 hover:bg-surface/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              onChange={handleFileInput}
              className="sr-only"
              aria-label="Seleccionar archivo"
            />
            {isParsing ? (
              <div className="flex flex-col items-center gap-3">
                <span className="w-8 h-8 border-2 border-foreground border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                <p className="text-sm text-muted">Analizando archivo…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center">
                  <Upload className="w-5 h-5 text-muted" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Arrastrá tu archivo acá o hacé clic para seleccionarlo
                  </p>
                  <p className="text-xs text-muted mt-1">Excel (.xlsx) o CSV · Máx. 5 MB · Máx. 2.000 filas</p>
                </div>
              </div>
            )}
          </div>

          {/* Error de parseo */}
          {parseError && (
            <div className="flex items-start gap-2 text-sm text-stock-none bg-stock-none-bg border border-stock-none/20 rounded-input px-3 py-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Descargar plantilla */}
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <p className="text-xs text-muted">¿Necesitás la plantilla?</p>
            <a
              href="/plantillas/plantilla-importacion-productos.xlsx"
              download
              className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-foreground/70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Descargar plantilla
            </a>
          </div>
        </div>
      )}

      {/* ── Paso 2: Vista previa ───────────────────────────────────────────── */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* Resumen de conteos */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface rounded-input border border-border p-3">
              <p className="text-2xl font-semibold text-foreground">{preview.products.length}</p>
              <p className="text-xs text-muted mt-0.5">
                producto{preview.products.length !== 1 ? 's' : ''} a importar
              </p>
            </div>
            <div className="bg-surface rounded-input border border-border p-3">
              <p className="text-2xl font-semibold text-foreground">{preview.totalVariants}</p>
              <p className="text-xs text-muted mt-0.5">
                variante{preview.totalVariants !== 1 ? 's' : ''} en total
              </p>
            </div>
          </div>

          {/* Categorías nuevas */}
          {preview.newCategories.length > 0 && (
            <CollapsibleSection
              title="Categorías nuevas que se crearán"
              count={preview.newCategories.length}
              variant="info"
            >
              <ul className="mt-2 space-y-1">
                {preview.newCategories.map((c, i) => (
                  <li key={i} className="text-xs text-muted flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                    {c.tipo === 'subcategoria' ? (
                      <span><span className="text-muted/60">{c.bajo} › </span>{c.nombre}</span>
                    ) : (
                      <span className="font-medium">{c.nombre}</span>
                    )}
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          )}

          {/* Productos que se saltean */}
          {preview.skipped.length > 0 && (
            <CollapsibleSection
              title="Productos que se saltearán (ya existen)"
              count={preview.skipped.length}
              variant="warning"
            >
              <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                {preview.skipped.map((s, i) => (
                  <li key={i} className="text-xs text-muted truncate">{s.nombre}</li>
                ))}
              </ul>
            </CollapsibleSection>
          )}

          {/* Errores y avisos */}
          {preview.errors.length > 0 && (
            <CollapsibleSection
              title={`Errores y avisos de filas`}
              count={preview.errors.length}
              variant="error"
            >
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[340px]">
                  <thead>
                    <tr>
                      <th className="text-left text-xs text-muted pb-1 pr-3 w-10">Fila</th>
                      <th className="text-left text-xs text-muted pb-1 pr-3">Producto</th>
                      <th className="text-left text-xs text-muted pb-1">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.map((err, i) => (
                      <ErrorRow key={i} err={err} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          )}

          {/* Sin productos válidos */}
          {preview.products.length === 0 && (
            <div className="flex items-start gap-2 text-sm text-stock-none bg-stock-none-bg border border-stock-none/20 rounded-input px-3 py-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>No hay productos válidos para importar. Corregí los errores y volvé a subir el archivo.</span>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={resetState}
              className="flex-shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
              Cambiar archivo
            </Button>
            {preview.products.length > 0 && (
              <Button
                type="button"
                onClick={handleImport}
                className="flex-1"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                Importar {preview.products.length} producto{preview.products.length !== 1 ? 's' : ''}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Paso 3: Importando ─────────────────────────────────────────────── */}
      {step === 'importing' && (
        <div className="space-y-5 py-2">
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 border-2 border-foreground border-t-transparent rounded-full animate-spin flex-shrink-0" aria-hidden="true" />
            <p className="text-sm text-foreground font-medium">Importando productos…</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted">Progreso</span>
              <span className="text-xs font-medium text-foreground tabular-nums">{progress}%</span>
            </div>
            <div className="h-2 bg-surface rounded-full border border-border overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="h-full bg-foreground rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <p className="text-xs text-muted">No cerrés esta ventana hasta que termine.</p>
        </div>
      )}

      {/* ── Paso 4: Reporte final ──────────────────────────────────────────── */}
      {step === 'done' && report && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-stock-ok-bg rounded-input border border-stock-ok/20 p-3 text-center">
              <p className="text-xl font-semibold text-stock-ok">{report.creados}</p>
              <p className="text-xs text-stock-ok/80 mt-0.5">creado{report.creados !== 1 ? 's' : ''}</p>
            </div>
            <div className="bg-stock-low-bg rounded-input border border-stock-low/20 p-3 text-center">
              <p className="text-xl font-semibold text-stock-low">{report.salteados}</p>
              <p className="text-xs text-stock-low/80 mt-0.5">salteado{report.salteados !== 1 ? 's' : ''}</p>
            </div>
            <div className={`rounded-input border p-3 text-center ${report.errores > 0 ? 'bg-stock-none-bg border-stock-none/20' : 'bg-surface border-border'}`}>
              <p className={`text-xl font-semibold ${report.errores > 0 ? 'text-stock-none' : 'text-muted'}`}>{report.errores}</p>
              <p className={`text-xs mt-0.5 ${report.errores > 0 ? 'text-stock-none/80' : 'text-muted'}`}>error{report.errores !== 1 ? 'es' : ''}</p>
            </div>
          </div>

          {report.systemError && (
            <div className="flex items-start gap-2 text-sm text-stock-none bg-stock-none-bg border border-stock-none/20 rounded-input px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>La importación se interrumpió: {report.systemError}</span>
            </div>
          )}

          {report.creados > 0 && (
            <div className="flex items-center gap-2 text-sm text-stock-ok bg-stock-ok-bg border border-stock-ok/20 rounded-input px-3 py-2.5">
              <CheckCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              <span>{report.creados} producto{report.creados !== 1 ? 's' : ''} importado{report.creados !== 1 ? 's' : ''} correctamente.</span>
            </div>
          )}

          {report.errores > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-stock-none bg-stock-none-bg border border-stock-none/20 rounded-input px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>{report.errores} producto{report.errores !== 1 ? 's' : ''} fallaron durante la importación.</span>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => downloadErrorsCsv(report.errorDetails)}
                className="w-full text-sm"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                Descargar errores como CSV
              </Button>
            </div>
          )}

          <Button
            type="button"
            onClick={handleClose}
            className="w-full"
          >
            Cerrar
          </Button>
        </div>
      )}
    </Modal>
  )
}
