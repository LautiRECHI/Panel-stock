-- Tests de pedidos (orders)
-- Framework: pgTAP
--
-- Ejecutar:
--   supabase db reset
--   supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(58);

-- ── Setup ─────────────────────────────────────────────────────────────────────
DO $setup$
DECLARE
  v_uid_c  CONSTANT uuid := '10000000-0000-0000-0000-000000000003';
  v_uid_d  CONSTANT uuid := '10000000-0000-0000-0000-000000000004';
  v_sid_c  CONSTANT uuid := '20000000-0000-0000-0000-000000000003';
  v_sid_d  CONSTANT uuid := '20000000-0000-0000-0000-000000000004';
BEGIN
  -- Usuarios
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current
  ) VALUES
    (v_uid_c, 'authenticated', 'authenticated',
     'usuario_c@test.local', crypt('pass_c', gen_salt('bf')),
     now(), '{}', '{}', now(), now(), '', '', '', ''),
    (v_uid_d, 'authenticated', 'authenticated',
     'usuario_d@test.local', crypt('pass_d', gen_salt('bf')),
     now(), '{}', '{}', now(), now(), '', '', '', '')
  ON CONFLICT (id) DO NOTHING;

  -- Tiendas
  INSERT INTO public.stores (id, name, slug)
  VALUES (v_sid_c, 'Tienda C', 'tienda-c'),
         (v_sid_d, 'Tienda D', 'tienda-d')
  ON CONFLICT (id) DO NOTHING;

  -- Membresías
  INSERT INTO public.store_members (user_id, store_id, role)
  VALUES (v_uid_c, v_sid_c, 'owner'),
         (v_uid_d, v_sid_d, 'owner')
  ON CONFLICT DO NOTHING;

  -- Productos
  INSERT INTO public.products (id, store_id, name, slug, price, status)
  VALUES
    ('40000000-0000-0000-0003-000000000001', v_sid_c, 'Raqueta Pro', 'raqueta-pro',   5000, 'active'),
    ('40000000-0000-0000-0003-000000000002', v_sid_c, 'Pelotas x3',  'pelotas-x3',    800,  'active'),
    ('40000000-0000-0000-0004-000000000001', v_sid_d, 'Zapatilla D',  'zapatilla-d',  3000,  'active')
  ON CONFLICT (id) DO NOTHING;

  -- Variantes
  INSERT INTO public.product_variants (id, store_id, product_id, sku, stock, attributes)
  VALUES
    ('50000000-0000-0000-0003-000000000001', v_sid_c,
     '40000000-0000-0000-0003-000000000001', 'RAQ-M', 10, '{"talle":"M"}'::jsonb),
    ('50000000-0000-0000-0003-000000000002', v_sid_c,
     '40000000-0000-0000-0003-000000000002', 'PEL-3', 50,  '{}'::jsonb),
    ('50000000-0000-0000-0004-000000000001', v_sid_d,
     '40000000-0000-0000-0004-000000000001', 'ZAP-42', 5, '{"talle":"42"}'::jsonb)
  ON CONFLICT (id) DO NOTHING;
END;
$setup$;

-- ── 1-3: Tablas existen ───────────────────────────────────────────────────────
SELECT has_table('public', 'orders',       '1. Tabla orders existe');
SELECT has_table('public', 'order_items',  '2. Tabla order_items existe');
SELECT has_table('public', 'order_events', '3. Tabla order_events existe');

-- ── 4-7: anon no puede SELECT ni llamar funciones ─────────────────────────────
SET LOCAL role TO anon;

SELECT ok(
  (SELECT count(*) = 0 FROM public.orders),
  '4. Anon NO ve orders'
);
SELECT ok(
  (SELECT count(*) = 0 FROM public.order_items),
  '5. Anon NO ve order_items'
);
SELECT ok(
  (SELECT count(*) = 0 FROM public.order_events),
  '6. Anon NO ve order_events'
);
SELECT throws_ok(
  $$SELECT public.create_order(
      '{"name":"X"}'::jsonb,
      '{"method":"retiro"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000001","quantity":1}]'::jsonb,
      NULL, 'panel'
    )$$,
  '42501', NULL,
  '7. Anon no puede ejecutar create_order'
);

-- ── 8-12: Usuario C crea pedido ───────────────────────────────────────────────
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT lives_ok(
  $$SELECT public.create_order(
      '{"name":"Ana García","email":"ana@test.com","phone":"1122334455"}'::jsonb,
      '{"method":"retiro"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000001","quantity":2},
        {"variant_id":"50000000-0000-0000-0003-000000000002","quantity":3}]'::jsonb,
      'Nota del pedido', 'panel'
    )$$,
  '8. create_order (retiro, 2 ítems) se ejecuta sin error'
);

SELECT ok(
  (SELECT number = 1001 FROM public.orders WHERE store_id = '20000000-0000-0000-0000-000000000003' LIMIT 1),
  '9. El primer pedido de la tienda tiene número 1001'
);

SELECT ok(
  (SELECT subtotal = 5000*2 + 800*3
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1001),
  '10. Subtotal calculado desde la BD (5000x2 + 800x3 = 12400)'
);

SELECT ok(
  (SELECT total = subtotal AND shipping_cost IS NULL
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1001),
  '11. total = subtotal cuando no hay costo de envio'
);

SELECT ok(
  (SELECT count(*) = 2
   FROM public.order_items oi
   JOIN public.orders o ON o.id = oi.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000003' AND o.number = 1001),
  '12. El pedido tiene 2 items'
);

-- ── 13-14: Snapshots ──────────────────────────────────────────────────────────
SELECT ok(
  (SELECT oi.product_name = 'Raqueta Pro' AND oi.sku = 'RAQ-M' AND oi.unit_price = 5000
   FROM public.order_items oi
   JOIN public.orders o ON o.id = oi.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000003'
     AND oi.variant_id = '50000000-0000-0000-0003-000000000001'),
  '13. Snapshot: product_name, sku y unit_price son correctos'
);

-- Cambiar precio del producto DESPUÉS del pedido
RESET role;
UPDATE public.products SET price = 99999
WHERE id = '40000000-0000-0000-0003-000000000001';

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT ok(
  (SELECT oi.unit_price = 5000
   FROM public.order_items oi
   JOIN public.orders o ON o.id = oi.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000003'
     AND oi.variant_id = '50000000-0000-0000-0003-000000000001'),
  '14. Snapshot preserva el precio aunque el producto cambie después'
);

-- ── 15: Stock descontado ──────────────────────────────────────────────────────
SELECT ok(
  (SELECT stock = 10 - 2 FROM public.product_variants
   WHERE id = '50000000-0000-0000-0003-000000000001'),
  '15. Stock de RAQ-M descontado de 10 a 8 tras el pedido'
);

-- ── 16: stock_movements tiene el motivo «Venta» ───────────────────────────────
SELECT ok(
  (SELECT count(*) > 0
   FROM public.stock_movements
   WHERE variant_id = '50000000-0000-0000-0003-000000000001'
     AND reason LIKE 'Venta - pedido #%'
     AND delta = -2),
  '16. stock_movements registra venta con motivo Venta - pedido # y delta -2'
);

-- ── 17: order_events tiene evento «creado» ────────────────────────────────────
SELECT ok(
  (SELECT count(*) = 1
   FROM public.order_events oe
   JOIN public.orders o ON o.id = oe.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000003'
     AND o.number   = 1001
     AND oe.type    = 'creado'),
  '17. Se registro el evento creado en order_events'
);

-- ── 18-19: order_events es inmutable ─────────────────────────────────────────
RESET role;
SELECT throws_ok(
  $$UPDATE public.order_events SET note = 'hackeado' WHERE true$$,
  'P0001', NULL,
  '18. UPDATE en order_events falla (inmutable)'
);
SELECT throws_ok(
  $$DELETE FROM public.order_events WHERE true$$,
  'P0001', NULL,
  '19. DELETE en order_events falla (inmutable)'
);

-- ── 20-21: Stock insuficiente falla todo el pedido ────────────────────────────
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.create_order(
      '{"name":"Test"}'::jsonb,
      '{"method":"retiro"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000001","quantity":999}]'::jsonb,
      NULL, 'panel'
    )$$,
  'P0001', NULL,
  '20. Stock insuficiente: create_order falla con ERRCODE P0001'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000003'),
  '21. Sin stock suficiente: no queda pedido huerfano (rollback atomico)'
);

-- ── 22-23: Domicilio exige dirección ─────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.create_order(
      '{"name":"Test"}'::jsonb,
      '{"method":"domicilio"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000002","quantity":1}]'::jsonb,
      NULL, 'panel'
    )$$,
  'P0001', NULL,
  '22. Domicilio sin calle falla'
);

SELECT throws_ok(
  $$SELECT public.create_order(
      '{"name":"Test"}'::jsonb,
      '{"method":"domicilio","street":"Av. Corrientes 1234"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000002","quantity":1}]'::jsonb,
      NULL, 'panel'
    )$$,
  'P0001', NULL,
  '23. Domicilio sin codigo postal falla'
);

-- ── 24: Retiro sin dirección funciona ────────────────────────────────────────
SELECT lives_ok(
  $$SELECT public.create_order(
      '{"name":"Retiro OK"}'::jsonb,
      '{"method":"retiro"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000002","quantity":1}]'::jsonb,
      NULL, 'panel'
    )$$,
  '24. Retiro sin direccion funciona (pedido #1002)'
);

-- ── 25: Numeración por tienda es independiente ────────────────────────────────
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';

SELECT lives_ok(
  $$SELECT public.create_order(
      '{"name":"Cliente D"}'::jsonb,
      '{"method":"retiro"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0004-000000000001","quantity":1}]'::jsonb,
      NULL, 'panel'
    )$$,
  '25. Tienda D puede crear su propio pedido'
);

SELECT ok(
  (SELECT number = 1001 FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000004'),
  '26. Tienda D empieza su numeracion en 1001 (independiente de Tienda C)'
);

-- ── 27-28: mark_order_paid ────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT lives_ok(
  $$SELECT public.mark_order_paid(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1001),
      'transferencia',
      'OP-12345'
    )$$,
  '27. mark_order_paid desde pendiente funciona'
);

SELECT ok(
  (SELECT status = 'pagado' AND payment_method = 'transferencia'
     AND payment_reference = 'OP-12345' AND paid_at IS NOT NULL
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1001),
  '28. Pedido queda en estado pagado con datos de pago'
);

-- ── 29: mark_order_paid en estado distinto a pendiente falla ──────────────────
SELECT throws_ok(
  $$SELECT public.mark_order_paid(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1001),
      'efectivo', NULL
    )$$,
  'P0001', NULL,
  '29. mark_order_paid desde estado pagado falla'
);

-- ── 30-31: set_order_status pagado→enviado ────────────────────────────────────
SELECT lives_ok(
  $$SELECT public.set_order_status(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1001),
      'enviado', 'Salio hoy', 'Andreani', 'TRK-999'
    )$$,
  '30. set_order_status pagado->enviado funciona'
);

SELECT ok(
  (SELECT status = 'enviado' AND shipping_carrier = 'Andreani' AND tracking_code = 'TRK-999'
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1001),
  '31. Estado enviado con transportista y tracking correctos'
);

-- ── 32: set_order_status enviado→entregado ────────────────────────────────────
SELECT lives_ok(
  $$SELECT public.set_order_status(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1001),
      'entregado', NULL, NULL, NULL
    )$$,
  '32. set_order_status enviado->entregado funciona'
);

-- ── 33: Transición inválida falla ─────────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.set_order_status(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1002),
      'entregado', NULL, NULL, NULL
    )$$,
  'P0001', NULL,
  '33. Transicion pendiente->entregado falla (invalida)'
);

-- ── 34-38: cancel_order ───────────────────────────────────────────────────────
-- Pedido #1002 de tienda C esta en pendiente, tiene 1 unidad de PEL-3
SELECT ok(
  (SELECT stock = 46 FROM public.product_variants
   WHERE id = '50000000-0000-0000-0003-000000000002'),
  '34. PEL-3 tiene stock 46 (pedido #1001 desconto 3 + pedido #1002 desconto 1)'
);

SELECT lives_ok(
  $$SELECT public.cancel_order(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1002),
      'Cliente cambio de opinion'
    )$$,
  '35. cancel_order desde pendiente funciona'
);

SELECT ok(
  (SELECT status = 'cancelado'
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1002),
  '36. Pedido cancelado tiene status = cancelado'
);

SELECT ok(
  (SELECT stock = 47 FROM public.product_variants
   WHERE id = '50000000-0000-0000-0003-000000000002'),
  '37. cancel_order repone el stock (PEL-3 sube de 46 a 47)'
);

SELECT ok(
  (SELECT count(*) > 0
   FROM public.stock_movements
   WHERE variant_id = '50000000-0000-0000-0003-000000000002'
     AND reason LIKE 'Cancelación - pedido #%'
     AND delta = 1),
  '38. stock_movements registra cancelacion con motivo Cancelacion - pedido #'
);

-- ── 39-40: cancelar dos veces no repone dos veces ─────────────────────────────
SELECT lives_ok(
  $$SELECT public.cancel_order(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1002),
      'Segunda llamada'
    )$$,
  '39. cancel_order llamado dos veces es idempotente (no falla)'
);

SELECT ok(
  (SELECT stock = 47 FROM public.product_variants
   WHERE id = '50000000-0000-0000-0003-000000000002'),
  '40. Stock no se repone dos veces al cancelar dos veces (sigue en 47)'
);

-- ── 41: cancel_order en entregado falla ──────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.cancel_order(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1001),
      'intento de cancelar entregado'
    )$$,
  'P0001', NULL,
  '41. cancel_order en pedido entregado falla'
);

-- ── 42-44: update_order_shipping ─────────────────────────────────────────────
-- Crear pedido especifico para testear update_order_shipping
SELECT lives_ok(
  $$SELECT public.create_order(
      '{"name":"Test Envio"}'::jsonb,
      '{"method":"domicilio","street":"Corrientes 1234","postal_code":"1043"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000001","quantity":1}]'::jsonb,
      NULL, 'panel'
    )$$,
  '42. Pedido de domicilio creado para testear update_order_shipping'
);

SELECT lives_ok(
  $$SELECT public.update_order_shipping(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1003),
      1500, 'OCA', 'OCA-555'
    )$$,
  '43. update_order_shipping funciona'
);

SELECT ok(
  (SELECT shipping_cost = 1500
     AND total = subtotal + 1500
     AND shipping_carrier = 'OCA'
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1003),
  '44. total recalculado correctamente (subtotal + shipping_cost)'
);

-- ── 45: update_order_shipping en cancelado falla ─────────────────────────────
SELECT throws_ok(
  $$SELECT public.update_order_shipping(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1002),
      500, NULL, NULL
    )$$,
  'P0001', NULL,
  '45. update_order_shipping en pedido cancelado falla'
);

-- ── 46-49: Aislamiento entre tiendas ─────────────────────────────────────────
-- Usuario C no puede ver pedidos de Tienda D
SELECT ok(
  (SELECT count(*) = 0 FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000004'),
  '46. Usuario C NO puede ver pedidos de Tienda D (RLS)'
);

-- Usuario C no puede mark_order_paid en pedido de Tienda D
SELECT throws_ok(
  $$SELECT public.mark_order_paid(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000004'),
      'efectivo', NULL
    )$$,
  'P0002', NULL,
  '47. Usuario C no puede mark_order_paid en pedido de Tienda D'
);

-- Usuario C no puede cancel_order en pedido de Tienda D
SELECT throws_ok(
  $$SELECT public.cancel_order(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000004'),
      NULL
    )$$,
  'P0002', NULL,
  '48. Usuario C no puede cancel_order en pedido de Tienda D'
);

-- Usuario C no puede set_order_status en pedido de Tienda D
SELECT throws_ok(
  $$SELECT public.set_order_status(
      (SELECT id FROM public.orders
       WHERE store_id = '20000000-0000-0000-0000-000000000004'),
      'enviado', NULL, NULL, NULL
    )$$,
  'P0002', NULL,
  '49. Usuario C no puede set_order_status en pedido de Tienda D'
);

-- ── 50-51: Domicilio con dirección completa funciona ─────────────────────────
SELECT lives_ok(
  $$SELECT public.create_order(
      '{"name":"Domicilio OK","phone":"1133221122"}'::jsonb,
      '{"method":"domicilio","street":"Av. Santa Fe","number":"3000",
        "city":"CABA","province":"Buenos Aires","postal_code":"1425"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000001","quantity":1}]'::jsonb,
      NULL, 'whatsapp'
    )$$,
  '50. Pedido con domicilio completo (source=whatsapp) funciona'
);

SELECT ok(
  (SELECT source = 'whatsapp' FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1004),
  '51. source=whatsapp guardado correctamente'
);

-- ── 52: Source inválido falla ─────────────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.create_order(
      '{"name":"Test"}'::jsonb,
      '{"method":"retiro"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000002","quantity":1}]'::jsonb,
      NULL, 'invalido'
    )$$,
  'P0001', NULL,
  '52. Source invalido falla en create_order'
);

-- ── 53: Snapshot se preserva si el producto se archiva ───────────────────────
RESET role;
UPDATE public.products SET status = 'archived'
WHERE id = '40000000-0000-0000-0003-000000000001';

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT ok(
  (SELECT oi.product_name = 'Raqueta Pro'
   FROM public.order_items oi
   JOIN public.orders o ON o.id = oi.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000003'
     AND oi.variant_id = '50000000-0000-0000-0003-000000000001'
   LIMIT 1),
  '53. Snapshot preserva product_name aunque el producto este archivado'
);

-- ── 54-55: Timeline de eventos ───────────────────────────────────────────────
SELECT ok(
  (SELECT count(*) >= 1
   FROM public.order_events oe
   JOIN public.orders o ON o.id = oe.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000003'
     AND o.number   = 1001
     AND oe.type    = 'pagado'),
  '54. Evento pagado registrado en order_events'
);

SELECT ok(
  (SELECT count(*) >= 3
   FROM public.order_events oe
   JOIN public.orders o ON o.id = oe.order_id
   WHERE o.store_id = '20000000-0000-0000-0000-000000000003'
     AND o.number   = 1001),
  '55. Pedido #1001 tiene al menos 3 eventos (creado, pagado, estado_cambiado x2)'
);

-- ── 56-58: create_order con p_shipping_cost ──────────────────────────────────
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT lives_ok(
  $$SELECT public.create_order(
      '{"name":"Envio Pagado"}'::jsonb,
      '{"method":"domicilio","street":"Av. Rivadavia","postal_code":"1002"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000002","quantity":1}]'::jsonb,
      NULL, 'panel', 5000
    )$$,
  '56. create_order con domicilio y shipping_cost=5000 funciona'
);

SELECT ok(
  (SELECT shipping_cost = 5000 AND total = subtotal + 5000
   FROM public.orders
   WHERE store_id = '20000000-0000-0000-0000-000000000003' AND number = 1005),
  '57. shipping_cost=5000 y total=subtotal+5000 guardados en el pedido'
);

SELECT throws_ok(
  $$SELECT public.create_order(
      '{"name":"Test Negativo"}'::jsonb,
      '{"method":"domicilio","street":"Calle Falsa","postal_code":"0000"}'::jsonb,
      '[{"variant_id":"50000000-0000-0000-0003-000000000002","quantity":1}]'::jsonb,
      NULL, 'panel', -1
    )$$,
  'P0001', NULL,
  '58. shipping_cost negativo falla en create_order'
);

SELECT * FROM finish();
ROLLBACK;
