# PENDIENTES

## Para decidir más adelante

- `resolveStoreId()` en las acciones de categorías asume que el usuario tiene una sola tienda (hace `SELECT id FROM stores LIMIT 1` filtrado por RLS). Es correcto hoy porque el onboarding crea una sola tienda por usuario. El día que una persona administre varias tiendas (por ejemplo como admin de varios clientes), ese `LIMIT 1` va a tomar una tienda arbitraria. Antes de soportar multi-tienda por usuario hay que agregar selector de tienda activa (en sesión o en la URL) y que `resolveStoreId()` lo use en lugar de `LIMIT 1`.
