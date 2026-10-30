-- Migración 016: agregar max_quantity por variante en public_product
-- ============================================================
-- Expone max_quantity = LEAST(stock, 20) en cada variante del catálogo público.
-- El tope de 20 coincide con el límite máximo por variante al crear un pedido
-- (storefront_create_order en migration 014), evitando que el frontend muestre
-- disponibilidad mayor a la que el sistema aceptaría al procesar el carrito.
-- in_stock se mantiene sin cambios (compatibilidad con tiendas ya integradas).
-- ============================================================

CREATE OR REPLACE FUNCTION public.public_product(
  p_store_slug   text,
  p_product_slug text
)
RETURNS TABLE(
  id          uuid,
  name        text,
  slug        text,
  description text,
  brand       text,
  price       numeric,
  images      jsonb,
  variants    jsonb
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  SELECT s.id INTO v_store_id
  FROM public.stores s
  WHERE s.slug = lower(trim(p_store_slug))
  LIMIT 1;

  IF v_store_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.slug,
    p.description,
    p.brand,
    p.price,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('path', pi.path) ORDER BY pi.position)
       FROM public.product_images pi
       WHERE pi.product_id = p.id
         AND pi.store_id = v_store_id),
      '[]'::jsonb
    ) AS images,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object(
                  'id',           pv.id,
                  'attributes',   pv.attributes,
                  'price',        pv.price,
                  'in_stock',     pv.stock > 0,
                  'max_quantity', LEAST(pv.stock, 20)
                ) ORDER BY pv.created_at, pv.id
              )
       FROM public.product_variants pv
       WHERE pv.product_id = p.id
         AND pv.store_id = v_store_id
         AND pv.is_active = true),
      '[]'::jsonb
    ) AS variants
  FROM public.products p
  WHERE p.store_id = v_store_id
    AND p.slug = lower(trim(p_product_slug))
    AND p.status = 'active'
  LIMIT 1;
END;
$$;

REVOKE ALL    ON FUNCTION public.public_product(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_product(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.public_product(text, text) TO authenticated;
