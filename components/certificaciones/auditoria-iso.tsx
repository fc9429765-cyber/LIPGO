"use client"

// AUDITORÍA ISO 9001:2015
//
// Reemplaza el libro de Excel "Modulo_Auditoria ISO 9001 v1". Tres pantallas
// que siguen el orden real de una auditoría: se planea, se recorre el
// checklist de la norma, y lo que no cumple se vuelve un hallazgo con su
// acción correctiva.
//
// El tablero no es una pestaña aparte como en el Excel: va arriba del
// checklist, porque el auditor necesita ver cómo va mientras evalúa, no al
// final.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from "lucide-react"
import {
  actualizarAuditoria,
  cerrarAuditoria,
  cerrarHallazgo,
  crearAuditoria,
  eliminarAuditoria,
  eliminarHallazgo,
  getResumenAuditoria,
  guardarHallazgo,
  guardarRespuesta,
  listarAuditorias,
  listarHallazgos,
  listarRespuestas,
} from "@/lib/auditoria-iso-actions"
import {
  ESTADOS_HALLAZGO,
  RESULTADOS,
  TIPOS_AUDITORIA,
  TIPOS_HALLAZGO,
  type Auditoria,
  type Hallazgo,
  type RespuestaAuditoria,
  type ResumenAuditoria,
} from "@/lib/auditoria-iso-tipos"

// El color dice de un vistazo qué pasó con cada requisito. Rojo solo para lo
// que incumple: una observación no es una no conformidad y teñirlas igual
// haría que el auditor deje de distinguirlas.
const COLOR_RESULTADO: Record<string, string> = {
  Pendiente: "bg-muted text-muted-foreground",
  Conforme: "bg-emerald-100 text-emerald-800 border-emerald-300",
  "No conforme": "bg-red-100 text-red-800 border-red-300",
  Observación: "bg-amber-100 text-amber-800 border-amber-300",
  "Oportunidad de mejora": "bg-sky-100 text-sky-800 border-sky-300",
  "No aplica": "bg-slate-100 text-slate-600 border-slate-300",
}

export default function AuditoriaISO() {
  const { selectedEmpresaId } = useAuth()
  const { toast } = useToast()
  const [auditorias, setAuditorias] = useState<Auditoria[]>([])
  const [cargando, setCargando] = useState(true)
  const [abierta, setAbierta] = useState<Auditoria | null>(null)
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await listarAuditorias(selectedEmpresaId ?? null)
    if (r.success) setAuditorias(r.data)
    else toast({ title: "No se pudo cargar", description: r.message, variant: "destructive" })
    setCargando(false)
  }, [selectedEmpresaId, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  if (abierta) {
    return (
      <DetalleAuditoria
        auditoria={abierta}
        onVolver={() => {
          setAbierta(null)
          cargar()
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Auditoría ISO 9001:2015</h2>
          <p className="text-xs text-muted-foreground">
            Planeación, checklist de los requisitos de la norma, hallazgos e informe.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreando(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nueva auditoría
        </Button>
      </div>

      {creando && (
        <FormularioAuditoria
          empresaId={selectedEmpresaId ?? null}
          onCancelar={() => setCreando(false)}
          onCreada={() => {
            setCreando(false)
            cargar()
          }}
        />
      )}

      {cargando ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : auditorias.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <ClipboardCheck className="h-9 w-9 text-muted-foreground/40" />
          <p className="text-sm font-medium">Todavía no hay auditorías</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Al crear una se prepara el checklist completo de ISO 9001:2015 con sus 28 requisitos,
            listos para evaluar.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left">Código</th>
                <th className="p-2 text-left">Fecha</th>
                <th className="p-2 text-left">Proceso / área</th>
                <th className="p-2 text-left">Auditor líder</th>
                <th className="p-2 text-left">Tipo</th>
                <th className="p-2 text-center">Estado</th>
                <th className="p-2 text-center">Acción</th>
              </tr>
            </thead>
            <tbody>
              {auditorias.map((a) => (
                <tr key={a.id} className="border-t hover:bg-muted/30">
                  <td className="p-2 font-mono">{a.codigo || `#${a.id}`}</td>
                  <td className="p-2">{a.fecha}</td>
                  <td className="p-2">{a.proceso || "—"}</td>
                  <td className="p-2">{a.auditor_lider || "—"}</td>
                  <td className="p-2">{a.tipo}</td>
                  <td className="p-2 text-center">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        a.estado === "cerrada"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : a.estado === "en_curso"
                            ? "border-sky-300 bg-sky-50 text-sky-800"
                            : ""
                      }`}
                    >
                      {a.estado === "en_curso" ? "En curso" : a.estado === "cerrada" ? "Cerrada" : "Borrador"}
                    </Badge>
                  </td>
                  <td className="p-2 text-center">
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setAbierta(a)}>
                      Abrir
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crear auditoría (la hoja DATOS_AUDITORIA)
// ---------------------------------------------------------------------------

function FormularioAuditoria({
  empresaId,
  onCancelar,
  onCreada,
}: {
  empresaId: number | null
  onCancelar: () => void
  onCreada: () => void
}) {
  const { toast } = useToast()
  const [guardando, setGuardando] = useState(false)
  const [f, setF] = useState({
    codigo: "",
    fecha: new Date().toISOString().slice(0, 10),
    organizacion: "",
    proceso: "",
    responsable_proceso: "",
    auditor_lider: "",
    equipo_auditor: "",
    tipo: "Interna",
    alcance: "",
    periodo_auditado: "",
  })

  async function crear() {
    if (!empresaId) {
      toast({ title: "Selecciona una empresa", variant: "destructive" })
      return
    }
    if (!f.proceso.trim()) {
      toast({ title: "Falta el proceso", description: "Indica qué proceso o área se audita." })
      return
    }
    setGuardando(true)
    const r = await crearAuditoria({ ...f, idempresa: empresaId })
    setGuardando(false)
    if (r.success) {
      toast({ title: "Auditoría creada", description: "El checklist quedó listo con los 28 requisitos." })
      onCreada()
    } else {
      toast({ title: "No se pudo crear", description: r.message, variant: "destructive" })
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <h3 className="text-sm font-semibold">Datos de la auditoría</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Código" value={f.codigo} onChange={(v) => setF({ ...f, codigo: v })} />
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Fecha</Label>
          <Input
            type="date"
            value={f.fecha}
            onChange={(e) => setF({ ...f, fecha: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Tipo</Label>
          <Select value={f.tipo} onValueChange={(v) => setF({ ...f, tipo: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_AUDITORIA.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Campo label="Organización" value={f.organizacion} onChange={(v) => setF({ ...f, organizacion: v })} />
        <Campo
          label="Proceso / área auditada *"
          value={f.proceso}
          onChange={(v) => setF({ ...f, proceso: v })}
        />
        <Campo
          label="Responsable del proceso"
          value={f.responsable_proceso}
          onChange={(v) => setF({ ...f, responsable_proceso: v })}
        />
        <Campo label="Auditor líder" value={f.auditor_lider} onChange={(v) => setF({ ...f, auditor_lider: v })} />
        <Campo
          label="Equipo auditor"
          value={f.equipo_auditor}
          onChange={(v) => setF({ ...f, equipo_auditor: v })}
        />
        <Campo
          label="Periodo auditado"
          value={f.periodo_auditado}
          onChange={(v) => setF({ ...f, periodo_auditado: v })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-[11px]">Alcance</Label>
        <Textarea
          value={f.alcance}
          onChange={(e) => setF({ ...f, alcance: e.target.value })}
          className="min-h-[60px] text-xs"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button size="sm" onClick={crear} disabled={guardando} className="gap-1.5">
          {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Crear auditoría
        </Button>
      </div>
    </div>
  )
}

function Campo({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px]">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// El detalle: tablero + checklist + hallazgos
// ---------------------------------------------------------------------------

function DetalleAuditoria({ auditoria, onVolver }: { auditoria: Auditoria; onVolver: () => void }) {
  const { toast } = useToast()
  const [vista, setVista] = useState<"checklist" | "hallazgos" | "informe">("checklist")
  const [respuestas, setRespuestas] = useState<RespuestaAuditoria[]>([])
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([])
  const [resumen, setResumen] = useState<ResumenAuditoria | null>(null)
  const [cargando, setCargando] = useState(true)
  const [aud, setAud] = useState(auditoria)

  const cerrada = aud.estado === "cerrada"

  const cargar = useCallback(async () => {
    setCargando(true)
    const [r, h, s] = await Promise.all([
      listarRespuestas(aud.id),
      listarHallazgos(aud.id),
      getResumenAuditoria(aud.id),
    ])
    if (r.success) setRespuestas(r.data)
    if (h.success) setHallazgos(h.data)
    if (s.success && s.data) setResumen(s.data)
    setCargando(false)
  }, [aud.id])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function cerrar() {
    const r = await cerrarAuditoria(aud.id)
    if (r.success) {
      toast({ title: "Auditoría cerrada" })
      setAud({ ...aud, estado: "cerrada" })
      cargar()
    } else {
      toast({ title: "No se puede cerrar", description: r.message, variant: "destructive" })
    }
  }

  async function reabrir() {
    const r = await actualizarAuditoria(aud.id, { estado: "en_curso" })
    if (r.success) {
      setAud({ ...aud, estado: "en_curso" })
      toast({ title: "Auditoría reabierta" })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onVolver} className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
          <div>
            <h2 className="text-base font-semibold">
              {aud.codigo || `Auditoría #${aud.id}`} · {aud.proceso || "Sin proceso"}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {aud.tipo} · {aud.fecha} · {aud.auditor_lider || "Sin auditor líder"}
            </p>
          </div>
        </div>
        {cerrada ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-800">
              <Lock className="h-3 w-3" />
              Cerrada
            </Badge>
            <Button variant="outline" size="sm" onClick={reabrir}>
              Reabrir
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={cerrar} className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            Cerrar auditoría
          </Button>
        )}
      </div>

      {resumen && <Tablero resumen={resumen} />}

      <div className="flex gap-1 border-b">
        {(
          [
            ["checklist", `Checklist (${respuestas.length})`],
            ["hallazgos", `Hallazgos (${hallazgos.length})`],
            ["informe", "Informe"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setVista(k)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              vista === k
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : vista === "checklist" ? (
        <Checklist respuestas={respuestas} cerrada={cerrada} onCambio={cargar} />
      ) : vista === "hallazgos" ? (
        <Hallazgos
          auditoriaId={aud.id}
          hallazgos={hallazgos}
          respuestas={respuestas}
          cerrada={cerrada}
          onCambio={cargar}
        />
      ) : (
        <Informe aud={aud} resumen={resumen} hallazgos={hallazgos} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// El tablero (la hoja DASHBOARD)
// ---------------------------------------------------------------------------

function Tablero({ resumen }: { resumen: ResumenAuditoria }) {
  const tarjetas = [
    { label: "Evaluados", valor: resumen.evaluados, color: "" },
    { label: "Conformes", valor: resumen.conformes, color: "text-emerald-700" },
    { label: "No conformes", valor: resumen.noConformes, color: "text-red-700" },
    { label: "Observaciones", valor: resumen.observaciones, color: "text-amber-700" },
    { label: "Oportunidades", valor: resumen.oportunidades, color: "text-sky-700" },
    { label: "No aplica", valor: resumen.noAplica, color: "text-slate-600" },
    { label: "Pendientes", valor: resumen.pendientes, color: "text-muted-foreground" },
  ]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {tarjetas.map((t) => (
          <div key={t.label} className="rounded-lg border bg-card p-2.5">
            <p className="text-[10px] text-muted-foreground">{t.label}</p>
            <p className={`text-xl font-bold tabular-nums ${t.color}`}>{t.valor}</p>
          </div>
        ))}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
          <p className="text-[10px] text-muted-foreground">Cumplimiento</p>
          <p className="text-xl font-bold tabular-nums">
            {resumen.cumplimiento === null ? "—" : `${resumen.cumplimiento}%`}
          </p>
        </div>
      </div>
      {/* La definición del indicador va a la vista: sin ella, un 60% se lee
          como "reprobado" cuando puede ser "aún sin evaluar". */}
      {/* La advertencia viene textual del Excel que origino el modulo: el
          indicador es interno y la metodologia debe validarse antes de
          presentarlo como KPI oficial. Sin ella, un 60% se lee como
          "reprobado" cuando puede ser "aun sin evaluar". */}
      <p className="text-[10px] text-muted-foreground">
        Cumplimiento = conformes ÷ (evaluados − no aplica). Los pendientes cuentan como aún no
        demostrados. <strong>Indicador interno:</strong> validar la metodología antes de usarlo como
        KPI oficial.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// El checklist (la hoja CHECKLIST)
// ---------------------------------------------------------------------------

function Checklist({
  respuestas,
  cerrada,
  onCambio,
}: {
  respuestas: RespuestaAuditoria[]
  cerrada: boolean
  onCambio: () => void
}) {
  const [filtro, setFiltro] = useState<string>("todos")
  const [expandido, setExpandido] = useState<number | null>(null)

  const filtradas = useMemo(
    () => (filtro === "todos" ? respuestas : respuestas.filter((r) => r.resultado === filtro)),
    [respuestas, filtro],
  )

  const capitulos = useMemo(() => {
    const m = new Map<number, RespuestaAuditoria[]>()
    for (const r of filtradas) {
      const c = r.requisito?.capitulo ?? 0
      m.set(c, [...(m.get(c) ?? []), r])
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [filtradas])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[11px] text-muted-foreground">Ver</Label>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los requisitos</SelectItem>
            {RESULTADOS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {cerrada && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" />
            La auditoría está cerrada: el checklist es solo de lectura.
          </span>
        )}
      </div>

      {capitulos.map(([cap, items]) => (
        <div key={cap} className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground">Capítulo {cap}</h4>
          {items.map((r) => (
            <FilaRequisito
              key={r.id}
              r={r}
              cerrada={cerrada}
              expandido={expandido === r.id}
              onExpandir={() => setExpandido(expandido === r.id ? null : r.id)}
              onCambio={onCambio}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function FilaRequisito({
  r,
  cerrada,
  expandido,
  onExpandir,
  onCambio,
}: {
  r: RespuestaAuditoria
  cerrada: boolean
  expandido: boolean
  onExpandir: () => void
  onCambio: () => void
}) {
  const { toast } = useToast()
  const [guardando, setGuardando] = useState(false)
  const [evidencia, setEvidencia] = useState(r.evidencia ?? "")
  const [documento, setDocumento] = useState(r.documento ?? "")
  const [comentario, setComentario] = useState(r.comentario ?? "")

  async function cambiarResultado(resultado: string) {
    setGuardando(true)
    const res = await guardarRespuesta(r.id, { resultado: resultado as any })
    setGuardando(false)
    if (res.success) onCambio()
    else toast({ title: "No se pudo guardar", description: res.message, variant: "destructive" })
  }

  async function guardarDetalle() {
    setGuardando(true)
    const res = await guardarRespuesta(r.id, { evidencia, documento, comentario })
    setGuardando(false)
    if (res.success) {
      toast({ title: "Guardado" })
      onCambio()
    } else {
      toast({ title: "No se pudo guardar", description: res.message, variant: "destructive" })
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start gap-2 p-2.5">
        <button onClick={onExpandir} className="min-w-0 flex-1 text-left">
          <p className="text-xs font-medium">{r.requisito?.requisito ?? r.requisito_codigo}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{r.requisito?.pregunta}</p>
        </button>
        <Select value={r.resultado} onValueChange={cambiarResultado} disabled={cerrada || guardando}>
          <SelectTrigger
            className={`h-7 w-[185px] shrink-0 border text-[11px] ${COLOR_RESULTADO[r.resultado] ?? ""}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESULTADOS.map((x) => (
              <SelectItem key={x} value={x}>
                {x}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {expandido && (
        <div className="space-y-2 border-t bg-muted/20 p-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Evidencia objetiva</Label>
              <Textarea
                value={evidencia}
                onChange={(e) => setEvidencia(e.target.value)}
                disabled={cerrada}
                className="min-h-[60px] text-xs"
                placeholder="Lo que se vio: registros revisados, personas entrevistadas…"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Documento / registro</Label>
              <Textarea
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                disabled={cerrada}
                className="min-h-[60px] text-xs"
                placeholder="Código y versión del documento revisado"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px]">Comentario del auditor</Label>
            <Textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              disabled={cerrada}
              className="min-h-[50px] text-xs"
            />
          </div>
          {!cerrada && (
            <div className="flex justify-end">
              <Button size="sm" className="h-7 text-xs" onClick={guardarDetalle} disabled={guardando}>
                {guardando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Guardar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Los hallazgos (la hoja HALLAZGOS)
// ---------------------------------------------------------------------------

function Hallazgos({
  auditoriaId,
  hallazgos,
  respuestas,
  cerrada,
  onCambio,
}: {
  auditoriaId: number
  hallazgos: Hallazgo[]
  respuestas: RespuestaAuditoria[]
  cerrada: boolean
  onCambio: () => void
}) {
  const { toast } = useToast()
  const [nuevo, setNuevo] = useState(false)

  async function borrar(id: number) {
    if (!window.confirm("¿Eliminar este hallazgo?")) return
    const r = await eliminarHallazgo(id)
    if (r.success) onCambio()
    else toast({ title: "No se pudo eliminar", description: r.message, variant: "destructive" })
  }

  return (
    <div className="space-y-3">
      {!cerrada && (
        <Button size="sm" variant="outline" onClick={() => setNuevo(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nuevo hallazgo
        </Button>
      )}

      {nuevo && (
        <FormularioHallazgo
          auditoriaId={auditoriaId}
          respuestas={respuestas}
          onCancelar={() => setNuevo(false)}
          onGuardado={() => {
            setNuevo(false)
            onCambio()
          }}
        />
      )}

      {hallazgos.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          Sin hallazgos registrados en esta auditoría.
        </p>
      ) : (
        hallazgos.map((h) => (
          <FilaHallazgo key={h.id} h={h} cerrada={cerrada} onCambio={onCambio} onBorrar={() => borrar(h.id)} />
        ))
      )}
    </div>
  )
}

function FilaHallazgo({
  h,
  cerrada,
  onCambio,
  onBorrar,
}: {
  h: Hallazgo
  cerrada: boolean
  onCambio: () => void
  onBorrar: () => void
}) {
  const { toast } = useToast()
  const [abierto, setAbierto] = useState(false)
  const [verificacion, setVerificacion] = useState(h.verificacion_eficacia ?? "")

  const vencido =
    h.estado !== "Cerrado" &&
    h.fecha_compromiso &&
    h.fecha_compromiso < new Date().toISOString().slice(0, 10)

  async function cerrarlo() {
    const r = await cerrarHallazgo(h.id, verificacion)
    if (r.success) {
      toast({ title: "Hallazgo cerrado" })
      onCambio()
    } else {
      toast({ title: "No se puede cerrar", description: r.message, variant: "destructive" })
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <button onClick={() => setAbierto(!abierto)} className="w-full p-2.5 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-semibold">{h.consecutivo}</span>
          <Badge
            variant="outline"
            className={`text-[10px] ${
              h.tipo === "No conformidad"
                ? "border-red-300 bg-red-50 text-red-800"
                : h.tipo === "Observación"
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-sky-300 bg-sky-50 text-sky-800"
            }`}
          >
            {h.tipo}
          </Badge>
          {h.requisito_codigo && (
            <span className="text-[10px] text-muted-foreground">{h.requisito_codigo}</span>
          )}
          <Badge variant="outline" className="text-[10px]">
            {h.estado}
          </Badge>
          {vencido && (
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <AlertTriangle className="h-3 w-3" />
              Vencido
            </Badge>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {h.responsable || "Sin responsable"}
            {h.fecha_compromiso ? ` · vence ${h.fecha_compromiso}` : ""}
          </span>
        </div>
        <p className="mt-1 text-xs">{h.descripcion}</p>
      </button>

      {abierto && (
        <div className="space-y-2 border-t bg-muted/20 p-2.5 text-xs">
          {h.evidencia && <Dato label="Evidencia" valor={h.evidencia} />}
          {h.correccion_inmediata && <Dato label="Corrección inmediata" valor={h.correccion_inmediata} />}
          {h.analisis_causa && <Dato label="Análisis de causa" valor={h.analisis_causa} />}
          {h.accion_correctiva && <Dato label="Acción correctiva" valor={h.accion_correctiva} />}
          {h.verificacion_eficacia && (
            <Dato label="Verificación de eficacia" valor={h.verificacion_eficacia} />
          )}

          {h.estado !== "Cerrado" && !cerrada && (
            <div className="space-y-1.5 rounded-lg border border-border bg-background p-2.5">
              <Label className="text-[11px]">Verificación de eficacia (para cerrar)</Label>
              <Textarea
                value={verificacion}
                onChange={(e) => setVerificacion(e.target.value)}
                className="min-h-[50px] text-xs"
                placeholder="Cómo se comprobó que la acción correctiva funcionó"
              />
              <p className="text-[10px] text-muted-foreground">
                ISO 9001 · 10.2 pide revisar la eficacia de la acción. Sin esto el hallazgo no cierra.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={onBorrar}>
                  <Trash2 className="mr-1 h-3 w-3" />
                  Eliminar
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={cerrarlo}>
                  Cerrar hallazgo
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap">{valor}</p>
    </div>
  )
}

function FormularioHallazgo({
  auditoriaId,
  respuestas,
  onCancelar,
  onGuardado,
}: {
  auditoriaId: number
  respuestas: RespuestaAuditoria[]
  onCancelar: () => void
  onGuardado: () => void
}) {
  const { toast } = useToast()
  const [guardando, setGuardando] = useState(false)
  const [f, setF] = useState({
    requisito_codigo: "",
    tipo: "No conformidad",
    descripcion: "",
    evidencia: "",
    criterio: "",
    correccion_inmediata: "",
    analisis_causa: "",
    accion_correctiva: "",
    responsable: "",
    fecha_compromiso: "",
  })

  async function guardar() {
    if (!f.descripcion.trim()) {
      toast({ title: "Falta la descripción", description: "Describe la condición encontrada." })
      return
    }
    setGuardando(true)
    const r = await guardarHallazgo({
      auditoria_id: auditoriaId,
      ...f,
      requisito_codigo: f.requisito_codigo || null,
      fecha_compromiso: f.fecha_compromiso || null,
    } as any)
    setGuardando(false)
    if (r.success) {
      toast({ title: "Hallazgo registrado" })
      onGuardado()
    } else {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <h3 className="text-sm font-semibold">Nuevo hallazgo</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Tipo</Label>
          <Select value={f.tipo} onValueChange={(v) => setF({ ...f, tipo: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_HALLAZGO.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Requisito ISO</Label>
          <Select
            value={f.requisito_codigo || "ninguno"}
            onValueChange={(v) => setF({ ...f, requisito_codigo: v === "ninguno" ? "" : v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="De qué requisito salió" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ninguno">Sin requisito concreto</SelectItem>
              {respuestas.map((r) => (
                <SelectItem key={r.requisito_codigo} value={r.requisito_codigo}>
                  {r.requisito?.requisito ?? r.requisito_codigo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <CampoLargo
        label="Condición encontrada *"
        value={f.descripcion}
        onChange={(v) => setF({ ...f, descripcion: v })}
        placeholder="Qué se encontró, de forma objetiva y verificable"
      />
      <CampoLargo label="Evidencia objetiva" value={f.evidencia} onChange={(v) => setF({ ...f, evidencia: v })} />
      <CampoLargo
        label="Corrección inmediata"
        value={f.correccion_inmediata}
        onChange={(v) => setF({ ...f, correccion_inmediata: v })}
        placeholder="Qué se hizo de inmediato para contener el problema"
      />
      <CampoLargo
        label="Análisis de causa"
        value={f.analisis_causa}
        onChange={(v) => setF({ ...f, analisis_causa: v })}
        placeholder="Por qué ocurrió (causa raíz, no el síntoma)"
      />
      <CampoLargo
        label="Acción correctiva"
        value={f.accion_correctiva}
        onChange={(v) => setF({ ...f, accion_correctiva: v })}
        placeholder="Qué se hará para que no vuelva a pasar"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Responsable" value={f.responsable} onChange={(v) => setF({ ...f, responsable: v })} />
        <div className="flex flex-col gap-1">
          <Label className="text-[11px]">Fecha compromiso</Label>
          <Input
            type="date"
            value={f.fecha_compromiso}
            onChange={(e) => setF({ ...f, fecha_compromiso: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button size="sm" onClick={guardar} disabled={guardando} className="gap-1.5">
          {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar hallazgo
        </Button>
      </div>
    </div>
  )
}

function CampoLargo({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px]">{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[55px] text-xs"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// El informe (la hoja INFORME)
// ---------------------------------------------------------------------------

function Informe({
  aud,
  resumen,
  hallazgos,
}: {
  aud: Auditoria
  resumen: ResumenAuditoria | null
  hallazgos: Hallazgo[]
}) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex items-center gap-2 border-b pb-3">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold">
            Informe de auditoría del Sistema de Gestión de la Calidad
          </h3>
          <p className="text-[11px] text-muted-foreground">ISO 9001:2015</p>
        </div>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <Linea label="Código" valor={aud.codigo} />
        <Linea label="Fecha" valor={aud.fecha} />
        <Linea label="Organización" valor={aud.organizacion} />
        <Linea label="Proceso / área" valor={aud.proceso} />
        <Linea label="Responsable" valor={aud.responsable_proceso} />
        <Linea label="Auditor líder" valor={aud.auditor_lider} />
        <Linea label="Equipo auditor" valor={aud.equipo_auditor} />
        <Linea label="Tipo de auditoría" valor={aud.tipo} />
        <Linea label="Periodo auditado" valor={aud.periodo_auditado} />
      </div>

      <div className="space-y-1 text-xs">
        <Linea label="Objetivo" valor={aud.objetivo} />
        <Linea label="Alcance" valor={aud.alcance} />
        <Linea label="Criterios" valor={aud.criterios} />
        <Linea label="Metodología" valor={aud.metodologia} />
      </div>

      {resumen && (
        <>
          <h4 className="border-t pt-3 text-xs font-semibold">Resumen de resultados</h4>
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            <Linea label="Requisitos evaluados" valor={String(resumen.evaluados)} />
            <Linea label="Conformes" valor={String(resumen.conformes)} />
            <Linea label="No conformidades" valor={String(resumen.noConformes)} />
            <Linea label="Observaciones" valor={String(resumen.observaciones)} />
            <Linea label="Oportunidades de mejora" valor={String(resumen.oportunidades)} />
            <Linea label="No aplica" valor={String(resumen.noAplica)} />
            <Linea label="Pendientes" valor={String(resumen.pendientes)} />
            <Linea
              label="Cumplimiento interno"
              valor={resumen.cumplimiento === null ? "—" : `${resumen.cumplimiento}%`}
            />
          </div>

          <h4 className="border-t pt-3 text-xs font-semibold">Por capítulo de la norma</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-1.5 text-left">Capítulo</th>
                  <th className="p-1.5 text-right">Evaluados</th>
                  <th className="p-1.5 text-right">Conformes</th>
                  <th className="p-1.5 text-right">No conformes</th>
                  <th className="p-1.5 text-right">Obs.</th>
                  <th className="p-1.5 text-right">OM</th>
                  <th className="p-1.5 text-right">Cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {resumen.porCapitulo.map((c) => (
                  <tr key={c.capitulo} className="border-t">
                    <td className="p-1.5">{c.capitulo}</td>
                    <td className="p-1.5 text-right tabular-nums">{c.evaluados}</td>
                    <td className="p-1.5 text-right tabular-nums">{c.conformes}</td>
                    <td className="p-1.5 text-right tabular-nums">{c.noConformes}</td>
                    <td className="p-1.5 text-right tabular-nums">{c.observaciones}</td>
                    <td className="p-1.5 text-right tabular-nums">{c.oportunidades}</td>
                    <td className="p-1.5 text-right tabular-nums">
                      {c.cumplimiento === null ? "—" : `${c.cumplimiento}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {hallazgos.length > 0 && (
        <>
          <h4 className="border-t pt-3 text-xs font-semibold">Hallazgos ({hallazgos.length})</h4>
          <div className="space-y-1.5">
            {hallazgos.map((h) => (
              <div key={h.id} className="rounded border p-2 text-[11px]">
                <span className="font-mono font-semibold">{h.consecutivo}</span>{" "}
                <span className="text-muted-foreground">
                  {h.tipo}
                  {h.requisito_codigo ? ` · ${h.requisito_codigo}` : ""} · {h.estado}
                </span>
                <p className="mt-0.5">{h.descripcion}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {aud.conclusiones && (
        <>
          <h4 className="border-t pt-3 text-xs font-semibold">Conclusiones</h4>
          <p className="whitespace-pre-wrap text-xs">{aud.conclusiones}</p>
        </>
      )}
    </div>
  )
}

function Linea({ label, valor }: { label: string; valor: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 font-medium text-muted-foreground">{label}:</span>
      <span>{valor || "—"}</span>
    </div>
  )
}
