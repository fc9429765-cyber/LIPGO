"use client"

// Configuración › Bitácora de Auditoría.
// Historial de cada cambio (crear, editar, eliminar) que deja el trigger
// genérico `fn_auditoria` en las tablas del sistema. El proyecto lo define el
// SELECTOR GLOBAL (sin proyecto = todo LIP). Arriba, el resumen "quién hizo qué"
// (usuario × módulo × acción) permite responder de un vistazo preguntas como
// "¿qué cambió Yordin en la nómina del ID2 hoy?"; abajo, el detalle fila a fila
// con el registro afectado y los cambios en lenguaje corto.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { History, Search, Loader2, ChevronLeft, ChevronRight, User, X, Download, Users, ChevronDown, ChevronUp } from "lucide-react"
import * as XLSX from "xlsx"
import { getAuditoria, getAuditoriaActores, getAuditoriaExport, getAuditoriaModulos, getAuditoriaResumen } from "@/lib/auditoria-actions"
import { calcularDiff, cambiosCompactos, nombreRegistro, type AuditoriaResumenFila, type AuditoriaRow, type DiffCampo } from "@/lib/auditoria-types"

const PAGE_SIZE = 50
const BOGOTA_TZ = "America/Bogota"
const PLANTAS: Record<number, string> = { 1: "Indupan", 2: "Avimol", 3: "Cedi Funza", 4: "Cedi Medellín" }

const fmtFecha = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      timeZone: BOGOTA_TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    })
  } catch {
    return iso
  }
}
const fmtHora = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString("es-CO", { timeZone: BOGOTA_TZ, hour: "2-digit", minute: "2-digit", hour12: false })
  } catch {
    return ""
  }
}

function hoyBogota() {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: BOGOTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const [y, m, d] = iso.split("-").map(Number)
  return { y, m: m - 1, d }
}
const isoUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)

const opBadge = (op: string) =>
  op === "INSERT" ? "bg-green-100 text-green-800" : op === "DELETE" ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"
const opLabel = (op: string) => (op === "INSERT" ? "Creó" : op === "DELETE" ? "Eliminó" : "Editó")
const opPlural = (op: string) => (op === "INSERT" ? "creados" : op === "DELETE" ? "eliminados" : "editados")

function valorTexto(v: any): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

interface ResumenUsuario {
  actorId: string | null
  nombre: string
  total: number
  primero: string
  ultimo: string
  modulos: { modulo: string; total: number; ops: Record<string, number> }[]
}

export default function BitacoraAuditoria() {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const [rows, setRows] = useState<AuditoriaRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [actores, setActores] = useState<{ id: string; usuario: string }[]>([])
  const [modulos, setModulos] = useState<string[]>([])
  const [sel, setSel] = useState<AuditoriaRow | null>(null)
  const [resumen, setResumen] = useState<AuditoriaResumenFila[]>([])
  const [resumenParcial, setResumenParcial] = useState(false)
  const [resumenError, setResumenError] = useState<string | null>(null)
  const [resumenCargando, setResumenCargando] = useState(false)
  const [resumenAbierto, setResumenAbierto] = useState(true)
  const [exportando, setExportando] = useState(false)

  // Filtros (por defecto: hoy).
  const [desde, setDesde] = useState(() => {
    const { y, m, d } = hoyBogota()
    return isoUTC(y, m, d)
  })
  const [hasta, setHasta] = useState(() => {
    const { y, m, d } = hoyBogota()
    return isoUTC(y, m, d)
  })
  const [actorId, setActorId] = useState("todos")
  const [modulo, setModulo] = useState("todos")
  const [operacion, setOperacion] = useState("todos")
  const [busqueda, setBusqueda] = useState("")
  const [busquedaAplicada, setBusquedaAplicada] = useState("")

  useEffect(() => {
    getAuditoriaActores().then(setActores).catch(() => setActores([]))
    getAuditoriaModulos().then(setModulos).catch(() => setModulos([]))
  }, [])

  const filtro = useMemo(
    () => ({
      desde: desde || undefined,
      hasta: hasta || undefined,
      idempresa: selectedEmpresaId ?? undefined,
      actorId: actorId !== "todos" ? actorId : undefined,
      modulo: modulo !== "todos" ? modulo : undefined,
      operacion: operacion !== "todos" ? (operacion as any) : undefined,
      busqueda: busquedaAplicada || undefined,
    }),
    [desde, hasta, selectedEmpresaId, actorId, modulo, operacion, busquedaAplicada],
  )

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getAuditoria({ ...filtro, page, pageSize: PAGE_SIZE })
      setRows(r.rows)
      setTotal(r.total)
    } finally {
      setLoading(false)
    }
  }, [filtro, page])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Resumen: se recalcula al cambiar filtros (no al paginar).
  useEffect(() => {
    let vivo = true
    setResumenCargando(true)
    getAuditoriaResumen(filtro).then((r) => {
      if (!vivo) return
      setResumen(r.filas)
      setResumenParcial(r.parcial)
      setResumenError(r.error ? (/timeout/i.test(r.error) ? "La consulta tardó demasiado. Acorta el rango de fechas o filtra por usuario o módulo." : r.error) : null)
      setResumenCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [filtro])

  // Al cambiar un filtro, volver a la página 0.
  useEffect(() => {
    setPage(0)
  }, [filtro])

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const diff = useMemo<DiffCampo[]>(() => (sel ? calcularDiff(sel.antes, sel.despues, sel.campos_cambiados) : []), [sel])

  const porUsuario = useMemo<ResumenUsuario[]>(() => {
    const m = new Map<string, ResumenUsuario>()
    for (const f of resumen) {
      const k = f.actor_id ?? `__${f.actor_nombre}`
      let u = m.get(k)
      if (!u) {
        u = { actorId: f.actor_id, nombre: f.actor_nombre, total: 0, primero: f.primero, ultimo: f.ultimo, modulos: [] }
        m.set(k, u)
      }
      u.total += f.n
      if (f.primero < u.primero) u.primero = f.primero
      if (f.ultimo > u.ultimo) u.ultimo = f.ultimo
      let mod = u.modulos.find((x) => x.modulo === f.modulo)
      if (!mod) {
        mod = { modulo: f.modulo, total: 0, ops: {} }
        u.modulos.push(mod)
      }
      mod.total += f.n
      mod.ops[f.operacion] = (mod.ops[f.operacion] || 0) + f.n
    }
    const lista = [...m.values()]
    for (const u of lista) u.modulos.sort((a, b) => b.total - a.total)
    // Personas primero (el "sistema" al final), y de mayor a menor actividad.
    return lista.sort((a, b) => Number(a.actorId === null) - Number(b.actorId === null) || b.total - a.total)
  }, [resumen])
  const totalResumen = useMemo(() => resumen.reduce((s, f) => s + f.n, 0), [resumen])

  const aplicarPreset = (p: "hoy" | "ayer" | "semana" | "mes") => {
    const { y, m, d } = hoyBogota()
    const hoy = isoUTC(y, m, d)
    if (p === "hoy") {
      setDesde(hoy)
      setHasta(hoy)
    } else if (p === "ayer") {
      const a = isoUTC(y, m, d - 1)
      setDesde(a)
      setHasta(a)
    } else if (p === "semana") {
      const dow = new Date(Date.UTC(y, m, d)).getUTCDay() // 0 = domingo
      setDesde(isoUTC(y, m, d - ((dow + 6) % 7)))
      setHasta(hoy)
    } else {
      setDesde(isoUTC(y, m, 1))
      setHasta(hoy)
    }
  }

  const limpiar = () => {
    setDesde("")
    setHasta("")
    setActorId("todos")
    setModulo("todos")
    setOperacion("todos")
    setBusqueda("")
    setBusquedaAplicada("")
  }

  const verDe = (u: ResumenUsuario, mod?: string) => {
    setActorId(u.actorId ?? "__sistema__")
    setModulo(mod ?? "todos")
    document.getElementById("bitacora-detalle")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const exportar = async () => {
    setExportando(true)
    try {
      const r = await getAuditoriaExport(filtro)
      if (r.error) return
      const wb = XLSX.utils.book_new()
      const hoja = [
        ["Fecha y hora", "Usuario", "ID", "Módulo", "Tabla", "Acción", "Registro", "Cambios", "Id registro"],
        ...r.rows.map((x) => [fmtFecha(x.ts), x.actor_nombre, x.idempresa ?? "", x.modulo || x.tabla, x.tabla, opLabel(x.operacion), nombreRegistro(x), cambiosCompactos(x, 20).join(" | "), x.registro_id ?? ""]),
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hoja), "Bitácora")
      const res = [["Usuario", "Módulo", "Tabla", "Acción", "Cantidad", "Primero", "Último"], ...resumen.map((f) => [f.actor_nombre, f.modulo, f.tabla, opLabel(f.operacion), f.n, fmtFecha(f.primero), fmtFecha(f.ultimo)])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(res), "Resumen")
      const suf = `${selectedEmpresaId ? `ID${selectedEmpresaId}` : "LIP"}-${desde || "inicio"}_${hasta || "hoy"}`
      XLSX.writeFile(wb, `bitacora-auditoria-${suf}.xlsx`)
    } finally {
      setExportando(false)
    }
  }

  const tituloAmbito = selectedEmpresaId ? selectedEmpresaNombre || PLANTAS[selectedEmpresaId] || `ID${selectedEmpresaId}` : "todo LIP"

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Bitácora de Auditoría</h1>
            <p className="text-[13px] text-muted-foreground">
              Cada cambio (crear, editar, eliminar) en <b className="text-foreground">{tituloAmbito}</b>. El proyecto lo define el selector global. Click en una fila para ver el antes y después.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportar} disabled={exportando || loading || total === 0} className="gap-1.5">
          {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1">
              <Label className="text-[11px]">Desde</Label>
              <DatePickerField value={desde} onChange={setDesde} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Hasta</Label>
              <DatePickerField value={hasta} onChange={setHasta} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Usuario</Label>
              <Select value={actorId} onValueChange={setActorId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {actores.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.usuario}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Módulo</Label>
              <Select value={modulo} onValueChange={setModulo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {modulos.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Acción</Label>
              <Select value={operacion} onValueChange={setOperacion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  <SelectItem value="INSERT">Creación</SelectItem>
                  <SelectItem value="UPDATE">Edición</SelectItem>
                  <SelectItem value="DELETE">Eliminación</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Buscar</Label>
              <div className="flex gap-1">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-7"
                    placeholder="descripción, registro…"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && setBusquedaAplicada(busqueda)}
                  />
                </div>
                <Button variant="outline" size="icon" onClick={() => setBusquedaAplicada(busqueda)} title="Buscar">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => aplicarPreset("hoy")}>Hoy</Button>
            <Button variant="outline" size="sm" onClick={() => aplicarPreset("ayer")}>Ayer</Button>
            <Button variant="outline" size="sm" onClick={() => aplicarPreset("semana")}>Esta semana</Button>
            <Button variant="outline" size="sm" onClick={() => aplicarPreset("mes")}>Este mes</Button>
            <Button variant="ghost" size="sm" onClick={limpiar} className="ml-auto gap-1 text-muted-foreground">
              <X className="h-3.5 w-3.5" /> Limpiar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumen: quién hizo qué */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" /> Quién hizo qué
              </CardTitle>
              <CardDescription>
                {totalResumen.toLocaleString("es-CO")} cambio(s) con los filtros actuales, agrupados por usuario y módulo. Click en un módulo para ver solo ese detalle abajo.
                {resumenParcial && <span className="text-amber-700"> Resumen incompleto (demasiados registros o grupos): acorta el rango de fechas o filtra por usuario o módulo.</span>}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setResumenAbierto((v) => !v)} className="gap-1">
              {resumenAbierto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {resumenAbierto ? "Ocultar" : "Mostrar"}
            </Button>
          </div>
        </CardHeader>
        {resumenAbierto && (
          <CardContent>
            {resumenError ? (
              <p className="text-sm text-amber-800">{resumenError}</p>
            ) : resumenCargando && porUsuario.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Calculando…</p>
            ) : porUsuario.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin cambios con los filtros actuales.</p>
            ) : (
              <div className="divide-y">
                {porUsuario.map((u) => (
                  <div key={u.actorId ?? u.nombre} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 py-2">
                    <button type="button" onClick={() => verDe(u)} className="flex min-w-[220px] items-center gap-1.5 text-left hover:text-primary" title="Ver todo lo de este usuario">
                      <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{u.nombre}</span>
                      <Badge variant="secondary" className="tabular-nums">{u.total}</Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {fmtHora(u.primero)}–{fmtHora(u.ultimo)}
                      </span>
                    </button>
                    <div className="flex flex-1 flex-wrap gap-1.5">
                      {u.modulos.map((m) => (
                        <button
                          key={m.modulo}
                          type="button"
                          onClick={() => verDe(u, m.modulo)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] hover:border-primary hover:text-primary ${modulo === m.modulo && actorId === (u.actorId ?? "__sistema__") ? "border-primary bg-primary/10 text-primary" : "bg-muted/40"}`}
                          title={Object.entries(m.ops).map(([op, n]) => `${n} ${opPlural(op)}`).join(" · ")}
                        >
                          {m.modulo}: {Object.entries(m.ops).map(([op, n]) => `${n} ${opPlural(op)}`).join(" · ")}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <div id="bitacora-detalle" className="flex items-center justify-between">
        <div className="text-[13px] text-muted-foreground">
          {loading ? "Cargando…" : `${total.toLocaleString("es-CO")} registro(s)`}
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha y hora</TableHead>
              <TableHead>Usuario</TableHead>
              {!selectedEmpresaId && <TableHead>ID</TableHead>}
              <TableHead>Módulo</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Registro</TableHead>
              <TableHead>Cambios</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No hay cambios con los filtros actuales.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const cambios = cambiosCompactos(r)
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSel(r)}>
                    <TableCell className="whitespace-nowrap tabular-nums text-[13px]">{fmtFecha(r.ts)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{r.actor_nombre}</span>
                      </div>
                    </TableCell>
                    {!selectedEmpresaId && <TableCell className="text-[12px] text-muted-foreground">{r.idempresa ? PLANTAS[r.idempresa] ?? `ID${r.idempresa}` : ""}</TableCell>}
                    <TableCell className="text-[13px]">{r.modulo || r.tabla}</TableCell>
                    <TableCell>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${opBadge(r.operacion)}`}>{opLabel(r.operacion)}</span>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-[13px] font-medium" title={nombreRegistro(r)}>{nombreRegistro(r)}</TableCell>
                    <TableCell className="max-w-md text-[12px] text-muted-foreground">
                      {cambios.length ? (
                        <span className="line-clamp-2" title={cambios.join(" | ")}>{cambios.join(" · ")}</span>
                      ) : (
                        <span className="truncate">{r.descripcion}</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-muted-foreground">
          Página {page + 1} de {totalPaginas}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPaginas - 1 || loading} onClick={() => setPage((p) => p + 1)} className="gap-1">
            Siguiente <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Modal detalle antes/después */}
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {sel && (
                <>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${opBadge(sel.operacion)}`}>{opLabel(sel.operacion)}</span>
                  <span>{sel.modulo || sel.tabla}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    · {sel.actor_nombre} · {fmtFecha(sel.ts)}
                  </span>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {sel && (
            <div className="space-y-3">
              <div className="text-[13px] text-muted-foreground">
                <b className="text-foreground">{nombreRegistro(sel)}</b>
                {sel.idempresa ? <> · {PLANTAS[sel.idempresa] ?? `ID${sel.idempresa}`}</> : null}
                {" · "}Tabla <code className="rounded bg-muted px-1">{sel.tabla}</code>
                {sel.registro_id ? <> · registro <code className="rounded bg-muted px-1">{sel.registro_id}</code></> : null}
                {" — "}{sel.descripcion}
              </div>
              <div className="max-h-[55vh] overflow-auto rounded-md border">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-muted/60">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-semibold">Campo</th>
                      <th className="px-3 py-2 font-semibold">Antes</th>
                      <th className="px-3 py-2 font-semibold">Después</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.map((d) => {
                      const resalta = d.estado !== "igual"
                      return (
                        <tr key={d.campo} className={`border-t align-top ${resalta ? "bg-amber-50" : ""}`}>
                          <td className="px-3 py-1.5 font-medium">{d.campo}</td>
                          <td className={`px-3 py-1.5 ${d.estado === "cambiado" || d.estado === "eliminado" ? "text-red-700" : "text-muted-foreground"}`}>
                            {sel.operacion === "INSERT" ? "—" : valorTexto(d.antes)}
                          </td>
                          <td className={`px-3 py-1.5 ${d.estado === "cambiado" || d.estado === "agregado" ? "text-green-700" : "text-muted-foreground"}`}>
                            {sel.operacion === "DELETE" ? "—" : valorTexto(d.despues)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
