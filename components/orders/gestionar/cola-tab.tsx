"use client"

// Pestaña "Cola": pedidos abiertos ordenados por urgencia, con el estado derivado,
// el siguiente paso como botón y el menú con las mismas acciones de siempre.

import { useMemo, useState } from "react"
import { ChevronRight, Eraser, Lock, MoreHorizontal, Search, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Chip, EstadoVacio, Punto } from "@/components/ui/lipgo"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { ColaPedidos, PedidoCola } from "@/lib/pedidos-cola-actions"
import { normalizarEstado, pesoOrdenCola } from "@/lib/pedidos-estado"
import { EstadoChip } from "./estado-chip"
import { NUM, fechaCorta, relativoPromesa } from "./formato"
import type { TipoAccion } from "./acciones-pedido"

export type FiltroCola = "todos" | "atrasados" | "hoy" | "programados" | "en_cargue" | "parciales" | "por_aprobar" | "sin_fecha" | `fecha:${string}`

export const FILTROS_COLA: { valor: FiltroCola; etiqueta: string; tono: "critico" | "info" | "atencion" | "neutro" | null }[] = [
  { valor: "todos", etiqueta: "Todos", tono: null },
  { valor: "atrasados", etiqueta: "Atrasados", tono: "critico" },
  { valor: "hoy", etiqueta: "Hoy", tono: "info" },
  { valor: "programados", etiqueta: "Programados", tono: "info" },
  // Los parciales van aparte de "en cargue" (gerencia 2026-10-04: "sería bueno que en el
  // módulo de pedidos estén muy visibles los que tienen entregas parciales"): un pedido que
  // salió a medias necesita seguimiento propio hasta completarse o cerrarse con su motivo.
  { valor: "parciales", etiqueta: "Entregas parciales", tono: "atencion" },
  { valor: "en_cargue", etiqueta: "En cargue", tono: "info" },
  { valor: "por_aprobar", etiqueta: "Por aprobar", tono: "neutro" },
]

export function filtrarCola(pedidos: PedidoCola[], filtro: FiltroCola): PedidoCola[] {
  if (filtro.startsWith("fecha:")) {
    const f = filtro.slice(6)
    return pedidos.filter((p) => p.fecha_programada === f)
  }
  switch (filtro) {
    case "atrasados":
      return pedidos.filter((p) => p.calc.estado === "programado" && p.calc.atrasoDias > 0)
    case "hoy":
      return pedidos.filter((p) => p.calc.esHoy && !p.calc.esFinal)
    case "programados":
      return pedidos.filter((p) => p.calc.estado === "programado" && p.calc.atrasoDias < 0)
    case "en_cargue":
      return pedidos.filter((p) => p.calc.estado === "en_cargue")
    case "parciales":
      return pedidos.filter((p) => p.calc.estado === "parcial")
    case "por_aprobar":
      return pedidos.filter((p) => p.calc.estado === "nuevo")
    case "sin_fecha":
      return pedidos.filter((p) => p.calc.estado === "aprobado_sin_programar")
    default:
      return pedidos
  }
}

export function ordenarCola(pedidos: PedidoCola[]): PedidoCola[] {
  return [...pedidos].sort((a, b) => {
    const pa = pesoOrdenCola(a.calc)
    const pb = pesoOrdenCola(b.calc)
    if (pa !== pb) return pa - pb
    // Dentro de los atrasados, el más reciente primero (es el que todavía se puede despachar).
    if (pa === 0) return (b.fecha_programada ?? "").localeCompare(a.fecha_programada ?? "") || b.idpedido - a.idpedido
    return (a.fecha_programada ?? "9999").localeCompare(b.fecha_programada ?? "9999") || a.idpedido - b.idpedido
  })
}

function coincide(p: PedidoCola, q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return [String(p.idpedido), p.pedido, p.orden_de_compra, p.cliente, p.vendedor, p.destino, p.ocargue, p.vehiculo].some((v) => (v ?? "").toLowerCase().includes(s))
}

export function ColaTab({
  data,
  filtro,
  onFiltro,
  onVerDetalle,
  onAccion,
  onEditar,
  onGenerarOC,
  onVerOC,
  onIrDepurar,
  permisos,
}: {
  data: ColaPedidos
  filtro: FiltroCola
  onFiltro: (f: FiltroCola) => void
  onVerDetalle: (p: PedidoCola) => void
  onAccion: (tipo: TipoAccion, p: PedidoCola) => void
  onEditar: (p: PedidoCola) => void
  onGenerarOC: (p: PedidoCola) => void
  onVerOC: (p: PedidoCola) => void
  onIrDepurar: () => void
  /** Módulos de Recepción y Despacho que tiene el usuario (Gestión de Usuarios). */
  permisos: { generarOC: boolean; verOC: boolean }
}) {
  const [busqueda, setBusqueda] = useState("")
  const [mostrarViejos, setMostrarViejos] = useState(false)

  const filtrados = useMemo(() => ordenarCola(filtrarCola(data.pedidos, filtro).filter((p) => coincide(p, busqueda))), [data.pedidos, filtro, busqueda])
  // En "Todos", los atrasados de más de 15 días (sin rastro logístico) se agrupan
  // para no tapar la operación de hoy; viven en Depurar pendientes.
  const agrupar = filtro === "todos" && !busqueda && !mostrarViejos
  const viejos = agrupar ? filtrados.filter((p) => p.calc.estado === "programado" && p.calc.atrasoDias > 15) : []
  const visibles = agrupar ? filtrados.filter((p) => !(p.calc.estado === "programado" && p.calc.atrasoDias > 15)) : filtrados
  const indiceGrupo = agrupar && viejos.length > 0 ? visibles.findIndex((p) => !(p.calc.estado === "programado" && p.calc.atrasoDias > 0)) : -1
  const conteos = useMemo(() => Object.fromEntries(FILTROS_COLA.map((f) => [f.valor, filtrarCola(data.pedidos, f.valor).length])) as Record<string, number>, [data.pedidos])

  const pasoDe = (p: PedidoCola) => {
    const s = p.calc.siguientePaso
    if (!s) return null
    // La orden de cargue la genera Recepción y Despacho: sin ese módulo, el pedido solo espera.
    if (s.clave === "generar_oc" && !permisos.generarOC) {
      return <Chip tono={p.calc.atrasoDias > 0 ? "critico" : "info"} title="La orden de cargue la genera Recepción y Despacho">Espera orden de cargue</Chip>
    }
    if (s.clave === "ver_oc" && !permisos.verOC) {
      return <Chip tono="info" title={p.ocargue ? `Orden de cargue ${p.ocargue}` : "En cargue"}>En Recepción y Despacho</Chip>
    }
    const primario = p.calc.estado === "programado" && p.calc.atrasoDias >= 0 && !p.calc.esManana
    const ejecutar = () => {
      switch (s.clave) {
        case "aprobar_cartera":
          return onAccion("cartera", p)
        case "aprobar":
          return onAccion("aprobar", p)
        case "generar_oc":
          return onGenerarOC(p)
        case "ver_oc":
          return onVerOC(p)
        case "cerrar_pendiente":
          return onAccion("cerrar_pendiente", p)
        default:
          return onVerDetalle(p)
      }
    }
    const icono = s.clave === "generar_oc" || s.clave === "ver_oc" ? <Truck className="h-3.5 w-3.5" /> : s.clave === "aprobar" || s.clave === "aprobar_cartera" ? <Lock className="h-3.5 w-3.5" /> : null
    return (
      <Button size="sm" variant={primario ? "default" : "outline"} className="h-8 gap-1.5 whitespace-nowrap text-xs" onClick={ejecutar}>
        {icono}
        {s.texto}
      </Button>
    )
  }

  // Funciones de render (no componentes anidados) para que React no remonte las filas en cada cambio.
  const menu = (p: PedidoCola) => {
    const c = p.calc
    const aprobado = normalizarEstado(p.aprobado) === "si"
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Más acciones del pedido ${p.idpedido}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => onVerDetalle(p)}>Ver detalle</DropdownMenuItem>
          {p.pdfpedido && <DropdownMenuItem onClick={() => window.open(p.pdfpedido!, "_blank")}>Ver PDF</DropdownMenuItem>}
          {c.estado === "nuevo" && !c.conCartera && <DropdownMenuItem onClick={() => onEditar(p)}>Editar</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {c.estado === "nuevo" && !c.conCartera && <DropdownMenuItem onClick={() => onAccion("cartera", p)}>Aprobar cartera…</DropdownMenuItem>}
          {c.estado === "nuevo" && c.conCartera && <DropdownMenuItem onClick={() => onAccion("aprobar", p)}>Aprobar…</DropdownMenuItem>}
          {c.estado === "programado" && permisos.generarOC && <DropdownMenuItem onClick={() => onGenerarOC(p)}>Generar orden de cargue</DropdownMenuItem>}
          {(c.estado === "en_cargue" || c.estado === "parcial") && (p.ocargue || p.lineasConOcargue > 0) && permisos.verOC && <DropdownMenuItem onClick={() => onVerOC(p)}>Ver orden de cargue</DropdownMenuItem>}
          {c.estado === "parcial" && <DropdownMenuItem onClick={() => onAccion("cerrar_pendiente", p)}>Cerrar pendiente…</DropdownMenuItem>}
          {aprobado && <DropdownMenuItem onClick={() => onAccion("cierre_factura", p)}>Cierre con factura…</DropdownMenuItem>}
          {aprobado && c.sinRastro && c.estado !== "parcial" && <DropdownMenuItem onClick={() => onAccion("anular", p)}>Anular…</DropdownMenuItem>}
          {c.candidatoDepuracion && (
            <DropdownMenuItem onClick={onIrDepurar}>
              <Eraser className="mr-2 h-3.5 w-3.5" /> Depurar (candidato)
            </DropdownMenuItem>
          )}
          {c.estado === "nuevo" && !c.conCartera && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-critico-fg" onClick={() => onAccion("eliminar", p)}>Eliminar</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const filaGrupo = () => (
    <div className="flex flex-wrap items-center gap-3 bg-muted/40 px-4 py-3 text-sm">
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">
        {NUM.format(viejos.length)} atrasados de más de 15 días sin orden de cargue, vehículo ni lote
      </span>
      <span className="text-muted-foreground">· se agrupan para no tapar la operación de hoy</span>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setMostrarViejos(true)}>Mostrar</Button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onIrDepurar}>
          <Eraser className="h-3.5 w-3.5" /> Depurar pendientes
        </Button>
      </div>
    </div>
  )

  const fila = (p: PedidoCola) => (
    <tr className="border-t border-border/60 hover:bg-muted/30">
      <td className="px-4 py-2.5 align-middle">
        <button type="button" className="lg-num font-semibold hover:underline" onClick={() => onVerDetalle(p)}>#{p.idpedido}</button>
        <span className="lg-num block text-xs text-muted-foreground">{p.pedido ? `N° ${p.pedido}` : p.orden_de_compra ? `OC ${p.orden_de_compra}` : "sin N°"}</span>
      </td>
      <td className="max-w-[320px] px-4 py-2.5 align-middle">
        <span className="block truncate font-medium" title={p.cliente}>{p.cliente}</span>
        <span className="block truncate text-xs text-muted-foreground">{[p.vendedor, p.condicion_pago].filter(Boolean).join(" · ")}</span>
      </td>
      <td className="px-4 py-2.5 align-middle"><Chip tono="neutro">{p.tipo_despacho || "sin tipo"}</Chip></td>
      <td className="px-4 py-2.5 align-middle">
        <span className="lg-num">{fechaCorta(p.fecha_programada)}</span>
        <span className={`block text-xs ${p.calc.atrasoDias > 0 && p.calc.estado === "programado" ? "text-critico-fg" : p.calc.esHoy ? "text-info-fg" : "text-muted-foreground"}`}>{relativoPromesa(p.calc, !!p.fecha_programada)}</span>
      </td>
      <td className="px-4 py-2.5 text-right align-middle">
        <span className="lg-num font-semibold">{NUM.format(p.kg)}</span>
        <span className="lg-num block text-xs text-muted-foreground">
          {p.calc.estado === "parcial" ? `${NUM.format(p.unidadesCargadas)} de ${NUM.format(p.unidades)} und` : `${NUM.format(p.unidades)} und`} · {p.lineas} {p.lineas === 1 ? "línea" : "líneas"}
        </span>
      </td>
      <td className="px-4 py-2.5 align-middle"><EstadoChip calc={p.calc} title={p.ocargue ? `Orden de cargue ${p.ocargue}` : undefined} /></td>
      <td className="px-4 py-2.5 align-middle">{pasoDe(p)}</td>
      <td className="px-2 py-2.5 align-middle">{menu(p)}</td>
    </tr>
  )

  const tarjeta = (p: PedidoCola) => (
    <article className="lg-card flex flex-col gap-2.5 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <EstadoChip calc={p.calc} />
        <button type="button" className="lg-num text-xs text-muted-foreground hover:underline" onClick={() => onVerDetalle(p)}>
          #{p.idpedido}{p.pedido ? ` · N° ${p.pedido}` : ""}
        </button>
      </div>
      <p className="text-[15px] font-semibold leading-snug">{p.cliente}</p>
      <p className="lg-num text-xs leading-relaxed text-muted-foreground">
        {p.tipo_despacho || "sin tipo"} · promesa {fechaCorta(p.fecha_programada)} · {NUM.format(p.kg)} kg · {NUM.format(p.unidades)} und · {p.lineas} {p.lineas === 1 ? "línea" : "líneas"}
        {p.vendedor ? ` · ${p.vendedor}` : ""}
      </p>
      <div className="flex gap-2">
        <div className="flex-1 [&>button]:h-11 [&>button]:w-full [&>button]:text-sm">{pasoDe(p) ?? <Button variant="outline" className="h-11 w-full" onClick={() => onVerDetalle(p)}>Ver detalle</Button>}</div>
        {menu(p)}
      </div>
    </article>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Pedido, N°, OC, cliente o placa" className="h-9 w-[280px] pl-8" />
          </div>
          {FILTROS_COLA.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => onFiltro(f.valor)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${filtro === f.valor ? "border-marca bg-marca text-white" : "border-input bg-background hover:bg-accent"}`}
            >
              {f.tono && filtro !== f.valor && <Punto tono={f.tono} className="shadow-none" />}
              {f.etiqueta} <span className="lg-num">{NUM.format(conteos[f.valor] ?? 0)}</span>
            </button>
          ))}
          {filtro.startsWith("fecha:") && (
            <button type="button" onClick={() => onFiltro("todos")} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-marca bg-marca px-3 text-xs font-medium text-white">
              Promesa {fechaCorta(filtro.slice(6))} <span className="lg-num">{NUM.format(filtrados.length)}</span> · quitar
            </button>
          )}
        </div>
        <span className="hidden text-xs text-muted-foreground lg:inline">Orden: atrasados → hoy → mañana → programados → en cargue → parciales → por aprobar</span>
      </div>

      {filtrados.length === 0 ? (
        <div className="lg-card">
          <EstadoVacio titulo={busqueda ? "Ningún pedido coincide con la búsqueda" : "No hay pedidos en esta vista"} texto={busqueda ? "Prueba con el número del pedido, la OC del cliente o parte del nombre." : "Cuando llegue un pedido aprobado aparecerá aquí con su siguiente paso."} />
        </div>
      ) : (
        <>
          <div className="lg-card hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Pedido</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Cliente</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Despacho</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Promesa</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Kilos</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Estado</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Siguiente paso</th>
                  <th className="w-10 px-2 py-2.5"><span className="sr-only">Más</span></th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p, i) => (
                  <FragmentoFila key={p.idpedido} grupoAntes={i === indiceGrupo} grupo={filaGrupo()}>
                    {fila(p)}
                  </FragmentoFila>
                ))}
                {agrupar && viejos.length > 0 && indiceGrupo === -1 && (
                  <tr><td colSpan={8} className="p-0">{filaGrupo()}</td></tr>
                )}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              <span className="lg-num">{NUM.format(filtrados.length)} pedidos{agrupar && viejos.length > 0 ? ` · ${NUM.format(viejos.length)} agrupados` : ""}</span>
              <span>El estado se deriva de aprobación, promesa, orden de cargue y líneas. Los campos crudos están en el detalle.</span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 md:hidden">
            {visibles.map((p, i) => (
              <div key={p.idpedido} className="contents">
                {i === indiceGrupo && <div className="lg-card overflow-hidden">{filaGrupo()}</div>}
                {tarjeta(p)}
              </div>
            ))}
            {agrupar && viejos.length > 0 && indiceGrupo === -1 && <div className="lg-card overflow-hidden">{filaGrupo()}</div>}
          </div>
        </>
      )}
    </div>
  )
}

/** Inserta la fila de grupo justo antes de la primera fila que ya no es atrasada. */
function FragmentoFila({ grupoAntes, grupo, children }: { grupoAntes: boolean; grupo: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      {grupoAntes && (
        <tr>
          <td colSpan={8} className="p-0">{grupo}</td>
        </tr>
      )}
      {children}
    </>
  )
}
