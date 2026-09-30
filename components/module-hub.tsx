"use client"

// Hub de navegación: UNA pantalla con pestañas donde cada pestaña es un módulo
// existente, montado tal cual con su propio PermissionGuard (lo devuelve
// `renderLeaf`, la misma cadena de ramas de main-content). Cascarón sin lógica
// de negocio: patrón de components/rrhh/programacion-personal.tsx.
//
// · Solo se monta la pestaña activa → una sola llamada a /api/check-permission.
// · Las pestañas sin permiso no se pintan; si la pedida no es visible, se salta
//   a la primera visible; si ninguna lo es, no se pinta nada (misma política que
//   PermissionGuard: sin tarjeta de "sin permisos").
// · El estado sigue siendo el módulo HOJA (`activeModule`); el hub se deriva.

import React from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { etiquetaDeTab, type Hub } from "@/lib/navegacion"

interface ModuleHubProps {
  hub: Hub
  /** Módulo hoja activo (siempre un `name` real). */
  activeModule: string
  onSelectTab: (moduleName: string) => void
  renderLeaf: (moduleName: string) => React.ReactNode
}

export function ModuleHub({ hub, activeModule, onSelectTab, renderLeaf }: ModuleHubProps) {
  const { loaded, isModuleVisible } = useModulePermissions()
  const tabs = hub.tabs.filter((t) => isModuleVisible(t.module))
  const firmaTabs = tabs.map((t) => t.module).join("|")

  // Enlace directo a una pestaña sin permiso → primera visible.
  React.useEffect(() => {
    if (!loaded || tabs.length === 0) return
    if (!tabs.some((t) => t.module === activeModule)) onSelectTab(tabs[0].module)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, activeModule, firmaTabs])

  if (loaded && tabs.length === 0) return null
  const Icon = hub.icon

  return (
    <Tabs value={activeModule} onValueChange={onSelectTab} className="gap-3">
      {loaded && tabs.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Icon className="h-4 w-4 text-primary" />
            {hub.title}
          </span>
          <div className="max-w-full overflow-x-auto">
            <TabsList>
              {tabs.map((t) => (
                <TabsTrigger key={t.module} value={t.module}>
                  {etiquetaDeTab(hub, t.module)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
      )}
      <TabsContent value={activeModule}>{renderLeaf(activeModule)}</TabsContent>
    </Tabs>
  )
}
