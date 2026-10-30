# API Tienda — Contrato de integración

Documentación para desarrolladores que integran un backend de tienda con el panel de gestión **panel-stock**.

---

## Índice

1. [Descripción general](#1-descripción-general)
2. [Autenticación](#2-autenticación)
3. [Rutas](#3-rutas)
   - [POST /api/store/orders — Crear pedido](#31-post-apistoreorders--crear-pedido)
   - [GET /api/store/orders/{public_token} — Consultar pedido](#32-get-apistoreorderspublic_token--consultar-pedido)
   - [POST /api/store/orders/{id}/paid — Registrar pago](#33-post-apistoreordersidpaid--registrar-pago)
   - [POST /api/store/orders/{id}/cancel — Cancelar pedido](#34-post-apistoreordersidcancel--cancelar-pedido)
4. [Límites y reglas de negocio](#4-límites-y-reglas-de-negocio)
5. [Variables de entorno](#5-variables-de-entorno)
6. [Ejemplos de código](#6-ejemplos-de-código)
7. [Referencia de errores](#7-referencia-de-errores)

---

## 1. Descripción general

Esta API permite que el backend de una tienda (storefront) cree y gestione pedidos en el panel de gestión. La integración es **exclusivamente server-to-server**: las claves de API nunca deben exponerse en el navegador ni en código cliente.

**URL base:**

```
https://tu-panel.example.com/api/store/orders
```

**Características clave:**

- Todas las respuestas son JSON con `Content-Type: application/json`.
- Todas las respuestas incluyen `Cache-Control: no-store`.
- Los precios se recalculan siempre desde la base de datos; los precios enviados en el payload son ignorados.
- El stock se descuenta en el momento de crear el pedido y se restituye al cancelarlo o cuando vence.
- Los números de pedido son auto-incrementales por tienda y empiezan en 1001.
- La moneda es siempre `ARS`. Soporte multi-moneda está planificado para versiones futuras.

---

## 2. Autenticación

### Generación de claves

Las claves de API se generan desde el panel en **Integraciones** (`/panel/integraciones`). Solo el `owner` de la tienda puede crear y revocar claves.

Al generar una clave:

- Se muestra el secreto completo **una única vez**. No se puede recuperar después.
- Solo se almacena el hash SHA-256 del secreto. El panel muestra únicamente el prefijo visible (`pdolive_`).

### Formato

```
pdolive_<64 caracteres hexadecimales>
```

**Longitud total:** 72 caracteres.

**Ejemplo (no usar):**

```
pdolive_a3f1c2e4b5d6789012345678abcdef901234567890abcdef1234567890abcdef12
```

### Uso en los requests

Incluir la clave completa en el header `Authorization` en cada request:

```
Authorization: Bearer pdolive_<secreto>
```

Cada request que llega con una clave válida actualiza automáticamente el campo `last_used_at` de la clave.

### Revocación

Las claves se revocan desde `/panel/integraciones`. Una clave revocada retorna `401` inmediatamente en todos los requests siguientes.

---

## 3. Rutas

### 3.1 POST /api/store/orders — Crear pedido

Crea un pedido en estado `pendiente`. El stock de cada variante se descuenta en el momento de la creación.

**Método y URL:**

```
POST https://tu-panel.example.com/api/store/orders
```

**Headers requeridos:**

```
Authorization: Bearer <clave_api>
Content-Type: application/json
```

#### Body

```json
{
  "customer": {
    "name": "string (requerido, máx. 200 chars)",
    "email": "string (opcional, email válido, máx. 200 chars)",
    "phone": "string (opcional, máx. 50 chars)"
  },
  "delivery": {
    "method": "retiro | domicilio  (requerido)",
    "street": "string (requerido si method=domicilio, máx. 200 chars)",
    "number": "string (opcional, máx. 20 chars)",
    "floor": "string (opcional, máx. 50 chars)",
    "city": "string (opcional, máx. 100 chars)",
    "province": "string (opcional, máx. 100 chars)",
    "postal_code": "string (requerido si method=domicilio, máx. 20 chars)",
    "notes": "string (opcional, máx. 500 chars)",
    "shipping_cost": "integer >= 0 (opcional, solo para domicilio)"
  },
  "items": [
    {
      "variant_id": "uuid (requerido)",
      "quantity": "integer > 0, máx. 20 (requerido)"
    }
  ],
  "customer_note": "string (opcional, máx. 1000 chars)",
  "expires_in_hours": "integer 1–720 (opcional, default 48)"
}
```

**Restricciones del body:**

| Campo | Regla |
|---|---|
| `items` | Máximo 30 ítems por pedido |
| `items[].quantity` | Mínimo 1, máximo 20 por ítem |
| `delivery.method` | Solo `retiro` o `domicilio` |
| `delivery.street` | Requerido cuando `method = domicilio` |
| `delivery.postal_code` | Requerido cuando `method = domicilio` |
| `delivery.shipping_cost` | Solo válido cuando `method = domicilio`; ignorado en `retiro` |
| `expires_in_hours` | Entre 1 y 720 horas (30 días); default: 48 |

#### Respuesta exitosa — 201 Created

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "number": 1042,
  "public_token": "a3f1c2e4b5d678901234567890abcdef",
  "subtotal": 45000.00,
  "shipping_cost": null,
  "total": 45000.00,
  "expires_at": "2026-10-30T18:00:00.000Z"
}
```

| Campo | Descripción |
|---|---|
| `id` | UUID interno del pedido. Necesario para las rutas `/paid` y `/cancel`. |
| `number` | Número de pedido visible en el panel (ej.: `#1042`). |
| `public_token` | Token de 32 chars hex. Necesario para la ruta GET de consulta pública. |
| `subtotal` | Suma de líneas sin envío. |
| `shipping_cost` | Costo de envío o `null` si es retiro. |
| `total` | `subtotal + shipping_cost`. |
| `expires_at` | Timestamp ISO 8601 de vencimiento del pedido. |

#### Errores

| Código | Causa |
|---|---|
| `401` | Clave ausente, inválida o revocada |
| `422` | Error de validación (campo requerido ausente, UUID inválido, `domicilio` sin `street` o `postal_code`, etc.) |
| `409` | Stock insuficiente en una o más variantes |
| `429` | Límite de rate excedido: más de 3 pedidos pendientes del mismo email o teléfono en las últimas 24 h |

---

### 3.2 GET /api/store/orders/{public_token} — Consultar pedido

Recupera el estado y detalle de un pedido usando su `public_token`. Solo se exponen campos seguros; no se retornan IDs internos, `store_id` ni notas internas del equipo.

**Método y URL:**

```
GET https://tu-panel.example.com/api/store/orders/{public_token}
```

**Parámetro de URL:**

| Parámetro | Tipo | Descripción |
|---|---|---|
| `public_token` | string (32 chars hex) | Token retornado por el endpoint de creación |

**Headers requeridos:**

```
Authorization: Bearer <clave_api>
```

#### Respuesta exitosa — 200 OK

```json
{
  "number": 1042,
  "status": "pendiente | pagado | enviado | entregado | cancelado",
  "payment_status": "pendiente | aprobado | rechazado | vencido | null",
  "customer_name": "Ana García",
  "delivery_method": "retiro | domicilio",
  "shipping_street": "Av. Rivadavia",
  "shipping_number": "1234",
  "shipping_floor": null,
  "shipping_city": "Buenos Aires",
  "shipping_province": "CABA",
  "shipping_postal_code": "1033",
  "items": [
    {
      "product_name": "Raqueta Head Delta Motion",
      "variant_label": "M",
      "sku": "HDM-M",
      "unit_price": 45000.00,
      "quantity": 1,
      "line_total": 45000.00
    }
  ],
  "subtotal": 45000.00,
  "shipping_cost": null,
  "total": 45000.00,
  "currency": "ARS",
  "expires_at": "2026-10-30T18:00:00.000Z",
  "created_at": "2026-10-28T18:00:00.000Z"
}
```

**Valores de `status`:**

| Valor | Significado |
|---|---|
| `pendiente` | Creado, esperando pago |
| `pagado` | Pago confirmado |
| `enviado` | En camino |
| `entregado` | Entregado al cliente |
| `cancelado` | Cancelado (por la tienda, el cliente o por vencimiento) |

**Valores de `payment_status`:**

| Valor | Significado |
|---|---|
| `pendiente` | Aún no se recibió confirmación de pago |
| `aprobado` | Pago aprobado por la pasarela |
| `rechazado` | Pago rechazado por la pasarela |
| `vencido` | El pedido expiró sin pago |
| `null` | No aplica (ej.: pedido cancelado antes de cualquier intento de pago) |

#### Errores

| Código | Causa |
|---|---|
| `401` | Clave ausente, inválida o revocada |
| `404` | Token no encontrado o pertenece a otra tienda |

---

### 3.3 POST /api/store/orders/{id}/paid — Registrar pago

Marca un pedido como pagado después de que la pasarela de pago confirma la transacción. El `id` en la URL es el UUID interno del pedido retornado por el endpoint de creación (no el `public_token`).

El monto enviado debe coincidir exactamente con el total del pedido.

**Idempotente:** si se envía el mismo `external_payment_id` para un pedido ya pagado, el endpoint responde con éxito sin duplicar el evento (`"idempotent": true`).

**Método y URL:**

```
POST https://tu-panel.example.com/api/store/orders/{id}/paid
```

**Parámetro de URL:**

| Parámetro | Tipo | Descripción |
|---|---|---|
| `id` | uuid | UUID interno del pedido (campo `id` de la respuesta 201) |

**Headers requeridos:**

```
Authorization: Bearer <clave_api>
Content-Type: application/json
```

#### Body

```json
{
  "provider": "string (requerido, máx. 50 chars) — ej.: \"mercadopago\", \"dlocalgo\"",
  "external_payment_id": "string (requerido, máx. 200 chars) — ID del pago en la pasarela",
  "amount": "number > 0 (requerido) — debe ser igual al total del pedido"
}
```

#### Respuesta exitosa — 200 OK

Primera confirmación:

```json
{ "status": "ok", "idempotent": false }
```

Llamada repetida con el mismo `external_payment_id` para un pedido ya pagado:

```json
{ "status": "ok", "idempotent": true }
```

#### Errores

| Código | Causa |
|---|---|
| `401` | Clave inválida o revocada |
| `404` | Pedido no encontrado o pertenece a otra tienda |
| `422` | Monto no coincide con el total del pedido, body inválido, o el pedido no está en estado `pendiente` |

---

### 3.4 POST /api/store/orders/{id}/cancel — Cancelar pedido

Cancela un pedido en estado `pendiente` y restituye el stock de todas las variantes. Solo se pueden cancelar pedidos en estado `pendiente`.

**Idempotente:** cancelar un pedido ya cancelado devuelve éxito sin error.

**Método y URL:**

```
POST https://tu-panel.example.com/api/store/orders/{id}/cancel
```

**Parámetro de URL:**

| Parámetro | Tipo | Descripción |
|---|---|---|
| `id` | uuid | UUID interno del pedido (campo `id` de la respuesta 201) |

**Headers requeridos:**

```
Authorization: Bearer <clave_api>
Content-Type: application/json
```

#### Body (opcional)

```json
{
  "reason": "string (opcional, máx. 500 chars)"
}
```

#### Respuesta exitosa — 200 OK

```json
{ "status": "ok" }
```

#### Errores

| Código | Causa |
|---|---|
| `401` | Clave inválida o revocada |
| `404` | Pedido no encontrado o pertenece a otra tienda |
| `422` | El pedido no está en estado `pendiente` (ej.: ya está `pagado` o `enviado`) |

---

## 4. Límites y reglas de negocio

### Vencimiento de pedidos

- Los pedidos tienen un `expires_at` (por defecto 48 h desde la creación; configurable con `expires_in_hours`).
- Al vencer, el pedido se cancela automáticamente y el stock se restituye.
- El `payment_status` se actualiza a `vencido` en pedidos expirados.
- El vencimiento se procesa de forma **oportunista**: se ejecuta en cada llamada a `storefront_create_order` y en cada carga de la lista de pedidos del panel. No hay un job de background dedicado.

### Stock

| Evento | Efecto sobre el stock |
|---|---|
| Creación del pedido | Se descuenta |
| Pago confirmado | Sin cambio (el stock ya fue descontado) |
| Cancelación del pedido | Se restituye |
| Vencimiento del pedido | Se restituye |

### Rate limit

- Máximo **3 pedidos pendientes** del mismo email o teléfono en una ventana de 24 h, por tienda.
- Aplica únicamente a pedidos con `source = 'tienda'` (creados vía esta API).
- Al superar el límite: `429 Too Many Requests`.

### Ítems por pedido

- Máximo **30 ítems distintos** por pedido.
- Máximo **20 unidades** por ítem (`quantity`).

### Precios

- Los precios del payload son ignorados. Siempre se usan los precios vigentes en la base de datos al momento de la creación.
- Si una variante no tiene precio propio, se usa el precio del producto padre.

### Número de pedido

- Auto-incremental por tienda, empieza en **1001**.
- Se muestra en el panel como `#1042`.

### Moneda

- Siempre `ARS`. Soporte multi-moneda está planificado para versiones futuras.

---

## 5. Variables de entorno

El backend del storefront necesita configurar las siguientes variables:

| Variable | Descripción | Ejemplo |
|---|---|---|
| `PANEL_URL` | URL base del panel (sin barra final) | `https://tu-panel.example.com` |
| `PANEL_API_KEY` | Clave de API completa generada en `/panel/integraciones` | `pdolive_a3f1c2e4...` |

**Importante:**

- `PANEL_API_KEY` **nunca** debe exponerse en el navegador ni en código cliente.
- No commitear estas variables al repositorio. Usar `.env.local` o el sistema de secrets del hosting.
- Verificar que el dominio en `PANEL_URL` sea accesible desde el servidor del storefront (sin restricciones de firewall o CORS para server-to-server).

---

## 6. Ejemplos de código

### 6.1 Crear un pedido

**curl:**

```bash
curl -X POST https://tu-panel.example.com/api/store/orders \
  -H "Authorization: Bearer $PANEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "customer": {
      "name": "Ana García",
      "email": "ana@example.com",
      "phone": "1123456789"
    },
    "delivery": {
      "method": "domicilio",
      "street": "Av. Rivadavia",
      "number": "1234",
      "city": "Buenos Aires",
      "province": "CABA",
      "postal_code": "1033",
      "shipping_cost": 1500
    },
    "items": [
      { "variant_id": "550e8400-e29b-41d4-a716-446655440000", "quantity": 1 }
    ],
    "customer_note": "Tocar timbre 3B",
    "expires_in_hours": 48
  }'
```

**PowerShell:**

```powershell
$body = @{
    customer = @{
        name  = "Ana García"
        email = "ana@example.com"
        phone = "1123456789"
    }
    delivery = @{
        method        = "domicilio"
        street        = "Av. Rivadavia"
        number        = "1234"
        city          = "Buenos Aires"
        province      = "CABA"
        postal_code   = "1033"
        shipping_cost = 1500
    }
    items = @(
        @{ variant_id = "550e8400-e29b-41d4-a716-446655440000"; quantity = 1 }
    )
    customer_note    = "Tocar timbre 3B"
    expires_in_hours = 48
} | ConvertTo-Json -Depth 5

$headers = @{
    Authorization  = "Bearer $env:PANEL_API_KEY"
    "Content-Type" = "application/json"
}

Invoke-RestMethod `
    -Method Post `
    -Uri "$env:PANEL_URL/api/store/orders" `
    -Headers $headers `
    -Body $body
```

---

### 6.2 Consultar un pedido

**curl:**

```bash
curl https://tu-panel.example.com/api/store/orders/a3f1c2e4b5d678901234567890abcdef \
  -H "Authorization: Bearer $PANEL_API_KEY"
```

**PowerShell:**

```powershell
$headers = @{ Authorization = "Bearer $env:PANEL_API_KEY" }

Invoke-RestMethod `
    -Method Get `
    -Uri "$env:PANEL_URL/api/store/orders/a3f1c2e4b5d678901234567890abcdef" `
    -Headers $headers
```

---

### 6.3 Registrar un pago

**curl:**

```bash
curl -X POST https://tu-panel.example.com/api/store/orders/550e8400-e29b-41d4-a716-446655440000/paid \
  -H "Authorization: Bearer $PANEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "mercadopago",
    "external_payment_id": "MP-1234567890",
    "amount": 46500.00
  }'
```

**PowerShell:**

```powershell
$orderId = "550e8400-e29b-41d4-a716-446655440000"

$body = @{
    provider            = "mercadopago"
    external_payment_id = "MP-1234567890"
    amount              = 46500.00
} | ConvertTo-Json

$headers = @{
    Authorization  = "Bearer $env:PANEL_API_KEY"
    "Content-Type" = "application/json"
}

Invoke-RestMethod `
    -Method Post `
    -Uri "$env:PANEL_URL/api/store/orders/$orderId/paid" `
    -Headers $headers `
    -Body $body
```

---

### 6.4 Cancelar un pedido

**curl:**

```bash
curl -X POST https://tu-panel.example.com/api/store/orders/550e8400-e29b-41d4-a716-446655440000/cancel \
  -H "Authorization: Bearer $PANEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "El cliente se arrepintió" }'
```

**PowerShell:**

```powershell
$orderId = "550e8400-e29b-41d4-a716-446655440000"

$body = @{ reason = "El cliente se arrepintió" } | ConvertTo-Json

$headers = @{
    Authorization  = "Bearer $env:PANEL_API_KEY"
    "Content-Type" = "application/json"
}

Invoke-RestMethod `
    -Method Post `
    -Uri "$env:PANEL_URL/api/store/orders/$orderId/cancel" `
    -Headers $headers `
    -Body $body
```

---

## 7. Referencia de errores

Todos los errores retornan JSON. La estructura exacta puede variar según la causa, pero siempre incluye información legible sobre el problema.

| Código HTTP | Nombre | Cuándo ocurre |
|---|---|---|
| `400 Bad Request` | Bad Request | Request malformado (ej.: JSON inválido en el body) |
| `401 Unauthorized` | Unauthorized | Header `Authorization` ausente, clave inválida o clave revocada |
| `404 Not Found` | Not Found | El recurso no existe o pertenece a otra tienda |
| `409 Conflict` | Conflict | Stock insuficiente para una o más variantes al crear el pedido |
| `422 Unprocessable Entity` | Unprocessable Entity | Error de validación: campo requerido ausente, tipo incorrecto, restricción de negocio violada (ej.: monto incorrecto, pedido no en estado `pendiente`) |
| `429 Too Many Requests` | Too Many Requests | Rate limit excedido: más de 3 pedidos pendientes del mismo email o teléfono en 24 h |
| `500 Internal Server Error` | Internal Server Error | Error inesperado del servidor. Reintentar con backoff exponencial |

### Ejemplo de respuesta de error 422

```json
{
  "error": "El campo delivery.postal_code es requerido cuando el método de entrega es domicilio."
}
```

### Ejemplo de respuesta de error 409 (stock insuficiente)

```json
{
  "error": "Stock insuficiente",
  "details": [
    {
      "variant_id": "550e8400-e29b-41d4-a716-446655440000",
      "requested": 5,
      "available": 2
    }
  ]
}
```

### Ejemplo de respuesta de error 401

```json
{
  "error": "API key inválida o revocada."
}
```

---

*Última actualización: octubre 2026.*
