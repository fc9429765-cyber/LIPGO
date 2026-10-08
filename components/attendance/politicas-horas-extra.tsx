"use client"

// Pestaña "Políticas de horas extra" de Tabla Asistencia.
//
// Configura, por puesto y por día, a partir de cuántas horas empieza a contar la
// hora extra. Lo que se guarde aquí lo lee el trigger de `registroasistencia`,
// así que cambia lo que se paga y lo que se factura.
//
// El simulador usa la copia en TypeScript de la fórmula (lib/politicas-horas-extra)
// para responder al instante mientras se escribe; el cálculo de verdad lo hace
// Postgres. Ver la advertencia en la cabecera de ese archivo.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import {
  Loader2,
  Plus,
  Save,
  Trash2,
  AlertTriangle,
  Info,
  FlaskConical,
  RotateCcw,
  Download,
  Copy,
  Check,
} from "lucide-react"
import {
  DIAS_SEMANA,
  POLITICA_DEFAULTS,
  PUESTO_TODOS,
  calcularHorasExtra,
  describirPolitica,
  explicarUmbral,
  isoDowDeFecha,
  resolverPolitica,
  type PoliticaHorasExtra,
  type RedondeoModo,
} from "@/lib/politicas-horas-extra"
import {
  eliminarPoliticaHorasExtra,
  ejecutarRecalculoExtras,
  getEjemploAsistencia,
  getPoliticasHorasExtra,
  guardarPoliticaEnPuestos,
  guardarPoliticaHorasExtra,
  previsualizarRecalculoExtras,
  type PreviewRecalculo,
} from "@/lib/politicas-horas-extra-actions"
import { getPuestosFromTarifas } from "@/lib/programacion-turnos-actions"
import { useClaveAccion } from "@/components/clave-accion-provider"

const hoyISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" })

const nuevaPolitica = (puesto: string, fechaDesde: string, diaSemana: number | null): PoliticaHorasExtra => ({
  ...POLITICA_DEFAULTS,
  puesto,
  fechaDesde,
  diaSemana,
})

export function PoliticasHorasExtra() {
  const { selectedEmpresaId } = useAuth()
  const { conClave } = useClaveAccion()
  const { toast } = useToast()

  const [politicas, setPoliticas] = useState<PoliticaHorasExtra[]>([])
  const [puestos, setPuestos] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [puestoSel, setPuestoSel] = useState<string>(PUESTO_TODOS)
  const [fechaSel, setFechaSel] = useState<string>("")
  const [editando, setEditando] = useState<PoliticaHorasExtra | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [porEliminar, setPorEliminar] = useState<PoliticaHorasExtra | null>(null)
  // Aplicar la política que se está viendo a varios puestos de una vez.
  const [aplicarVarios, setAplicarVarios] = useState<PoliticaHorasExtra | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const [resPol, resPuestos] = await Promise.all([
      getPoliticasHorasExtra(),
      getPuestosFromTarifas().catch(() => [] as Array<{ puesto: string }>),
    ])
    if (resPol.success && resPol.data) setPoliticas(resPol.data)
    else setError(resPol.message ?? "No se pudieron leer las políticas.")
    setPuestos((resPuestos ?? []).map((p) => p.puesto))
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Vigencias del puesto elegido, de la más reciente a la más antigua.
  const vigencias = useMemo(() => {
    const fechas = new Set(politicas.filter((p) => p.puesto === puestoSel).map((p) => p.fechaDesde))
    return [...fechas].sort((a, b) => b.localeCompare(a))
  }, [politicas, puestoSel])

  useEffect(() => {
    if (vigencias.length > 0 && !vigencias.includes(fechaSel)) setFechaSel(vigencias[0])
    if (vigencias.length === 0) setFechaSel("")
  }, [vigencias, fechaSel])

  const base = useMemo(
    () => politicas.find((p) => p.puesto === puestoSel && p.fechaDesde === fechaSel && p.diaSemana == null) ?? null,
    [politicas, puestoSel, fechaSel],
  )

  const excepcionDe = useCallback(
    (dia: number) =>
      politicas.find((p) => p.puesto === puestoSel && p.fechaDesde === fechaSel && p.diaSemana === dia) ?? null,
    [politicas, puestoSel, fechaSel],
  )

  const abrirNuevaVigencia = () => {
    setEditando(nuevaPolitica(puestoSel, hoyISO(), null))
  }

  // Al crear una excepción se copian los valores de la base: la fila que gana
  // aporta TODOS sus valores, no se mezclan campos entre filas, así que partir
  // de la base es lo que evita sorpresas.
  const abrirExcepcion = (dia: number) => {
    const existente = excepcionDe(dia)
    if (existente) {
      setEditando({ ...existente })
      return
    }
    // Se parte de los valores de la base, pero SIN su id ni su nota: es una
    // fila nueva, no una edición de la base. La fecha se hereda tal cual porque
    // la excepción pertenece a esta misma vigencia.
    const desde = base ?? nuevaPolitica(puestoSel, fechaSel || hoyISO(), null)
    const { id: _sinId, ...valores } = desde
    setEditando({ ...valores, diaSemana: dia, nota: null })
  }

  const guardar = async () => {
    if (!editando) return
    setGuardando(true)
    const res = await conClave("Tabla Asistencia", "configurar", (clave) => guardarPoliticaHorasExtra(editando, clave))
    setGuardando(false)
    if (!res.success) {
      toast({ title: "No se pudo guardar", description: res.message, variant: "destructive" })
      return
    }
    toast({
      title: "Política guardada",
      description: "Aplica a las asistencias que se registren o modifiquen de ahora en adelante.",
    })
    setPuestoSel(editando.puesto)
    // Solo la política base puede estrenar vigencia; una excepción vive dentro
    // de la que ya está seleccionada.
    if (editando.diaSemana == null) setFechaSel(editando.fechaDesde)
    setEditando(null)
    cargar()
  }

  const confirmarEliminar = async () => {
    if (!porEliminar?.id) return
    const res = await conClave("Tabla Asistencia", "configurar", (clave) => eliminarPoliticaHorasExtra(porEliminar.id!, clave))
    if (!res.success) {
      toast({ title: "No se pudo eliminar", description: res.message, variant: "destructive" })
      return
    }
    toast({ title: "Política eliminada", description: "Ese día vuelve a usar la política base." })
    setPorEliminar(null)
    cargar()
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Políticas de horas extra</h2>
        <p className="text-muted-foreground">
          A partir de cuántas horas empieza a contar la hora extra, por puesto y por día.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Lo que más se malinterpreta: guardar no arregla el pasado. */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Guardar una política aplica <strong>solo a las asistencias que se registren o se modifiquen
          de ahora en adelante</strong>. Lo ya calculado no cambia. Para corregir días pasados usa
          «Recalcular un período», más abajo: primero verás qué cambiaría.
        </AlertDescription>
      </Alert>

      {/* ---------- Selector ---------- */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1.5">
            <Label className="text-xs">Puesto</Label>
            <Select value={puestoSel} onValueChange={setPuestoSel}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PUESTO_TODOS}>Todos los puestos (por defecto)</SelectItem>
                {puestos.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Vigente desde</Label>
            {vigencias.length > 0 ? (
              <Select value={fechaSel} onValueChange={setFechaSel}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {vigencias.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f === "1900-01-01" ? "Siempre (desde el inicio)" : f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">Este puesto no tiene política propia.</p>
            )}
          </div>

          <Button variant="outline" onClick={abrirNuevaVigencia} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nueva vigencia
          </Button>
        </CardContent>
      </Card>

      {/* ---------- Política base ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Política base</CardTitle>
          <CardDescription>
            {base
              ? explicarUmbral(base)
              : puestoSel === PUESTO_TODOS
                ? "Todavía no hay una política general configurada; se usan los valores por defecto."
                : "Este puesto usa la política general. Crea una vigencia para darle reglas propias."}
          </CardDescription>
        </CardHeader>
        {base && (
          <CardContent className="flex flex-wrap items-center gap-2">
            <Resumen l="Umbral" v={`${base.umbralHoras} h`} />
            <Resumen l="Descanso" v={`${base.horasDescanso} h`} />
            {base.descansoDesdeHoras != null && (
              <Resumen l="Descanso solo si pasa de" v={`${base.descansoDesdeHoras} h`} />
            )}
            <Resumen l="Tolerancia" v={`${base.toleranciaSalidaMin} min`} />
            {base.minimoExtraHoras > 0 && <Resumen l="Mínimo" v={`${base.minimoExtraHoras} h`} />}
            {base.topeExtraTurnoHoras != null && (
              <Resumen l="Tope por turno" v={`${base.topeExtraTurnoHoras} h`} />
            )}
            <Resumen
              l="Redondeo"
              v={base.redondeoModo === "bloque" ? `bloques de ${base.redondeoBloqueMin} min` : base.redondeoModo}
            />
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setAplicarVarios({ ...base })} className="gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                Aplicar a varios puestos
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditando({ ...base })}>
                Editar
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ---------- Excepciones por día ---------- */}
      {base && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Excepciones por día</CardTitle>
            <CardDescription>
              Los días sin excepción usan la política base. Es aquí donde se configura, por ejemplo,
              que el sábado la hora extra arranque antes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Día</TableHead>
                  <TableHead className="text-center">Umbral</TableHead>
                  <TableHead className="text-center">Descanso</TableHead>
                  <TableHead className="text-center">Tolerancia</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DIAS_SEMANA.map((d) => {
                  const exc = excepcionDe(d.valor)
                  const efectiva = exc ?? base
                  return (
                    <TableRow key={d.valor} className={exc ? "" : "text-muted-foreground"}>
                      <TableCell className="font-medium">
                        {d.nombre}
                        {!exc && <span className="ml-2 text-xs">· usa la base</span>}
                      </TableCell>
                      <TableCell className="text-center">{efectiva.umbralHoras} h</TableCell>
                      <TableCell className="text-center">
                        {efectiva.horasDescanso} h
                        {efectiva.descansoDesdeHoras != null && (
                          <span className="ml-1 text-xs">(si pasa de {efectiva.descansoDesdeHoras} h)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{efectiva.toleranciaSalidaMin} min</TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => abrirExcepcion(d.valor)}>
                          {exc ? "Editar" : "Crear excepción"}
                        </Button>
                        {exc && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAplicarVarios({ ...exc })}
                            title="Aplicar esta misma excepción a otros puestos"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {exc && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setPorEliminar(exc)}
                            title="Quitar la excepción: el día vuelve a usar la base"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AplicarAVariosPuestos
        plantilla={aplicarVarios}
        puestos={puestos}
        onCerrar={() => setAplicarVarios(null)}
        onGuardado={cargar}
      />

      <Simulador politicas={politicas} puestos={puestos} empresaId={selectedEmpresaId ?? null} />

      <Recalculo empresaId={selectedEmpresaId ?? null} puestos={puestos} />

      {/* ---------- Formulario ---------- */}
      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editando?.diaSemana == null
                ? "Política base"
                : `Excepción · ${DIAS_SEMANA.find((d) => d.valor === editando?.diaSemana)?.nombre}`}
            </DialogTitle>
            <DialogDescription>
              {editando?.puesto === PUESTO_TODOS ? "Todos los puestos" : editando?.puesto}
              {editando?.diaSemana != null && ` · vigencia desde ${editando.fechaDesde}`}
            </DialogDescription>
          </DialogHeader>

          {editando && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {editando.diaSemana == null ? (
                  <Campo
                    l="Vigente desde"
                    ayuda="Se compara con el día trabajado, no con la fecha de hoy."
                  >
                    <DatePickerField
                      value={editando.fechaDesde}
                      onChange={(value) => setEditando({ ...editando, fechaDesde: value })}
                    />
                  </Campo>
                ) : (
                  /* La excepción pertenece a esta vigencia y no se puede mover:
                     cambiarle la fecha la guardaría en otra versión de la
                     política, y el día seguiría usando la base sin que se note. */
                  <Campo
                    l="Vigente desde"
                    ayuda="Lo hereda de la política base. Para otra vigencia, créala primero y añade allí la excepción."
                  >
                    <DatePickerField value={editando.fechaDesde} onChange={() => {}} disabled />
                  </Campo>
                )}
                <Campo l="Umbral (horas)" ayuda="A partir de cuántas horas cuenta la extra.">
                  <Input
                    type="number"
                    step="0.25"
                    value={editando.umbralHoras}
                    onChange={(e) => setEditando({ ...editando, umbralHoras: Number(e.target.value) })}
                  />
                </Campo>
                <Campo l="Descanso (horas)" ayuda="Se descuenta del total trabajado.">
                  <Input
                    type="number"
                    step="0.25"
                    value={editando.horasDescanso}
                    onChange={(e) => setEditando({ ...editando, horasDescanso: Number(e.target.value) })}
                  />
                </Campo>
                <Campo
                  l="Descontar descanso solo si pasa de (horas)"
                  ayuda="Vacío = siempre se descuenta. En un turno corto no hay almuerzo."
                >
                  <Input
                    type="number"
                    step="0.25"
                    value={editando.descansoDesdeHoras ?? ""}
                    onChange={(e) =>
                      setEditando({
                        ...editando,
                        descansoDesdeHoras: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Campo>
                <Campo l="Tolerancia de salida (minutos)" ayuda="Quedarse menos de esto no genera extra.">
                  <Input
                    type="number"
                    value={editando.toleranciaSalidaMin}
                    onChange={(e) => setEditando({ ...editando, toleranciaSalidaMin: Number(e.target.value) })}
                  />
                </Campo>
                <Campo l="Mínimo para generar (horas)" ayuda="Por debajo de esto no se genera nada.">
                  <Input
                    type="number"
                    step="0.25"
                    value={editando.minimoExtraHoras}
                    onChange={(e) => setEditando({ ...editando, minimoExtraHoras: Number(e.target.value) })}
                  />
                </Campo>
                <Campo
                  l="Tope por turno (horas)"
                  ayuda="Vacío = sin tope. Es POR TURNO: un puesto con dos turnos el mismo día lo aplica dos veces."
                >
                  <Input
                    type="number"
                    step="0.5"
                    value={editando.topeExtraTurnoHoras ?? ""}
                    onChange={(e) =>
                      setEditando({
                        ...editando,
                        topeExtraTurnoHoras: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Campo>
                <Campo l="Redondeo">
                  <Select
                    value={editando.redondeoModo}
                    onValueChange={(v) => setEditando({ ...editando, redondeoModo: v as RedondeoModo })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="truncar">Truncar decimales (como hasta hoy)</SelectItem>
                      <SelectItem value="redondear">Redondear a 2 decimales</SelectItem>
                      <SelectItem value="bloque">Por bloques de minutos</SelectItem>
                    </SelectContent>
                  </Select>
                </Campo>
                {editando.redondeoModo === "bloque" && (
                  <Campo l="Tamaño del bloque (minutos)" ayuda="Se redondea hacia abajo.">
                    <Input
                      type="number"
                      value={editando.redondeoBloqueMin ?? 30}
                      onChange={(e) => setEditando({ ...editando, redondeoBloqueMin: Number(e.target.value) })}
                    />
                  </Campo>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="pol-activa"
                  checked={editando.activa}
                  onCheckedChange={(v) => setEditando({ ...editando, activa: v })}
                />
                <Label htmlFor="pol-activa">Activa</Label>
              </div>

              <Campo l="Nota" ayuda="Por qué existe esta regla. Dentro de un año es lo único que lo explica.">
                <Textarea
                  rows={2}
                  value={editando.nota ?? ""}
                  onChange={(e) => setEditando({ ...editando, nota: e.target.value })}
                  placeholder="Ej. Jornada reducida de sábado acordada con el cliente"
                />
              </Campo>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">{explicarUmbral(editando)}</AlertDescription>
              </Alert>

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setEditando(null)} disabled={guardando}>
                  Cancelar
                </Button>
                <Button onClick={guardar} disabled={guardando} className="gap-1.5">
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Guardar política
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!porEliminar} onOpenChange={(o) => !o && setPorEliminar(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quitar la excepción</DialogTitle>
            <DialogDescription>
              {DIAS_SEMANA.find((d) => d.valor === porEliminar?.diaSemana)?.nombre} vuelve a usar la
              política base de {porEliminar?.puesto === PUESTO_TODOS ? "todos los puestos" : porEliminar?.puesto}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setPorEliminar(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmarEliminar} className="gap-1.5">
              <Trash2 className="h-4 w-4" />
              Quitar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ------------------------------------------------- Aplicar a varios puestos */

/**
 * Copia una politica ya configurada a varios puestos de una vez.
 *
 * Con veinte y pico de puestos, repetir la misma regla uno a uno es tedioso y
 * es la forma segura de que terminen desalineados sin que nadie lo note.
 *
 * Se avisa cuales de los puestos elegidos YA tienen politica para esa misma
 * fecha y dia, porque a esos se les va a sobrescribir. Es la unica parte
 * destructiva de esta pantalla y tiene que verse ANTES de guardar, no despues.
 */
function AplicarAVariosPuestos({
  plantilla,
  puestos,
  onCerrar,
  onGuardado,
}: {
  plantilla: PoliticaHorasExtra | null
  puestos: string[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const { toast } = useToast()
  const { conClave } = useClaveAccion()
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [buscar, setBuscar] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [conPolitica, setConPolitica] = useState<Set<string>>(new Set())

  // Al abrir se parte de cero y se averigua a quienes se les sobrescribiria.
  useEffect(() => {
    if (!plantilla) return
    setSeleccion(new Set())
    setBuscar("")
    getPoliticasHorasExtra().then((res) => {
      if (!res.success || !res.data) return
      setConPolitica(
        new Set(
          res.data
            .filter(
              (p) =>
                p.fechaDesde === plantilla.fechaDesde &&
                p.diaSemana === plantilla.diaSemana &&
                p.puesto !== plantilla.puesto,
            )
            .map((p) => p.puesto),
        ),
      )
    })
  }, [plantilla])

  // El puesto de origen no se ofrece: ya tiene esta politica, es de donde sale.
  const disponibles = useMemo(
    () =>
      puestos
        .filter((p) => p !== plantilla?.puesto)
        .filter((p) => p.toLowerCase().includes(buscar.trim().toLowerCase())),
    [puestos, plantilla, buscar],
  )

  const alternar = (p: string) =>
    setSeleccion((prev) => {
      const s = new Set(prev)
      if (s.has(p)) s.delete(p)
      else s.add(p)
      return s
    })

  const todosMarcados = disponibles.length > 0 && disponibles.every((p) => seleccion.has(p))
  const alternarTodos = () =>
    setSeleccion((prev) => {
      const s = new Set(prev)
      for (const p of disponibles) {
        if (todosMarcados) s.delete(p)
        else s.add(p)
      }
      return s
    })

  const aSobrescribir = [...seleccion].filter((p) => conPolitica.has(p))

  const aplicar = async () => {
    if (!plantilla) return
    setGuardando(true)
    const res = await conClave("Tabla Asistencia", "configurar", (clave) => guardarPoliticaEnPuestos(plantilla, [...seleccion], clave))
    setGuardando(false)

    if (!res.success || !res.data) {
      toast({ title: "No se pudo aplicar", description: res.message, variant: "destructive" })
      return
    }

    const { guardados, fallidos } = res.data
    toast({
      title: `Politica aplicada a ${guardados.length} puesto(s)`,
      description:
        fallidos.length > 0
          ? `No se pudo en: ${fallidos.map((f) => f.puesto).join(", ")}`
          : "Aplica a las asistencias que se registren o modifiquen de ahora en adelante.",
      variant: fallidos.length > 0 ? "destructive" : undefined,
    })
    onCerrar()
    onGuardado()
  }

  const etiquetaDia =
    plantilla?.diaSemana == null
      ? "todos los dias"
      : (DIAS_SEMANA.find((d) => d.valor === plantilla?.diaSemana)?.nombre.toLowerCase() ?? "")

  return (
    <Dialog open={!!plantilla} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Aplicar a varios puestos
          </DialogTitle>
          <DialogDescription>
            Se copiara la politica de{" "}
            <strong>
              {plantilla?.puesto === PUESTO_TODOS ? "todos los puestos" : plantilla?.puesto}
            </strong>{" "}
            &middot; {etiquetaDia} &middot; desde {plantilla?.fechaDesde}
          </DialogDescription>
        </DialogHeader>

        {plantilla && (
          <div className="flex flex-col gap-3 overflow-hidden">
            <div className="flex flex-wrap gap-1.5 rounded-md border bg-muted/40 p-2">
              <Resumen l="Umbral" v={`${plantilla.umbralHoras} h`} />
              <Resumen l="Descanso" v={`${plantilla.horasDescanso} h`} />
              {plantilla.descansoDesdeHoras != null && (
                <Resumen l="Solo si pasa de" v={`${plantilla.descansoDesdeHoras} h`} />
              )}
              <Resumen l="Tolerancia" v={`${plantilla.toleranciaSalidaMin} min`} />
            </div>

            <Input
              placeholder="Buscar puesto..."
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground">{seleccion.size}</strong> seleccionado(s)
              </span>
              {disponibles.length > 0 && (
                <button type="button" className="text-primary hover:underline" onClick={alternarTodos}>
                  {todosMarcados ? "Quitar todos" : "Seleccionar todos"}
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              {disponibles.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No hay puestos que coincidan.
                </p>
              ) : (
                <ul className="divide-y">
                  {disponibles.map((p) => (
                    <li key={p}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                        <Checkbox checked={seleccion.has(p)} onCheckedChange={() => alternar(p)} />
                        <span className="min-w-0 flex-1 truncate text-sm">{p}</span>
                        {conPolitica.has(p) && (
                          <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                            ya tiene
                          </Badge>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {aSobrescribir.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  {aSobrescribir.length} de los puestos elegidos ya tienen una politica para esa
                  fecha y ese dia: <strong>se les va a reemplazar</strong> por esta.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={onCerrar} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={aplicar} disabled={seleccion.size === 0 || guardando} className="gap-1.5">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Aplicar a {seleccion.size} puesto(s)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- Simulador */

/**
 * Dado un puesto, un día y cuatro horas, muestra el paso a paso del cálculo.
 *
 * Muestra también QUÉ POLÍTICA GANÓ. Sin ese dato no hay forma de depurar por
 * qué salió un número cuando hay varias reglas en juego.
 */
function Simulador({
  politicas,
  puestos,
  empresaId,
}: {
  politicas: PoliticaHorasExtra[]
  puestos: string[]
  empresaId: number | null
}) {
  const { toast } = useToast()
  const [puesto, setPuesto] = useState<string>(PUESTO_TODOS)
  const [fecha, setFecha] = useState<string>(hoyISO())
  const [entradaProg, setEntradaProg] = useState("06:00")
  const [ingreso, setIngreso] = useState("06:00")
  const [salidaProg, setSalidaProg] = useState("14:00")
  const [salida, setSalida] = useState("16:00")
  const [cargandoEjemplo, setCargandoEjemplo] = useState(false)

  const politica = useMemo(() => resolverPolitica(politicas, puesto, fecha), [politicas, puesto, fecha])
  const detalle = useMemo(
    () =>
      calcularHorasExtra(
        {
          horaIngreso: ingreso,
          horaEntradaProgramada: entradaProg,
          horaSalida: salida,
          horaSalidaProgramada: salidaProg,
        },
        politica,
      ),
    [ingreso, entradaProg, salida, salidaProg, politica],
  )

  const dow = isoDowDeFecha(fecha)
  const esDomingo = dow === 7
  const campo = esDomingo ? "HEDF (festiva)" : "HED (ordinaria)"

  const cargarEjemplo = async () => {
    if (!empresaId) return
    setCargandoEjemplo(true)
    const res = await getEjemploAsistencia({
      empresaId,
      puesto: puesto === PUESTO_TODOS ? null : puesto,
    })
    setCargandoEjemplo(false)
    if (!res.success || !res.data) {
      toast({ title: "Sin datos", description: res.message, variant: "destructive" })
      return
    }
    setFecha(res.data.fecha)
    setIngreso(res.data.horaIngreso)
    setEntradaProg(res.data.horaEntradaProgramada)
    setSalida(res.data.horaSalida)
    setSalidaProg(res.data.horaSalidaProgramada)
    toast({ title: "Caso cargado", description: `${res.data.nombre} · ${res.data.fecha}` })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" />
          Simulador
        </CardTitle>
        <CardDescription>
          Prueba una jornada y mira cuántas horas extra saldrían, sin tocar ningún dato.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Campo l="Puesto">
            <Select value={puesto} onValueChange={setPuesto}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PUESTO_TODOS}>Todos</SelectItem>
                {puestos.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo l="Fecha">
            <DatePickerField value={fecha} onChange={setFecha} />
          </Campo>
          <Campo l="Entrada programada">
            <Input type="time" value={entradaProg} onChange={(e) => setEntradaProg(e.target.value)} />
          </Campo>
          <Campo l="Hora de ingreso">
            <Input type="time" value={ingreso} onChange={(e) => setIngreso(e.target.value)} />
          </Campo>
          <Campo l="Salida programada">
            <Input type="time" value={salidaProg} onChange={(e) => setSalidaProg(e.target.value)} />
          </Campo>
          <Campo l="Hora de salida">
            <Input type="time" value={salida} onChange={(e) => setSalida(e.target.value)} />
          </Campo>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={cargarEjemplo} disabled={!empresaId || cargandoEjemplo} className="gap-1.5">
            {cargandoEjemplo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Cargar un caso real
          </Button>
          <Badge variant="outline" className="font-normal">
            Política aplicada: {describirPolitica(politica)}
          </Badge>
        </div>

        {detalle ? (
          <div className="rounded-lg border">
            <div className="grid gap-x-6 gap-y-1 p-3 text-sm sm:grid-cols-2">
              <Paso l="Inicio efectivo" v={detalle.inicioEfectivo} />
              <Paso l="Fin efectivo" v={detalle.finEfectivo} />
              <Paso l="Horas trabajadas" v={`${detalle.horasTotales} h`} />
              <Paso
                l="Descanso descontado"
                v={detalle.descuentaDescanso ? `${detalle.descansoAplicado} h` : "no aplica (turno corto)"}
              />
              <Paso l="Umbral" v={`${detalle.umbral} h`} />
              <Paso l="Antes de ajustes" v={`${detalle.brutoAntesDeAjustes} h`} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/40 p-3">
              <span className="text-sm font-medium">
                Resultado: <strong className="text-lg">{detalle.horasExtra} h</strong> en {campo}
              </span>
              {detalle.ajuste && <span className="text-xs text-muted-foreground">{detalle.ajuste}</span>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Completa las cuatro horas para ver el cálculo.</p>
        )}

        <p className="text-xs text-muted-foreground">
          Un domingo o un festivo va a HEDF; el resto de días, a HED. El simulador no consulta la
          tabla de festivos, así que un festivo entre semana aquí se muestra como HED.
        </p>
      </CardContent>
    </Card>
  )
}

/* --------------------------------------------------------------- Recálculo */

function Recalculo({ empresaId, puestos }: { empresaId: number | null; puestos: string[] }) {
  const { toast } = useToast()
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [puesto, setPuesto] = useState<string>("")
  const [incluirAprobadas, setIncluirAprobadas] = useState(false)
  const [incluirManuales, setIncluirManuales] = useState(false)
  const [confirmacion, setConfirmacion] = useState("")
  const [motivo, setMotivo] = useState("")
  const [preview, setPreview] = useState<PreviewRecalculo | null>(null)
  const [cargando, setCargando] = useState(false)
  const [aplicando, setAplicando] = useState(false)

  const exigeConfirmar = incluirAprobadas || incluirManuales
  const puedeAplicar =
    !!preview &&
    preview.totalCambian > 0 &&
    motivo.trim().length > 0 &&
    (!exigeConfirmar || confirmacion.trim().toUpperCase() === "RECALCULAR")

  const previsualizar = async () => {
    if (!empresaId) return
    setCargando(true)
    setPreview(null)
    const res = await previsualizarRecalculoExtras({
      desde,
      hasta,
      empresaId,
      puesto: puesto || null,
      incluirAprobadas,
      incluirManuales,
    })
    setCargando(false)
    if (!res.success || !res.data) {
      toast({ title: "No se pudo previsualizar", description: res.message, variant: "destructive" })
      return
    }
    setPreview(res.data)
  }

  const aplicar = async () => {
    if (!preview || !empresaId) return
    setAplicando(true)
    const res = await ejecutarRecalculoExtras({
      filtro: { desde, hasta, empresaId, puesto: puesto || null, incluirAprobadas, incluirManuales },
      ids: preview.filas.map((f) => f.id),
      token: preview.token,
      motivo,
    })
    setAplicando(false)
    if (!res.success || !res.data) {
      toast({ title: "No se pudo recalcular", description: res.message, variant: "destructive" })
      return
    }
    toast({
      title: `${res.data.actualizadas} registro(s) recalculado(s)`,
      description: "Se guardó un respaldo para poder revertirlo.",
    })
    setPreview(null)
    setConfirmacion("")
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <RotateCcw className="h-4 w-4" />
          Recalcular un período
        </CardTitle>
        <CardDescription>
          Aplica las políticas actuales a días ya registrados. Primero muestra qué cambiaría.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Esto no solo mueve la nómina: <strong>también mueve lo que se le factura al cliente</strong>.
            La facturación de turnos suma las horas extra sin importar si están aprobadas, así que
            recalcular un mes cerrado cambia el ingreso de ese mes.
          </AlertDescription>
        </Alert>

        <div className="grid gap-3 md:grid-cols-4">
          <Campo l="Desde">
            <DatePickerField value={desde} onChange={setDesde} />
          </Campo>
          <Campo l="Hasta">
            <DatePickerField value={hasta} onChange={setHasta} />
          </Campo>
          <Campo l="Puesto (opcional)">
            <Select value={puesto || "__todos"} onValueChange={(v) => setPuesto(v === "__todos" ? "" : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos</SelectItem>
                {puestos.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <div className="flex items-end">
            <Button onClick={previsualizar} disabled={!desde || !hasta || !empresaId || cargando} className="gap-1.5">
              {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              Previsualizar
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={incluirAprobadas} onCheckedChange={setIncluirAprobadas} />
            Incluir las ya aprobadas <span className="text-xs text-muted-foreground">(mueven nómina liquidada)</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={incluirManuales} onCheckedChange={setIncluirManuales} />
            Incluir las ajustadas a mano{" "}
            <span className="text-xs text-muted-foreground">(pisan una decisión de una persona)</span>
          </label>
        </div>

        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Resumen l="Evaluadas" v={String(preview.totalEvaluadas)} />
              <Resumen l="Cambian" v={String(preview.totalCambian)} />
              <Resumen l="Horas que suben" v={`+${preview.horasGanadas}`} />
              <Resumen l="Horas que bajan" v={`−${preview.horasPerdidas}`} />
              {preview.cambianAprobadas > 0 && (
                <Badge variant="destructive">{preview.cambianAprobadas} aprobadas</Badge>
              )}
              {preview.cambianManuales > 0 && (
                <Badge variant="destructive">{preview.cambianManuales} ajustadas a mano</Badge>
              )}
            </div>

            {preview.truncado && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  El rango tiene demasiados registros y se recortó la revisión. Acota las fechas para
                  verlo completo antes de aplicar.
                </AlertDescription>
              </Alert>
            )}

            {preview.totalCambian === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ningún registro cambia con las políticas actuales.
              </p>
            ) : (
              <>
                <div className="max-h-72 overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Fecha</TableHead>
                        <TableHead>Trabajador</TableHead>
                        <TableHead>Puesto</TableHead>
                        <TableHead className="text-center">Antes</TableHead>
                        <TableHead className="text-center">Después</TableHead>
                        <TableHead className="text-center">Δ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.filas.slice(0, 200).map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="whitespace-nowrap">{f.fecha}</TableCell>
                          <TableCell>
                            {f.nombre}
                            {f.extrasManual && (
                              <Badge variant="outline" className="ml-1 text-[10px]">
                                manual
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{f.puesto ?? "—"}</TableCell>
                          <TableCell className="text-center">{f.hedActual + f.hedfActual}</TableCell>
                          <TableCell className="text-center">{f.hedNuevo + f.hedfNuevo}</TableCell>
                          <TableCell
                            className={`text-center font-medium ${f.delta > 0 ? "text-green-700" : "text-destructive"}`}
                          >
                            {f.delta > 0 ? `+${f.delta}` : f.delta}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Campo l="Motivo del recálculo" ayuda="Queda guardado con el respaldo.">
                    <Input
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ej. Se corrigió el umbral del sábado"
                    />
                  </Campo>
                  {exigeConfirmar && (
                    <Campo l="Escribe RECALCULAR para confirmar" ayuda="Hay filas aprobadas o ajustadas a mano.">
                      <Input value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
                    </Campo>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button variant="destructive" onClick={aplicar} disabled={!puedeAplicar || aplicando} className="gap-1.5">
                    {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Aplicar a {preview.totalCambian} registro(s)
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------- Auxiliares */

function Campo({ l, ayuda, children }: { l: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{l}</Label>
      {children}
      {ayuda && <p className="text-[11px] text-muted-foreground">{ayuda}</p>}
    </div>
  )
}

function Resumen({ l, v }: { l: string; v: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
      <span className="text-muted-foreground">{l}:</span>
      <span className="font-medium">{v}</span>
    </span>
  )
}

function Paso({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{l}</span>
      <span className="font-medium">{v}</span>
    </div>
  )
}

export default PoliticasHorasExtra
