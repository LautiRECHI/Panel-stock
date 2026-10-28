-- Migración 012: Pedidos
-- ============================================================
-- Tablas: orders, order_items, order_events
-- Funciones: create_order, mark_order_paid, set_order_status,
--            cancel_order, update_order_shipping
-- RLS en las tres tablas (patrón del proyecto).
-- order_events es inmutable (trigger impide UPDATE y DELETE).
-- El número correlativo por tienda se garantiza con advisory lock.
-- ============================================================

-- =====================
-- orders
-- =====================
CREATE TABLE public.orders (
  id                   uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id             uuid           NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  number               integer        NOT NULL,
  status               text           NOT NULL DEFAULT 'pendiente'
                                      CHECK (status IN ('pendiente','pagado','enviado','entregado','cancelado')),
  customer_name        text           NOT NULL
                                      CHECK (length(trim(customer_name)) > 0 AND length(customer_name) <= 200),
  customer_email       text
                                      CHECK (customer_email IS NULL OR (
                                        customer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                                        AND length(customer_email) <= 200
                                      )),
  customer_phone       text
                                      CHECK (customer_phone IS NULL OR length(customer_phone) <= 50),
  delivery_method      text           NOT NULL
                                      CHECK (delivery_method IN ('retiro','domicilio')),
  -- Dirección de envío (obligatoria solo si delivery_method = 'domicilio')
  shipping_street      text           CHECK (shipping_street      IS NULL OR length(shipping_street)      <= 200),
  shipping_number      text           CHECK (shipping_number      IS NULL OR length(shipping_number)      <=  20),
  shipping_floor       text           CHECK (shipping_floor       IS NULL OR length(shipping_floor)       <=  50),
  shipping_city        text           CHECK (shipping_city        IS NULL OR length(shipping_city)        <= 100),
  shipping_province    text           CHECK (shipping_province    IS NULL OR length(shipping_province)    <= 100),
  shipping_postal_code text           CHECK (shipping_postal_code IS NULL OR length(shipping_postal_code) <=  20),
  shipping_notes       text           CHECK (shipping_notes       IS NULL OR length(shipping_notes)       <= 500),
  -- Envío
  shipping_cost        integer        CHECK (shipping_cost IS NULL OR shipping_cost >= 0),
  shipping_carrier     text           CHECK (shipping_carrier IS NULL OR length(shipping_carrier) <= 100),
  tracking_code        text           CHECK (tracking_code   IS NULL OR length(tracking_code)    <= 200),
  -- Totales
  subtotal             numeric(12,2)  NOT NULL CHECK (subtotal >= 0),
  total                numeric(12,2)  NOT NULL CHECK (total    >= 0),
  currency             text           NOT NULL DEFAULT 'ARS' CHECK (length(currency) = 3),
  -- Pago
  payment_method       text
                                      CHECK (payment_method IS NULL OR payment_method IN
                                        ('transferencia','efectivo','mercadopago','dlocalgo','otro')),
  payment_reference    text           CHECK (payment_reference IS NULL OR length(payment_reference) <= 300),
  paid_at              timestamptz,
  paid_by              uuid           REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Origen
  source               text           NOT NULL DEFAULT 'panel'
                                      CHECK (source IN ('panel','tienda','whatsapp')),
  notes                text           CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at           timestamptz    NOT NULL DEFAULT now(),
  updated_at           timestamptz    NOT NULL DEFAULT now(),
  -- El total debe ser subtotal + costo de envío (0 si es «a confirmar»)
  CONSTRAINT chk_orders_number_range    CHECK (number >= 1001),
  CONSTRAINT chk_orders_total_correct   CHECK (total = subtotal + COALESCE(shipping_cost, 0)),
  -- Domicilio exige calle y código postal
  CONSTRAINT chk_orders_domicilio_addr  CHECK (
    delivery_method != 'domicilio' OR (
      shipping_street      IS NOT NULL AND length(trim(shipping_street))      > 0 AND
      shipping_postal_code IS NOT NULL AND length(trim(shipping_postal_code)) > 0
    )
  ),
  UNIQUE (store_id, number),
  UNIQUE (store_id, id)   -- ancla para FK compuesta en order_items / order_events
);

CREATE INDEX idx_orders_store_id ON public.orders(store_id);
CREATE INDEX idx_orders_status   ON public.orders(store_id, status);
CREATE INDEX idx_orders_created  ON public.orders(store_id, created_at DESC);

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER orders_prevent_store_id_change
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_change();

-- =====================
-- order_items
-- Snapshots: el pedido conserva product_name/sku/price aunque el producto cambie.
-- =====================
CREATE TABLE public.order_items (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid           NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id       uuid           NOT NULL,
  product_id     uuid,           -- referencia blanda; puede quedar NULL si el producto se borra
  variant_id     uuid,
  product_name   text           NOT NULL
                                CHECK (length(trim(product_name)) > 0 AND length(product_name) <= 300),
  variant_label  text           NOT NULL DEFAULT '',
  sku            text           NOT NULL CHECK (length(trim(sku)) > 0 AND length(sku) <= 100),
  unit_price     numeric(12,2)  NOT NULL CHECK (unit_price >= 0),
  quantity       integer        NOT NULL CHECK (quantity > 0),
  line_total     numeric(12,2)  NOT NULL CHECK (line_total >= 0),
  CONSTRAINT chk_order_items_line_total CHECK (line_total = unit_price * quantity)
);

ALTER TABLE public.order_items
  ADD CONSTRAINT fk_order_items_order
  FOREIGN KEY (store_id, order_id) REFERENCES public.orders(store_id, id)
  ON DELETE CASCADE;

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_order_items_store_id ON public.order_items(store_id);

-- =====================
-- order_events  — auditoría INMUTABLE
-- =====================
CREATE TABLE public.order_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_id    uuid        NOT NULL,
  type        text        NOT NULL CHECK (type IN ('creado','pagado','estado_cambiado','cancelado','nota')),
  from_status text        CHECK (from_status IS NULL OR from_status IN ('pendiente','pagado','enviado','entregado','cancelado')),
  to_status   text        CHECK (to_status   IS NULL OR to_status   IN ('pendiente','pagado','enviado','entregado','cancelado')),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  note        text        CHECK (note IS NULL OR length(note) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_events
  ADD CONSTRAINT fk_order_events_order
  FOREIGN KEY (store_id, order_id) REFERENCES public.orders(store_id, id)
  ON DELETE CASCADE;

CREATE INDEX idx_order_events_order_id ON public.order_events(order_id);
CREATE INDEX idx_order_events_store_id ON public.order_events(store_id);

-- Trigger: impide UPDATE y DELETE en order_events (historial inmutable)
CREATE OR REPLACE FUNCTION public.prevent_order_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Los eventos de pedido son inmutables' USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_order_event_mutation() FROM PUBLIC;

CREATE TRIGGER order_events_immutable
  BEFORE UPDATE OR DELETE ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_order_event_mutation();

-- =====================
-- Row Level Security
-- =====================
ALTER TABLE public.orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

-- orders: cualquier miembro puede crear y ver pedidos de su tienda
CREATE POLICY "orders_select" ON public.orders FOR SELECT TO authenticated
  USING (public.is_store_member(store_id));
CREATE POLICY "orders_insert" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.is_store_member(store_id));
CREATE POLICY "orders_update" ON public.orders FOR UPDATE TO authenticated
  USING     (public.is_store_member(store_id))
  WITH CHECK (public.is_store_member(store_id));

-- order_items: misma lógica; no UPDATE ni DELETE directo (snapshots inmutables)
CREATE POLICY "order_items_select" ON public.order_items FOR SELECT TO authenticated
  USING (public.is_store_member(store_id));
CREATE POLICY "order_items_insert" ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (public.is_store_member(store_id));

-- order_events: SELECT e INSERT directos (el trigger evita UPDATE y DELETE)
CREATE POLICY "order_events_select" ON public.order_events FOR SELECT TO authenticated
  USING (public.is_store_member(store_id));
CREATE POLICY "order_events_insert" ON public.order_events FOR INSERT TO authenticated
  WITH CHECK (public.is_store_member(store_id));

-- =====================
-- create_order
-- Valida stock, recalcula precios desde la BD, genera número correlativo,
-- descuenta stock y registra el evento «creado». Completamente atómico.
-- SECURITY INVOKER: RLS se aplica en todos los INSERTs.
-- El store_id se resuelve desde la sesión, NUNCA desde el cliente.
-- =====================
CREATE OR REPLACE FUNCTION public.create_order(
  p_customer jsonb,
  p_delivery jsonb,
  p_items    jsonb,
  p_notes    text  DEFAULT NULL,
  p_source   text  DEFAULT 'panel'
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_store_id       uuid;
  v_order_id       uuid;
  v_order_num      integer;
  v_subtotal       numeric(12,2) := 0;
  v_item           jsonb;
  v_variant_id     uuid;
  v_quantity       integer;
  v_unit_price     numeric(12,2);
  v_product_id     uuid;
  v_product_name   text;
  v_variant_label  text;
  v_sku            text;
  v_stock          integer;
  v_delivery_method text;
  v_source         text;
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
    subtotal, total, currency,
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
    v_subtotal, v_subtotal, 'ARS',
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

REVOKE ALL     ON FUNCTION public.create_order(jsonb, jsonb, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb, text, text) TO authenticated;

-- =====================
-- mark_order_paid
-- Solo desde estado «pendiente». Guarda método, referencia, paid_at, paid_by.
-- =====================
CREATE OR REPLACE FUNCTION public.mark_order_paid(
  p_order_id  uuid,
  p_method    text,
  p_reference text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_store_id uuid;
  v_status   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_store_id FROM public.stores LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a ninguna tienda' USING ERRCODE = '28000';
  END IF;

  SELECT status INTO v_status
  FROM public.orders
  WHERE id = p_order_id AND store_id = v_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_status != 'pendiente' THEN
    RAISE EXCEPTION 'Solo se puede marcar como pagado un pedido pendiente. Estado actual: %',
      v_status USING ERRCODE = 'P0001';
  END IF;

  IF p_method NOT IN ('transferencia','efectivo','mercadopago','dlocalgo','otro') THEN
    RAISE EXCEPTION 'Método de pago inválido: %', p_method USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders SET
    status            = 'pagado',
    payment_method    = p_method,
    payment_reference = nullif(trim(coalesce(p_reference, '')), ''),
    paid_at           = now(),
    paid_by           = auth.uid()
  WHERE id = p_order_id AND store_id = v_store_id;

  INSERT INTO public.order_events (store_id, order_id, type, from_status, to_status, user_id)
  VALUES (v_store_id, p_order_id, 'pagado', 'pendiente', 'pagado', auth.uid());
END;
$$;

REVOKE ALL     ON FUNCTION public.mark_order_paid(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_order_paid(uuid, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.mark_order_paid(uuid, text, text) TO authenticated;

-- =====================
-- set_order_status
-- Transiciones permitidas: pagado→enviado, enviado→entregado.
-- Para pasar a «pagado» usar mark_order_paid. Para cancelar usar cancel_order.
-- Si el nuevo estado es «enviado» se pueden guardar transportista y código de seguimiento.
-- =====================
CREATE OR REPLACE FUNCTION public.set_order_status(
  p_order_id uuid,
  p_status   text,
  p_note     text  DEFAULT NULL,
  p_carrier  text  DEFAULT NULL,
  p_tracking text  DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_store_id    uuid;
  v_from_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_store_id FROM public.stores LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a ninguna tienda' USING ERRCODE = '28000';
  END IF;

  SELECT status INTO v_from_status
  FROM public.orders
  WHERE id = p_order_id AND store_id = v_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    (v_from_status = 'pagado'  AND p_status = 'enviado')    OR
    (v_from_status = 'enviado' AND p_status = 'entregado')
  ) THEN
    RAISE EXCEPTION
      'Transición inválida: % → %. Permitidas: pagado→enviado, enviado→entregado',
      v_from_status, p_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders SET
    status           = p_status,
    shipping_carrier = COALESCE(nullif(trim(coalesce(p_carrier,  '')), ''), shipping_carrier),
    tracking_code    = COALESCE(nullif(trim(coalesce(p_tracking, '')), ''), tracking_code)
  WHERE id = p_order_id AND store_id = v_store_id;

  INSERT INTO public.order_events
    (store_id, order_id, type, from_status, to_status, user_id, note)
  VALUES
    (v_store_id, p_order_id, 'estado_cambiado', v_from_status, p_status,
     auth.uid(), nullif(trim(coalesce(p_note, '')), ''));
END;
$$;

REVOKE ALL     ON FUNCTION public.set_order_status(uuid, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_order_status(uuid, text, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_order_status(uuid, text, text, text, text) TO authenticated;

-- =====================
-- cancel_order
-- Permitido si el pedido no está «entregado» ni ya «cancelado».
-- Repone el stock de todas las líneas con auditoría.
-- Idempotente bajo concurrencia: el FOR UPDATE garantiza que solo
-- la primera llamada repone el stock.
-- =====================
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id uuid,
  p_reason   text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_store_id    uuid;
  v_from_status text;
  v_number      integer;
  v_item        RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_store_id FROM public.stores LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a ninguna tienda' USING ERRCODE = '28000';
  END IF;

  -- FOR UPDATE: previene dos cancelaciones concurrentes que repongan stock dos veces
  SELECT status, number INTO v_from_status, v_number
  FROM public.orders
  WHERE id = p_order_id AND store_id = v_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_from_status = 'entregado' THEN
    RAISE EXCEPTION 'No se puede cancelar un pedido ya entregado' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotente: si ya está cancelado, no hace nada (no repone stock de nuevo)
  IF v_from_status = 'cancelado' THEN
    RETURN;
  END IF;

  UPDATE public.orders SET status = 'cancelado'
  WHERE id = p_order_id AND store_id = v_store_id;

  -- Reponer stock con auditoría
  PERFORM set_config('app.stock_reason', 'Cancelación - pedido #' || v_number::text, true);
  FOR v_item IN
    SELECT variant_id, quantity
    FROM   public.order_items
    WHERE  order_id = p_order_id AND store_id = v_store_id
  LOOP
    UPDATE public.product_variants
    SET stock = stock + v_item.quantity
    WHERE id = v_item.variant_id AND store_id = v_store_id;
  END LOOP;

  INSERT INTO public.order_events
    (store_id, order_id, type, from_status, to_status, user_id, note)
  VALUES
    (v_store_id, p_order_id, 'cancelado', v_from_status, 'cancelado',
     auth.uid(), nullif(trim(coalesce(p_reason, '')), ''));
END;
$$;

REVOKE ALL     ON FUNCTION public.cancel_order(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;

-- =====================
-- update_order_shipping
-- Fija el costo de envío «a confirmar» y recalcula el total.
-- No permitido si el pedido está cancelado o entregado.
-- =====================
CREATE OR REPLACE FUNCTION public.update_order_shipping(
  p_order_id      uuid,
  p_shipping_cost integer,
  p_carrier       text    DEFAULT NULL,
  p_tracking      text    DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_store_id uuid;
  v_status   text;
  v_subtotal numeric(12,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_store_id FROM public.stores LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a ninguna tienda' USING ERRCODE = '28000';
  END IF;

  SELECT status, subtotal INTO v_status, v_subtotal
  FROM public.orders
  WHERE id = p_order_id AND store_id = v_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_status IN ('cancelado','entregado') THEN
    RAISE EXCEPTION 'No se puede modificar el envío de un pedido %', v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Se actualizan shipping_cost y total en el mismo statement → CHECK se evalúa después
  UPDATE public.orders SET
    shipping_cost    = p_shipping_cost,
    shipping_carrier = COALESCE(nullif(trim(coalesce(p_carrier,  '')), ''), shipping_carrier),
    tracking_code    = COALESCE(nullif(trim(coalesce(p_tracking, '')), ''), tracking_code),
    total            = v_subtotal + COALESCE(p_shipping_cost, 0)
  WHERE id = p_order_id AND store_id = v_store_id;

  INSERT INTO public.order_events (store_id, order_id, type, user_id, note)
  VALUES (v_store_id, p_order_id, 'nota', auth.uid(),
          'Envío actualizado: $' || COALESCE(p_shipping_cost::text, '(a confirmar)'));
END;
$$;

REVOKE ALL     ON FUNCTION public.update_order_shipping(uuid, integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_order_shipping(uuid, integer, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_order_shipping(uuid, integer, text, text) TO authenticated;
