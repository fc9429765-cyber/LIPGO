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
// · Diseño (ajuste 2026-09-30, gerencia: "se pierden los botones"): barra de
//   pantalla FIJA al hacer scroll, con el ícono y color del área, el título del
//   hub y las pestañas como píldoras con ícono; la activa va rellena con el
//   color del área. Los KPIs y la guía del módulo (`cabecera`) van DEBAJO de
//   las pestañas porque pertenecen a la pestaña, no al hub.

import React, { type CSSProperties } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { TINT_GRUPO, etiquetaDeGrupo, etiquetaDeTab, moduloPorNombre, type Hub } from "@/lib/navegacion"

interface ModuleHubProps {
  hub: Hub
  /** Módulo hoja activo (siempre un `name` real). */
  activeModule: string
  onSelectTab: (moduleName: string) => void
  renderLeaf: (moduleName: string) => React.ReactNode
  /** KPIs del área + guía del módulo activo: se pintan bajo las pestañas. */
  cabecera?: React.ReactNode
}

export function ModuleHub({ hub, activeModule, onSelectTab, renderLeaf, cabecera }: ModuleHubProps) {
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
  const tint = TINT_GRUPO[hub.group] ?? "#0e9c9c"

  return (
    <Tabs value={activeModule} onValueChange={onSelectTab} className="gap-3" style={{ "--tint": tint } as CSSProperties}>
      {/* Barra de pantalla: fija arriba mientras se hace scroll dentro del módulo. */}
      <div className="sticky top-0 z-30 -mx-2 px-2 pb-2 pt-1 sm:-mx-4 sm:px-4 lg:-mx-8 lg:px-8 xl:-mx-12 xl:px-12 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm"
          style={{ borderTopColor: tint, borderTopWidth: 3 }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: `color-mix(in srgb, ${tint} 14%, #fff)`,
                color: tint,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint} 22%, transparent)`,
              }}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{etiquetaDeGrupo(hub.group)}</p>
              <h2 className="truncate text-sm font-bold leading-tight text-foreground">{hub.title}</h2>
            </div>
          </div>

          {loaded && tabs.length > 0 && (
            <div className="ml-auto max-w-full overflow-x-auto py-0.5">
              <TabsList className="h-auto gap-1 bg-muted/70 p-1">
                {tabs.map((t) => {
                  const TabIcon = moduloPorNombre(t.module)?.icon
                  return (
                    <TabsTrigger
                      key={t.module}
                      value={t.module}
                      className="h-8 flex-none gap-1.5 rounded-md px-3 text-[12.5px] font-semibold text-foreground/75 hover:bg-background hover:text-foreground data-[state=active]:bg-[var(--tint)] data-[state=active]:text-white data-[state=active]:shadow-md"
                    >
                      {TabIcon && <TabIcon className="h-3.5 w-3.5" />}
                      {etiquetaDeTab(hub, t.module)}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </div>
          )}
        </div>
      </div>

      {cabecera}
      <TabsContent value={activeModule}>{renderLeaf(activeModule)}</TabsContent>
    </Tabs>
  )
}
