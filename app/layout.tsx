import type React from "react"
import type { Metadata, Viewport } from "next"
import { IBM_Plex_Sans, Geist_Mono } from "next/font/google"
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
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex", display: "swap" })
const _geistMono = Geist_Mono({ subsets: ["latin"] })

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
      <body className={`${plex.variable} font-sans antialiased`}>
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
