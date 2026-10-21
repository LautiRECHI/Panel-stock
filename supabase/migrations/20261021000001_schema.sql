-- Migración 001: esquema base
-- ============================================================
-- CAMBIOS vs borrador inicial:
--   [1] Funciones SECURITY DEFINER: SET search_path = '', nombres
--       calificados, REVOKE de PUBLIC/anon, GRANT a authenticated.
--   [2] FKs compuestas (store_id, id) para garantizar que un registro
--       nunca pueda referenciar un objeto de otra tienda.
--   [3] Trigger protect_last_owner: el último owner no se puede
--       eliminar ni degradar a staff.
--   [4] Trigger prevent_store_id_change: store_id es inmutable en UPDATE.
--   [5] is_store_member_text(text): variante para Storage que compara
--       como texto y devuelve false ante rutas inválidas (no lanza error).
-- ============================================================

-- =====================
-- Trigger: updated_at automático
-- Sin SECURITY DEFINER porque no accede a tablas; search_path no importa aquí.
-- =====================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================
-- stores
-- =====================
CREATE TABLE public.stores (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL CHECK (length(trim(name)) > 0),
  slug         text        NOT NULL UNIQUE
                           CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' OR slug ~ '^[a-z0-9]$'),
  accent_color text        NOT NULL DEFAULT '#E9B949'
                           CHECK (accent_color ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$'),
  cuit         text,
  tax_condition text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER stores_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =====================
-- store_members
-- =====================
CREATE TABLE public.store_members (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id   uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('owner', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);

CREATE INDEX idx_store_members_store_id ON public.store_members(store_id);
CREATE INDEX idx_store_members_user_id  ON public.store_members(user_id);

-- =====================
-- [3] Trigger: protege al último owner
-- Impide DELETE o cambio de role='owner' a 'staff' cuando es el último.
-- Corre como trigger, no necesita GRANT.
-- =====================
CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Solo actúa cuando se elimina o degrada un owner
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner')
  OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role != 'owner')
  THEN
    -- Cascada desde stores: la tienda ya fue borrada, no hay nada que proteger.
    -- Sin este bypass, borrar una tienda fallaría porque la cascada a store_members
    -- dispara el trigger, que ya no puede encontrar otro owner (tampoco hace falta).
    IF TG_OP = 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.stores WHERE id = OLD.store_id
    ) THEN
      RETURN OLD;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.store_members
      WHERE store_id = OLD.store_id
        AND user_id  != OLD.user_id
        AND role     = 'owner'
    ) THEN
      RAISE EXCEPTION 'La tienda debe tener al menos un owner'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER store_members_protect_last_owner
  BEFORE UPDATE OR DELETE ON public.store_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();

-- user_id y store_id son inmutables: si hace falta "mover" un miembro
-- se elimina el registro y se crea uno nuevo.
CREATE OR REPLACE FUNCTION public.prevent_store_member_key_change()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR
     NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'user_id y store_id son inmutables en store_members';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER store_members_prevent_key_change
  BEFORE UPDATE ON public.store_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_member_key_change();

-- =====================
-- [4] Trigger: store_id es inmutable en UPDATE
-- Aplicado a todas las tablas con store_id (excepto stock_movements, que
-- no tiene UPDATE policy ni trigger de updated_at).
-- =====================
CREATE OR REPLACE FUNCTION public.prevent_store_id_change()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'store_id no puede modificarse';
  END IF;
  RETURN NEW;
END;
$$;

-- =====================
-- [1] Funciones auxiliares — SECURITY DEFINER
--     SET search_path = '' evita hijacking por search_path manipulation.
--     Nombres de tabla completamente calificados.
--     REVOKE de PUBLIC + anon; GRANT solo a authenticated.
-- =====================

-- is_store_member: usada en políticas RLS de todas las tablas
CREATE OR REPLACE FUNCTION public.is_store_member(p_store_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL     ON FUNCTION public.is_store_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_store_member(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_store_member(uuid) TO authenticated;

-- is_store_owner: usada en políticas de stores y store_members
CREATE OR REPLACE FUNCTION public.is_store_owner(p_store_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

REVOKE ALL     ON FUNCTION public.is_store_owner(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_store_owner(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_store_owner(uuid) TO authenticated;

-- [5] is_store_member_text: usada en políticas de Storage.
--     Compara store_id como texto → una ruta como "invalid/foto.jpg"
--     devuelve false sin lanzar error (cast ::uuid tiraría invalid_text_representation).
CREATE OR REPLACE FUNCTION public.is_store_member_text(p_store_id_text text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_members
    WHERE store_id::text = p_store_id_text
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL     ON FUNCTION public.is_store_member_text(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_store_member_text(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_store_member_text(text) TO authenticated;

-- create_store: crea tienda y owner en una transacción atómica.
-- SECURITY DEFINER → bypasses RLS, lo que permite insertar en stores
-- sin exponer una política INSERT pública.
CREATE OR REPLACE FUNCTION public.create_store(p_name text, p_slug text)
RETURNS public.stores LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_store public.stores;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.stores (name, slug)
  VALUES (trim(p_name), lower(trim(p_slug)))
  RETURNING * INTO v_store;

  INSERT INTO public.store_members (user_id, store_id, role)
  VALUES (auth.uid(), v_store.id, 'owner');

  RETURN v_store;
END;
$$;

REVOKE ALL     ON FUNCTION public.create_store(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_store(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_store(text, text) TO authenticated;

-- =====================
-- [2] categories
--     UNIQUE(store_id, id): ancla para que products pueda declarar
--     FOREIGN KEY (store_id, category_id) REFERENCES categories(store_id, id).
--     Sin esta clave compuesta, PostgreSQL no permite la FK compuesta.
--
--     La FK de parent_id → categories(store_id, id) se agrega con ALTER TABLE
--     porque es auto-referencial (la tabla debe existir antes).
-- =====================
CREATE TABLE public.categories (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  parent_id  uuid,                     -- FK compuesta se agrega abajo
  name       text        NOT NULL CHECK (length(trim(name)) > 0),
  slug       text        NOT NULL CHECK (length(slug) >= 1),
  position   integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, slug),
  UNIQUE (store_id, id)                -- ancla para FKs compuestas externas
);

-- parent debe estar en la misma tienda; SET NULL si se borra el padre
ALTER TABLE public.categories
  ADD CONSTRAINT fk_categories_parent
  FOREIGN KEY (store_id, parent_id) REFERENCES public.categories(store_id, id)
  ON DELETE SET NULL (parent_id);

CREATE INDEX idx_categories_store_id  ON public.categories(store_id);
CREATE INDEX idx_categories_parent_id ON public.categories(parent_id);

CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER categories_prevent_store_id_change
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_change();

-- =====================
-- [2] products
--     UNIQUE(store_id, id) y FK compuesta a categories(store_id, id).
--     products.store_id = categories.store_id está garantizado por la FK.
-- =====================
CREATE TABLE public.products (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid          NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  category_id uuid,                     -- FK compuesta se agrega abajo
  name        text          NOT NULL CHECK (length(trim(name)) > 0),
  slug        text          NOT NULL CHECK (length(slug) >= 1),
  description text,
  brand       text,
  price       numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  vat_rate    numeric(5,2),
  status      text          NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'active', 'archived')),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (store_id, slug),
  UNIQUE (store_id, id)                 -- ancla para FKs compuestas externas
);

-- La categoría debe pertenecer a la misma tienda que el producto
ALTER TABLE public.products
  ADD CONSTRAINT fk_products_category
  FOREIGN KEY (store_id, category_id) REFERENCES public.categories(store_id, id)
  ON DELETE SET NULL (category_id);

CREATE INDEX idx_products_store_id    ON public.products(store_id);
CREATE INDEX idx_products_category_id ON public.products(category_id);
CREATE INDEX idx_products_status      ON public.products(store_id, status);

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER products_prevent_store_id_change
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_change();

-- =====================
-- [2] product_variants
--     El producto referenciado debe pertenecer a la misma tienda.
-- =====================
CREATE TABLE public.product_variants (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   uuid          NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid          NOT NULL,    -- FK compuesta se agrega abajo
  sku        text          NOT NULL CHECK (length(trim(sku)) > 0),
  attributes jsonb         NOT NULL DEFAULT '{}'::jsonb,
  price      numeric(12,2) CHECK (price IS NULL OR price >= 0),
  stock      integer       NOT NULL DEFAULT 0 CHECK (stock >= 0),
  created_at timestamptz   NOT NULL DEFAULT now(),
  updated_at timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (store_id, sku),
  UNIQUE (store_id, id)                 -- ancla para stock_movements
);

ALTER TABLE public.product_variants
  ADD CONSTRAINT fk_product_variants_product
  FOREIGN KEY (store_id, product_id) REFERENCES public.products(store_id, id)
  ON DELETE CASCADE;

CREATE INDEX idx_product_variants_store_id   ON public.product_variants(store_id);
CREATE INDEX idx_product_variants_product_id ON public.product_variants(product_id);

CREATE TRIGGER product_variants_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER product_variants_prevent_store_id_change
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_change();

-- =====================
-- [2] product_images
--     El producto referenciado debe pertenecer a la misma tienda.
-- =====================
CREATE TABLE public.product_images (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid        NOT NULL,      -- FK compuesta se agrega abajo
  path       text        NOT NULL CHECK (path LIKE store_id::text || '/%'),
  position   integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_images
  ADD CONSTRAINT fk_product_images_product
  FOREIGN KEY (store_id, product_id) REFERENCES public.products(store_id, id)
  ON DELETE CASCADE;

CREATE INDEX idx_product_images_store_id   ON public.product_images(store_id);
CREATE INDEX idx_product_images_product_id ON public.product_images(product_id);

CREATE TRIGGER product_images_updated_at
  BEFORE UPDATE ON public.product_images
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER product_images_prevent_store_id_change
  BEFORE UPDATE ON public.product_images
  FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_change();

-- =====================
-- [2] stock_movements
--     La variante referenciada debe pertenecer a la misma tienda.
--     Sin updated_at (historial inmutable; RLS no expone UPDATE/DELETE).
-- =====================
CREATE TABLE public.stock_movements (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   uuid        NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  variant_id uuid        NOT NULL,      -- FK compuesta se agrega abajo
  delta      integer     NOT NULL,
  reason     text,
  user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_movements
  ADD CONSTRAINT fk_stock_movements_variant
  FOREIGN KEY (store_id, variant_id) REFERENCES public.product_variants(store_id, id)
  ON DELETE NO ACTION;

CREATE INDEX idx_stock_movements_store_id   ON public.stock_movements(store_id);
CREATE INDEX idx_stock_movements_variant_id ON public.stock_movements(variant_id);

-- =====================
-- Trigger: auditoría automática de stock
-- SECURITY DEFINER: el trigger inserta en stock_movements aunque el usuario
-- autenticado no tenga política INSERT (nadie la tiene; solo este trigger puede).
-- auth.uid() devuelve el UID del llamador incluso con SECURITY DEFINER porque
-- lee de request.jwt.claims, que es un GUC de sesión no afectado por el rol.
-- =====================
CREATE OR REPLACE FUNCTION public.audit_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delta  integer;
  v_reason text;
BEGIN
  v_delta := NEW.stock - COALESCE(OLD.stock, 0);
  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  v_reason := current_setting('app.stock_reason', true);
  IF v_reason IS NULL OR v_reason = '' THEN
    v_reason := CASE WHEN TG_OP = 'INSERT' THEN 'stock inicial' ELSE 'ajuste manual' END;
  END IF;

  INSERT INTO public.stock_movements (store_id, variant_id, delta, reason, user_id)
  VALUES (NEW.store_id, NEW.id, v_delta, v_reason, auth.uid());

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_stock_movement() FROM PUBLIC;

CREATE TRIGGER product_variants_stock_audit
  AFTER INSERT OR UPDATE OF stock ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.audit_stock_movement();
