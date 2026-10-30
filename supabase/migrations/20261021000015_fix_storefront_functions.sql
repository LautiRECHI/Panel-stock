-- Migración 015: correcciones de seguridad en funciones storefront
-- ============================================================
-- Problemas corregidos:
--
-- 1. storefront_get_order, storefront_mark_order_paid, storefront_cancel_order:
--    Almacenan id de la clave en v_key_id para que el UPDATE de last_used_at
--    use el ID (índice PK O(1)) y no recompute el hash (encode+digest) dos veces.
--
-- 2. storefront_mark_order_paid, storefront_cancel_order:
--    El SELECT ... FOR UPDATE buscaba por id (UUID) sin filtrar por store_id,
--    lo que podía bloquear filas de otras tiendas antes de verificar pertenencia.
--    Corregido: agrega AND store_id = v_store_id al SELECT, lo que hace que
--    "no encontrado" y "tienda incorrecta" sean indistinguibles (ambos → P0404),
--    elimina la variable v_order_store innecesaria, y evita lock contention
--    cruzado entre tiendas.
-- ============================================================

-- =====================
-- storefront_get_order (reemplaza la de 014)
-- =====================
CREATE OR REPLACE FUNCTION public.storefront_get_order(
  p_api_key      text,
  p_public_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key_id   uuid;
  v_store_id uuid;
  v_order    RECORD;
  v_items    jsonb;
BEGIN
  IF p_api_key IS NULL OR length(trim(p_api_key)) < 10 THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  SELECT id, store_id INTO v_key_id, v_store_id
  FROM public.store_api_keys
  WHERE key_hash   = encode(extensions.digest(p_api_key::bytea, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  UPDATE public.store_api_keys SET last_used_at = now() WHERE id = v_key_id;

  IF p_public_token IS NULL OR length(trim(p_public_token)) = 0 THEN
    RAISE EXCEPTION 'Token inválido' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, number, status, payment_status,
         customer_name,
         delivery_method,
         shipping_street, shipping_number, shipping_floor,
         shipping_city, shipping_province, shipping_postal_code,
         subtotal, shipping_cost, total, currency,
         expires_at, created_at
  INTO v_order
  FROM public.orders
  WHERE public_token = p_public_token
    AND store_id     = v_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0404';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name',  oi.product_name,
    'variant_label', oi.variant_label,
    'sku',           oi.sku,
    'unit_price',    oi.unit_price,
    'quantity',      oi.quantity,
    'line_total',    oi.line_total
  ) ORDER BY oi.id)
  INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id AND oi.store_id = v_store_id;

  RETURN jsonb_build_object(
    'number',             v_order.number,
    'status',             v_order.status,
    'payment_status',     v_order.payment_status,
    'customer_name',      v_order.customer_name,
    'delivery_method',    v_order.delivery_method,
    'shipping_street',    v_order.shipping_street,
    'shipping_number',    v_order.shipping_number,
    'shipping_floor',     v_order.shipping_floor,
    'shipping_city',      v_order.shipping_city,
    'shipping_province',  v_order.shipping_province,
    'shipping_postal_code', v_order.shipping_postal_code,
    'items',              COALESCE(v_items, '[]'::jsonb),
    'subtotal',           v_order.subtotal,
    'shipping_cost',      v_order.shipping_cost,
    'total',              v_order.total,
    'currency',           v_order.currency,
    'expires_at',         v_order.expires_at,
    'created_at',         v_order.created_at
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.storefront_get_order(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.storefront_get_order(text,text) TO anon;
GRANT  EXECUTE ON FUNCTION public.storefront_get_order(text,text) TO authenticated;

-- =====================
-- storefront_mark_order_paid (reemplaza la de 014)
-- =====================
CREATE OR REPLACE FUNCTION public.storefront_mark_order_paid(
  p_api_key             text,
  p_order_id            uuid,
  p_provider            text,
  p_external_payment_id text,
  p_amount              numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key_id   uuid;
  v_store_id uuid;
  v_status   text;
  v_total    numeric(12,2);
  v_ext_id   text;
BEGIN
  IF p_api_key IS NULL OR length(trim(p_api_key)) < 10 THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  SELECT id, store_id INTO v_key_id, v_store_id
  FROM public.store_api_keys
  WHERE key_hash   = encode(extensions.digest(p_api_key::bytea, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  UPDATE public.store_api_keys SET last_used_at = now() WHERE id = v_key_id;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es requerido' USING ERRCODE = 'P0001';
  END IF;
  IF nullif(trim(coalesce(p_provider, '')), '') IS NULL THEN
    RAISE EXCEPTION 'provider es requerido' USING ERRCODE = 'P0001';
  END IF;
  IF nullif(trim(coalesce(p_external_payment_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'external_payment_id es requerido' USING ERRCODE = 'P0001';
  END IF;

  -- Filtrar por store_id en el mismo SELECT: evita lock de filas de otras tiendas
  -- y hace indistinguibles "no existe" de "no pertenece a esta tienda" (ambos → P0404).
  SELECT status, total, external_payment_id
  INTO v_status, v_total, v_ext_id
  FROM public.orders
  WHERE id = p_order_id AND store_id = v_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0404';
  END IF;

  IF v_status = 'pagado' AND v_ext_id = p_external_payment_id THEN
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true);
  END IF;

  IF v_status != 'pendiente' THEN
    RAISE EXCEPTION 'ORDER_NOT_PENDING: Estado actual: %', v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_total != p_amount THEN
    RAISE EXCEPTION 'AMOUNT_MISMATCH: Esperado %, recibido %', v_total, p_amount
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders SET
    status              = 'pagado',
    payment_status      = 'aprobado',
    payment_method      = 'otro',
    payment_provider    = trim(p_provider),
    external_payment_id = trim(p_external_payment_id),
    paid_at             = now(),
    expires_at          = NULL
  WHERE id = p_order_id AND store_id = v_store_id;

  INSERT INTO public.order_events
    (store_id, order_id, type, from_status, to_status, user_id, note)
  VALUES
    (v_store_id, p_order_id, 'pagado', 'pendiente', 'pagado', NULL,
     p_provider || ' - ' || p_external_payment_id);

  RETURN jsonb_build_object('status', 'ok', 'idempotent', false);
END;
$$;

REVOKE ALL     ON FUNCTION public.storefront_mark_order_paid(text,uuid,text,text,numeric) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.storefront_mark_order_paid(text,uuid,text,text,numeric) TO anon;
GRANT  EXECUTE ON FUNCTION public.storefront_mark_order_paid(text,uuid,text,text,numeric) TO authenticated;

-- =====================
-- storefront_cancel_order (reemplaza la de 014)
-- =====================
CREATE OR REPLACE FUNCTION public.storefront_cancel_order(
  p_api_key  text,
  p_order_id uuid,
  p_reason   text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key_id   uuid;
  v_store_id uuid;
  v_status   text;
  v_number   integer;
  v_item     RECORD;
BEGIN
  IF p_api_key IS NULL OR length(trim(p_api_key)) < 10 THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  SELECT id, store_id INTO v_key_id, v_store_id
  FROM public.store_api_keys
  WHERE key_hash   = encode(extensions.digest(p_api_key::bytea, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  UPDATE public.store_api_keys SET last_used_at = now() WHERE id = v_key_id;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es requerido' USING ERRCODE = 'P0001';
  END IF;

  -- Filtrar por store_id: evita lock cruzado entre tiendas.
  SELECT status, number
  INTO v_status, v_number
  FROM public.orders
  WHERE id = p_order_id AND store_id = v_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0404';
  END IF;

  IF v_status = 'cancelado' THEN RETURN; END IF;

  IF v_status != 'pendiente' THEN
    RAISE EXCEPTION 'ORDER_NOT_PENDING: Solo se pueden cancelar pedidos pendientes. Estado: %',
      v_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders SET status = 'cancelado' WHERE id = p_order_id AND store_id = v_store_id;

  PERFORM set_config('app.stock_reason',
    'Cancelación online - pedido #' || v_number::text, true);

  FOR v_item IN
    SELECT variant_id, quantity
    FROM public.order_items
    WHERE order_id = p_order_id AND store_id = v_store_id
  LOOP
    UPDATE public.product_variants
    SET stock = stock + v_item.quantity
    WHERE id = v_item.variant_id AND store_id = v_store_id;
  END LOOP;

  INSERT INTO public.order_events
    (store_id, order_id, type, from_status, to_status, user_id, note)
  VALUES
    (v_store_id, p_order_id, 'cancelado', 'pendiente', 'cancelado', NULL,
     nullif(trim(coalesce(p_reason, '')), ''));
END;
$$;

REVOKE ALL     ON FUNCTION public.storefront_cancel_order(text,uuid,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.storefront_cancel_order(text,uuid,text) TO anon;
GRANT  EXECUTE ON FUNCTION public.storefront_cancel_order(text,uuid,text) TO authenticated;
