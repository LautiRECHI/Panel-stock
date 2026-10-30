# PENDIENTES

## Etapas siguientes de Pedidos

### ✅ Etapa 2a — Canal server-to-server con API keys _(implementada)_
Tabla `store_api_keys`, funciones PL/pgSQL SECURITY DEFINER (`storefront_create_order`, `storefront_get_order`, `storefront_mark_paid`, `storefront_cancel_order`, `expire_pending_orders`), 4 routes en `/api/store/orders/`, y UI de gestión en `/panel/integraciones`. Autenticación por Bearer token con hash SHA-256; rate limit 3 pedidos/email o teléfono en 24h; stock descontado en la creación y devuelto al cancelar.

### Etapa 3 — Cotización de envío con Correo Argentino
Agregar `weight_g` y `dimensions_cm` (largo, ancho, alto) a `product_variants`. Almacenar credenciales de Correo Argentino cifradas por tienda (campo en `stores`, nunca en `.env`). Integrar la API de Correo para cotizar envíos al vuelo en el checkout público y en la creación manual.

### Etapa 4 — Pago con Mercado Pago
Webhook con verificación de firma `x-signature`. Campos ya reservados: `payment_method='mercadopago'`, `payment_reference`. Crear tabla `mp_credentials` por tienda con `access_token` cifrado. Al recibir el webhook, llamar `mark_order_paid` con los datos del pago. Manejo de devoluciones: evento `cancelado` parcial (fuera del alcance de Etapa 1).

### Etapa 5 — Pago con dLocal Go
Similar a Mercado Pago pero con la API de dLocal. Usar `payment_method='dlocalgo'`.

### Otras funcionalidades pendientes de Pedidos
- **Emails de confirmación**: al crear el pedido y al cambiar de estado (Resend / SendGrid).
- **Factura ARCA**: generación de comprobante fiscal (requiere CUIT y condición impositiva en `stores`).
- **Devoluciones parciales**: cancelación de ítems individuales sin cancelar todo el pedido.
- **Exportar pedidos a CSV**: descarga del historial para el dueño de la tienda.

---


## Para decidir más adelante

- `resolveStoreId()` en las acciones de categorías asume que el usuario tiene una sola tienda (hace `SELECT id FROM stores LIMIT 1` filtrado por RLS). Es correcto hoy porque el onboarding crea una sola tienda por usuario. El día que una persona administre varias tiendas (por ejemplo como admin de varios clientes), ese `LIMIT 1` va a tomar una tienda arbitraria. Antes de soportar multi-tienda por usuario hay que agregar selector de tienda activa (en sesión o en la URL) y que `resolveStoreId()` lo use en lugar de `LIMIT 1`.

## Fuera del alcance del importador (etapa 5)

Las siguientes funcionalidades fueron explícitamente excluidas de la implementación del importador de productos y deberán abordarse en etapas posteriores:

- **Importar fotos**: el importador solo crea el producto y sus variantes; las imágenes deben cargarse manualmente desde el panel.
- **Actualizar productos existentes**: si un producto ya existe (mismo slug), se saltea. No hay modo "upsert" ni actualización por SKU.
- **Exportar catálogo a CSV/Excel**: funcionalidad inversa al importador, para descargar el catálogo actual.
- **Importación para tiendas con más de una membresía activa por usuario**: el importador usa `LIMIT 1` para resolver el store_id, mismo patrón que el resto del panel. Si se implementa la selección de tienda activa (ver punto anterior), el importador lo heredará automáticamente.

## Deuda técnica detectada durante el importador

- **Vulnerabilidad moderada en exceljs (via uuid)**: `exceljs >=3.5.0` depende de `uuid < 11.1.1` que tiene un bug de buffer bounds check en funciones v3/v5/v6 cuando se pasa un `buf` externo. Nuestra app solo lee archivos con ExcelJS (no genera UUIDs), por lo que la vulnerabilidad **no es explotable en este contexto**. `npm audit fix --force` instalaría exceljs 3.4.0 (breaking change). Revisar cuando exceljs publique una versión que actualice su dependencia de uuid.
- **Precio del producto**: el importador usa el precio de la primera fila del grupo como `product.price` y deja los precios de las variantes en NULL (usan el precio base). Si en el futuro el formato permite precios distintos por variante, habrá que extender la lógica de parseo.
- **Una sola dimensión de variante por fila**: el formato de la plantilla admite un solo par `opcion/valor` por fila. Productos con múltiples dimensiones (ej. Talle + Color) no son importables con el formato actual.
