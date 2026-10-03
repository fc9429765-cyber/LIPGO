"use client"

// Herramientas de contexto de una pantalla: "Indicadores" (los KPI del área, los mismos
// del portal) y "Guía" (la misma guía de Aprendizaje y LIPbot). Antes eran dos bandas
// permanentes encima del contenido de TODOS los módulos (banda de KPIs + cinta "Guía de
// este módulo"); gerencia 2026-10-03: quitaban espacio y bajaban la información. Ahora
// son dos botones en la barra de la pantalla que abren un panel lateral: cero altura,
// siempre a un clic, y las tres fuentes (Aprendizaje, LIPbot, aquí) siguen siendo una.

import { useState } from "react"
import { BookOpen, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { APRENDIZAJE_POR_MODULO } from "@/lib/aprendizaje-content"
import { GuiaModulo } from "@/components/guia-modulo-panel"
import { ModuleKpiHeader, groupKeyOf } from "@/components/module-kpi-header"
import { AlertasIndicadores } from "@/components/alertas-indicadores"
import { etiquetaDeGrupo } from "@/lib/navegacion"
import type { GroupKey } from "@/lib/dashboard-data"

export function BotonesContextoModulo({ selectedModule, className }: { selectedModule: string; className?: string }) {
  const [guiaAbierta, setGuiaAbierta] = useState(false)
  const [kpisAbiertos, setKpisAbiertos] = useState(false)
  const contenido = APRENDIZAJE_POR_MODULO[selectedModule]
  const gk = groupKeyOf(selectedModule)
  if (!contenido && !gk) return null

  const boton = "h-8 gap-1.5 px-2 text-[12.5px] font-medium text-foreground/70 hover:text-foreground"

  return (
    <div className={`flex shrink-0 items-center gap-0.5 ${className ?? ""}`}>
      {gk && (
        <Button variant="ghost" size="sm" className={boton} onClick={() => setKpisAbiertos(true)} title="Indicadores del área">
          <Gauge className="h-4 w-4" />
          <span className="hidden lg:inline">Indicadores</span>
        </Button>
      )}
      {contenido && (
        <Button variant="ghost" size="sm" className={boton} onClick={() => setGuiaAbierta(true)} title="Guía de esta pantalla">
          <BookOpen className="h-4 w-4" />
          <span className="hidden lg:inline">Guía</span>
        </Button>
      )}

      {gk && (
        <Sheet open={kpisAbiertos} onOpenChange={setKpisAbiertos}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
            <SheetHeader>
              <SheetTitle>Indicadores · {etiquetaDeGrupo(gk as GroupKey)}</SheetTitle>
              <SheetDescription>Los mismos indicadores del portal del área, para la pantalla en la que estás. Siguen el proyecto seleccionado arriba.</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <ModuleKpiHeader selectedModule={selectedModule} />
              <AlertasIndicadores groupKey={gk} moduleName={selectedModule} />
            </div>
          </SheetContent>
        </Sheet>
      )}
      {contenido && (
        <Sheet open={guiaAbierta} onOpenChange={setGuiaAbierta}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>Guía · {selectedModule}</SheetTitle>
              <SheetDescription>{contenido.resumen}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <GuiaModulo contenido={contenido} moduloName={selectedModule} etiqueta={selectedModule} mostrarAbrir={false} />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
