-- Migración 006: función atómica para crear un producto con su variante por defecto
-- Sin esta función, el código de aplicación hacía dos INSERTs separados, lo que
-- podía dejar un producto sin variante si el segundo INSERT fallaba.
-- SECURITY INVOKER: hereda los permisos del llamador → RLS se aplica a ambos INSERTs.
-- Los INSERTs están en el mismo bloque PL/pgSQL; si el segundo falla (p.ej., SKU
-- duplicado con 23505), PostgreSQL revierte el primero automáticamente.

CREATE OR REPLACE FUNCTION public.create_product(
  p_store_id    uuid,
  p_name        text,
  p_slug        text,
  p_price       numeric,
  p_status      text,
  p_description text,
  p_brand       text,
  p_category_id uuid,
  p_sku         text,
  p_stock       integer
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  INSERT INTO public.products (store_id, name, slug, price, status, description, brand, category_id)
  VALUES (p_store_id, p_name, p_slug, p_price, p_status, p_description, p_brand, p_category_id)
  RETURNING id INTO v_product_id;

  INSERT INTO public.product_variants (store_id, product_id, sku, attributes, stock)
  VALUES (p_store_id, v_product_id, p_sku, '{}', p_stock);

  RETURN v_product_id;
END;
$$;

REVOKE ALL     ON FUNCTION public.create_product(uuid, text, text, numeric, text, text, text, uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_product(uuid, text, text, numeric, text, text, text, uuid, text, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_product(uuid, text, text, numeric, text, text, text, uuid, text, integer) TO authenticated;
