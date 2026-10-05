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
          // CSP en modo REPORTE (2026-10-05): no bloquea nada; el navegador informa a
          // /api/csp-reporte lo que HABRÍA bloqueado y queda en app_errores (aviso diario).
          // La lista sale del inventario real de orígenes del navegador:
          //   · script: jsQR desde jsDelivr (app/layout.tsx), Vercel Analytics, y la barra de
          //     Vercel en las previsualizaciones. 'unsafe-inline' y 'unsafe-eval' por ahora:
          //     Next inyecta scripts en línea; se retiran cuando pasemos a nonces.
          //   · style: Tailwind y los `style={{}}` de las pantallas → 'unsafe-inline'.
          //   · img: fotos y PDFs de Supabase Storage, logos en Vercel Blob, mapa (OpenStreetMap)
          //     e iconos de Leaflet (unpkg), más data:/blob: de cámara, QR y PDF en memoria.
          //   · connect: Supabase (REST y realtime wss), Vercel Vitals, y el túnel ngrok de la
          //     impresora de estibas (pallet-transfer-form / qr-pallet-registration).
          //   · frame: PDFs de Storage y blobs (ciclo de facturación, facturas, reglamento, turnos).
          // Cuando el aviso diario no traiga informes CSP en dos semanas de uso normal, se pasa
          // a Content-Security-Policy (modo estricto) con la misma lista.
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://va.vercel-scripts.com https://vercel.live",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co https://hebbkx1anhila5yf.public.blob.vercel-storage.com https://unpkg.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://vercel.live https://duct-dose-gentleman.ngrok-free.dev",
              "frame-src 'self' blob: data: https://*.supabase.co https://vercel.live",
              "media-src 'self' blob: data:",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
              "report-uri /api/csp-reporte",
            ].join("; "),
          },
        ],
      },
    ]
  },
}

export default nextConfig
