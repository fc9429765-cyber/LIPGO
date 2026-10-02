"use client"

// NOTIFICACIÓN AL CONDUCTOR
//
// Configura los dos avisos automáticos: asignación de muelle y fin de cargue.
//
// Lo que más importa de esta pantalla es el DESVÍO DE PRUEBAS: mientras tenga
// un número, todos los avisos van ahí en vez de al conductor. Vaciarlo es lo
// que pone el flujo en real, y por eso se pide confirmación.

import { useCallback, useEffect, useState } from "react"
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
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  TestTube2,
  Truck,
  X,
} from "lucide-react"
import {
  getConfigConductor,
  getEnlaceEncuestaEjemplo,
  getHistorialConductor,
  guardarConfigConductor,
} from "@/lib/notificacion-conductor-actions"
import type { AvisoEnviado, ConfigConductor } from "@/lib/notificacion-conductor-tipos"

/** Los proyectos de LIP. Mismos ids que usa el resto del sistema. */
const EMPRESAS = [
  { id: 1, nombre: "Harinera Indupan" },
  { id: 2, nombre: "Avimol" },
  { id: 3, nombre: "Cedi Funza" },
  { id: 4, nombre: "Cedi Medellín" },
]

/*
 * Los marcadores que admite el texto.
 *
 * `repetido` señala los que la plantilla YA pone en su encabezado fijo. Se
 * siguen aceptando --puede haber mensajes viejos que los usen-- pero se marcan,
 * porque ponerlos otra vez dice la placa dos veces en el mismo mensaje.
 */
const MARCADORES = [
  { clave: "{muelle}", que: "número de muelle" },
  { clave: "{cliente}", que: "empresa" },
  { clave: "{encuesta}", que: "enlace de la encuesta" },
  { clave: "{conductor}", que: "nombre del conductor", repetido: true },
  { clave: "{placa}", que: "placa del vehículo", repetido: true },
  { clave: "{orden}", que: "número de orden", repetido: true },
]

function Tarjeta({
  cfg,
  onGuardar,
}: {
  cfg: ConfigConductor
  onGuardar: () => void
}) {
  const { toast } = useToast()
  const [activo, setActivo] = useState(cfg.activo)
  const [mensaje, setMensaje] = useState(cfg.mensaje)
  const [titulo, setTitulo] = useState(cfg.titulo)
  const [url, setUrl] = useState(cfg.urlEncuesta ?? "")
  const [empresas, setEmpresas] = useState<number[]>(cfg.empresas)
  const [telPrueba, setTelPrueba] = useState(cfg.telefonoPrueba ?? "")
  const [guardando, setGuardando] = useState(false)
  // Un enlace real, para poder abrir la encuesta antes de activar el aviso.
  const [ejemploUrl, setEjemploUrl] = useState<string | null>(null)
  const [ejemploOrden, setEjemploOrden] = useState<string | null>(null)
  const [buscandoEjemplo, setBuscandoEjemplo] = useState(false)

  const esCierre = cfg.evento === "cargue_finalizado"

  // La primera versión del script 182 sembró este marcador. No es un formulario:
  // es un enlace muerto que le gana a la encuesta propia y deja el KPI en cero
  // sin que nada avise. Se señala aquí porque se corrige borrando el campo.
  const urlMuerta = url.trim() === "https://forms.gle/PENDIENTE"

  async function guardar() {
    // Quitar el desvío es lo que hace que empiecen a llegarle mensajes a gente
    // real. No puede pasar por descuido.
    if (cfg.telefonoPrueba && !telPrueba.trim()) {
      const ok = window.confirm(
        "Vas a quitar el teléfono de pruebas.\n\n" +
          "A partir de ahora los avisos irían al conductor de cada orden, no a tu número. " +
          "¿Continuar?",
      )
      if (!ok) return
    }

    setGuardando(true)
    const r = await guardarConfigConductor({
      evento: cfg.evento,
      activo,
      mensaje,
      titulo,
      urlEncuesta: esCierre ? url : null,
      empresas,
      telefonoPrueba: telPrueba || null,
    })
    setGuardando(false)
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: "Configuración guardada", description: cfg.nombre })
    onGuardar()
  }

  async function verEnlaceReal() {
    setBuscandoEjemplo(true)
    const r = await getEnlaceEncuestaEjemplo()
    setBuscandoEjemplo(false)
    if (!r.success || !r.url) {
      toast({
        title: "No se pudo armar el enlace",
        description: r.message,
        variant: "destructive",
      })
      return
    }
    setEjemploUrl(r.url)
    setEjemploOrden(r.orden ?? null)
  }

  // Cómo se va a ver el mensaje, con datos de ejemplo.
  const ejemplo = mensaje
    .replace(/\{conductor\}/gi, "Jorge Ramírez")
    .replace(/\{placa\}/gi, "ABC123")
    .replace(/\{muelle\}/gi, "3")
    .replace(/\{orden\}/gi, "OC-4451")
    .replace(/\{cliente\}/gi, "Avimol")
    .replace(
      /\{encuesta\}/gi,
      urlMuerta
        ? "(enlace roto)"
        : url || ejemploUrl || "el enlace de la encuesta de LIPgo",
    )

  return (
    <section className="lg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Truck className="h-4 w-4" />
            {cfg.nombre}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {cfg.evento === "muelle_asignado"
              ? "Se envía al asignarle un muelle al vehículo."
              : "Se envía al cerrar la orden de cargue."}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={activo} onCheckedChange={(v) => setActivo(v === true)} />
          <span className="text-sm font-medium">{activo ? "Activo" : "Desactivado"}</span>
        </label>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <Label className="text-xs">Título del aviso</Label>
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            className="mt-1 h-9 text-sm"
          />
        </div>

        <div>
          <Label className="text-xs">Mensaje</Label>
          <Textarea
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            rows={3}
            className="mt-1 text-sm"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {MARCADORES.filter((m) => esCierre || m.clave !== "{encuesta}").map((m) => (
              <button
                key={m.clave}
                type="button"
                title={
                  m.repetido
                    ? `${m.que} — la plantilla ya lo incluye, ponerlo aquí lo repite`
                    : m.que
                }
                onClick={() => setMensaje((t) => `${t} ${m.clave}`.replace(/\s{2,}/g, " ").trim())}
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted/50 ${
                  m.repetido
                    ? "border-dashed border-amber-300 text-amber-700"
                    : "border-border"
                }`}
              >
                {m.clave}
              </button>
            ))}
          </div>
        </div>

        {esCierre && (
          <div>
            <Label className="text-xs">Enlace de la encuesta</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Déjalo vacío para usar la encuesta de LIPgo"
              className="mt-1 h-9 text-sm"
            />
            {/* Vacío no es un olvido: es lo que hace que las respuestas cuenten
                en el indicador. Conviene decirlo donde se decide. */}
            {urlMuerta && (
              <div className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
                <p className="text-[11px] text-amber-900">
                  <strong>Este enlace no lleva a ninguna parte.</strong> Es un marcador que quedó
                  de una versión anterior. Bórralo y guarda para usar la encuesta de LIPgo; si lo
                  dejas, al conductor le llega un enlace que no abre.
                </p>
                <button
                  type="button"
                  onClick={() => setUrl("")}
                  className="mt-1.5 rounded border border-amber-400 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                >
                  Borrar el enlace
                </button>
              </div>
            )}
            {/* El enlace es distinto por orden y se arma al enviar, así que aquí
                no hay uno "el" enlace que mostrar. Poder abrir uno real es lo
                único que confirma que la encuesta responde; sin esto, el
                primero en probarla sería un conductor. */}
            {!url.trim() && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                {ejemploUrl ? (
                  <>
                    <p className="text-[11px] text-slate-600">
                      Así queda para la orden <strong>{ejemploOrden}</strong>. Cada orden lleva el
                      suyo:
                    </p>
                    <a
                      href={ejemploUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 flex items-center gap-1.5 break-all font-mono text-[11px] text-teal-700 underline"
                    >
                      {ejemploUrl}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Ábrelo para ver lo que verá el conductor. Es real: si lo respondes, la
                      calificación queda registrada para esa orden.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-slate-600">
                      El enlace se arma al enviar y es distinto para cada orden, por eso no aparece
                      aquí.
                    </p>
                    <button
                      type="button"
                      onClick={verEnlaceReal}
                      disabled={buscandoEjemplo}
                      className="mt-1.5 flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    >
                      {buscandoEjemplo ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3 w-3" />
                      )}
                      Ver un enlace real
                    </button>
                  </>
                )}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {url.trim() && !urlMuerta ? (
                <>
                  Se usará este enlace externo. Las respuestas quedarán{" "}
                  <strong>fuera</strong> del indicador de Satisfacción conductor.
                </>
              ) : urlMuerta ? null : (
                <>
                  Se usará la <strong>encuesta de LIPgo</strong>, un enlace distinto para cada
                  orden que el conductor abre sin iniciar sesión. Las respuestas alimentan el KPI
                  de Satisfacción conductor en Satisfacción y PQRSF.
                </>
              )}
            </p>
          </div>
        )}

        {/* Cómo lo va a recibir el conductor. */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-800">Así se verá</p>
          {/* Espejo del texto REAL de `plantilla_conductor`. Lo que se escribe
              arriba es solo el fragmento {detalle}: el resto --el saludo, la
              placa, la orden y la firma-- viene fijo de la plantilla aprobada
              y no se puede cambiar desde aquí. Sin mostrarlo, la vista previa
              hacía pensar que el mensaje empezaba en "Hola X, {detalle}". */}
          <p className="mt-1 text-sm text-emerald-900">
            <strong>{titulo || "LIP Logística"}</strong>
            <br />
            <br />
            Hola <span className="text-emerald-700">Jorge Ramírez</span>, le informamos sobre su
            vehículo de placa <span className="text-emerald-700">ABC123</span> en la orden de cargue{" "}
            <span className="text-emerald-700">OC-4451</span>.
            <br />
            <br />
            <strong>{ejemplo || "…"}</strong>
            <br />
            <br />
            LIP Progressive Integral Logistics.
          </p>
          <p className="mt-2 border-t border-emerald-200 pt-1.5 text-[10px] text-emerald-800">
            En <strong>negrita</strong>, lo que escribes arriba. Lo demás lo pone la plantilla
            aprobada por Meta y no se edita desde aquí.
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

        {/* EL DESVÍO. Es lo que separa una prueba de escribirle a gente real. */}
        <div
          className={`rounded-lg border p-3 ${
            telPrueba ? "border-sky-300 bg-sky-50" : "border-red-300 bg-red-50"
          }`}
        >
          <p
            className={`flex items-center gap-1.5 text-sm font-medium ${
              telPrueba ? "text-sky-900" : "text-red-900"
            }`}
          >
            <TestTube2 className="h-4 w-4" />
            {telPrueba ? "En modo prueba" : "Enviará al conductor real"}
          </p>
          <Input
            value={telPrueba}
            onChange={(e) => setTelPrueba(e.target.value)}
            placeholder="3202343157"
            className="mt-2 h-9 bg-white text-sm"
          />
          <p className={`mt-1 text-[11px] ${telPrueba ? "text-sky-800" : "text-red-800"}`}>
            {telPrueba
              ? "Todos los avisos van a este número, no al conductor. Vacíalo cuando quieras pasar a real."
              : "Los avisos van al celular del conductor de cada orden (cabeceraoc.celular). El indicativo 57 se antepone solo."}
          </p>
          {/* En modo real, el dato de la orden decide si el mensaje sale. Un
              celular incompleto no rompe nada visible: el conductor no recibe
              y en el historial queda un intento sin mensaje. Conviene decirlo
              donde se toma la decisión. */}
          {!telPrueba && (
            <p className="mt-1 text-[11px] text-red-800">
              Las órdenes con el celular vacío o mal digitado <strong>no reciben aviso</strong>.
              Aparecen abajo como “Sin enviar”, con el motivo.
            </p>
          )}
        </div>

        <Button className="w-full gap-1.5" onClick={guardar} disabled={guardando}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar
        </Button>
      </div>
    </section>
  )
}

/**
 * Cómo se lee cada estado.
 *
 * `leido` y `entregado` los reporta el webhook de Meta; `enviado` significa que
 * Meta lo aceptó pero todavía no confirma nada. Un aviso SIN estado es el caso
 * que más importa: quedó registrado el intento pero no hay mensaje, que casi
 * siempre es configuración faltante.
 */
const ESTADOS: Record<string, { texto: string; clase: string; Icono: typeof Check }> = {
  leido: { texto: "Leído", clase: "bg-emerald-100 text-emerald-800", Icono: CheckCheck },
  entregado: { texto: "Entregado", clase: "bg-teal-100 text-teal-800", Icono: CheckCheck },
  enviado: { texto: "Enviado", clase: "bg-sky-100 text-sky-800", Icono: Check },
  fallido: { texto: "Falló", clase: "bg-red-100 text-red-800", Icono: X },
  error: { texto: "Error", clase: "bg-red-100 text-red-800", Icono: X },
}

/**
 * Qué clase de fallo fue, para poder contarlos y distinguirlos.
 *
 * "Falta el celular" y "el celular está mal escrito" se arreglan en lugares
 * distintos: uno es capturar el dato, el otro corregirlo. Mezclados en un solo
 * "Sin enviar" no se puede saber cuál pesa más.
 */
function claseDeFallo(motivo: string | null): "sin_celular" | "invalido" | "otro" {
  const m = String(motivo ?? "")
  if (m.startsWith("SIN_CELULAR:")) return "sin_celular"
  if (m.startsWith("CELULAR_INVALIDO:")) return "invalido"
  return "otro"
}

/** El motivo sin el prefijo técnico: eso no se le muestra a nadie. */
function motivoLegible(motivo: string | null): string {
  return String(motivo ?? "").replace(/^(SIN_CELULAR|CELULAR_INVALIDO):\s*/, "")
}

function Historial() {
  const [filas, setFilas] = useState<AvisoEnviado[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await getHistorialConductor(50)
    if (r.success && r.data) setFilas(r.data)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  return (
    <section className="lg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Avisos enviados</h3>
          <p className="text-[11px] text-muted-foreground">
            Los últimos 50, con el estado que reporta WhatsApp.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={cargar} disabled={cargando} className="gap-1.5">
          {cargando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Actualizar
        </Button>
      </div>

      {/* Un resumen antes de la lista.
          Con muchos cargues sin celular, la lista de 50 se llena de "Sin
          enviar" y esconde los que sí salieron. El conteo dice de un vistazo
          si el problema es puntual o general. */}
      {!cargando && filas.length > 0 && (
        <div className="flex flex-wrap gap-4 border-b border-border px-4 py-2.5 text-xs">
          <span>
            <strong className="text-emerald-700">
              {filas.filter((f) => f.estado && f.estado !== "fallido" && f.estado !== "error").length}
            </strong>{" "}
            <span className="text-muted-foreground">enviados</span>
          </span>
          <span>
            <strong className="text-amber-700">{filas.filter((f) => !f.estado).length}</strong>{" "}
            <span className="text-muted-foreground">sin enviar</span>
          </span>
          {/* El desglose es lo accionable: dice si hay que capturar el celular
              o corregir los que ya están. */}
          {filas.some((f) => !f.estado && claseDeFallo(f.motivo) === "sin_celular") && (
            <span className="text-muted-foreground">
              ·{" "}
              <strong>
                {filas.filter((f) => !f.estado && claseDeFallo(f.motivo) === "sin_celular").length}
              </strong>{" "}
              sin celular en la orden
            </span>
          )}
          {filas.some((f) => !f.estado && claseDeFallo(f.motivo) === "invalido") && (
            <span className="text-muted-foreground">
              ·{" "}
              <strong>
                {filas.filter((f) => !f.estado && claseDeFallo(f.motivo) === "invalido").length}
              </strong>{" "}
              celular mal escrito
            </span>
          )}
          <span>
            <strong className="text-red-700">
              {filas.filter((f) => f.estado === "fallido" || f.estado === "error").length}
            </strong>{" "}
            <span className="text-muted-foreground">fallidos</span>
          </span>
        </div>
      )}

      {cargando ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filas.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Todavía no se ha enviado ningún aviso automático.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left lg-eyebrow">
                <th className="px-4 py-2 font-medium">Cuándo</th>
                <th className="px-4 py-2 font-medium">Aviso</th>
                <th className="px-4 py-2 font-medium">Orden</th>
                <th className="px-4 py-2 font-medium">Conductor</th>
                <th className="px-4 py-2 font-medium">Teléfono</th>
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
                      {f.placa && (
                        <span className="ml-1.5 text-muted-foreground">{f.placa}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">{f.conductor ?? "—"}</td>
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
                          title={motivoLegible(f.motivo) || "No se llegó a crear el mensaje."}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {claseDeFallo(f.motivo) === "sin_celular"
                            ? "Sin celular"
                            : claseDeFallo(f.motivo) === "invalido"
                              ? "Celular inválido"
                              : "Sin enviar"}
                        </span>
                      )}
                      {f.errorCodigo ? (
                        <p className="mt-0.5 text-[10px] text-red-700">
                          [{f.errorCodigo}] {f.errorDetalle}
                        </p>
                      ) : f.motivo ? (
                        // Sin esto, "Sin enviar" no distingue un celular mal
                        // digitado de un problema de conexión con Meta.
                        <p className="mt-0.5 max-w-[22rem] text-[10px] text-amber-800">
                          {motivoLegible(f.motivo)}
                        </p>
                      ) : null}
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

export default function NotificacionConductor() {
  const [configs, setConfigs] = useState<ConfigConductor[]>([])
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await getConfigConductor()
    if (r.success && r.data) setConfigs(r.data)
    setFaltaMigracion(!!r.faltaMigracion)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

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
          Falta correr <code className="font-mono text-xs">scripts/182_notificacion_conductor.sql</code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-[11px] text-muted-foreground">
          Estos avisos se envían <strong>solos</strong> cuando ocurre el evento en el Centro de
          Coordinación. Cada mensaje tiene costo, así que conviene dejarlos en modo prueba hasta
          confirmar que el texto y el momento son los correctos. Un aviso se envía{" "}
          <strong>una sola vez por orden</strong>: reasignar el muelle no vuelve a escribirle al
          conductor.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {configs.map((c) => (
          <Tarjeta key={c.evento} cfg={c} onGuardar={cargar} />
        ))}
      </div>

      <Historial />
    </div>
  )
}
