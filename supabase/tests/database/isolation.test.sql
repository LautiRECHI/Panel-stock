-- Tests de aislamiento entre tiendas
-- Framework: pgTAP (https://pgtap.org/)
--
-- Cómo correr (requiere Supabase CLI):
--   supabase start
--   supabase db reset      # aplica las migraciones
--   supabase test db       # ejecuta este archivo automáticamente
--
-- O directamente con psql:
--   psql "$DATABASE_URL" -f supabase/tests/database/isolation.test.sql
--
-- Nota: pgTAP debe estar habilitado (disponible por defecto en Supabase local).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(85);   -- total de assertions

-- =====================
-- Setup: dos tiendas, dos usuarios, datos de ejemplo
-- =====================
DO $$
DECLARE
  v_uid_a  CONSTANT uuid := '10000000-0000-0000-0000-000000000001';
  v_uid_b  CONSTANT uuid := '10000000-0000-0000-0000-000000000002';
  v_sid_a  CONSTANT uuid := '20000000-0000-0000-0000-000000000001';
  v_sid_b  CONSTANT uuid := '20000000-0000-0000-0000-000000000002';
BEGIN
  -- Usuarios de prueba en auth.users
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current
  )
  VALUES
    (v_uid_a, 'authenticated', 'authenticated',
     'usuario_a@test.local', crypt('pass_a', gen_salt('bf')),
     now(), '{}', '{}', now(), now(), '', '', '', ''),
    (v_uid_b, 'authenticated', 'authenticated',
     'usuario_b@test.local', crypt('pass_b', gen_salt('bf')),
     now(), '{}', '{}', now(), now(), '', '', '', '')
  ON CONFLICT (id) DO NOTHING;

  -- Tiendas (postgres bypasses RLS)
  INSERT INTO public.stores (id, name, slug)
  VALUES (v_sid_a, 'Tienda A', 'tienda-a'),
         (v_sid_b, 'Tienda B', 'tienda-b')
  ON CONFLICT (id) DO NOTHING;

  -- Membresías
  INSERT INTO public.store_members (user_id, store_id, role)
  VALUES (v_uid_a, v_sid_a, 'owner'),
         (v_uid_b, v_sid_b, 'owner')
  ON CONFLICT DO NOTHING;

  -- Categorías de cada tienda
  INSERT INTO public.categories (id, store_id, name, slug)
  VALUES
    ('30000000-0000-0000-0001-000000000001', v_sid_a, 'Cat A', 'cat-a'),
    ('30000000-0000-0000-0002-000000000001', v_sid_b, 'Cat B', 'cat-b')
  ON CONFLICT (id) DO NOTHING;

  -- Productos
  INSERT INTO public.products (id, store_id, name, slug, price, status)
  VALUES
    ('40000000-0000-0000-0001-000000000001', v_sid_a, 'Producto A', 'producto-a', 100, 'active'),
    ('40000000-0000-0000-0002-000000000001', v_sid_b, 'Producto B', 'producto-b', 200, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Variantes (el trigger product_variants_stock_audit crea los movimientos iniciales)
  INSERT INTO public.product_variants (id, store_id, product_id, sku, stock)
  VALUES
    ('50000000-0000-0000-0001-000000000001', v_sid_a,
     '40000000-0000-0000-0001-000000000001', 'SKU-A-001', 10),
    ('50000000-0000-0000-0002-000000000001', v_sid_b,
     '40000000-0000-0000-0002-000000000001', 'SKU-B-001', 20)
  ON CONFLICT (id) DO NOTHING;

  -- Objeto de Storage en carpeta de Tienda B (usado en test 44)
  INSERT INTO storage.objects (id, bucket_id, name)
  VALUES (
    '70000000-0000-0000-0002-000000000001',
    'product-images',
    '20000000-0000-0000-0000-000000000002/foto-b.jpg'
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- =====================
-- PARTE 1 — Usuario A (tests 1-15)
-- =====================
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT ok(
  (SELECT count(*) = 1 FROM public.stores
   WHERE id = '20000000-0000-0000-0000-000000000001'),
  '1. Usuario A puede ver Tienda A'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.stores
   WHERE id = '20000000-0000-0000-0000-000000000002'),
  '2. Usuario A NO puede ver Tienda B'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.store_members
   WHERE store_id = '20000000-0000-0000-0000-000000000001'),
  '3. Usuario A puede ver miembros de Tienda A'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.store_members
   WHERE store_id = '20000000-0000-0000-0000-000000000002'),
  '4. Usuario A NO puede ver miembros de Tienda B'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.products
   WHERE store_id = '20000000-0000-0000-0000-000000000001'),
  '5. Usuario A puede ver productos de Tienda A'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.products
   WHERE store_id = '20000000-0000-0000-0000-000000000002'),
  '6. Usuario A NO puede ver productos de Tienda B'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.product_variants
   WHERE store_id = '20000000-0000-0000-0000-000000000001'),
  '7. Usuario A puede ver variantes de Tienda A'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.product_variants
   WHERE store_id = '20000000-0000-0000-0000-000000000002'),
  '8. Usuario A NO puede ver variantes de Tienda B'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.categories
   WHERE store_id = '20000000-0000-0000-0000-000000000002'),
  '9. Usuario A NO puede ver categorías de Tienda B'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.product_images
   WHERE store_id = '20000000-0000-0000-0000-000000000002'),
  '10. Usuario A NO puede ver imágenes de Tienda B'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.stock_movements
   WHERE store_id = '20000000-0000-0000-0000-000000000002'),
  '11. Usuario A NO puede ver movimientos de Tienda B'
);

SELECT throws_ok(
  $$INSERT INTO public.products (store_id, name, slug, price)
    VALUES ('20000000-0000-0000-0000-000000000002', 'Intruso', 'intruso', 1)$$,
  '42501', NULL,
  '12. Usuario A NO puede insertar producto en Tienda B (RLS)'
);

SELECT results_eq(
  $$UPDATE public.stores SET name = 'Hackeada'
    WHERE id = '20000000-0000-0000-0000-000000000002' RETURNING id$$,
  $$SELECT NULL::uuid LIMIT 0$$,
  '13. UPDATE en Tienda B retorna 0 filas para Usuario A'
);

SELECT results_eq(
  $$DELETE FROM public.products
    WHERE id = '40000000-0000-0000-0002-000000000001' RETURNING id$$,
  $$SELECT NULL::uuid LIMIT 0$$,
  '14. DELETE en producto de Tienda B retorna 0 filas para Usuario A'
);

SELECT throws_ok(
  $$INSERT INTO public.product_variants
    (store_id, product_id, sku, stock)
    VALUES ('20000000-0000-0000-0000-000000000002',
            '40000000-0000-0000-0002-000000000001', 'HACK', 1)$$,
  '42501', NULL,
  '15. Usuario A NO puede insertar variante en Tienda B (RLS)'
);

-- =====================
-- PARTE 2 — Usuario B (tests 16-26)
-- =====================
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT ok(
  (SELECT count(*) = 1 FROM public.stores
   WHERE id = '20000000-0000-0000-0000-000000000002'),
  '16. Usuario B puede ver Tienda B'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.stores
   WHERE id = '20000000-0000-0000-0000-000000000001'),
  '17. Usuario B NO puede ver Tienda A'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.products
   WHERE store_id = '20000000-0000-0000-0000-000000000002'),
  '18. Usuario B puede ver productos de Tienda B'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.products
   WHERE store_id = '20000000-0000-0000-0000-000000000001'),
  '19. Usuario B NO puede ver productos de Tienda A'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.product_variants
   WHERE store_id = '20000000-0000-0000-0000-000000000002'),
  '20. Usuario B puede ver variantes de Tienda B'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.product_variants
   WHERE store_id = '20000000-0000-0000-0000-000000000001'),
  '21. Usuario B NO puede ver variantes de Tienda A'
);

SELECT throws_ok(
  $$INSERT INTO public.products (store_id, name, slug, price)
    VALUES ('20000000-0000-0000-0000-000000000001', 'Intruso', 'intruso-b', 1)$$,
  '42501', NULL,
  '22. Usuario B NO puede insertar producto en Tienda A (RLS)'
);

SELECT results_eq(
  $$UPDATE public.stores SET name = 'Hackeada'
    WHERE id = '20000000-0000-0000-0000-000000000001' RETURNING id$$,
  $$SELECT NULL::uuid LIMIT 0$$,
  '23. UPDATE en Tienda A retorna 0 filas para Usuario B'
);

SELECT results_eq(
  $$DELETE FROM public.products
    WHERE id = '40000000-0000-0000-0001-000000000001' RETURNING id$$,
  $$SELECT NULL::uuid LIMIT 0$$,
  '24. DELETE en producto de Tienda A retorna 0 filas para Usuario B'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.store_members
   WHERE store_id = '20000000-0000-0000-0000-000000000001'),
  '25. Usuario B NO puede ver miembros de Tienda A'
);

SELECT ok(
  (SELECT count(*) = 0 FROM public.categories
   WHERE store_id = '20000000-0000-0000-0000-000000000001'),
  '26. Usuario B NO puede ver categorías de Tienda A'
);

-- =====================
-- PARTE 3 — Usuario anónimo (tests 27-31)
-- =====================
SET LOCAL role TO anon;

SELECT ok((SELECT count(*) = 0 FROM public.stores),          '27. Anon NO ve tiendas');
SELECT ok((SELECT count(*) = 0 FROM public.products),        '28. Anon NO ve productos');
SELECT ok((SELECT count(*) = 0 FROM public.product_variants),'29. Anon NO ve variantes');
SELECT ok((SELECT count(*) = 0 FROM public.product_images),  '30. Anon NO ve imágenes');
SELECT ok((SELECT count(*) = 0 FROM public.stock_movements), '31. Anon NO ve movimientos de stock');

-- =====================
-- PARTE 4 — FKs compuestas: integridad entre tiendas (tests 32-35)
-- Estos tests corren como postgres (sin RLS) para demostrar que la
-- protección existe a nivel de base de datos, independiente de RLS.
-- =====================
RESET role;

-- 32. No se puede asignar una categoría de Tienda B a un producto de Tienda A
SELECT throws_ok(
  $$INSERT INTO public.products (store_id, name, slug, price, category_id)
    VALUES (
      '20000000-0000-0000-0000-000000000001',  -- store A
      'FK Test', 'fk-test', 1,
      '30000000-0000-0000-0002-000000000001'   -- categoría de store B
    )$$,
  '23503', NULL,
  '32. FK compuesta: categoría de otra tienda falla (23503) aunque RLS esté off'
);

-- 33. No se puede asignar un producto de Tienda B como padre de variante de Tienda A
SELECT throws_ok(
  $$INSERT INTO public.product_variants (store_id, product_id, sku, stock)
    VALUES (
      '20000000-0000-0000-0000-000000000001',  -- store A
      '40000000-0000-0000-0002-000000000001',  -- producto de store B
      'FK-VARIANT-TEST', 0
    )$$,
  '23503', NULL,
  '33. FK compuesta: producto de otra tienda en variante falla (23503)'
);

-- 34. No se puede asignar una categoría de Tienda B como padre de categoría de Tienda A
SELECT throws_ok(
  $$INSERT INTO public.categories (store_id, name, slug, parent_id)
    VALUES (
      '20000000-0000-0000-0000-000000000001',  -- store A
      'Cat FK Test', 'cat-fk-test',
      '30000000-0000-0000-0002-000000000001'   -- padre de store B
    )$$,
  '23503', NULL,
  '34. FK compuesta: parent_id de otra tienda en categoría falla (23503)'
);

-- 35. Trigger prevent_store_id_change: store_id inmutable en UPDATE
SELECT throws_ok(
  $$UPDATE public.products
    SET store_id = '20000000-0000-0000-0000-000000000002'
    WHERE id = '40000000-0000-0000-0001-000000000001'$$,
  'P0001', NULL,
  '35. store_id no puede modificarse en UPDATE (trigger prevent_store_id_change)'
);

-- =====================
-- PARTE 5 — Protección del último owner (tests 36-37)
-- =====================

-- 36. Owner no puede eliminarse si es el único owner
SELECT throws_ok(
  $$DELETE FROM public.store_members
    WHERE user_id  = '10000000-0000-0000-0000-000000000001'
      AND store_id = '20000000-0000-0000-0000-000000000001'$$,
  'P0001', NULL,
  '36. No se puede eliminar al único owner de una tienda'
);

-- 37. Owner no puede degradarse a staff si es el único owner
SELECT throws_ok(
  $$UPDATE public.store_members
    SET role = 'staff'
    WHERE user_id  = '10000000-0000-0000-0000-000000000001'
      AND store_id = '20000000-0000-0000-0000-000000000001'$$,
  'P0001', NULL,
  '37. El último owner no puede degradarse a staff'
);

-- =====================
-- PARTE 6 — is_store_member_text para Storage (tests 38-42)
-- Estos tests corren como usuario A autenticado.
-- =====================
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 38. Ruta inválida (no UUID): devuelve false, no lanza error
SELECT ok(
  NOT public.is_store_member_text('no-es-un-uuid'),
  '38. is_store_member_text devuelve false para ruta inválida (sin error de cast)'
);

-- 39. Ruta vacía: devuelve false
SELECT ok(
  NOT public.is_store_member_text(''),
  '39. is_store_member_text devuelve false para ruta vacía'
);

-- 40. Carpeta de otra tienda: devuelve false
SELECT ok(
  NOT public.is_store_member_text('20000000-0000-0000-0000-000000000002'),
  '40. Usuario A: is_store_member_text false para carpeta de Tienda B'
);

-- 41. Carpeta propia: devuelve true
SELECT ok(
  public.is_store_member_text('20000000-0000-0000-0000-000000000001'),
  '41. Usuario A: is_store_member_text true para su propia carpeta'
);

-- 42. Anon no puede ejecutar is_store_member_text
SET LOCAL role TO anon;
SELECT throws_ok(
  $$SELECT public.is_store_member_text('20000000-0000-0000-0000-000000000001')$$,
  '42501', NULL,
  '42. Usuario anónimo no puede ejecutar is_store_member_text'
);

-- =====================
-- PARTE 7 — FK NO ACTION: variante con historial de stock (test 43)
-- Corre como postgres (sin RLS) para demostrar que la protección
-- existe a nivel de base de datos, independiente de políticas.
-- =====================
RESET role;

-- 43. No se puede borrar un producto cuya variante tiene movimientos de stock.
-- El DELETE en products intenta hacer CASCADE a product_variants; pero
-- stock_movements tiene FK NO ACTION sobre product_variants → falla con 23503.
SELECT throws_ok(
  $$DELETE FROM public.products WHERE id = '40000000-0000-0000-0001-000000000001'$$,
  '23503', NULL,
  '43. FK NO ACTION: borrar un producto con historial de stock falla (23503)'
);

-- =====================
-- PARTE 8 — Aislamiento de Storage (test 44)
-- =====================
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 44. La política SELECT de storage está restringida a la carpeta propia.
-- El objeto en la carpeta de Tienda B debe ser invisible para Usuario A.
SELECT ok(
  (SELECT count(*) = 0 FROM storage.objects
   WHERE bucket_id = 'product-images'
   AND split_part(name, '/', 1) = '20000000-0000-0000-0000-000000000002'),
  '44. Usuario A NO puede ver objetos de la carpeta de Tienda B (storage)'
);

-- =====================
-- PARTE 9 — FK SET NULL parcial: solo la columna nullable queda NULL (tests 45-47)
-- Estos tests corren como postgres para poder modificar datos libremente.
-- =====================
RESET role;

-- Preparación: asociar Producto A a Categoría A e insertar una subcategoría
UPDATE public.products
  SET category_id = '30000000-0000-0000-0001-000000000001'
  WHERE id = '40000000-0000-0000-0001-000000000001';

INSERT INTO public.categories (id, store_id, parent_id, name, slug)
VALUES ('30000000-0000-0000-0001-000000000099',
        '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0001-000000000001',
        'SubCat A', 'subcat-a');

-- Borrar Categoría A activa el FK SET NULL (parent_id) y FK SET NULL (category_id)
DELETE FROM public.categories WHERE id = '30000000-0000-0000-0001-000000000001';

-- 45. category_id del producto queda NULL (SET NULL parcial sobre category_id)
SELECT ok(
  (SELECT category_id IS NULL FROM public.products
   WHERE id = '40000000-0000-0000-0001-000000000001'),
  '45. FK SET NULL parcial: category_id queda NULL al borrar la categoría'
);

-- 46. store_id del producto no fue afectado (NOT NULL, no forma parte del SET NULL)
SELECT ok(
  (SELECT store_id = '20000000-0000-0000-0000-000000000001'
   FROM public.products WHERE id = '40000000-0000-0000-0001-000000000001'),
  '46. store_id del producto permanece intacto tras borrar la categoría'
);

-- 47. parent_id de la subcategoría queda NULL (SET NULL parcial sobre parent_id)
SELECT ok(
  (SELECT parent_id IS NULL FROM public.categories
   WHERE id = '30000000-0000-0000-0001-000000000099'),
  '47. FK SET NULL parcial: parent_id queda NULL al borrar la categoría padre'
);

-- =====================
-- PARTE 10 — Auditoría automática de stock (tests 48-51)
-- El trigger product_variants_stock_audit crea los movimientos.
-- =====================

-- 48. El setup insertó variantes con stock > 0; el trigger debió crear el movimiento
SELECT ok(
  (SELECT count(*) = 1 FROM public.stock_movements
   WHERE variant_id = '50000000-0000-0000-0001-000000000001'
   AND delta = 10),
  '48. INSERT variante con stock genera movimiento inicial (delta = 10)'
);

-- El usuario A actualiza el stock de su variante para los tests 49-50
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

UPDATE public.product_variants SET stock = 15
  WHERE id = '50000000-0000-0000-0001-000000000001';

-- 49. El UPDATE de stock genera un movimiento con el delta correcto
SELECT ok(
  (SELECT count(*) = 1 FROM public.stock_movements
   WHERE variant_id = '50000000-0000-0000-0001-000000000001'
   AND delta = 5),
  '49. UPDATE stock genera movimiento con delta correcto (15 - 10 = 5)'
);

-- 50. El movimiento del UPDATE tiene el user_id del usuario que actualizó
SELECT ok(
  (SELECT count(*) = 1 FROM public.stock_movements
   WHERE variant_id = '50000000-0000-0000-0001-000000000001'
   AND delta = 5
   AND user_id = '10000000-0000-0000-0000-000000000001'),
  '50. El movimiento de UPDATE stock tiene el user_id correcto'
);

-- 51. Un INSERT directo en stock_movements falla (sin política INSERT para authenticated)
SELECT throws_ok(
  $$INSERT INTO public.stock_movements (store_id, variant_id, delta)
    VALUES ('20000000-0000-0000-0000-000000000001',
            '50000000-0000-0000-0001-000000000001', 1)$$,
  '42501', NULL,
  '51. Usuario A no puede insertar directamente en stock_movements (sin política INSERT)'
);

-- =====================
-- PARTE 11 — product_images CHECK de ruta y store_members clave inmutable (tests 52-53)
-- =====================
RESET role;

-- 52. Insertar una imagen con path que empieza con el store_id de otra tienda viola el CHECK
SELECT throws_ok(
  $$INSERT INTO public.product_images (store_id, product_id, path)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0001-000000000001',
      '20000000-0000-0000-0000-000000000002/foto.jpg'
    )$$,
  '23514', NULL,
  '52. product_image con ruta de otra tienda viola el CHECK (path LIKE store_id||/%%)'
);

-- 53. UPDATE que cambia user_id en store_members falla (trigger prevent_store_member_key_change)
SELECT throws_ok(
  $$UPDATE public.store_members
    SET user_id = '10000000-0000-0000-0000-000000000002'
    WHERE user_id  = '10000000-0000-0000-0000-000000000001'
      AND store_id = '20000000-0000-0000-0000-000000000001'$$,
  'P0001', NULL,
  '53. user_id es inmutable en store_members (trigger prevent_store_member_key_change)'
);

-- =====================
-- PARTE 12 — Cascada desde stores con único owner (tests 54-55)
-- protect_last_owner tiene un bypass para cascadas originadas en stores.
-- =====================

-- 54. Borrar una tienda con único owner funciona: la cascada pasa el bypass
SELECT lives_ok(
  $$DELETE FROM public.stores WHERE id = '20000000-0000-0000-0000-000000000002'$$,
  '54. Borrar una tienda con único owner funciona (cascada bypasea protect_last_owner)'
);

-- 55. El bypass no debilita la protección directa: borrar solo al owner sigue fallando.
-- La tienda A sigue existiendo (solo borramos B arriba), así que el trigger actúa.
SELECT throws_ok(
  $$DELETE FROM public.store_members
    WHERE user_id  = '10000000-0000-0000-0000-000000000001'
      AND store_id = '20000000-0000-0000-0000-000000000001'$$,
  'P0001', NULL,
  '55. Borrar el único owner directamente sigue fallando (protect_last_owner intacto)'
);

-- =====================
-- PARTE 13 — Unicidad de slug por ámbito en categories (tests 56-58)
-- Verifica que los dos índices únicos parciales de la migración 004
-- permitan el mismo slug bajo padres distintos pero lo bloqueen entre hermanos.
-- =====================
RESET role;

-- Setup: dos categorías raíz en Tienda A para usarlas como padres
INSERT INTO public.categories (id, store_id, name, slug)
VALUES
  ('30000000-0000-0000-0001-000000000010', '20000000-0000-0000-0000-000000000001', 'Padre X', 'padre-x'),
  ('30000000-0000-0000-0001-000000000011', '20000000-0000-0000-0000-000000000001', 'Padre Y', 'padre-y');

-- Hijo existente bajo Padre X con slug 'bullpadel' (base para tests 56-57)
INSERT INTO public.categories (id, store_id, parent_id, name, slug)
VALUES ('30000000-0000-0000-0001-000000000012',
        '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0001-000000000010',
        'Bullpadel', 'bullpadel');

-- 56. Mismo slug bajo un padre distinto → debe funcionar
SELECT lives_ok(
  $$INSERT INTO public.categories (store_id, parent_id, name, slug)
    VALUES ('20000000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0001-000000000011',
            'Bullpadel', 'bullpadel')$$,
  '56. Mismo slug bajo padres distintos es válido (uq_categories_child_slug es por parent_id)'
);

-- 57. Slug repetido bajo el mismo padre → debe fallar
SELECT throws_ok(
  $$INSERT INTO public.categories (store_id, parent_id, name, slug)
    VALUES ('20000000-0000-0000-0000-000000000001',
            '30000000-0000-0000-0001-000000000010',
            'Bullpadel Dup', 'bullpadel')$$,
  '23505', NULL,
  '57. Slug duplicado bajo el mismo padre falla (uq_categories_child_slug)'
);

-- 58. Dos raíces con el mismo slug en la misma tienda → debe fallar
SELECT throws_ok(
  $$INSERT INTO public.categories (store_id, name, slug)
    VALUES ('20000000-0000-0000-0000-000000000001', 'Padre X Dup', 'padre-x')$$,
  '23505', NULL,
  '58. Slug duplicado en raíz falla (uq_categories_root_slug)'
);

-- =====================
-- PARTE 14 — adjust_stock y set_stock (tests 59-67)
-- Store B fue borrada en test 54; creamos Store C para el test de aislamiento.
-- =====================
RESET role;

INSERT INTO public.stores (id, name, slug)
VALUES ('20000000-0000-0000-0000-000000000003', 'Tienda C', 'tienda-c')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.store_members (user_id, store_id, role)
VALUES ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'owner')
ON CONFLICT DO NOTHING;

INSERT INTO public.products (id, store_id, name, slug, price, status)
VALUES ('40000000-0000-0000-0003-000000000001', '20000000-0000-0000-0000-000000000003', 'Producto C', 'producto-c', 50, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.product_variants (id, store_id, product_id, sku, stock)
VALUES ('50000000-0000-0000-0003-000000000001', '20000000-0000-0000-0000-000000000003',
        '40000000-0000-0000-0003-000000000001', 'SKU-C-001', 5)
ON CONFLICT (id) DO NOTHING;

-- Usuario A: después de los tests anteriores la variante A tiene stock=15
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 59. adjust_stock retorna el nuevo stock (15 + 5 = 20)
SELECT results_eq(
  $$SELECT public.adjust_stock('50000000-0000-0000-0001-000000000001', 5, 'test ajuste')$$,
  $$VALUES (20::integer)$$,
  '59. adjust_stock retorna el nuevo stock (15 + 5 = 20)'
);

-- 60. adjust_stock crea movimiento con el reason correcto
SELECT ok(
  (SELECT count(*) >= 1 FROM public.stock_movements
   WHERE variant_id = '50000000-0000-0000-0001-000000000001'
     AND reason = 'test ajuste'
     AND delta = 5),
  '60. adjust_stock crea movimiento con reason correcto'
);

-- 61. adjust_stock movimiento tiene user_id del llamador
SELECT ok(
  (SELECT count(*) >= 1 FROM public.stock_movements
   WHERE variant_id = '50000000-0000-0000-0001-000000000001'
     AND reason = 'test ajuste'
     AND user_id = '10000000-0000-0000-0000-000000000001'),
  '61. adjust_stock movimiento tiene el user_id del llamador'
);

-- 62. adjust_stock falla si el stock quedaría negativo (CHECK stock >= 0 → 23514)
SELECT throws_ok(
  $$SELECT public.adjust_stock('50000000-0000-0000-0001-000000000001', -9999, 'negativo')$$,
  '23514', NULL,
  '62. adjust_stock falla si el stock quedaría negativo (CHECK constraint 23514)'
);

-- 63. Usuario A no puede adjust_stock en variante de Tienda C (RLS → P0002)
SELECT throws_ok(
  $$SELECT public.adjust_stock('50000000-0000-0000-0003-000000000001', 1, 'intruso')$$,
  'P0002', NULL,
  '63. Usuario A no puede adjust_stock en variante de otra tienda (RLS → P0002)'
);

-- 64. Anon no puede ejecutar adjust_stock
SET LOCAL role TO anon;
SELECT throws_ok(
  $$SELECT public.adjust_stock('50000000-0000-0000-0001-000000000001', 1, 'test')$$,
  '42501', NULL,
  '64. Anon no puede ejecutar adjust_stock (42501)'
);

-- 65. set_stock establece el valor absoluto
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT results_eq(
  $$SELECT public.set_stock('50000000-0000-0000-0001-000000000001', 100, 'inventario inicial')$$,
  $$VALUES (100::integer)$$,
  '65. set_stock retorna el nuevo stock absoluto (100)'
);

-- 66. set_stock crea movimiento con reason correcto
SELECT ok(
  (SELECT count(*) >= 1 FROM public.stock_movements
   WHERE variant_id = '50000000-0000-0000-0001-000000000001'
     AND reason = 'inventario inicial'),
  '66. set_stock crea movimiento con reason correcto'
);

-- 67. Anon no puede ejecutar set_stock
SET LOCAL role TO anon;
SELECT throws_ok(
  $$SELECT public.set_stock('50000000-0000-0000-0001-000000000001', 1, 'test')$$,
  '42501', NULL,
  '67. Anon no puede ejecutar set_stock (42501)'
);

-- =====================
-- PARTE 15 — create_product atómico (tests 68-73) y set_stock extra (74-75)
-- =====================
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 68. create_product inserta producto y variante en una sola llamada
SELECT lives_ok(
  $$SELECT public.create_product(
      '20000000-0000-0000-0000-000000000001',
      'Producto Test Atómico',
      'producto-test-atomico',
      99.99,
      'draft',
      NULL, NULL, NULL,
      'SKU-TEST-ATOMIC-001',
      7
    )$$,
  '68. create_product crea producto con su variante por defecto'
);

-- 69. El producto existe en products
SELECT ok(
  (SELECT count(*) = 1 FROM public.products
   WHERE slug = 'producto-test-atomico'
     AND store_id = '20000000-0000-0000-0000-000000000001'),
  '69. create_product: el producto existe en products'
);

-- 70. La variante por defecto existe con attributes = '{}'
SELECT ok(
  (SELECT count(*) = 1 FROM public.product_variants
   WHERE sku = 'SKU-TEST-ATOMIC-001'
     AND store_id = '20000000-0000-0000-0000-000000000001'
     AND attributes = '{}'),
  '70. create_product: variante por defecto existe con attributes vacíos'
);

-- 71. SKU duplicado → falla atómicamente (la función lanza 23505)
SELECT throws_ok(
  $$SELECT public.create_product(
      '20000000-0000-0000-0000-000000000001',
      'Producto Huérfano',
      'producto-huerfano-test',
      50.00,
      'draft',
      NULL, NULL, NULL,
      'SKU-TEST-ATOMIC-001',
      0
    )$$,
  '23505', NULL,
  '71. create_product: SKU duplicado falla con 23505'
);

-- 72. Rollback atómico: el producto no quedó huérfano en la tabla
SELECT ok(
  (SELECT count(*) = 0 FROM public.products
   WHERE slug = 'producto-huerfano-test'),
  '72. create_product: rollback atómico, el producto no quedó huérfano'
);

-- 73. Anon no puede ejecutar create_product
SET LOCAL role TO anon;
SELECT throws_ok(
  $$SELECT public.create_product(
      '20000000-0000-0000-0000-000000000001',
      'Intruso', 'intruso-anon', 1, 'draft',
      NULL, NULL, NULL, 'SKU-INTRUSO-ANON', 0
    )$$,
  '42501', NULL,
  '73. Anon no puede ejecutar create_product (42501)'
);

-- set_stock: valores negativos y aislamiento de tienda
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 74. set_stock falla si el valor nuevo es negativo (CHECK stock >= 0 → 23514)
SELECT throws_ok(
  $$SELECT public.set_stock('50000000-0000-0000-0001-000000000001', -1, 'negativo')$$,
  '23514', NULL,
  '74. set_stock falla con valor negativo (CHECK constraint 23514)'
);

-- 75. Usuario A no puede set_stock en variante de Tienda C (RLS → P0002)
SELECT throws_ok(
  $$SELECT public.set_stock('50000000-0000-0000-0003-000000000001', 1, 'intruso')$$,
  'P0002', NULL,
  '75. Usuario A no puede set_stock en variante de otra tienda (RLS → P0002)'
);

-- =====================
-- PARTE 16 — Storage INSERT policies (tests 76-79)
-- Verifica que las políticas de INSERT en storage.objects respetan el aislamiento.
-- =====================
RESET role;

-- Usar Tienda A (ya existe, Store B fue borrada en test 54, Tienda C creada en parte 14)
-- Usuario A es miembro de Tienda A
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 76. Miembro A puede INSERT objeto en su propia carpeta
SELECT lives_ok(
  $$INSERT INTO storage.objects (id, bucket_id, name, owner_id)
    VALUES (
      '70000000-0000-0000-0001-000000000010',
      'product-images',
      '20000000-0000-0000-0000-000000000001/test-insert.jpg',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  '76. Miembro A puede INSERT objeto en su propia carpeta'
);

-- 77. Miembro A NO puede INSERT en carpeta de otra tienda (42501)
SELECT throws_ok(
  $$INSERT INTO storage.objects (id, bucket_id, name, owner_id)
    VALUES (
      '70000000-0000-0000-0003-000000000010',
      'product-images',
      '20000000-0000-0000-0000-000000000003/intruso.jpg',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  '42501', NULL,
  '77. Miembro A NO puede INSERT en carpeta de otra tienda (42501)'
);

-- 78. Miembro A NO puede INSERT con ruta malformada (primer segmento no es su store_id)
SELECT throws_ok(
  $$INSERT INTO storage.objects (id, bucket_id, name, owner_id)
    VALUES (
      '70000000-0000-0000-0001-000000000011',
      'product-images',
      'invalid-path/foto.jpg',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  '42501', NULL,
  '78. Miembro A NO puede INSERT con ruta malformada (42501)'
);

-- 79. Anon NO puede INSERT en storage (42501)
SET LOCAL role TO anon;
SELECT throws_ok(
  $$INSERT INTO storage.objects (id, bucket_id, name, owner_id)
    VALUES (
      '70000000-0000-0000-0001-000000000012',
      'product-images',
      '20000000-0000-0000-0000-000000000001/anon-intento.jpg',
      NULL
    )$$,
  '42501', NULL,
  '79. Anon NO puede INSERT en storage (42501)'
);

-- =====================
-- PARTE 17 — is_active + upsert_variants (tests 80-85)
-- =====================
RESET role;

-- Setup: Producto D en Tienda A para los tests de upsert_variants
INSERT INTO public.products (id, store_id, name, slug, price, status)
VALUES ('40000000-0000-0000-0001-000000000002', '20000000-0000-0000-0000-000000000001',
        'Producto D', 'producto-d', 150, 'active')
ON CONFLICT (id) DO NOTHING;

-- Variante default de Producto D
INSERT INTO public.product_variants (id, store_id, product_id, sku, attributes, stock)
VALUES ('50000000-0000-0000-0001-000000000002', '20000000-0000-0000-0000-000000000001',
        '40000000-0000-0000-0001-000000000002', 'SKU-D-DEFAULT', '{}', 0)
ON CONFLICT (id) DO NOTHING;

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 80. upsert_variants como usuario A inserta una nueva variante
SELECT lives_ok(
  $$SELECT public.upsert_variants(
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0001-000000000002',
      '[{"sku":"SKU-D-TALLE-M","attributes":{"Talle":"M"},"price":null,"stock":5}]'::jsonb,
      'test upsert insert'
    )$$,
  '80. upsert_variants como usuario A inserta nueva variante'
);

-- 81. La nueva variante existe con is_active=true
SELECT ok(
  (SELECT count(*) = 1 FROM public.product_variants
   WHERE sku = 'SKU-D-TALLE-M'
     AND store_id = '20000000-0000-0000-0000-000000000001'
     AND is_active = true
     AND stock = 5),
  '81. La nueva variante existe con is_active=true y stock=5'
);

-- 82. upsert_variants desactiva variante M (no incluida en la segunda llamada)
-- Enviamos solo SKU-D-TALLE-L sin id; la variante M que fue insertada en test 80
-- no está en la lista → debe quedar is_active=false
SELECT lives_ok(
  $$SELECT public.upsert_variants(
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0001-000000000002',
      '[{"sku":"SKU-D-TALLE-L","attributes":{"Talle":"L"},"price":null,"stock":3}]'::jsonb,
      'test upsert deactivate'
    )$$,
  '82. upsert_variants: segunda llamada, variante M no incluida queda inactiva'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.product_variants
   WHERE sku = 'SKU-D-TALLE-M'
     AND store_id = '20000000-0000-0000-0000-000000000001'
     AND is_active = false),
  '83. La variante M quedó con is_active=false tras no incluirla en upsert'
);

-- 84. El cambio de stock vía upsert_variants crea un movimiento de auditoría
SELECT ok(
  (SELECT count(*) >= 1 FROM public.stock_movements sm
   JOIN public.product_variants pv ON pv.id = sm.variant_id
   WHERE pv.sku = 'SKU-D-TALLE-L'
     AND sm.reason = 'test upsert deactivate'
     AND sm.delta = 3),
  '84. upsert_variants con stock crea movimiento de auditoría'
);

-- 85. Anon no puede ejecutar upsert_variants (42501)
SET LOCAL role TO anon;
SELECT throws_ok(
  $$SELECT public.upsert_variants(
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0001-000000000002',
      '[{"sku":"SKU-ANON","attributes":{},"price":null,"stock":0}]'::jsonb,
      'anon intento'
    )$$,
  '42501', NULL,
  '85. Anon no puede ejecutar upsert_variants (42501)'
);

SELECT * FROM finish();

ROLLBACK;
