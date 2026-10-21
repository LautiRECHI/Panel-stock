-- Migración 002: Row Level Security
-- ============================================================
-- CAMBIOS vs borrador anterior:
--   [6] Todas las políticas UPDATE tienen WITH CHECK que espeja USING.
--   [4] store_members: staff no tiene INSERT/UPDATE/DELETE (solo owner).
--       Trigger protect_last_owner impide eliminar/degradar al último owner.
--   [5] stock_movements: solo SELECT e INSERT. Sin UPDATE ni DELETE.
--   [7] TO authenticated en todas las políticas.
--       Sin esta cláusula, RLS evaluaría la política también para 'anon',
--       que no tiene EXECUTE en las funciones SECURITY DEFINER → error de
--       permiso en vez de 0 filas. Con TO authenticated, anon no tiene
--       ninguna política aplicable → 0 filas en SELECT, denegación implícita
--       en INSERT/UPDATE/DELETE, sin invocar ninguna función.
--   [8] Sin políticas DELETE para products ni product_variants.
--       Los productos se archivan (status='archived'), no se borran.
--       La FK RESTRICT en stock_movements garantiza además que no se puedan
--       borrar variantes con historial de stock, ni siquiera como postgres.
-- ============================================================

ALTER TABLE public.stores           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements  ENABLE ROW LEVEL SECURITY;

-- =====================
-- stores
-- INSERT: solo via create_store() (SECURITY DEFINER, bypasses RLS)
-- DELETE: prohibido (sin política)
-- =====================
CREATE POLICY "stores_select"
  ON public.stores FOR SELECT
  TO authenticated
  USING (public.is_store_member(id));

CREATE POLICY "stores_update"
  ON public.stores FOR UPDATE
  TO authenticated
  USING     (public.is_store_owner(id))
  WITH CHECK (public.is_store_owner(id));

-- =====================
-- store_members
-- Solo owner puede INSERT, UPDATE y DELETE.
-- Staff solo puede SELECT.
-- =====================
CREATE POLICY "store_members_select"
  ON public.store_members FOR SELECT
  TO authenticated
  USING (public.is_store_member(store_id));

CREATE POLICY "store_members_insert"
  ON public.store_members FOR INSERT
  TO authenticated
  WITH CHECK (public.is_store_owner(store_id));

CREATE POLICY "store_members_update"
  ON public.store_members FOR UPDATE
  TO authenticated
  USING     (public.is_store_owner(store_id))
  WITH CHECK (public.is_store_owner(store_id));

CREATE POLICY "store_members_delete"
  ON public.store_members FOR DELETE
  TO authenticated
  USING (public.is_store_owner(store_id));

-- =====================
-- categories
-- =====================
CREATE POLICY "categories_select"
  ON public.categories FOR SELECT
  TO authenticated
  USING (public.is_store_member(store_id));

CREATE POLICY "categories_insert"
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK (public.is_store_member(store_id));

CREATE POLICY "categories_update"
  ON public.categories FOR UPDATE
  TO authenticated
  USING     (public.is_store_member(store_id))
  WITH CHECK (public.is_store_member(store_id));

CREATE POLICY "categories_delete"
  ON public.categories FOR DELETE
  TO authenticated
  USING (public.is_store_member(store_id));

-- =====================
-- products
-- Sin política DELETE: los productos se archivan, no se borran.
-- =====================
CREATE POLICY "products_select"
  ON public.products FOR SELECT
  TO authenticated
  USING (public.is_store_member(store_id));

CREATE POLICY "products_insert"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (public.is_store_member(store_id));

CREATE POLICY "products_update"
  ON public.products FOR UPDATE
  TO authenticated
  USING     (public.is_store_member(store_id))
  WITH CHECK (public.is_store_member(store_id));

-- =====================
-- product_variants
-- Sin política DELETE: las variantes no se borran si tienen historial.
-- =====================
CREATE POLICY "product_variants_select"
  ON public.product_variants FOR SELECT
  TO authenticated
  USING (public.is_store_member(store_id));

CREATE POLICY "product_variants_insert"
  ON public.product_variants FOR INSERT
  TO authenticated
  WITH CHECK (public.is_store_member(store_id));

CREATE POLICY "product_variants_update"
  ON public.product_variants FOR UPDATE
  TO authenticated
  USING     (public.is_store_member(store_id))
  WITH CHECK (public.is_store_member(store_id));

-- =====================
-- product_images
-- Las imágenes sí se pueden borrar (el usuario elimina una foto).
-- =====================
CREATE POLICY "product_images_select"
  ON public.product_images FOR SELECT
  TO authenticated
  USING (public.is_store_member(store_id));

CREATE POLICY "product_images_insert"
  ON public.product_images FOR INSERT
  TO authenticated
  WITH CHECK (public.is_store_member(store_id));

CREATE POLICY "product_images_update"
  ON public.product_images FOR UPDATE
  TO authenticated
  USING     (public.is_store_member(store_id))
  WITH CHECK (public.is_store_member(store_id));

CREATE POLICY "product_images_delete"
  ON public.product_images FOR DELETE
  TO authenticated
  USING (public.is_store_member(store_id));

-- =====================
-- stock_movements
-- Solo SELECT. INSERT lo hace exclusivamente el trigger audit_stock_movement()
-- (SECURITY DEFINER). Nadie inserta directamente: sin política INSERT para
-- authenticated, RLS deniega todo intento directo con 42501.
-- Sin UPDATE ni DELETE: el historial es inmutable por diseño.
-- =====================
CREATE POLICY "stock_movements_select"
  ON public.stock_movements FOR SELECT
  TO authenticated
  USING (public.is_store_member(store_id));
