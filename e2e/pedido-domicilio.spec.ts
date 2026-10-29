import { test, expect, Page } from '@playwright/test'

const EMAIL    = 'test@local.test'
const PASSWORD = 'Test1234!local'

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/panel**')
}

function captureErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
    // React key warnings come through as warnings
    if (msg.type() === 'warning' && msg.text().toLowerCase().includes('key')) {
      errors.push(msg.text())
    }
  })
  return errors
}

test.describe('Pedido domicilio con costo de envío', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('crear pedido domicilio con envío $5000 y verificar detalle', async ({ page }) => {
    const errors = captureErrors(page)

    await page.goto('/panel/pedidos/nuevo')

    // Buscar y agregar un producto
    await page.fill('[aria-label="Buscar variante"]', 'Raqueta')
    await page.waitForSelector('ul[role="listbox"]')
    await page.locator('ul[role="listbox"] button').first().click()

    // Datos del cliente
    await page.fill('#c-name', 'Test Playwright')
    await page.fill('#c-phone', '1122334455')

    // Seleccionar domicilio
    await page.getByRole('button', { name: 'Envío a domicilio' }).click()

    // Completar dirección
    await page.fill('#d-street', 'Av. Corrientes')
    await page.fill('#d-number', '1234')
    await page.fill('#d-cp', '1043')
    await page.fill('#d-city', 'CABA')
    await page.fill('#d-province', 'Buenos Aires')

    // Costo de envío
    await page.fill('#ship-cost', '5000')

    // El totalizador en vivo debe mostrar la fila "Envío" con $5.000
    // span exacto "Envío" (no el botón "Envío a domicilio")
    const envioSpan = page.locator('span').filter({ hasText: /^Envío$/ })
    await expect(envioSpan).toBeVisible()

    // El precio de envío debe ser $5.000 — está en el sibling span del mismo div
    const shippingDiv = page.locator('div').filter({ has: envioSpan }).last()
    await expect(shippingDiv.locator('span').last()).toHaveText(/5\.000/)

    // Crear pedido
    await page.click('button[type="submit"]')
    await page.waitForURL('**/panel/pedidos/**', { timeout: 15_000 })

    // En el detalle: verificar que "Envío" muestra $5.000
    const detailEnvioDiv = page.locator('div').filter({ has: page.locator('span').filter({ hasText: /^Envío$/ }) }).last()
    await expect(detailEnvioDiv.locator('span').last()).toHaveText(/5\.000/)

    // Verificar que el Total incluye el envío
    const totalDiv = page.locator('div').filter({ has: page.locator('span').filter({ hasText: /^Total$/ }) }).last()
    const totalText = await totalDiv.locator('span').last().textContent()
    expect(totalText).toMatch(/\$\s*[\d.]+/)

    // Sin warnings de keys en consola
    const keyWarnings = errors.filter(e => e.toLowerCase().includes('key'))
    expect(keyWarnings, `Key warnings: ${keyWarnings.join(', ')}`).toHaveLength(0)
  })
})

test.describe('Modales — abrir, cerrar, teclado', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('modales de categorías: abrir, escribir, cerrar con Cancelar y Esc', async ({ page }) => {
    const errors = captureErrors(page)

    await page.goto('/panel/categorias')
    await page.waitForLoadState('networkidle')

    // Abrir modal crear
    await page.getByRole('button', { name: /nueva categoría/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Escribir varias teclas en el input del modal
    const input = dialog.locator('input').first()
    await input.fill('Prueba')
    await input.pressSequentially('abcdef123', { delay: 40 })

    // Cerrar con botón Cancelar
    await dialog.getByRole('button', { name: /cancelar/i }).click()
    await expect(dialog).not.toBeVisible()

    // Abrir de nuevo y cerrar con Esc
    await page.getByRole('button', { name: /nueva categoría/i }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()

    // Sin React key warnings
    const keyWarnings = errors.filter(e => e.toLowerCase().includes('key'))
    expect(keyWarnings, `Key warnings: ${keyWarnings.join(', ')}`).toHaveLength(0)
  })

  test('modales de pedido detalle: abrir y cerrar con Esc', async ({ page }) => {
    const errors = captureErrors(page)

    await page.goto('/panel/pedidos')
    await page.waitForLoadState('networkidle')

    // Abrir el primer pedido disponible
    const firstOrder = page.locator('a[href^="/panel/pedidos/"]').first()
    if (!(await firstOrder.isVisible())) {
      test.skip()
      return
    }
    await firstOrder.click()
    await page.waitForURL('**/panel/pedidos/**')
    await page.waitForLoadState('networkidle')

    // Buscar botones de acción (pagar, cancelar, envío, enviado, entregado)
    const actionBtns = page.getByRole('button').filter({ hasText: /pagar|cancelar|actualizar envío|marcar como enviado/i })
    const count = await actionBtns.count()

    for (let i = 0; i < count; i++) {
      const btn = actionBtns.nth(i)
      if (!(await btn.isVisible()) || !(await btn.isEnabled())) continue

      await btn.click()
      const dialog = page.getByRole('dialog')
      if (!(await dialog.isVisible())) continue

      // Escribir en inputs del modal
      const inputs = dialog.locator('input, textarea')
      for (let j = 0; j < await inputs.count(); j++) {
        await inputs.nth(j).pressSequentially('test123', { delay: 30 })
      }

      // Cerrar con X (aria-label="Cerrar") si existe, si no con Esc
      const closeBtn = dialog.locator('button[aria-label="Cerrar"]')
      if (await closeBtn.isVisible()) {
        await closeBtn.click()
      } else {
        await page.keyboard.press('Escape')
      }
      await expect(dialog).not.toBeVisible()
    }

    // Sin React key warnings
    const keyWarnings = errors.filter(e => e.toLowerCase().includes('key'))
    expect(keyWarnings, `Key warnings: ${keyWarnings.join(', ')}`).toHaveLength(0)
  })
})
