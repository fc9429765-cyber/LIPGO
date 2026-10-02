"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { getAntecedentes, deleteAntecedente, decidirAntecedente, verificarCodigoCompliance, sincronizarAntecedentesDesdeHeadcount, type Antecedente } from "@/lib/antecedentes-actions"
import { getHojasVida, type HojaDeVida } from "@/lib/hojas-vida-actions"
import { Badge } from "@/components/ui/badge"
import { RadialBar, RadialBarChart, ResponsiveContainer, PolarAngleAxis } from "recharts"
import { Plus, Trash2, Eye, Download, Search, ShieldCheck, Loader2, Check, Users, AlertTriangle, ShieldAlert, FileText, Ban, Lock } from "lucide-react"

// Acceso a los 3 tipos de certificado de forma uniforme.
const TIPOS = [
  { key: "policia", label: "Policía" },
  { key: "procuraduria", label: "Procuraduría" },
  { key: "contraloria", label: "Contraloría" },
] as const

// Tipos de documento soportados por Compliance (los más usados).
const TIPOS_DOC = [
  { v: "cc", l: "Cédula de ciudadanía" },
  { v: "ce", l: "Cédula de extranjería" },
  { v: "ti", l: "Tarjeta de identidad" },
  { v: "nit", l: "NIT" },
  { v: "pas", l: "Pasaporte" },
] as const

// Score de riesgo: 0-50 rojo (riesgo), 51-84 amarillo (advertencia),
// 85-100 verde (sin novedad).
function colorScore(v: number): string {
  return v <= 50 ? "#dc2626" : v <= 84 ? "#f59e0b" : "#16a34a"
}

function ScoreGauge({ score }: { score: number }) {
  const fill = colorScore(score)
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <ResponsiveContainer width={170} height={110}>
          <RadialBarChart cx="50%" cy="85%" innerRadius="72%" outerRadius="100%" startAngle={180} endAngle={0} data={[{ value: score }]} barSize={16}>
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar background={{ fill: "var(--muted)" }} dataKey="value" cornerRadius={8} angleAxisId={0} fill={fill} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color: fill }}>{score}</span>
          <span className="text-sm text-muted-foreground">/100</span>
        </div>
      </div>
      <span className="text-xs font-medium" style={{ color: fill }}>
        {score <= 50 ? "Presenta riesgo" : score <= 84 ? "Advertencia" : "Sin novedad"}
      </span>
    </div>
  )
}

// Los strings de "descripcion" traen columnas separadas por "|" y filas por "\n".
function limpiarDescripcion(desc?: string[]): string[] {
  if (!desc || !desc.length) return []
  return desc.flatMap((d) => String(d).split(/\n/).map((l) => l.trim()).filter(Boolean))
}

export default function Antecedentes() {
  const { selectedEmpresaId } = useAuth()
  const { toast } = useToast()
  const [antecedentes, setAntecedentes] = useState<Antecedente[]>([])
  const [hojas, setHojas] = useState<HojaDeVida[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Candidato seleccionado (desde una hoja de vida) y archivos.
  const [candidato, setCandidato] = useState<HojaDeVida | null>(null)
  const [candidatoSearch, setCandidatoSearch] = useState("")
  const [policia, setPolicia] = useState<File | null>(null)
  const [procuraduria, setProcuraduria] = useState<File | null>(null)
  const [contraloria, setContraloria] = useState<File | null>(null)

  // Consultar antecedentes (API Compliance).
  const [consultaOpen, setConsultaOpen] = useState(false)
  const [consultaCedula, setConsultaCedula] = useState("")
  const [consultaNombre, setConsultaNombre] = useState("")
  const [consultaTipoDoc, setConsultaTipoDoc] = useState("cc")
  const [consultando, setConsultando] = useState(false)
  const [consultaResult, setConsultaResult] = useState<any | null>(null)
  const [consultaError, setConsultaError] = useState<string | null>(null)
  const [decidiendo, setDecidiendo] = useState<null | "aceptado" | "rechazado">(null)
  const [decision, setDecision] = useState<null | "aceptado" | "rechazado">(null)
  // Código de acceso que protege la investigación.
  const [codigoAcceso, setCodigoAcceso] = useState("")
  const [desbloqueado, setDesbloqueado] = useState(false)
  const [verificandoCodigo, setVerificandoCodigo] = useState(false)
  const [codigoError, setCodigoError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    const [antRes, hvRes] = await Promise.all([
      getAntecedentes(selectedEmpresaId),
      getHojasVida(selectedEmpresaId),
    ])
    setAntecedentes(antRes.success ? antRes.data : [])
    setHojas(hvRes.success ? hvRes.data : [])
    setLoading(false)
  }

  const handleSync = async () => {
    setSyncing(true)
    const res = await sincronizarAntecedentesDesdeHeadcount(selectedEmpresaId)
    setSyncing(false)
    if (res.success) {
      toast({
        title: "Sincronizado con Head Count",
        description: `${res.creadas} traído(s), ${res.actualizadas} actualizado(s).`,
      })
      loadData()
    } else {
      toast({ title: "No se pudo sincronizar", description: res.message })
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const resetForm = () => {
    setCandidato(null)
    setCandidatoSearch("")
    setPolicia(null)
    setProcuraduria(null)
    setContraloria(null)
  }

  // Hojas de vida que coinciden con la busqueda (por cedula o nombre).
  const candidatosFiltrados = useMemo(() => {
    const q = candidatoSearch.trim().toLowerCase()
    if (!q) return hojas.slice(0, 25)
    return hojas
      .filter(
        (h) =>
          h.nombre_candidato.toLowerCase().includes(q) ||
          (h.cedula?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 25)
  }, [hojas, candidatoSearch])

  const handleUpload = async () => {
    if (!candidato) {
      toast({ title: "Falta el candidato", description: "Selecciona una hoja de vida." })
      return
    }
    if (!policia && !procuraduria && !contraloria) {
      toast({ title: "Faltan archivos", description: "Adjunta al menos un certificado." })
      return
    }

    setUploading(true)
    try {
      const fd = new FormData()
      if (selectedEmpresaId) fd.append("empresaId", String(selectedEmpresaId))
      fd.append("hoja_vida_id", candidato.id)
      fd.append("cedula", candidato.cedula || "")
      fd.append("nombre", candidato.nombre_candidato)
      if (policia) fd.append("policia", policia)
      if (procuraduria) fd.append("procuraduria", procuraduria)
      if (contraloria) fd.append("contraloria", contraloria)

      const res = await fetch("/api/antecedentes/upload", { method: "POST", body: fd })
      const json = await res.json()

      if (!res.ok) {
        toast({ title: "Error", description: json.error || "No se pudieron subir los antecedentes." })
        return
      }

      toast({ title: "Antecedentes guardados" })
      setOpen(false)
      resetForm()
      loadData()
    } catch (err) {
      toast({ title: "Error", description: "Ocurrió un error al subir los archivos." })
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este registro de antecedentes? Esta acción no se puede deshacer.")) return
    const result = await deleteAntecedente(id)
    if (result.success) {
      toast({ title: "Antecedentes eliminados" })
      loadData()
    } else {
      toast({ title: "Error", description: result.message || "No se pudo eliminar." })
    }
  }

  const abrirConsulta = () => {
    setConsultaResult(null)
    setConsultaError(null)
    setDesbloqueado(false)
    setCodigoAcceso("")
    setCodigoError(null)
    setConsultaOpen(true)
  }

  const handleDesbloquear = async () => {
    if (!codigoAcceso.trim()) {
      setCodigoError("Ingresa el código de acceso.")
      return
    }
    setVerificandoCodigo(true)
    setCodigoError(null)
    try {
      const res = await verificarCodigoCompliance(codigoAcceso)
      if (res.ok) {
        setDesbloqueado(true)
      } else {
        setCodigoError("Código incorrecto.")
      }
    } catch {
      setCodigoError("No se pudo verificar el código.")
    } finally {
      setVerificandoCodigo(false)
    }
  }

  const handleConsultar = async () => {
    const ced = consultaCedula.trim()
    if (!ced) {
      toast({ title: "Falta el documento", description: "Escribe el número de documento a consultar." })
      return
    }
    setConsultando(true)
    setConsultaError(null)
    setConsultaResult(null)
    setDecision(null)
    try {
      // Si la cédula coincide con una hoja de vida, enlazamos y autollenamos nombre.
      const hoja = hojas.find((h) => (h.cedula || "").trim() === ced)
      const res = await fetch("/api/antecedentes/consultar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cedula: ced,
          nombre: consultaNombre.trim() || hoja?.nombre_candidato || undefined,
          tipoDocumento: consultaTipoDoc,
          empresaId: selectedEmpresaId || undefined,
          hojaVidaId: hoja?.id || undefined,
          codigo: codigoAcceso,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setConsultaError(json.error || "No se pudo realizar la consulta.")
        return
      }
      setConsultaResult(json)
      if (json.aviso) toast({ title: "Consulta realizada", description: json.aviso })
      loadData()
    } catch (err) {
      setConsultaError("Ocurrió un error de red al consultar. Intenta de nuevo.")
    } finally {
      setConsultando(false)
    }
  }

  const handleDecidir = async (estado: "aceptado" | "rechazado") => {
    const c = consultaResult?.consolidado
    if (!c) return
    const ced = String(c.datoConsultado || consultaCedula).trim()
    const hoja = hojas.find((h) => (h.cedula || "").trim() === ced)
    setDecidiendo(estado)
    try {
      const res = await decidirAntecedente({
        empresaId: selectedEmpresaId,
        cedula: ced,
        nombre: c.nombre,
        hojaVidaId: hoja?.id || null,
        idDatoConsultado: c.idDatoConsultado ?? null,
        scoreRiesgo: consultaResult?.score?.scoreRiesgo ?? null,
        presentaRiesgo: c.presentaRiesgo ?? null,
        pep: c.pep ?? null,
        pdfUrl: consultaResult?.pdfUrl ?? null,
        pdfNombre: `Antecedentes ${ced}.pdf`,
        estado,
      })
      if (res.success) {
        setDecision(estado)
        toast({
          title: estado === "aceptado" ? "Persona aceptada" : "Persona rechazada",
          description:
            estado === "aceptado"
              ? "Antecedentes registrados y enviados a la hoja de vida."
              : "Antecedentes rechazados; la contratación queda bloqueada.",
        })
        loadData()
      } else {
        toast({ title: "No se pudo guardar la decisión", description: res.message })
      }
    } catch {
      toast({ title: "Error", description: "Ocurrió un error al guardar la decisión." })
    } finally {
      setDecidiendo(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return antecedentes
    return antecedentes.filter(
      (a) =>
        a.nombre.toLowerCase().includes(q) || (a.cedula?.toLowerCase().includes(q) ?? false),
    )
  }, [antecedentes, search])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Antecedentes
          </h1>
          <p className="text-sm text-muted-foreground">
            Carga los certificados de Policía, Procuraduría y Contraloría por candidato.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
        <Button onClick={abrirConsulta} title="Investigación en Compliance por número de documento (protegida por código)">
          <Search className="mr-2 h-4 w-4" />
          Investigación en Compliance
        </Button>
        <Button variant="outline" onClick={handleSync} disabled={syncing} title="Trae los antecedentes ya cargados en Head Count">
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
          Sincronizar desde Head Count
        </Button>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o)
            if (!o) resetForm()
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Cargar antecedentes
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Nuevos antecedentes</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Selector de candidato por cedula o nombre (desde hojas de vida) */}
              <div className="space-y-1.5">
                <Label>
                  Candidato (cédula o nombre) <span className="text-destructive">*</span>
                </Label>
                {candidato ? (
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
                    <div className="text-sm">
                      <span className="font-medium text-foreground">{candidato.nombre_candidato}</span>
                      <span className="text-muted-foreground"> · {candidato.cedula || "sin cédula"}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCandidato(null)
                        setCandidatoSearch("")
                      }}
                    >
                      Cambiar
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Buscar por cédula o nombre..."
                        value={candidatoSearch}
                        onChange={(e) => setCandidatoSearch(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                      {candidatosFiltrados.length === 0 ? (
                        <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                          No hay hojas de vida que coincidan.
                        </p>
                      ) : (
                        candidatosFiltrados.map((h) => (
                          <button
                            key={h.id}
                            type="button"
                            onClick={() => setCandidato(h)}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <span>
                              <span className="font-medium text-foreground">{h.nombre_candidato}</span>
                              <span className="text-muted-foreground"> · {h.cedula || "sin cédula"}</span>
                            </span>
                            <Check className="h-4 w-4 opacity-0" />
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* 3 archivos de antecedentes */}
              <div className="space-y-1.5">
                <Label htmlFor="policia">Certificado de Policía</Label>
                <Input
                  id="policia"
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={(e) => setPolicia(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="procuraduria">Certificado de Procuraduría</Label>
                <Input
                  id="procuraduria"
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={(e) => setProcuraduria(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contraloria">Certificado de Contraloría</Label>
                <Input
                  id="contraloria"
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={(e) => setContraloria(e.target.files?.[0] ?? null)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={uploading}>
                  Cancelar
                </Button>
                <Button onClick={handleUpload} disabled={uploading}>
                  {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {uploading ? "Subiendo..." : "Guardar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre o cédula..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidato</TableHead>
              <TableHead>Cédula</TableHead>
              <TableHead>Policía</TableHead>
              <TableHead>Procuraduría</TableHead>
              <TableHead>Contraloría</TableHead>
              <TableHead>Verificación</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No hay antecedentes registrados.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((a) => {
                const archivos: Record<string, { url: string | null; nombre: string | null }> = {
                  policia: { url: a.policia_url, nombre: a.policia_nombre },
                  procuraduria: { url: a.procuraduria_url, nombre: a.procuraduria_nombre },
                  contraloria: { url: a.contraloria_url, nombre: a.contraloria_nombre },
                }
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.nombre}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.cedula || "—"}</TableCell>
                    {TIPOS.map((t) => {
                      const archivo = archivos[t.key]
                      return (
                        <TableCell key={t.key}>
                          {archivo.url ? (
                            <div className="flex gap-1">
                              <Button variant="outline" size="sm" asChild title={`Ver ${t.label}`}>
                                <a href={archivo.url} target="_blank" rel="noopener noreferrer">
                                  <Eye className="h-4 w-4" />
                                </a>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                                title={`Descargar ${t.label}`}
                              >
                                <a href={archivo.url} download={archivo.nombre || undefined}>
                                  <Download className="h-4 w-4" />
                                </a>
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-sm">
                      {a.estado && a.estado !== "pendiente" ? (
                        <div className="space-y-1">
                          <Badge
                            style={{ background: a.estado === "aceptado" ? "#16a34a" : "#dc2626", color: "white" }}
                            className="gap-1"
                          >
                            {a.estado === "aceptado" ? <Check className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                            {a.estado === "aceptado" ? "Aceptado" : "Rechazado"}
                          </Badge>
                          <div className="flex items-center gap-2">
                            {typeof a.score_riesgo === "number" && (
                              <span
                                className="font-mono text-[10px]"
                                style={{ color: a.score_riesgo <= 50 ? "#dc2626" : a.score_riesgo <= 84 ? "#f59e0b" : "#16a34a" }}
                              >
                                score {a.score_riesgo}
                              </span>
                            )}
                            {a.compliance_pdf_url && (
                              <a
                                href={a.compliance_pdf_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                              >
                                <FileText className="h-3 w-3" /> PDF
                              </a>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(a.id)}
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* CONSULTAR ANTECEDENTES (API Compliance) */}
      <Dialog open={consultaOpen} onOpenChange={setConsultaOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" /> Investigación en Compliance
            </DialogTitle>
          </DialogHeader>

          {!desbloqueado ? (
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>Función protegida. Ingresa el código de acceso para hacer la investigación en Compliance.</span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="c-codigo">Código de acceso</Label>
                  <Input
                    id="c-codigo"
                    type="password"
                    value={codigoAcceso}
                    onChange={(e) => setCodigoAcceso(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !verificandoCodigo) handleDesbloquear() }}
                    placeholder="••••••••"
                  />
                </div>
                <Button onClick={handleDesbloquear} disabled={verificandoCodigo}>
                  {verificandoCodigo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                  Ingresar
                </Button>
              </div>
              {codigoError && (
                <p className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" /> {codigoError}
                </p>
              )}
            </div>
          ) : (
          <>
          {/* Formulario */}
          <div className="grid gap-3 sm:grid-cols-[160px_1fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="c-tipo">Tipo de documento</Label>
              <select
                id="c-tipo"
                value={consultaTipoDoc}
                onChange={(e) => setConsultaTipoDoc(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {TIPOS_DOC.map((t) => (
                  <option key={t.v} value={t.v}>{t.l}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-ced">Número de documento</Label>
              <Input
                id="c-ced"
                inputMode="numeric"
                placeholder="Ej. 19123402"
                value={consultaCedula}
                onChange={(e) => setConsultaCedula(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !consultando) handleConsultar() }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-nom">Nombre (opcional)</Label>
              <Input
                id="c-nom"
                placeholder="Se autollenará si la cédula está en Hojas de Vida"
                value={consultaNombre}
                onChange={(e) => setConsultaNombre(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleConsultar} disabled={consultando}>
              {consultando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              {consultando ? "Consultando..." : "Consultar"}
            </Button>
            {consultando && <span className="text-xs text-muted-foreground">La consulta puede tardar; consultamos ~46 fuentes.</span>}
          </div>

          {consultaError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{consultaError}</span>
            </div>
          )}

          {/* Resultado */}
          {consultaResult?.consolidado && (() => {
            const c = consultaResult.consolidado
            const score = consultaResult.score
            const pdfUrl: string | null = consultaResult.pdfUrl
            const idDato = c.idDatoConsultado
            return (
              <div className="space-y-4 border-t border-border pt-4">
                {/* Cabecera + badges */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-foreground">{c.nombre || "Sin nombre"}</p>
                    <p className="text-sm text-muted-foreground">{c.tipoDocumento?.toUpperCase()} {c.datoConsultado}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge style={{ background: c.presentaRiesgo ? "#dc2626" : "#16a34a", color: "white" }}>
                      {c.presentaRiesgo ? "Presenta riesgo" : "Sin riesgo"}
                    </Badge>
                    {c.pep && <Badge style={{ background: "#f59e0b", color: "white" }}>PEP</Badge>}
                    {c.isMenorEdad && <Badge variant="outline">Menor de edad</Badge>}
                    <Badge variant="secondary">{c.totalFuentesConsultadas ?? 0} fuentes</Badge>
                    {(c.totalFuentesConError ?? 0) > 0 && (
                      <Badge variant="outline" className="text-destructive">{c.totalFuentesConError} con error</Badge>
                    )}
                  </div>
                </div>

                {/* Decisión: aceptar / rechazar */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
                  <span className="text-sm font-medium text-foreground">Decisión:</span>
                  {decision ? (
                    <Badge style={{ background: decision === "aceptado" ? "#16a34a" : "#dc2626", color: "white" }} className="gap-1">
                      {decision === "aceptado" ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                      {decision === "aceptado" ? "Aceptada" : "Rechazada"}
                    </Badge>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => handleDecidir("aceptado")} disabled={!!decidiendo} className="bg-green-600 text-white hover:bg-green-700">
                        {decidiendo === "aceptado" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                        Aceptar
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleDecidir("rechazado")} disabled={!!decidiendo}>
                        {decidiendo === "rechazado" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                        Rechazar
                      </Button>
                    </>
                  )}
                  <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
                    Genera el registro, guarda el PDF y lo envía a la hoja de vida.
                  </span>
                </div>

                {/* Score de riesgo */}
                {score?.mostrarScore ? (
                  <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
                    <ScoreGauge score={Number(score.scoreRiesgo) || 0} />
                    <div className="grid flex-1 gap-2">
                      {([["Operacional", "%RO"], ["LAFT", "%LAFT"], ["Reputacional", "%RR"]] as const).map(([lbl, key]) => {
                        const v = Number((score as any)[key]) || 0
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <span className="w-24 text-xs text-muted-foreground">{lbl}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(Math.max(v, 0), 100)}%` }} />
                            </div>
                            <span className="w-12 text-right text-xs font-mono tabular-nums">{v}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Este documento no tiene score de riesgo disponible.</p>
                )}

                {/* Descarga de PDF */}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <a href={pdfUrl || `/api/antecedentes/reporte-pdf?id=${idDato}&tipo=completo`} target="_blank" rel="noopener noreferrer">
                      <FileText className="mr-2 h-4 w-4" /> PDF Completo
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/api/antecedentes/reporte-pdf?id=${idDato}&tipo=resumido`}>
                      <Download className="mr-2 h-4 w-4" /> Resumido
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/api/antecedentes/reporte-pdf?id=${idDato}&tipo=analista`}>
                      <Download className="mr-2 h-4 w-4" /> Analista básico
                    </a>
                  </Button>
                </div>

                {/* Fuentes consultadas */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">Fuentes consultadas ({(c.resultados || []).length})</p>
                  {(c.resultados || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay resultados con riesgo para este documento.</p>
                  ) : (
                    (c.resultados as any[]).map((r, i) => {
                      const lineas = limpiarDescripcion(r.descripcion)
                      return (
                        <div key={i} className="rounded-md border border-border p-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">{r.lista}</span>
                            {r.tipo && <span className="text-[11px] uppercase text-muted-foreground">{r.tipo}</span>}
                            {r.presentaRiesgo && (
                              <Badge style={{ background: "#dc2626", color: "white" }} className="gap-1">
                                <ShieldAlert className="h-3 w-3" /> Riesgo
                              </Badge>
                            )}
                            {r.presentaAdvertencia && <Badge style={{ background: "#f59e0b", color: "white" }}>Advertencia</Badge>}
                            {r.deshabilitada && <Badge variant="outline">Deshabilitada</Badge>}
                          </div>
                          {r.error && <p className="mt-1 text-xs text-destructive">{r.error}</p>}
                          {lineas.length > 0 && (
                            <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                              {lineas.map((l, j) => (
                                <li key={j} className="leading-snug">{l.replace(/\|/g, " · ")}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {consultaResult.guardado && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-primary" /> Consulta guardada en el historial.
                  </p>
                )}
              </div>
            )
          })()}
          </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
