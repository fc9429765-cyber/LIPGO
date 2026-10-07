"use client"

/**
 * Modulo "Bitácora" (Operación Lip).
 *
 * Pantalla sencilla con dos zonas:
 *   1. Captura: un Textarea amplio + boton "Guardar" para registrar la
 *      bitacora del dia. La fecha se asigna automatica en el servidor
 *      (zona Bogota) y el `idempresa` viene del contexto de sesion.
 *   2. Historial: tabla de registros previos de la empresa con
 *      opciones de Editar y Eliminar.
 *
 * El acceso al modulo va protegido por el permiso `bitacora` (ver
 * `lib/permissions-map.ts`). La proteccion se aplica desde
 * `main-content.tsx` con `<PermissionGuard moduleName="Bitácora">`.
 */

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  FileBarChart2,
  History as HistoryIcon,
  Loader2,
  NotebookPen,
  Pencil,
  Printer,
  Save,
  Trash2,
} from "lucide-react"
import {
  createBitacora,
  deleteBitacora,
  getBitacoras,
  updateBitacora,
  type BitacoraRow,
} from "@/lib/bitacora-actions"
import {
  deleteCierreSnapshot,
  listCierreSnapshots,
  type CierreSnapshot,
} from "@/lib/cierre-historial-actions"
import CierreDiaDashboard from "@/components/lip/cierre-dia-dashboard"
import { Chip, Esqueleto, EstadoVacio, Eyebrow } from "@/components/ui/lipgo"

// Pestañas internas con el estilo de la barra de pestañas de los hubs (solo clases).
const CLASE_PESTANA =
  "h-9 flex-none gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:bg-primary/10 data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-none"

/**
 * Formatea una fecha ISO (`YYYY-MM-DD`) como `DD/MM/YYYY`. Si la
 * cadena viene vacia o malformada, devuelve "-" para no romper la UI.
 */
function formatFecha(iso: string | null): string {
  if (!iso) return "-"
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

export default function Bitacora() {
  const { selectedEmpresaId } = useAuth()
  const { toast } = useToast()

  const [rows, setRows] = useState<BitacoraRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Texto del area de captura nueva (panel principal).
  const [nuevoTexto, setNuevoTexto] = useState("")

  // Edicion: se abre un dialog que muestra el texto editable. `editId`
  // = null significa que el dialog esta cerrado.
  const [editId, setEditId] = useState<number | null>(null)
  const [editTexto, setEditTexto] = useState("")
  const [updating, setUpdating] = useState(false)

  // Borrado: se abre un AlertDialog con confirmacion explicita para
  // evitar perdidas accidentales. `deleteId` = null cierra el dialog.
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Historial de Cierres del Dia (snapshots HTML guardados en Vercel
  // Blob cada vez que el usuario imprime el cierre). Se cargan al
  // entrar a la pestaña "Historial" para no pegarle al blob en cada
  // visita a "Bitácora" / "Cierre del Día".
  const [cierres, setCierres] = useState<CierreSnapshot[]>([])
  const [loadingCierres, setLoadingCierres] = useState(false)
  const [deleteCierreFecha, setDeleteCierreFecha] = useState<string | null>(
    null,
  )
  const [deletingCierre, setDeletingCierre] = useState(false)
  const [activeTab, setActiveTab] = useState<string>("bitacora")

  const empresaId =
    typeof selectedEmpresaId === "number" ? selectedEmpresaId : Number(selectedEmpresaId)

  const fetchRows = useCallback(async () => {
    if (!empresaId) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    const res = await getBitacoras(empresaId)
    if (res.success && res.data) {
      setRows(res.data)
    } else {
      toast({
        title: "Error",
        description: res.error || "No se pudo cargar la bitácora",
        variant: "destructive",
      })
    }
    setLoading(false)
  }, [empresaId, toast])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  // Cargar snapshots solo cuando el usuario entra a la pestaña
  // "Historial" (lazy) y cuando cambia la empresa.
  const fetchCierres = useCallback(async () => {
    if (!empresaId) {
      setCierres([])
      return
    }
    setLoadingCierres(true)
    const res = await listCierreSnapshots(empresaId)
    setLoadingCierres(false)
    if (res.success && res.data) {
      setCierres(res.data)
    } else {
      toast({
        title: "Error",
        description: res.error || "No se pudo cargar el historial",
        variant: "destructive",
      })
    }
  }, [empresaId, toast])

  useEffect(() => {
    if (activeTab === "historial") {
      fetchCierres()
    }
  }, [activeTab, fetchCierres])

  const handleDeleteCierre = async () => {
    if (!empresaId || !deleteCierreFecha) return
    setDeletingCierre(true)
    const res = await deleteCierreSnapshot(empresaId, deleteCierreFecha)
    setDeletingCierre(false)
    if (res.success) {
      toast({ title: "Eliminado", description: "Cierre eliminado del historial" })
      setDeleteCierreFecha(null)
      fetchCierres()
    } else {
      toast({
        title: "Error",
        description: res.error || "No se pudo eliminar",
        variant: "destructive",
      })
    }
  }

  // Guardar un nuevo registro desde el panel principal. Si el texto
  // queda vacio (o solo espacios) lo bloqueamos con un toast en vez
  // de mandar al servidor: ahorra round-trip y da feedback inmediato.
  const handleGuardar = async () => {
    if (!empresaId) {
      toast({
        title: "Error",
        description: "Empresa no seleccionada",
        variant: "destructive",
      })
      return
    }
    const texto = nuevoTexto.trim()
    if (!texto) {
      toast({
        title: "Bitácora vacía",
        description: "Escribe el contenido antes de guardar",
        variant: "destructive",
      })
      return
    }
    setSaving(true)
    const res = await createBitacora(empresaId, { bitacora: texto })
    setSaving(false)
    if (res.success) {
      toast({ title: "Guardado", description: "Bitácora registrada correctamente" })
      setNuevoTexto("")
      fetchRows()
    } else {
      toast({
        title: "Error",
        description: res.error || "No se pudo guardar la bitácora",
        variant: "destructive",
      })
    }
  }

  const openEdit = (row: BitacoraRow) => {
    setEditId(row.id)
    setEditTexto(row.bitacora ?? "")
  }

  const handleUpdate = async () => {
    if (!empresaId || editId == null) return
    const texto = editTexto.trim()
    if (!texto) {
      toast({
        title: "Bitácora vacía",
        description: "El contenido no puede quedar vacío",
        variant: "destructive",
      })
      return
    }
    setUpdating(true)
    const res = await updateBitacora(empresaId, editId, { bitacora: texto })
    setUpdating(false)
    if (res.success) {
      toast({ title: "Actualizado", description: "Bitácora actualizada" })
      setEditId(null)
      setEditTexto("")
      fetchRows()
    } else {
      toast({
        title: "Error",
        description: res.error || "No se pudo actualizar",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async () => {
    if (!empresaId || deleteId == null) return
    setDeleting(true)
    const res = await deleteBitacora(empresaId, deleteId)
    setDeleting(false)
    if (res.success) {
      toast({ title: "Eliminada", description: "Bitácora eliminada" })
      setDeleteId(null)
      fetchRows()
    } else {
      toast({
        title: "Error",
        description: res.error || "No se pudo eliminar",
        variant: "destructive",
      })
    }
  }

  return (
    // El modulo ahora expone dos pestañas:
    //   - "bitacora": flujo original (captura + historial).
    //   - "cierre":   dashboard ejecutivo del dia con exportacion a PDF.
    //
    // El contenedor de Tabs se oculta automaticamente al imprimir el
    // dashboard (el @media print en globals.css oculta toda la UI
    // excepto #cierre-dia-print).
    //
    // Solo presentación (gerencia 2026-10-05: cero cambios de comportamiento):
    // mismas pestañas, mismos textos, mismos diálogos y las mismas acciones;
    // pintado con las primitivas del sistema visual LIPgo.
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex flex-col gap-4 p-4 md:p-6 print:p-0 print:gap-0"
    >
      <div className="no-print flex flex-col gap-3 print:hidden">
        <div>
          <Eyebrow>Operación LIP · Bitácora</Eyebrow>
          <h1 className="text-2xl font-semibold leading-tight">Bitácora</h1>
        </div>
        <TabsList className="h-auto gap-1 self-start border-b border-border bg-transparent p-0 pb-2">
          <TabsTrigger value="bitacora" className={CLASE_PESTANA}>
            <NotebookPen className="h-4 w-4" />
            Bitácora
          </TabsTrigger>
          <TabsTrigger value="cierre" className={CLASE_PESTANA}>
            <FileBarChart2 className="h-4 w-4" />
            Cierre del Día
          </TabsTrigger>
          <TabsTrigger value="historial" className={CLASE_PESTANA}>
            <HistoryIcon className="h-4 w-4" />
            Historial
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="bitacora"
        className="flex flex-col gap-4 mt-0 print:hidden"
      >
      {/* Captura del dia. Diseño tipo "diario": titulo descriptivo,
          textarea amplio (8 filas) y un boton primario alineado a la
          derecha que se inhabilita mientras guarda. */}
      <section className="lg-card p-4 md:p-5" aria-labelledby="bitacora-captura-titulo">
        <div className="mb-3 flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-bg text-info-fg">
            <NotebookPen className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 id="bitacora-captura-titulo" className="text-base font-semibold leading-tight">Bitácora del día</h2>
            <p className="text-sm text-muted-foreground">
              Registra novedades, incidencias o información relevante del día. La fecha se
              asigna automáticamente.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Label htmlFor="bitacora-nueva" className="sr-only">
            Contenido de la bitácora
          </Label>
          <Textarea
            id="bitacora-nueva"
            placeholder="Escribe aquí la bitácora del día..."
            value={nuevoTexto}
            onChange={(e) => setNuevoTexto(e.target.value)}
            rows={8}
            className="resize-y min-h-[180px] bg-background"
          />
          <div className="flex items-center justify-end gap-2">
            <Button onClick={handleGuardar} disabled={saving || !nuevoTexto.trim()} className="h-10">
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Guardar
            </Button>
          </div>
        </div>
      </section>

      {/* Historial. Tabla simple con fecha, contenido (multilinea) y
          acciones. Para textos largos mantenemos `whitespace-pre-wrap`
          y `break-words` para preservar saltos de linea sin desbordar
          la celda. */}
      <section className="lg-card overflow-hidden" aria-labelledby="bitacora-historial-titulo">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 id="bitacora-historial-titulo" className="text-base font-semibold leading-tight">Historial</h2>
            <p className="text-sm text-muted-foreground">Registros guardados de la empresa actual.</p>
          </div>
          {!loading && rows.length > 0 && (
            <Chip tono="neutro">{rows.length} {rows.length === 1 ? "registro" : "registros"}</Chip>
          )}
        </div>
        <div className="p-4">
          {loading ? (
            <div aria-busy aria-label="Cargando historial...">
              <Esqueleto lineas={4} />
            </div>
          ) : rows.length === 0 ? (
            <EstadoVacio
              icono={<NotebookPen className="h-5 w-5" aria-hidden />}
              titulo="No hay registros de bitácora todavía"
              texto="Escribe la bitácora del día arriba y pulsa Guardar."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Fecha</TableHead>
                    <TableHead>Contenido</TableHead>
                    <TableHead className="w-[150px] text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="lg-num align-top font-medium">
                        {formatFecha(row.fecha)}
                      </TableCell>
                      <TableCell className="align-top whitespace-pre-wrap break-words">
                        {row.bitacora || "-"}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            Editar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteId(row.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </section>

      {/* Dialog de edicion. Reutiliza el mismo Textarea para que la
          experiencia de escribir sea consistente con el panel de
          captura. */}
      <Dialog
        open={editId != null}
        onOpenChange={(open) => {
          if (!open) {
            setEditId(null)
            setEditTexto("")
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar bitácora</DialogTitle>
            <DialogDescription>
              Modifica el contenido y guarda los cambios.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editTexto}
            onChange={(e) => setEditTexto(e.target.value)}
            rows={10}
            className="resize-y min-h-[220px]"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditId(null)
                setEditTexto("")
              }}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleUpdate} disabled={updating}>
              {updating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog de confirmacion de borrado. Mensaje explicito para
          evitar borrados accidentales — no hay papelera ni undo. */}
      <AlertDialog
        open={deleteId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta bitácora?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El registro se eliminará de forma permanente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Evitamos que el AlertDialog se cierre automaticamente
                // antes de terminar el delete; lo cerramos manual al
                // recibir la respuesta exitosa.
                e.preventDefault()
                handleDelete()
              }}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </TabsContent>

      {/* Dashboard ejecutivo del cierre del dia. Vive como componente
          aparte porque tiene su propia logica de carga de 3 fuentes y
          su zona imprimible (#cierre-dia-print) con CSS @media print. */}
      <TabsContent value="cierre" className="mt-0 -mx-4 md:-mx-6 print:mx-0">
        <CierreDiaDashboard />
      </TabsContent>

      {/* Historial de Cierres del Dia.
          Lista los snapshots HTML guardados (uno por dia) en Vercel
          Blob cada vez que el usuario imprime el cierre. Cada fila
          permite reabrir el snapshot tal como salio originalmente
          (boton "Ver / Imprimir") y, opcionalmente, eliminarlo.
          La lista se carga lazy al entrar a esta pestaña. */}
      <TabsContent value="historial" className="mt-0 print:hidden">
        <section className="lg-card overflow-hidden" aria-labelledby="cierres-historial-titulo">
          <div className="flex flex-row items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-bg text-info-fg">
                <HistoryIcon className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <h2 id="cierres-historial-titulo" className="text-base font-semibold leading-tight">Historial de Cierres del Día</h2>
                <p className="text-sm text-muted-foreground">
                  Cierres operativos guardados al generar el PDF. Abrelos
                  para verlos o reimprimirlos.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchCierres}
              disabled={loadingCierres}
              className="shrink-0"
            >
              {loadingCierres ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <HistoryIcon className="h-4 w-4 mr-1.5" />
              )}
              Actualizar
            </Button>
          </div>
          <div className="p-4">
            {loadingCierres ? (
              <div aria-busy aria-label="Cargando historial...">
                <Esqueleto lineas={4} />
              </div>
            ) : cierres.length === 0 ? (
              <EstadoVacio
                icono={<FileBarChart2 className="h-5 w-5" aria-hidden />}
                titulo="Aún no hay cierres guardados."
                texto="Genera el PDF del Cierre del Día para que aparezca aquí."
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Fecha</TableHead>
                      <TableHead>Generado</TableHead>
                      <TableHead className="w-[80px] text-right">
                        Tamaño
                      </TableHead>
                      <TableHead className="w-[260px] text-right">
                        Acciones
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cierres.map((c) => (
                      <TableRow key={c.fecha}>
                        <TableCell className="lg-num font-medium">
                          {formatFecha(c.fecha)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(c.uploadedAt).toLocaleString("es-CO", {
                            timeZone: "America/Bogota",
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="lg-num text-right text-xs text-muted-foreground">
                          {(c.size / 1024).toFixed(0)} KB
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                window.open(c.url, "_blank", "noopener")
                              }
                            >
                              <FileBarChart2 className="h-4 w-4 mr-1" />
                              Ver
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                // Abre el snapshot y dispara print()
                                // automatico una vez cargue. Pasamos un
                                // hash que el snapshot puede leer si lo
                                // necesitamos a futuro; por ahora, la
                                // accion la dispara el propio usuario.
                                const w = window.open(
                                  c.url,
                                  "_blank",
                                  "noopener",
                                )
                                if (w) {
                                  // Algunos navegadores bloquean print
                                  // remoto cross-origin; el usuario
                                  // puede usar Ctrl+P en la pestaña.
                                  setTimeout(() => {
                                    try {
                                      w.focus()
                                      w.print()
                                    } catch {
                                      /* noop */
                                    }
                                  }, 1500)
                                }
                              }}
                            >
                              <Printer className="h-4 w-4 mr-1" />
                              Imprimir
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteCierreFecha(c.fecha)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">Eliminar</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </section>

        <AlertDialog
          open={deleteCierreFecha != null}
          onOpenChange={(open) => {
            if (!open) setDeleteCierreFecha(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar este cierre?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción no se puede deshacer. El snapshot del{" "}
                {deleteCierreFecha ? formatFecha(deleteCierreFecha) : ""} se
                eliminará del historial.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingCierre}>
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  handleDeleteCierre()
                }}
                disabled={deletingCierre}
              >
                {deletingCierre ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TabsContent>
    </Tabs>
  )
}
