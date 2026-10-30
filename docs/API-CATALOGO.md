# API Catálogo — Contrato de integración

API pública de solo lectura para que los frontends de tienda consulten el catálogo de productos.

**URL base:**

```
https://tu-panel.example.com/api/v1/{store_slug}
```

---

## Índice

1. [Descripción general](#1-descripción-general)
2. [Autenticación](#2-autenticación)
3. [Rutas](#3-rutas)
   - [GET /api/v1/{store_slug}/store — Datos de la tienda](#31-get-apiv1store_slugstore)
   - [GET /api/v1/{store_slug}/categories — Árbol de categorías](#32-get-apiv1store_slugcategories)
   - [GET /api/v1/{store_slug}/products — Listado de productos](#33-get-apiv1store_slugproducts)
   - [GET /api/v1/{store_slug}/products/{product_slug} — Detalle de producto](#34-get-apiv1store_slugproductsproduct_slug)
4. [Campo max_quantity](#4-campo-max_quantity)
5. [Variables de entorno](#5-variables-de-entorno)

---

## 1. Descripción general

Esta API es pública, de solo lectura y no requiere autenticación. Está diseñada para ser consumida directamente desde el frontend de la tienda (browser o SSR).

Todos los endpoints:
- Soportan CORS.
- Retornan `application/json`.
- Devuelven `null` o `[]` para tiendas o productos inexistentes (sin error revelador).
- Solo exponen productos en estado `active`; drafts y archivados son invisibles.

---

## 2. Autenticación

Ninguna. La API es pública.

---

## 3. Rutas

### 3.1 GET /api/v1/{store_slug}/store

Retorna los datos públicos de la tienda.

**Respuesta 200:**

```json
{
  "name": "Punto de Oro",
  "slug": "punto-de-oro",
  "accent_color": "#E9B949"
}
```

**Respuesta 404:** `null` si la tienda no existe.

---

### 3.2 GET /api/v1/{store_slug}/categories

Retorna todas las categorías de la tienda en orden de posición.

**Respuesta 200:**

```json
[
  { "id": "uuid", "parent_id": null, "name": "Paletas", "slug": "paletas", "position": 1 },
  { "id": "uuid", "parent_id": "uuid-padre", "name": "Overgrips", "slug": "overgrips", "position": 2 }
]
```

---

### 3.3 GET /api/v1/{store_slug}/products

Retorna el listado paginado de productos activos.

**Query params:**

| Parámetro          | Tipo    | Por defecto | Descripción                        |
|--------------------|---------|-------------|-------------------------------------|
| `category`         | string  | —           | Slug de categoría                   |
| `subcategory`      | string  | —           | Slug de subcategoría (requiere `category`) |
| `q`                | string  | —           | Búsqueda por nombre o marca         |
| `limit`            | integer | 24          | Máx. 60                             |
| `offset`           | integer | 0           | —                                   |

**Respuesta 200:**

```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Paleta Pro 3",
      "slug": "paleta-pro-3",
      "brand": "Bull Padel",
      "price_from": 85000,
      "is_price_from": true,
      "category_slug": "paletas",
      "subcategory_slug": null,
      "cover_url": "https://…/storage/v1/object/public/product-images/…",
      "in_stock": true
    }
  ],
  "total": 42,
  "limit": 24,
  "offset": 0
}
```

> `cover_url` es la URL pública de la imagen de portada. `cover_path` no se incluye en la respuesta.

---

### 3.4 GET /api/v1/{store_slug}/products/{product_slug}

Retorna el detalle de un producto activo con todas sus imágenes y variantes.

**Respuesta 200:**

```json
{
  "id": "uuid",
  "name": "Paleta Pro 3",
  "slug": "paleta-pro-3",
  "description": "Paleta de nivel avanzado…",
  "brand": "Bull Padel",
  "price": 85000,
  "images": [
    {
      "path": "store-id/product-id/foto1.jpg",
      "url": "https://…/storage/v1/object/public/product-images/…"
    }
  ],
  "variants": [
    {
      "id": "uuid",
      "attributes": { "color": "Negro" },
      "price": null,
      "in_stock": true,
      "max_quantity": 5
    },
    {
      "id": "uuid",
      "attributes": { "color": "Blanco" },
      "price": 90000,
      "in_stock": false,
      "max_quantity": 0
    }
  ]
}
```

**Respuesta 404:** `null` si el producto no existe o es draft/archivado.

#### Campos de variante

| Campo          | Tipo          | Descripción                                                    |
|----------------|---------------|----------------------------------------------------------------|
| `id`           | uuid          | ID de la variante                                              |
| `attributes`   | object        | Atributos libres (color, talle, etc.)                          |
| `price`        | number\|null  | Precio específico de la variante; `null` usa el precio base    |
| `in_stock`     | boolean       | `true` si hay al menos 1 unidad disponible                     |
| `max_quantity` | integer       | Máximo que el carrito puede pedir: `min(stock, 20)`. Ver §4.   |

---

## 4. Campo max_quantity

`max_quantity` indica cuántas unidades puede agregar al carrito un comprador para esa variante específica.

**Regla:** `max_quantity = min(stock_disponible, 20)`

- El tope de 20 coincide con el límite máximo por variante al procesar un pedido en la API de tienda. Esto evita que el frontend permita cantidades que el backend rechazaría.
- Cuando `max_quantity = 0`, la variante está sin stock (`in_stock = false`).
- El stock real nunca se expone en la API pública.

**Ejemplo de uso en el frontend:**

```ts
// Deshabilitar el botón de agregar al carrito
const isDisabled = variant.max_quantity === 0

// Limitar el selector de cantidad
const maxQty = variant.max_quantity  // ya está acotado a 20
```

---

## 5. Variables de entorno

Solo es necesario `NEXT_PUBLIC_SUPABASE_URL` para construir las URLs de imágenes. No se requiere ninguna clave de API para consumir el catálogo.

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
```
