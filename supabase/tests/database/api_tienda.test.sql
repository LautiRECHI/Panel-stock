-- Tests de la API de tienda (store_api_keys + funciones storefront)
-- Framework: pgTAP
--
-- Ejecutar:
--   supabase db reset
--   supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(62);

-- ── Setup (postgres, sin RLS) ─────────────────────────────────────────────────
DO $setup$
DECLARE
  v_uid_e  CONSTANT uuid := '10000000-0000-0000-0000-000000000005';
  v_uid_f  CONSTANT uuid := '10000000-0000-0000-0000-000000000006';
  v_uid_g  CONSTANT uuid := '10000000-0000-0000-0000-000000000007';
  v_sid_e  CONSTANT uuid := '20000000-0000-0000-0000-000000000005';
  v_sid_f  CONSTANT uuid := '20000000-0000-0000-0000-000000000006';
  v_prod_1 CONSTANT uuid := '30000000-0000-0000-0005-000000000001';
  v_var_1  CONSTANT uuid := '60000000-0000-0000-0005-000000000001';  -- stock 10
  v_var_2  CONSTANT uuid := '60000000-0000-0000-0005-000000000002';  -- stock 2
  v_var_3  CONSTANT uuid := '60000000-0000-0000-0005-000000000003';  -- stock 0
  v_prod_f CONSTANT uuid := '30000000-0000-0000-0006-000000000001';
  v_var_f  CONSTANT uuid := '60000000-0000-0000-0006-000000000001';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_uid_e, 'owner_e@test.com'),
    (v_uid_f, 'staff_f@test.com'),
    (v_uid_g, 'owner_g@test.com');

  INSERT INTO public.stores (id, name, slug) VALUES
    (v_sid_e, 'Tienda E', 'tienda-e'),
    (v_sid_f, 'Tienda F', 'tienda-f');

  INSERT INTO public.store_members (user_id, store_id, role) VALUES
    (v_uid_e, v_sid_e, 'owner'),
    (v_uid_f, v_sid_e, 'staff'),
    (v_uid_g, v_sid_f, 'owner');

  INSERT INTO public.products (id, store_id, name, slug, price, status) VALUES
    (v_prod_1, v_sid_e, 'Producto E1', 'producto-e1', 1000.00, 'active'),
    (v_prod_f, v_sid_f, 'Producto F1', 'producto-f1',  500.00, 'active');

  INSERT INTO public.product_variants (id, store_id, product_id, sku, stock, is_active) VALUES
    (v_var_1, v_sid_e, v_prod_1, 'SKU-E1-A', 10, true),
    (v_var_2, v_sid_e, v_prod_1, 'SKU-E1-B',  2, true),
    (v_var_3, v_sid_e, v_prod_1, 'SKU-E1-C',  0, true),
    (v_var_f, v_sid_f, v_prod_f, 'SKU-F1',    5, true);
END;
$setup$;

-- ── Preparar temp tables de soporte ───────────────────────────────────────────
-- _test_keys: guarda los secretos de API para uso en tests
-- _order_cache: guarda IDs de pedidos para evitar subqueries con RLS
CREATE TEMP TABLE _test_keys  (key_name text, secret text);
CREATE TEMP TABLE _order_cache (label text, order_id uuid, public_token text, total numeric(12,2));

GRANT SELECT, INSERT ON _test_keys  TO authenticated, anon;
GRANT SELECT, INSERT ON _order_cache TO authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-3: create_store_api_key — control de acceso
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO anon;

SELECT throws_ok(
  $$SELECT public.create_store_api_key('Mi clave')$$,
  '42501', NULL,
  '1. anon no tiene permiso de ejecución en create_store_api_key'
);

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000006","role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.create_store_api_key('Mi clave')$$,
  '28000', NULL,
  '2. staff no puede crear claves de API (solo owner)'
);

SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT lives_ok(
  $$SELECT public.create_store_api_key('Clave producción')$$,
  '3. owner puede crear clave de API'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4-5: El secreto no se guarda en claro; prefijo correcto
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT COUNT(*) = 0
   FROM public.store_api_keys
   WHERE store_id = '20000000-0000-0000-0000-000000000005'
     AND key_hash LIKE 'pdolive_%'),
  '4. El secreto no se guarda en claro (key_hash es SHA-256)'
);

SELECT ok(
  (SELECT COUNT(*) >= 1
   FROM public.store_api_keys
   WHERE store_id = '20000000-0000-0000-0000-000000000005'
     AND key_prefix = 'pdolive_'
     AND revoked_at IS NULL),
  '5. Clave creada con prefijo pdolive_ y sin revocar'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6-8: RLS en store_api_keys
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO anon;

SELECT is(
  (SELECT COUNT(*) FROM public.store_api_keys)::integer,
  0,
  '6. anon no ve ninguna clave (RLS)'
);

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT ok(
  (SELECT COUNT(*) >= 1 FROM public.store_api_keys
   WHERE store_id = '20000000-0000-0000-0000-000000000005'),
  '7. owner ve sus propias claves'
);

SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000007","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*) FROM public.store_api_keys
   WHERE store_id = '20000000-0000-0000-0000-000000000005')::integer,
  0,
  '8. owner de tienda F no ve claves de tienda E'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Cargar claves de API en _test_keys para uso en tests storefront
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';
INSERT INTO _test_keys SELECT 'tienda_e', (public.create_store_api_key('Clave tests'))->>'secret';

SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000007","role":"authenticated"}';
INSERT INTO _test_keys SELECT 'tienda_f', (public.create_store_api_key('Clave F'))->>'secret';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9-10: Clave inválida / clave de otra tienda no puede crear pedido
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO anon;

SELECT throws_ok(
  $$SELECT public.storefront_create_order(
      'clave_completamente_invalida_xxxxx',
      '{"name":"Test"}'::jsonb,
      '{"method":"retiro"}'::jsonb,
      '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":1}]'::jsonb
    )$$,
  'P0401', NULL,
  '9. Clave inválida → INVALID_KEY'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Test"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":1}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_f')
  ),
  'P0404', NULL,
  '10. Clave de tienda F no accede a variantes de tienda E'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11: Crear pedido exitoso (como anon, que es el caso real servidor→servidor)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Ana García","email":"ana@test.com"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":2}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  '11. Crear pedido online con clave válida (anon)'
);

-- Cachear datos del pedido creado (como authenticated, RLS lo requiere)
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';

INSERT INTO _order_cache (label, order_id, public_token, total)
SELECT 'first', id, public_token, total
FROM public.orders
WHERE store_id = '20000000-0000-0000-0000-000000000005'
  AND source   = 'tienda'
ORDER BY created_at ASC LIMIT 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12-17: Verificar el pedido creado
-- ─────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT source FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000005'
   ORDER BY created_at DESC LIMIT 1),
  'tienda',
  '12. source = tienda en pedido online'
);

SELECT ok(
  (SELECT oi.unit_price = 1000.00
   FROM public.order_items oi
   JOIN public.orders o ON o.id = oi.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000005'
     AND o.source   = 'tienda'
   ORDER BY o.created_at DESC LIMIT 1),
  '13. Precio recalculado desde BD (unit_price = 1000, payload ignorado)'
);

SELECT is(
  (SELECT stock FROM public.product_variants
   WHERE id = '60000000-0000-0000-0005-000000000001'),
  8,
  '14. Stock descontado (10 - 2 = 8) al crear pedido online'
);

SELECT ok(
  (SELECT COUNT(*) >= 1
   FROM public.stock_movements
   WHERE variant_id = '60000000-0000-0000-0005-000000000001'
     AND delta = -2
     AND reason LIKE 'Venta online - pedido #%'),
  '15. Movimiento de stock auditado con motivo correcto'
);

SELECT ok(
  (SELECT public_token IS NOT NULL AND length(public_token) >= 32
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000005'
     AND source   = 'tienda'
   ORDER BY created_at DESC LIMIT 1),
  '16. Pedido online tiene public_token ≥ 32 chars'
);

SELECT ok(
  (SELECT total = subtotal AND shipping_cost IS NULL
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000005'
     AND source   = 'tienda'
   ORDER BY created_at DESC LIMIT 1),
  '17. Retiro: shipping_cost NULL y total = subtotal'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 18-19: Domicilio con shipping_cost
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Bob","email":"bob@test.com"}'::jsonb,
        '{"method":"domicilio","street":"Av. Corrientes","postal_code":"1043","shipping_cost":500}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":1}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  '18. Crear pedido domicilio con shipping_cost'
);

SELECT ok(
  (SELECT total = subtotal + 500 AND shipping_cost = 500
   FROM public.orders
   WHERE store_id       = '20000000-0000-0000-0000-000000000005'
     AND source         = 'tienda'
     AND delivery_method = 'domicilio'
   ORDER BY created_at DESC LIMIT 1),
  '19. Domicilio: total = subtotal + shipping_cost'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 20-24: Validaciones de entrada (corremos como authenticated;
-- las funciones son SECURITY DEFINER así que el rol no altera la seguridad)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Ana"}'::jsonb,
        '{"method":"domicilio"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":1}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  'P0001', NULL,
  '20. Domicilio sin dirección falla'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Ana"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000003","quantity":1}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  'P0409', NULL,
  '21. Variante con stock=0 → OUT_OF_STOCK (stock insuficiente)'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Ana"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000002","quantity":5}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  'P0409', NULL,
  '22. Stock insuficiente → OUT_OF_STOCK'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Ana"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":21}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  'P0001', NULL,
  '23. Más de 20 unidades por variante falla'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Ana"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        (SELECT jsonb_agg(jsonb_build_object(
          'variant_id','60000000-0000-0000-0005-000000000001','quantity',1))
         FROM generate_series(1,31))
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  'P0001', NULL,
  '24. Más de 30 ítems falla'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 25-27: Rate limiting por email
-- ─────────────────────────────────────────────────────────────────────────────
-- Ya tenemos 1 pedido pendiente de ana@test.com; creamos 2 más
SELECT lives_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Ana García","email":"ana@test.com"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":1}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  '25. Segundo pedido mismo email OK'
);

SELECT lives_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Ana García","email":"ana@test.com"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":1}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  '26. Tercer pedido mismo email OK'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Ana García","email":"ana@test.com"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":1}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e')
  ),
  'P0429', NULL,
  '27. Rate limiting: 4to pedido mismo email → RATE_LIMITED'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 28-30: storefront_get_order (usa IDs del cache)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT (public.storefront_get_order(
      (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e'),
      (SELECT public_token FROM _order_cache WHERE label = 'first')
    ))->>'status' = 'pendiente'),
  '28. storefront_get_order devuelve estado del pedido'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_get_order(
        %L,
        %L
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_f'),
    (SELECT public_token FROM _order_cache WHERE label = 'first')
  ),
  'P0404', NULL,
  '29. Token de tienda E no visible con clave de tienda F'
);

SELECT ok(
  (SELECT result NOT LIKE '%paid_by%' AND result NOT LIKE '%"notes"%'
   FROM (
     SELECT public.storefront_get_order(
       (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e'),
       (SELECT public_token FROM _order_cache WHERE label = 'first')
     )::text AS result
   ) t),
  '30. get_order no expone campos internos (paid_by, notes)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 31-36: storefront_mark_order_paid
-- ─────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  format(
    $q$SELECT public.storefront_mark_order_paid(
        %L, %L::uuid, 'mercadopago', 'mp_ref_001', 999999.99
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e'),
    (SELECT order_id FROM _order_cache WHERE label = 'first')
  ),
  'P0001', NULL,
  '31. mark_paid rechaza monto incorrecto (AMOUNT_MISMATCH)'
);

SELECT lives_ok(
  format(
    $q$SELECT public.storefront_mark_order_paid(
        %L, %L::uuid, 'mercadopago', 'mp_ref_001', %s
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e'),
    (SELECT order_id FROM _order_cache WHERE label = 'first'),
    (SELECT total    FROM _order_cache WHERE label = 'first')
  ),
  '32. mark_paid con monto correcto OK'
);

SELECT is(
  (SELECT status FROM public.orders WHERE id =
     (SELECT order_id FROM _order_cache WHERE label = 'first')),
  'pagado',
  '33. Pedido marcado como pagado'
);

SELECT ok(
  (SELECT payment_status = 'aprobado' AND expires_at IS NULL
   FROM public.orders WHERE id =
     (SELECT order_id FROM _order_cache WHERE label = 'first')),
  '34. mark_paid: payment_status=aprobado y expires_at=NULL'
);

SELECT ok(
  (SELECT (public.storefront_mark_order_paid(
      (SELECT secret FROM _test_keys WHERE key_name = 'tienda_e'),
      (SELECT order_id FROM _order_cache WHERE label = 'first'),
      'mercadopago', 'mp_ref_001',
      (SELECT total FROM _order_cache WHERE label = 'first')
    ))->>'idempotent' = 'true'),
  '35. mark_paid idempotente: mismo external_payment_id devuelve idempotent=true'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_mark_order_paid(
        %L, %L::uuid, 'mercadopago', 'mp_cross', 100.00
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'tienda_f'),
    (SELECT order_id FROM _order_cache WHERE label = 'first')
  ),
  'P0404', NULL,
  '36. mark_paid rechaza pedido de otra tienda'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Cachear un pedido pendiente para los tests de cancel
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO _order_cache (label, order_id, public_token, total)
SELECT 'to_cancel', id, public_token, total
FROM public.orders
WHERE store_id = '20000000-0000-0000-0000-000000000005'
  AND source   = 'tienda'
  AND status   = 'pendiente'
ORDER BY created_at ASC LIMIT 1;

-- Guardar stock antes de cancelar
CREATE TEMP TABLE _stock_before AS
  SELECT stock FROM public.product_variants
  WHERE id = '60000000-0000-0000-0005-000000000001';

-- ─────────────────────────────────────────────────────────────────────────────
-- 37-43: storefront_cancel_order
-- ─────────────────────────────────────────────────────────────────────────────
SELECT lives_ok(
  format(
    $q$SELECT public.storefront_cancel_order(
        %L, %L::uuid, 'Cancelado por cliente'
      )$q$,
    (SELECT secret   FROM _test_keys   WHERE key_name = 'tienda_e'),
    (SELECT order_id FROM _order_cache WHERE label    = 'to_cancel')
  ),
  '37. storefront_cancel_order de pedido pendiente OK'
);

SELECT ok(
  (SELECT stock > (SELECT stock FROM _stock_before)
   FROM public.product_variants
   WHERE id = '60000000-0000-0000-0005-000000000001'),
  '38. Stock repuesto después de cancelar pedido online'
);

SELECT ok(
  (SELECT COUNT(*) >= 1
   FROM public.stock_movements
   WHERE variant_id = '60000000-0000-0000-0005-000000000001'
     AND delta > 0
     AND reason LIKE 'Cancelación online - pedido #%'),
  '39. Movimiento de reposición auditado al cancelar'
);

SELECT lives_ok(
  format(
    $q$SELECT public.storefront_cancel_order(
        %L, %L::uuid, 'Segunda cancelación'
      )$q$,
    (SELECT secret   FROM _test_keys   WHERE key_name = 'tienda_e'),
    (SELECT order_id FROM _order_cache WHERE label    = 'to_cancel')
  ),
  '40. storefront_cancel_order idempotente (ya cancelado → OK)'
);

SELECT is(
  (SELECT COUNT(*)
   FROM public.stock_movements
   WHERE variant_id = '60000000-0000-0000-0005-000000000001'
     AND reason LIKE 'Cancelación online - pedido #%'
     AND delta > 0)::integer,
  1,
  '41. El stock se repone solo una vez (cancel idempotente no duplica)'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_cancel_order(
        %L, %L::uuid, 'Intento cruzado'
      )$q$,
    (SELECT secret   FROM _test_keys   WHERE key_name = 'tienda_f'),
    (SELECT order_id FROM _order_cache WHERE label    = 'to_cancel')
  ),
  'P0404', NULL,
  '42. cancel con clave de otra tienda falla'
);

SELECT throws_ok(
  format(
    $q$SELECT public.storefront_cancel_order(
        %L, %L::uuid, 'Intento pagado'
      )$q$,
    (SELECT secret   FROM _test_keys   WHERE key_name = 'tienda_e'),
    (SELECT order_id FROM _order_cache WHERE label    = 'first')
  ),
  'P0001', NULL,
  '43. storefront_cancel_order rechaza pedido pagado'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 44-48: expire_pending_orders
-- ─────────────────────────────────────────────────────────────────────────────

-- Insertar pedido ya vencido directamente (como postgres: necesita RESET ROLE)
RESET ROLE;

INSERT INTO public.orders (
  store_id, number, status, source,
  customer_name, delivery_method,
  subtotal, total, currency,
  expires_at, public_token, payment_status
) VALUES (
  '20000000-0000-0000-0000-000000000005',
  9001, 'pendiente', 'tienda',
  'Cliente Vencido', 'retiro',
  500.00, 500.00, 'ARS',
  now() - interval '1 hour',
  encode(extensions.gen_random_bytes(16), 'hex'),
  'pendiente'
);

INSERT INTO public.order_items (
  store_id, order_id, product_id, variant_id,
  product_name, variant_label, sku, unit_price, quantity, line_total
)
SELECT
  '20000000-0000-0000-0000-000000000005',
  id,
  '30000000-0000-0000-0005-000000000001',
  '60000000-0000-0000-0005-000000000002',
  'Producto E1', '', 'SKU-E1-B', 500.00, 1, 500.00
FROM public.orders
WHERE number   = 9001
  AND store_id = '20000000-0000-0000-0000-000000000005';

-- Simular que el stock fue reservado al crear el pedido
UPDATE public.product_variants
SET stock = stock - 1
WHERE id = '60000000-0000-0000-0005-000000000002';

-- expire_pending_orders es SECURITY DEFINER pero necesita GRANT a authenticated
-- (el postgres puede llamarla directamente; para el panel se usa via authenticated)
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT ok(
  (SELECT public.expire_pending_orders('20000000-0000-0000-0000-000000000005') >= 1),
  '44. expire_pending_orders devuelve >= 1 para tienda con pedido vencido'
);

SELECT is(
  (SELECT status FROM public.orders
   WHERE number   = 9001
     AND store_id = '20000000-0000-0000-0000-000000000005'),
  'cancelado',
  '45. Pedido vencido queda en estado cancelado'
);

SELECT is(
  (SELECT payment_status FROM public.orders
   WHERE number   = 9001
     AND store_id = '20000000-0000-0000-0000-000000000005'),
  'vencido',
  '46. payment_status = vencido en pedido expirado'
);

SELECT ok(
  (SELECT COUNT(*) >= 1
   FROM public.stock_movements
   WHERE variant_id = '60000000-0000-0000-0005-000000000002'
     AND delta > 0
     AND reason LIKE 'Vencimiento - pedido #9001%'),
  '47. expire repone stock con motivo Vencimiento'
);

SELECT is(
  (SELECT public.expire_pending_orders('20000000-0000-0000-0000-000000000005')),
  0,
  '48. expire_pending_orders idempotente: segunda llamada devuelve 0'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 49-50: revoke_store_api_key
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';

INSERT INTO _test_keys SELECT 'a_revocar', (public.create_store_api_key('Clave a revocar'))->>'secret';

SELECT lives_ok(
  $$SELECT public.revoke_store_api_key(
      (SELECT id FROM public.store_api_keys
       WHERE store_id  = '20000000-0000-0000-0000-000000000005'
         AND name      = 'Clave a revocar'
         AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1)
    )$$,
  '49. revoke_store_api_key OK'
);

SELECT ok(
  (SELECT revoked_at IS NOT NULL
   FROM public.store_api_keys
   WHERE store_id = '20000000-0000-0000-0000-000000000005'
     AND name     = 'Clave a revocar'),
  '50. Clave revocada tiene revoked_at'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 51-52: Clave revocada y clave inválida no funcionan en storefront
-- ─────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  format(
    $q$SELECT public.storefront_create_order(
        %L,
        '{"name":"Test"}'::jsonb,
        '{"method":"retiro"}'::jsonb,
        '[{"variant_id":"60000000-0000-0000-0005-000000000001","quantity":1}]'::jsonb
      )$q$,
    (SELECT secret FROM _test_keys WHERE key_name = 'a_revocar')
  ),
  'P0401', NULL,
  '51. Clave revocada → INVALID_KEY al intentar crear pedido'
);

SELECT throws_ok(
  $$SELECT public.storefront_get_order('clave_invalida_xxxxxxxxxxxxxxxxxxxx', 'token')$$,
  'P0401', NULL,
  '52. storefront_get_order con clave inválida → INVALID_KEY'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 53: anon no puede leer orders directamente (RLS)
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO anon;

SELECT is(
  (SELECT COUNT(*) FROM public.orders)::integer,
  0,
  '53. anon no puede leer orders (RLS)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 54-58: Verificaciones de consistencia e integridad
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT ok(
  (SELECT COUNT(DISTINCT public_token) = COUNT(*)
   FROM public.orders
   WHERE store_id     = '20000000-0000-0000-0000-000000000005'
     AND public_token IS NOT NULL),
  '54. public_token único entre los pedidos de la tienda'
);

SELECT ok(
  (SELECT COUNT(*) >= 1
   FROM public.order_events oe
   JOIN public.orders o ON o.id = oe.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000005'
     AND o.source   = 'tienda'
     AND oe.type    = 'creado'),
  '55. Evento creado registrado para pedidos online'
);

SELECT ok(
  (SELECT COUNT(*) >= 1
   FROM public.order_events oe
   JOIN public.orders o ON o.id = oe.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000005'
     AND o.source   = 'tienda'
     AND oe.type    = 'pagado'),
  '56. Evento pagado registrado'
);

SELECT ok(
  (SELECT COUNT(*) = 1
   FROM public.order_events oe
   JOIN public.orders o ON o.id = oe.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000005'
     AND o.number   = 9001
     AND oe.type    = 'vencido'),
  '57. Evento vencido registrado por expire_pending_orders'
);

SELECT ok(
  (SELECT last_used_at IS NOT NULL
   FROM public.store_api_keys
   WHERE store_id  = '20000000-0000-0000-0000-000000000005'
     AND name      = 'Clave tests'
     AND revoked_at IS NULL),
  '58. last_used_at actualizado después de llamadas storefront'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 59: anon no puede ejecutar expire_pending_orders directamente
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO anon;

SELECT throws_ok(
  $$SELECT public.expire_pending_orders()$$,
  '42501', NULL,
  '59. anon no puede llamar expire_pending_orders directamente'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 60: Consistencia total = subtotal + shipping en todos los pedidos online
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT ok(
  (SELECT BOOL_AND(total = subtotal + COALESCE(shipping_cost, 0))
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000005'
     AND source   = 'tienda'),
  '60. Consistencia total = subtotal + shipping en todos los pedidos online'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 61: create_store_api_key con nombre vacío falla
-- ─────────────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.create_store_api_key('')$$,
  'P0001', NULL,
  '61. create_store_api_key con nombre vacío falla'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 62: staff no puede revocar claves
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000006","role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.revoke_store_api_key(
      (SELECT id FROM public.store_api_keys
       WHERE store_id = '20000000-0000-0000-0000-000000000005'
       ORDER BY created_at ASC LIMIT 1)
    )$$,
  '28000', NULL,
  '62. staff no puede revocar claves de API (solo owner)'
);

SELECT * FROM finish();
ROLLBACK;
