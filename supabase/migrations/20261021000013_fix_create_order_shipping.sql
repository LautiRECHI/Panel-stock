-- Migración 013: agrega p_shipping_cost a create_order
-- El pedido de domicilio ahora guarda el costo de envío desde la creación.
-- Para retiro siempre queda NULL (forzado en la función, no solo en el cliente).
-- total = subtotal + COALESCE(shipping_cost, 0) — satisface el CHECK existente.

-- Eliminar firma anterior (5 args)
DROP FUNCTION IF EXISTS public.create_order(jsonb, jsonb, jsonb, text, text);

-- =====================
-- create_order (nueva firma: 6 args, p_shipping_cost DEFAULT NULL)
-- =====================
CREATE OR REPLACE FUNCTION public.create_order(
  p_customer      jsonb,
  p_delivery      jsonb,
  p_items         jsonb,
  p_notes         text    DEFAULT NULL,
  p_source        text    DEFAULT 'panel',
  p_shipping_cost integer DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
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
  v_source          text;
  v_shipping_cost   integer;
BEGIN
  -- Autenticación
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  -- Resolver store_id desde la sesión (RLS filtra automáticamente)
  SELECT id INTO v_store_id FROM public.stores LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a ninguna tienda' USING ERRCODE = '28000';
  END IF;

  -- Validar source
  v_source := lower(trim(coalesce(p_source, 'panel')));
  IF v_source NOT IN ('panel','tienda','whatsapp') THEN
    RAISE EXCEPTION 'Origen inválido: %. Valores permitidos: panel, tienda, whatsapp', v_source
      USING ERRCODE = 'P0001';
  END IF;

  -- Validar delivery_method
  v_delivery_method := lower(trim(p_delivery->>'method'));
  IF v_delivery_method NOT IN ('retiro','domicilio') THEN
    RAISE EXCEPTION 'Método de entrega inválido: %. Valores permitidos: retiro, domicilio', v_delivery_method
      USING ERRCODE = 'P0001';
  END IF;

  -- Validar dirección si es domicilio
  IF v_delivery_method = 'domicilio' THEN
    IF nullif(trim(coalesce(p_delivery->>'street', '')), '') IS NULL THEN
      RAISE EXCEPTION 'La calle es requerida para envío a domicilio' USING ERRCODE = 'P0001';
    END IF;
    IF nullif(trim(coalesce(p_delivery->>'postal_code', '')), '') IS NULL THEN
      RAISE EXCEPTION 'El código postal es requerido para envío a domicilio' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Validar nombre del cliente
  IF nullif(trim(coalesce(p_customer->>'name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'El nombre del cliente es requerido' USING ERRCODE = 'P0001';
  END IF;

  -- Validar que hay ítems
  IF jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un ítem' USING ERRCODE = 'P0001';
  END IF;

  -- Validar shipping_cost no negativo
  IF p_shipping_cost IS NOT NULL AND p_shipping_cost < 0 THEN
    RAISE EXCEPTION 'El costo de envío no puede ser negativo' USING ERRCODE = 'P0001';
  END IF;

  -- shipping_cost solo aplica a domicilio; retiro siempre NULL
  v_shipping_cost := CASE WHEN v_delivery_method = 'domicilio' THEN p_shipping_cost ELSE NULL END;

  -- Advisory lock por tienda: garantiza número correlativo sin gaps bajo concurrencia
  PERFORM pg_advisory_xact_lock(42, abs(hashtext(v_store_id::text)));

  -- ── FASE 1: validar stock y acumular subtotal ─────────────────────────────
  -- El FOR UPDATE en product_variants bloquea las filas para el resto de la transacción,
  -- impidiendo que otra transacción concurrente agote el stock a la vez.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_quantity   := (v_item->>'quantity')::integer;

    IF v_variant_id IS NULL THEN
      RAISE EXCEPTION 'variant_id es requerido en cada ítem' USING ERRCODE = 'P0001';
    END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0' USING ERRCODE = 'P0001';
    END IF;

    SELECT pv.stock,
           pv.product_id,
           pv.sku,
           COALESCE(pv.price, p.price),
           p.name,
           COALESCE(
             (SELECT string_agg(value, ' / ' ORDER BY key)
              FROM   jsonb_each_text(pv.attributes)),
             ''
           )
    INTO v_stock, v_product_id, v_sku, v_unit_price, v_product_name, v_variant_label
    FROM public.product_variants pv
    JOIN public.products p
      ON p.id = pv.product_id AND p.store_id = pv.store_id
    WHERE pv.id = v_variant_id AND pv.store_id = v_store_id
    FOR UPDATE OF pv;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variante % no encontrada en esta tienda', v_variant_id
        USING ERRCODE = 'P0002';
    END IF;

    IF v_stock < v_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente para % (SKU: %). Disponible: %, solicitado: %',
        v_product_name, v_sku, v_stock, v_quantity
        USING ERRCODE = 'P0001';
    END IF;

    v_subtotal := v_subtotal + (v_unit_price * v_quantity);
  END LOOP;

  -- ── Número correlativo por tienda ─────────────────────────────────────────
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
    source, notes
  ) VALUES (
    v_store_id, v_order_num, 'pendiente',
    trim(p_customer->>'name'),
    nullif(trim(coalesce(p_customer->>'email', '')), ''),
    nullif(trim(coalesce(p_customer->>'phone', '')), ''),
    v_delivery_method,
    nullif(trim(coalesce(p_delivery->>'street',      '')), ''),
    nullif(trim(coalesce(p_delivery->>'number',      '')), ''),
    nullif(trim(coalesce(p_delivery->>'floor',       '')), ''),
    nullif(trim(coalesce(p_delivery->>'city',        '')), ''),
    nullif(trim(coalesce(p_delivery->>'province',    '')), ''),
    nullif(trim(coalesce(p_delivery->>'postal_code', '')), ''),
    nullif(trim(coalesce(p_delivery->>'notes',       '')), ''),
    v_subtotal, v_shipping_cost, v_subtotal + COALESCE(v_shipping_cost, 0), 'ARS',
    v_source,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  RETURNING id INTO v_order_id;

  -- ── FASE 2: insertar ítems y descontar stock ───────────────────────────────
  -- Los FOR UPDATE del fase 1 siguen activos; los datos son consistentes.
  PERFORM set_config('app.stock_reason', 'Venta - pedido #' || v_order_num::text, true);

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
              FROM   jsonb_each_text(pv.attributes)),
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

  -- Registrar evento
  INSERT INTO public.order_events (store_id, order_id, type, to_status, user_id)
  VALUES (v_store_id, v_order_id, 'creado', 'pendiente', auth.uid());

  RETURN v_order_id;
END;
$$;

REVOKE ALL     ON FUNCTION public.create_order(jsonb, jsonb, jsonb, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb, text, text, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb, text, text, integer) TO authenticated;
