-- =============================================================================
-- seed.sql — SOLO DESARROLLO LOCAL
-- =============================================================================
-- Se ejecuta automáticamente en: npx supabase db reset
-- NO aplicar a staging ni producción (no tiene validaciones de entorno;
-- en producción no corre porque db reset no se usa contra la nube).
--
-- Credenciales del usuario de prueba:
--   email:    test@local.test
--   password: Test1234!local
--
-- Tienda creada: «Punto de Oro (prueba)» — slug: punto-de-oro-prueba
-- Slug distinto del real (punto-de-oro) para no pisar datos reales si
-- se ejecutara por error contra algún entorno compartido.
--
-- IDEMPOTENTE: todos los INSERT usan ON CONFLICT ... DO NOTHING.
-- Los tests pgTAP no se ven afectados porque usan UUIDs con prefijos
-- distintos (10...0001-0004, 20...0001-0004, 30..., 40..., 50...);
-- el seed usa el prefijo eeeeeeee-... para ser inequívoco.
-- =============================================================================

DO $seed$
DECLARE
  -- ── UUIDs fijos del entorno local ──────────────────────────────────────────
  v_uid  CONSTANT uuid := 'eeeeeeee-0000-0000-0000-000000000001';  -- auth user
  v_iid  CONSTANT uuid := 'eeeeeeee-0000-0000-0000-000000000002';  -- auth identity
  v_sid  CONSTANT uuid := 'eeeeeeee-0000-0000-0000-000000000010';  -- store

  -- Categorías raíz
  v_cat_raquetas   CONSTANT uuid := 'eeeeeeee-0001-0000-0000-000000000001';
  v_cat_pelotas    CONSTANT uuid := 'eeeeeeee-0001-0000-0000-000000000002';
  v_cat_calzado    CONSTANT uuid := 'eeeeeeee-0001-0000-0000-000000000003';
  v_cat_accesorios CONSTANT uuid := 'eeeeeeee-0001-0000-0000-000000000004';

  -- Subcategorías
  v_sub_padel_raq  CONSTANT uuid := 'eeeeeeee-0001-0000-0000-000000000011';
  v_sub_tenis_raq  CONSTANT uuid := 'eeeeeeee-0001-0000-0000-000000000012';
  v_sub_padel_pel  CONSTANT uuid := 'eeeeeeee-0001-0000-0000-000000000021';
  v_sub_padel_cal  CONSTANT uuid := 'eeeeeeee-0001-0000-0000-000000000031';

  -- Productos
  v_prod_1 CONSTANT uuid := 'eeeeeeee-0002-0000-0000-000000000001';
  v_prod_2 CONSTANT uuid := 'eeeeeeee-0002-0000-0000-000000000002';
  v_prod_3 CONSTANT uuid := 'eeeeeeee-0002-0000-0000-000000000003';
  v_prod_4 CONSTANT uuid := 'eeeeeeee-0002-0000-0000-000000000004';
  v_prod_5 CONSTANT uuid := 'eeeeeeee-0002-0000-0000-000000000005';

  -- Variantes (prod 1: tallas S/M/L; prod 4: números 40-43; resto: única)
  v_var_1s CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000001';
  v_var_1m CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000002';
  v_var_1l CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000003';
  v_var_2  CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000004';
  v_var_3  CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000005';
  v_var_4a CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000006';
  v_var_4b CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000007';
  v_var_4c CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000008';
  v_var_4d CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000009';
  v_var_5  CONSTANT uuid := 'eeeeeeee-0003-0000-0000-000000000010';

  v_email CONSTANT text := 'test@local.test';
BEGIN

  -- ── 1. Usuario Auth ─────────────────────────────────────────────────────────
  -- instance_id: '00000000-...' es el UUID de instancia requerido por GoTrue local
  -- encrypted_password: bcrypt cost 10 (mismo que usa la Admin API de GoTrue)
  -- email_confirmed_at: marcado como confirmado para que el login funcione
  -- confirmed_at: columna STORED generated (LEAST(email_confirmed_at, phone_confirmed_at))
  --   no se puede insertar explícitamente
  -- raw_user_meta_data: GoTrue espera {"email_verified":true} para usuarios confirmados
  -- email_change / phone / phone_change / phone_change_token / reauthentication_token:
  --   deben ser strings vacíos (GoTrue los escanea como string, no *string → NULL rompe)
  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, is_sso_user, is_anonymous,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current,
    email_change, phone, phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v_email, crypt('Test1234!local', gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"email_verified":true}'::jsonb,
    false, false, false,
    now(), now(),
    '', '', '', '',
    '', '', '', '', ''
  ) ON CONFLICT (id) DO NOTHING;

  -- ── 2. Identity (requerida para signInWithPassword) ─────────────────────────
  -- provider_id para el provider 'email' es el email mismo
  -- 'email' es columna STORED generated: lower(identity_data->>'email'), no se inserta
  -- identity_data: GoTrue espera sub, email, email_verified y phone_verified
  INSERT INTO auth.identities (
    id, user_id, provider_id, provider,
    identity_data,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_iid, v_uid, v_email, 'email',
    jsonb_build_object(
      'sub',            v_uid::text,
      'email',          v_email,
      'email_verified', false,
      'phone_verified', false
    ),
    now(), now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  -- ── 3. Tienda ────────────────────────────────────────────────────────────────
  INSERT INTO public.stores (id, name, slug, accent_color)
  VALUES (v_sid, 'Punto de Oro (prueba)', 'punto-de-oro-prueba', '#E9B949')
  ON CONFLICT (id) DO NOTHING;

  -- ── 4. Membresía owner ───────────────────────────────────────────────────────
  INSERT INTO public.store_members (user_id, store_id, role)
  VALUES (v_uid, v_sid, 'owner')
  ON CONFLICT DO NOTHING;

  -- ── 5. Categorías raíz ───────────────────────────────────────────────────────
  INSERT INTO public.categories (id, store_id, name, slug, position) VALUES
    (v_cat_raquetas,   v_sid, 'Raquetas',   'raquetas',   1),
    (v_cat_pelotas,    v_sid, 'Pelotas',    'pelotas',    2),
    (v_cat_calzado,    v_sid, 'Calzado',    'calzado',    3),
    (v_cat_accesorios, v_sid, 'Accesorios', 'accesorios', 4)
  ON CONFLICT (id) DO NOTHING;

  -- ── 6. Subcategorías ─────────────────────────────────────────────────────────
  INSERT INTO public.categories (id, store_id, parent_id, name, slug, position) VALUES
    (v_sub_padel_raq, v_sid, v_cat_raquetas, 'Pádel', 'padel-raquetas', 1),
    (v_sub_tenis_raq, v_sid, v_cat_raquetas, 'Tenis', 'tenis-raquetas', 2),
    (v_sub_padel_pel, v_sid, v_cat_pelotas,  'Pádel', 'padel-pelotas',  1),
    (v_sub_padel_cal, v_sid, v_cat_calzado,  'Pádel', 'padel-calzado',  1)
  ON CONFLICT (id) DO NOTHING;

  -- ── 7. Productos ─────────────────────────────────────────────────────────────
  INSERT INTO public.products (id, store_id, category_id, name, slug, brand, price, status) VALUES
    (v_prod_1, v_sid, v_sub_padel_raq, 'Raqueta Head Delta Motion',  'raqueta-head-delta-motion',  'Head',    45000, 'active'),
    (v_prod_2, v_sid, v_sub_padel_raq, 'Raqueta Babolat Viper',      'raqueta-babolat-viper',      'Babolat', 52000, 'active'),
    (v_prod_3, v_sid, v_sub_padel_pel, 'Pelotas Head Tour x3',       'pelotas-head-tour-x3',       'Head',     1800, 'active'),
    (v_prod_4, v_sid, v_sub_padel_cal, 'Zapatillas Head Sprint Pro', 'zapatillas-head-sprint-pro', 'Head',    28000, 'active'),
    (v_prod_5, v_sid, v_cat_accesorios,'Bolso Wilson Tour',          'bolso-wilson-tour',          'Wilson',  15000, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- ── 8. Variantes ─────────────────────────────────────────────────────────────
  -- El trigger audit_stock_movement() inserta en stock_movements automáticamente
  -- con reason='stock inicial' (app.stock_reason no está seteado en el seed).

  -- Raqueta Head Delta Motion — tallas S / M / L
  INSERT INTO public.product_variants (id, store_id, product_id, sku, attributes, stock) VALUES
    (v_var_1s, v_sid, v_prod_1, 'HDM-S', '{"talle":"S"}'::jsonb, 5),
    (v_var_1m, v_sid, v_prod_1, 'HDM-M', '{"talle":"M"}'::jsonb, 8),
    (v_var_1l, v_sid, v_prod_1, 'HDM-L', '{"talle":"L"}'::jsonb, 3)
  ON CONFLICT (id) DO NOTHING;

  -- Raqueta Babolat Viper — variante única
  INSERT INTO public.product_variants (id, store_id, product_id, sku, attributes, stock) VALUES
    (v_var_2, v_sid, v_prod_2, 'BBV-001', '{}'::jsonb, 4)
  ON CONFLICT (id) DO NOTHING;

  -- Pelotas Head Tour x3 — variante única
  INSERT INTO public.product_variants (id, store_id, product_id, sku, attributes, stock) VALUES
    (v_var_3, v_sid, v_prod_3, 'PHP-3X3', '{}'::jsonb, 20)
  ON CONFLICT (id) DO NOTHING;

  -- Zapatillas Head Sprint Pro — tallas 40 / 41 / 42 / 43
  INSERT INTO public.product_variants (id, store_id, product_id, sku, attributes, stock) VALUES
    (v_var_4a, v_sid, v_prod_4, 'ZHS-40', '{"talle":"40"}'::jsonb, 2),
    (v_var_4b, v_sid, v_prod_4, 'ZHS-41', '{"talle":"41"}'::jsonb, 3),
    (v_var_4c, v_sid, v_prod_4, 'ZHS-42', '{"talle":"42"}'::jsonb, 4),
    (v_var_4d, v_sid, v_prod_4, 'ZHS-43', '{"talle":"43"}'::jsonb, 1)
  ON CONFLICT (id) DO NOTHING;

  -- Bolso Wilson Tour — variante única
  INSERT INTO public.product_variants (id, store_id, product_id, sku, attributes, stock) VALUES
    (v_var_5, v_sid, v_prod_5, 'WLS-TUR', '{}'::jsonb, 7)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Seed local aplicado: usuario %, tienda "Punto de Oro (prueba)"', v_email;
END;
$seed$;
