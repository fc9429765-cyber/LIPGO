"use client"

// Dashboard SIG unificado para auditoría: KPIs por norma, avance por ciclo PHVA,
// brechas (numerales pendientes), referencia 0312 y Listado Maestro de
// documentos. Filtro por norma (Todas / individual) + búsqueda. Todo lo que un
// auditor suele pedir, en un solo tablero.

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/hooks/use-toast"
import { SST_TOKENS, colorPct, CICLO_LABEL } from "@/components/sst/sst-utils"
import { SigHeader } from "@/components/sst/sig-ui"
import type { CicloPHVA } from "@/lib/sst-types"
import {
  getMatrizIntegrada,
  getAvance0312,
  getListadoMaestro,
  getAspectosAmbientales,
  getRequisitosLegales,
  getObjetivos,
} from "@/lib/sig-actions"
import type {
  SigNorma,
  SigMatrizRow,
  SigDocVersion,
  SigDocumento,
  SigAspectoAmbiental,
  SigRequisitoLegal,
  SigObjetivo,
} from "@/lib/sig-types"
import { Loader2, Search, LayoutDashboard, FileText, AlertCircle, Download } from "lucide-react"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts"

interface Props {
  selectedEmpresaId?: number | null
}

const NORMA_MODULO: Record<string, string> = {
  ISO9001: "SIG · ISO 9001",
  ISO14001: "SIG · ISO 14001",
  ISO45001: "SIG · ISO 45001",
}
const CICLOS: CicloPHVA[] = ["PLANEAR", "HACER", "VERIFICAR", "ACTUAR"]

function cicloDeNumeral(numeral: string): CicloPHVA {
  const cap = parseInt(numeral, 10)
  if (cap <= 6) return "PLANEAR"
  if (cap <= 8) return "HACER"
  if (cap === 9) return "VERIFICAR"
  return "ACTUAR"
}
function valoracion0312(pct: number): { label: string; color: string } {
  if (pct > 85) return { label: "Aceptable", color: SST_TOKENS.ok }
  if (pct >= 60) return { label: "Moderadamente aceptable", color: SST_TOKENS.warn }
  return { label: "Crítico", color: SST_TOKENS.bad }
}

type MaestroItem = { documento: SigDocumento; normas: string[]; numerales: string[]; ultimaVersion: SigDocVersion | null }

export function DashboardSIG({ selectedEmpresaId: propEmpresaId }: Props) {
  const { selectedEmpresaId: ctxEmpresaId, selectedEmpresaNombre } = useAuth()
  const empresaId = propEmpresaId ?? ctxEmpresaId
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [normas, setNormas] = useState<SigNorma[]>([])
  const [rows, setRows] = useState<SigMatrizRow[]>([])
  const [avance0312, setAvance0312] = useState<number | null>(null)
  const [maestro, setMaestro] = useState<MaestroItem[]>([])
  const [aspectos, setAspectos] = useState<SigAspectoAmbiental[]>([])
  const [legales, setLegales] = useState<SigRequisitoLegal[]>([])
  const [objetivos, setObjetivos] = useState<SigObjetivo[]>([])
  const [permitidas, setPermitidas] = useState<string[] | null>(null)
  const [filtroNorma, setFiltroNorma] = useState<string>("ALL")
  const [q, setQ] = useState("")

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      getMatrizIntegrada(empresaId),
      getAvance0312(empresaId),
      getListadoMaestro(empresaId),
      getAspectosAmbientales(empresaId),
      getRequisitosLegales(empresaId),
      getObjetivos(empresaId),
    ])
      .then(([m, a, l, asp, leg, obj]) => {
        if (!active) return
        if (m.success) {
          setNormas(m.normas)
          setRows(m.rows)
        } else toast({ title: "No se pudo cargar la matriz", description: m.error })
        setAvance0312(a.success ? a.pct : null)
        setMaestro(l.success ? l.data : [])
        setAspectos(asp.success ? asp.data : [])
        setLegales(leg.success ? leg.data : [])
        setObjetivos(obj.success ? obj.data : [])
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  // Permisos por norma (qué normas puede ver el usuario).
  useEffect(() => {
    if (!normas.length) return
    let active = true
    Promise.all(
      normas.map(async (n) => {
        const m = NORMA_MODULO[n.codigo]
        if (!m) return n.codigo
        try {
          const r = await fetch("/api/check-permission", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ moduleName: m }),
          })
          const d = await r.json()
          return d?.hasPermission ? n.codigo : null
        } catch {
          return null
        }
      }),
    ).then((res) => active && setPermitidas(res.filter(Boolean) as string[]))
    return () => {
      active = false
    }
  }, [normas])

  const visibles = useMemo(() => normas.filter((n) => permitidas?.includes(n.codigo)), [normas, permitidas])
  const normasMostradas = useMemo(
    () => (filtroNorma === "ALL" ? visibles : visibles.filter((n) => n.codigo === filtroNorma)),
    [visibles, filtroNorma],
  )

  // Estadísticas por norma (aplicables / con evidencia / verificados / pendientes).
  const statsPorNorma = useMemo(() => {
    const map: Record<string, { total: number; cargados: number; aprobados: number; pendientes: number }> = {}
    for (const n of normas) {
      let total = 0,
        cargados = 0,
        aprobados = 0,
        pendientes = 0
      for (const row of rows) {
        const c = row.celdas.find((x) => x.norma_id === n.id)
        if (!c || !c.aplica) continue
        total++
        if (c.estado === "aprobado") {
          aprobados++
          cargados++
        } else if (c.estado === "cargado") cargados++
        else pendientes++
      }
      map[n.codigo] = { total, cargados, aprobados, pendientes }
    }
    return map
  }, [normas, rows])

  // PHVA x norma: % de implementación por ciclo.
  const phva = useMemo(() => {
    const res: Record<string, Record<CicloPHVA, { total: number; impl: number }>> = {}
    for (const n of visibles) {
      const init: any = { PLANEAR: { total: 0, impl: 0 }, HACER: { total: 0, impl: 0 }, VERIFICAR: { total: 0, impl: 0 }, ACTUAR: { total: 0, impl: 0 } }
      for (const row of rows) {
        const c = row.celdas.find((x) => x.norma_id === n.id)
        if (!c || !c.aplica) continue
        const cic = cicloDeNumeral(row.requisito.numeral)
        init[cic].total++
        if (c.estado === "cargado" || c.estado === "aprobado") init[cic].impl++
      }
      res[n.codigo] = init
    }
    return res
  }, [visibles, rows])

  // Datos para gráficas.
  const chartNormas = useMemo(
    () =>
      normasMostradas.map((n) => {
        const s = statsPorNorma[n.codigo] ?? { total: 0, cargados: 0, aprobados: 0, pendientes: 0 }
        return {
          norma: n.codigo.replace("ISO", "ISO "),
          Documental: s.total ? Math.round((s.cargados / s.total) * 100) : 0,
          Verificado: s.total ? Math.round((s.aprobados / s.total) * 100) : 0,
        }
      }),
    [normasMostradas, statsPorNorma],
  )
  const chartPHVA = useMemo(
    () =>
      CICLOS.map((c) => {
        const row: Record<string, string | number> = { ciclo: CICLO_LABEL[c] }
        for (const n of normasMostradas) {
          const cell = phva[n.codigo]?.[c]
          row[n.codigo] = cell && cell.total ? Math.round((cell.impl / cell.total) * 100) : 0
        }
        return row
      }),
    [normasMostradas, phva],
  )

  // Brechas: numerales pendientes (sin evidencia) según el filtro de norma.
  // "Qué le falta" a la norma, en las dos dimensiones del avance real:
  // (1) faltaDocumentar = numerales aplicables SIN evidencia (estado pendiente);
  // (2) faltaVerificar  = numerales con documento cargado pero SIN aprobar (estado cargado).
  const brechasPorEstado = useMemo(() => {
    const objetivo = filtroNorma === "ALL" ? visibles : visibles.filter((n) => n.codigo === filtroNorma)
    const faltaDocumentar: { numeral: string; tema: string; norma: string }[] = []
    const faltaVerificar: { numeral: string; tema: string; norma: string }[] = []
    for (const row of rows) {
      for (const n of objetivo) {
        const c = row.celdas.find((x) => x.norma_id === n.id)
        if (!c || !c.aplica) continue
        const ref = { numeral: row.requisito.numeral, tema: row.requisito.tema, norma: n.codigo }
        if (c.estado === "pendiente") faltaDocumentar.push(ref)
        else if (c.estado === "cargado") faltaVerificar.push(ref)
      }
    }
    return { faltaDocumentar, faltaVerificar }
  }, [rows, visibles, filtroNorma])
  const brechas = brechasPorEstado.faltaDocumentar

  // Listado maestro filtrado por norma + búsqueda.
  const maestroFiltrado = useMemo(() => {
    const f = q.trim().toLowerCase()
    return maestro.filter((it) => {
      if (filtroNorma !== "ALL" && !it.normas.includes(filtroNorma)) return false
      if (!f) return true
      const hay = `${it.documento.codigo ?? ""} ${it.documento.nombre ?? ""} ${it.documento.proceso ?? ""} ${it.numerales.join(" ")}`.toLowerCase()
      return hay.includes(f)
    })
  }, [maestro, filtroNorma, q])

  // Indicadores ambientales (ISO 14001) y de objetivos.
  const aspSignif = useMemo(() => aspectos.filter((a) => a.significancia === "significativo").length, [aspectos])
  const legalPct = useMemo(() => {
    const aplican = legales.filter((l) => l.cumple !== "no_aplica")
    if (!aplican.length) return null
    const suma = aplican.reduce((s, l) => s + (l.cumple === "cumple" ? 1 : l.cumple === "parcial" ? 0.5 : 0), 0)
    return Math.round((suma / aplican.length) * 100)
  }, [legales])
  const objCounts = useMemo(() => {
    const c = { en_curso: 0, cumplido: 0, atrasado: 0 }
    for (const o of objetivos) {
      const e = (o.estado ?? "en_curso") as keyof typeof c
      if (e in c) c[e]++
    }
    return c
  }, [objetivos])

  async function exportarPDF() {
    const { default: jsPDF } = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")
    const doc = new jsPDF()
    const fecha = new Date().toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" })
    const alcance = filtroNorma === "ALL" ? "Todas las normas" : normasMostradas[0]?.nombre ?? filtroNorma

    doc.setFontSize(15)
    doc.text("Dashboard SIG — Auditoría", 14, 16)
    doc.setFontSize(9)
    doc.text(`${selectedEmpresaNombre ?? ""}  ·  ${alcance}  ·  ${fecha}`, 14, 22)

    // KPIs por norma
    autoTable(doc, {
      startY: 28,
      head: [["Norma", "% Avance real", "Documentado", "Verificado", "Falta documentar", "Falta verificar", "Aplican"]],
      body: normasMostradas.map((n) => {
        const s = statsPorNorma[n.codigo] ?? { total: 0, cargados: 0, aprobados: 0, pendientes: 0 }
        const soloCargados = Math.max(0, s.cargados - s.aprobados)
        const pctDoc = s.total ? Math.round((s.cargados / s.total) * 100) : 0
        const pctVer = s.total ? Math.round((s.aprobados / s.total) * 100) : 0
        const pctAvance = s.total ? Math.round(((s.aprobados + soloCargados * 0.5) / s.total) * 100) : 0
        return [n.nombre, `${pctAvance}%`, `${pctDoc}%`, `${pctVer}%`, String(s.pendientes), String(soloCargados), String(s.total)]
      }),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [13, 59, 110] },
    })
    if (avance0312 != null && normasMostradas.some((n) => n.codigo === "ISO45001")) {
      const y = (doc as any).lastAutoTable.finalY + 5
      doc.setFontSize(9)
      doc.text(`Ref. SG-SST 0312 (Art. 27): ${avance0312}% · ${valoracion0312(avance0312).label}`, 14, y)
    }

    // PHVA x norma
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [["Ciclo PHVA", ...normasMostradas.map((n) => n.nombre)]],
      body: CICLOS.map((c) => [
        CICLO_LABEL[c],
        ...normasMostradas.map((n) => {
          const cell = phva[n.codigo]?.[c]
          return cell && cell.total ? `${Math.round((cell.impl / cell.total) * 100)}%` : "—"
        }),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [13, 59, 110] },
    })

    // Brechas
    if (brechas.length) {
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 10,
        head: [["Brechas — Numeral sin evidencia", "Norma"]],
        body: brechas.map((b) => [b.numeral, b.norma.replace("ISO", "ISO ")]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [192, 57, 43] },
      })
    }

    // Objetivos y Metas del SIG
    if (objetivos.length) {
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 10,
        head: [["OBJETIVOS Y METAS (6.2)", "", "", "", ""]],
        body: [],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [94, 53, 177] },
      })
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY,
        head: [["Norma", "Objetivo", "Meta", "Valor actual", "Estado"]],
        body: objetivos.map((o) => [
          o.norma_codigo ?? "",
          o.objetivo,
          o.meta ?? "",
          o.valor_actual ?? "",
          (o.estado ?? "").replace("_", " "),
        ]),
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [13, 59, 110] },
        columnStyles: { 1: { cellWidth: 55 } },
      })
    }

    // Matriz Legal Ambiental (ISO 14001)
    if (legales.length) {
      const labelCumple: Record<string, string> = {
        cumple: "Cumple",
        parcial: "Parcial",
        no_cumple: "No cumple",
        no_aplica: "No aplica",
      }
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 8,
        head: [[`MATRIZ LEGAL AMBIENTAL — Cumplimiento: ${legalPct ?? "—"}%`, "", ""]],
        body: [],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [30, 132, 73] },
      })
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY,
        head: [["Norma legal", "Requisito", "Cumplimiento"]],
        body: legales.map((l) => [l.identificacion ?? "", l.requisito ?? "", labelCumple[l.cumple ?? ""] ?? l.cumple ?? ""]),
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [13, 59, 110] },
        columnStyles: { 1: { cellWidth: 80 } },
      })
    }

    // Listado Maestro (página nueva)
    doc.addPage()
    doc.setFontSize(13)
    doc.text(`Listado Maestro de Documentos (${maestroFiltrado.length})`, 14, 16)
    autoTable(doc, {
      startY: 22,
      head: [["Código", "Documento", "Proceso", "Ver.", "Estado", "Normas", "Último cambio"]],
      body: maestroFiltrado.map((it) => [
        it.documento.codigo ?? "",
        it.documento.nombre ?? "",
        it.documento.proceso ?? "",
        it.ultimaVersion?.version ?? it.documento.version ?? "",
        it.documento.estado ?? "",
        it.normas.map((nc) => nc.replace("ISO", "")).join(", "),
        it.ultimaVersion ? `${it.ultimaVersion.fecha ?? ""} ${it.ultimaVersion.tipo}` : "",
      ]),
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      headStyles: { fillColor: [13, 59, 110] },
      columnStyles: { 1: { cellWidth: 55 } },
    })

    doc.save(`Dashboard_SIG_${filtroNorma === "ALL" ? "Todas" : filtroNorma}.pdf`)
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
        Icon={LayoutDashboard}
        title="Dashboard SIG — Auditoría"
        subtitle={<>Estado integral del sistema{selectedEmpresaNombre ? ` — ${selectedEmpresaNombre}` : ""}</>}
        right={
          <Button size="sm" variant="outline" onClick={exportarPDF}>
            <Download className="mr-2 h-4 w-4" />
            Exportar PDF
          </Button>
        }
      />

      {/* Filtro por norma */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={filtroNorma === "ALL" ? "default" : "outline"}
          onClick={() => setFiltroNorma("ALL")}
        >
          Todas
        </Button>
        {visibles.map((n) => (
          <Button
            key={n.id}
            size="sm"
            variant={filtroNorma === n.codigo ? "default" : "outline"}
            onClick={() => setFiltroNorma(n.codigo)}
          >
            {n.nombre}
          </Button>
        ))}
      </div>

      {/* KPIs por norma */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {normasMostradas.map((n) => {
          const s = statsPorNorma[n.codigo] ?? { total: 0, cargados: 0, aprobados: 0, pendientes: 0 }
          // AVANCE REAL de la norma (no solo documental, no solo lo aprobado):
          // sin evidencia = 0 · documentado (cargado, sin verificar) = medio avance ·
          // verificado/eficaz = avance completo. Subir un documento NO es cumplir la
          // norma, pero sí es medio camino frente a no tener nada.
          const soloCargados = Math.max(0, s.cargados - s.aprobados) // cargado pero no verificado
          const pctDoc = s.total ? Math.round((s.cargados / s.total) * 100) : 0
          const pctVer = s.total ? Math.round((s.aprobados / s.total) * 100) : 0
          const pctAvance = s.total ? Math.round(((s.aprobados + soloCargados * 0.5) / s.total) * 100) : 0
          return (
            <Card key={n.id} className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: n.color ?? SST_TOKENS.navy }}>
                  {n.nombre}
                </span>
                <span className="text-lg font-bold" style={{ color: colorPct(pctAvance) }}>
                  {pctAvance}%
                </span>
              </div>
              <p className="lg-eyebrow">Avance real de la norma</p>
              <Progress value={pctAvance} className="mt-1 h-2" />
              <p className="mt-1.5 text-xs text-muted-foreground">
                {s.aprobados} verificados · {soloCargados} documentados (sin verificar) · {s.pendientes} sin evidencia · {s.total} aplican
              </p>
              <p className="text-[11px] text-muted-foreground">Documentado {pctDoc}% · Verificado {pctVer}%</p>
              {n.codigo === "ISO45001" && avance0312 != null && (
                <p className="mt-1 text-[11px] font-medium" style={{ color: valoracion0312(avance0312).color }}>
                  Ref. SG-SST 0312 (Art. 27): {avance0312}% · {valoracion0312(avance0312).label}
                </p>
              )}
            </Card>
          )
        })}
      </div>

      {/* Gráficas */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>
            Documental vs. Verificado por norma
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartNormas} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="norma" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
              <Tooltip formatter={(v: any) => `${v}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Implementación" fill={SST_TOKENS.teal} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Verificado" fill={SST_TOKENS.ok} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>
            Avance por ciclo PHVA (% implementación)
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartPHVA} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="ciclo" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
              <Tooltip formatter={(v: any) => `${v}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {normasMostradas.map((n) => (
                <Bar
                  key={n.id}
                  dataKey={n.codigo}
                  name={n.codigo.replace("ISO", "ISO ")}
                  fill={n.color ?? SST_TOKENS.navy}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Ambiental (ISO 14001) + Objetivos */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Aspectos significativos (14001)</p>
          <p className="text-2xl font-bold" style={{ color: SST_TOKENS.bad }}>
            {aspSignif}
            <span className="text-sm font-normal text-muted-foreground"> / {aspectos.length}</span>
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Cumplimiento legal ambiental</p>
          <p className="text-2xl font-bold" style={{ color: legalPct == null ? SST_TOKENS.ink : colorPct(legalPct) }}>
            {legalPct == null ? "—" : `${legalPct}%`}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Objetivos del SIG</p>
          <p className="text-2xl font-bold" style={{ color: SST_TOKENS.navy }}>{objetivos.length}</p>
          <p className="text-[11px] text-muted-foreground">
            {objCounts.cumplido} cumplidos · {objCounts.en_curso} en curso · {objCounts.atrasado} atrasados
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Documentos del SIG</p>
          <p className="text-2xl font-bold" style={{ color: SST_TOKENS.navy }}>{maestro.length}</p>
        </Card>
      </div>

      {/* Qué le falta a la norma (para llegar al 100% de avance real) */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" style={{ color: SST_TOKENS.bad }} />
          <span className="text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>
            Qué le falta a la norma
          </span>
        </div>
        {brechasPorEstado.faltaDocumentar.length === 0 && brechasPorEstado.faltaVerificar.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nada pendiente en el alcance seleccionado. 🎉</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {/* 1) Falta documentar */}
            <div>
              <p className="mb-1.5 text-xs font-semibold" style={{ color: SST_TOKENS.bad }}>
                Falta documentar — sin evidencia ({brechasPorEstado.faltaDocumentar.length})
              </p>
              {brechasPorEstado.faltaDocumentar.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Todo tiene al menos evidencia cargada.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {brechasPorEstado.faltaDocumentar.map((b, i) => (
                    <Badge key={`d-${b.norma}-${b.numeral}-${i}`} variant="outline" className="text-[11px]" title={b.tema}>
                      <span className="font-mono">{b.numeral}</span>
                      <span className="ml-1 text-muted-foreground">{b.norma.replace("ISO", "ISO ")}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {/* 2) Falta verificar */}
            <div>
              <p className="mb-1.5 text-xs font-semibold" style={{ color: SST_TOKENS.warn }}>
                Falta verificar — documentado sin aprobar ({brechasPorEstado.faltaVerificar.length})
              </p>
              {brechasPorEstado.faltaVerificar.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Nada pendiente de verificación.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {brechasPorEstado.faltaVerificar.map((b, i) => (
                    <Badge key={`v-${b.norma}-${b.numeral}-${i}`} variant="outline" className="text-[11px]" title={b.tema}>
                      <span className="font-mono">{b.numeral}</span>
                      <span className="ml-1 text-muted-foreground">{b.norma.replace("ISO", "ISO ")}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          El <strong>avance real</strong> sube al documentar lo que falta (medio avance) y se completa al
          <strong> verificar/aprobar</strong> la evidencia (avance total). Subir un documento no cierra el numeral por sí solo.
        </p>
      </Card>

      {/* Listado Maestro */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>
            Listado Maestro de Documentos ({maestroFiltrado.length})
          </span>
          <div className="relative w-56">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="h-8 pl-7 text-xs" />
          </div>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: SST_TOKENS.light }}>
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Código</th>
                <th className="px-3 py-2 font-semibold">Documento</th>
                <th className="px-3 py-2 font-semibold">Proceso</th>
                <th className="px-3 py-2 font-semibold">Ver.</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2 font-semibold">Normas</th>
                <th className="px-3 py-2 font-semibold">Último cambio</th>
              </tr>
            </thead>
            <tbody>
              {maestroFiltrado.map((it) => (
                <tr key={it.documento.id} className="border-b hover:bg-muted/40">
                  <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{it.documento.codigo}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: SST_TOKENS.navy }} />
                      {it.documento.nombre}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{it.documento.proceso ?? "-"}</td>
                  <td className="px-3 py-1.5 text-xs">{it.ultimaVersion?.version ?? it.documento.version ?? "-"}</td>
                  <td className="px-3 py-1.5 text-xs">{it.documento.estado ?? "-"}</td>
                  <td className="px-3 py-1.5">
                    <span className="flex flex-wrap gap-0.5">
                      {it.normas.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        it.normas.map((nc) => (
                          <Badge key={nc} variant="outline" className="text-[10px]">
                            {nc.replace("ISO", "")}
                          </Badge>
                        ))
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {it.ultimaVersion ? `${it.ultimaVersion.fecha ?? ""} · ${it.ultimaVersion.tipo}` : "—"}
                  </td>
                </tr>
              ))}
              {maestroFiltrado.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Sin documentos para el filtro actual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
