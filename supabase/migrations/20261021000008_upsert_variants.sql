-- Migración 008: función upsert_variants
-- Inserta o actualiza variantes de un producto en una sola llamada atómica.
-- SECURITY INVOKER: hereda los permisos del llamador → RLS se aplica.
-- Actualiza también allowed_mime_types del bucket (solo jpeg y webp,
-- ya que el cliente convierte todo antes de subir).

CREATE OR REPLACE FUNCTION public.upsert_variants(
  p_store_id   uuid,
  p_product_id uuid,
  p_variants   jsonb,
  p_reason     text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  elem          jsonb;
  v_new_id      uuid;
  v_kept_ids    uuid[] := '{}';
BEGIN
  PERFORM set_config('app.stock_reason', p_reason, true);

  FOR elem IN SELECT * FROM jsonb_array_elements(p_variants)
  LOOP
    IF (elem->>'id') IS NOT NULL THEN
      -- Actualizar variante existente
      UPDATE public.product_variants
        SET sku        = elem->>'sku',
            attributes = COALESCE((elem->'attributes')::jsonb, '{}'::jsonb),
            price      = CASE
                           WHEN (elem->>'price') IS NOT NULL
                           THEN (elem->>'price')::numeric
                           ELSE NULL
                         END,
            is_active  = true,
            stock      = (elem->>'stock')::integer
        WHERE id = (elem->>'id')::uuid
          AND store_id   = p_store_id
          AND product_id = p_product_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Variante no encontrada o sin acceso' USING ERRCODE = 'P0002';
      END IF;

      v_kept_ids := v_kept_ids || (elem->>'id')::uuid;
    ELSE
      -- Insertar nueva variante
      INSERT INTO public.product_variants
        (store_id, product_id, sku, attributes, price, stock, is_active)
      VALUES (
        p_store_id,
        p_product_id,
        elem->>'sku',
        COALESCE((elem->'attributes')::jsonb, '{}'::jsonb),
        CASE
          WHEN (elem->>'price') IS NOT NULL
          THEN (elem->>'price')::numeric
          ELSE NULL
        END,
        (elem->>'stock')::integer,
        true
      )
      RETURNING id INTO v_new_id;

      v_kept_ids := v_kept_ids || v_new_id;
    END IF;
  END LOOP;

  -- Desactivar variantes activas que no estén en la lista enviada
  IF array_length(v_kept_ids, 1) IS NOT NULL THEN
    UPDATE public.product_variants
      SET is_active = false
      WHERE store_id   = p_store_id
        AND product_id = p_product_id
        AND is_active  = true
        AND id != ALL(v_kept_ids);
  ELSE
    -- Si no se envió ninguna variante, desactivar todas
    UPDATE public.product_variants
      SET is_active = false
      WHERE store_id   = p_store_id
        AND product_id = p_product_id
        AND is_active  = true;
  END IF;
END;
$$;

REVOKE ALL     ON FUNCTION public.upsert_variants(uuid, uuid, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_variants(uuid, uuid, jsonb, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.upsert_variants(uuid, uuid, jsonb, text) TO authenticated;

-- Actualizar tipos de archivo permitidos en el bucket
-- (el cliente convierte todo a WebP/JPEG antes de subir)
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg', 'image/webp']
  WHERE id = 'product-images';
