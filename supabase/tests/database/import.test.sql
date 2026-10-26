-- Tests de la función import_products
-- Framework: pgTAP
--
-- Cómo correr:
--   supabase start
--   supabase db reset        # aplica las migraciones
--   supabase test db         # ejecuta todos los archivos en tests/database/
--
-- Nota: estos tests corren en la misma sesión de base de datos que isolation.test.sql,
-- pero cada archivo corre en su propia transacción (ROLLBACK al final).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);  -- total de assertions en este archivo

-- ── Setup ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_uid_i  CONSTANT uuid := '10000000-0000-0000-0000-000000000010';
  v_uid_j  CONSTANT uuid := '10000000-0000-0000-0000-000000000011';
  v_sid_i  CONSTANT uuid := '20000000-0000-0000-0000-000000000010';
  v_sid_j  CONSTANT uuid := '20000000-0000-0000-0000-000000000011';
BEGIN
  -- Usuarios
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current
  )
  VALUES
    (v_uid_i, 'authenticated', 'authenticated',
     'importador_i@test.local', crypt('pass_i', gen_salt('bf')),
     now(), '{}', '{}', now(), now(), '', '', '', ''),
    (v_uid_j, 'authenticated', 'authenticated',
     'importador_j@test.local', crypt('pass_j', gen_salt('bf')),
     now(), '{}', '{}', now(), now(), '', '', '', '')
  ON CONFLICT (id) DO NOTHING;

  -- Tiendas
  INSERT INTO public.stores (id, name, slug)
  VALUES
    (v_sid_i, 'Tienda Import I', 'tienda-import-i'),
    (v_sid_j, 'Tienda Import J', 'tienda-import-j')
  ON CONFLICT (id) DO NOTHING;

  -- Membresías
  INSERT INTO public.store_members (user_id, store_id, role)
  VALUES
    (v_uid_i, v_sid_i, 'owner'),
    (v_uid_j, v_sid_j, 'owner')
  ON CONFLICT DO NOTHING;
END;
$$;

-- ── Constantes reutilizables ──────────────────────────────────────────────────
-- Producto de prueba sin variantes
\set PROD_SIMPLE '[{"nombre":"Pelota Test","slug":"pelota-test","categoria_name":"Accesorios","categoria_slug":"accesorios","subcategoria_name":"","subcategoria_slug":"","marca":"Test","descripcion":"Desc","precio":1500,"estado":"active","variantes":[{"sku":"PLT-001","opcion":"","valor":"","stock":5}]}]'

-- Producto de prueba con variantes
\set PROD_VARS '[{"nombre":"Paleta Vars","slug":"paleta-vars","categoria_name":"Paletas","categoria_slug":"paletas","subcategoria_name":"BullpadTest","subcategoria_slug":"bullpadtest","marca":"Bull","descripcion":"","precio":10000,"estado":"active","variantes":[{"sku":"PAL-M","opcion":"Talle","valor":"M","stock":3},{"sku":"PAL-L","opcion":"Talle","valor":"L","stock":2}]}]'

-- ── Autenticado como Usuario I ────────────────────────────────────────────────
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000010","role":"authenticated"}';

-- 1. import_products crea un producto simple (sin variantes)
SELECT lives_ok(
  $$SELECT public.import_products('[{"nombre":"Pelota Test","slug":"pelota-test","categoria_name":"Accesorios","categoria_slug":"accesorios","subcategoria_name":"","subcategoria_slug":"","marca":"Test","descripcion":"Desc","precio":1500,"estado":"active","variantes":[{"sku":"PLT-001","opcion":"","valor":"","stock":5}]}]'::jsonb)$$,
  '1. import_products crea un producto simple'
);

-- 2. El producto existe en la tabla products
SELECT ok(
  (SELECT count(*) = 1 FROM public.products
   WHERE slug = 'pelota-test'
     AND store_id = '20000000-0000-0000-0000-000000000010'),
  '2. El producto simple existe en products'
);

-- 3. La variante por defecto existe con stock correcto
SELECT ok(
  (SELECT count(*) = 1 FROM public.product_variants
   WHERE sku = 'PLT-001'
     AND store_id = '20000000-0000-0000-0000-000000000010'
     AND attributes = '{}'
     AND stock = 5
     AND is_active = true),
  '3. Variante por defecto existe con stock=5 y is_active=true'
);

-- 4. El stock inicial genera movimiento con motivo Importación
SELECT ok(
  (SELECT count(*) >= 1 FROM public.stock_movements sm
   JOIN public.product_variants pv ON pv.id = sm.variant_id
   WHERE pv.sku = 'PLT-001'
     AND pv.store_id = '20000000-0000-0000-0000-000000000010'
     AND sm.reason = 'Importación'
     AND sm.delta = 5),
  '4. Stock inicial genera stock_movement con motivo Importación'
);

-- 5. La categoría "Accesorios" se creó automáticamente
SELECT ok(
  (SELECT count(*) = 1 FROM public.categories
   WHERE store_id = '20000000-0000-0000-0000-000000000010'
     AND slug = 'accesorios'
     AND parent_id IS NULL),
  '5. La categoría raíz se crea automáticamente'
);

-- 6. import_products crea un producto con variantes
SELECT lives_ok(
  $$SELECT public.import_products('[{"nombre":"Paleta Vars","slug":"paleta-vars","categoria_name":"Paletas","categoria_slug":"paletas","subcategoria_name":"BullpadTest","subcategoria_slug":"bullpadtest","marca":"Bull","descripcion":"","precio":10000,"estado":"active","variantes":[{"sku":"PAL-M","opcion":"Talle","valor":"M","stock":3},{"sku":"PAL-L","opcion":"Talle","valor":"L","stock":2}]}]'::jsonb)$$,
  '6. import_products crea un producto con variantes'
);

-- 7. Las variantes reales existen con atributos correctos
SELECT ok(
  (SELECT count(*) = 2 FROM public.product_variants pv
   JOIN public.products p ON p.id = pv.product_id
   WHERE p.slug = 'paleta-vars'
     AND pv.store_id = '20000000-0000-0000-0000-000000000010'
     AND pv.is_active = true
     AND pv.attributes != '{}'),
  '7. Las dos variantes reales están activas'
);

-- 8. La subcategoría se creó bajo la categoría raíz
SELECT ok(
  (SELECT count(*) = 1 FROM public.categories sub
   JOIN public.categories root ON root.id = sub.parent_id
   WHERE sub.store_id = '20000000-0000-0000-0000-000000000010'
     AND sub.slug = 'bullpadtest'
     AND root.slug = 'paletas'),
  '8. La subcategoría existe bajo la categoría raíz'
);

-- 9. Segunda importación del mismo lote: el producto ya existe → salteado
SELECT ok(
  (SELECT (public.import_products(
    '[{"nombre":"Pelota Test","slug":"pelota-test","categoria_name":"Accesorios","categoria_slug":"accesorios","subcategoria_name":"","subcategoria_slug":"","marca":"Test","descripcion":"","precio":1500,"estado":"active","variantes":[{"sku":"PLT-001B","opcion":"","valor":"","stock":5}]}]'::jsonb
  ) -> 'salteados')::jsonb != '[]'::jsonb),
  '9. Segunda importación del mismo slug → salteado (no duplica)'
);

-- 10. El producto no se duplicó
SELECT ok(
  (SELECT count(*) = 1 FROM public.products
   WHERE slug = 'pelota-test'
     AND store_id = '20000000-0000-0000-0000-000000000010'),
  '10. El producto no se duplicó tras una segunda importación'
);

-- 11. Un producto con error (precio inválido a nivel SQL → error) no impide los demás
-- Forzamos un error pasando un estado inválido para uno de dos productos
SELECT ok(
  (
    SELECT jsonb_array_length(
      public.import_products(
        '[
          {"nombre":"Error Prod","slug":"error-prod","categoria_name":"Cat","categoria_slug":"cat","subcategoria_name":"","subcategoria_slug":"","marca":"","descripcion":"","precio":-1,"estado":"active","variantes":[{"sku":"ERR-001","opcion":"","valor":"","stock":0}]},
          {"nombre":"OK Prod","slug":"ok-prod","categoria_name":"Cat","categoria_slug":"cat","subcategoria_name":"","subcategoria_slug":"","marca":"","descripcion":"","precio":500,"estado":"active","variantes":[{"sku":"OK-001","opcion":"","valor":"","stock":1}]}
        ]'::jsonb
      ) -> 'creados'
    ) >= 1
  ),
  '11. Un producto con error no impide los demás del lote'
);

-- 12. La categoría/subcategoría nueva se crea una sola vez aunque aparezca en muchas filas
SELECT lives_ok(
  $$SELECT public.import_products(
    '[
      {"nombre":"Prod Cat A","slug":"prod-cat-a","categoria_name":"CatUnica","categoria_slug":"cat-unica","subcategoria_name":"SubUnica","subcategoria_slug":"sub-unica","marca":"","descripcion":"","precio":100,"estado":"active","variantes":[{"sku":"CAU-001","opcion":"","valor":"","stock":0}]},
      {"nombre":"Prod Cat B","slug":"prod-cat-b","categoria_name":"CatUnica","categoria_slug":"cat-unica","subcategoria_name":"SubUnica","subcategoria_slug":"sub-unica","marca":"","descripcion":"","precio":200,"estado":"active","variantes":[{"sku":"CAU-002","opcion":"","valor":"","stock":0}]}
    ]'::jsonb
  )$$,
  '12. Dos productos con misma categoría/subcategoría nueva no la duplican'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.categories
   WHERE store_id = '20000000-0000-0000-0000-000000000010'
     AND slug = 'cat-unica'
     AND parent_id IS NULL),
  '13. La categoría compartida se creó exactamente una vez'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.categories
   WHERE store_id = '20000000-0000-0000-0000-000000000010'
     AND slug = 'sub-unica'),
  '14. La subcategoría compartida se creó exactamente una vez'
);

-- 15. Anon no puede ejecutar import_products
SET LOCAL role TO anon;
SELECT throws_ok(
  $$SELECT public.import_products('[]'::jsonb)$$,
  '42501', NULL,
  '15. Anon no puede ejecutar import_products (42501)'
);

-- ── Aislamiento de tienda: usuario J no puede importar en tienda I ─────────────
-- import_products resuelve el store_id de la sesión (no acepta store_id externo)
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000011","role":"authenticated"}';

-- 16. Usuario J importa un producto que va a SU tienda (no a la tienda I)
SELECT lives_ok(
  $$SELECT public.import_products(
    '[{"nombre":"Prod J","slug":"prod-j","categoria_name":"CatJ","categoria_slug":"cat-j","subcategoria_name":"","subcategoria_slug":"","marca":"","descripcion":"","precio":999,"estado":"active","variantes":[{"sku":"PRODJ-001","opcion":"","valor":"","stock":2}]}]'::jsonb
  )$$,
  '16. Usuario J importa en su propia tienda'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.products
   WHERE slug = 'prod-j'
     AND store_id = '20000000-0000-0000-0000-000000000010'),
  '17. El producto de J NO aparece en la tienda I (aislamiento correcto)'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.products
   WHERE slug = 'prod-j'
     AND store_id = '20000000-0000-0000-0000-000000000011'),
  '18. El producto de J sí existe en la tienda J'
);

SELECT * FROM finish();

ROLLBACK;
