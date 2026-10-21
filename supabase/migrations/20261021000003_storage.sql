-- Migración 003: Storage
-- ============================================================
-- CAMBIOS vs borrador anterior:
--   [3] Políticas de escritura usan is_store_member_text() para evitar
--       que una ruta malformada lance error de cast ::uuid.
--   [3] UPDATE tiene USING + WITH CHECK (faltaba).
--   [7] TO authenticated en INSERT/UPDATE/DELETE. Con esta cláusula,
--       auth.uid() IS NOT NULL es redundante y se elimina.
--   [8] Sin política SELECT: el bucket public=true sirve las URLs directas
--       (CDN) sin necesidad de política RLS. Sin política SELECT, nadie
--       puede LISTAR los archivos de todas las tiendas (evita enumeración).
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  10485760,   -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura: el miembro ve y lista solo objetos de su propia carpeta.
-- Necesario para que el panel haga upsert/move (Supabase Storage hace un
-- SELECT interno para verificar si el objeto ya existe antes de escribir).
-- Sin política SELECT para anon: las URLs públicas siguen funcionando por
-- CDN (bucket public=true); lo que se restringe es el listado vía API RLS.
CREATE POLICY "storage_product_images_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND public.is_store_member_text(split_part(name, '/', 1))
  );

-- Subida: solo miembros de la tienda dueña de la carpeta raíz.
-- Ruta esperada: {store_id}/subcarpeta/archivo.ext
-- split_part(name, '/', 1) extrae el primer segmento (store_id como texto).
CREATE POLICY "storage_product_images_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND public.is_store_member_text(split_part(name, '/', 1))
  );

CREATE POLICY "storage_product_images_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND public.is_store_member_text(split_part(name, '/', 1))
  );

-- UPDATE: tanto USING (fila existente) como WITH CHECK (nuevo valor).
CREATE POLICY "storage_product_images_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND public.is_store_member_text(split_part(name, '/', 1))
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND public.is_store_member_text(split_part(name, '/', 1))
  );
