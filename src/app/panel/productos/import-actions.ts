'use server'

import { connection } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/server'
import { generateProductSlug, generateSku } from '@/lib/products-utils'

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export type ImportVariant = {
  sku: string
  opcion: string
  valor: string
  stock: number
}

export type ImportProduct = {
  nombre: string
  slug: string
  categoria_name: string
  categoria_slug: string
  subcategoria_name: string
  subcategoria_slug: string
  marca: string
  descripcion: string
  precio: number
  estado: 'active' | 'draft'
  variantes: ImportVariant[]
}

export type ImportError = {
  fila: number
  producto: string
  motivo: string
  tipo: 'error' | 'aviso'
}

export type ImportSkipped = {
  nombre: string
  slug: string
  motivo: string
}

export type ImportNewCategory = {
  nombre: string
  tipo: 'categoria' | 'subcategoria'
  bajo?: string
}

export type ParseResult = {
  products: ImportProduct[]
  skipped: ImportSkipped[]
  errors: ImportError[]
  newCategories: ImportNewCategory[]
  totalVariants: number
}

export type ImportBatchResult = {
  creados: { nombre: string; producto_id: string; slug: string }[]
  salteados: { nombre: string; slug: string; motivo: string }[]
  errores: { nombre: string; slug: string; error: string }[]
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 5 * 1024 * 1024  // 5 MB
const MAX_ROWS = 2000

// Slugify para categorías (igual que generateSlug en categories.ts)
function slugifyCategory(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50) || 'categoria'
  )
}

// ─── Parseo de fila raw ────────────────────────────────────────────────────────

type RawRow = {
  sku?: string
  nombre?: string
  categoria?: string
  subcategoria?: string
  marca?: string
  descripcion?: string
  opcion?: string
  valor?: string
  precio?: string
  stock?: string
  estado?: string
}

function cellToString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object' && 'result' in (v as Record<string, unknown>)) {
    // ExcelJS formula cell: read result, not formula
    return String((v as Record<string, unknown>).result ?? '')
  }
  return String(v).trim()
}

function parseExcelRows(worksheet: ExcelJS.Worksheet): RawRow[] {
  const rows: RawRow[] = []
  let headers: string[] = []
  let headerFound = false

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      headers = row.values
        ? (row.values as unknown[]).slice(1).map(v => cellToString(v).toLowerCase().trim())
        : []
      headerFound = true
      return
    }
    if (!headerFound) return

    const cells = row.values ? (row.values as unknown[]).slice(1) : []
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = cellToString(cells[i])
    })

    const rawRow: RawRow = {
      sku: obj['sku'] ?? '',
      nombre: obj['nombre'] ?? '',
      categoria: obj['categoria'] ?? '',
      subcategoria: obj['subcategoria'] ?? '',
      marca: obj['marca'] ?? '',
      descripcion: obj['descripcion'] ?? '',
      opcion: obj['opcion'] ?? '',
      valor: obj['valor'] ?? '',
      precio: obj['precio'] ?? '',
      stock: obj['stock'] ?? '',
      estado: obj['estado'] ?? '',
    }
    rows.push(rawRow)
  })

  return rows
}

function parseCsvRows(text: string): RawRow[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.toLowerCase().trim(),
  })
  return result.data.map(r => ({
    sku: (r['sku'] ?? '').trim(),
    nombre: (r['nombre'] ?? '').trim(),
    categoria: (r['categoria'] ?? '').trim(),
    subcategoria: (r['subcategoria'] ?? '').trim(),
    marca: (r['marca'] ?? '').trim(),
    descripcion: (r['descripcion'] ?? '').trim(),
    opcion: (r['opcion'] ?? '').trim(),
    valor: (r['valor'] ?? '').trim(),
    precio: (r['precio'] ?? '').trim(),
    stock: (r['stock'] ?? '').trim(),
    estado: (r['estado'] ?? '').trim(),
  }))
}

function isRowEmpty(row: RawRow): boolean {
  return !row.nombre && !row.categoria && !row.sku && !row.precio
}

// ─── Validación y agrupación ──────────────────────────────────────────────────

function parsePrice(raw: string): { value: number; valid: boolean } {
  if (!raw || raw.trim() === '') return { value: 0, valid: true }
  const cleaned = raw.replace(/[$.]/g, '').replace(',', '.').trim()
  const n = parseFloat(cleaned)
  if (isNaN(n) || n < 0) return { value: 0, valid: false }
  return { value: Math.round(n * 100) / 100, valid: true }
}

function parseStock(raw: string): { value: number; valid: boolean } {
  if (!raw || raw.trim() === '') return { value: 0, valid: true }
  const n = parseInt(raw.trim(), 10)
  if (isNaN(n) || n < 0) return { value: 0, valid: false }
  return { value: n, valid: true }
}

function groupRows(rows: RawRow[]): {
  groups: Map<string, { firstRow: number; rows: { row: RawRow; rowNum: number }[] }>
} {
  const groups = new Map<string, { firstRow: number; rows: { row: RawRow; rowNum: number }[] }>()

  rows.forEach((row, idx) => {
    const rowNum = idx + 2  // 1 for header, 1-based
    const key = [
      (row.nombre ?? '').toLowerCase().trim(),
      (row.categoria ?? '').toLowerCase().trim(),
      (row.subcategoria ?? '').toLowerCase().trim(),
    ].join('||')

    const existing = groups.get(key)
    if (existing) {
      existing.rows.push({ row, rowNum })
    } else {
      groups.set(key, { firstRow: rowNum, rows: [{ row, rowNum }] })
    }
  })

  return { groups }
}

// ─── Server Action: parseImportFile ──────────────────────────────────────────

export async function parseImportFile(
  formData: FormData
): Promise<ParseResult | { error: string }> {
  await connection()

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'No se recibió ningún archivo.' }
  if (file.size > MAX_FILE_SIZE) return { error: 'El archivo supera los 5 MB.' }

  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'xlsx' && ext !== 'csv') {
    return { error: 'Solo se admiten archivos .xlsx y .csv.' }
  }

  const supabase = await createClient()
  const { data: stores } = await supabase.from('stores').select('id').limit(1)
  const storeId = (stores as { id: string }[] | null)?.[0]?.id
  if (!storeId) return { error: 'No autenticado.' }

  // ── Parsear archivo ──────────────────────────────────────────────────────
  let rawRows: RawRow[]

  try {
    if (ext === 'xlsx') {
      const arrayBuf = await file.arrayBuffer()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(arrayBuf as Parameters<typeof workbook.xlsx.load>[0])

      // Buscar hoja "Productos" o usar la primera
      let ws = workbook.getWorksheet('Productos')
      if (!ws) ws = workbook.worksheets[0]
      if (!ws) return { error: 'El archivo no tiene hojas de cálculo.' }

      rawRows = parseExcelRows(ws)
    } else {
      const text = await file.text()
      rawRows = parseCsvRows(text)
    }
  } catch {
    return { error: 'No se pudo leer el archivo. Verificá que el formato sea correcto.' }
  }

  // Filtrar filas vacías
  rawRows = rawRows.filter(r => !isRowEmpty(r))

  if (rawRows.length === 0) return { error: 'El archivo no contiene filas con datos.' }
  if (rawRows.length > MAX_ROWS) {
    return { error: `El archivo tiene más de ${MAX_ROWS} filas. Dividí la importación en partes.` }
  }

  // ── Consultar slugs y SKUs existentes en la tienda ───────────────────────
  const { data: existingProductsData } = await supabase
    .from('products')
    .select('slug')
    .eq('store_id', storeId)

  const existingSlugs = new Set(
    (existingProductsData as { slug: string }[] | null ?? []).map(p => p.slug)
  )

  const { data: existingVariantsData } = await supabase
    .from('product_variants')
    .select('sku')
    .eq('store_id', storeId)
    .eq('is_active', true)

  const existingSkus = new Set(
    (existingVariantsData as { sku: string }[] | null ?? []).map(v => v.sku.trim())
  )

  // ── Agrupar filas por producto ───────────────────────────────────────────
  const { groups } = groupRows(rawRows)

  const products: ImportProduct[] = []
  const skipped: ImportSkipped[] = []
  const errors: ImportError[] = []
  const newCategorySlugs = new Set<string>()  // para no duplicar en la lista
  const newCategories: ImportNewCategory[] = []
  const skusInFile = new Set<string>()

  for (const [, group] of groups) {
    const firstRow = group.rows[0].row
    const nombre = (firstRow.nombre ?? '').trim()
    const categoriaName = (firstRow.categoria ?? '').trim()

    // ── Validaciones del producto ────────────────────────────────────────
    const productErrors: ImportError[] = []
    const productWarnings: ImportError[] = []

    if (!nombre) {
      productErrors.push({
        fila: group.firstRow,
        producto: nombre || '(sin nombre)',
        motivo: 'El campo "nombre" es obligatorio.',
        tipo: 'error',
      })
    }
    if (nombre.length > 200) {
      productErrors.push({
        fila: group.firstRow,
        producto: nombre,
        motivo: 'El nombre supera los 200 caracteres.',
        tipo: 'error',
      })
    }
    if (!categoriaName) {
      productErrors.push({
        fila: group.firstRow,
        producto: nombre,
        motivo: 'El campo "categoria" es obligatorio.',
        tipo: 'error',
      })
    }

    // ── Validar variantes ───────────────────────────────────────────────
    const hasVariantRows = group.rows.some(
      ({ row }) => (row.opcion ?? '').trim() !== '' || (row.valor ?? '').trim() !== ''
    )

    const variantErrors: ImportError[] = []
    const variantSkus: string[] = []

    for (const { row, rowNum } of group.rows) {
      const opcion = (row.opcion ?? '').trim()
      const valor = (row.valor ?? '').trim()

      // Con variantes: opcion y valor obligatorios
      if (hasVariantRows) {
        if (!opcion) {
          variantErrors.push({ fila: rowNum, producto: nombre, motivo: 'El campo "opcion" es obligatorio cuando el producto tiene variantes.', tipo: 'error' })
        }
        if (!valor) {
          variantErrors.push({ fila: rowNum, producto: nombre, motivo: 'El campo "valor" es obligatorio cuando el producto tiene variantes.', tipo: 'error' })
        }
      }

      // Precio
      const priceResult = parsePrice(row.precio ?? '')
      if (!priceResult.valid) {
        variantErrors.push({ fila: rowNum, producto: nombre, motivo: `El precio "${row.precio}" no es válido. Debe ser un número >= 0.`, tipo: 'error' })
      }

      // Stock
      const stockResult = parseStock(row.stock ?? '')
      if (!stockResult.valid) {
        variantErrors.push({ fila: rowNum, producto: nombre, motivo: `El stock "${row.stock}" no es válido. Debe ser un entero >= 0.`, tipo: 'error' })
      }

      // SKU por variante
      const sku = (row.sku ?? '').trim()
      if (sku) {
        if (skusInFile.has(sku)) {
          variantErrors.push({ fila: rowNum, producto: nombre, motivo: `El SKU "${sku}" aparece más de una vez en el archivo.`, tipo: 'error' })
        } else if (existingSkus.has(sku)) {
          variantErrors.push({ fila: rowNum, producto: nombre, motivo: `El SKU "${sku}" ya existe en la tienda.`, tipo: 'error' })
        } else {
          skusInFile.add(sku)
          variantSkus.push(sku)
        }
      }
    }

    productErrors.push(...variantErrors)

    // Precio del producto (primera fila)
    const priceResult = parsePrice(firstRow.precio ?? '')
    const price = priceResult.value

    // Estado y aviso de precio 0
    let estado: 'active' | 'draft' = 'active'
    const rawEstado = (firstRow.estado ?? '').toLowerCase().trim()
    if (rawEstado === 'borrador') estado = 'draft'

    if (price === 0 && estado === 'active') {
      productWarnings.push({
        fila: group.firstRow,
        producto: nombre,
        motivo: 'Precio 0 o vacío: el producto se importará como borrador.',
        tipo: 'aviso',
      })
      estado = 'draft'
    }

    // ── Si hay errores críticos, excluir este producto ───────────────────
    if (productErrors.length > 0) {
      errors.push(...productErrors)
      continue
    }
    errors.push(...productWarnings)

    // ── Generar slug y verificar duplicados ──────────────────────────────
    const slug = generateProductSlug(nombre)

    if (existingSlugs.has(slug)) {
      skipped.push({
        nombre,
        slug,
        motivo: 'Ya existe un producto con ese nombre en la tienda.',
      })
      continue
    }
    // Marcar slug como "ya usado" (dentro del mismo archivo)
    existingSlugs.add(slug)

    // ── Categorías nuevas ────────────────────────────────────────────────
    const categoriaSlug = slugifyCategory(categoriaName)
    const subcategoriaName = (firstRow.subcategoria ?? '').trim()
    const subcategoriaSlug = subcategoriaName ? slugifyCategory(subcategoriaName) : ''

    const catKey = categoriaSlug
    if (!newCategorySlugs.has(`root:${catKey}`)) {
      newCategorySlugs.add(`root:${catKey}`)
    }

    if (subcategoriaName) {
      const subKey = `${catKey}:${subcategoriaSlug}`
      if (!newCategorySlugs.has(subKey)) {
        newCategorySlugs.add(subKey)
      }
    }

    // ── Construir variantes ──────────────────────────────────────────────
    const variantes: ImportVariant[] = group.rows.map(({ row }) => ({
      sku: (row.sku ?? '').trim() || generateSku(nombre),
      opcion: (row.opcion ?? '').trim(),
      valor: (row.valor ?? '').trim(),
      stock: parseStock(row.stock ?? '').value,
    }))

    products.push({
      nombre,
      slug,
      categoria_name: categoriaName,
      categoria_slug: categoriaSlug,
      subcategoria_name: subcategoriaName,
      subcategoria_slug: subcategoriaSlug,
      marca: (firstRow.marca ?? '').trim(),
      descripcion: (firstRow.descripcion ?? '').trim(),
      precio: price,
      estado,
      variantes,
    })
  }

  // ── Determinar categorías nuevas (contra la BD) ──────────────────────────
  const { data: existingCats } = await supabase
    .from('categories')
    .select('name, parent_id')
    .eq('store_id', storeId)

  type CatRecord = { name: string; parent_id: string | null }
  const existingCatNames = new Set(
    (existingCats as CatRecord[] | null ?? [])
      .map(c => `${c.parent_id ?? 'root'}:${c.name.toLowerCase().trim()}`)
  )

  const categoriesAdded = new Set<string>()

  for (const p of products) {
    const catKey = `root:${p.categoria_name.toLowerCase().trim()}`
    if (!existingCatNames.has(catKey) && !categoriesAdded.has(catKey)) {
      newCategories.push({ nombre: p.categoria_name, tipo: 'categoria' })
      categoriesAdded.add(catKey)
    }
    if (p.subcategoria_name) {
      const subKey = `${p.categoria_name.toLowerCase().trim()}:${p.subcategoria_name.toLowerCase().trim()}`
      if (!existingCatNames.has(`${p.categoria_name.toLowerCase().trim()}:${p.subcategoria_name.toLowerCase().trim()}`) && !categoriesAdded.has(subKey)) {
        newCategories.push({ nombre: p.subcategoria_name, tipo: 'subcategoria', bajo: p.categoria_name })
        categoriesAdded.add(subKey)
      }
    }
  }

  const totalVariants = products.reduce((sum, p) => sum + p.variantes.length, 0)

  return {
    products,
    skipped,
    errors,
    newCategories,
    totalVariants,
  }
}

// ─── Server Action: importBatch ───────────────────────────────────────────────

const importProductSchema = z.object({
  nombre: z.string().min(1).max(200),
  slug: z.string().min(1).max(80),
  categoria_name: z.string().max(100),
  categoria_slug: z.string().max(50),
  subcategoria_name: z.string().max(100),
  subcategoria_slug: z.string().max(50),
  marca: z.string().max(100),
  descripcion: z.string().max(2000),
  precio: z.number().min(0),
  estado: z.enum(['active', 'draft']),
  variantes: z.array(z.object({
    sku: z.string().min(1).max(100),
    opcion: z.string().max(100),
    valor: z.string().max(100),
    stock: z.number().int().min(0),
  })),
})

export async function importBatch(
  products: ImportProduct[]
): Promise<ImportBatchResult | { error: string }> {
  await connection()

  // Validar cada producto con Zod
  for (const p of products) {
    const parsed = importProductSchema.safeParse(p)
    if (!parsed.success) {
      return { error: `Producto inválido "${p.nombre}": ${parsed.error.issues[0].message}` }
    }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('import_products', {
    p_products: products,
  })

  if (error) {
    return { error: `Error en la importación: ${error.message}` }
  }

  const result = data as {
    creados: { nombre: string; producto_id: string; slug: string }[]
    salteados: { nombre: string; slug: string; motivo: string }[]
    errores: { nombre: string; slug: string; error: string }[]
  }

  revalidatePath('/panel/productos')

  return {
    creados: result.creados ?? [],
    salteados: result.salteados ?? [],
    errores: result.errores ?? [],
  }
}
