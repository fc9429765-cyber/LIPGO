"use client"

// Recobro de Incapacidades (submódulo de Gestión Humana).
// Seguimiento del costo RECUPERABLE de las incapacidades y de las pérdidas
// cuando el recobro no se gestiona a tiempo. Centraliza además la hoja de
// COSTOS de incapacidades (pestaña Costos).
//
// Regla de negocio:
//   * EG (EPS): días 1-2 los asume la EMPRESA (no recobrable); del día 3 en
//     adelante la EPS reconoce el valor -> RECOBRABLE. Por eso una EG < 3 días
//     no genera recobro.
//   * AT (ARL): la ARL reconoce el 100% desde el día 1 -> RECOBRABLE total.
//   Valor recobrable = costos_eps (EG día 3+) + costos_arl (AT 100%); si no hay
//   costo cargado se calcula con días × salario/día (EG al 100%).
// Evidencia de gestión (candados de ciclo):
//   * RADICADO requiere adjuntar el CORREO enviado a la EPS/ARL.
//   * RECOBRADO (cierre) requiere adjuntar el COMPROBANTE DE PAGO.
// Manda el SELECTOR GLOBAL + filtros propios (año, mes, tipo, estado de recobro).

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts"
import {
  Loader2,
  HandCoins,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Building2,
  Percent,
  Save,
  Mail,
  Receipt,
  Paperclip,
  ExternalLink,
  Upload,
  Settings2,
  FileWarning,
  FileCheck2,
} from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import { SST_TOKENS } from "@/components/sst/sst-utils"
import { SigHeader, SigKpi, SigSection, SigFilterBar, SigField, sigControl } from "@/components/sst/sig-ui"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { getAusentismos, type Ausentismo } from "@/lib/ausentismos-actions"
import { esCategoriaMedica } from "@/lib/ausentismo-categorias"
import { valorizarIncapacidad } from "@/lib/incapacidad-valor"
import { actualizarRecobro } from "@/lib/recobros-actions"
import { ESTADOS_RECOBRO, type EstadoRecobro } from "@/lib/recobros"
import { AusentismosCostos } from "@/components/rrhh/ausentismos-dashboards"
import { subirSoporteRecobro } from "@/lib/subir-soporte-recobro"

// ---- helpers ------------------------------------------------------------
const num = (v: number | null | undefined) => (typeof v === "number" && !Number.isNaN(v) ? v : 0)
const fmtCOP = (v: number) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v || 0)

// Colores de estado (semáforo del recobro).
const C_RECOBRADO = "#16a34a"
const C_PENDIENTE = "#f59e0b"
const C_RIESGO = "#dc2626"
const C_EPS = "#2563eb"
const C_ARL = "#f97316"
const C_SLATE = "#64748b"

const COLOR_ESTADO: Record<string, string> = {
  PENDIENTE: C_PENDIENTE,
  RADICADO: "#0d9488",
  RECOBRADO: C_RECOBRADO,
  GLOSADO: C_RIESGO,
  PERDIDO: "#7f1d1d",
  NO_APLICA: C_SLATE,
}

const MES_ORDER = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]
const mesIndex = (m?: string | null) => {
  const i = MES_ORDER.indexOf((m || "").trim().toLowerCase())
  return i === -1 ? 99 : i
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

interface RecobroCalc {
  esAT: boolean
  entidad: "EPS" | "ARL"
  dias: number
  diasRecobrables: number
  recobrable: number // lo que debe devolver la EPS/ARL
  empresa: number // lo que la empresa asume sí o sí (no recobrable)
  aplica: boolean // ¿genera recobro?
  estado: EstadoRecobro | "NO_APLICA"
  recuperado: number // valor ya recobrado
}

function calcRecobro(a: Ausentismo): RecobroCalc {
  // Valorización compartida (días × valor día; EG al 100% con días 1-2 a cargo de la
  // empresa, AT 100% todos los días). getAusentismos completa el valor día por año.
  const v = valorizarIncapacidad(a)
  const estadoStored = (a.estado_recobro as EstadoRecobro) || "PENDIENTE"

  if (v.esAT) {
    const aplica = v.recobrable > 0
    const recuperado = num(a.valor_recobrado) || (estadoStored === "RECOBRADO" ? v.recobrable : 0)
    return {
      esAT: true, entidad: "ARL", dias: v.dias, diasRecobrables: v.dias, recobrable: v.recobrable, empresa: 0,
      aplica, estado: aplica ? estadoStored : "NO_APLICA", recuperado: aplica ? recuperado : 0,
    }
  }

  const aplica = v.diasRecobrables > 0 && v.recobrable > 0
  const recuperado = num(a.valor_recobrado) || (estadoStored === "RECOBRADO" ? v.recobrable : 0)
  return {
    esAT: false, entidad: "EPS", dias: v.dias, diasRecobrables: v.diasRecobrables, recobrable: v.recobrable, empresa: v.empresa,
    aplica, estado: aplica ? estadoStored : "NO_APLICA", recuperado: aplica ? recuperado : 0,
  }
}

// Estado editable del diálogo de gestión.
interface GestionForm {
  estado_recobro: EstadoRecobro
  valor_recobrado: string
  fecha_radicado_recobro: string
  obs_recobro: string
  soporte_radicado_url: string
  soporte_pago_url: string
}

export default function RecobroIncapacidades() {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const { toast } = useToast()

  const [items, setItems] = useState<Ausentismo[]>([])
  const [loading, setLoading] = useState(true)
  const [anio, setAnio] = useState<string>("todos")
  const [mes, setMes] = useState<string>("todos")
  const [tipo, setTipo] = useState<"todos" | "EG" | "AT">("todos")
  const [estadoF, setEstadoF] = useState<string>("todos")

  // Diálogo de gestión del recobro.
  const [gestion, setGestion] = useState<Ausentismo | null>(null)
  const [gForm, setGForm] = useState<GestionForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<"radicado" | "pago" | null>(null)
  const fileRadicado = useRef<HTMLInputElement>(null)
  const filePago = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      setItems(await getAusentismos(selectedEmpresaId))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const anioDe = (a: Ausentismo) => (a.fecha_inicial || a.created_at || "").slice(0, 4)

  const anios = useMemo(
    () => Array.from(new Set(items.map(anioDe).filter(Boolean))).sort((a, b) => b.localeCompare(a)),
    [items],
  )
  const meses = useMemo(
    () =>
      Array.from(new Set(items.map((a) => (a.mes || "").trim().toLowerCase()).filter(Boolean))).sort(
        (a, b) => mesIndex(a) - mesIndex(b),
      ),
    [items],
  )

  // Borradores del puente (médicos) aún por completar: NO entran al recobro hasta
  // validarse, pero se avisan para que el analista los complete en Ausentismos.
  const borradoresPendientes = useMemo(
    () => items.filter((a) => a.estado_registro === "BORRADOR" && (!a.categoria || esCategoriaMedica(a.categoria))).length,
    [items],
  )

  const filtered = useMemo(
    () =>
      items.filter((a) => {
        // El recobro SOLO aplica a incapacidades MÉDICAS (EG/AT) validadas: se
        // excluyen los borradores del puente y las ausencias no médicas (licencias).
        if (a.estado_registro === "BORRADOR") return false
        if (a.categoria && !esCategoriaMedica(a.categoria)) return false
        if (anio !== "todos" && anioDe(a) !== anio) return false
        if (mes !== "todos" && (a.mes || "").trim().toLowerCase() !== mes) return false
        if (tipo !== "todos" && a.tipo_evento !== tipo) return false
        if (estadoF !== "todos") {
          const c = calcRecobro(a)
          if (c.estado !== estadoF) return false
        }
        return true
      }),
    [items, anio, mes, tipo, estadoF],
  )

  const data = useMemo(() => {
    const calcs = filtered.map((a) => ({ a, c: calcRecobro(a) }))
    const conRecobro = calcs.filter(({ c }) => c.aplica)

    const recobrableTotal = conRecobro.reduce((s, { c }) => s + c.recobrable, 0)
    const recuperadoTotal = conRecobro.reduce((s, { c }) => s + c.recuperado, 0)
    const pendienteTotal = conRecobro
      .filter(({ c }) => c.estado === "PENDIENTE" || c.estado === "RADICADO")
      .reduce((s, { c }) => s + (c.recobrable - c.recuperado), 0)
    const riesgoTotal = conRecobro
      .filter(({ c }) => c.estado === "GLOSADO" || c.estado === "PERDIDO")
      .reduce((s, { c }) => s + (c.recobrable - c.recuperado), 0)
    const empresaNoRecobrable = calcs.reduce((s, { c }) => s + c.empresa, 0)
    const pctRecuperacion = recobrableTotal ? (recuperadoTotal / recobrableTotal) * 100 : 0

    let recEps = 0
    let recArl = 0
    for (const { c } of conRecobro) {
      if (c.entidad === "ARL") recArl += c.recobrable
      else recEps += c.recobrable
    }
    const porEntidad = [
      { name: "EPS (EG)", value: recEps, fill: C_EPS },
      { name: "ARL (AT)", value: recArl, fill: C_ARL },
    ].filter((d) => d.value > 0)

    const mesMap = new Map<string, { recuperado: number; pendiente: number; riesgo: number }>()
    for (const { a, c } of conRecobro) {
      const key = a.mes?.trim() || "Sin mes"
      const cur = mesMap.get(key) || { recuperado: 0, pendiente: 0, riesgo: 0 }
      cur.recuperado += c.recuperado
      if (c.estado === "GLOSADO" || c.estado === "PERDIDO") cur.riesgo += c.recobrable - c.recuperado
      else cur.pendiente += c.recobrable - c.recuperado
      mesMap.set(key, cur)
    }
    const porMes = Array.from(mesMap.entries())
      .map(([m, v]) => ({ mes: m, ...v }))
      .sort((x, y) => mesIndex(x.mes) - mesIndex(y.mes))

    const estMap = new Map<string, { casos: number; valor: number }>()
    for (const { c } of conRecobro) {
      const cur = estMap.get(c.estado) || { casos: 0, valor: 0 }
      cur.casos += 1
      cur.valor += c.recobrable
      estMap.set(c.estado, cur)
    }
    const porEstado = Array.from(estMap.entries()).map(([estado, v]) => ({ estado, ...v }))

    return {
      calcs, recobrableTotal, recuperadoTotal, pendienteTotal, riesgoTotal,
      empresaNoRecobrable, pctRecuperacion, porEntidad, porMes, porEstado,
    }
  }, [filtered])

  // --- Diálogo de gestión -------------------------------------------------
  const abrirGestion = (a: Ausentismo) => {
    setGestion(a)
    setGForm({
      estado_recobro: (a.estado_recobro as EstadoRecobro) || "PENDIENTE",
      valor_recobrado: a.valor_recobrado != null ? String(a.valor_recobrado) : "",
      fecha_radicado_recobro: a.fecha_radicado_recobro || "",
      obs_recobro: a.obs_recobro || "",
      soporte_radicado_url: a.soporte_radicado_url || "",
      soporte_pago_url: a.soporte_pago_url || "",
    })
  }
  const cerrarGestion = () => {
    setGestion(null)
    setGForm(null)
  }

  const subirSoporte = async (file: File, tipoSoporte: "radicado" | "pago") => {
    if (!gestion || !gForm) return
    setUploading(tipoSoporte)
    try {
      // Mismo camino que el soporte clínico en Ausentismos: URL firmada y el
      // archivo directo a Supabase, sin pasar por la función serverless.
      const subida = await subirSoporteRecobro(file, { id: gestion.id, tipo: tipoSoporte })
      if (subida.success && subida.url) {
        setGForm((f) =>
          f ? { ...f, [tipoSoporte === "radicado" ? "soporte_radicado_url" : "soporte_pago_url"]: subida.url! } : f,
        )
        toast({ title: tipoSoporte === "radicado" ? "Correo adjuntado" : "Comprobante adjuntado" })
      } else {
        toast({
          title: "Error al subir",
          description: subida.error || "No se pudo subir el archivo.",
          variant: "destructive",
        })
      }
    } catch (e: any) {
      toast({ title: "Error al subir", description: e?.message || "Fallo de red." })
    } finally {
      setUploading(null)
    }
  }

  const guardarGestion = async () => {
    if (!gestion || !gForm) return
    // Candados de ciclo: la evidencia respalda la gestión.
    if (gForm.estado_recobro === "RADICADO" && !gForm.soporte_radicado_url) {
      toast({ title: "Falta el correo a la EPS/ARL", description: "Adjunta el correo enviado para marcar RADICADO." })
      return
    }
    if (gForm.estado_recobro === "RECOBRADO" && !gForm.soporte_pago_url) {
      toast({ title: "Falta el comprobante de pago", description: "Adjunta el pago de la incapacidad para cerrar como RECOBRADO." })
      return
    }
    setSaving(true)
    const r = await actualizarRecobro(gestion.id, {
      estado_recobro: gForm.estado_recobro,
      valor_recobrado: gForm.valor_recobrado ? Number(gForm.valor_recobrado) : 0,
      fecha_radicado_recobro: gForm.fecha_radicado_recobro || null,
      obs_recobro: gForm.obs_recobro || null,
      soporte_radicado_url: gForm.soporte_radicado_url || null,
      soporte_pago_url: gForm.soporte_pago_url || null,
    })
    setSaving(false)
    if (r.success) {
      toast({ title: "Recobro actualizado" })
      const patch = {
        estado_recobro: gForm.estado_recobro,
        valor_recobrado: gForm.valor_recobrado ? Number(gForm.valor_recobrado) : 0,
        fecha_radicado_recobro: gForm.fecha_radicado_recobro || null,
        obs_recobro: gForm.obs_recobro || null,
        soporte_radicado_url: gForm.soporte_radicado_url || null,
        soporte_pago_url: gForm.soporte_pago_url || null,
      }
      setItems((arr) => arr.map((x) => (x.id === gestion.id ? { ...x, ...patch } : x)))
      cerrarGestion()
    } else {
      toast({ title: "Error", description: r.message || "No se pudo guardar." })
    }
  }

  const gCalc = gestion ? calcRecobro(gestion) : null

  return (
    <div className="space-y-4">
      <SigHeader
        title="Recobro de Incapacidades"
        subtitle="Costo recuperable ante EPS (EG > 2 días) y ARL (AT 100%). Gestión de recobro con soportes y centro de costos de incapacidades."
        Icon={HandCoins}
      />

      {/* Filtros (aplican a Recobro y a Costos) */}
      <SigFilterBar cliente={selectedEmpresaNombre}>
        <SigField label="Año">
          <select className={sigControl} value={anio} onChange={(e) => setAnio(e.target.value)}>
            <option value="todos">Todos</option>
            {anios.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </SigField>
        <SigField label="Mes">
          <select className={sigControl} value={mes} onChange={(e) => setMes(e.target.value)}>
            <option value="todos">Todos</option>
            {meses.map((m) => (
              <option key={m} value={m}>{cap(m)}</option>
            ))}
          </select>
        </SigField>
        <SigField label="Tipo">
          <select className={sigControl} value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
            <option value="todos">Todos</option>
            <option value="EG">EG (EPS)</option>
            <option value="AT">AT (ARL)</option>
          </select>
        </SigField>
        <SigField label="Estado recobro">
          <select className={sigControl} value={estadoF} onChange={(e) => setEstadoF(e.target.value)}>
            <option value="todos">Todos</option>
            {ESTADOS_RECOBRO.map((s) => (
              <option key={s} value={s}>{cap(s)}</option>
            ))}
            <option value="NO_APLICA">No aplica (EG ≤ 2 días)</option>
          </select>
        </SigField>
      </SigFilterBar>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: SST_TOKENS.navy }} />
        </div>
      ) : (
        <Tabs defaultValue="recobro" className="space-y-4">
          <TabsList>
            <TabsTrigger value="recobro" className="gap-2">
              <HandCoins className="h-4 w-4" />
              Recobro
            </TabsTrigger>
            <TabsTrigger value="costos" className="gap-2">
              <Receipt className="h-4 w-4" />
              Costos de incapacidades
            </TabsTrigger>
          </TabsList>

          {/* ---------------- Pestaña Recobro ---------------- */}
          <TabsContent value="recobro" className="space-y-4">
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <SigKpi label="Recobrable total" value={fmtCOP(data.recobrableTotal)} Icon={HandCoins} accent={SST_TOKENS.navy} />
              <SigKpi label="Recobrado" value={fmtCOP(data.recuperadoTotal)} Icon={ShieldCheck} accent={C_RECOBRADO} valueColor={C_RECOBRADO} />
              <SigKpi label="Pendiente por recobrar" value={fmtCOP(data.pendienteTotal)} Icon={Clock} accent={C_PENDIENTE} valueColor={C_PENDIENTE} />
              <SigKpi label="En riesgo / pérdida" value={fmtCOP(data.riesgoTotal)} Icon={AlertTriangle} accent={C_RIESGO} valueColor={data.riesgoTotal > 0 ? C_RIESGO : undefined} sub="Glosado + perdido" />
              <SigKpi label="% recuperación" value={data.pctRecuperacion.toFixed(1)} unit="%" Icon={Percent} accent={SST_TOKENS.teal} />
              <SigKpi label="Costo empresa (no recobrable)" value={fmtCOP(data.empresaNoRecobrable)} Icon={Building2} accent={C_SLATE} sub="EG días 1-2" />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <SigSection title="Recobrable por entidad" />
                <div className="mt-2">
                  {data.porEntidad.length === 0 ? (
                    <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">Sin datos</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie data={data.porEntidad} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                          {data.porEntidad.map((e, i) => (
                            <Cell key={i} fill={e.fill} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [fmtCOP(v)]} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>

              <Card className="p-4">
                <SigSection title="Recobro por mes (recuperado / pendiente / riesgo)" />
                <div className="mt-2">
                  {data.porMes.length === 0 ? (
                    <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">Sin datos</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={data.porMes}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                        <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} />
                        <Tooltip formatter={(v: number, n) => [fmtCOP(v), n === "recuperado" ? "Recuperado" : n === "pendiente" ? "Pendiente" : "Riesgo"]} />
                        <Legend />
                        <Bar dataKey="recuperado" name="Recuperado" stackId="r" fill={C_RECOBRADO} />
                        <Bar dataKey="pendiente" name="Pendiente" stackId="r" fill={C_PENDIENTE} />
                        <Bar dataKey="riesgo" name="Riesgo" stackId="r" fill={C_RIESGO} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>

              <Card className="p-4 lg:col-span-2">
                <SigSection title="Recobrable por estado de gestión" />
                <div className="mt-2">
                  {data.porEstado.length === 0 ? (
                    <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">Sin datos</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={data.porEstado} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} />
                        <YAxis type="category" dataKey="estado" width={90} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number, _n, p: any) => [fmtCOP(v), `${p?.payload?.casos ?? 0} casos`]} />
                        <Bar dataKey="valor" name="Recobrable" radius={[0, 4, 4, 0]}>
                          {data.porEstado.map((e, i) => (
                            <Cell key={i} fill={COLOR_ESTADO[e.estado] ?? C_SLATE} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>
            </div>

            {/* Aviso: borradores del puente por completar (no entran al recobro aún). */}
            {borradoresPendientes > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                <FileWarning className="h-4 w-4 shrink-0" />
                <span>
                  {borradoresPendientes} {borradoresPendientes === 1 ? "incapacidad" : "incapacidades"} en{" "}
                  <strong>borrador</strong> por completar en el módulo de Ausentismos (diagnóstico + soporte); aún no
                  entran al recobro.
                </span>
              </div>
            )}

            {/* Tabla de gestión del recobro */}
            <Card className="p-4">
              <SigSection title="Gestión del recobro caso a caso" right={<span className="text-xs text-muted-foreground">{data.calcs.length} registros</span>} />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left lg-eyebrow">
                      <th className="px-2 py-2">Colaborador</th>
                      <th className="px-2 py-2">Mes</th>
                      <th className="px-2 py-2">Tipo</th>
                      <th className="px-2 py-2 text-right">Días</th>
                      <th className="px-2 py-2 text-right">Recobrable</th>
                      <th className="px-2 py-2">Estado</th>
                      <th className="px-2 py-2 text-center">Soportes</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.calcs.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-muted-foreground">
                          No hay incapacidades con los filtros actuales.
                        </td>
                      </tr>
                    ) : (
                      data.calcs.map(({ a, c }) => (
                        <tr key={a.id} className="border-b last:border-0 align-middle">
                          <td className="px-2 py-2">
                            <div className="font-medium" style={{ color: SST_TOKENS.ink }}>{a.nombre_colaborador}</div>
                            <div className="text-[11px] text-muted-foreground">{a.centro_trabajo || "—"}</div>
                          </td>
                          <td className="px-2 py-2 capitalize">{a.mes || "—"}</td>
                          <td className="px-2 py-2">
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: c.esAT ? C_ARL : C_EPS }}>
                              {a.tipo_evento} · {c.entidad}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right">{c.dias}</td>
                          <td className="px-2 py-2 text-right font-semibold" style={{ color: c.aplica ? SST_TOKENS.navy : C_SLATE }}>
                            {c.aplica ? fmtCOP(c.recobrable) : "No aplica"}
                          </td>
                          <td className="px-2 py-2">
                            {c.aplica ? (
                              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: COLOR_ESTADO[c.estado] ?? C_SLATE }}>
                                {cap(c.estado)}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-center gap-2">
                              <Mail className="h-4 w-4" style={{ color: a.soporte_radicado_url ? C_RECOBRADO : "#cbd5e1" }} aria-label="Correo EPS/ARL" />
                              <Receipt className="h-4 w-4" style={{ color: a.soporte_pago_url ? C_RECOBRADO : "#cbd5e1" }} aria-label="Comprobante de pago" />
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right">
                            {c.aplica ? (
                              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => abrirGestion(a)}>
                                <Settings2 className="h-4 w-4" /> Gestionar
                              </Button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">Sin recobro</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ---------------- Pestaña Costos ---------------- */}
          <TabsContent value="costos">
            <AusentismosCostos items={filtered} />
          </TabsContent>
        </Tabs>
      )}

      {/* ---------------- Diálogo: Gestionar recobro ---------------- */}
      <Dialog open={!!gestion} onOpenChange={(o) => !o && cerrarGestion()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5" style={{ color: SST_TOKENS.navy }} />
              Gestionar recobro
            </DialogTitle>
          </DialogHeader>

          {gestion && gForm && gCalc && (
            <div className="space-y-4">
              {/* Resumen del caso */}
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="font-medium" style={{ color: SST_TOKENS.ink }}>{gestion.nombre_colaborador}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{gestion.tipo_evento} · {gCalc.entidad}</span>
                  <span>{gCalc.dias} días ({gCalc.diasRecobrables} recobrables)</span>
                  <span className="font-semibold" style={{ color: SST_TOKENS.navy }}>Recobrable: {fmtCOP(gCalc.recobrable)}</span>
                </div>
              </div>

              {/* Estado + valores */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Estado del recobro</Label>
                  <select
                    className={`${sigControl} w-full`}
                    value={gForm.estado_recobro}
                    onChange={(e) => setGForm({ ...gForm, estado_recobro: e.target.value as EstadoRecobro })}
                  >
                    {ESTADOS_RECOBRO.map((s) => (
                      <option key={s} value={s}>{cap(s)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vr">Valor recobrado</Label>
                  <Input id="vr" type="number" value={gForm.valor_recobrado} onChange={(e) => setGForm({ ...gForm, valor_recobrado: e.target.value })} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="fr">Fecha de radicación</Label>
                  <DatePickerField id="fr" value={gForm.fecha_radicado_recobro} onChange={(value) => setGForm({ ...gForm, fecha_radicado_recobro: value })} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="obs">Observación (glosa, nota)</Label>
                  <Textarea id="obs" rows={2} value={gForm.obs_recobro} onChange={(e) => setGForm({ ...gForm, obs_recobro: e.target.value })} />
                </div>
              </div>

              {/* Soportes de gestión */}
              <div className="space-y-2">
                <SigSection title="Soportes de gestión" />

                {/* 1er eslabón: soporte clínico de la incapacidad (se carga en
                    Ausentismos). Aquí es de solo lectura, encabeza la cadena. */}
                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <FileCheck2 className="h-4 w-4" style={{ color: gestion?.soporte_incapacidad_url ? C_RECOBRADO : "#cbd5e1" }} />
                    <div>
                      <div className="font-medium" style={{ color: SST_TOKENS.ink }}>Soporte de la incapacidad</div>
                      <div className="text-[11px] text-muted-foreground">Documento clínico (se adjunta en Ausentismos)</div>
                    </div>
                  </div>
                  {gestion?.soporte_incapacidad_url ? (
                    <a
                      href={gestion.soporte_incapacidad_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-green-700 underline"
                    >
                      <ExternalLink className="h-4 w-4" /> Ver
                    </a>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Sin soporte</span>
                  )}
                </div>

                {/* Correo a EPS/ARL (requisito para RADICADO) */}
                <SoporteRow
                  icon={Mail}
                  titulo="Correo enviado a la EPS/ARL"
                  hint="Requisito para marcar RADICADO"
                  url={gForm.soporte_radicado_url}
                  uploading={uploading === "radicado"}
                  onPick={() => fileRadicado.current?.click()}
                />
                <input
                  ref={fileRadicado}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.eml,.msg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) subirSoporte(f, "radicado")
                    e.target.value = ""
                  }}
                />

                {/* Comprobante de pago (requisito para RECOBRADO) */}
                <SoporteRow
                  icon={Receipt}
                  titulo="Comprobante de pago de la incapacidad"
                  hint="Requisito para cerrar como RECOBRADO"
                  url={gForm.soporte_pago_url}
                  uploading={uploading === "pago"}
                  onPick={() => filePago.current?.click()}
                />
                <input
                  ref={filePago}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) subirSoporte(f, "pago")
                    e.target.value = ""
                  }}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={cerrarGestion} disabled={saving}>Cancelar</Button>
            <Button onClick={guardarGestion} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Fila de soporte: estado del adjunto + acción subir/ver/reemplazar.
function SoporteRow({
  icon: Icon,
  titulo,
  hint,
  url,
  uploading,
  onPick,
}: {
  icon: any
  titulo: string
  hint: string
  url: string
  uploading: boolean
  onPick: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-2.5">
      <Icon className="h-5 w-5 shrink-0" style={{ color: url ? "#16a34a" : SST_TOKENS.navy }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" style={{ color: SST_TOKENS.ink }}>{titulo}</div>
        <div className="text-[11px] text-muted-foreground">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-600 hover:underline">
              <Paperclip className="h-3 w-3" /> Ver adjunto <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            hint
          )}
        </div>
      </div>
      <Button size="sm" variant={url ? "ghost" : "outline"} className="gap-1.5" disabled={uploading} onClick={onPick}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {url ? "Reemplazar" : "Subir"}
      </Button>
    </div>
  )
}
