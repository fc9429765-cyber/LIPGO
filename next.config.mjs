/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Los errores de tipos VUELVEN a bloquear el build (2026-09-27). Estuvo en
    // `true` mientras el repo arrastraba errores; hoy `npx tsc --noEmit` está en
    // cero y así se queda: un error de tipos no debe llegar a producción sin
    // que nadie lo vea. Si el build de Vercel falla por tipos, se corrige el
    // tipo -- no se vuelve a poner `true`.
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    // Los Server Actions traen 1MB por defecto; los soportes SST (0312, 60
    // estándares, etc.) suben documentos (PDF/Word/imágenes) que fácilmente lo
    // superan y la subida se quedaba "cargando" sin subir. Se sube a 50MB.
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  // Cabeceras de seguridad (paso 6 del programa, 2026-10-03). Vercel ya pone HSTS.
  // Sin CSP todavía: la app carga fuentes y librerías de varios orígenes y una CSP
  // mal afinada rompe pantallas; se hará con informe (report-only) primero.
  // Cámara, micrófono y ubicación se permiten solo al propio origen: los usan el
  // lector de QR, la báscula con foto y el visor de ubicaciones.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ]
  },
}

export default nextConfig
