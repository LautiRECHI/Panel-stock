# Tests

## Test e2e del importador (`e2e-import.mjs`)

Importa el archivo Excel real de Punto de Oro contra la base local, verifica
los totales y borra todo al final. No toca producción.

### Requisitos previos

```bash
npx supabase start
npx supabase db reset
```

### Variables de entorno

Creá el archivo `tests/.env.test.local` (ignorado por git):

```
SUPABASE_LOCAL_URL=http://127.0.0.1:54321
SUPABASE_LOCAL_ANON_KEY=<ANON_KEY>
SUPABASE_LOCAL_SERVICE_KEY=<SERVICE_ROLE_KEY>
IMPORT_EXCEL_PATH=<ruta al .xlsx>
```

Para obtener las claves:

```bash
npx supabase status
```

Copiá los campos `ANON_KEY` y `SERVICE_ROLE_KEY` de la salida.

### Ejecución

```bash
node tests/e2e-import.mjs
```

### Resultado esperado (archivo Punto de Oro)

| Verificación | Valor |
|---|---|
| Productos creados | 556 |
| Variantes activas | 1 109 |
| Borradores | 111 |
| Stock total | 636 |
| Subcategorías | 43 |
| 2ª importación creados | 0 |
| 2ª importación salteados | 556 |

---

## Tests de aislamiento entre tiendas

Estos tests verifican que el RLS y los triggers de integridad funcionan correctamente:
un usuario de la tienda A no puede leer, insertar, actualizar ni borrar datos de la tienda B
en ninguna tabla, ni subir archivos a su carpeta en Storage.

## Requisito previo

[Supabase CLI](https://supabase.com/docs/guides/cli) instalado y configurado.

### Instalación del CLI (Windows)

```powershell
winget install Supabase.CLI
# o con scoop:
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

## Opción A: Supabase local (recomendada)

1. Iniciá el entorno local:

```bash
supabase start
```

2. Aplicá las migraciones:

```bash
supabase db reset
```

3. Corré los tests:

```bash
supabase test db
```

El CLI busca automáticamente los archivos `*.test.sql` en `supabase/tests/` y subcarpetas.
El archivo de tests está en `supabase/tests/database/isolation.test.sql`.

## Opción B: psql directo

```bash
psql "$DATABASE_URL" -f supabase/tests/database/isolation.test.sql
```

> **Nota:** los tests hacen `ROLLBACK` al final, no dejan datos en la base.

## Resultado esperado

```
1..55
ok 1 - Usuario A puede ver Tienda A
ok 2 - Usuario A NO puede ver Tienda B
...
ok 55 - Borrar el único owner directamente sigue fallando (protect_last_owner intacto)
```

Si algún test falla verás `not ok N - descripción`. En ese caso revisá la migración
correspondiente según el número de test.

## Estructura de los tests

| Tests  | Qué verifican |
|--------|---------------|
| 1–15   | Usuario A: acceso solo a su tienda, no a la B |
| 16–26  | Usuario B: acceso solo a su tienda, no a la A |
| 27–31  | Anónimo: no puede ver ningún dato |
| 32–35  | FK compuestas e inmutabilidad de store_id (sin RLS) |
| 36–37  | Protección del último owner |
| 38–42  | `is_store_member_text` para Storage (rutas inválidas, ajenas, propias) |
| 43     | FK NO ACTION: no se puede borrar producto con historial de stock |
| 44     | Storage: usuario A no ve objetos de carpeta de tienda B |
| 45–47  | FK SET NULL parcial: solo category_id / parent_id quedan NULL |
| 48–51  | Trigger de auditoría de stock (INSERT y UPDATE generan movimientos) |
| 52     | CHECK en product_images: path debe empezar con store_id propio |
| 53     | store_members: user_id y store_id son inmutables |
| 54–55  | Cascada desde stores con único owner (bypass + protección directa intacta) |
