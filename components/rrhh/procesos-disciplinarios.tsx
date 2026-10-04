"use client"

// PROCESOS DISCIPLINARIOS
//
// Izquierda: radicar la solicitud de medida. Derecha: los casos y su trámite.
//
// La empresa usuaria REPORTA y SOLICITA; el empleador --la temporal-- cita a
// descargos y decide. La pantalla lo dice en todas partes porque confundirlo
// tiene consecuencias: una sanción impuesta sin oír al trabajador es ineficaz.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { AlertTriangle, Check, ChevronsUpDown, Download, FileText, Loader2, Scale, Shield } from "lucide-react"
import {
  avanzarEstadoDisciplinario,
  crearProcesoDisciplinario,
  getDisciplinarios,
  guardarActaDisciplinaria,
} from "@/lib/disciplinarios-actions"
import {
  CONDUCTAS,
  MEDIDAS_APLICABLES,
  conductaPorId,
  estadoMeta,
} from "@/lib/disciplinarios-catalogo"
import { generarPdfDisciplinario } from "@/lib/pdf-disciplinario"
import type { DisciplinariosData, ProcesoDisciplinario } from "@/lib/disciplinarios-tipos"

function hoyColombia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export default function ProcesosDisciplinarios() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const [data, setData] = useState<DisciplinariosData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [generando, setGenerando] = useState<string | null>(null)

  // Formulario
  const [comboAbierto, setComboAbierto] = useState(false)
  const [persona, setPersona] = useState<{ identificacion: string; nombre: string; cargo: string | null } | null>(null)
  const [conductaId, setConductaId] = useState("")
  const [fechaHecho, setFechaHecho] = useState(hoyColombia())
  const [horaHecho, setHoraHecho] = useState("")
  const [lugar, setLugar] = useState("")
  const [relato, setRelato] = useState("")
  const [testigo, setTestigo] = useState("")
  const [testigoCargo, setTestigoCargo] = useState("")

  // Diálogo de trámite
  const [tramite, setTramite] = useState<ProcesoDisciplinario | null>(null)
  const [nuevoEstado, setNuevoEstado] = useState("")
  const [fechaTramite, setFechaTramite] = useState(hoyColombia())
  const [medida, setMedida] = useState("")
  const [notaTramite, setNotaTramite] = useState("")

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await getDisciplinarios(selectedEmpresaId ?? null)
    if (r.success && r.data) setData(r.data)
    setCargando(false)
  }, [selectedEmpresaId])

  useEffect(() => {
    cargar()
  }, [cargar])

  const conducta = conductaPorId(conductaId)

  async function radicar() {
    if (!persona || !selectedEmpresaId) return
    setGuardando(true)
    const r = await crearProcesoDisciplinario({
      empresaId: selectedEmpresaId,
      identificacion: persona.identificacion,
      nombre: persona.nombre,
      cargo: persona.cargo,
      conductaId,
      fechaHecho,
      horaHecho: horaHecho || null,
      lugar: lugar || null,
      relato,
      testigo: testigo || null,
      testigoCargo: testigoCargo || null,
    })
    setGuardando(false)
    if (!r.success) {
      toast({ title: "No se pudo radicar", description: r.message, variant: "destructive" })
      return
    }
    toast({
      title: `Caso ${r.radicado} radicado`,
      description: "El empleador debe citar a descargos antes de cualquier sanción.",
    })
    setPersona(null); setConductaId(""); setRelato("")
    setHoraHecho(""); setLugar(""); setTestigo(""); setTestigoCargo("")
    cargar()
  }

  /** Genera el acta y la deja en la carpeta del trabajador. */
  async function generarActa(c: ProcesoDisciplinario) {
    if (!selectedEmpresaId) return
    setGenerando(c.id)
    try {
      const blob = await generarPdfDisciplinario({
        radicado: c.radicado,
        // El nombre de la empresa usuaria no viene en esta lectura; el acta
        // lleva el radicado y la cedula, que es lo que la identifica.
        empresa: "",
        trabajadorNombre: c.nombre,
        trabajadorDocumento: c.identificacion,
        cargo: c.cargo,
        conducta: c.conducta,
        norma: c.norma,
        medidaSugerida: c.medidaSugerida,
        fechaHecho: c.fechaHecho,
        horaHecho: c.horaHecho,
        lugar: c.lugar,
        relato: c.relato,
        testigo: c.testigo,
        testigoCargo: c.testigoCargo,
        estado: c.estado,
        estadoEtiqueta: estadoMeta(c.estado).etiqueta,
        fechaCitacionDescargos: c.fechaCitacionDescargos,
        fechaDescargos: c.fechaDescargos,
        medidaAplicada: c.medidaAplicada,
        fechaResolucion: c.fechaResolucion,
        radicadoPor: c.radicadoPor,
        responsable: c.responsable,
        generadoEl: new Date().toLocaleDateString("es-CO"),
      })

      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = reject
        fr.readAsDataURL(blob)
      })

      const r = await guardarActaDisciplinaria({
        empresaId: selectedEmpresaId,
        id: c.id,
        radicado: c.radicado,
        identificacion: c.identificacion,
        pdfBase64: base64,
      })
      if (!r.success) {
        toast({ title: "No se pudo guardar el acta", description: r.message, variant: "destructive" })
        return
      }
      toast({
        title: "Acta generada",
        description: `Queda en la carpeta de ${c.nombre}.`,
      })
      cargar()
    } catch (e: any) {
      toast({ title: "No se pudo generar el acta", description: e?.message, variant: "destructive" })
    } finally {
      setGenerando(null)
    }
  }

  async function aplicarTramite() {
    if (!tramite || !selectedEmpresaId || !nuevoEstado) return
    setGuardando(true)
    const r = await avanzarEstadoDisciplinario({
      empresaId: selectedEmpresaId,
      id: tramite.id,
      nuevoEstado,
      fecha: fechaTramite,
      medidaAplicada: nuevoEstado === "resuelto" ? medida : null,
      nota: notaTramite || null,
    })
    setGuardando(false)
    if (!r.success) {
      toast({ title: "No se pudo actualizar", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: "Caso actualizado", description: estadoMeta(nuevoEstado).etiqueta })
    setTramite(null); setNuevoEstado(""); setMedida(""); setNotaTramite("")
    cargar()
  }

  const puedeRadicar =
    persona && conductaId && fechaHecho && relato.trim().length >= 20 && !guardando

  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="lg-eyebrow">Disciplinarios</p>
        <h1 className="text-xl font-semibold">Procesos disciplinarios</h1>
      </div>

      {data?.faltaMigracion && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Falta correr <code className="font-mono text-xs">scripts/179_add_procesos_disciplinarios.sql</code>
          </p>
          <p className="mt-1 text-xs">Sin él no se pueden radicar casos.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ---------------- RADICAR ---------------- */}
        <section className="h-fit lg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Solicitar medida disciplinaria</h2>
            <p className="text-xs text-muted-foreground">
              Se reporta la conducta. El empleador adelanta el proceso.
            </p>
          </div>

          <div className="space-y-3 p-4">
            {/* Combobox sobre el personal ACTIVO del head count. La lista la
                trae getDisciplinarios ya filtrada por empresa, estado Activo y
                sin cuentas de prueba: no se puede radicar un caso contra
                alguien que ya no esta vinculado. */}
            <div>
              <Label className="text-xs">Colaborador</Label>
              <Popover open={comboAbierto} onOpenChange={setComboAbierto}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={comboAbierto}
                    className="mt-1 h-9 w-full justify-between font-normal"
                  >
                    {persona ? (
                      <span className="min-w-0 truncate">
                        {persona.nombre}
                        {persona.cargo ? ` · ${persona.cargo}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Selecciona el colaborador…</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command
                    filter={(value, search) =>
                      value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
                    }
                  >
                    <CommandInput placeholder="Buscar por nombre o cédula…" className="h-9" />
                    <CommandList>
                      <CommandEmpty className="py-4 text-center text-xs">
                        {data?.trabajadores.length
                          ? "Nadie coincide."
                          : "No hay personal activo en esta empresa."}
                      </CommandEmpty>
                      <CommandGroup>
                        {(data?.trabajadores ?? []).map((p) => (
                          <CommandItem
                            key={p.identificacion}
                            // El value lleva nombre Y cédula para poder buscar
                            // por cualquiera de los dos.
                            value={`${p.nombre} ${p.identificacion}`}
                            onSelect={() => {
                              setPersona(p)
                              setComboAbierto(false)
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                persona?.identificacion === p.identificacion
                                  ? "opacity-100"
                                  : "opacity-0"
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{p.nombre}</span>
                              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                                {p.identificacion}
                                {p.cargo ? ` · ${p.cargo}` : ""}
                              </span>
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Solo personal activo en el head count de esta empresa.
              </p>
            </div>

            <div>
              <Label className="text-xs">Conducta reportada</Label>
              <select
                value={conductaId}
                onChange={(e) => setConductaId(e.target.value)}
                className="mt-1 w-full rounded border bg-background px-2 py-2 text-sm"
              >
                <option value="">Selecciona la conducta…</option>
                {CONDUCTAS.map((c) => (
                  <option key={c.id} value={c.id}>{c.etiqueta}</option>
                ))}
              </select>
            </div>

            {conducta && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="text-[11px] text-sky-800">{conducta.norma}</p>
                <p className="mt-0.5 text-sm font-medium text-sky-900">
                  Medida sugerida: {conducta.medidaSugerida}
                </p>
                <p className="mt-1 text-[11px] text-sky-800">
                  Es una sugerencia del catálogo. La decisión la toma el empleador tras los descargos.
                </p>
                <p className="mt-1.5 border-t border-sky-200 pt-1.5 text-[11px] text-sky-800">
                  <strong>Soporte esperado:</strong> {conducta.soporteEsperado}
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Fecha del hecho</Label>
                <Input
                  type="date"
                  value={fechaHecho}
                  max={hoyColombia()}
                  onChange={(e) => setFechaHecho(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Hora</Label>
                <Input
                  type="time"
                  value={horaHecho}
                  onChange={(e) => setHoraHecho(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Lugar</Label>
                <Input
                  value={lugar}
                  onChange={(e) => setLugar(e.target.value)}
                  placeholder="Área"
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Testigo</Label>
                <Input
                  value={testigo}
                  onChange={(e) => setTestigo(e.target.value)}
                  placeholder="Nombre"
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Cargo del testigo</Label>
                <Input
                  value={testigoCargo}
                  onChange={(e) => setTestigoCargo(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Relato de los hechos</Label>
              <Textarea
                value={relato}
                onChange={(e) => setRelato(e.target.value)}
                placeholder="Descripción objetiva: qué pasó, a qué hora y en qué lugar"
                rows={4}
                className="mt-1 text-sm"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {relato.trim().length < 20
                  ? "El relato es la prueba del caso: descríbelo con detalle."
                  : `${relato.trim().length} caracteres`}
              </p>
            </div>

            {/* La advertencia del debido proceso va SIEMPRE visible. */}
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
                <Shield className="h-3.5 w-3.5" />
                Debido proceso
              </p>
              <p className="mt-1 text-[11px] text-amber-800">
                Antes de aplicar cualquier sanción, el empleador debe citar al trabajador a
                diligencia de descargos, donde puede asistir acompañado de dos representantes de los
                trabajadores (Art. 115 CST). <strong>La empresa usuaria no sanciona directamente.</strong>
              </p>
            </div>

            <Button className="w-full" disabled={!puedeRadicar} onClick={radicar}>
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Radicar solicitud
            </Button>
          </div>
        </section>

        {/* ---------------- CASOS ---------------- */}
        <section className="lg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Casos radicados</h2>
            {data && (
              <p className="text-xs text-muted-foreground">
                {data.resumen.total} en total · {data.resumen.enDescargos} en descargos ·{" "}
                {data.resumen.resueltos} resueltos
              </p>
            )}
          </div>

          {cargando ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.casos.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No hay casos radicados.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.casos.map((c) => {
                const meta = estadoMeta(c.estado)
                return (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.nombre}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.conducta} · {c.fechaHecho}
                        </p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {c.radicado}
                          {c.radicadoPor ? ` · ${c.radicadoPor}` : ""}
                        </p>
                      </div>
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white"
                        style={{ background: meta.color }}
                      >
                        {meta.etiqueta}
                      </span>
                    </div>

                    {c.medidaAplicada && (
                      <p className="mt-1 text-[11px]">
                        <strong>Medida aplicada:</strong> {c.medidaAplicada}
                        {c.fechaResolucion ? ` · ${c.fechaResolucion}` : ""}
                      </p>
                    )}
                    {c.motivoArchivo && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Archivado: {c.motivoArchivo}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.estado !== "resuelto" && c.estado !== "archivado" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setTramite(c)
                            setNuevoEstado(
                              c.estado === "radicado" ? "descargos_citados"
                              : c.estado === "descargos_citados" ? "descargos_realizados"
                              : "resuelto",
                            )
                            setFechaTramite(hoyColombia())
                          }}
                        >
                          <Scale className="mr-1 h-3 w-3" />
                          Avanzar trámite
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={generando === c.id}
                        onClick={() => generarActa(c)}
                      >
                        {generando === c.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <FileText className="mr-1 h-3 w-3" />
                        )}
                        {c.documentoUrl ? "Regenerar acta" : "Generar acta"}
                      </Button>
                      {c.documentoUrl && (
                        <a
                          href={c.documentoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-muted/50"
                        >
                          <Download className="h-3 w-3" />
                          Ver en la carpeta
                        </a>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="border-t border-border px-4 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              El acta generada queda en la carpeta del trabajador, bajo su documento.
            </p>
          </div>
        </section>
      </div>

      {/* Diálogo de trámite */}
      <Dialog open={!!tramite} onOpenChange={(o) => !o && setTramite(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Avanzar el trámite</DialogTitle>
            <DialogDescription>
              {tramite?.radicado} · {tramite?.nombre}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Paso</Label>
              <select
                value={nuevoEstado}
                onChange={(e) => setNuevoEstado(e.target.value)}
                className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm"
              >
                <option value="descargos_citados">Citar a descargos</option>
                <option value="descargos_realizados">Registrar descargos realizados</option>
                <option value="resuelto">Resolver el caso</option>
                <option value="archivado">Archivar sin sanción</option>
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {estadoMeta(nuevoEstado).descripcion}
              </p>
            </div>

            {nuevoEstado !== "archivado" && (
              <div>
                <Label className="text-xs">Fecha</Label>
                <Input
                  type="date"
                  value={fechaTramite}
                  onChange={(e) => setFechaTramite(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
            )}

            {nuevoEstado === "resuelto" && (
              <div>
                <Label className="text-xs">Medida decidida por el empleador</Label>
                <select
                  value={medida}
                  onChange={(e) => setMedida(e.target.value)}
                  className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">Selecciona…</option>
                  {MEDIDAS_APLICABLES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                {tramite && !tramite.fechaDescargos && medida && medida !== "Sin sanción" && (
                  <p className="mt-1 rounded bg-red-50 p-2 text-[11px] text-red-800">
                    Este caso no tiene descargos registrados. No se puede imponer una sanción sin
                    oír al trabajador (Art. 115 CST).
                  </p>
                )}
              </div>
            )}

            <div>
              <Label className="text-xs">
                {nuevoEstado === "archivado" ? "Motivo del archivo" : "Nota (opcional)"}
              </Label>
              <Textarea
                value={notaTramite}
                onChange={(e) => setNotaTramite(e.target.value)}
                rows={2}
                className="mt-1 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTramite(null)}>Cancelar</Button>
            <Button onClick={aplicarTramite} disabled={guardando}>
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
