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
// · Diseño (sistema visual LIPgo, 2026-10-02): barra de pantalla FIJA al hacer
//   scroll con el color del área en el borde izquierdo, el ícono y el título
//   del hub, y las pestañas como píldoras; la activa va con el tinte del área.
//   Cada pestaña muestra su contador de pendientes vivo (misma fuente que el
//   portal: getPendientesPorPantalla). Los indicadores del área y la guía de la
//   pestaña ya no son bandas debajo: son dos botones al final de la barra que
//   abren un panel lateral (gerencia 2026-10-03: las bandas bajaban el contenido
//   en todos los módulos). `cabecera` queda opcional por compatibilidad.

import React, { type CSSProperties } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import { useAuth } from "@/components/auth-provider"
import { colorDeEntrada, etiquetaDeGrupo, etiquetaDeTab, moduloPorNombre, type Hub } from "@/lib/navegacion"
import { getPendientesPorPantalla, type PendientePantalla } from "@/lib/pendientes-pantalla-actions"
import { BotonesContextoModulo } from "@/components/contexto-modulo"

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
  const { selectedEmpresaId } = useAuth()
  const tabs = hub.tabs.filter((t) => isModuleVisible(t.module))
  const firmaTabs = tabs.map((t) => t.module).join("|")

  // Enlace directo a una pestaña sin permiso → primera visible.
  React.useEffect(() => {
    if (!loaded || tabs.length === 0) return
    if (!tabs.some((t) => t.module === activeModule)) onSelectTab(tabs[0].module)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, activeModule, firmaTabs])

  // Pendientes vivos por pestaña (conteos ligeros; refresco cada 2 min).
  const [pendientes, setPendientes] = React.useState<PendientePantalla[]>([])
  React.useEffect(() => {
    let cancel = false
    const load = () =>
      getPendientesPorPantalla(selectedEmpresaId ?? null)
        .then((r) => {
          if (!cancel) setPendientes(r.success && r.data ? r.data : [])
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 120000)
    return () => {
      cancel = true
      clearInterval(id)
    }
  }, [selectedEmpresaId])

  if (loaded && tabs.length === 0) return null
  const Icon = hub.icon
  const tint = colorDeEntrada(hub.group, { hubKey: hub.key })

  return (
    <Tabs value={activeModule} onValueChange={onSelectTab} className="gap-3" style={{ "--tint": tint } as CSSProperties}>
      {/* Barra de pantalla: fija arriba mientras se hace scroll dentro del módulo. */}
      <div className="sticky top-0 z-30 -mx-2 px-2 pb-2 pt-1 sm:-mx-4 sm:px-4 lg:-mx-8 lg:px-8 xl:-mx-12 xl:px-12 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border border-border bg-card py-2 pl-4 pr-3 shadow-sm"
          style={{ boxShadow: `inset 4px 0 0 ${tint}, 0 1px 2px rgba(11,18,32,.04)` }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: `color-mix(in srgb, ${tint} 14%, #fff)`, color: tint }}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="lg-eyebrow">{etiquetaDeGrupo(hub.group)}</p>
              <h2 className="truncate text-sm font-bold leading-tight text-foreground">{hub.title}</h2>
            </div>
          </div>

          {loaded && tabs.length > 0 && (
            <div className="ml-auto flex max-w-full items-center gap-2 overflow-x-auto py-0.5">
              {/* Con UNA sola pestaña la tira sobra: seria un boton que no lleva
                  a ningun otro lado (caso "Seguridad y accesos" desde el
                  2026-10-07, que es una pantalla con sus propias pestañas). Los
                  botones de contexto de abajo si se quedan. */}
              {tabs.length > 1 && (
              <TabsList className="h-auto gap-1 bg-transparent p-0">
                {tabs.map((t) => {
                  const TabIcon = moduloPorNombre(t.module)?.icon
                  const pend = pendientes.filter((p) => p.modulo === t.module)
                  const n = pend.reduce((s, p) => s + p.cantidad, 0)
                  const alto = pend.some((p) => p.nivel === "alto")
                  return (
                    <TabsTrigger
                      key={t.module}
                      value={t.module}
                      title={pend.length ? pend.map((p) => p.texto).join(" · ") : undefined}
                      className="h-8 flex-none gap-1.5 rounded-[9px] px-3 text-[12.5px] font-medium text-foreground/75 hover:bg-accent hover:text-foreground data-[state=active]:bg-[color-mix(in_srgb,var(--tint)_16%,#fff)] data-[state=active]:font-semibold data-[state=active]:text-[color-mix(in_srgb,var(--tint)_80%,#000)] data-[state=active]:shadow-none"
                    >
                      {TabIcon && <TabIcon className="h-3.5 w-3.5" />}
                      {etiquetaDeTab(hub, t.module)}
                      {n > 0 && (
                        <span className={`lg-num rounded-full px-1.5 py-px text-[10px] font-bold ${alto ? "bg-critico-bg text-critico-fg" : "bg-atencion-bg text-atencion-fg"}`}>{n > 99 ? "99+" : n}</span>
                      )}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
              )}
              {tabs.length > 1 && <span aria-hidden className="hidden h-6 w-px bg-border sm:block" />}
              <BotonesContextoModulo selectedModule={activeModule} />
            </div>
          )}
        </div>
      </div>

      {cabecera}
      <TabsContent value={activeModule}>{renderLeaf(activeModule)}</TabsContent>
    </Tabs>
  )
}
