-- Migración 005: funciones de ajuste de stock
-- adjust_stock: ajusta el stock de forma relativa (+/- delta)
-- set_stock: establece el stock de forma absoluta
-- Ambas usan set_config para que audit_stock_movement registre el motivo.
-- SECURITY INVOKER: el UPDATE interno hereda los permisos del llamador,
-- por lo que RLS (product_variants_update) se aplica → un usuario no puede
-- tocar variantes de otra tienda.

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_variant_id uuid,
  p_delta      int,
  p_reason     text
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_new_stock integer;
BEGIN
  PERFORM set_config('app.stock_reason', p_reason, true);
  UPDATE public.product_variants
    SET stock = stock + p_delta
    WHERE id = p_variant_id
    RETURNING stock INTO v_new_stock;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variante no encontrada o sin acceso' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_new_stock;
END;
$$;

REVOKE ALL     ON FUNCTION public.adjust_stock(uuid, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_stock(uuid, int, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.adjust_stock(uuid, int, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_stock(
  p_variant_id uuid,
  p_new_stock  int,
  p_reason     text
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result integer;
BEGIN
  PERFORM set_config('app.stock_reason', p_reason, true);
  UPDATE public.product_variants
    SET stock = p_new_stock
    WHERE id = p_variant_id
    RETURNING stock INTO v_result;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variante no encontrada o sin acceso' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL     ON FUNCTION public.set_stock(uuid, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_stock(uuid, int, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_stock(uuid, int, text) TO authenticated;
