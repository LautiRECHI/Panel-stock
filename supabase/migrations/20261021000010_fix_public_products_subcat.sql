-- Migración 010: fix public_products — subcategoría sin verificar padre
-- ============================================================
-- Bug: al recibir p_category_slug + p_subcategory_slug, la búsqueda de la
-- subcategoría usaba solo `slug AND parent_id IS NOT NULL`, sin validar que
-- el padre coincida con la categoría indicada. En tiendas donde el mismo
-- slug existe bajo distintas raíces (permitido por migration 004), se
-- encontraba la subcategoría equivocada y se devolvían productos incorrectos.
-- Además, si se pedía una subcategoría que no existe bajo esa raíz, el
-- lookup devolvía NULL y la función caía al filtro de categoría sola, en
-- lugar de retornar vacío como se espera.
--
-- Fix:
--   · La subcategoría se resuelve con `parent_id = v_cat_id` (solo cuando
--     se recibió categoría). Si no existe bajo esa categoría → RETURN vacío.
--   · Si se recibe subcategoría sin categoría, se ignora (sin cambio).
-- ============================================================

CREATE OR REPLACE FUNCTION public.public_products(
  p_store_slug       text,
  p_category_slug    text    DEFAULT NULL,
  p_subcategory_slug text    DEFAULT NULL,
  p_search           text    DEFAULT NULL,
  p_limit            integer DEFAULT 24,
  p_offset           integer DEFAULT 0
)
RETURNS TABLE(
  id               uuid,
  name             text,
  slug             text,
  brand            text,
  price_from       numeric,
  is_price_from    boolean,
  category_slug    text,
  subcategory_slug text,
  cover_path       text,
  in_stock         boolean,
  total_count      bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
DECLARE
  v_store_id  uuid;
  v_cat_id    uuid;
  v_subcat_id uuid;
  v_limit     integer;
  v_offset    integer;
  v_search    text;
BEGIN
  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 60);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_search := CASE
    WHEN p_search IS NOT NULL AND trim(p_search) <> ''
    THEN left(trim(p_search), 100)
    ELSE NULL
  END;

  SELECT s.id INTO v_store_id
  FROM public.stores s
  WHERE s.slug = lower(trim(p_store_slug))
  LIMIT 1;

  IF v_store_id IS NULL THEN
    RETURN;
  END IF;

  IF p_category_slug IS NOT NULL AND trim(p_category_slug) <> '' THEN
    SELECT c.id INTO v_cat_id
    FROM public.categories c
    WHERE c.store_id = v_store_id
      AND c.slug = lower(trim(p_category_slug))
    LIMIT 1;
  END IF;

  -- Subcategoría: solo tiene sentido cuando se proporcionó categoría.
  -- Se busca exigiendo parent_id = v_cat_id para evitar matches en otras raíces.
  -- Si el slug no existe bajo esa raíz → retorno vacío (no cae al filtro de categoría).
  IF v_cat_id IS NOT NULL
     AND p_subcategory_slug IS NOT NULL
     AND trim(p_subcategory_slug) <> ''
  THEN
    SELECT c.id INTO v_subcat_id
    FROM public.categories c
    WHERE c.store_id = v_store_id
      AND c.slug = lower(trim(p_subcategory_slug))
      AND c.parent_id = v_cat_id
    LIMIT 1;

    IF v_subcat_id IS NULL THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  WITH matching AS (
    SELECT p.id
    FROM public.products p
    WHERE p.store_id = v_store_id
      AND p.status = 'active'
      AND (
        v_cat_id IS NULL
        OR (
          v_subcat_id IS NOT NULL
          AND p.category_id = v_subcat_id
        )
        OR (
          v_subcat_id IS NULL
          AND (
            p.category_id = v_cat_id
            OR EXISTS (
              SELECT 1 FROM public.categories c
              WHERE c.id = p.category_id
                AND c.parent_id = v_cat_id
            )
          )
        )
      )
      AND (
        v_search IS NULL
        OR p.name  ILIKE '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\'
        OR p.brand ILIKE '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\'
      )
  ),
  var_agg AS (
    SELECT
      pv.product_id,
      MIN(COALESCE(pv.price, p.price)) AS price_min,
      MAX(COALESCE(pv.price, p.price)) AS price_max,
      bool_or(pv.stock > 0)            AS has_stock
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id
    WHERE pv.store_id = v_store_id
      AND pv.is_active = true
      AND pv.product_id IN (SELECT mx.id FROM matching mx)
    GROUP BY pv.product_id
  ),
  covers AS (
    SELECT DISTINCT ON (pi.product_id) pi.product_id, pi.path
    FROM public.product_images pi
    WHERE pi.store_id = v_store_id
      AND pi.product_id IN (SELECT mx.id FROM matching mx)
    ORDER BY pi.product_id, pi.position
  ),
  cat_info AS (
    SELECT
      p.id AS product_id,
      CASE WHEN c.parent_id IS NULL THEN c.slug ELSE pc.slug END AS cat_slug,
      CASE WHEN c.parent_id IS NOT NULL THEN c.slug              ELSE NULL END AS subcat_slug
    FROM public.products p
    LEFT JOIN public.categories c  ON c.id = p.category_id
    LEFT JOIN public.categories pc ON pc.id = c.parent_id
    WHERE p.id IN (SELECT mx.id FROM matching mx)
  ),
  total AS (
    SELECT count(*) AS cnt FROM matching
  )
  SELECT
    p.id,
    p.name,
    p.slug,
    p.brand,
    COALESCE(va.price_min, p.price)             AS price_from,
    COALESCE(va.price_max > va.price_min, false) AS is_price_from,
    ci_cat.cat_slug,
    ci_cat.subcat_slug,
    cov.path                                     AS cover_path,
    COALESCE(va.has_stock, false)                AS in_stock,
    t.cnt                                        AS total_count
  FROM matching m
  JOIN public.products p    ON p.id = m.id
  CROSS JOIN total t
  LEFT JOIN var_agg  va     ON va.product_id = p.id
  LEFT JOIN covers   cov    ON cov.product_id = p.id
  LEFT JOIN cat_info ci_cat ON ci_cat.product_id = p.id
  ORDER BY p.name, p.id
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

-- REVOKE/GRANT ya están en migration 009; CREATE OR REPLACE no los borra.
-- Se repiten por claridad y para garantizar el estado si se aplica en orden.
REVOKE ALL    ON FUNCTION public.public_products(text, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_products(text, text, text, text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.public_products(text, text, text, text, integer, integer) TO authenticated;
