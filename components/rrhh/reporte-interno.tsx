"use client"

// REPORTE INTERNO DE OPERACIÓN
//
// Los cinco avisos de la línea de tiempo de un cargue, y a quién le llegan.
//
// Lo que más pesa de esta pantalla es el VOLUMEN: con ~35 cargues al día, los
// cinco eventos encendidos son ~175 mensajes diarios por destinatario, y cada
// uno se cobra. Por eso el conteo va arriba, antes que cualquier otra cosa.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react"
import {
  eliminarDestinatario,
  getConfigInterno,
  getDestinatarios,
  getEstadoPlantillaInterna,
  getHistorialInterno,
  guardarConfigInterno,
  guardarDestinatario,
} from "@/lib/reporte-interno-actions"
import {
  MARCADORES_POR_EVENTO,
  QUE_ES,
  type AvisoInterno,
  type ConfigInterno,
  type DestinatarioInterno,
  type EventoInterno,
} from "@/lib/reporte-interno-tipos"

const EMPRESAS = [
  { id: 1, nombre: "Harinera Indupan" },
  { id: 2, nombre: "Avimol" },
  { id: 3, nombre: "Cedi Funza" },
  { id: 4, nombre: "Cedi Medellín" },
]

/** Datos de ejemplo para la vista previa. */
const EJEMPLO: Record<string, string> = {
  conductor: "Jorge Ramírez",
  cliente: "Bimbo",
  muelle: "3",
  lote: "L-2026-0912",
  peso: "12.450",
  tiquete: "T-8842",
  transporte: "Transportes del Norte",
  hora: "22/09 14:35",
  sede: "Avimol",
}

function vistaPrevia(detalle: string): string {
  let t = detalle
  for (const [k, v] of Object.entries(EJEMPLO)) {
    t = t.replace(new RegExp(`\\{${k}\\}`, "gi"), v)
  }
  return t
    .replace(/[A-Za-zÁÉÍÓÚáéíóúÑñ ]+:\s*(?=·|$)/g, "")
    .replace(/(\s*·\s*)+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim()
}

function TarjetaEvento({ cfg, onGuardar }: { cfg: ConfigInterno; onGuardar: () => void }) {
  const { toast } = useToast()
  const [activo, setActivo] = useState(cfg.activo)
  const [detalle, setDetalle] = useState(cfg.detalle)
  const [empresas, setEmpresas] = useState<number[]>(cfg.empresas)
  const [guardando, setGuardando] = useState(false)

  /*
   * Volver a tomar lo que dice la base cuando llegan datos nuevos.
   *
   * `useState(cfg.activo)` solo lee el valor en el primer render: si la tarjeta
   * se reutiliza tras recargar, se quedaría mostrando lo de antes. Se compara
   * contra `cfg` --no contra el estado-- para no pisar lo que alguien esté
   * escribiendo.
   */
  useEffect(() => {
    setActivo(cfg.activo)
    setDetalle(cfg.detalle)
    setEmpresas(cfg.empresas)
  }, [cfg.activo, cfg.detalle, cfg.empresas])

  // Hay cambios sin guardar. La casilla NO guarda sola: marcarla y salirse
  // dejaba el evento apagado sin que nada lo dijera.
  const sinGuardar =
    activo !== cfg.activo ||
    detalle !== cfg.detalle ||
    empresas.length !== cfg.empresas.length ||
    empresas.some((e) => !cfg.empresas.includes(e))

  const marcadores = MARCADORES_POR_EVENTO[cfg.evento] ?? []

  async function guardar() {
    setGuardando(true)
    const r = await guardarConfigInterno({ evento: cfg.evento, activo, detalle, empresas })
    setGuardando(false)
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: "Guardado", description: cfg.nombre })
    onGuardar()
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {cfg.ordenLinea}
          </span>
          <h3 className="text-sm font-semibold">{cfg.nombre}</h3>
        </div>
        <div className="flex items-center gap-2">
          {sinGuardar && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
              sin guardar
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={activo} onCheckedChange={(v) => setActivo(v === true)} />
            <span className="text-sm font-medium">{activo ? "Activo" : "Desactivado"}</span>
          </label>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <Label className="text-xs">Qué se informa</Label>
          <Textarea
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            rows={2}
            className="mt-1 text-sm"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {marcadores.map((m) => (
              <button
                key={m}
                type="button"
                title={QUE_ES[m] ?? m}
                onClick={() => setDetalle((t) => `${t} {${m}}`.replace(/\s{2,}/g, " ").trim())}
                className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted/50"
              >
                {`{${m}}`}
              </button>
            ))}
          </div>
          {/* Los marcadores de placa y orden no están: la plantilla ya los pone
              en su propia variable, y ofrecerlos aquí los repetiría. */}
          <p className="mt-1 text-[10px] text-muted-foreground">
            La placa y la orden las pone la plantilla; no hace falta escribirlas.
          </p>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-800">Así se verá</p>
          <p className="mt-1 text-sm text-emerald-900">
            <strong>Reporte Interno Operación</strong>
            <br />
            <br />
            Novedad de operación registrada en LIPgo.
            <br />
            <br />
            Evento: {cfg.nombre}
            <br />
            Vehículo y orden: ABC123 · Orden IND20260922001
            <br />
            Detalle: <strong>{vistaPrevia(detalle) || "…"}</strong>
          </p>
        </div>

        <div>
          <Label className="text-xs">Empresas donde aplica</Label>
          <div className="mt-1 flex flex-wrap gap-3">
            {EMPRESAS.map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <Checkbox
                  checked={empresas.includes(e.id)}
                  onCheckedChange={(v) =>
                    setEmpresas((prev) =>
                      v === true ? [...prev, e.id] : prev.filter((x) => x !== e.id),
                    )
                  }
                />
                {e.nombre}
              </label>
            ))}
          </div>
          {activo && empresas.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-700">
              Sin empresas seleccionadas no se enviará ningún aviso.
            </p>
          )}
        </div>

        <Button
          className="w-full gap-1.5"
          onClick={guardar}
          disabled={guardando || !sinGuardar}
          variant={sinGuardar ? "default" : "outline"}
        >
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {sinGuardar ? "Guardar cambios" : "Guardado"}
        </Button>
      </div>
    </section>
  )
}

function Destinatarios({
  lista,
  eventos,
  onCambio,
}: {
  lista: DestinatarioInterno[]
  eventos: ConfigInterno[]
  onCambio: () => void
}) {
  const { toast } = useToast()
  // `empresas` vacío = recibe de todas. Es el caso normal, así que arranca así.
  const [nuevo, setNuevo] = useState<{ nombre: string; telefono: string; empresas: number[] }>({
    nombre: "",
    telefono: "",
    empresas: [],
  })
  const [guardando, setGuardando] = useState(false)

  async function agregar() {
    if (!nuevo.nombre.trim() || !nuevo.telefono.trim()) return
    setGuardando(true)
    const r = await guardarDestinatario({
      nombre: nuevo.nombre,
      telefono: nuevo.telefono,
      activo: true,
      soloEventos: [],
      empresas: nuevo.empresas,
    })
    setGuardando(false)
    if (!r.success) {
      toast({ title: "No se pudo agregar", description: r.message, variant: "destructive" })
      return
    }
    setNuevo({ nombre: "", telefono: "", empresas: [] })
    onCambio()
  }

  async function quitar(d: DestinatarioInterno) {
    if (!window.confirm(`¿Quitar a ${d.nombre} (${d.telefono}) de los avisos?`)) return
    const r = await eliminarDestinatario(d.id)
    if (!r.success) {
      toast({ title: "No se pudo quitar", description: r.message, variant: "destructive" })
      return
    }
    onCambio()
  }

  async function alternarEmpresa(d: DestinatarioInterno, empresaId: number) {
    const tiene = d.empresas.includes(empresaId)
    const empresas = tiene
      ? d.empresas.filter((e) => e !== empresaId)
      : [...d.empresas, empresaId].sort((a, b) => a - b)

    const r = await guardarDestinatario({
      id: d.id,
      nombre: d.nombre,
      telefono: d.telefono,
      activo: d.activo,
      soloEventos: d.soloEventos,
      empresas,
    })
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    onCambio()
  }

  async function alternar(d: DestinatarioInterno, evento: EventoInterno) {
    const tiene = d.soloEventos.includes(evento)
    const soloEventos = tiene
      ? d.soloEventos.filter((e) => e !== evento)
      : [...d.soloEventos, evento]
    const r = await guardarDestinatario({
      id: d.id,
      nombre: d.nombre,
      telefono: d.telefono,
      activo: d.activo,
      soloEventos,
      empresas: d.empresas,
    })
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    onCambio()
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" />
          A quién le llegan
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Cada evento cuesta un mensaje <strong>por persona</strong> de esta lista.
        </p>
      </div>

      <div className="space-y-3 p-4">
        {lista.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nadie recibe avisos todavía.
          </p>
        ) : (
          <div className="space-y-2">
            {lista.map((d) => (
              <div key={d.id} className="rounded-lg border border-border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.nombre}</p>
                    <p className="font-mono text-xs text-muted-foreground">{d.telefono}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground hover:text-red-600"
                    onClick={() => quitar(d)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* De qué empresas recibe. Sin marcar ninguna, recibe de
                    todas: es el caso de gerencia, y el más común. */}
                <div className="mt-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Empresas
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {EMPRESAS.map((e) => {
                      const todas = d.empresas.length === 0
                      const marcada = todas || d.empresas.includes(e.id)
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => alternarEmpresa(d, e.id)}
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            marcada
                              ? "border-sky-300 bg-sky-50 text-sky-800"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {e.nombre}
                        </button>
                      )
                    })}
                  </div>
                  {d.empresas.length === 0 && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Recibe de todas las empresas.
                    </p>
                  )}
                </div>

                {/* Sin marcar nada recibe todo: es lo más común y no obliga a
                    tocar cinco casillas para el caso normal. */}
                <p className="mb-1 mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Eventos
                </p>
                <div className="flex flex-wrap gap-1">
                  {eventos.map((ev) => {
                    const todos = d.soloEventos.length === 0
                    const marcado = todos || d.soloEventos.includes(ev.evento)
                    return (
                      <button
                        key={ev.evento}
                        type="button"
                        onClick={() => alternar(d, ev.evento)}
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          marcado
                            ? "border-teal-300 bg-teal-50 text-teal-800"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {ev.nombre}
                      </button>
                    )
                  })}
                </div>
                {d.soloEventos.length === 0 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Recibe todos los eventos activos.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="min-w-[8rem] flex-1">
            <Label className="text-xs">Nombre</Label>
            <Input
              value={nuevo.nombre}
              onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))}
              placeholder="Coordinación"
              className="mt-1 h-9 text-sm"
            />
          </div>
          <div className="min-w-[8rem] flex-1">
            <Label className="text-xs">WhatsApp</Label>
            <Input
              value={nuevo.telefono}
              onChange={(e) => setNuevo((n) => ({ ...n, telefono: e.target.value }))}
              placeholder="3202343157"
              className="mt-1 h-9 text-sm"
            />
          </div>
          <Button onClick={agregar} disabled={guardando} className="h-9 gap-1.5">
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Agregar
          </Button>

          {/* Las empresas al dar de alta. Sin marcar ninguna recibe de todas,
              que es lo que querrá gerencia; los coordinadores marcan la suya. */}
          <div className="w-full">
            <Label className="text-xs">Empresas (sin marcar = todas)</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {EMPRESAS.map((e) => {
                const marcada = nuevo.empresas.includes(e.id)
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() =>
                      setNuevo((n) => ({
                        ...n,
                        empresas: marcada
                          ? n.empresas.filter((x) => x !== e.id)
                          : [...n.empresas, e.id].sort((a, b) => a - b),
                      }))
                    }
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      marcada
                        ? "border-sky-300 bg-sky-50 text-sky-800"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {e.nombre}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const ESTADOS: Record<string, { texto: string; clase: string; Icono: typeof Check }> = {
  leido: { texto: "Leído", clase: "bg-emerald-100 text-emerald-800", Icono: CheckCheck },
  entregado: { texto: "Entregado", clase: "bg-teal-100 text-teal-800", Icono: CheckCheck },
  enviado: { texto: "Enviado", clase: "bg-sky-100 text-sky-800", Icono: Check },
  fallido: { texto: "Falló", clase: "bg-red-100 text-red-800", Icono: X },
  error: { texto: "Error", clase: "bg-red-100 text-red-800", Icono: X },
}

function Historial() {
  const [filas, setFilas] = useState<AvisoInterno[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await getHistorialInterno(50)
    if (r.success && r.data) setFilas(r.data)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Avisos enviados</h3>
        <Button variant="outline" size="sm" onClick={cargar} disabled={cargando} className="gap-1.5">
          {cargando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Actualizar
        </Button>
      </div>

      {cargando ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filas.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Todavía no se ha enviado ningún aviso interno.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Cuándo</th>
                <th className="px-4 py-2 font-medium">Evento</th>
                <th className="px-4 py-2 font-medium">Orden</th>
                <th className="px-4 py-2 font-medium">Para</th>
                <th className="px-4 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const e = f.estado ? ESTADOS[f.estado] : null
                return (
                  <tr key={f.id} className="border-b border-border/50 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                      {new Date(f.creadoEn).toLocaleString("es-CO", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs">{f.eventoNombre}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs">
                      <span className="font-medium">{f.ordenDeCargue ?? f.ordenId}</span>
                      {f.placa && <span className="ml-1.5 text-muted-foreground">{f.placa}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                      {f.telefono ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      {e ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${e.clase}`}
                        >
                          <e.Icono className="h-3 w-3" />
                          {e.texto}
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                          title={f.motivo ?? "No se llegó a crear el mensaje."}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Sin enviar
                        </span>
                      )}
                      {(f.errorCodigo || f.motivo) && (
                        <p className="mt-0.5 max-w-[22rem] text-[10px] text-amber-800">
                          {f.errorCodigo ? `[${f.errorCodigo}] ${f.errorDetalle}` : f.motivo}
                        </p>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function ReporteInterno() {
  const [eventos, setEventos] = useState<ConfigInterno[]>([])
  const [destinatarios, setDestinatarios] = useState<DestinatarioInterno[]>([])
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [plantilla, setPlantilla] = useState<{
    aprobada: boolean
    idioma: string | null
    categoria: string | null
    estado: string | null
    message?: string
  } | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const [cfg, dest, plt] = await Promise.all([
      getConfigInterno(),
      getDestinatarios(),
      getEstadoPlantillaInterna(),
    ])
    if (cfg.success && cfg.data) setEventos(cfg.data)
    if (dest.success && dest.data) setDestinatarios(dest.data)
    setPlantilla(plt)
    setFaltaMigracion(!!cfg.faltaMigracion)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  /*
   * El costo de lo que está encendido.
   *
   * Es lo primero que se ve porque es la decisión real de esta pantalla: los
   * cinco eventos para tres personas son más de quinientos mensajes al día, y
   * eso no se intuye mirando cinco interruptores.
   */
  const estimado = useMemo(() => {
    const activos = eventos.filter((e) => e.activo)

    /*
     * Los ~35 cargues diarios se reparten entre las empresas, no ocurren en
     * cada una. Contar a cada destinatario por el total inflaría la cifra:
     * cuatro coordinadores de empresas distintas no reciben 4×35, reciben 35
     * entre todos.
     *
     * Se reparte a partes iguales porque LIPgo no sabe cuántos cargues tiene
     * cada empresa. Es una estimación, y lo que importa de ella es el orden de
     * magnitud: si sale 500 o si sale 50.
     */
    const CARGUES_DIA = 35
    const porEmpresa = CARGUES_DIA / Math.max(EMPRESAS.length, 1)

    let mensajesDia = 0
    for (const ev of activos) {
      for (const emp of ev.empresas) {
        const gente = destinatarios.filter(
          (d) =>
            d.activo &&
            (!d.soloEventos.length || d.soloEventos.includes(ev.evento)) &&
            (!d.empresas.length || d.empresas.includes(emp)),
        ).length
        mensajesDia += gente * porEmpresa
      }
    }

    return { activos: activos.length, mensajesDia: Math.round(mensajesDia) }
  }, [eventos, destinatarios])

  if (cargando) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (faltaMigracion) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          Falta correr{" "}
          <code className="font-mono text-xs">scripts/196_reporte_interno_operacion.sql</code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Estado real en Meta. Que el registro exista en LIPgo no significa que
          Meta la tenga aprobada: sin esto, un aviso que no sale obliga a ir a
          WhatsApp Manager para saber por qué. */}
      {plantilla && !plantilla.aprobada && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            La plantilla no está lista en Meta
          </p>
          <p className="mt-1 text-[11px] text-amber-900">
            {plantilla.message ??
              `Está en estado ${plantilla.estado}. Hasta que Meta la apruebe no sale ningún aviso.`}
          </p>
        </div>
      )}

      {plantilla?.aprobada && (
        <p className="text-[11px] text-muted-foreground">
          Plantilla <code className="font-mono">reporte_interno_operacion</code> · aprobada ·
          categoría <strong>{plantilla.categoria}</strong> · idioma{" "}
          <strong>{plantilla.idioma}</strong>
          {plantilla.idioma !== "es_CO" && plantilla.idioma !== "es" && (
            <>
              {" "}
              — quedó registrada en ese idioma aunque el texto esté en español. No afecta el envío:
              el sistema lee el idioma real antes de cada mensaje.
            </>
          )}
        </p>
      )}

      <div
        className={`rounded-lg border p-3 ${
          estimado.mensajesDia > 200
            ? "border-amber-300 bg-amber-50"
            : "border-border bg-muted/30"
        }`}
      >
        <p className="text-[11px] text-muted-foreground">
          Estos avisos se envían <strong>solos</strong> cuando ocurre el evento en la operación.
          Cada mensaje tiene costo.
        </p>
        <p className="mt-1 text-sm">
          <strong>{estimado.activos}</strong> de {eventos.length} eventos activos ·{" "}
          <strong
            className={estimado.mensajesDia > 200 ? "text-amber-800" : undefined}
          >
            ~{estimado.mensajesDia.toLocaleString("es-CO")}
          </strong>{" "}
          mensajes al día
          {estimado.mensajesDia > 200 && " — conviene revisar si todos hacen falta"}
        </p>
        {/* Este conteo sale de la BASE, no de las casillas. Marcar una casilla
            no guarda: sin decirlo, ver "0 activos" después de marcar las cinco
            parece que el sistema no registra nada. */}
        {estimado.activos === 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Marcar la casilla de un evento no basta: hay que pulsar{" "}
            <strong>Guardar cambios</strong> en su tarjeta.
          </p>
        )}
      </div>

      <Destinatarios lista={destinatarios} eventos={eventos} onCambio={cargar} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {eventos.map((ev) => (
          <TarjetaEvento key={ev.evento} cfg={ev} onGuardar={cargar} />
        ))}
      </div>

      <Historial />
    </div>
  )
}
