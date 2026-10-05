import type React from "react"
import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Analytics } from "@vercel/analytics/next"
import Script from "next/script"
import { AuthProvider } from "@/components/auth-provider"
import { SubmoduloFiltroProvider } from "@/components/submodulo-filtro-context"
import GlobalLocationScheduler from "@/components/global-location-scheduler"
import { PwaInstallPrompt } from "@/components/pwa-install-prompt"
import { MonitorErrores } from "@/components/monitor-errores"
import { Toaster } from "@/components/ui/toaster"
import "./globals.css"

// Sistema visual LIPgo (2026-10-02): IBM Plex Sans en toda la app (industrial,
// números tabulares limpios). Se expone como --font-plex y globals.css la usa
// en --font-sans, así `font-sans` la aplica en todas partes sin tocar módulos.
// FUENTES LOCALES, no de Google (2026-10-05). Con `next/font/google` el build de Vercel fallaba
// al azar con "next/font/google queries have exactly one entry": un defecto intermitente de
// Turbopack al restaurar la caché del build, que pasó dos veces el 4 de octubre (commits 52c4c7e
// y fee073a) y se "arreglaba" solo al volver a desplegar. Un build que falla al azar no es
// aceptable, así que los archivos viven en el repo (app/fonts, licencia OFL) y el build no
// depende de ningún servicio externo. Son las mismas fuentes y los mismos pesos: nada cambia
// a la vista. Además la página ya no hace una ida y vuelta a Google para pintar texto.
const plex = localFont({
  src: [{ path: "./fonts/ibm-plex-sans-latin.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-plex",
  display: "swap",
})
const geistMono = localFont({
  src: [{ path: "./fonts/geist-mono-latin.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-geist-mono",
  display: "swap",
})

export const viewport: Viewport = {
  themeColor: "#5bc0de",
}

export const metadata: Metadata = {
  title: "LiPGO - Centro de Operaciones",
  description: "Aplicación web de logística y operaciones",
  generator: "v0.app",
  applicationName: "LIPgo",
  appleWebApp: {
    capable: true,
    title: "LIPgo",
    statusBarStyle: "default",
  },
  // iOS/Safari necesita el meta legacy `apple-mobile-web-app-capable=yes` para
  // que "Añadir a pantalla de inicio" abra la app en modo standalone (pantalla
  // completa, como app) y no como un simple acceso directo a Safari. Next solo
  // emite el estándar `mobile-web-app-capable`, así que lo agregamos explícito.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body className={`${plex.variable} ${geistMono.variable} font-sans antialiased`}>
        {/* Captura temprana del evento de instalacion (puede dispararse antes
            de montar React); el banner PWA lo consume desde window.__lipgoBIP. */}
        <Script id="pwa-bip-capture" strategy="beforeInteractive">
          {`window.__lipgoBIP=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__lipgoBIP=e;window.dispatchEvent(new Event('lipgo-bip'));});`}
        </Script>
        <AuthProvider>
          {/* Scheduler invisible: captura ubicacion a las 08:00, 14:00 y 17:00
              hora de Colombia (ver components/global-location-scheduler.tsx) */}
          <GlobalLocationScheduler />
          {/* Filtro año/mes del submódulo compartido con la tira de KPIs del módulo. */}
          <SubmoduloFiltroProvider>{children}</SubmoduloFiltroProvider>
          {/* Necesario para que useToast muestre feedback en toda la app. */}
          <Toaster />
        </AuthProvider>
        {/* Banner "¿Quieres instalar LIPgo?" (PWA) en escritorio y movil. */}
        <PwaInstallPrompt />
        {/* Monitoreo de errores propio (SQL 217): errores no capturados y promesas rechazadas. */}
        <MonitorErrores />
        <Analytics />
        <Script
          src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  )
}
