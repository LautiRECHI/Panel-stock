# CLAUDE.md — Panel de gestión multi-tienda

## Comandos
```bash
npm run dev      # servidor de desarrollo (Turbopack)
npm run build    # build de producción; debe terminar sin errores antes de cerrar una tarea
npm run lint     # ESLint (flat config, eslint.config.mjs)
```

Tests de aislamiento (pgTAP, requiere Supabase CLI):
```bash
npx supabase start
npx supabase db reset        # aplica las migraciones
npx supabase test db         # ejecuta supabase/tests/database/isolation.test.sql
```

## Contexto
Panel de administración multi-tenant para tiendas pequeñas y medianas de cualquier rubro (primer cliente: Punto de Oro, pádel). Cada tienda carga y gestiona sus productos, categorías, variantes, fotos y stock. Los frontends de cada tienda se desarrollan por separado y consumen los datos de este panel mediante una API pública de solo lectura.

Es un producto reutilizable: nada puede estar escrito pensando en un solo rubro o una sola tienda.

## Usuario final
Dueños de comercios sin conocimientos técnicos que cargan su mercadería ellos mismos, muchas veces desde el celular. La prioridad número uno es la simplicidad y la velocidad de carga. Ante la duda entre más funciones o menos fricción, gana menos fricción.

## Stack
- Next.js (App Router) + TypeScript estricto + Tailwind CSS
- Supabase: Postgres, Auth y Storage
- Migraciones SQL versionadas en supabase/migrations (Supabase CLI)
- Validación con Zod, formularios con React Hook Form
- Sin librerías de UI pesadas; componentes propios chicos, íconos con lucide-react
- npm como gestor de paquetes

### Versiones al 21/10/2026 (orientativas)
- Next.js 16.4.2, React 19.3.0
- Tailwind CSS 4 — configuración vía bloque `@theme` en `src/app/globals.css`; sin `tailwind.config.ts`
- @supabase/ssr 0.12.7, @supabase/supabase-js 2.118.0
- Zod 4.6.7 — la API cambió: usar `.issues[0].message`, no `.errors[0].message`
- lucide-react 1.61.0

### Next.js 16 — diferencias clave
- El middleware se llama `src/proxy.ts` y exporta `proxy` (no `middleware`).
- `cacheComponents: true` está activo en `next.config.ts`. Todo layout o page que lea usuario o datos de tienda debe llamar `await connection()` (de `next/server`) como **primera línea**, antes de usar Supabase, para señalar renderizado dinámico. Alternativa: mover la lectura de datos a un componente async dentro de `<Suspense>`. Nunca usar `"use cache"` con datos de usuario.
- Tipos de props globales (generados en `.next/types/routes.d.ts`): `PageProps<"/ruta">` para pages y `LayoutProps<"/ruta">` para layouts.

## Seguridad (innegociable)
1. Toda tabla con datos de tienda tiene columna store_id NOT NULL y Row Level Security activado. Una tabla sin RLS no se crea.
2. El aislamiento entre tiendas se garantiza en la base de datos, nunca solo en el código de la aplicación.
3. Prohibido usar la service role key en código que corra en el navegador. Las claves viven solo en .env.local y variables de entorno del hosting, nunca en el repo. Mantener .env.example sin valores.
4. Todo input se valida en el servidor con Zod, aunque ya se haya validado en el cliente.
5. Las imágenes se guardan en Storage con la ruta {store_id}/..., con políticas que impidan escribir o borrar fuera de la propia carpeta.
6. Cada cambio de esquema incluye tests de aislamiento: un usuario de la tienda A no puede leer, crear, editar ni borrar nada de la tienda B.
7. Roles por tienda: owner y staff. Solo owner gestiona miembros y configuración de la tienda.
8. Nunca loguear datos personales ni tokens.

## Modelo de datos
- stores: id, name, slug (único), contacto, accent_color, y campos fiscales opcionales (cuit, tax_condition) reservados para facturación futura. No se implementa nada fiscal por ahora.
- store_members: user_id, store_id, role.
- categories: store_id, parent_id (nullable), name, slug, position. Categoría y subcategoría son la misma tabla (árbol libre), porque cada rubro tiene su propia estructura.
- products: store_id, name, slug, description, brand, price numeric(12,2), vat_rate opcional, status (draft, active, archived), category_id.
- product_variants: store_id, product_id, sku, atributos flexibles (jsonb: talle, color, etc.), price opcional (si es null usa el del producto), stock integer >= 0.
- product_images: store_id, product_id, path, position.
- stock_movements: store_id, variant_id, delta, reason, user_id, created_at. Todo cambio de stock deja registro.
- Slugs únicos por tienda, no globales.
- Borrado lógico (archived) para productos; no se borran filas con historial de stock.

## Convenciones de UI
- Todo el texto en español rioplatense (voseo).
- Mobile first. Tocar objetivos de al menos 44px.
- Estados vacíos que guíen la acción, mensajes de error claros, confirmación antes de acciones destructivas.
- Edición rápida de precio y stock directamente en la tabla de productos.
- Formularios cortos: lo esencial visible, lo avanzado en secciones desplegables.
- Accesibilidad básica: labels, foco visible, navegación con teclado.
- Diseño propio: inspirarse en el flujo de paneles como el de Hostinger, nunca copiar su diseño ni código.

## Diseño visual (referencia en docs/referencia/)
- Fuente: Inter (400, 500, 600, 700).
- Fondo de la app #F5F4F0, tarjetas blancas con borde #E4E2DB y radio 16px, texto #1A1A1A, texto secundario #6B6B66.
- Barra lateral oscura #161616, ítem activo #2A2A2A con ícono en el acento. Acento por defecto #E9B949.
- El acento es configurable por tienda (stores.accent_color). Nunca usarlo como color de texto sobre blanco: no contrasta.
- Botón primario: fondo #1A1A1A, texto blanco, radio 10px, alto 44px. Botón secundario: blanco con borde #D5D3CB.
- Estados de stock: En stock (fondo #E3F1E6, texto #1F6B35), Poco stock (#FBEFCF, #7A5600), Sin stock (#FBE3E0, #A12A1E). Poco stock = 3 unidades o menos (configurable por tienda más adelante).
- Todo lo tocable mide al menos 44px. Inputs de 44px de alto con radio 10px.
- Las pantallas de referencia son orientativas: respetar la estructura y el estilo, no el código.

## Convenciones de código
- TypeScript sin any. Tipos de base de datos generados con Supabase CLI.
- Lógica de acceso a datos en src/lib/, no dentro de los componentes.
- Componentes chicos, uno por archivo, PascalCase.
- Commits en español, formato tipo: descripción.
- Antes de dar algo por terminado: lint, build y tests sin errores.

## Cómo trabajar conmigo
- Si algo es ambiguo, proponé una opción y avisá qué asumiste.
- No instalar dependencias nuevas sin mencionarlo.
- Ante cualquier cambio de esquema o políticas RLS, explicá qué cambia y por qué antes de aplicarlo.
- No inventar datos reales de clientes; los seeds son claramente de ejemplo.

## Roadmap
1. Base: proyecto, esquema, RLS, login y alta de tienda
2. Componentes base y categorías con árbol
3. Productos con variantes, fotos y stock
4. API pública de lectura para frontends
5. Conexión con el frontend de Punto de Oro
6. Carga masiva por CSV, alertas de stock bajo, pulido