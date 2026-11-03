// Utilidades de imagen seguras para cliente y servidor.
// Sin imports de server-only.

export const MAX_PRODUCT_IMAGES = 15

export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export const HEIC_MIME = ['image/heic', 'image/heif'] as const

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB antes de comprimir

/**
 * Valida un archivo de imagen.
 * Retorna un mensaje de error en español o null si es válido.
 */
export function validateImageFile(file: File): string | null {
  const isHeic =
    (HEIC_MIME as readonly string[]).includes(file.type) ||
    /\.hei[cf]$/i.test(file.name)
  if (isHeic) {
    return `Formato HEIC/HEIF no compatible. Convertilo a JPG o WebP antes de subir.`
  }
  if (!ACCEPTED_MIME.includes(file.type as typeof ACCEPTED_MIME[number])) {
    return `Formato no compatible: ${file.type || 'desconocido'}. Usá JPG, PNG o WebP.`
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return `El archivo pesa ${mb} MB. El máximo es 10 MB (se va a comprimir automáticamente).`
  }
  return null
}

/**
 * Redimensiona una imagen al lado máximo indicado y la convierte a WebP.
 * Si el navegador no soporta WebP en canvas, cae a JPEG.
 */
export async function resizeAndConvert(
  file: File,
  maxSide = 1600,
  quality = 0.82
): Promise<{ blob: Blob; mimeType: 'image/webp' | 'image/jpeg'; ext: 'webp' | 'jpg' }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      let { width, height } = img
      if (width > maxSide || height > maxSide) {
        if (width >= height) {
          height = Math.round((height / width) * maxSide)
          width = maxSide
        } else {
          width = Math.round((width / height) * maxSide)
          height = maxSide
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('No se pudo crear el contexto de canvas'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)

      // Intentar WebP; si el navegador no lo soporta el blob será null
      canvas.toBlob(
        (webpBlob) => {
          if (webpBlob) {
            resolve({ blob: webpBlob, mimeType: 'image/webp', ext: 'webp' })
          } else {
            // Fallback a JPEG
            canvas.toBlob(
              (jpegBlob) => {
                if (jpegBlob) {
                  resolve({ blob: jpegBlob, mimeType: 'image/jpeg', ext: 'jpg' })
                } else {
                  reject(new Error('No se pudo convertir la imagen'))
                }
              },
              'image/jpeg',
              quality
            )
          }
        },
        'image/webp',
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No se pudo cargar la imagen'))
    }

    img.src = objectUrl
  })
}
