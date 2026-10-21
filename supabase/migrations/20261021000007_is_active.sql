-- Migración 007: columna is_active en product_variants
-- Permite desactivar variantes sin borrarlas (necesario para preservar historial de stock).
-- No requiere cambios de RLS: is_active es solo una columna de datos.

ALTER TABLE public.product_variants
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;

CREATE INDEX idx_product_variants_active
  ON public.product_variants(product_id) WHERE is_active = true;
