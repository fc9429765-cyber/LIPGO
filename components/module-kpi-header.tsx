"use client"

import { groups } from "@/lib/dashboard-data"
import { AreaKpiStrip } from "@/components/area-kpi-strip"

// Encabezado de KPIs del MÓDULO: se muestra en CUALQUIER submódulo del módulo, para
// que el usuario vea siempre las tareas pendientes / indicadores que ameritan revisión
// del área en la que está trabajando. Detecta el grupo (módulo principal) al que
// pertenece el submódulo actual y pinta sus KPIs (los mismos de la portada del grupo).
export function groupKeyOf(moduleName: string | null): string | null {
  if (!moduleName) return null
  for (const g of groups) {
    if (g.modules?.some((m) => m.name === moduleName)) return g.key
    for (const sg of (g as any).subgroups ?? []) {
      if (sg.modules?.some((m: any) => m.name === moduleName)) return g.key
    }
  }
  return null
}

export function ModuleKpiHeader({ selectedModule }: { selectedModule: string | null }) {
  const gk = groupKeyOf(selectedModule)
  // Todos los módulos y submódulos muestran INDICADORES del BSC (valor + meta +
  // semáforo): el módulo madre sus indicadores gerenciales, cada submódulo el
  // indicador del área que alimenta. Se pasa el submódulo actual para resolver
  // su mapeo (kpisParaModulo); si no lo tiene, cae a los del grupo madre.
  if (gk) return <AreaKpiStrip groupKey={gk} moduleName={selectedModule} />
  return null
}
