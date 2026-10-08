"use client"

// Diálogo para armar el personal de apoyo de UNA orden de cargue/descargue.
//
// Vive aparte porque lo usan DOS pantallas: el módulo "Asignación de apoyo en
// cargue" (que primero hace elegir la orden de una lista del día) y Centro de
// Coordinación (que ya sabe cuál es la orden — la del muelle que se está
// mirando). Si cada una tuviera su copia, el reparto de toneladas se mostraría
// distinto según por dónde se entre, y ese número es plata.
//
// Dos listas, las dos sacadas del REPORTE DE ASISTENCIA del día (gerencia,
// 2026-10-06):
//   1. Auxiliares de cargue y descargue de ese día, con el estado de cada uno.
//   2. Personal de otros puestos que YA terminó su turno y queda habilitado
//      para apoyar.
// En las dos se puede marcar (entra al reparto) y desmarcar (sale del reparto).
//
// El cálculo NO vive aquí: `previsualizarApoyo` lo hace en el servidor con la
// misma fórmula de `pagonomina`. Este componente solo lo muestra.

import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"
import {
  agregarApoyoAOrden,
  getCandidatosApoyoDia,
  previsualizarApoyo,
  quitarApoyoDeOrden,
  type CandidatoApoyo,
  type CandidatosApoyoDia,
  type PreviewApoyo,
} from "@/lib/apoyo-cargue-actions"

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO")

const ESTADO: Record<CandidatoApoyo["estado"], { etiqueta: string; clase: string }> = {
  en_piso: { etiqueta: "En piso", clase: "bg-ok-bg text-ok-fg border-ok-bd" },
  ya_salio: { etiqueta: "Ya salió", clase: "bg-muted text-muted-foreground border-border" },
  no_llego: { etiqueta: "No llegó", clase: "bg-atencion-bg text-atencion-fg border-atencion-bd" },
  novedad: { etiqueta: "Novedad", clase: "bg-critico-bg text-critico-fg border-critico-bd" },
}

export interface OrdenParaApoyo {
  /** `cabeceraoc.id`. En Centro de Coordinación es `OrdenOperativa.orderId`. */
  id: number
  ordendecargue: string
  /** Quiénes ya están en el reparto. */
  auxiliares: string[]
}

/** Una fila con su casilla, su estado y por qué no se puede marcar. */
function FilaCandidato({
  c,
  marcado,
  onAlternar,
}: {
  c: CandidatoApoyo
  marcado: boolean
  onAlternar: () => void
}) {
  const e = ESTADO[c.estado]
  // Desde el 2026-10-06 (decisión de gerencia) se puede sacar del reparto a
  // cualquiera, venga de este módulo o de Picking/Packing; cada exclusión queda
  // registrada con quién y cuándo. Lo único que bloquea es AGREGAR a quien no
  // cumple las reglas del día.
  const bloqueado = c.enLaOrden ? false : !c.sePuedeAgregar
  const razon = c.enLaOrden
    ? c.sePuedeQuitar
      ? undefined
      : "Viene de Picking/Packing — al desmarcarlo sale del reparto y queda el registro"
    : (c.motivo ?? undefined)

  return (
    <label
      title={razon}
      className={`flex items-center gap-2 p-2 text-sm ${bloqueado ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/50"}`}
    >
      <input type="checkbox" checked={marcado} disabled={bloqueado} onChange={onAlternar} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{c.nombre}</span>
        {razon && <span className="block text-xs text-muted-foreground">{razon}</span>}
      </span>
      {c.puesto && <span className="hidden text-xs text-muted-foreground sm:inline">{c.puesto}</span>}
      {(c.entradaProgramada || c.salidaProgramada) && (
        <span className="lg-num hidden text-xs text-muted-foreground md:inline">
          {c.entradaProgramada ?? "—"}-{c.salidaProgramada ?? "—"}
        </span>
      )}
      {c.especialidad && (
        <Badge variant="secondary" className="text-xs">
          Turno fijo
        </Badge>
      )}
      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${e.clase}`}>{e.etiqueta}</span>
    </label>
  )
}

export function ApoyoCargueDialog({
  orden,
  fecha,
  empresaId,
  onCerrar,
  onAgregado,
}: {
  /** null = cerrado. */
  orden: OrdenParaApoyo | null
  /** Día del que se lista la asistencia (YYYY-MM-DD). */
  fecha: string
  empresaId?: number | null
  onCerrar: () => void
  onAgregado: () => void
}) {
  const { toast } = useToast()
  const [dia, setDia] = useState<CandidatosApoyoDia | null>(null)
  /** Nombres marcados: arranca con los que ya están en la orden. */
  const [marcados, setMarcados] = useState<string[]>([])
  const [inicial, setInicial] = useState<string[]>([])
  const [preview, setPreview] = useState<PreviewApoyo | null>(null)
  const [filtro, setFiltro] = useState("")
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    if (!orden) return
    setCargando(true)
    const res = await getCandidatosApoyoDia(fecha, orden.id, empresaId)
    setCargando(false)
    if (!res.success || !res.data) {
      toast({ title: "Error", description: res.message || "No se pudo cargar la asistencia del día", variant: "destructive" })
      return
    }
    setDia(res.data)
    const yaEstan = [...res.data.cuadrilla, ...res.data.habilitados].filter((c) => c.enLaOrden).map((c) => c.nombre)
    setMarcados(yaEstan)
    setInicial(yaEstan)
    setPreview(null)
  }, [orden, fecha, empresaId, toast])

  useEffect(() => {
    if (!orden) return
    setFiltro("")
    cargar()
  }, [orden, cargar])

  const agregados = marcados.filter((n) => !inicial.includes(n))
  const quitados = inicial.filter((n) => !marcados.includes(n))

  const alternar = async (nombre: string) => {
    const nueva = marcados.includes(nombre) ? marcados.filter((n) => n !== nombre) : [...marcados, nombre]
    setMarcados(nueva)
    if (!orden) return
    // La previsualización solo tiene sentido con gente NUEVA: es el reparto que
    // quedaría al sumarlos. Se calcula en el servidor con la misma fórmula del
    // guardado, así que lo que se ve es lo que va a quedar.
    const nuevos = nueva.filter((n) => !inicial.includes(n))
    if (nuevos.length === 0) {
      setPreview(null)
      return
    }
    const res = await previsualizarApoyo(orden.id, nuevos)
    if (res.success && res.data) setPreview(res.data)
  }

  const confirmar = async () => {
    if (!orden || (agregados.length === 0 && quitados.length === 0)) return
    setGuardando(true)
    const errores: string[] = []

    for (const persona of quitados) {
      const r = await quitarApoyoDeOrden(orden.id, persona)
      if (!r.success) errores.push(`${persona}: ${r.message || "no se pudo quitar"}`)
    }
    if (agregados.length > 0) {
      const r = await agregarApoyoAOrden(orden.id, agregados)
      if (!r.success) errores.push(r.message || "No se pudo agregar el apoyo")
    }

    setGuardando(false)
    if (errores.length > 0) {
      toast({ title: "Quedó algo sin aplicar", description: errores.join(" · "), variant: "destructive" })
      await cargar()
      onAgregado()
      return
    }
    const partes: string[] = []
    if (agregados.length) partes.push(`${agregados.length} agregado(s)`)
    if (quitados.length) partes.push(`${quitados.length} quitado(s)`)
    toast({ title: "Apoyo actualizado", description: partes.join(" y ") })
    onAgregado()
    onCerrar()
  }

  const coincide = (c: CandidatoApoyo) => c.nombre.toLowerCase().includes(filtro.toLowerCase())
  const cuadrilla = (dia?.cuadrilla ?? []).filter(coincide)
  const habilitados = (dia?.habilitados ?? []).filter(coincide)
  const sinCambios = agregados.length === 0 && quitados.length === 0

  return (
    <Dialog open={!!orden} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Personal de apoyo — {orden?.ordendecargue}</DialogTitle>
          <DialogDescription>
            Marca quién entra al reparto de toneladas de esta orden y desmarca a quien deba salir. Las dos listas
            salen del reporte de asistencia del {fecha}.
          </DialogDescription>
        </DialogHeader>

        <Input placeholder="Buscar persona..." value={filtro} onChange={(e) => setFiltro(e.target.value)} />

        {cargando ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando la asistencia del día...
          </div>
        ) : (
          <div className="space-y-3">
            <section>
              <p className="mb-1 text-sm font-medium">
                Auxiliares de cargue y descargue del día{" "}
                <span className="font-normal text-muted-foreground">
                  ({dia?.cuadrilla.length ?? 0} con asistencia reportada)
                </span>
              </p>
              <div className="max-h-44 divide-y overflow-y-auto rounded-md border">
                {cuadrilla.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    {(dia?.cuadrilla.length ?? 0) === 0
                      ? "Nadie quedó reportado en cargue o descargue ese día."
                      : "Nadie coincide con el filtro."}
                  </p>
                ) : (
                  cuadrilla.map((c) => (
                    <FilaCandidato
                      key={c.id}
                      c={c}
                      marcado={marcados.includes(c.nombre)}
                      onAlternar={() => alternar(c.nombre)}
                    />
                  ))
                )}
              </div>
            </section>

            <section>
              <p className="mb-1 text-sm font-medium">
                Habilitados al terminar su turno{" "}
                <span className="font-normal text-muted-foreground">
                  ({dia?.habilitados.length ?? 0} libres
                  {dia && dia.enTurnoPropio > 0 ? ` · ${dia.enTurnoPropio} siguen en su puesto` : ""})
                </span>
              </p>
              <div className="max-h-44 divide-y overflow-y-auto rounded-md border">
                {habilitados.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    {(dia?.habilitados.length ?? 0) === 0
                      ? "Todavía nadie de otro puesto ha terminado su turno."
                      : "Nadie coincide con el filtro."}
                  </p>
                ) : (
                  habilitados.map((c) => (
                    <FilaCandidato
                      key={c.id}
                      c={c}
                      marcado={marcados.includes(c.nombre)}
                      onAlternar={() => alternar(c.nombre)}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {preview && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Así queda el pago por persona de esta orden:</p>
            <div className="max-h-40 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Persona</TableHead>
                    <TableHead className="text-right">Antes</TableHead>
                    <TableHead className="text-right">Después</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.personas.map((p) => (
                    <TableRow key={p.persona}>
                      <TableCell>{p.persona}</TableCell>
                      <TableCell className="text-right">{p.antes == null ? "—" : money(p.antes)}</TableCell>
                      <TableCell className="text-right font-medium">{money(p.despues)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              El reparto se divide entre más personas, así que a quien ya estaba le baja su parte.
            </p>
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {sinCambios
              ? "Sin cambios por aplicar"
              : [agregados.length ? `${agregados.length} por agregar` : null, quitados.length ? `${quitados.length} por quitar` : null]
                  .filter(Boolean)
                  .join(" · ")}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={sinCambios || guardando}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Aplicar cambios
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ApoyoCargueDialog
