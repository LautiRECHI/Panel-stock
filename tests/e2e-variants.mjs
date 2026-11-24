/**
 * Test de integración para upsert_variants vía supabase-js → PostgREST → SQL.
 *
 * Este test verifica que pasar un array JS directamente a supabase.rpc() funciona
 * (el bug era JSON.stringify(array), que enviaba un escalar y causaba error 22023
 * "cannot extract elements from a scalar" en jsonb_array_elements).
 *
 * Cubre:
 *   1. Conversión simple→variantes: producto sin variantes + 3 colores
 *   2. Edición con IDs explícitos: actualizar stock de variantes existentes
 *   3. Flujo CREATE: producto nuevo + variantes de talle
 *
 * Uso:
 *   node tests/e2e-variants.mjs
 *
 * Requisitos previos:
 *   npx --yes supabase@2 db reset
 *   tests/.env.test.local con las claves de `npx --yes supabase@2 status`
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(__dir, '.env.test.local')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && m[2].trim()) process.env[m[1]] = m[2].trim()
  }
}

const SUPABASE_URL = process.env.SUPABASE_LOCAL_URL  ?? 'http://127.0.0.1:54321'
const ANON_KEY     = process.env.SUPABASE_LOCAL_ANON_KEY
const SERVICE_KEY  = process.env.SUPABASE_LOCAL_SERVICE_KEY

if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
  console.error(`ABORT: SUPABASE_LOCAL_URL (${SUPABASE_URL}) no es localhost.`)
  process.exit(1)
}

const MISSING = []
if (!ANON_KEY)   MISSING.push('SUPABASE_LOCAL_ANON_KEY')
if (!SERVICE_KEY) MISSING.push('SUPABASE_LOCAL_SERVICE_KEY')
if (MISSING.length > 0) {
  console.error(`Faltan variables: ${MISSING.join(', ')}`)
  console.error('Ejecutá: npx --yes supabase@2 status')
  process.exit(1)
}

// Seed store ID y credenciales (definidas en supabase/seed.sql)
const STORE_ID = 'e0eedc00-0000-4000-8000-000000000010'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── Helpers ──────────────────────────────────────────────────────────────────

let pass = 0, fail = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`)
    pass++
  } else {
    console.error(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
    fail++
  }
}

async function variantsOf(productId) {
  const { data } = await admin
    .from('product_variants')
    .select('id, sku, attributes, stock, is_active')
    .eq('product_id', productId)
    .eq('store_id', STORE_ID)
  return data ?? []
}

// Producto efímero con variante por defecto (attributes = {})
async function createSimpleProduct(name) {
  const productId = randomUUID()
  const variantId = randomUUID()
  const slug = name.toLowerCase().replace(/\s+/g, '-') + '-' + productId.slice(0, 8)

  const { error: pe } = await admin.from('products').insert({
    id: productId, store_id: STORE_ID,
    name, slug, price: 1000, status: 'active',
  })
  if (pe) throw new Error(`createSimpleProduct insert product: ${pe.message}`)

  const { error: ve } = await admin.from('product_variants').insert({
    id: variantId, store_id: STORE_ID, product_id: productId,
    sku: `TEST-DEFAULT-${productId.slice(0, 8)}`, attributes: {}, stock: 0,
  })
  if (ve) throw new Error(`createSimpleProduct insert variant: ${ve.message}`)

  return { productId, variantId }
}

async function deleteProduct(productId) {
  await admin.from('stock_movements').delete().eq('store_id', STORE_ID)
    .in('variant_id',
      (await admin.from('product_variants').select('id').eq('product_id', productId)).data?.map(v => v.id) ?? [])
  await admin.from('product_variants').delete().eq('product_id', productId)
  await admin.from('products').delete().eq('id', productId)
}

// ── Login como el usuario seed ───────────────────────────────────────────────
const { data: signIn, error: signInErr } = await admin.auth.signInWithPassword({
  email: 'test@local.test',
  password: 'Test1234!local',
})
if (signInErr || !signIn?.session) {
  console.error('No se pudo iniciar sesión:', signInErr?.message)
  process.exit(1)
}

// Cliente autenticado — mismo path que variants-actions.ts (JWT de usuario → PostgREST → RLS)
const user = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
})

// ── ESCENARIO 1: Conversión simple→variantes (3 colores) ─────────────────────
console.log('\n▸ 1. Conversión simple → 3 variantes de color\n')

const { productId: prod1, variantId: defaultVar1 } = await createSimpleProduct('Gorra Test Color')

const { error: e1 } = await user.rpc('upsert_variants', {
  p_store_id: STORE_ID,
  p_product_id: prod1,
  p_variants: [
    { sku: `COLOR-ROJO-${prod1.slice(0, 8)}`, attributes: { color: 'rojo' }, price: null, stock: 0 },
    { sku: `COLOR-AZUL-${prod1.slice(0, 8)}`, attributes: { color: 'azul' }, price: null, stock: 0 },
    { sku: `COLOR-VERDE-${prod1.slice(0, 8)}`, attributes: { color: 'verde' }, price: null, stock: 0 },
  ],
  p_reason: 'conversión a variantes',
})
check('1a. upsert_variants con array JS no lanza error', !e1, e1?.message ?? e1?.code)

const v1 = await variantsOf(prod1)
const activas1 = v1.filter(v => v.is_active && Object.keys(v.attributes).length > 0)
const inactivas1 = v1.filter(v => !v.is_active)
check('1b. 3 variantes de color activas creadas', activas1.length === 3, `got ${activas1.length}`)
check('1c. Variante por defecto inactivada', inactivas1.some(v => v.id === defaultVar1), `inactivas: ${inactivas1.map(v => v.id).join(',')}`)

// ── ESCENARIO 2: Edición con IDs explícitos ──────────────────────────────────
console.log('\n▸ 2. Edición con IDs explícitos (actualizar stock)\n')

const variantesConId = activas1.map(v => ({
  id: v.id,
  sku: v.sku,
  attributes: v.attributes,
  price: null,
  stock: 7,
}))

const { error: e2 } = await user.rpc('upsert_variants', {
  p_store_id: STORE_ID,
  p_product_id: prod1,
  p_variants: variantesConId,
  p_reason: 'edición de variantes',
})
check('2a. upsert_variants con IDs explícitos no lanza error', !e2, e2?.message ?? e2?.code)

const v2 = await variantsOf(prod1)
const activas2 = v2.filter(v => v.is_active && Object.keys(v.attributes).length > 0)
check('2b. 3 variantes siguen activas', activas2.length === 3, `got ${activas2.length}`)
check('2c. Todas tienen stock = 7', activas2.every(v => v.stock === 7), `stocks: ${activas2.map(v => v.stock).join(',')}`)

// ── ESCENARIO 3: Flujo CREATE — producto nuevo + variantes de talle ──────────
console.log('\n▸ 3. Flujo CREATE — producto nuevo con variantes de talle\n')

const { productId: prod3, variantId: defaultVar3 } = await createSimpleProduct('Remera Test Talle')

const { error: e3 } = await user.rpc('upsert_variants', {
  p_store_id: STORE_ID,
  p_product_id: prod3,
  p_variants: [
    { sku: `TALLE-S-${prod3.slice(0, 8)}`, attributes: { talle: 'S' }, price: null, stock: 10 },
    { sku: `TALLE-M-${prod3.slice(0, 8)}`, attributes: { talle: 'M' }, price: null, stock: 5 },
    { sku: `TALLE-L-${prod3.slice(0, 8)}`, attributes: { talle: 'L' }, price: null, stock: 3 },
  ],
  p_reason: 'creación de producto',
})
check('3a. upsert_variants flujo CREATE no lanza error', !e3, e3?.message ?? e3?.code)

const v3 = await variantsOf(prod3)
const activas3 = v3.filter(v => v.is_active && Object.keys(v.attributes).length > 0)
check('3b. 3 variantes de talle creadas', activas3.length === 3, `got ${activas3.length}`)
check('3c. Stocks correctos (10, 5, 3)', activas3.some(v => v.stock === 10) && activas3.some(v => v.stock === 5) && activas3.some(v => v.stock === 3))
const inactivas3 = v3.filter(v => !v.is_active)
check('3d. Variante por defecto inactivada', inactivas3.some(v => v.id === defaultVar3))

// ── Limpieza ─────────────────────────────────────────────────────────────────
await deleteProduct(prod1)
await deleteProduct(prod3)

// ── Resumen ──────────────────────────────────────────────────────────────────
const total = pass + fail
console.log(`\n${'─'.repeat(50)}`)
console.log(`Resultados: ${pass}/${total} pasaron${fail > 0 ? ` — ${fail} FALLARON` : ' — ✓ todos OK'}`)
console.log('─'.repeat(50))
if (fail > 0) process.exit(1)
