"use client"

import { useEffect, useMemo, useState } from "react"
import { getUserModulesCached } from "@/lib/user-modules-client-cache"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { BookOpen, Search, Loader2, FileQuestion } from "lucide-react"
import { groups, type Module } from "@/lib/dashboard-data"
import { APRENDIZAJE_POR_MODULO, type ContenidoAprendizaje } from "@/lib/aprendizaje-content"
import { GuiaModulo } from "@/components/guia-modulo-panel"

interface UserModulesResponse {
  protectedModules: string[]
  allowedModules: string[]
}

/** Un modulo visible para el usuario, con su guia (o sin ella si falta). */
interface EntradaAprendizaje {
  modulo: Module
  contenido: ContenidoAprendizaje | undefined
}

/** Un grupo del menu con los modulos visibles que le quedaron al usuario. */
interface GrupoAprendizaje {
  titulo: string
  entradas: EntradaAprendizaje[]
}

/**
 * Modulo "Aprendizaje": la guia de usuario de LIPgo.
 *
 * Es universal (no esta en MODULE_PERMISSION_MAP, asi que todos lo ven en el
 * menu), pero el CONTENIDO se filtra por permisos: cada usuario solo ve la
 * guia de los modulos a los que tiene acceso. El filtro se resuelve contra
 * /api/user-modules, la MISMA fuente que usa el sidebar, para que lo que se
 * documenta aqui nunca se salga de lo que la persona realmente puede abrir.
 */
export function Aprendizaje() {
  const [protectedModules, setProtectedModules] = useState<Set<string>>(new Set())
  const [allowedModules, setAllowedModules] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState("")

  useEffect(() => {
    let cancelled = false
    const cargar = async () => {
      try {
        // `no-store` por el mismo motivo que el sidebar: un permiso recien
        // otorgado debe verse sin refresco fuerte.
        const data = await getUserModulesCached()
        if (cancelled) return
        setProtectedModules(new Set(data.protectedModules))
        setAllowedModules(new Set(data.allowedModules))
      } catch (error) {
        console.error("[v0] Aprendizaje: error cargando permisos:", error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    cargar()
    return () => {
      cancelled = true
    }
  }, [])

  // Misma regla de visibilidad que el sidebar: un modulo que no esta
  // protegido se ve siempre; uno protegido, solo si esta permitido.
  const esVisible = (nombre: string) => !protectedModules.has(nombre) || allowedModules.has(nombre)

  const gruposVisibles: GrupoAprendizaje[] = useMemo(() => {
    if (loading) return []
    const termino = busqueda.trim().toLowerCase()

    return groups
      .map((grupo) => {
        // Un grupo puede traer modulos sueltos y/o modulos dentro de subgrupos.
        const todos: Module[] = [
          ...(grupo.modules ?? []),
          ...(grupo.subgroups ?? []).flatMap((sg) => sg.modules),
        ]

        const entradas = todos
          .filter((m) => esVisible(m.name))
          .map((modulo) => ({ modulo, contenido: APRENDIZAJE_POR_MODULO[modulo.name] }))
          .filter(({ modulo, contenido }) => {
            if (!termino) return true
            const etiqueta = modulo.label ?? modulo.name
            return (
              etiqueta.toLowerCase().includes(termino) ||
              modulo.name.toLowerCase().includes(termino) ||
              (contenido?.resumen.toLowerCase().includes(termino) ?? false)
            )
          })

        return { titulo: grupo.title, entradas }
      })
      .filter((g) => g.entradas.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, protectedModules, allowedModules, busqueda])

  const totalVisibles = useMemo(
    () => gruposVisibles.reduce((n, g) => n + g.entradas.length, 0),
    [gruposVisibles],
  )
  const totalDocumentados = useMemo(
    () => gruposVisibles.reduce((n, g) => n + g.entradas.filter((e) => e.contenido).length, 0),
    [gruposVisibles],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 md:h-7 md:w-7 text-primary" />
            Aprendizaje
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Guia de los modulos a los que tienes acceso: para que sirven, que puedes hacer y que no.
          </p>
        </div>
        <Badge variant="secondary" className="w-fit text-xs">
          {totalDocumentados} de {totalVisibles} con guia disponible
        </Badge>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar un modulo..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9"
        />
      </div>

      {gruposVisibles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {busqueda
              ? "Ningun modulo coincide con la busqueda."
              : "Todavia no tienes modulos asignados. Solicita accesos al administrador."}
          </CardContent>
        </Card>
      ) : (
        gruposVisibles.map((grupo) => (
          <Card key={grupo.titulo}>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="text-base md:text-lg">{grupo.titulo}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
              <Accordion type="multiple" className="space-y-2">
                {grupo.entradas.map(({ modulo, contenido }) => (
                  <AccordionItem key={modulo.name} value={modulo.name} className="border rounded-lg px-3">
                    <AccordionTrigger className="hover:no-underline py-3">
                      <div className="flex flex-1 items-center justify-between gap-3 pr-2 text-left">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <modulo.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="text-xs md:text-sm font-medium truncate">
                              {modulo.label ?? modulo.name}
                            </span>
                          </div>
                          {contenido && (
                            <p className="mt-0.5 truncate pl-6 text-[11px] text-muted-foreground">{contenido.resumen}</p>
                          )}
                        </div>
                        {!contenido && (
                          <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                            Pendiente de documentar
                          </Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      {contenido ? (
                        <GuiaModulo contenido={contenido} moduloName={modulo.name} etiqueta={modulo.label ?? modulo.name} />
                      ) : (
                        <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs md:text-sm text-muted-foreground">
                          <FileQuestion className="h-4 w-4 shrink-0 mt-0.5" />
                          <p>
                            Este modulo todavia no tiene guia escrita. Se ira completando en las
                            proximas entregas del modulo de Aprendizaje.
                          </p>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

