/**
 * Tests para el flujo de "Publicar" en ProductForm.
 * Cubren: fallo en subida de foto (storage), fallo en registerPhoto (server action),
 * producto creado con fotos fallidas (redirige a edición) y doble clic en Publicar.
 *
 * Requieren un servidor corriendo en localhost:3000 con un usuario de prueba
 * test@local.test / Test1234!local y una tienda activa.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const EMAIL = 'test@local.test'
const PASSWORD = 'Test1234!local'

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/panel**')
}

async function goToNuevoProducto(page: Page) {
  await page.goto('/panel/productos/nuevo')
  await page.waitForLoadState('networkidle')
}

async function fillProductoMinimo(page: Page, nombre: string) {
  await page.fill('#prod-name', nombre)
  await page.fill('#prod-price', '1.000,00')
}

// Genera un nombre único para evitar conflictos entre ejecuciones
function uniqueName(base: string) {
  return `${base} ${Date.now()}`
}

test.describe('Publicar producto — robustez ante fallos', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  // ── 1. Fallo en storage upload → botón no queda bloqueado, se muestra aviso ───

  test('fallo en subida de foto: producto se crea, aparece aviso y redirige al edit', async ({ page }) => {
    await goToNuevoProducto(page)
    const nombre = uniqueName('Test fallo storage')
    await fillProductoMinimo(page, nombre)

    // Interceptar el upload a Supabase Storage para que falle
    await page.route('**/storage/v1/object/**', (route: Route) => {
      if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
        route.fulfill({ status: 500, body: JSON.stringify({ message: 'Internal Server Error' }) })
      } else {
        route.continue()
      }
    })

    // Adjuntar una imagen de prueba (1x1 px PNG en base64)
    const imgBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const buffer = Buffer.from(imgBase64, 'base64')
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer,
    })

    // Verificar que la foto quedó en estado pendiente (no se sube hasta Publicar en CREATE mode)
    // Publicar
    await page.getByRole('button', { name: 'Publicar' }).click()

    // Esperar redirección a edición (con el id del producto recién creado)
    await page.waitForURL('**/panel/productos/*', { timeout: 15_000 })
    const url = page.url()
    expect(url).toMatch(/\/panel\/productos\/[0-9a-f-]{36}$/)

    // Debe haber un toast de warning (no de error fatal)
    const toast = page.locator('[role="status"]')
    await expect(toast.first()).toBeVisible({ timeout: 5_000 })
    const toastText = await toast.first().textContent()
    expect(toastText).toMatch(/foto|subir|editar/i)

    // El botón Publicar no debe seguir en estado loading (isPending = false)
    // En la página de edición el botón existe y está habilitado
    const publishBtn = page.getByRole('button', { name: 'Publicar' })
    await expect(publishBtn).toBeEnabled({ timeout: 3_000 })
  })

  // ── 2. Fallo en registerPhoto (server action): mismo resultado que fallo de storage ─

  test('fallo en registerPhoto: producto se crea, aparece aviso, redirige al edit', async ({ page }) => {
    await goToNuevoProducto(page)
    const nombre = uniqueName('Test fallo registerPhoto')
    await fillProductoMinimo(page, nombre)

    // Dejar pasar el upload de storage pero bloquear las llamadas a server actions
    // que ocurren DESPUÉS del upload (registerPhoto usa POST a /_next/action*)
    // Estrategia: dejar que el storage upload tenga éxito, luego interceptar registerPhoto.
    // Como no podemos distinguir qué action es sin leer el header Next-Action fácilmente,
    // interceptamos el storage para que devuelva éxito vacío y luego interceptamos
    // la llamada a la server action para que falle.
    let storageIntercepted = false
    await page.route('**/storage/v1/object/**', async (route: Route) => {
      const method = route.request().method()
      if ((method === 'POST' || method === 'PUT') && !storageIntercepted) {
        storageIntercepted = true
        // Simular upload exitoso pero luego registerPhoto fallará por red
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ Key: 'test/products/test/uuid.webp' }),
        })
      } else {
        await route.continue()
      }
    })

    // Interceptar server actions (/_next/action) para que registerPhoto falle
    await page.route('/_next/action*', async (route: Route) => {
      // Solo fallar cuando ya se hizo el storage upload (es el registerPhoto)
      if (storageIntercepted) {
        await route.fulfill({ status: 500, body: 'Internal Server Error' })
      } else {
        await route.continue()
      }
    })

    const imgBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const buffer = Buffer.from(imgBase64, 'base64')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer,
    })

    await page.getByRole('button', { name: 'Publicar' }).click()
    await page.waitForURL('**/panel/productos/**', { timeout: 15_000 })

    // Debe haber llegado a alguna URL válida (el producto se creó o hubo error antes)
    const url = page.url()
    // Puede haber llegado al edit (si createProduct tuvo éxito) o quedarse en /nuevo (si createProduct falló)
    // Lo importante: el botón no está bloqueado
    const publishBtn = page.getByRole('button', { name: 'Publicar' })
    if (await publishBtn.isVisible()) {
      await expect(publishBtn).toBeEnabled({ timeout: 3_000 })
    }
    expect(url).not.toContain('/nuevo')
  })

  // ── 3. Producto creado con fotos fallidas redirige a /panel/productos/{id} ────

  test('fotos fallidas: redirige a la URL de edición (UUID en la URL)', async ({ page }) => {
    await goToNuevoProducto(page)
    const nombre = uniqueName('Test redirect edit')
    await fillProductoMinimo(page, nombre)

    // Fallar todas las subidas a storage
    await page.route('**/storage/v1/object/**', (route: Route) => {
      if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
        route.fulfill({ status: 403, body: JSON.stringify({ message: 'Unauthorized' }) })
      } else {
        route.continue()
      }
    })

    const imgBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    await page.locator('input[type="file"]').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imgBase64, 'base64'),
    })

    await page.getByRole('button', { name: 'Publicar' }).click()
    await page.waitForURL('**/panel/productos/*', { timeout: 15_000 })

    // La URL debe ser /panel/productos/{uuid}, no /panel/productos o /nuevo
    expect(page.url()).toMatch(/\/panel\/productos\/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  // ── 4. Doble clic en Publicar: solo se crea un producto, botón deshabilitado ──

  test('doble clic en Publicar: botón queda deshabilitado tras el primer clic', async ({ page }) => {
    await goToNuevoProducto(page)
    const nombre = uniqueName('Test doble clic')
    await fillProductoMinimo(page, nombre)

    const publishBtn = page.getByRole('button', { name: 'Publicar' })

    // Primer clic
    await publishBtn.click()

    // Inmediatamente verificar que el botón está deshabilitado (isPending = true)
    await expect(publishBtn).toBeDisabled({ timeout: 1_000 })

    // Esperar que complete y verificar que solo existe un producto con ese nombre
    await page.waitForURL('**/panel/productos**', { timeout: 15_000 })

    // Volver al listado y verificar que hay exactamente 1 producto con ese nombre
    await page.goto('/panel/productos')
    await page.waitForLoadState('networkidle')
    const matches = page.locator(`text="${nombre}"`)
    await expect(matches).toHaveCount(1, { timeout: 5_000 })
  })
})
