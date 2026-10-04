"use client"

// Miga de pan "Inicio › Área › Pantalla › Pestaña" encima de cada módulo.
// Solo navegación: Inicio y Área son clic; la pantalla/pestaña actual no.

import { Home } from "lucide-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import type { GroupKey } from "@/lib/dashboard-data"
import { etiquetaDeGrupo, etiquetaDeModulo, etiquetaDeTab, hubDe } from "@/lib/navegacion"

interface MigaNavegacionProps {
  groupKey: GroupKey
  moduleName: string
  onInicio?: () => void
  onGrupo: (key: GroupKey) => void
}

export function MigaNavegacion({ groupKey, moduleName, onInicio, onGrupo }: MigaNavegacionProps) {
  const hub = hubDe(groupKey, moduleName)
  const enlace = "rounded px-1 py-0.5 hover:bg-accent hover:text-foreground transition-colors"
  return (
    <Breadcrumb className="mb-2 hidden md:block">
      <BreadcrumbList className="text-[12px] sm:gap-1.5">
        {onInicio && (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button type="button" onClick={onInicio} className={`inline-flex items-center gap-1 ${enlace}`}>
                  <Home className="h-3.5 w-3.5" /> Inicio
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <button type="button" onClick={() => onGrupo(groupKey)} className={enlace}>
              {etiquetaDeGrupo(groupKey)}
            </button>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {hub ? (
          <>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold">{hub.title}</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{etiquetaDeTab(hub, moduleName)}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage className="font-semibold">{etiquetaDeModulo(moduleName)}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
