-- Tests de la API pública de catálogo (public_product, public_products)
-- Framework: pgTAP
--
-- Ejecutar:
--   supabase db reset
--   supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(16);

-- ── Setup ─────────────────────────────────────────────────────────────────────
DO $setup$
DECLARE
  v_uid_h       CONSTANT uuid := '10000000-0000-0000-0000-000000000008';
  v_sid_h       CONSTANT uuid := '20000000-0000-0000-0000-000000000007';
  v_cat_h       CONSTANT uuid := '30000000-0000-0000-0007-000000000001';
  v_prod_single CONSTANT uuid := '40000000-0000-0000-0007-000000000001';
  v_prod_multi  CONSTANT uuid := '40000000-0000-0000-0007-000000000002';
  v_prod_draft  CONSTANT uuid := '40000000-0000-0000-0007-000000000003';
  v_var_s1      CONSTANT uuid := '50000000-0000-0000-0007-000000000001'; -- stock=5
  v_var_m1      CONSTANT uuid := '50000000-0000-0000-0007-000000000002'; -- stock=0
  v_var_m2      CONSTANT uuid := '50000000-0000-0000-0007-000000000003'; -- stock=3
  v_var_m3      CONSTANT uuid := '50000000-0000-0000-0007-000000000004'; -- stock=25
  v_var_d1      CONSTANT uuid := '50000000-0000-0000-0007-000000000005';
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_uid_h, 'owner_h@test.com')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.stores (id, name, slug)
  VALUES (v_sid_h, 'Tienda H', 'tienda-h')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.store_members (user_id, store_id, role)
  VALUES (v_uid_h, v_sid_h, 'owner')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.categories (id, store_id, name, slug)
  VALUES (v_cat_h, v_sid_h, 'Cat H', 'cat-h')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.products (id, store_id, name, slug, price, status, category_id)
  VALUES
    (v_prod_single, v_sid_h, 'Producto único',    'producto-unico', 1000.00, 'active', v_cat_h),
    (v_prod_multi,  v_sid_h, 'Producto variante', 'producto-multi',  500.00, 'active', v_cat_h),
    (v_prod_draft,  v_sid_h, 'Borrador',           'borrador',        100.00, 'draft',  v_cat_h)
  ON CONFLICT (id) DO NOTHING;

  -- Insertamos con pg_sleep(0) para controlar el orden de created_at (sin importar aquí,
  -- los tests no dependen del orden sino de valores distintos de max_quantity/in_stock).
  INSERT INTO public.product_variants (id, store_id, product_id, sku, stock, is_active)
  VALUES
    (v_var_s1, v_sid_h, v_prod_single, 'SKU-H-S1',  5,  true),
    (v_var_m1, v_sid_h, v_prod_multi,  'SKU-H-M1',  0,  true),
    (v_var_m2, v_sid_h, v_prod_multi,  'SKU-H-M2',  3,  true),
    (v_var_m3, v_sid_h, v_prod_multi,  'SKU-H-M3',  25, true),
    (v_var_d1, v_sid_h, v_prod_draft,  'SKU-H-D1',  10, true)
  ON CONFLICT (id) DO NOTHING;
END;
$setup$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Las funciones de catálogo son accesibles por anon (mismo rol que el frontend)
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-3: producto con una sola variante (stock=5)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT jsonb_array_length(variants)
   FROM public.public_product('tienda-h', 'producto-unico')),
  1,
  '1. producto único: una variante en el resultado'
);

SELECT is(
  (SELECT (variants->0->>'max_quantity')::integer
   FROM public.public_product('tienda-h', 'producto-unico')),
  5,
  '2. max_quantity = stock cuando stock <= 20 (stock=5 → max_quantity=5)'
);

SELECT is(
  (SELECT (variants->0->>'in_stock')::boolean
   FROM public.public_product('tienda-h', 'producto-unico')),
  true,
  '3. in_stock sigue presente y correcto (stock=5 → true)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4-8: producto con tres variantes (stock=0, 3, 25)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT jsonb_array_length(variants)
   FROM public.public_product('tienda-h', 'producto-multi')),
  3,
  '4. producto multi: tres variantes activas'
);

-- Variante con stock=0 → max_quantity=0, in_stock=false
SELECT is(
  (SELECT (v->>'max_quantity')::integer
   FROM public.public_product('tienda-h', 'producto-multi'),
        jsonb_array_elements(variants) AS v
   WHERE (v->>'in_stock')::boolean = false
   LIMIT 1),
  0,
  '5. max_quantity=0 para variante con stock=0'
);

SELECT is(
  (SELECT (v->>'in_stock')::boolean
   FROM public.public_product('tienda-h', 'producto-multi'),
        jsonb_array_elements(variants) AS v
   WHERE (v->>'max_quantity')::integer = 0
   LIMIT 1),
  false,
  '6. in_stock=false cuando stock=0 (backward compat)'
);

-- Variante con stock=3 → max_quantity=3
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.public_product('tienda-h', 'producto-multi'),
         jsonb_array_elements(variants) AS v
    WHERE (v->>'max_quantity')::integer = 3
  ),
  '7. max_quantity=3 para variante con stock=3'
);

-- Variante con stock=25 → max_quantity=20 (tope)
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.public_product('tienda-h', 'producto-multi'),
         jsonb_array_elements(variants) AS v
    WHERE (v->>'max_quantity')::integer = 20
  ),
  '8. max_quantity=20 (tope) para variante con stock=25'
);

-- El stock real no se expone
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.public_product('tienda-h', 'producto-multi'),
         jsonb_array_elements(variants) AS v
    WHERE v ? 'stock'
  ),
  '9. el stock real no está expuesto en las variantes del catálogo'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10-11: productos que no deben aparecer
-- ─────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::integer FROM public.public_product('tienda-h', 'borrador')),
  0,
  '10. producto draft no aparece en la API pública'
);

SELECT is(
  (SELECT count(*)::integer FROM public.public_product('tienda-h', 'inexistente')),
  0,
  '11. slug inexistente → resultado vacío sin error'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12-13: public_products (lista) — regresión in_stock y conteo
-- ─────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::integer FROM public.public_products('tienda-h')),
  2,
  '12. public_products retorna los 2 productos activos (draft excluido)'
);

SELECT ok(
  (SELECT bool_and(in_stock IS NOT NULL)
   FROM public.public_products('tienda-h')),
  '13. in_stock presente y no nulo en todos los resultados de public_products'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14-15: tienda inexistente → vacío en ambas funciones
-- ─────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::integer FROM public.public_product('tienda-no-existe', 'x')),
  0,
  '14. tienda inexistente en public_product → vacío'
);

SELECT is(
  (SELECT count(*)::integer FROM public.public_products('tienda-no-existe')),
  0,
  '15. tienda inexistente en public_products → vacío'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16: max_quantity presente en todas las variantes del producto multi
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(v ? 'max_quantity')
   FROM public.public_product('tienda-h', 'producto-multi'),
        jsonb_array_elements(variants) AS v),
  '16. max_quantity presente en cada variante del producto multi'
);

SELECT * FROM finish();
ROLLBACK;
