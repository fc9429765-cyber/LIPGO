"use client"

// CIERRE DIARIO DE PRODUCCIÓN POR WHATSAPP
//
// Configura el envío automático del PDF con las cifras del día, y permite
// mandarlo a mano para probar.
//
// El PDF se puede DESCARGAR sin enviar nada. Es lo primero que conviene hacer:
// cada envío se cobra y no se retira, así que revisar el formato antes ahorra
// mandar algo que nadie había mirado.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  Clock,
  Download,
  FileText,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  Users,
} from "lucide-react"
import {
  eliminarDestinatarioCierre,
  enviarCierreATodos,
  enviarResumenProduccion,
  getCifrasProduccionDia,
  getConfigCierre,
  getDestinatariosCierre,
  getEstadoPlantillaProduccion,
  getHistorialCierre,
  getPdfResumenProduccion,
  guardarConfigCierre,
  guardarDestinatarioCierre,
  type ConfigCierre,
  type DestinatarioCierre,
} from "@/lib/reporte-produccion-actions"
import { utcDateStr } from "@/lib/paros-produccion"

const num = (n: number) => Math.round(n).toLocaleString("es-CO")

function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`
}

export default function CierreProduccion() {
  const { toast } = useToast()
  const [cfg, setCfg] = useState<ConfigCierre | null>(null)
  const [destinatarios, setDestinatarios] = useState<DestinatarioCierre[]>([])
  const [plantilla, setPlantilla] = useState<Awaited<
    ReturnType<typeof getEstadoPlantillaProduccion>
  > | null>(null)
  const [historial, setHistorial] = useState<Awaited<ReturnType<typeof getHistorialCierre>>["data"]>([])
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [cargando, setCargando] = useState(true)

  const [activo, setActivo] = useState(false)
  const [hora, setHora] = useState("20:00")
  const [guardando, setGuardando] = useState(false)

  const [fecha, setFecha] = useState(utcDateStr())
  const [cifras, setCifras] = useState<Awaited<ReturnType<typeof getCifrasProduccionDia>>["data"]>()
  const [bajando, setBajando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [nuevo, setNuevo] = useState({ nombre: "", telefono: "" })

  const cargar = useCallback(async () => {
    setCargando(true)
    const [c, d, h] = await Promise.all([
      getConfigCierre(),
      getDestinatariosCierre(),
      getHistorialCierre(20),
    ])
    if (c.success && c.data) {
      setCfg(c.data)
      setActivo(c.data.activo)
      setHora(c.data.horaEnvio)
    }
    setFaltaMigracion(!!c.faltaMigracion)
    if (d.success && d.data) setDestinatarios(d.data)
    if (h.success && h.data) setHistorial(h.data)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
    getEstadoPlantillaProduccion().then(setPlantilla)
  }, [cargar])

  // Las cifras se recargan al cambiar de día, aparte del resto.
  useEffect(() => {
    getCifrasProduccionDia(fecha).then((r) => setCifras(r.data))
  }, [fecha])

  const sinGuardar = cfg != null && (activo !== cfg.activo || hora !== cfg.horaEnvio)
  const sinProduccion = cifras != null && cifras.totalBultos === 0

  async function guardar() {
    setGuardando(true)
    const r = await guardarConfigCierre({ activo, horaEnvio: hora })
    setGuardando(false)
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: "Guardado" })
    cargar()
  }

  async function descargar() {
    setBajando(true)
    const r = await getPdfResumenProduccion(fecha)
    setBajando(false)
    if (!r.success || !r.pdf) {
      toast({ title: "No se pudo generar", description: r.message, variant: "destructive" })
      return
    }
    const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
    const a = document.createElement("a")
    a.href = url
    a.download = r.nombre ?? "cierre.pdf"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function probar(telefono: string) {
    const ok = window.confirm(
      `Se va a enviar el cierre del ${fecha} a ${telefono}.\n\n` +
        "El mensaje se cobra y no se puede retirar. ¿Continuar?",
    )
    if (!ok) return
    setEnviando(true)
    const r = await enviarResumenProduccion({ telefono, fecha })
    setEnviando(false)
    if (!r.success) {
      toast({ title: "No se pudo enviar", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: "Enviado", description: `Revisa el WhatsApp de ${telefono}.` })
    cargar()
  }

  async function enviarATodos() {
    const activos = destinatarios.filter((d) => d.activo)
    const ok = window.confirm(
      `Se va a enviar el cierre del ${fecha} a ${activos.length} destinatario(s).\n\n` +
        `Son ${activos.length} mensaje(s) que se cobran y no se pueden retirar. ¿Continuar?`,
    )
    if (!ok) return
    setEnviando(true)
    const r = await enviarCierreATodos({ fecha, origen: "manual" })
    setEnviando(false)
    toast({
      title: r.enviados > 0 ? "Enviado" : "No se envió nada",
      description:
        r.message ?? `${r.enviados} enviado(s)${r.fallidos > 0 ? `, ${r.fallidos} con error` : ""}.`,
      variant: r.enviados > 0 ? undefined : "destructive",
    })
    cargar()
  }

  async function agregar() {
    if (!nuevo.nombre.trim() || !nuevo.telefono.trim()) return
    const r = await guardarDestinatarioCierre(nuevo)
    if (!r.success) {
      toast({ title: "No se pudo agregar", description: r.message, variant: "destructive" })
      return
    }
    setNuevo({ nombre: "", telefono: "" })
    cargar()
  }

  async function quitar(d: DestinatarioCierre) {
    if (!window.confirm(`¿Quitar a ${d.nombre} (${d.telefono})?`)) return
    const r = await eliminarDestinatarioCierre(d.id)
    if (!r.success) {
      toast({ title: "No se pudo quitar", description: r.message, variant: "destructive" })
      return
    }
    cargar()
  }

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
          <code className="font-mono text-xs">scripts/197_cierre_produccion_automatico.sql</code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* El fallo más probable al estrenar esto es que la plantilla se haya
          aprobado con otro nombre. Meta lo reporta como "no existe". */}
      {plantilla && !plantilla.aprobada && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            La plantilla no está lista en Meta
          </p>
          <p className="mt-1 text-[11px] text-amber-900">
            {plantilla.message ??
              `"${plantilla.nombreBuscado}" está en estado ${plantilla.estado}.`}{" "}
            Hasta que Meta la apruebe no sale ningún envío. Descargar el PDF sí funciona.
          </p>
          {plantilla.candidatas.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-900">
              Aprobadas que sí existen:{" "}
              <span className="font-mono">{plantilla.candidatas.join(", ")}</span>
            </p>
          )}
        </div>
      )}

      {/* ===== Envío automático ===== */}
      <section className="lg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4" />
              Envío automático
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Manda el PDF del cierre todos los días a la hora indicada.
            </p>
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

        <div className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <Label className="text-xs">Hora de envío</Label>
            <Input
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              className="mt-1 h-9 w-[7rem] text-sm"
            />
          </div>
          <Button onClick={guardar} disabled={guardando || !sinGuardar} className="h-9 gap-1.5">
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {sinGuardar ? "Guardar cambios" : "Guardado"}
          </Button>
          <p className="flex-1 text-[11px] text-muted-foreground">
            {/* La hora vive en dos sitios y conviene decirlo: cambiarla aquí sin
                tocar el despliegue no mueve la hora real. */}
            El programador corre a las <strong>20:00</strong>. Si pones otra hora aquí, el envío se
            omite hasta que coincidan — avísame para ajustar el programador.
          </p>
        </div>
      </section>

      {/* ===== Destinatarios ===== */}
      <section className="lg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" />
            A quién le llega
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Un mensaje por persona y día. {destinatarios.filter((d) => d.activo).length}{" "}
            destinatario(s) = {destinatarios.filter((d) => d.activo).length * 30} mensajes al mes.
          </p>
        </div>

        <div className="space-y-3 p-4">
          {destinatarios.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              Nadie recibe el cierre todavía.
            </p>
          ) : (
            <div className="space-y-2">
              {destinatarios.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.nombre}</p>
                    <p className="font-mono text-xs text-muted-foreground">{d.telefono}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => probar(d.telefono)}
                      disabled={enviando || sinProduccion || plantilla?.aprobada === false}
                    >
                      <Send className="h-3 w-3" />
                      Probar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-muted-foreground hover:text-red-600"
                      onClick={() => quitar(d)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
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
                placeholder="Gerencia"
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
            <Button onClick={agregar} className="h-9 gap-1.5">
              <Plus className="h-4 w-4" />
              Agregar
            </Button>
          </div>
        </div>
      </section>

      {/* ===== Prueba manual ===== */}
      <section className="lg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Probar con un día concreto</h3>
          <p className="text-[11px] text-muted-foreground">
            Conviene <strong>descargar el PDF primero</strong>: cada envío se cobra y no se retira.
          </p>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">Día</Label>
              <Input
                type="date"
                value={fecha}
                max={utcDateStr()}
                onChange={(e) => setFecha(e.target.value)}
                className="mt-1 h-9 w-[10rem] text-sm"
              />
            </div>
            <Button
              variant="outline"
              onClick={descargar}
              disabled={bajando || sinProduccion}
              className="h-9 gap-1.5"
            >
              {bajando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Ver el PDF
            </Button>
            <Button
              onClick={enviarATodos}
              disabled={
                enviando ||
                sinProduccion ||
                plantilla?.aprobada === false ||
                destinatarios.filter((d) => d.activo).length === 0
              }
              className="h-9 gap-1.5"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar a todos
            </Button>
          </div>

          {sinProduccion ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-[11px] text-amber-900">
                {/* Un PDF en ceros cuesta lo mismo y no dice nada que no diga
                    su ausencia. */}
                Ese día no registra producción. No se envía un cierre vacío.
              </p>
            </div>
          ) : cifras ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { e: "Bultos", v: num(cifras.totalBultos), s: `meta ${num(cifras.metaDia)}` },
                { e: "Cumplimiento", v: `${cifras.cumplimientoPct.toFixed(0)}%`, s: "de la meta" },
                { e: "OEE", v: `${cifras.oee.toFixed(0)}%`, s: cifras.oee >= 80 ? "excelente" : cifras.oee >= 60 ? "aceptable" : "crítico" },
                { e: "Paros", v: fmtMin(cifras.parosMinutos), s: `${cifras.parosTotal} franjas` },
              ].map((c) => (
                <div key={c.e} className="rounded-lg border border-border p-2.5">
                  <p className="lg-eyebrow">{c.e}</p>
                  <p className="mt-0.5 text-lg font-bold">{c.v}</p>
                  <p className="text-[10px] text-muted-foreground">{c.s}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-[11px] text-muted-foreground">
              El PDF lleva los cuatro números de arriba, el OEE con sus componentes, los paros con
              sus categorías, el desglose por producto y la producción hora a hora.
            </p>
          </div>
        </div>
      </section>

      {/* ===== Historial ===== */}
      {historial && historial.length > 0 && (
        <section className="lg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Últimos envíos</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left lg-eyebrow">
                  <th className="px-4 py-2 font-medium">Cuándo</th>
                  <th className="px-4 py-2 font-medium">Cierre del</th>
                  <th className="px-4 py-2 font-medium">Para</th>
                  <th className="px-4 py-2 font-medium">Origen</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((h) => (
                  <tr key={h.id} className="border-b border-border/50 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                      {new Date(h.creadoEn).toLocaleString("es-CO", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-xs">{h.fecha}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{h.telefono}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{h.origen}</td>
                    <td className="px-4 py-2">
                      {h.motivo ? (
                        <span className="text-[11px] text-red-700">{h.motivo}</span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                          Enviado
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
