"use client"

/**
 * Red de seguridad para errores de render. Sin esto, un error no capturado
 * en CUALQUIER módulo (p. ej. algo que se rompe al desbloquear una clave y
 * montar contenido por primera vez) desmonta TODO el árbol de React desde
 * la raíz — en app/page.tsx, <Sidebar> y <MainContent> son hermanos sin
 * ningún error.tsx ni boundary de por medio, así que el sidebar entero
 * desaparece junto con el módulo roto, y la única salida es refrescar la
 * página completa.
 *
 * Con este boundary alrededor de <MainContent>, un error ahí queda contenido:
 * el sidebar sigue vivo y usable, y se muestra una tarjeta con el mensaje del
 * error y un botón para reintentar sin recargar la página.
 *
 * `resetKey`: cuando cambia (app/page.tsx le pasa grupo|módulo), el boundary
 * olvida el error solo, así que navegar fuera de un módulo roto lo recupera
 * sin el botón "Reintentar". Antes se lograba con un `key` que REMONTABA
 * MainContent entero en cada navegación; eso borraba el estado de los saltos
 * con dato (Gestión de Ordenes → Báscula con la orden, Visor → Ausentismos
 * con la persona, Ciclo → Solicitar Facturas filtrado, buscador → registro)
 * justo antes de que el módulo destino lo leyera.
 */

import React from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { reportarErrorApp } from "@/lib/errores-app"
import { esErrorDeDesfase, recargarPorDesfase } from "@/lib/desfase-despliegue"

interface Props {
  children: React.ReactNode
  /** Al cambiar, se limpia el error (sin remontar los hijos). */
  resetKey?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Error no capturado en el módulo:", error, info.componentStack)
    // Monitoreo propio (SQL 217): queda registrado con usuario, pantalla y versión.
    reportarErrorApp({ origen: "boundary", mensaje: error?.message ?? String(error), stack: error?.stack ?? null, componente: info.componentStack ?? null })
    // Pestaña vieja tras un despliegue: el navegador pide un archivo JS o una acción del
    // servidor que ya no existen. La única salida es recargar; se hace sola UNA vez cada 30 s
    // para no entrar en bucle. La detección vive en lib/desfase-despliegue.ts (probada con
    // los mensajes reales del 4 y 5 de octubre: "Failed to load chunk" no lo reconocía la
    // expresión anterior y cuatro usuarios quedaron con la pantalla rota).
    if (esErrorDeDesfase(`${error?.name} ${error?.message}`)) {
      recargarPorDesfase()
    }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div className="space-y-1">
            <p className="text-base font-medium">Este módulo tuvo un error inesperado.</p>
            <p className="max-w-md text-sm text-muted-foreground">
              El resto de la aplicación sigue funcionando — puedes cambiar de módulo desde el menú, o reintentar
              aquí mismo.
            </p>
            <p className="mt-2 max-w-md text-xs text-muted-foreground/80">{this.state.error.message}</p>
          </div>
          <Button onClick={this.reset} variant="outline" className="gap-2">
            <RotateCcw className="h-4 w-4" /> Reintentar
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
