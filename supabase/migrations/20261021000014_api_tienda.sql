-- Migración 014: API de tienda (canal servidor-a-servidor)
-- ============================================================
-- Tablas:    store_api_keys
-- Columnas:  orders ← expires_at, public_token, payment_status,
--                      payment_provider, external_payment_id, customer_note
-- Funciones panel:     create_store_api_key, revoke_store_api_key
-- Funciones tienda:    storefront_create_order, storefront_get_order,
--                      storefront_mark_order_paid, storefront_cancel_order
-- Utilidad:            expire_pending_orders
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================
-- store_api_keys
-- Claves de API por tienda. El secreto NUNCA se guarda; solo su SHA-256.
-- key_prefix = primeros 8 caracteres del secreto (display).
-- =====================
CREATE TABLE public.store_api_keys (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name         text        NOT NULL
                           CHECK (length(trim(name)) > 0 AND length(name) <= 100),
  key_prefix   text        NOT NULL CHECK (length(key_prefix) = 8),
  key_hash     text        NOT NULL UNIQUE,
  created_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX idx_store_api_keys_store_id ON public.store_api_keys(store_id);
CREATE INDEX idx_store_api_keys_hash
  ON public.store_api_keys(key_hash) WHERE revoked_at IS NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.store_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_api_keys_select"
  ON public.store_api_keys FOR SELECT TO authenticated
  USING (public.is_store_member(store_id));

CREATE POLICY "store_api_keys_insert"
  ON public.store_api_keys FOR INSERT TO authenticated
  WITH CHECK (public.is_store_owner(store_id));

CREATE POLICY "store_api_keys_update"
  ON public.store_api_keys FOR UPDATE TO authenticated
  USING     (public.is_store_owner(store_id))
  WITH CHECK (public.is_store_owner(store_id));

-- =====================
-- Nuevas columnas en orders
-- =====================
ALTER TABLE public.orders
  ADD COLUMN expires_at          timestamptz,
  ADD COLUMN public_token        text
                                 CHECK (public_token IS NULL OR length(public_token) >= 32),
  ADD COLUMN payment_status      text
                                 CHECK (payment_status IS NULL OR payment_status IN
                                   ('pendiente','aprobado','rechazado','vencido')),
  ADD COLUMN payment_provider    text
                                 CHECK (payment_provider IS NULL OR length(payment_provider) <= 50),
  ADD COLUMN external_payment_id text
                                 CHECK (external_payment_id IS NULL OR length(external_payment_id) <= 200),
  ADD COLUMN customer_note       text
                                 CHECK (customer_note IS NULL OR length(customer_note) <= 1000);

-- public_token único entre todos los pedidos (sparse)
CREATE UNIQUE INDEX idx_orders_public_token
  ON public.orders(public_token) WHERE public_token IS NOT NULL;

-- external_payment_id único por tienda (idempotencia webhooks)
CREATE UNIQUE INDEX idx_orders_external_payment_id
  ON public.orders(store_id, external_payment_id) WHERE external_payment_id IS NOT NULL;

CREATE INDEX idx_orders_expires_at
  ON public.orders(store_id, expires_at)
  WHERE expires_at IS NOT NULL AND status = 'pendiente';

-- ── Ampliar CHECK de order_events.type para incluir 'vencido' ─────────────────
ALTER TABLE public.order_events DROP CONSTRAINT IF EXISTS order_events_type_check;
ALTER TABLE public.order_events
  ADD CONSTRAINT order_events_type_check
  CHECK (type IN ('creado','pagado','estado_cambiado','cancelado','nota','vencido'));

-- =====================
-- create_store_api_key
-- Genera un secreto aleatorio fuerte, guarda solo su hash y devuelve el
-- secreto UNA sola vez en el campo «secret» del JSONB.
-- SECURITY INVOKER: RLS verifica que el llamador sea owner de la tienda.
-- =====================
CREATE OR REPLACE FUNCTION public.create_store_api_key(
  p_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_store_id   uuid;
  v_secret     text;
  v_key_prefix text;
  v_key_hash   text;
  v_key_id     uuid;
  v_created_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_store_id FROM public.stores LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a ninguna tienda' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_store_owner(v_store_id) THEN
    RAISE EXCEPTION 'Solo los dueños pueden crear claves de API' USING ERRCODE = '28000';
  END IF;

  IF nullif(trim(coalesce(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'El nombre es requerido' USING ERRCODE = 'P0001';
  END IF;

  -- pdolive_ (8 chars) + 32 bytes en hex (64 chars) = 72 chars total; > 32 bytes de entropía
  v_secret     := 'pdolive_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_key_prefix := left(v_secret, 8);
  v_key_hash   := encode(extensions.digest(v_secret::bytea, 'sha256'), 'hex');

  INSERT INTO public.store_api_keys (store_id, name, key_prefix, key_hash, created_by)
  VALUES (v_store_id, trim(p_name), v_key_prefix, v_key_hash, auth.uid())
  RETURNING id, created_at INTO v_key_id, v_created_at;

  RETURN jsonb_build_object(
    'id',         v_key_id,
    'name',       trim(p_name),
    'key_prefix', v_key_prefix,
    'secret',     v_secret,
    'created_at', v_created_at
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.create_store_api_key(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_store_api_key(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_store_api_key(text) TO authenticated;

-- =====================
-- revoke_store_api_key
-- =====================
CREATE OR REPLACE FUNCTION public.revoke_store_api_key(
  p_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_store_id FROM public.stores LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a ninguna tienda' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_store_owner(v_store_id) THEN
    RAISE EXCEPTION 'Solo los dueños pueden revocar claves de API' USING ERRCODE = '28000';
  END IF;

  UPDATE public.store_api_keys
  SET revoked_at = now()
  WHERE id = p_id AND store_id = v_store_id AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clave no encontrada o ya revocada' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL     ON FUNCTION public.revoke_store_api_key(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_store_api_key(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revoke_store_api_key(uuid) TO authenticated;

-- =====================
-- expire_pending_orders
-- Cancela pedidos online vencidos (expires_at < now()) y repone stock.
-- SECURITY DEFINER: bypasses RLS para procesar pedidos sin sesión de usuario.
-- Idempotente: FOR UPDATE SKIP LOCKED evita doble procesamiento bajo concurrencia.
-- Returns: número de pedidos expirados.
--
-- pg_cron (cuando esté disponible en Supabase):
--   SELECT cron.schedule('expire-orders', '*/15 * * * *',
--     $$SELECT public.expire_pending_orders()$$);
-- =====================
CREATE OR REPLACE FUNCTION public.expire_pending_orders(
  p_store_id uuid DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order RECORD;
  v_item  RECORD;
  v_count integer := 0;
BEGIN
  FOR v_order IN
    SELECT id, store_id, number
    FROM public.orders
    WHERE status     = 'pendiente'
      AND source     = 'tienda'
      AND expires_at IS NOT NULL
      AND expires_at < now()
      AND (p_store_id IS NULL OR store_id = p_store_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.orders
    SET status = 'cancelado', payment_status = 'vencido'
    WHERE id = v_order.id;

    PERFORM set_config('app.stock_reason',
      'Vencimiento - pedido #' || v_order.number::text, true);

    FOR v_item IN
      SELECT variant_id, quantity
      FROM public.order_items
      WHERE order_id = v_order.id AND store_id = v_order.store_id
    LOOP
      UPDATE public.product_variants
      SET stock = stock + v_item.quantity
      WHERE id = v_item.variant_id AND store_id = v_order.store_id;
    END LOOP;

    INSERT INTO public.order_events
      (store_id, order_id, type, from_status, to_status, user_id, note)
    VALUES
      (v_order.store_id, v_order.id, 'vencido', 'pendiente', 'cancelado',
       NULL, 'Vencimiento automático');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Solo authenticated (para llamadas desde el panel) y el propio postgres
-- (para llamadas desde storefront_create_order, que corre como SECURITY DEFINER).
-- anon no puede llamarla directamente.
REVOKE ALL     ON FUNCTION public.expire_pending_orders(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_pending_orders(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.expire_pending_orders(uuid) TO authenticated;

-- =====================
-- storefront_create_order
-- Crea un pedido desde el servidor de la tienda.
-- La tienda se deriva SIEMPRE de la clave de API, nunca de parámetros.
-- Los precios se recalculan desde la BD; se ignoran los del payload.
-- SECURITY DEFINER + search_path vacío para máxima seguridad.
-- =====================
CREATE OR REPLACE FUNCTION public.storefront_create_order(
  p_api_key          text,
  p_customer         jsonb,
  p_delivery         jsonb,
  p_items            jsonb,
  p_customer_note    text DEFAULT NULL,
  p_expires_in_hours int  DEFAULT 48
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key_id          uuid;
  v_store_id        uuid;
  v_order_id        uuid;
  v_order_num       integer;
  v_subtotal        numeric(12,2) := 0;
  v_item            jsonb;
  v_variant_id      uuid;
  v_quantity        integer;
  v_unit_price      numeric(12,2);
  v_product_id      uuid;
  v_product_name    text;
  v_variant_label   text;
  v_sku             text;
  v_stock           integer;
  v_delivery_method text;
  v_shipping_cost   integer;
  v_public_token    text;
  v_expires_at      timestamptz;
  v_rate_count      integer;
  v_item_count      integer;
  v_customer_email  text;
  v_customer_phone  text;
BEGIN
  -- ── Validar clave de API ───────────────────────────────────────────────────
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

  -- ── Expirar pedidos vencidos de esta tienda (oportunístico) ───────────────
  PERFORM public.expire_pending_orders(v_store_id);

  -- ── Validar método de entrega ─────────────────────────────────────────────
  v_delivery_method := lower(trim(coalesce(p_delivery->>'method', '')));
  IF v_delivery_method NOT IN ('retiro','domicilio') THEN
    RAISE EXCEPTION 'Método de entrega inválido: %', v_delivery_method USING ERRCODE = 'P0001';
  END IF;

  IF v_delivery_method = 'domicilio' THEN
    IF nullif(trim(coalesce(p_delivery->>'street', '')), '') IS NULL THEN
      RAISE EXCEPTION 'La calle es requerida para envío a domicilio' USING ERRCODE = 'P0001';
    END IF;
    IF nullif(trim(coalesce(p_delivery->>'postal_code', '')), '') IS NULL THEN
      RAISE EXCEPTION 'El código postal es requerido para envío a domicilio' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- shipping_cost: solo para domicilio; retiro siempre NULL
  IF v_delivery_method = 'domicilio' THEN
    v_shipping_cost := nullif(p_delivery->>'shipping_cost', '')::integer;
    IF v_shipping_cost IS NOT NULL AND v_shipping_cost < 0 THEN
      RAISE EXCEPTION 'El costo de envío no puede ser negativo' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_shipping_cost := NULL;
  END IF;

  -- ── Validar cliente ───────────────────────────────────────────────────────
  IF nullif(trim(coalesce(p_customer->>'name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'El nombre del cliente es requerido' USING ERRCODE = 'P0001';
  END IF;

  v_customer_email := nullif(lower(trim(coalesce(p_customer->>'email', ''))), '');
  v_customer_phone := nullif(trim(coalesce(p_customer->>'phone', '')), '');

  -- ── Rate limiting: máx 3 pedidos pendientes por email o teléfono en 24 h ──
  IF v_customer_email IS NOT NULL THEN
    SELECT count(*) INTO v_rate_count
    FROM public.orders
    WHERE store_id     = v_store_id
      AND source       = 'tienda'
      AND status       = 'pendiente'
      AND customer_email = v_customer_email
      AND created_at   > now() - interval '24 hours';
    IF v_rate_count >= 3 THEN
      RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'P0429';
    END IF;
  END IF;

  IF v_customer_phone IS NOT NULL THEN
    SELECT count(*) INTO v_rate_count
    FROM public.orders
    WHERE store_id     = v_store_id
      AND source       = 'tienda'
      AND status       = 'pendiente'
      AND customer_phone = v_customer_phone
      AND created_at   > now() - interval '24 hours';
    IF v_rate_count >= 3 THEN
      RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'P0429';
    END IF;
  END IF;

  -- ── Validar ítems ─────────────────────────────────────────────────────────
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un ítem' USING ERRCODE = 'P0001';
  END IF;

  v_item_count := jsonb_array_length(p_items);
  IF v_item_count > 30 THEN
    RAISE EXCEPTION 'Máximo 30 ítems por pedido (enviados: %)', v_item_count
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0' USING ERRCODE = 'P0001';
    END IF;
    IF v_quantity > 20 THEN
      RAISE EXCEPTION 'Máximo 20 unidades por variante (solicitado: %)', v_quantity
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- ── Advisory lock por tienda ──────────────────────────────────────────────
  PERFORM pg_advisory_xact_lock(42, abs(hashtext(v_store_id::text)));

  -- ── Fase 1: validar stock y recalcular precios desde la BD ────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    IF v_variant_id IS NULL THEN
      RAISE EXCEPTION 'variant_id es requerido en cada ítem' USING ERRCODE = 'P0001';
    END IF;

    -- Precios siempre desde la BD; se ignoran los del payload
    SELECT pv.stock,
           pv.product_id,
           pv.sku,
           COALESCE(pv.price, p.price),
           p.name,
           COALESCE(
             (SELECT string_agg(value, ' / ' ORDER BY key)
              FROM jsonb_each_text(pv.attributes)),
             ''
           )
    INTO v_stock, v_product_id, v_sku, v_unit_price, v_product_name, v_variant_label
    FROM public.product_variants pv
    JOIN public.products p
      ON p.id = pv.product_id AND p.store_id = pv.store_id
    WHERE pv.id       = v_variant_id
      AND pv.store_id = v_store_id
      AND p.status    = 'active'
      AND pv.is_active = true
    FOR UPDATE OF pv;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'OUT_OF_STOCK: Variante % no disponible', v_variant_id
        USING ERRCODE = 'P0404';
    END IF;

    IF v_stock < v_quantity THEN
      RAISE EXCEPTION 'OUT_OF_STOCK: Stock insuficiente para % (SKU: %). Disponible: %, solicitado: %',
        v_product_name, v_sku, v_stock, v_quantity
        USING ERRCODE = 'P0409';
    END IF;

    v_subtotal := v_subtotal + (v_unit_price * v_quantity);
  END LOOP;

  -- ── Generar token público y fecha de vencimiento ──────────────────────────
  v_public_token := encode(extensions.gen_random_bytes(16), 'hex');  -- 128 bits de entropía
  v_expires_at   := CASE WHEN coalesce(p_expires_in_hours, 48) > 0
                         THEN now() + (coalesce(p_expires_in_hours, 48) * interval '1 hour')
                         ELSE NULL END;

  -- ── Número correlativo ─────────────────────────────────────────────────────
  SELECT COALESCE(MAX(number), 1000) + 1 INTO v_order_num
  FROM public.orders WHERE store_id = v_store_id;

  -- ── Insertar pedido ────────────────────────────────────────────────────────
  INSERT INTO public.orders (
    store_id, number, status,
    customer_name, customer_email, customer_phone,
    delivery_method,
    shipping_street, shipping_number, shipping_floor,
    shipping_city, shipping_province, shipping_postal_code, shipping_notes,
    subtotal, shipping_cost, total, currency,
    source, customer_note,
    expires_at, public_token, payment_status
  ) VALUES (
    v_store_id, v_order_num, 'pendiente',
    trim(p_customer->>'name'),
    v_customer_email,
    v_customer_phone,
    v_delivery_method,
    nullif(trim(coalesce(p_delivery->>'street',      '')), ''),
    nullif(trim(coalesce(p_delivery->>'number',      '')), ''),
    nullif(trim(coalesce(p_delivery->>'floor',       '')), ''),
    nullif(trim(coalesce(p_delivery->>'city',        '')), ''),
    nullif(trim(coalesce(p_delivery->>'province',    '')), ''),
    nullif(trim(coalesce(p_delivery->>'postal_code', '')), ''),
    nullif(trim(coalesce(p_delivery->>'notes',       '')), ''),
    v_subtotal,
    v_shipping_cost,
    v_subtotal + COALESCE(v_shipping_cost, 0),
    'ARS',
    'tienda',
    nullif(trim(coalesce(p_customer_note, '')), ''),
    v_expires_at,
    v_public_token,
    'pendiente'
  )
  RETURNING id INTO v_order_id;

  -- ── Fase 2: insertar ítems y descontar stock ──────────────────────────────
  PERFORM set_config('app.stock_reason',
    'Venta online - pedido #' || v_order_num::text, true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    SELECT pv.product_id,
           pv.sku,
           COALESCE(pv.price, p.price),
           p.name,
           COALESCE(
             (SELECT string_agg(value, ' / ' ORDER BY key)
              FROM jsonb_each_text(pv.attributes)),
             ''
           )
    INTO v_product_id, v_sku, v_unit_price, v_product_name, v_variant_label
    FROM public.product_variants pv
    JOIN public.products p
      ON p.id = pv.product_id AND p.store_id = pv.store_id
    WHERE pv.id = v_variant_id AND pv.store_id = v_store_id;

    INSERT INTO public.order_items (
      store_id, order_id, product_id, variant_id,
      product_name, variant_label, sku,
      unit_price, quantity, line_total
    ) VALUES (
      v_store_id, v_order_id, v_product_id, v_variant_id,
      v_product_name, v_variant_label, v_sku,
      v_unit_price, v_quantity, v_unit_price * v_quantity
    );

    UPDATE public.product_variants
    SET stock = stock - v_quantity
    WHERE id = v_variant_id AND store_id = v_store_id;
  END LOOP;

  -- ── Evento ─────────────────────────────────────────────────────────────────
  INSERT INTO public.order_events (store_id, order_id, type, to_status, user_id)
  VALUES (v_store_id, v_order_id, 'creado', 'pendiente', NULL);

  RETURN jsonb_build_object(
    'id',            v_order_id,
    'number',        v_order_num,
    'public_token',  v_public_token,
    'subtotal',      v_subtotal,
    'shipping_cost', v_shipping_cost,
    'total',         v_subtotal + COALESCE(v_shipping_cost, 0),
    'expires_at',    v_expires_at
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.storefront_create_order(text,jsonb,jsonb,jsonb,text,int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.storefront_create_order(text,jsonb,jsonb,jsonb,text,int) TO anon;
GRANT  EXECUTE ON FUNCTION public.storefront_create_order(text,jsonb,jsonb,jsonb,text,int) TO authenticated;

-- =====================
-- storefront_get_order
-- Devuelve SOLO campos seguros para el cliente (sin datos internos).
-- =====================
CREATE OR REPLACE FUNCTION public.storefront_get_order(
  p_api_key     text,
  p_public_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_store_id uuid;
  v_order    RECORD;
  v_items    jsonb;
BEGIN
  -- Validar clave
  IF p_api_key IS NULL OR length(trim(p_api_key)) < 10 THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  SELECT store_id INTO v_store_id
  FROM public.store_api_keys
  WHERE key_hash   = encode(extensions.digest(p_api_key::bytea, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  UPDATE public.store_api_keys
  SET last_used_at = now()
  WHERE key_hash = encode(extensions.digest(p_api_key::bytea, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  IF p_public_token IS NULL OR length(trim(p_public_token)) = 0 THEN
    RAISE EXCEPTION 'Token inválido' USING ERRCODE = 'P0001';
  END IF;

  -- Solo campos seguros para el cliente
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
    'number',        v_order.number,
    'status',        v_order.status,
    'payment_status', v_order.payment_status,
    'customer_name', v_order.customer_name,
    'delivery_method', v_order.delivery_method,
    'shipping_street', v_order.shipping_street,
    'shipping_number', v_order.shipping_number,
    'shipping_floor',  v_order.shipping_floor,
    'shipping_city',   v_order.shipping_city,
    'shipping_province', v_order.shipping_province,
    'shipping_postal_code', v_order.shipping_postal_code,
    'items',         COALESCE(v_items, '[]'::jsonb),
    'subtotal',      v_order.subtotal,
    'shipping_cost', v_order.shipping_cost,
    'total',         v_order.total,
    'currency',      v_order.currency,
    'expires_at',    v_order.expires_at,
    'created_at',    v_order.created_at
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.storefront_get_order(text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.storefront_get_order(text,text) TO anon;
GRANT  EXECUTE ON FUNCTION public.storefront_get_order(text,text) TO authenticated;

-- =====================
-- storefront_mark_order_paid
-- El monto debe coincidir exactamente con el total del pedido.
-- Idempotente: si ya está pagado con el mismo external_payment_id, devuelve OK.
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
  v_store_id      uuid;
  v_order_store   uuid;
  v_status        text;
  v_total         numeric(12,2);
  v_ext_id        text;
BEGIN
  -- Validar clave
  IF p_api_key IS NULL OR length(trim(p_api_key)) < 10 THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  SELECT store_id INTO v_store_id
  FROM public.store_api_keys
  WHERE key_hash   = encode(extensions.digest(p_api_key::bytea, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  UPDATE public.store_api_keys
  SET last_used_at = now()
  WHERE key_hash = encode(extensions.digest(p_api_key::bytea, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  -- Validar parámetros
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es requerido' USING ERRCODE = 'P0001';
  END IF;
  IF nullif(trim(coalesce(p_provider, '')), '') IS NULL THEN
    RAISE EXCEPTION 'provider es requerido' USING ERRCODE = 'P0001';
  END IF;
  IF nullif(trim(coalesce(p_external_payment_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'external_payment_id es requerido' USING ERRCODE = 'P0001';
  END IF;

  SELECT store_id, status, total, external_payment_id
  INTO v_order_store, v_status, v_total, v_ext_id
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0404';
  END IF;

  -- El pedido debe pertenecer a la tienda de la clave
  IF v_order_store IS DISTINCT FROM v_store_id THEN
    RAISE EXCEPTION 'INVALID_ORDER: El pedido no pertenece a esta tienda'
      USING ERRCODE = 'P0404';
  END IF;

  -- Idempotente: mismo external_payment_id y ya pagado → OK sin duplicar
  IF v_status = 'pagado' AND v_ext_id = p_external_payment_id THEN
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true);
  END IF;

  IF v_status != 'pendiente' THEN
    RAISE EXCEPTION 'ORDER_NOT_PENDING: Estado actual: %', v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Verificar monto exacto
  IF v_total != p_amount THEN
    RAISE EXCEPTION 'AMOUNT_MISMATCH: Esperado %, recibido %', v_total, p_amount
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders SET
    status             = 'pagado',
    payment_status     = 'aprobado',
    payment_method     = 'otro',
    payment_provider   = trim(p_provider),
    external_payment_id = trim(p_external_payment_id),
    paid_at            = now(),
    expires_at         = NULL
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
-- storefront_cancel_order
-- Solo pedidos pendientes. Repone stock. Idempotente.
-- =====================
CREATE OR REPLACE FUNCTION public.storefront_cancel_order(
  p_api_key  text,
  p_order_id uuid,
  p_reason   text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_store_id    uuid;
  v_order_store uuid;
  v_status      text;
  v_number      integer;
  v_item        RECORD;
BEGIN
  -- Validar clave
  IF p_api_key IS NULL OR length(trim(p_api_key)) < 10 THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  SELECT store_id INTO v_store_id
  FROM public.store_api_keys
  WHERE key_hash   = encode(extensions.digest(p_api_key::bytea, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_KEY' USING ERRCODE = 'P0401';
  END IF;

  UPDATE public.store_api_keys
  SET last_used_at = now()
  WHERE key_hash = encode(extensions.digest(p_api_key::bytea, 'sha256'), 'hex')
    AND revoked_at IS NULL;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id es requerido' USING ERRCODE = 'P0001';
  END IF;

  SELECT store_id, status, number
  INTO v_order_store, v_status, v_number
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0404';
  END IF;

  IF v_order_store IS DISTINCT FROM v_store_id THEN
    RAISE EXCEPTION 'INVALID_ORDER: El pedido no pertenece a esta tienda'
      USING ERRCODE = 'P0404';
  END IF;

  -- Idempotente: ya cancelado → OK
  IF v_status = 'cancelado' THEN RETURN; END IF;

  IF v_status != 'pendiente' THEN
    RAISE EXCEPTION 'ORDER_NOT_PENDING: Solo se pueden cancelar pedidos pendientes. Estado: %',
      v_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders SET status = 'cancelado' WHERE id = p_order_id;

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
