const ALLOWED_ORIGINS = (process.env.PUBLIC_API_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export function corsHeaders(reqOrigin: string | null): Record<string, string> {
  let allowed: string | null = null
  if (ALLOWED_ORIGINS.includes('*')) {
    allowed = '*'
  } else if (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin)) {
    allowed = reqOrigin
  }
  if (!allowed) return {}
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

export function preflightResponse(reqOrigin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(reqOrigin) })
}

// Slug válido: minúsculas, dígitos, guiones intermedios; 1-200 chars.
const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
export function validSlug(s: string): boolean {
  return s.length <= 200 && SLUG_RE.test(s)
}
