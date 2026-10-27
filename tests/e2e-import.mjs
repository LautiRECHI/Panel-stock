/**
 * Test de integración end-to-end del importador masivo.
 *
 * Corre contra el Supabase local (puerto 54321).
 * Crea una tienda de prueba, importa el archivo real, verifica los totales
 * y borra todo al final.
 *
 * Uso:
 *   node tests/e2e-import.mjs
 *
 * Requisito: `npx supabase start` y `npx supabase db reset` antes de correr.
 */

import ExcelJS from 'exceljs'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ─── Configuración local ───────────────────────────────────────────────────────
// Las claves pueden provenir de:
//   1. Variables de entorno SUPABASE_LOCAL_URL / SUPABASE_LOCAL_ANON_KEY /
//      SUPABASE_LOCAL_SERVICE_KEY
//   2. Un archivo tests/.env.test.local (ignorado por git) con esas mismas vars
//   3. Los defaults públicos del Supabase local (idénticos en toda instalación)

const __dir = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(__dir, '.env.test.local')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/)
    if (m) process.env[m[1]] = m[2].trim()
  }
}

// Defaults = claves demo públicas de Supabase local (iguales en toda instalación)
const SUPABASE_URL =
  process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EXCEL_PATH =
  process.env.IMPORT_EXCEL_PATH ??
  'C:/Users/Rechi/Desktop/Productos_Punto_de_Oro_para_importar.xlsx'

const BATCH_SIZE = 50

// ─── Totales esperados ─────────────────────────────────────────────────────────

const EXPECTED = {
  productos: 556,
  variantes: 1109,
  borradores: 111,
  // 5 categorías raíz + 43 subcategorías = 48 total en el archivo real
  // "16 nuevas" sería si la tienda ya tuviese 27; en tienda vacía son 43
  subcategorias: 43,
  stock: 636,
}

// ─── Funciones de parseo (réplica de import-actions.ts, sin dependencias Next) ──

function cellToString(v) {
  if (v == null) return ''
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '')
  return String(v).trim()
}

function parseExcelRows(worksheet) {
  const rows = []
  let headers = []
  let headerFound = false

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      headers = row.values
        ? row.values.slice(1).map(v => cellToString(v).toLowerCase().trim())
        : []
      headerFound = true
      return
    }
    if (!headerFound) return

    const cells = row.values ? row.values.slice(1) : []
    const obj = {}
    headers.forEach((h, i) => { obj[h] = cellToString(cells[i]) })

    rows.push({
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
    })
  })

  return rows
}

function isRowEmpty(row) {
  return !row.nombre && !row.categoria && !row.sku && !row.precio
}

function parsePrice(raw) {
  if (!raw || raw.trim() === '') return { value: 0, valid: true }
  const cleaned = raw.replace(/[$.]/g, '').replace(',', '.').trim()
  const n = parseFloat(cleaned)
  if (isNaN(n) || n < 0) return { value: 0, valid: false }
  return { value: Math.round(n * 100) / 100, valid: true }
}

function parseStock(raw) {
  if (!raw || raw.trim() === '') return { value: 0, valid: true }
  const n = parseInt(raw.trim(), 10)
  if (isNaN(n) || n < 0) return { value: 0, valid: false }
  return { value: n, valid: true }
}

function slugify(name, fallback = 'item') {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || fallback
  )
}

function generateSku(name) {
  const base = name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4)
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return base ? `${base}-${rand}` : rand
}

function parseProducts(rawRows) {
  const groups = new Map()

  rawRows.forEach((row, idx) => {
    const rowNum = idx + 2
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

  const products = []
  const seenSlugs = new Set()

  for (const [, group] of groups) {
    const firstRow = group.rows[0].row
    const nombre = (firstRow.nombre ?? '').trim()
    const categoriaName = (firstRow.categoria ?? '').trim()

    if (!nombre || !categoriaName) continue

    const slug = slugify(nombre, 'producto')
    if (seenSlugs.has(slug)) continue
    seenSlugs.add(slug)

    const priceResult = parsePrice(firstRow.precio ?? '')
    let precio = priceResult.valid ? priceResult.value : 0

    let estado = 'active'
    const rawEstado = (firstRow.estado ?? '').toLowerCase().trim()
    if (rawEstado === 'borrador') estado = 'draft'
    if (precio === 0 && estado === 'active') estado = 'draft'

    const variantes = group.rows.map(({ row }) => ({
      sku: (row.sku ?? '').trim() || generateSku(nombre),
      opcion: (row.opcion ?? '').trim(),
      valor: (row.valor ?? '').trim(),
      stock: parseStock(row.stock ?? '').value,
    }))

    products.push({
      nombre,
      slug,
      categoria_name: categoriaName,
      categoria_slug: slugify(categoriaName, 'categoria'),
      subcategoria_name: (firstRow.subcategoria ?? '').trim(),
      subcategoria_slug: slugify((firstRow.subcategoria ?? '').trim(), '') || '',
      marca: (firstRow.marca ?? '').trim(),
      descripcion: (firstRow.descripcion ?? '').trim(),
      precio,
      estado,
      variantes,
    })
  }

  return products
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FALLA: ${message}`)
  }
  console.log(`  ✓ ${message}`)
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const testStoreId = randomUUID()
  const testEmail = `e2e-import-${Date.now()}@test.local`
  const testPass = 'TestPassword123!'
  let userId = null

  try {
    // ── Setup ──────────────────────────────────────────────────────────────
    console.log('\n[Setup]')

    const { data: authData, error: authErr } =
      await adminClient.auth.admin.createUser({
        email: testEmail,
        password: testPass,
        email_confirm: true,
      })
    if (authErr) throw new Error(`createUser: ${authErr.message}`)
    userId = authData.user.id
    console.log(`  ✓ Usuario de prueba creado: ${testEmail}`)

    const { error: storeErr } = await adminClient
      .from('stores')
      .insert({ id: testStoreId, name: 'Tienda E2E Test', slug: `e2e-${Date.now()}` })
    if (storeErr) throw new Error(`crear tienda: ${storeErr.message}`)

    const { error: memberErr } = await adminClient
      .from('store_members')
      .insert({ user_id: userId, store_id: testStoreId, role: 'owner' })
    if (memberErr) throw new Error(`crear membresía: ${memberErr.message}`)
    console.log(`  ✓ Tienda de prueba creada (${testStoreId})`)

    // ── Parseo del Excel ───────────────────────────────────────────────────
    console.log('\n[Parseo]')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(EXCEL_PATH)
    const ws = workbook.getWorksheet('Productos') ?? workbook.worksheets[0]
    if (!ws) throw new Error('No se encontró hoja en el Excel')

    const rawRows = parseExcelRows(ws).filter(r => !isRowEmpty(r))
    console.log(`  Filas con datos: ${rawRows.length}`)

    const products = parseProducts(rawRows)
    console.log(`  Productos parseados: ${products.length}`)

    const totalVariantes = products.reduce((s, p) => s + p.variantes.length, 0)
    const borradores = products.filter(p => p.estado === 'draft').length
    console.log(`  Variantes: ${totalVariantes}  |  Borradores: ${borradores}`)

    // ── Autenticación ──────────────────────────────────────────────────────
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: testEmail,
      password: testPass,
    })
    if (signInErr) throw new Error(`signIn: ${signInErr.message}`)

    // ── Primera importación ────────────────────────────────────────────────
    console.log('\n[Primera importación]')
    let totalCreados = 0
    let totalSalteados = 0
    let totalErrRPC = 0

    const totalBatches = Math.ceil(products.length / BATCH_SIZE)
    for (let i = 0; i < totalBatches; i++) {
      const batch = products.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
      const { data, error } = await userClient.rpc('import_products', {
        p_products: batch,
      })
      if (error) throw new Error(`RPC lote ${i + 1}: ${error.message}`)
      totalCreados += data.creados.length
      totalSalteados += data.salteados.length
      totalErrRPC += data.errores.length
      if (data.errores.length > 0) {
        console.log(`    Lote ${i + 1} errores:`, JSON.stringify(data.errores))
      }
    }
    console.log(
      `  Creados: ${totalCreados}  Salteados: ${totalSalteados}  Errores RPC: ${totalErrRPC}`
    )

    // ── Verificaciones en DB ───────────────────────────────────────────────
    console.log('\n[Verificaciones]')

    const { data: dbProds, error: prodErr } = await adminClient
      .from('products')
      .select('id, status')
      .eq('store_id', testStoreId)
    if (prodErr) throw new Error(prodErr.message)

    assert(
      dbProds.length === EXPECTED.productos,
      `Productos en DB: ${dbProds.length} === ${EXPECTED.productos}`
    )

    const dbDrafts = dbProds.filter(p => p.status === 'draft').length
    assert(
      dbDrafts === EXPECTED.borradores,
      `Borradores: ${dbDrafts} === ${EXPECTED.borradores}`
    )

    const { count: varCount, error: varCountErr } = await adminClient
      .from('product_variants')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', testStoreId)
      .eq('is_active', true)
    if (varCountErr) throw new Error(varCountErr.message)

    assert(
      varCount === EXPECTED.variantes,
      `Variantes activas: ${varCount} === ${EXPECTED.variantes}`
    )

    // Sumar stock paginando (la API REST limita a 1000 filas por defecto)
    let totalStock = 0
    let page = 0
    const PAGE = 1000
    while (true) {
      const { data: chunk, error: chunkErr } = await adminClient
        .from('product_variants')
        .select('stock')
        .eq('store_id', testStoreId)
        .eq('is_active', true)
        .range(page * PAGE, (page + 1) * PAGE - 1)
      if (chunkErr) throw new Error(chunkErr.message)
      totalStock += chunk.reduce((s, v) => s + (v.stock ?? 0), 0)
      if (chunk.length < PAGE) break
      page++
    }
    assert(
      totalStock === EXPECTED.stock,
      `Stock total: ${totalStock} === ${EXPECTED.stock}`
    )

    const { data: dbCats, error: catErr } = await adminClient
      .from('categories')
      .select('id, parent_id')
      .eq('store_id', testStoreId)
    if (catErr) throw new Error(catErr.message)

    const subcats = dbCats.filter(c => c.parent_id !== null).length
    assert(
      subcats === EXPECTED.subcategorias,
      `Subcategorías: ${subcats} === ${EXPECTED.subcategorias}`
    )

    // ── Segunda importación ────────────────────────────────────────────────
    console.log('\n[Segunda importación]')
    let totalCreados2 = 0
    let totalSalteados2 = 0

    for (let i = 0; i < totalBatches; i++) {
      const batch = products.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
      const { data, error } = await userClient.rpc('import_products', {
        p_products: batch,
      })
      if (error) throw new Error(`RPC lote ${i + 1} (2da vez): ${error.message}`)
      totalCreados2 += data.creados.length
      totalSalteados2 += data.salteados.length
    }
    console.log(
      `  Creados: ${totalCreados2}  Salteados: ${totalSalteados2}`
    )

    assert(totalCreados2 === 0, `Segunda importación: 0 creados (got ${totalCreados2})`)
    assert(
      totalSalteados2 === EXPECTED.productos,
      `Segunda importación: ${EXPECTED.productos} salteados (got ${totalSalteados2})`
    )

    console.log('\n✓ Todos los assertions pasaron.\n')
  } finally {
    // ── Limpieza ───────────────────────────────────────────────────────────
    console.log('[Limpieza]')
    if (testStoreId) {
      await adminClient.from('stores').delete().eq('id', testStoreId)
      console.log('  ✓ Tienda de prueba borrada (cascade)')
    }
    if (userId) {
      await adminClient.auth.admin.deleteUser(userId)
      console.log('  ✓ Usuario de prueba borrado')
    }
  }
}

main().catch(err => {
  console.error('\n✗ TEST FALLÓ:', err.message)
  process.exit(1)
})
