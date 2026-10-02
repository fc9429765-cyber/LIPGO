"use client"

// Modulo SIG: Matriz Integrada de Gestion (ISO 9001 / 14001 / 45001).
// - Pestana "Matriz Integrada": numeral x 3 normas, con evidencia comun.
// - Una pestana por norma: solo lo que aplica + como evidenciar.
// - Tablero de avance (% por norma) para el auditor.
// - Cobertura documental: el mismo soporte (a nivel de numeral) sirve a varias
//   normas (documento compartido); el estado por norma alimenta el tablero.

import { Fragment, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { SoportesDocumentales } from "@/components/sst/soportes-documentales"
import { SST_TOKENS, colorPct, CICLO_COLOR, CICLO_LABEL } from "@/components/sst/sst-utils"
import { SigHeader } from "@/components/sst/sig-ui"
import type { CicloPHVA } from "@/lib/sst-types"
import {
  getMatrizIntegrada,
  upsertCobertura,
  getDocumentos,
  vincularDocumentoAObjetivos,
  eliminarCobertura,
  getAvance0312,
  getModulosDeRequisito,
  getTablasModuloPermitidas,
  vincularModuloARequisito,
  desvincularModuloDeRequisito,
  actualizarPesoRequisitoNorma,
} from "@/lib/sig-actions"
import { groups } from "@/lib/dashboard-data"
import type {
  SigNorma,
  SigMatrizRow,
  SigCeldaNorma,
  SigEstadoCobertura,
  SigEsComun,
  SigDocumento,
  SigModuloCobertura,
} from "@/lib/sig-types"
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  MinusCircle,
  UploadCloud,
  ShieldCheck,
  Link as LinkIcon,
  Link2,
  ExternalLink,
  Boxes,
  FileText,
  X,
  Search,
} from "lucide-react"

interface Props {
  selectedEmpresaId?: number | null
}

const MODULO = "Matriz Integrada SIG"

// Cada pestana de norma se gatea por su permiso (acceso por responsabilidad).
// Estos nombres coinciden con MODULE_PERMISSION_MAP en lib/permissions-map.ts.
const NORMA_MODULO: Record<string, string> = {
  ISO9001: "SIG · ISO 9001",
  ISO14001: "SIG · ISO 14001",
  ISO45001: "SIG · ISO 45001",
}

const COMUN_LABEL: Record<SigEsComun, string> = { si: "Común", parcial: "Parcial", no: "Específico" }
const COMUN_COLOR: Record<SigEsComun, string> = {
  si: SST_TOKENS.ok,
  parcial: SST_TOKENS.warn,
  no: "#8896a5",
}

const ESTADO_META: Record<SigEstadoCobertura, { label: string; color: string; Icon: any }> = {
  aprobado: { label: "Aprobado", color: SST_TOKENS.ok, Icon: CheckCircle2 },
  cargado: { label: "Cargado", color: SST_TOKENS.teal, Icon: UploadCloud },
  pendiente: { label: "Pendiente", color: SST_TOKENS.warn, Icon: Clock },
  no_aplica: { label: "No aplica", color: "#8896a5", Icon: MinusCircle },
}

// Ciclo PHVA segun el capitulo del numeral (Anexo SL): Planear 4-6, Hacer 7-8,
// Verificar 9, Actuar 10. Estructura la matriz como la mejora continua.
function cicloDeNumeral(numeral: string): CicloPHVA {
  const cap = parseInt(numeral, 10)
  if (cap <= 6) return "PLANEAR"
  if (cap <= 8) return "HACER"
  if (cap === 9) return "VERIFICAR"
  return "ACTUAR"
}

// Fila-encabezado de ciclo PHVA para agrupar la tabla.
function CicloHeader({ ciclo, colSpan }: { ciclo: CicloPHVA; colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white"
        style={{ background: CICLO_COLOR[ciclo] }}
      >
        {CICLO_LABEL[ciclo]}
      </td>
    </tr>
  )
}

// Valoracion del SG-SST 0312 segun Res. 0312/2019 Art. 28 (Min. Trabajo):
// > 85% Aceptable · 60-85% Moderadamente Aceptable · < 60% Critico.
function valoracion0312(pct: number): { label: string; color: string } {
  if (pct > 85) return { label: "Aceptable", color: SST_TOKENS.ok }
  if (pct >= 60) return { label: "Moderadamente aceptable", color: SST_TOKENS.warn }
  return { label: "Crítico", color: SST_TOKENS.bad }
}

function EstadoBadge({ estado }: { estado: SigEstadoCobertura }) {
  const m = ESTADO_META[estado]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${m.color}1a`, color: m.color }}
    >
      <m.Icon className="h-3 w-3" />
      {m.label}
    </span>
  )
}

export function MatrizIntegradaSIG({ selectedEmpresaId: propEmpresaId }: Props) {
  const { selectedEmpresaId: ctxEmpresaId, selectedEmpresaNombre } = useAuth()
  const empresaId = propEmpresaId ?? ctxEmpresaId
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [normas, setNormas] = useState<SigNorma[]>([])
  const [rows, setRows] = useState<SigMatrizRow[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  // Codigos de norma que el usuario puede ver (null = aun cargando permisos).
  const [normasPermitidas, setNormasPermitidas] = useState<string[] | null>(null)
  // Avance global del SG-SST 0312 (referencia para ISO 45001).
  const [avance0312, setAvance0312] = useState<number | null>(null)

  async function cargar() {
    setLoading(true)
    const res = await getMatrizIntegrada(empresaId)
    if (res.success) {
      setNormas(res.normas)
      setRows(res.rows)
    } else {
      toast({ title: "No se pudo cargar la matriz", description: res.error })
    }
    // Referencia 0312 (no bloquea la carga de la matriz si falla).
    getAvance0312(empresaId)
      .then((r) => setAvance0312(r.success ? r.pct : null))
      .catch(() => setAvance0312(null))
    setLoading(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  // Resuelve que pestanas de norma puede ver el usuario (permiso por norma).
  useEffect(() => {
    if (!normas.length) return
    let active = true
    Promise.all(
      normas.map(async (n) => {
        const moduleName = NORMA_MODULO[n.codigo]
        if (!moduleName) return n.codigo
        try {
          const r = await fetch("/api/check-permission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ moduleName }),
          })
          const d = await r.json()
          return d?.hasPermission ? n.codigo : null
        } catch {
          return null
        }
      }),
    ).then((res) => {
      if (active) setNormasPermitidas(res.filter(Boolean) as string[])
    })
    return () => {
      active = false
    }
  }, [normas])

  // Normas cuyas pestanas individuales se muestran (segun permiso).
  const normasVisibles = useMemo(
    () => normas.filter((n) => normasPermitidas?.includes(n.codigo)),
    [normas, normasPermitidas],
  )

  // Requisitos comunes (la 2a hoja del Excel): los que comparten las normas.
  const rowsComunes = useMemo(() => rows.filter((r) => r.requisito.es_comun !== "no"), [rows])

  // Avance por norma (calculado en vivo desde las filas cargadas). Ponderado
  // por el peso de cada requisito EN esa norma -- mismo esquema que la 0312
  // (Art. 27): "aprobado" suma su peso completo, "cargado" (sin verificar)
  // suma la mitad, "pendiente"/"no aplica" no suma nada.
  const avance = useMemo(() => {
    return normas.map((n) => {
      let total = 0
      let cargados = 0
      let aprobados = 0
      let pesoTotal = 0
      let pesoObtenido = 0
      for (const row of rows) {
        const celda = row.celdas.find((c) => c.norma_id === n.id)
        if (!celda || !celda.aplica) continue
        total += 1
        const peso = celda.peso || 0
        pesoTotal += peso
        if (celda.estado === "aprobado") {
          aprobados += 1
          cargados += 1
          pesoObtenido += peso
        } else if (celda.estado === "cargado") {
          cargados += 1
          pesoObtenido += peso * 0.5
        }
      }
      // AVANCE REAL de la norma: sin evidencia = 0 · documentado (cargado, sin
      // verificar) = medio avance · verificado/aprobado = avance completo. Subir un
      // documento no cierra el numeral; documental y verificado se muestran aparte.
      const soloCargados = Math.max(0, cargados - aprobados)
      const pct = pesoTotal > 0 ? Math.round((pesoObtenido / pesoTotal) * 100) : 0
      const pctDocumental = total > 0 ? Math.round((cargados / total) * 100) : 0
      const pctAprobado = total > 0 ? Math.round((aprobados / total) * 100) : 0
      return { norma: n, total, cargados, aprobados, soloCargados, pct, pctDocumental, pctAprobado, pesoTotal, pesoObtenido }
    })
  }, [normas, rows])

  async function marcarEstado(requisitoId: number, normaId: number, estado: SigEstadoCobertura) {
    const key = `${requisitoId}:${normaId}:${estado}`
    setSaving(key)
    const res = await upsertCobertura({ requisitoId, normaId, estado }, empresaId)
    setSaving(null)
    if (res.success) {
      await cargar()
    } else {
      toast({ title: "No se pudo actualizar", description: res.error })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: SST_TOKENS.navy }} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <SigHeader
        Icon={ShieldCheck}
        title="Sistema Integrado de Gestión (SIG)"
        subtitle={<>ISO 9001:2015 · ISO 14001:2015 · ISO 45001:2018{selectedEmpresaNombre ? ` — ${selectedEmpresaNombre}` : ""}</>}
      />

      {/* Tablero de avance */}
      <div className="grid gap-3 sm:grid-cols-3">
        {avance.map((a) => (
          <Card key={a.norma.id} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold" style={{ color: a.norma.color ?? SST_TOKENS.navy }}>
                {a.norma.nombre}
              </span>
              <span className="text-lg font-bold" style={{ color: colorPct(a.pct) }}>
                {a.pct}%
              </span>
            </div>
            <p className="lg-eyebrow">Avance real de la norma</p>
            <Progress value={a.pct} className="mt-1 h-2" />
            <p className="mt-1.5 text-xs font-medium" style={{ color: SST_TOKENS.navy }}>
              {a.pesoObtenido.toFixed(1)} / {a.pesoTotal.toFixed(0)} pts (peso)
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {a.aprobados} verificados · {a.soloCargados} documentados (sin verificar) · {a.total} aplican
            </p>
            <p className="text-[11px] text-muted-foreground">Documentado {a.pctDocumental}% · Verificado {a.pctAprobado}%</p>
            {a.norma.codigo === "ISO45001" && avance0312 != null && (
              <p className="mt-1 text-[11px] font-medium" style={{ color: valoracion0312(avance0312).color }}>
                Ref. SG-SST 0312 (Art. 27): {avance0312}% · {valoracion0312(avance0312).label}
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* Pestanas: matriz general + una por norma */}
      <Tabs defaultValue="integrada">
        <TabsList className="flex-wrap">
          <TabsTrigger value="integrada">Matriz Integrada</TabsTrigger>
          <TabsTrigger value="comunes">Requisitos Comunes</TabsTrigger>
          {normasVisibles.map((n) => (
            <TabsTrigger key={n.id} value={n.codigo}>
              {n.nombre}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Matriz integrada (numeral x 3 normas) */}
        <TabsContent value="integrada" className="mt-3">
          <MatrizIntegradaTabla
            rows={rows}
            normas={normas}
            expanded={expanded}
            setExpanded={setExpanded}
            empresaId={empresaId}
            saving={saving}
            marcarEstado={marcarEstado}
            onUploaded={cargar}
          />
        </TabsContent>

        {/* Requisitos comunes (segunda hoja del Excel) */}
        <TabsContent value="comunes" className="mt-3">
          <div className="mb-3 rounded-md border p-3 text-sm text-muted-foreground" style={{ borderColor: `${SST_TOKENS.teal}55` }}>
            <span className="font-semibold" style={{ color: SST_TOKENS.navy }}>Requisitos comunes a las 3 normas.</span>{" "}
            Aquí un mismo documento sirve como evidencia compartida (común = Sí) o parcial. Súbelo una vez y aplica a ISO 9001, 14001 y 45001.
          </div>
          <MatrizIntegradaTabla
            rows={rowsComunes}
            normas={normas}
            expanded={expanded}
            setExpanded={setExpanded}
            empresaId={empresaId}
            saving={saving}
            marcarEstado={marcarEstado}
            onUploaded={cargar}
          />
        </TabsContent>

        {/* Vista por norma (solo las permitidas) */}
        {normasVisibles.map((n) => (
          <TabsContent key={n.id} value={n.codigo} className="mt-3">
            <NormaTabla
              norma={n}
              rows={rows}
              expanded={expanded}
              setExpanded={setExpanded}
              empresaId={empresaId}
              saving={saving}
              marcarEstado={marcarEstado}
              onUploaded={cargar}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabla de la matriz integrada
// ---------------------------------------------------------------------------

interface TablaProps {
  rows: SigMatrizRow[]
  normas: SigNorma[]
  expanded: number | null
  setExpanded: (id: number | null) => void
  empresaId?: number | null
  saving: string | null
  marcarEstado: (requisitoId: number, normaId: number, estado: SigEstadoCobertura) => void
  onUploaded: () => void
}

function MatrizIntegradaTabla({ rows, normas, expanded, setExpanded, empresaId, saving, marcarEstado, onUploaded }: TablaProps) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ background: SST_TOKENS.light }}>
              <th className="px-3 py-2 font-semibold" style={{ color: SST_TOKENS.ink }}>Numeral</th>
              <th className="px-3 py-2 font-semibold" style={{ color: SST_TOKENS.ink }}>Requisito / tema</th>
              {normas.map((n) => (
                <th key={n.id} className="px-3 py-2 text-center font-semibold" style={{ color: n.color ?? SST_TOKENS.ink }}>
                  {n.codigo.replace("ISO", "ISO ")}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-semibold" style={{ color: SST_TOKENS.ink }}>Común</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isOpen = expanded === row.requisito.id
              const ciclo = cicloDeNumeral(row.requisito.numeral)
              const showCiclo = idx === 0 || cicloDeNumeral(rows[idx - 1].requisito.numeral) !== ciclo
              return (
                <Fragment key={row.requisito.id}>
                  {showCiclo && <CicloHeader ciclo={ciclo} colSpan={normas.length + 4} />}
                  <tr
                    className="cursor-pointer border-b hover:bg-muted/40"
                    onClick={() => setExpanded(isOpen ? null : row.requisito.id)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{row.requisito.numeral}</td>
                    <td className="px-3 py-2">{row.requisito.tema}</td>
                    {normas.map((n) => {
                      const celda = row.celdas.find((c) => c.norma_id === n.id)
                      return (
                        <td key={n.id} className="px-3 py-2 text-center">
                          {celda ? <EstadoBadge estado={celda.estado} /> : null}
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-center">
                      <Badge
                        variant="outline"
                        style={{ borderColor: COMUN_COLOR[row.requisito.es_comun], color: COMUN_COLOR[row.requisito.es_comun] }}
                      >
                        {COMUN_LABEL[row.requisito.es_comun]}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={normas.length + 4} className="bg-muted/20 px-4 py-4">
                        <RequisitoDetalle
                          row={row}
                          normas={normas}
                          empresaId={empresaId}
                          saving={saving}
                          marcarEstado={marcarEstado}
                          onUploaded={onUploaded}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Tabla de una sola norma
// ---------------------------------------------------------------------------

function NormaTabla({
  norma,
  rows,
  expanded,
  setExpanded,
  empresaId,
  saving,
  marcarEstado,
  onUploaded,
}: { norma: SigNorma } & Omit<TablaProps, "normas">) {
  const visibles = rows
    .map((r) => ({ row: r, celda: r.celdas.find((c) => c.norma_id === norma.id) }))
    .filter((x) => x.celda && x.celda.aplica)

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ background: `${(norma.color ?? SST_TOKENS.navy)}12` }}>
              <th className="px-3 py-2 font-semibold" style={{ color: SST_TOKENS.ink }}>Numeral</th>
              <th className="px-3 py-2 font-semibold" style={{ color: SST_TOKENS.ink }}>Requisito / tema</th>
              <th className="px-3 py-2 font-semibold" style={{ color: SST_TOKENS.ink }}>Cómo evidenciar</th>
              <th className="px-3 py-2 text-center font-semibold" style={{ color: SST_TOKENS.ink }}>Peso</th>
              <th className="px-3 py-2 text-center font-semibold" style={{ color: SST_TOKENS.ink }}>Estado</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {visibles.map(({ row, celda }, idx) => {
              const isOpen = expanded === row.requisito.id
              const ciclo = cicloDeNumeral(row.requisito.numeral)
              const showCiclo = idx === 0 || cicloDeNumeral(visibles[idx - 1].row.requisito.numeral) !== ciclo
              return (
                <Fragment key={row.requisito.id}>
                  {showCiclo && <CicloHeader ciclo={ciclo} colSpan={6} />}
                  <tr
                    className="cursor-pointer border-b hover:bg-muted/40"
                    onClick={() => setExpanded(isOpen ? null : row.requisito.id)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{row.requisito.numeral}</td>
                    <td className="px-3 py-2">{row.requisito.tema}</td>
                    <td className="px-3 py-2 text-muted-foreground">{celda?.texto}</td>
                    <td className="px-3 py-2 text-center font-medium" style={{ color: SST_TOKENS.navy }}>
                      {celda?.peso ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-center">{celda ? <EstadoBadge estado={celda.estado} /> : null}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="bg-muted/20 px-4 py-4">
                        <RequisitoDetalle
                          row={row}
                          normas={[norma]}
                          empresaId={empresaId}
                          saving={saving}
                          marcarEstado={marcarEstado}
                          onUploaded={onUploaded}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Editor de peso (requisito x norma): a diferencia de la 0312 -- donde el
// peso lo fija la Resolucion y no se edita desde la pantalla -- aqui SI es
// ajustable, porque las normas ISO no traen un peso oficial por numeral.
// Arranca en 1 para todos (mismo % que antes) y se afina desde aqui.
// ---------------------------------------------------------------------------

function PesoEditor({
  requisitoId,
  normaId,
  peso,
  onSaved,
}: {
  requisitoId: number
  normaId: number
  peso: number
  onSaved: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(String(peso))
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (!editando) setValor(String(peso))
  }, [peso, editando])

  async function guardar() {
    const n = Number(valor)
    if (!Number.isFinite(n) || n < 0) {
      toast({ title: "Peso inválido", description: "Escribe un número positivo." })
      return
    }
    if (n === peso) {
      setEditando(false)
      return
    }
    setSaving(true)
    const res = await actualizarPesoRequisitoNorma(requisitoId, normaId, n)
    setSaving(false)
    setEditando(false)
    if (res.success) onSaved()
    else toast({ title: "No se pudo guardar el peso", description: res.error })
  }

  if (!editando) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setEditando(true)
        }}
        title="Editar peso de este requisito en esta norma"
        className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-current hover:text-foreground"
      >
        Peso {peso}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        autoFocus
        type="number"
        min={0}
        step={0.5}
        value={valor}
        disabled={saving}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") guardar()
          if (e.key === "Escape") {
            setValor(String(peso))
            setEditando(false)
          }
        }}
        onBlur={guardar}
        className="h-6 w-16 px-1.5 text-[11px]"
      />
      {saving && <Loader2 className="h-3 w-3 animate-spin" />}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Detalle expandido de un requisito (evidencia comun + soporte + estados)
// ---------------------------------------------------------------------------

function RequisitoDetalle({
  row,
  normas,
  empresaId,
  saving,
  marcarEstado,
  onUploaded,
}: {
  row: SigMatrizRow
  normas: SigNorma[]
  empresaId?: number | null
  saving: string | null
  marcarEstado: (requisitoId: number, normaId: number, estado: SigEstadoCobertura) => void
  onUploaded: () => void
}) {
  const { requisito } = row
  const estados: SigEstadoCobertura[] = ["cargado", "aprobado", "pendiente"]

  async function quitarDoc(id: number) {
    await eliminarCobertura(id)
    onUploaded()
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Izquierda: evidencia comun + soporte compartido */}
      <div className="space-y-3">
        {requisito.evidencia_comun_sugerida && (
          <div className="rounded-md border p-3" style={{ borderColor: `${SST_TOKENS.teal}55` }}>
            <p className="text-xs font-semibold" style={{ color: SST_TOKENS.navy }}>
              Evidencia común sugerida
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{requisito.evidencia_comun_sugerida}</p>
          </div>
        )}
        <div className="rounded-md border p-3">
          <p className="text-xs font-semibold" style={{ color: SST_TOKENS.navy }}>
            Soporte documental (compartido por las normas de este numeral)
          </p>
          <div className="mt-2">
            <SoportesDocumentales
              norma="SIG"
              modulo={MODULO}
              referenciaTipo="sig_numeral"
              referenciaId={requisito.numeral}
              referenciaDesc={`${requisito.numeral} — ${requisito.tema}`}
              empresaId={empresaId}
              onUploaded={() => onUploaded()}
            />
          </div>
        </div>
        <DocumentoVincular row={row} normas={normas} empresaId={empresaId} onLinked={onUploaded} />
        {/* La otra clase de evidencia: un modulo de LIPgo que ya funciona, en
            vez de un archivo. Ver scripts/sig/59_requisito_modulo.sql. */}
        <ModuloVincular row={row} normas={normas} onLinked={onUploaded} />
      </div>

      {/* Derecha: estado de cobertura por norma */}
      <div className="space-y-2">
        <p className="text-xs font-semibold" style={{ color: SST_TOKENS.navy }}>
          Estado por norma
        </p>
        {normas.map((n) => {
          const celda = row.celdas.find((c) => c.norma_id === n.id) as SigCeldaNorma | undefined
          if (!celda) return null
          if (!celda.aplica) {
            return (
              <div key={n.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm font-medium" style={{ color: n.color ?? SST_TOKENS.navy }}>
                  {n.nombre}
                </span>
                <EstadoBadge estado="no_aplica" />
              </div>
            )
          }
          return (
            <div key={n.id} className="rounded-md border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium" style={{ color: n.color ?? SST_TOKENS.navy }}>
                  {n.nombre}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <PesoEditor requisitoId={requisito.id} normaId={n.id} peso={celda.peso} onSaved={onUploaded} />
                  <EstadoBadge estado={celda.estado} />
                </div>
              </div>
              {celda.texto && <p className="mt-1 text-xs text-muted-foreground">{celda.texto}</p>}

              {/* Modulos de LIPgo que sustentan este numeral. No son archivos:
                  son pantallas vivas. Se muestra cuantos registros tienen,
                  porque un modulo declarado y vacio no es evidencia de nada. */}
              {(celda.modulos ?? []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {(celda.modulos ?? []).map((m) => {
                    const vacio = m.registros === 0
                    const sinConteo = m.registros == null
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent("lipgo:navigate-module", { detail: m.modulo }),
                            )
                          }
                          title={m.nota ?? `Abrir ${m.modulo}`}
                          className="flex w-full items-center gap-1.5 rounded border px-2 py-1 text-left text-xs transition-colors hover:bg-muted/60"
                          style={{ borderColor: SST_TOKENS.teal }}
                        >
                          <Boxes className="h-3 w-3 shrink-0" style={{ color: SST_TOKENS.teal }} />
                          <span className="min-w-0 flex-1 truncate font-medium">{m.modulo}</span>
                          <span
                            className="shrink-0 rounded px-1 text-[10px]"
                            style={{
                              background: vacio || sinConteo ? "#f4f4f5" : SST_TOKENS.teal,
                              color: vacio || sinConteo ? SST_TOKENS.warn : "#fff",
                            }}
                          >
                            {sinConteo
                              ? "sin conteo"
                              : `${m.registros} registro${m.registros === 1 ? "" : "s"}`}
                          </span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                        </button>
                        {vacio && (
                          <p className="mt-0.5 pl-2 text-[10px]" style={{ color: SST_TOKENS.warn }}>
                            El modulo esta declarado pero no tiene registros: el numeral sigue pendiente.
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {celda.fuente === "iso9001" ? (
                <p className="mt-2 flex items-center gap-1 text-xs" style={{ color: SST_TOKENS.teal }}>
                  <LinkIcon className="h-3 w-3" />
                  Estado tomado del Centro de Evidencia ISO 9001
                  {celda.valorFuente ? ` · ${celda.valorFuente}` : ""}
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {celda.fuente === "modulo" && (
                    <p className="mb-1 w-full text-[11px]" style={{ color: SST_TOKENS.teal }}>
                      Estado tomado del modulo de LIPgo
                      {celda.valorFuente ? ` · ${celda.valorFuente}` : ""}. Se puede aprobar a mano
                      si la evidencia lo respalda.
                    </p>
                  )}
                  {estados.map((e) => {
                    const key = `${requisito.id}:${n.id}:${e}`
                    const active = celda.estado === e
                    return (
                      <Button
                        key={e}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        className="h-7 px-2 text-xs"
                        disabled={saving === key}
                        onClick={() => marcarEstado(requisito.id, n.id, e)}
                      >
                        {saving === key ? <Loader2 className="h-3 w-3 animate-spin" /> : ESTADO_META[e].label}
                      </Button>
                    )
                  })}
                </div>
              )}
              {celda.coberturas.filter((c) => c.documento).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {celda.coberturas
                    .filter((c) => c.documento)
                    .map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1 text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <FileText className="h-3 w-3 shrink-0" style={{ color: SST_TOKENS.navy }} />
                          <span className="truncate">
                            {c.documento?.codigo ? `${c.documento.codigo} — ` : ""}
                            {c.documento?.nombre ?? "Documento"}
                          </span>
                          {/* A qué proceso del Mapa de Procesos pertenece. Es la
                              otra mitad de la conexión: desde el mapa se ve el
                              numeral, y desde aquí, el proceso. */}
                          {c.documento?.proceso_id && (
                            <span
                              className="shrink-0 rounded bg-background px-1 font-mono text-[10px]"
                              style={{ color: SST_TOKENS.navy }}
                              title={`Mapa de Procesos · ${c.documento.proceso_id}`}
                            >
                              {c.documento.proceso_id}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => quitarDoc(c.id)}
                          className="shrink-0 text-muted-foreground hover:text-red-600"
                          title="Quitar vínculo"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Selector para vincular un documento real del maestro (sig_documentos)
// a uno o varios numerales/normas (documento compartido).
// ---------------------------------------------------------------------------

/**
 * Declara que un MODULO de LIPgo sustenta este numeral.
 *
 * A diferencia de un documento, un modulo no se sube: ya existe y funciona. Lo
 * que se declara aqui es la relacion, y la Matriz la usa para mostrar el modulo
 * con sus registros vivos. Ver scripts/sig/59_requisito_modulo.sql.
 */
function ModuloVincular({
  row,
  normas,
  onLinked,
}: {
  row: SigMatrizRow
  normas: SigNorma[]
  onLinked: () => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [actuales, setActuales] = useState<SigModuloCobertura[]>([])
  const [tablas, setTablas] = useState<string[]>([])
  const [buscar, setBuscar] = useState("")
  const [modulo, setModulo] = useState<string | null>(null)
  const [tabla, setTabla] = useState<string>("")
  const [normaId, setNormaId] = useState<number | null>(null)

  // Catalogo canonico de modulos: se deriva de `groups`, que es el mismo
  // registro que usan el sidebar, el ruteo y los permisos. Derivarlo evita
  // mantener una segunda lista que se desincronizaria.
  const modulosDisponibles = useMemo(() => {
    const out: string[] = []
    for (const g of groups) {
      for (const m of g.modules ?? []) out.push(m.name)
      for (const sg of g.subgroups ?? []) for (const m of sg.modules) out.push(m.name)
    }
    return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b, "es"))
  }, [])

  const filtrados = useMemo(() => {
    const t = buscar.trim().toLowerCase()
    const yaPuestos = new Set(actuales.map((a) => a.modulo))
    return modulosDisponibles
      .filter((m) => !yaPuestos.has(m))
      .filter((m) => !t || m.toLowerCase().includes(t))
      .slice(0, 60)
  }, [modulosDisponibles, actuales, buscar])

  async function abrir() {
    setOpen(true)
    setCargando(true)
    const [res, tbs] = await Promise.all([
      getModulosDeRequisito(row.requisito.id),
      getTablasModuloPermitidas(),
    ])
    if (res.success) setActuales(res.data)
    setTablas(tbs)
    setCargando(false)
  }

  async function guardar() {
    if (!modulo) return
    setGuardando(true)
    const res = await vincularModuloARequisito({
      requisitoId: row.requisito.id,
      normaId,
      modulo,
      tabla: tabla || null,
    })
    setGuardando(false)
    if (!res.success) {
      toast({ title: "No se pudo vincular", description: res.error, variant: "destructive" })
      return
    }
    toast({
      title: "Modulo vinculado",
      description: tabla
        ? `${modulo} sustenta el numeral ${row.requisito.numeral}.`
        : `${modulo} vinculado. Sin tabla de conteo no se muestra cuantos registros tiene.`,
    })
    setModulo(null)
    setTabla("")
    setBuscar("")
    const r = await getModulosDeRequisito(row.requisito.id)
    if (r.success) setActuales(r.data)
    onLinked()
  }

  async function quitar(id: number, nombre: string) {
    const res = await desvincularModuloDeRequisito(id)
    if (!res.success) {
      toast({ title: "No se pudo quitar", description: res.error, variant: "destructive" })
      return
    }
    toast({ title: "Modulo desvinculado", description: nombre })
    setActuales((prev) => prev.filter((a) => a.id !== id))
    onLinked()
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={abrir}>
        <Boxes className="mr-2 h-4 w-4" />
        Vincular un modulo de LIPgo
      </Button>
    )
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Modulos que sustentan {row.requisito.numeral}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {cargando ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Cargando...</p>
      ) : (
        <>
          {actuales.length > 0 && (
            <ul className="mb-3 space-y-1">
              {actuales.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs"
                >
                  <Boxes className="h-3 w-3 shrink-0" style={{ color: SST_TOKENS.teal }} />
                  <span className="min-w-0 flex-1 truncate">{a.modulo}</span>
                  {a.tabla ? (
                    <span className="shrink-0 font-mono text-[10px] opacity-60">{a.tabla}</span>
                  ) : (
                    <span className="shrink-0 text-[10px]" style={{ color: SST_TOKENS.warn }}>
                      sin conteo
                    </span>
                  )}
                  {a.norma_id == null && (
                    <span className="shrink-0 rounded bg-background px-1 text-[10px]">
                      todas las normas
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => quitar(a.id, a.modulo)}
                    aria-label={`Quitar ${a.modulo}`}
                    className="shrink-0 rounded p-0.5 hover:bg-background"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Input
            placeholder="Buscar un modulo..."
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            className="mb-2 h-8 text-xs"
          />

          <div className="max-h-40 divide-y overflow-y-auto rounded border">
            {filtrados.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">
                No hay modulos que coincidan.
              </p>
            ) : (
              filtrados.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModulo(m)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/50 ${
                    modulo === m ? "bg-muted" : ""
                  }`}
                >
                  <Boxes className="h-3 w-3 shrink-0 opacity-50" />
                  <span className="min-w-0 flex-1 truncate">{m}</span>
                  {modulo === m && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                </button>
              ))
            )}
          </div>

          {modulo && (
            <div className="mt-2 space-y-2 rounded border p-2">
              <p className="text-xs">
                <span className="font-medium">{modulo}</span> sustenta el numeral{" "}
                {row.requisito.numeral}
              </p>

              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  Tabla para contar registros (opcional)
                </label>
                <select
                  value={tabla}
                  onChange={(e) => setTabla(e.target.value)}
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                >
                  <option value="">Sin conteo — solo enlace al modulo</option>
                  {tablas.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Sin tabla no se puede saber si el modulo tiene datos, y el numeral no contara
                  como cubierto.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">Alcance</label>
                <select
                  value={normaId ?? ""}
                  onChange={(e) => setNormaId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                >
                  <option value="">Todas las normas donde aplique</option>
                  {normas.map((n) => (
                    <option key={n.id} value={n.id}>
                      Solo {n.codigo}
                    </option>
                  ))}
                </select>
              </div>

              <Button size="sm" className="w-full" disabled={guardando} onClick={guardar}>
                {guardando ? "Vinculando..." : "Vincular modulo"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DocumentoVincular({
  row,
  normas,
  empresaId,
  onLinked,
}: {
  row: SigMatrizRow
  normas: SigNorma[]
  empresaId?: number | null
  onLinked: () => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [docs, setDocs] = useState<SigDocumento[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [selDoc, setSelDoc] = useState<string | null>(null)
  const [targets, setTargets] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  // Normas a las que aplica este requisito (las únicas vinculables).
  const aplicables = normas.filter((n) => row.celdas.some((c) => c.norma_id === n.id && c.aplica))

  async function load(q: string) {
    setLoading(true)
    const res = await getDocumentos(q)
    setDocs(res.success ? res.data : [])
    setLoading(false)
  }

  function abrir() {
    setOpen(true)
    setTargets(aplicables.map((n) => n.id))
    if (docs.length === 0) load("")
  }

  function toggleTarget(id: number) {
    setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]))
  }

  async function vincular() {
    if (!selDoc || targets.length === 0) return
    setSaving(true)
    const res = await vincularDocumentoAObjetivos(
      selDoc,
      targets.map((normaId) => ({ requisitoId: row.requisito.id, normaId })),
      { estado: "cargado" },
      empresaId,
    )
    setSaving(false)
    if (res.success) {
      toast({ title: "Documento vinculado", description: `Aplicado a ${res.vinculados} norma(s).` })
      setSelDoc(null)
      setOpen(false)
      onLinked()
    } else {
      toast({ title: "No se pudo vincular", description: res.error })
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={abrir}>
        <Link2 className="mr-2 h-4 w-4" />
        Vincular documento del SIG
      </Button>
    )
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold" style={{ color: SST_TOKENS.navy }}>
          Vincular documento del SIG
        </p>
        <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") load(search)
          }}
          placeholder="Buscar por código, nombre o proceso…"
          className="h-8 pl-7 text-xs"
        />
      </div>

      <div className="max-h-40 overflow-y-auto rounded border">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : docs.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">Sin documentos. Escribe y presiona Enter para buscar.</p>
        ) : (
          docs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSelDoc(d.id)}
              className={`flex w-full items-center gap-2 border-b px-2 py-1.5 text-left text-xs hover:bg-muted ${
                selDoc === d.id ? "bg-muted" : ""
              }`}
            >
              <FileText className="h-3 w-3 shrink-0" style={{ color: SST_TOKENS.navy }} />
              <span className="truncate">
                {d.codigo ? `${d.codigo} — ` : ""}
                {d.nombre}
                {d.proceso ? ` · ${d.proceso}` : ""}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-3">
        {aplicables.map((n) => (
          <label key={n.id} className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={targets.includes(n.id)} onChange={() => toggleTarget(n.id)} />
            <span style={{ color: n.color ?? SST_TOKENS.navy }}>{n.codigo.replace("ISO", "ISO ")}</span>
          </label>
        ))}
      </div>

      <Button
        size="sm"
        className="mt-2 w-full"
        disabled={!selDoc || targets.length === 0 || saving}
        onClick={vincular}
      >
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
        Vincular a {targets.length} norma(s)
      </Button>
    </div>
  )
}
