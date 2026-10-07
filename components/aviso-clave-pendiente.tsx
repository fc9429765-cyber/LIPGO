"use client"

// FRANJA DE "TE FALTA TU CLAVE DE AUTORIZACIÓN".
//
// POR QUÉ ESTÁ A LA VISTA Y NO EN UN MENÚ
//
// El aviso ya existía: un borde ámbar en el avatar y una línea dentro del menú del
// usuario. Llevaba ahí desde el 27 de septiembre. Medido el 2026-10-07, a 20 días de que
// venzan las claves compartidas: de 21 personas con perfil de autorización asignado, 19
// seguían sin clave. Y 18 de esas 19 entran a la aplicación con normalidad, dos habían
// entrado ese mismo día. O sea: el aviso estaba, pero donde nadie lo mira.
//
// Tampoco se les puede escribir un correo: ninguna de las 19 tiene correo real registrado,
// porque las cuentas @lipgo.app no son buzones. El único canal que funciona es este.
//
// El día que venzan las claves compartidas, quien no tenga la suya no podrá aprobar
// cartera, ni aprobar o anular pedidos, ni cerrar pendientes, ni aprobar movimientos de
// inventario, ni liberar cuarentena. Se le cae la operación. Por eso la franja cuenta los
// días que faltan, y en la última semana deja de poder posponerse.
//
// No toca permisos, ni datos, ni ninguna lógica existente: solo muestra lo que ya devuelve
// `getAvisoMiClave`. Quien ya tiene su clave no ve absolutamente nada.

import { useEffect, useState } from "react"
import { KeyRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { avisoDeClave, type Aviso } from "@/lib/aviso-clave"

const ESTILOS: Record<Aviso["tono"], { caja: string; titulo: string; texto: string; boton: string }> = {
  info: {
    caja: "border-sky-300 bg-sky-50",
    titulo: "text-sky-900",
    texto: "text-sky-800",
    boton: "bg-sky-600 text-white hover:bg-sky-700",
  },
  atencion: {
    caja: "border-amber-300 bg-amber-50",
    titulo: "text-amber-900",
    texto: "text-amber-800",
    boton: "bg-amber-600 text-white hover:bg-amber-700",
  },
  critico: {
    caja: "border-red-300 bg-red-50",
    titulo: "text-red-900",
    texto: "text-red-800",
    boton: "bg-red-600 text-white hover:bg-red-700",
  },
}

export function AvisoClavePendiente({
  motivo,
  transicionHasta,
  hoy,
  onAbrir,
}: {
  motivo: "sin_clave" | "provisional" | null
  transicionHasta: string | null
  hoy: string
  onAbrir: () => void
}) {
  // Posponer dura lo que dure la pestaña abierta, nunca más: el plazo es real y volver a
  // verlo mañana es justamente el punto. Un aviso crítico no se puede posponer.
  const [pospuesto, setPospuesto] = useState(false)
  useEffect(() => {
    setPospuesto(false)
  }, [motivo, transicionHasta])

  const aviso = avisoDeClave(motivo, transicionHasta, hoy)
  if (!aviso) return null
  if (pospuesto && aviso.sePuedePosponer) return null

  const e = ESTILOS[aviso.tono]
  return (
    <div className={`border-b ${e.caja}`} role="status" aria-live="polite">
      <div className="container mx-auto flex max-w-7xl flex-col gap-2 px-2 py-2.5 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
        <KeyRound className={`h-5 w-5 shrink-0 ${e.titulo}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${e.titulo}`}>{aviso.titulo}</p>
          <p className={`text-xs sm:text-sm ${e.texto}`}>{aviso.texto}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" className={`gap-1.5 ${e.boton}`} onClick={onAbrir}>
            <KeyRound className="h-4 w-4" />
            {aviso.boton}
          </Button>
          {aviso.sePuedePosponer && (
            <Button
              size="sm"
              variant="ghost"
              className={`h-8 w-8 p-0 ${e.titulo}`}
              onClick={() => setPospuesto(true)}
              aria-label="Ocultar el aviso hasta la próxima vez que entres"
              title="Ocultar hasta la próxima vez que entres"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
