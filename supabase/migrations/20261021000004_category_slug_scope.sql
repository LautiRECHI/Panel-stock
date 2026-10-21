-- Migración 004: unicidad de slug en categories por ámbito (raíz vs. hijo)
-- ─────────────────────────────────────────────────────────────────────────────
-- Motivo: el mismo slug debe poder existir bajo padres distintos.
-- Ej: "bullpadel" bajo "Paletas" y bajo "Zapatillas" son categorías válidas.
-- La unicidad se garantiza dentro del mismo ámbito de hermanos:
--   · Raíces (parent_id IS NULL)     → único por (store_id, slug)
--   · Hijos  (parent_id IS NOT NULL) → único por (store_id, parent_id, slug)
-- Se mantiene UNIQUE (store_id, id) porque es el ancla de FKs compuestas.
-- El slug de products no se modifica; sigue único por tienda.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Eliminar la restricción UNIQUE original (store_id, slug)
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_store_id_slug_key;

-- 2. Índice único parcial para categorías raíz
CREATE UNIQUE INDEX uq_categories_root_slug
  ON public.categories (store_id, slug)
  WHERE parent_id IS NULL;

-- 3. Índice único parcial para subcategorías
CREATE UNIQUE INDEX uq_categories_child_slug
  ON public.categories (store_id, parent_id, slug)
  WHERE parent_id IS NOT NULL;
