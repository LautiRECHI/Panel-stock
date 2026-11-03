import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === 'development'

// Derivar protocolo, host y puerto directamente de NEXT_PUBLIC_SUPABASE_URL.
// En local: http://127.0.0.1:54321 → http, 127.0.0.1, 54321
// En prod:  https://xyz.supabase.co → https, xyz.supabase.co, sin puerto
const supabaseRemotePattern = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  const { protocol, hostname, port } = new URL(raw)
  return {
    protocol: protocol.replace(':', '') as 'http' | 'https',
    hostname,
    ...(port ? { port } : {}),
    pathname: '/storage/v1/object/public/**',
  }
})()

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: supabaseRemotePattern ? [supabaseRemotePattern] : [],
    // Necesario en dev para que la optimización de imágenes pueda acceder a IPs locales/privadas
    ...(isDev ? { dangerouslyAllowLocalIP: true } : {}),
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
