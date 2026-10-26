-- Migración 011: importación masiva de productos
--
-- find_or_create_category_for_import: helper interno para buscar o crear una
-- categoría por nombre normalizado (case-insensitive, sin espacios extra).
--
-- import_products(p_products jsonb): importa un lote de productos pre-validados.
-- SECURITY INVOKER: RLS se aplica en todos los INSERTs.
-- El store_id se resuelve desde la sesión, nunca lo recibe como parámetro.
--
-- Estructura de cada elemento en p_products:
-- {
--   "nombre": "Paleta Pro",
--   "slug": "paleta-pro",
--   "categoria_name": "Paletas",
--   "categoria_slug": "paletas",
--   "subcategoria_name": "Bullpadel",    (opcional)
--   "subcategoria_slug": "bullpadel",   (opcional)
--   "marca": "Bullpadel",
--   "descripcion": "...",
--   "precio": 15000,
--   "estado": "active",
--   "variantes": [
--     { "sku": "PA-M", "opcion": "Talle", "valor": "M", "stock": 5 },
--     { "sku": "PA-L", "opcion": "Talle", "valor": "L", "stock": 3 }
--   ]
-- }
-- Para productos sin variantes, variantes tiene un solo elemento con opcion/valor vacíos.
-- Retorna: { "creados": [...], "salteados": [...], "errores": [...] }

CREATE OR REPLACE FUNCTION public.find_or_create_category_for_import(
  p_store_id  uuid,
  p_name      text,
  p_slug      text,
  p_parent_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id      uuid;
  v_slug    text := p_slug;
  v_counter int  := 2;
  v_pos     int;
BEGIN
  -- Buscar categoría existente por nombre normalizado bajo el mismo padre
  IF p_parent_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.categories
     WHERE store_id  = p_store_id
       AND parent_id IS NULL
       AND lower(trim(name)) = lower(trim(p_name))
     LIMIT 1;
  ELSE
    SELECT id INTO v_id
      FROM public.categories
     WHERE store_id  = p_store_id
       AND parent_id = p_parent_id
       AND lower(trim(name)) = lower(trim(p_name))
     LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Garantizar slug único entre hermanos
  LOOP
    IF p_parent_id IS NULL THEN
      PERFORM 1 FROM public.categories
        WHERE store_id = p_store_id AND parent_id IS NULL AND slug = v_slug;
    ELSE
      PERFORM 1 FROM public.categories
        WHERE store_id = p_store_id AND parent_id = p_parent_id AND slug = v_slug;
    END IF;
    EXIT WHEN NOT FOUND;
    v_slug    := p_slug || '-' || v_counter;
    v_counter := v_counter + 1;
  END LOOP;

  -- Posición al final de los hermanos
  IF p_parent_id IS NULL THEN
    SELECT COALESCE(MAX(position), -1) + 1 INTO v_pos
      FROM public.categories
     WHERE store_id = p_store_id AND parent_id IS NULL;
  ELSE
    SELECT COALESCE(MAX(position), -1) + 1 INTO v_pos
      FROM public.categories
     WHERE store_id = p_store_id AND parent_id = p_parent_id;
  END IF;

  INSERT INTO public.categories (store_id, name, slug, parent_id, position)
  VALUES (p_store_id, trim(p_name), v_slug, p_parent_id, v_pos)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL     ON FUNCTION public.find_or_create_category_for_import(uuid, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_or_create_category_for_import(uuid, text, text, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.find_or_create_category_for_import(uuid, text, text, uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.import_products(
  p_products jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_store_id    uuid;
  v_item        jsonb;
  v_cat_id      uuid;
  v_subcat_id   uuid;
  v_product_id  uuid;
  v_slug        text;
  v_slug_base   text;
  v_counter     int;
  v_slug_taken  boolean;
  v_variant     jsonb;
  v_variants    jsonb;
  v_has_vars    boolean;
  v_default_sku text;
  v_upsert_arr  jsonb;
  v_var_sku     text;
  v_var_attrs   jsonb;
  v_var_stock   int;
  v_def_stock   int;

  v_creados   jsonb := '[]'::jsonb;
  v_salteados jsonb := '[]'::jsonb;
  v_errores   jsonb := '[]'::jsonb;
BEGIN
  -- Resolver store_id desde la sesión (RLS aplicado: solo ve sus tiendas)
  SELECT id INTO v_store_id FROM public.stores LIMIT 1;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a ninguna tienda' USING ERRCODE = '28000';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_products)
  LOOP
    BEGIN
      -- Cada iteración es una subtransacción implícita (BEGIN…EXCEPTION…END).
      -- Si cualquier paso falla, SOLO este producto se revierte.
      PERFORM set_config('app.stock_reason', 'Importación', true);

      -- ── Categoría raíz ────────────────────────────────────────────────────
      v_cat_id := NULL;
      IF (v_item->>'categoria_name') IS NOT NULL
         AND trim(v_item->>'categoria_name') != ''
      THEN
        v_cat_id := public.find_or_create_category_for_import(
          v_store_id,
          v_item->>'categoria_name',
          v_item->>'categoria_slug',
          NULL
        );
      END IF;

      -- ── Subcategoría (opcional) ───────────────────────────────────────────
      v_subcat_id := NULL;
      IF (v_item->>'subcategoria_name') IS NOT NULL
         AND trim(v_item->>'subcategoria_name') != ''
         AND v_cat_id IS NOT NULL
      THEN
        v_subcat_id := public.find_or_create_category_for_import(
          v_store_id,
          v_item->>'subcategoria_name',
          v_item->>'subcategoria_slug',
          v_cat_id
        );
      END IF;

      -- ── Verificar duplicado por slug ──────────────────────────────────────
      v_slug_base := v_item->>'slug';
      v_slug      := v_slug_base;
      v_counter   := 2;
      LOOP
        SELECT count(*) > 0 INTO v_slug_taken
          FROM public.products
         WHERE store_id = v_store_id AND slug = v_slug;
        EXIT WHEN NOT v_slug_taken;
        v_slug    := v_slug_base || '-' || v_counter;
        v_counter := v_counter + 1;
      END LOOP;

      -- Si el slug base ya estaba tomado → producto duplicado → saltear
      IF v_slug != v_slug_base THEN
        v_salteados := v_salteados || jsonb_build_object(
          'nombre', v_item->>'nombre',
          'slug',   v_slug_base,
          'motivo', 'Ya existe un producto con ese nombre en la tienda'
        );
        CONTINUE;
      END IF;

      -- ── Determinar tipo de variantes ──────────────────────────────────────
      v_variants := COALESCE(v_item->'variantes', '[]'::jsonb);
      v_has_vars := jsonb_array_length(v_variants) > 1
        OR (
          jsonb_array_length(v_variants) = 1
          AND COALESCE(trim(v_variants->0->>'opcion'), '') != ''
        );

      -- SKU por defecto (solo se usa para la variante default cuando NO hay variantes)
      v_default_sku := COALESCE(
        NULLIF(trim(COALESCE(v_variants->0->>'sku', '')), ''),
        substring(
          upper(regexp_replace(v_item->>'nombre', '[^A-Za-z0-9]', '', 'g'))
          from 1 for 4
        ) || '-' || substring(md5(random()::text) from 1 for 6)
      );

      -- ── Insertar producto ─────────────────────────────────────────────────
      INSERT INTO public.products
        (store_id, name, slug, price, status, description, brand, category_id)
      VALUES (
        v_store_id,
        trim(v_item->>'nombre'),
        v_slug,
        COALESCE((v_item->>'precio')::numeric, 0),
        COALESCE(NULLIF(v_item->>'estado', ''), 'active'),
        NULLIF(trim(COALESCE(v_item->>'descripcion', '')), ''),
        NULLIF(trim(COALESCE(v_item->>'marca', '')), ''),
        COALESCE(v_subcat_id, v_cat_id)
      )
      RETURNING id INTO v_product_id;

      -- ── Insertar variantes ────────────────────────────────────────────────
      IF v_has_vars THEN
        -- Producto con variantes reales: upsert_variants gestiona todo.
        -- No se inserta variante default {} para no colisionar con los SKUs reales.
        -- Construir array para upsert_variants
        v_upsert_arr := '[]'::jsonb;
        FOR v_variant IN SELECT * FROM jsonb_array_elements(v_variants)
        LOOP
          v_var_sku := COALESCE(
            NULLIF(trim(v_variant->>'sku'), ''),
            substring(
              upper(regexp_replace(v_item->>'nombre', '[^A-Za-z0-9]', '', 'g'))
              from 1 for 4
            ) || '-' || substring(md5(random()::text) from 1 for 6)
          );
          v_var_attrs := jsonb_build_object(
            v_variant->>'opcion',
            v_variant->>'valor'
          );
          v_var_stock := COALESCE((v_variant->>'stock')::int, 0);
          v_upsert_arr := v_upsert_arr || jsonb_build_object(
            'sku',        v_var_sku,
            'attributes', v_var_attrs,
            'price',      NULL::text,
            'stock',      v_var_stock
          );
        END LOOP;

        PERFORM public.upsert_variants(
          v_store_id,
          v_product_id,
          v_upsert_arr,
          'Importación'
        );

      ELSE
        -- Producto sin variantes: variante default con el stock real
        v_def_stock := COALESCE((v_variants->0->>'stock')::int, 0);
        INSERT INTO public.product_variants (store_id, product_id, sku, attributes, stock)
        VALUES (v_store_id, v_product_id, v_default_sku, '{}', v_def_stock);
      END IF;

      v_creados := v_creados || jsonb_build_object(
        'nombre',      v_item->>'nombre',
        'producto_id', v_product_id,
        'slug',        v_slug
      );

    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores || jsonb_build_object(
        'nombre', v_item->>'nombre',
        'slug',   v_item->>'slug',
        'error',  SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'creados',   v_creados,
    'salteados', v_salteados,
    'errores',   v_errores
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.import_products(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_products(jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.import_products(jsonb) TO authenticated;
