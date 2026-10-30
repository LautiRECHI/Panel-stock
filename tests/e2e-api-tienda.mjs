/**
 * Test E2E del canal API storefront (API keys + rutas /api/store/orders/).
 *
 * Corre contra el servidor de desarrollo local (localhost:3000) y Supabase local.
 * NO toca ningún entorno de staging o producción.
 * NO deja claves ni secretos en el repositorio: todos se generan en memoria.
 *
 * Uso:
 *   node tests/e2e-api-tienda.mjs
 *
 * Requisito previo:
 *   npx supabase db reset   (aplica migraciones + seed)
 *   npm run dev             (servidor en localhost:3000)
 *   Crear tests/.env.test.local con las claves de supabase status
 *
 * Variables de entorno (o en tests/.env.test.local):
 *   SUPABASE_LOCAL_URL         http://127.0.0.1:54321
 *   SUPABASE_LOCAL_ANON_KEY    ANON_KEY de `npx supabase status`
 *   SUPABASE_LOCAL_SERVICE_KEY SERVICE_ROLE_KEY de `npx supabase status`
 *   E2E_BASE_URL               (opcional, default: http://localhost:3000)
 */

import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// ── Cargar .env.test.local ──────────────────────────────────────────────────
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
const BASE_URL     = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

// ── Guardrails ──────────────────────────────────────────────────────────────
if (!BASE_URL.includes('localhost') && !BASE_URL.includes('127.0.0.1')) {
  console.error(`ABORT: E2E_BASE_URL (${BASE_URL}) no es localhost.`)
  process.exit(1)
}
if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
  console.error(`ABORT: SUPABASE_LOCAL_URL (${SUPABASE_URL}) no es localhost.`)
  process.exit(1)
}

const MISSING = []
if (!ANON_KEY)    MISSING.push('SUPABASE_LOCAL_ANON_KEY')
if (!SERVICE_KEY) MISSING.push('SUPABASE_LOCAL_SERVICE_KEY')
if (MISSING.length > 0) {
  console.error(`Faltan variables de entorno: ${MISSING.join(', ')}`)
  console.error('Ejecutá: npx supabase status')
  console.error('Luego creá tests/.env.test.local con los valores')
  process.exit(1)
}

// ── Seed UUIDs ──────────────────────────────────────────────────────────────
const SEED_STORE_ID = 'e0eedc00-0000-4000-8000-000000000010'
const VAR_HDM_S     = 'e0eedc00-0003-4000-8000-000000000001' // stock 5, precio 45000
const VAR_HDM_M     = 'e0eedc00-0003-4000-8000-000000000002' // stock 8, precio 45000
const STORE_B_ID    = 'e2e00000-0000-4000-8000-e2e0b0000001'

// ── Clientes Supabase ───────────────────────────────────────────────────────
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const anon  = createClient(SUPABASE_URL, ANON_KEY,   { auth: { persistSession: false } })

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeApiKey() {
  const secret = 'pdolive_' + randomBytes(32).toString('hex')
  const hash   = createHash('sha256').update(secret).digest('hex')
  const prefix = secret.slice(0, 8)
  return { secret, hash, prefix }
}

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

async function api(method, path, body, key) {
  const headers = { 'Content-Type': 'application/json' }
  if (key) headers['Authorization'] = `Bearer ${key}`
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })
  let data
  try { data = await res.json() } catch { data = null }
  return { status: res.status, data }
}

async function stockOf(variantId) {
  const { data } = await admin.from('product_variants').select('stock').eq('id', variantId).single()
  return data?.stock ?? -1
}

async function orderStatus(orderId) {
  const { data } = await admin.from('orders').select('status, payment_status').eq('id', orderId).single()
  return data ?? {}
}

// ── SETUP ───────────────────────────────────────────────────────────────────
console.log('\n▸ Configurando claves de prueba...')

// 1. Iniciar sesión como usuario seed para llamar a create/revoke_store_api_key
const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({
  email: 'test@local.test',
  password: 'Test1234!local',
})
if (signInError || !signInData?.session) {
  console.error('No se pudo iniciar sesión:', signInError?.message)
  process.exit(1)
}
const userClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${signInData.session.access_token}` } },
})

// 2. KEY_A: creada vía la función del panel (prueba el flujo completo)
const { data: keyAData, error: keyAErr } = await userClient.rpc('create_store_api_key', { p_name: 'E2E key A' })
if (keyAErr || !keyAData?.secret) {
  console.error('No se pudo crear KEY_A:', keyAErr?.message)
  process.exit(1)
}
const KEY_A = keyAData.secret
console.log(`  KEY_A: ${KEY_A.slice(0, 15)}... ✓`)

// 3. Store B + KEY_B: inserción directa (prueba aislamiento entre tiendas)
const keyB = makeApiKey()
const KEY_B = keyB.secret
await admin.from('stores').upsert({ id: STORE_B_ID, name: 'Tienda B E2E', slug: 'tienda-b-e2e' })
const { error: insertKeyBErr } = await admin.from('store_api_keys').insert({
  store_id: STORE_B_ID, name: 'KEY B E2E', key_prefix: keyB.prefix, key_hash: keyB.hash,
})
if (insertKeyBErr) {
  console.error('No se pudo crear KEY_B:', insertKeyBErr.message)
  process.exit(1)
}
console.log(`  KEY_B (store B): ${KEY_B.slice(0, 15)}... ✓`)

// 4. KEY_REVOKE: creada vía la función del panel (la revocaremos más adelante)
const { data: keyRevokeData, error: keyRevokeErr } = await userClient.rpc('create_store_api_key', { p_name: 'E2E key revoke' })
if (keyRevokeErr || !keyRevokeData?.secret) {
  console.error('No se pudo crear KEY_REVOKE:', keyRevokeErr?.message)
  process.exit(1)
}
const KEY_REVOKE    = keyRevokeData.secret
const KEY_REVOKE_ID = keyRevokeData.id
console.log(`  KEY_REVOKE: ${KEY_REVOKE.slice(0, 15)}... (id: ${KEY_REVOKE_ID?.slice(0, 8)}...) ✓`)

// ────────────────────────────────────────────────────────────────────────────
console.log('\n▸ A. Validación de auth y cuerpo\n')

// A1. Sin cabecera Authorization
{
  const r = await api('POST', '/api/store/orders', {
    customer: { name: 'Test' }, delivery: { method: 'retiro' },
    items: [{ variant_id: VAR_HDM_S, quantity: 1 }],
  }, null)
  check('A1. Sin auth → 401', r.status === 401, `got ${r.status}`)
}

// A2. Clave inválida
{
  const r = await api('POST', '/api/store/orders', {
    customer: { name: 'Test' }, delivery: { method: 'retiro' },
    items: [{ variant_id: VAR_HDM_S, quantity: 1 }],
  }, 'pdolive_0000000000000000000000000000000000000000000000000000000000000000')
  check('A2. Clave inválida → 401', r.status === 401, `got ${r.status}`)
}

// A3. Falta customer.name
{
  const r = await api('POST', '/api/store/orders', {
    customer: {}, delivery: { method: 'retiro' },
    items: [{ variant_id: VAR_HDM_S, quantity: 1 }],
  }, KEY_A)
  check('A3. Falta customer.name → 422', r.status === 422, `got ${r.status}`)
}

// A4. Domicilio sin calle → 422 (llega a la función de DB)
{
  const r = await api('POST', '/api/store/orders', {
    customer: { name: 'Test' },
    delivery: { method: 'domicilio', postal_code: '1000' },
    items: [{ variant_id: VAR_HDM_S, quantity: 1 }],
  }, KEY_A)
  check('A4. Domicilio sin calle → 422', r.status === 422, `got ${r.status}`)
}

// A5. Stock insuficiente (6 > stock de 5)
{
  const r = await api('POST', '/api/store/orders', {
    customer: { name: 'Test' }, delivery: { method: 'retiro' },
    items: [{ variant_id: VAR_HDM_S, quantity: 6 }],
  }, KEY_A)
  check('A5. Stock insuficiente → 409', r.status === 409, `got ${r.status}`)
}
check('A5b. Stock sin cambios después de error', await stockOf(VAR_HDM_S) === 5, `got ${await stockOf(VAR_HDM_S)}`)

// ────────────────────────────────────────────────────────────────────────────
console.log('\n▸ B. Camino feliz: crear pedido\n')

const r_create = await api('POST', '/api/store/orders', {
  customer: { name: 'Ana García', email: 'ana@test.com', phone: '1122334455' },
  delivery: { method: 'retiro' },
  items: [{ variant_id: VAR_HDM_S, quantity: 2 }],
  customer_note: 'Sin embalaje',
  expires_in_hours: 24,
}, KEY_A)
check('B1. Crear pedido retiro 2x HDM-S → 201', r_create.status === 201, `got ${r_create.status}`)
check('B2. Respuesta tiene id y public_token', !!r_create.data?.id && !!r_create.data?.public_token)
check('B3. Total = 90000 (2×45000)', r_create.data?.total === 90000, `got ${r_create.data?.total}`)
check('B4. shipping_cost = null (retiro)', r_create.data?.shipping_cost === null, `got ${r_create.data?.shipping_cost}`)

const ORDER_A_ID    = r_create.data?.id
const PUBLIC_TOKEN  = r_create.data?.public_token

const stockAfterB = await stockOf(VAR_HDM_S)
check('B5. Stock HDM-S bajó de 5 a 3', stockAfterB === 3, `got ${stockAfterB}`)

// Verificar motivo en stock_movements
const { data: smData } = await admin.from('stock_movements')
  .select('reason').eq('variant_id', VAR_HDM_S)
  .order('created_at', { ascending: false }).limit(1).single()
check('B6. stock_movements tiene motivo "Venta online"', smData?.reason?.startsWith('Venta online - pedido #'), `got "${smData?.reason}"`)

// ────────────────────────────────────────────────────────────────────────────
console.log('\n▸ C. GET pedido por token\n')

const r_get = await api('GET', `/api/store/orders/${PUBLIC_TOKEN}`, null, KEY_A)
check('C1. GET por public_token → 200', r_get.status === 200, `got ${r_get.status}`)
check('C2. Tiene número de pedido', typeof r_get.data?.number === 'number')
check('C3. Tiene items', Array.isArray(r_get.data?.items) && r_get.data.items.length > 0)
check('C4. NO expone id interno', r_get.data?.id === undefined)
check('C5. NO expone store_id', r_get.data?.store_id === undefined)
check('C6. NO expone customer_email ni phone', r_get.data?.customer_email === undefined && r_get.data?.customer_phone === undefined)
check('C7. Status = pendiente', r_get.data?.status === 'pendiente', `got "${r_get.data?.status}"`)

const r_get_bad = await api('GET', `/api/store/orders/${'0'.repeat(32)}`, null, KEY_A)
check('C8. GET token inexistente → 404', r_get_bad.status === 404, `got ${r_get_bad.status}`)

const r_get_noauth = await api('GET', `/api/store/orders/${PUBLIC_TOKEN}`, null, null)
check('C9. GET sin auth → 401', r_get_noauth.status === 401, `got ${r_get_noauth.status}`)

// ────────────────────────────────────────────────────────────────────────────
console.log('\n▸ D. Marcar pagado\n')

// D1. Monto incorrecto
const r_paid_bad = await api('POST', `/api/store/orders/${ORDER_A_ID}/paid`, {
  provider: 'mercadopago', external_payment_id: 'MP-12345', amount: 1.00,
}, KEY_A)
check('D1. Monto incorrecto → 422', r_paid_bad.status === 422, `got ${r_paid_bad.status}`)

// D2. Verificar que el pedido sigue pendiente
const stateAfterBadPay = await orderStatus(ORDER_A_ID)
check('D2. Pedido sigue pendiente tras pago fallido', stateAfterBadPay.status === 'pendiente', `got "${stateAfterBadPay.status}"`)

// D3. Monto correcto
const r_paid_ok = await api('POST', `/api/store/orders/${ORDER_A_ID}/paid`, {
  provider: 'mercadopago', external_payment_id: 'MP-12345', amount: 90000,
}, KEY_A)
check('D3. Pago correcto → 200', r_paid_ok.status === 200, `got ${r_paid_ok.status}`)
check('D4. idempotent = false en primer pago', r_paid_ok.data?.idempotent === false, `got ${r_paid_ok.data?.idempotent}`)

// D5. Mismo external_payment_id → idempotente
const r_paid_idem = await api('POST', `/api/store/orders/${ORDER_A_ID}/paid`, {
  provider: 'mercadopago', external_payment_id: 'MP-12345', amount: 90000,
}, KEY_A)
check('D5. Repetir pago con mismo ext_id → 200 idempotente', r_paid_idem.status === 200 && r_paid_idem.data?.idempotent === true, `status=${r_paid_idem.status} idempotent=${r_paid_idem.data?.idempotent}`)

// D6. Verificar estado en DB
const stateAfterPay = await orderStatus(ORDER_A_ID)
check('D6. Pedido es pagado', stateAfterPay.status === 'pagado', `got "${stateAfterPay.status}"`)
check('D7. payment_status = aprobado', stateAfterPay.payment_status === 'aprobado', `got "${stateAfterPay.payment_status}"`)

// ────────────────────────────────────────────────────────────────────────────
console.log('\n▸ E. Cancelar pedido + reposición de stock\n')

// E1. Crear pedido 2
const r_order2 = await api('POST', '/api/store/orders', {
  customer: { name: 'Carlos López' },
  delivery: { method: 'retiro' },
  items: [{ variant_id: VAR_HDM_S, quantity: 1 }],
}, KEY_A)
check('E1. Crear pedido 2 (1x HDM-S) → 201', r_order2.status === 201, `got ${r_order2.status}`)
const ORDER_B_ID = r_order2.data?.id
check('E2. Stock HDM-S = 2 tras orden 2', await stockOf(VAR_HDM_S) === 2, `got ${await stockOf(VAR_HDM_S)}`)

// E3. Cancelar
const r_cancel = await api('POST', `/api/store/orders/${ORDER_B_ID}/cancel`, { reason: 'Test' }, KEY_A)
check('E3. Cancelar pedido 2 → 200', r_cancel.status === 200, `got ${r_cancel.status}`)
check('E4. Stock HDM-S = 3 (restaurado)', await stockOf(VAR_HDM_S) === 3, `got ${await stockOf(VAR_HDM_S)}`)

// Verificar motivo de reposición
const { data: smCancelData } = await admin.from('stock_movements')
  .select('reason').eq('variant_id', VAR_HDM_S)
  .order('created_at', { ascending: false }).limit(1).single()
check('E5. stock_movements tiene motivo "Cancelación online"', smCancelData?.reason?.startsWith('Cancelación online - pedido #'), `got "${smCancelData?.reason}"`)

// E6. Idempotente: cancelar de nuevo → OK, stock sin cambios
const r_cancel2 = await api('POST', `/api/store/orders/${ORDER_B_ID}/cancel`, {}, KEY_A)
check('E6. Cancelar pedido ya cancelado → 200 (idempotente)', r_cancel2.status === 200, `got ${r_cancel2.status}`)
check('E7. Stock HDM-S sigue = 3 (no doble reposición)', await stockOf(VAR_HDM_S) === 3, `got ${await stockOf(VAR_HDM_S)}`)

// ────────────────────────────────────────────────────────────────────────────
console.log('\n▸ F. Vencimiento de pedido\n')

// F1. Crear pedido 3
const r_order3 = await api('POST', '/api/store/orders', {
  customer: { name: 'María Pérez' },
  delivery: { method: 'retiro' },
  items: [{ variant_id: VAR_HDM_S, quantity: 1 }],
  expires_in_hours: 1,
}, KEY_A)
check('F1. Crear pedido 3 (1x HDM-S) → 201', r_order3.status === 201, `got ${r_order3.status}`)
const ORDER_C_ID = r_order3.data?.id
check('F2. Stock HDM-S = 2 tras orden 3', await stockOf(VAR_HDM_S) === 2, `got ${await stockOf(VAR_HDM_S)}`)

// F3. Forzar vencimiento retrotrayendo expires_at
const { error: expForceErr } = await admin.from('orders')
  .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
  .eq('id', ORDER_C_ID)
check('F3. expires_at forzado al pasado', !expForceErr, expForceErr?.message)

// F4. Trigger expire_pending_orders
const { data: expCount, error: expErr } = await admin.rpc('expire_pending_orders', { p_store_id: SEED_STORE_ID })
check('F4. expire_pending_orders retorna ≥ 1', !expErr && expCount >= 1, `count=${expCount} err=${expErr?.message}`)

// F5. Estado del pedido 3
const stateC = await orderStatus(ORDER_C_ID)
check('F5. Pedido 3 = cancelado', stateC.status === 'cancelado', `got "${stateC.status}"`)
check('F6. payment_status = vencido', stateC.payment_status === 'vencido', `got "${stateC.payment_status}"`)
check('F7. Stock HDM-S = 3 (restaurado por vencimiento)', await stockOf(VAR_HDM_S) === 3, `got ${await stockOf(VAR_HDM_S)}`)

// F8. Llamar expire_pending_orders de nuevo → 0 vencidos esta vez (idempotente)
const { data: expCount2 } = await admin.rpc('expire_pending_orders', { p_store_id: SEED_STORE_ID })
check('F8. Segunda llamada → 0 vencidos (idempotente)', expCount2 === 0, `got ${expCount2}`)
check('F9. Stock HDM-S sigue = 3 (no doble reposición)', await stockOf(VAR_HDM_S) === 3, `got ${await stockOf(VAR_HDM_S)}`)

// ────────────────────────────────────────────────────────────────────────────
console.log('\n▸ G. Clave revocada\n')

// G1. KEY_REVOKE funciona antes de revocar
const r_revoke_before = await api('POST', '/api/store/orders', {
  customer: { name: 'Revoke test' },
  delivery: { method: 'retiro' },
  items: [{ variant_id: VAR_HDM_M, quantity: 1 }],
}, KEY_REVOKE)
check('G1. KEY_REVOKE funciona antes de revocar → 201', r_revoke_before.status === 201, `got ${r_revoke_before.status}`)

// G2. Revocar vía la función del panel
const { error: revokeErr } = await userClient.rpc('revoke_store_api_key', { p_id: KEY_REVOKE_ID })
check('G2. revoke_store_api_key sin error', !revokeErr, revokeErr?.message)

// G3. KEY_REVOKE ya no funciona → 401
const r_revoke_after = await api('POST', '/api/store/orders', {
  customer: { name: 'Revoke test 2' },
  delivery: { method: 'retiro' },
  items: [{ variant_id: VAR_HDM_M, quantity: 1 }],
}, KEY_REVOKE)
check('G3. KEY_REVOKE revocada → 401', r_revoke_after.status === 401, `got ${r_revoke_after.status}`)

// ────────────────────────────────────────────────────────────────────────────
console.log('\n▸ H. Aislamiento entre tiendas (KEY_B no accede a pedidos de tienda A)\n')

// H1. GET pedido A (tienda seed) con KEY_B → 404 (token no existe para tienda B)
const r_crossGet = await api('GET', `/api/store/orders/${PUBLIC_TOKEN}`, null, KEY_B)
check('H1. KEY_B no puede ver pedido de tienda A → 404', r_crossGet.status === 404, `got ${r_crossGet.status}`)

// H2. mark_paid de pedido A con KEY_B → 404
const r_crossPay = await api('POST', `/api/store/orders/${ORDER_A_ID}/paid`, {
  provider: 'test', external_payment_id: 'CROSS-001', amount: 90000,
}, KEY_B)
check('H2. KEY_B no puede pagar pedido de tienda A → 404', r_crossPay.status === 404, `got ${r_crossPay.status}`)

// H3. cancel pedido B (ya cancelado) con KEY_B → 404
const r_crossCancel = await api('POST', `/api/store/orders/${ORDER_B_ID}/cancel`, {}, KEY_B)
check('H3. KEY_B no puede cancelar pedido de tienda A → 404', r_crossCancel.status === 404, `got ${r_crossCancel.status}`)

// ────────────────────────────────────────────────────────────────────────────
console.log('\n▸ I. Rate limiting (> 3 pedidos pendientes del mismo email en 24h)\n')

const RL_EMAIL = `ratelimit-${Date.now()}@test.com`
for (let i = 1; i <= 3; i++) {
  const r = await api('POST', '/api/store/orders', {
    customer: { name: `RL ${i}`, email: RL_EMAIL },
    delivery: { method: 'retiro' },
    items: [{ variant_id: VAR_HDM_M, quantity: 1 }],
  }, KEY_A)
  check(`I${i}. Pedido RL ${i}/3 → 201`, r.status === 201, `got ${r.status}`)
}

const r_rl4 = await api('POST', '/api/store/orders', {
  customer: { name: 'RL 4', email: RL_EMAIL },
  delivery: { method: 'retiro' },
  items: [{ variant_id: VAR_HDM_M, quantity: 1 }],
}, KEY_A)
check('I4. 4º pedido del mismo email → 429', r_rl4.status === 429, `got ${r_rl4.status}`)

// ── Resumen ─────────────────────────────────────────────────────────────────
const total = pass + fail
console.log(`\n${'─'.repeat(50)}`)
console.log(`Resultados: ${pass}/${total} pasaron${fail > 0 ? ` — ${fail} FALLARON` : ' — ✓ todos OK'}`)
console.log('─'.repeat(50))
if (fail > 0) process.exit(1)
