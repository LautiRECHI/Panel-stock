# PENDIENTES

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
