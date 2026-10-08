"use client"

/**
 * Configuración › General › "Autorizaciones por clave" (SQL 203).
 *
 * Gestión de Usuarios da permisos por MÓDULO (qué pantallas ve cada uno).
 * Este submódulo da permisos por PROCESO/CÓDIGO y por PUESTO: define perfiles
 * (Gerencia de proyecto, Calidad, Cartera…), qué procesos autoriza cada perfil
 * (aprobar 702, liberar 343, anular pedido…), a quién se asigna y en qué
 * proyectos. La clave con la que se autoriza es PERSONAL de cada usuario.
 *
 * Pestañas: Usuarios (perfiles, excepciones, estado de la clave) · Perfiles
 * (matriz perfil × proceso) · Bitácora (quién autorizó qué, cuándo, resultado).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  KeyRound,
  ShieldCheck,
  Users,
  History,
  Loader2,
  Plus,
  X,
  MoreHorizontal,
  Mail,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Unlock,
  Trash2,
  Copy,
  RefreshCw,
  Search,
  CalendarClock,
  Building2,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import {
  adminAsignarPerfil,
  adminClaveProvisional,
  adminDesbloquearClave,
  adminEliminarClave,
  adminEliminarPerfil,
  adminGetLog,
  adminGetResumen,
  adminGuardarExcepcion,
  adminGuardarPerfil,
  adminProbarCorreo,
  adminQuitarExcepcion,
  adminQuitarPerfil,
  adminSetCorreoRecuperacion,
  adminSetTransicion,
} from "@/lib/autorizaciones-actions"
import {
  RESULTADO_LABEL,
  type LogAutorizacion,
  type PerfilAutorizacion,
  type ProcesoAutorizable,
  type ResumenAutorizaciones,
  type UsuarioAutorizacion,
} from "@/lib/autorizaciones"
import { esGrupoSoloLip } from "@/lib/permisos-financieros"

const TODOS = "0"

function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" })
  } catch {
    return String(iso)
  }
}

const hoyColombia = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)

// Etiquetas de los eventos internos de la bitácora (no son procesos del catálogo).
const PROCESO_INTERNO_LABEL: Record<string, string> = {
  clave_personal: "Clave personal",
  admin_perfil: "Perfil (admin)",
  admin_asignacion: "Asignación de perfil (admin)",
  admin_excepcion: "Excepción (admin)",
  admin_transicion: "Transición (admin)",
  admin_correo: "Prueba de correo (admin)",
}
const RESULTADO_INTERNO_LABEL: Record<string, string> = {
  creada: "Clave creada",
  cambiada: "Clave cambiada",
  definida_desde_provisional: "Clave definida (desde provisional)",
  recuperada_por_correo: "Clave recuperada por correo",
  codigo_enviado: "Código de recuperación enviado",
  codigo_no_enviado: "Código NO enviado (falló el correo)",
  prueba_enviada: "Correo de prueba enviado",
  prueba_fallida: "Correo de prueba falló",
  verificacion_correo_enviada: "Código de verificación de correo enviado",
  correo_recuperacion_confirmado: "Correo de recuperación confirmado",
  correo_recuperacion_asignado: "Correo de recuperación asignado (admin)",
  correo_recuperacion_quitado: "Correo de recuperación quitado (admin)",
  provisional_asignada: "Clave provisional asignada",
  desbloqueada: "Clave desbloqueada",
  eliminada_por_admin: "Clave eliminada por admin",
  guardado: "Perfil guardado",
  perfil_asignado: "Perfil asignado",
  perfil_quitado: "Perfil quitado",
  concedida: "Excepción concedida",
  negada: "Excepción negada",
  terminada: "Transición terminada",
  fecha_actualizada: "Fecha de transición actualizada",
}

/**
 * `soloClaves`: dentro de la pantalla única (Usuarios · Perfiles · Claves) los
 * perfiles se editan en su propia pestaña, así que aquí se esconde la de
 * "Perfiles y procesos" y queda lo que es de la clave: estado, alcance fino,
 * excepciones, correo, transición y bitácora.
 */
export default function AutorizacionesClave({ soloClaves = false }: { soloClaves?: boolean } = {}) {
  const { toast } = useToast()
  // El selector GLOBAL de proyecto (ID) gobierna la pantalla, como en el resto
  // de LIPgo: usuarios del proyecto, alcance por defecto y bitácora.
  const { selectedEmpresaId } = useAuth()
  const [data, setData] = useState<ResumenAutorizaciones | null>(null)
  const [loading, setLoading] = useState(true)
  const [probandoCorreo, setProbandoCorreo] = useState(false)
  const [resultadoCorreo, setResultadoCorreo] = useState<{ ok: boolean; texto: string } | null>(null)

  const probarCorreo = async () => {
    setProbandoCorreo(true)
    setResultadoCorreo(null)
    const r = await adminProbarCorreo()
    setProbandoCorreo(false)
    setResultadoCorreo({ ok: r.success, texto: `${r.message ?? ""}${r.detalle && !r.success ? ` (${r.detalle})` : ""}` })
    toast({ title: r.success ? "Correo de prueba enviado" : "El correo no salió", description: r.message, variant: r.success ? undefined : "destructive" })
  }

  const cargar = useCallback(async () => {
    setLoading(true)
    const r = await adminGetResumen()
    if (r.success && r.data) setData(r.data)
    else toast({ title: "Error", description: r.message || "No se pudo cargar la información.", variant: "destructive" })
    setLoading(false)
  }, [toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const usuariosVisibles = useMemo(
    () => (data?.usuarios ?? []).filter((u) => selectedEmpresaId == null || u.empresa_id === selectedEmpresaId),
    [data, selectedEmpresaId],
  )
  const usuariosConClave = usuariosVisibles.filter((u) => u.tieneClave && !u.provisional).length
  const usuariosConPerfil = usuariosVisibles.filter((u) => u.perfiles.length > 0 || u.excepciones.some((e) => e.permitir)).length
  // Sin dónde recibir un código: el correo de acceso no es buzón y no registraron correo de recuperación.
  const usuariosSinCorreo = usuariosVisibles.filter((u) => !u.correoRecuperacion && u.emailRecibe === false).length
  const nombreProyecto =
    selectedEmpresaId == null
      ? "Todos los proyectos"
      : data?.empresas.find((e) => e.id === selectedEmpresaId)?.nombre ?? `Proyecto ${selectedEmpresaId}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <KeyRound className="h-7 w-7" /> {soloClaves ? "Claves de autorización" : "Autorizaciones por clave"}
          </h1>
          {soloClaves ? (
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Qué <b className="text-foreground">procesos</b> autoriza cada puesto se define en la pestaña{" "}
              <b className="text-foreground">Perfiles</b>; a quién se le da el perfil, en <b className="text-foreground">Usuarios</b>. Aquí
              queda lo que es de la <b className="text-foreground">clave personal</b>: su estado, el alcance fino por proyecto, las
              excepciones por persona, el correo de recuperación, la transición de claves compartidas y la bitácora de quién autorizó qué.
            </p>
          ) : (
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              <b className="text-foreground">Gestión de Usuarios</b> dice qué pantallas ve cada usuario. <b className="text-foreground">Aquí</b> se
              define qué <b className="text-foreground">procesos</b> puede <b className="text-foreground">autorizar</b> con su clave personal
              (aprobar un 702, liberar cuarentena, anular un pedido, cartera, financiera…) y en qué proyectos. Los permisos se dan por{" "}
              <b className="text-foreground">puesto</b> (perfil) y, si hace falta, con excepciones por persona. Cada usuario crea y recupera su
              propia clave desde el menú de usuario › “Mi clave de autorización”.
            </p>
          )}
          <p className="mt-2 max-w-3xl text-xs text-muted-foreground">
            <Lock className="mr-1 inline h-3.5 w-3.5" />
            <b className="text-foreground">Lo financiero es propiedad de LIP.</b> Los procesos del grupo “Financiera” solo pueden otorgarse y
            usarse por usuarios que ya tengan módulos de Gestión Financiera en Gestión de Usuarios; el sistema lo bloquea aunque se intente
            por perfil o por excepción. Esta pantalla no cambia los permisos por módulo: esos siguen viviendo solo en Gestión de Usuarios.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1" title="Proyecto del selector global">
            <Building2 className="h-3 w-3" /> {nombreProyecto}
          </Badge>
          {data && (
            <Badge variant="outline" className="gap-1" title={`Remitente: ${data.correoRemitente}`}>
              <Mail className="h-3 w-3" /> Correo {data.correoConfigurado ? "configurado" : "no configurado"}
            </Badge>
          )}
          {data?.correoConfigurado && (
            <Button variant="outline" size="sm" onClick={probarCorreo} disabled={probandoCorreo} className="gap-1.5" title={`Envía una prueba a ${data.correoAdmin ?? "tu correo"}`}>
              {probandoCorreo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Probar correo
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={cargar} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Actualizar
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center p-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando…
        </div>
      ) : !data ? null : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className={usuariosSinCorreo > 0 ? "border-amber-300" : ""}>
              <CardContent className="pt-5">
                <p className="text-xs uppercase text-muted-foreground">Sin correo real para recuperar</p>
                <p className="text-2xl font-bold">
                  {usuariosSinCorreo} <span className="text-sm font-normal text-muted-foreground">/ {usuariosVisibles.length}</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Los usuarios @lipgo.app no son buzones: cada persona registra su correo real en “Mi clave de autorización” › Correo, o tú
                  se lo asignas aquí (menú ⋯).
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase text-muted-foreground">Usuarios con clave personal</p>
                <p className="text-2xl font-bold">
                  {usuariosConClave} <span className="text-sm font-normal text-muted-foreground">/ {usuariosVisibles.length}</span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase text-muted-foreground">Usuarios con algún permiso</p>
                <p className="text-2xl font-bold">
                  {usuariosConPerfil} <span className="text-sm font-normal text-muted-foreground">/ {usuariosVisibles.length}</span>
                </p>
              </CardContent>
            </Card>
            <TransicionCard transicionHasta={data.transicionHasta} onChanged={cargar} />
          </div>

          {!data.correoConfigurado && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                El envío de correos no está configurado en este despliegue (variable <code>RESEND_API_KEY</code>), así que la
                recuperación de clave por correo está desactivada. En Vercel: Settings › Environment Variables › agrega{" "}
                <code>RESEND_API_KEY</code> y <code>EMAIL_FROM</code> y <b>vuelve a desplegar</b> (las variables nuevas solo aplican en
                un despliegue nuevo). Mientras tanto, quien olvide su clave la recupera con una <b>clave provisional</b> que tú generas
                aquí (menú ⋯ del usuario) y él cambia al primer uso.
              </p>
            </div>
          )}
          {data.correoConfigurado && data.correoRemitentePrueba && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                La API key está, pero el remitente es el de <b>prueba de Resend</b> (<code>{data.correoRemitente}</code>): Resend solo
                entrega esos correos al dueño de la cuenta de Resend; a cualquier otro usuario le falla. Para que llegue a todos: en
                Resend › Domains verifica el dominio (p. ej. lip-sas.com) con sus registros DNS, y en Vercel define{" "}
                <code>EMAIL_FROM</code> = <code>LIPgo &lt;no-reply@lip-sas.com&gt;</code> y vuelve a desplegar. Usa “Probar correo” para
                confirmar.
              </p>
            </div>
          )}
          {resultadoCorreo && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${resultadoCorreo.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}
            >
              {resultadoCorreo.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <p className="break-words">{resultadoCorreo.texto}</p>
            </div>
          )}

          <Tabs defaultValue="usuarios">
            <TabsList>
              <TabsTrigger value="usuarios" className="gap-1.5">
                <Users className="h-4 w-4" /> Usuarios
              </TabsTrigger>
              {!soloClaves && (
                <TabsTrigger value="perfiles" className="gap-1.5">
                  <ShieldCheck className="h-4 w-4" /> Perfiles y procesos
                </TabsTrigger>
              )}
              <TabsTrigger value="bitacora" className="gap-1.5">
                <History className="h-4 w-4" /> Bitácora
              </TabsTrigger>
            </TabsList>
            <TabsContent value="usuarios" className="mt-4">
              <UsuariosTab data={data} recargar={cargar} empresaId={selectedEmpresaId} nombreProyecto={nombreProyecto} />
            </TabsContent>
            {!soloClaves && (
              <TabsContent value="perfiles" className="mt-4">
                <PerfilesTab data={data} recargar={cargar} />
              </TabsContent>
            )}
            <TabsContent value="bitacora" className="mt-4">
              <BitacoraTab data={data} empresaId={selectedEmpresaId} nombreProyecto={nombreProyecto} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Transición de claves compartidas
// ---------------------------------------------------------------------------

function TransicionCard({ transicionHasta, onChanged }: { transicionHasta: string | null; onChanged: () => void }) {
  const { toast } = useToast()
  const [fecha, setFecha] = useState(transicionHasta ?? "")
  const [guardando, setGuardando] = useState(false)
  const [confirmarFin, setConfirmarFin] = useState(false)
  useEffect(() => setFecha(transicionHasta ?? ""), [transicionHasta])
  const vigente = Boolean(transicionHasta && transicionHasta >= hoyColombia())

  const guardar = async (valor: string | null) => {
    setGuardando(true)
    const r = await adminSetTransicion(valor)
    setGuardando(false)
    if (r.success) {
      toast({ title: "Transición", description: valor ? `Las claves compartidas valen hasta el ${r.transicionHasta}.` : "Transición terminada: desde ahora solo valen las claves personales." })
      onChanged()
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  return (
    <Card className={vigente ? "border-amber-300" : "border-emerald-300"}>
      <CardContent className="space-y-2 pt-5">
        <p className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" /> Claves compartidas de antes
        </p>
        {vigente ? (
          <p className="text-sm">
            Siguen valiendo hasta el <b>{transicionHasta}</b> mientras cada persona crea la suya.
          </p>
        ) : (
          <p className="flex items-center gap-1 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> Transición terminada: solo valen las claves personales.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-8 w-[150px] text-xs" />
          <Button size="sm" variant="outline" className="h-8" disabled={!fecha || guardando} onClick={() => guardar(fecha)}>
            Guardar fecha
          </Button>
          {vigente && (
            <Button size="sm" variant="destructive" className="h-8" disabled={guardando} onClick={() => setConfirmarFin(true)}>
              Terminar hoy
            </Button>
          )}
        </div>
      </CardContent>
      <AlertDialog open={confirmarFin} onOpenChange={setConfirmarFin}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Terminar la transición hoy?</AlertDialogTitle>
            <AlertDialogDescription>
              Desde este momento las claves compartidas (LIPMJJ, LIP123456, Avimol2026, las de cartera, la de bonos…) dejan de valer.
              Solo podrán autorizar los usuarios que ya tengan clave personal y un perfil con el proceso. Puedes volver a abrir la
              transición guardando una fecha futura.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => guardar(null)}>Sí, terminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

function ClaveBadge({ u }: { u: UsuarioAutorizacion }) {
  if (u.bloqueadaHasta)
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <Lock className="h-3 w-3" /> Bloqueada
      </Badge>
    )
  if (!u.tieneClave)
    return (
      <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
        Sin clave
      </Badge>
    )
  if (u.provisional)
    return (
      <Badge className="gap-1 border-amber-300 bg-amber-100 text-[10px] text-amber-900 hover:bg-amber-100">
        <AlertTriangle className="h-3 w-3" /> Provisional
      </Badge>
    )
  return (
    <Badge className="gap-1 border-emerald-300 bg-emerald-100 text-[10px] text-emerald-900 hover:bg-emerald-100">
      <CheckCircle2 className="h-3 w-3" /> Activa
    </Badge>
  )
}

function UsuariosTab({
  data,
  recargar,
  empresaId,
  nombreProyecto,
}: {
  data: ResumenAutorizaciones
  recargar: () => Promise<void>
  empresaId: number | null
  nombreProyecto: string
}) {
  const { toast } = useToast()
  const [busqueda, setBusqueda] = useState("")
  const [soloConPermisos, setSoloConPermisos] = useState(false)
  const [asignar, setAsignar] = useState<{ usuario: UsuarioAutorizacion; tipo: "perfil" | "excepcion" } | null>(null)
  const [confirmar, setConfirmar] = useState<{ usuario: UsuarioAutorizacion; accion: "provisional" | "eliminar" } | null>(null)
  const [provisional, setProvisional] = useState<{ usuario: string; clave: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [correoDlg, setCorreoDlg] = useState<UsuarioAutorizacion | null>(null)
  const [correoValor, setCorreoValor] = useState("")
  const [guardandoCorreo, setGuardandoCorreo] = useState(false)

  const abrirCorreo = (u: UsuarioAutorizacion) => {
    setCorreoDlg(u)
    setCorreoValor(u.correoRecuperacion ?? "")
  }
  const guardarCorreo = async (valor: string | null) => {
    if (!correoDlg) return
    setGuardandoCorreo(true)
    const r = await adminSetCorreoRecuperacion(correoDlg.id, valor)
    setGuardandoCorreo(false)
    if (r.success) {
      toast({ title: "Correo de recuperación", description: r.message })
      setCorreoDlg(null)
      await recargar()
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const nombreEmpresa = useCallback((id: number | null | undefined) => (id == null ? "Todos los proyectos" : data.empresas.find((e) => e.id === id)?.nombre || `Proyecto ${id}`), [data.empresas])
  const nombreProceso = useCallback((codigo: string) => data.procesos.find((p) => p.codigo === codigo)?.nombre || codigo, [data.procesos])

  const usuarios = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return data.usuarios.filter((u) => {
      // Filtro GLOBAL de proyecto (selector superior), igual que Accesos de Usuario.
      if (empresaId != null && u.empresa_id !== empresaId) return false
      if (soloConPermisos && u.perfiles.length === 0 && u.excepciones.length === 0) return false
      if (q && !`${u.usuario} ${u.email ?? ""}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data.usuarios, busqueda, empresaId, soloConPermisos])

  const quitarPerfil = async (id: number) => {
    setOcupado(true)
    const r = await adminQuitarPerfil(id)
    setOcupado(false)
    if (r.success) await recargar()
    else toast({ title: "Error", description: r.message, variant: "destructive" })
  }
  const quitarExcepcion = async (id: number) => {
    setOcupado(true)
    const r = await adminQuitarExcepcion(id)
    setOcupado(false)
    if (r.success) await recargar()
    else toast({ title: "Error", description: r.message, variant: "destructive" })
  }
  const desbloquear = async (u: UsuarioAutorizacion) => {
    const r = await adminDesbloquearClave(u.id)
    if (r.success) {
      toast({ title: "Clave desbloqueada", description: u.usuario })
      await recargar()
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }
  const ejecutarConfirmacion = async () => {
    if (!confirmar) return
    setOcupado(true)
    if (confirmar.accion === "provisional") {
      const r = await adminClaveProvisional(confirmar.usuario.id)
      if (r.success && r.clave) setProvisional({ usuario: confirmar.usuario.usuario, clave: r.clave })
      else toast({ title: "Error", description: r.message, variant: "destructive" })
    } else {
      const r = await adminEliminarClave(confirmar.usuario.id)
      if (r.success) toast({ title: "Clave eliminada", description: `${confirmar.usuario.usuario} deberá crear una nueva.` })
      else toast({ title: "Error", description: r.message, variant: "destructive" })
    }
    setOcupado(false)
    setConfirmar(null)
    await recargar()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Usuarios: perfiles, excepciones y estado de la clave</CardTitle>
        <CardDescription>
          Asigna a cada usuario el perfil de su puesto con el alcance de su proyecto. “Todos los proyectos” solo para la gerencia
          general de LIPgo. Las excepciones conceden o niegan UN proceso puntual y ganan sobre el perfil.
        </CardDescription>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
          Mostrando los usuarios de <b className="text-foreground">{nombreProyecto}</b> (selector global de la barra superior). Cambia el
          proyecto allí para ver otros usuarios.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar usuario o correo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="h-9 pl-8" />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={soloConPermisos} onCheckedChange={setSoloConPermisos} /> Solo con permisos
          </label>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Proyecto</TableHead>
              <TableHead>Clave</TableHead>
              <TableHead>Perfiles (puesto · alcance)</TableHead>
              <TableHead>Excepciones</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No hay usuarios de {nombreProyecto} con ese filtro.
                </TableCell>
              </TableRow>
            ) : (
              usuarios.map((u) => (
                <TableRow key={u.id} className="align-top">
                  <TableCell>
                    <p className="font-medium">{u.usuario}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {u.email ?? "sin correo"}
                      {u.emailRecibe === false && (
                        <span className="ml-1 text-amber-700" title="Este dominio no tiene buzones: no recibe correo">
                          · no recibe correo
                        </span>
                      )}
                    </p>
                    {u.correoRecuperacion ? (
                      <p className="flex items-center gap-1 text-[11px]">
                        <Mail className="h-3 w-3 text-muted-foreground" /> {u.correoRecuperacion}
                        {u.correoRecuperacionVerificado ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                        ) : (
                          <span className="text-amber-700">(sin confirmar)</span>
                        )}
                      </p>
                    ) : (
                      u.emailRecibe === false && (
                        <button type="button" className="text-[11px] text-amber-800 underline-offset-2 hover:underline" onClick={() => abrirCorreo(u)}>
                          Sin correo de recuperación: registrar
                        </button>
                      )
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{u.empresa_id == null ? "—" : nombreEmpresa(u.empresa_id)}</TableCell>
                  <TableCell>
                    <ClaveBadge u={u} />
                    {u.actualizadaEn && <p className="mt-1 text-[10px] text-muted-foreground">{fmtFecha(u.actualizadaEn)}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.perfiles.map((p) => (
                        <Badge key={p.id} variant="secondary" className="gap-1 pr-1 text-[10px]">
                          {p.perfil} · {nombreEmpresa(p.idempresa)}
                          <button type="button" className="rounded-full p-0.5 hover:bg-background" onClick={() => quitarPerfil(p.id)} disabled={ocupado} title="Quitar perfil">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px]" onClick={() => setAsignar({ usuario: u, tipo: "perfil" })}>
                        <Plus className="h-3 w-3" /> perfil
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.excepciones.map((e) => (
                        <Badge
                          key={e.id}
                          variant="outline"
                          className={`gap-1 pr-1 text-[10px] ${e.permitir ? "border-emerald-300 text-emerald-900" : "border-red-300 text-red-800"}`}
                          title={e.permitir ? "Concedido" : "Negado"}
                        >
                          {e.permitir ? "+" : "−"} {nombreProceso(e.proceso)} · {nombreEmpresa(e.idempresa)}
                          <button type="button" className="rounded-full p-0.5 hover:bg-muted" onClick={() => quitarExcepcion(e.id)} disabled={ocupado} title="Quitar excepción">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[10px]" onClick={() => setAsignar({ usuario: u, tipo: "excepcion" })}>
                        <Plus className="h-3 w-3" /> excepción
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setAsignar({ usuario: u, tipo: "perfil" })}>
                          <Plus className="mr-2 h-4 w-4" /> Asignar perfil
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setAsignar({ usuario: u, tipo: "excepcion" })}>
                          <Plus className="mr-2 h-4 w-4" /> Agregar excepción
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => abrirCorreo(u)}>
                          <Mail className="mr-2 h-4 w-4" /> Correo de recuperación…
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setConfirmar({ usuario: u, accion: "provisional" })}>
                          <KeyRound className="mr-2 h-4 w-4" /> Clave provisional
                        </DropdownMenuItem>
                        {u.bloqueadaHasta && (
                          <DropdownMenuItem onClick={() => desbloquear(u)}>
                            <Unlock className="mr-2 h-4 w-4" /> Desbloquear clave
                          </DropdownMenuItem>
                        )}
                        {u.tieneClave && (
                          <DropdownMenuItem className="text-destructive" onClick={() => setConfirmar({ usuario: u, accion: "eliminar" })}>
                            <Trash2 className="mr-2 h-4 w-4" /> Quitar clave
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {asignar && (
        <DialogAsignar data={data} usuario={asignar.usuario} tipo={asignar.tipo} empresaGlobal={empresaId} onClose={() => setAsignar(null)} onDone={recargar} />
      )}

      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar?.accion === "provisional" ? "Generar clave provisional" : "Quitar la clave"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar?.accion === "provisional" ? (
                <>
                  Se generará una clave provisional para <b>{confirmar.usuario.usuario}</b> (reemplaza la que tenga). Se muestra UNA sola
                  vez: entrégasela por un canal seguro. Con ella el usuario no puede autorizar nada hasta que defina su clave definitiva
                  en “Mi clave de autorización”.
                </>
              ) : (
                <>
                  <b>{confirmar?.usuario.usuario}</b> quedará sin clave de autorización y deberá crear una nueva. Sus perfiles se conservan.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={ejecutarConfirmacion} disabled={ocupado}>
              {ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!correoDlg} onOpenChange={(o) => !o && setCorreoDlg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Correo de recuperación · {correoDlg?.usuario}</DialogTitle>
            <DialogDescription>
              Buzón real donde le llegarán los códigos para recuperar su clave. Su usuario de acceso ({correoDlg?.email ?? "sin correo"})
              {correoDlg?.emailRecibe === false ? " no recibe correo." : " sí recibe correo; este solo lo reemplaza."} Quedará “sin confirmar”
              hasta que la persona lo confirme desde “Mi clave de autorización”, pero ya sirve para enviarle códigos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="correo-rec-admin" className="text-xs uppercase text-muted-foreground">
              Correo
            </Label>
            <Input id="correo-rec-admin" type="email" value={correoValor} onChange={(e) => setCorreoValor(e.target.value)} placeholder="nombre@gmail.com" autoComplete="off" />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {correoDlg?.correoRecuperacion && (
                <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => guardarCorreo(null)} disabled={guardandoCorreo}>
                  Quitar
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCorreoDlg(null)} disabled={guardandoCorreo}>
                Cancelar
              </Button>
              <Button onClick={() => guardarCorreo(correoValor)} disabled={guardandoCorreo || !correoValor.includes("@")}>
                {guardandoCorreo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Guardar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!provisional} onOpenChange={(o) => !o && setProvisional(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clave provisional de {provisional?.usuario}</DialogTitle>
            <DialogDescription>Cópiala ahora: no se volverá a mostrar. El usuario debe cambiarla al primer uso.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3 font-mono text-2xl tracking-widest">
            <span>{provisional?.clave}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (provisional) navigator.clipboard?.writeText(provisional.clave).then(() => toast({ title: "Copiada" }))
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setProvisional(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function DialogAsignar({
  data,
  usuario,
  tipo,
  empresaGlobal,
  onClose,
  onDone,
}: {
  data: ResumenAutorizaciones
  usuario: UsuarioAutorizacion
  tipo: "perfil" | "excepcion"
  empresaGlobal: number | null
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { toast } = useToast()
  const [perfilId, setPerfilId] = useState<string>("")
  const [proceso, setProceso] = useState<string>("")
  // Alcance por defecto: el proyecto del selector global; si no hay, el del usuario.
  const [alcance, setAlcance] = useState<string>(
    empresaGlobal != null ? String(empresaGlobal) : usuario.empresa_id == null ? TODOS : String(usuario.empresa_id),
  )
  const [permitir, setPermitir] = useState<"si" | "no">("si")
  const [guardando, setGuardando] = useState(false)

  const grupos = Array.from(new Set(data.procesos.map((p) => p.grupo)))
  const procesoSel = data.procesos.find((p) => p.codigo === proceso)
  const conAlcance = tipo === "perfil" ? true : procesoSel?.con_alcance !== false

  const guardar = async () => {
    setGuardando(true)
    const idempresa = !conAlcance || alcance === TODOS ? null : Number(alcance)
    const r =
      tipo === "perfil"
        ? await adminAsignarPerfil(usuario.id, Number(perfilId), idempresa)
        : await adminGuardarExcepcion(usuario.id, proceso, idempresa, permitir === "si")
    setGuardando(false)
    if (r.success) {
      toast({ title: tipo === "perfil" ? "Perfil asignado" : "Excepción guardada", description: usuario.usuario })
      await onDone()
      onClose()
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tipo === "perfil" ? "Asignar perfil" : "Agregar excepción"} · {usuario.usuario}</DialogTitle>
          <DialogDescription>
            {tipo === "perfil"
              ? "El perfil trae todos sus procesos. El alcance limita en qué proyecto(s) valen."
              : "Concede o niega UN proceso puntual. Una negación gana sobre cualquier perfil."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {tipo === "perfil" ? (
            <div className="space-y-1">
              <Label className="text-xs uppercase text-muted-foreground">Perfil (puesto)</Label>
              <Select value={perfilId} onValueChange={setPerfilId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elige el perfil…" />
                </SelectTrigger>
                <SelectContent>
                  {data.perfiles
                    .filter((p) => p.activo)
                    .map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.nombre} ({p.procesos.length} procesos)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Proceso</Label>
                <Select value={proceso} onValueChange={setProceso}>
                  <SelectTrigger>
                    <SelectValue placeholder="Elige el proceso…" />
                  </SelectTrigger>
                  <SelectContent>
                    {grupos.map((g) => (
                      <div key={g}>
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {g}
                          {esGrupoSoloLip(g) ? " · solo LIP" : ""}
                        </p>
                        {data.procesos
                          .filter((p) => p.grupo === g)
                          .map((p) => (
                            <SelectItem key={p.codigo} value={p.codigo}>
                              {p.nombre}
                            </SelectItem>
                          ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Efecto</Label>
                <Select value={permitir} onValueChange={(v) => setPermitir(v as "si" | "no")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="si">Conceder (puede autorizar)</SelectItem>
                    <SelectItem value="no">Negar (aunque su perfil lo tenga)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {conAlcance && (
            <div className="space-y-1">
              <Label className="text-xs uppercase text-muted-foreground">Alcance</Label>
              <Select value={alcance} onValueChange={setAlcance}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos los proyectos</SelectItem>
                  {data.empresas.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {alcance === TODOS && tipo === "perfil" && (
                <p className="text-[11px] text-amber-800">
                  “Todos los proyectos” es para la gerencia general de LIPgo. La gerencia de un cliente debe tener alcance a SU proyecto.
                </p>
              )}
            </div>
          )}
          {((tipo === "excepcion" && esGrupoSoloLip(procesoSel?.grupo)) ||
            (tipo === "perfil" &&
              data.perfiles
                .find((p) => String(p.id) === perfilId)
                ?.procesos.some((c) => esGrupoSoloLip(data.procesos.find((x) => x.codigo === c)?.grupo)))) && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              Incluye procesos financieros (propiedad de LIP). Solo se puede otorgar a usuarios que ya tengan módulos de Gestión Financiera en
              Gestión de Usuarios; si no los tiene, el sistema rechazará la asignación.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || (tipo === "perfil" ? !perfilId : !proceso)}>
            {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Perfiles × procesos
// ---------------------------------------------------------------------------

function PerfilesTab({ data, recargar }: { data: ResumenAutorizaciones; recargar: () => Promise<void> }) {
  const [nuevo, setNuevo] = useState(false)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Un perfil es un <b>puesto</b>: marca qué procesos puede autorizar. Luego se asigna a cada usuario con su alcance.
        </p>
        <Button size="sm" className="gap-1.5" onClick={() => setNuevo(true)} disabled={nuevo}>
          <Plus className="h-4 w-4" /> Nuevo perfil
        </Button>
      </div>
      {nuevo && (
        <PerfilCard
          perfil={{ id: 0, nombre: "", descripcion: "", activo: true, procesos: [], usuarios: 0 }}
          procesos={data.procesos}
          esNuevo
          onCancelar={() => setNuevo(false)}
          onGuardado={async () => {
            setNuevo(false)
            await recargar()
          }}
        />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.perfiles.map((p) => (
          <PerfilCard key={p.id} perfil={p} procesos={data.procesos} onGuardado={recargar} />
        ))}
      </div>
    </div>
  )
}

function PerfilCard({
  perfil,
  procesos,
  esNuevo,
  onCancelar,
  onGuardado,
}: {
  perfil: PerfilAutorizacion
  procesos: ProcesoAutorizable[]
  esNuevo?: boolean
  onCancelar?: () => void
  onGuardado: () => Promise<void>
}) {
  const { toast } = useToast()
  const [nombre, setNombre] = useState(perfil.nombre)
  const [descripcion, setDescripcion] = useState(perfil.descripcion ?? "")
  const [activo, setActivo] = useState(perfil.activo)
  const [sel, setSel] = useState<Set<string>>(new Set(perfil.procesos))
  const [guardando, setGuardando] = useState(false)
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)

  useEffect(() => {
    setNombre(perfil.nombre)
    setDescripcion(perfil.descripcion ?? "")
    setActivo(perfil.activo)
    setSel(new Set(perfil.procesos))
  }, [perfil])

  const cambiado =
    esNuevo ||
    nombre !== perfil.nombre ||
    descripcion !== (perfil.descripcion ?? "") ||
    activo !== perfil.activo ||
    sel.size !== perfil.procesos.length ||
    perfil.procesos.some((p) => !sel.has(p))

  const grupos = Array.from(new Set(procesos.map((p) => p.grupo)))
  const toggle = (codigo: string, on: boolean) =>
    setSel((prev) => {
      const n = new Set(prev)
      if (on) n.add(codigo)
      else n.delete(codigo)
      return n
    })

  const guardar = async () => {
    setGuardando(true)
    const r = await adminGuardarPerfil({ id: esNuevo ? null : perfil.id, nombre, descripcion, activo, procesos: Array.from(sel) })
    setGuardando(false)
    if (r.success) {
      toast({ title: "Perfil guardado", description: nombre })
      await onGuardado()
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }
  const eliminar = async () => {
    setGuardando(true)
    const r = await adminEliminarPerfil(perfil.id)
    setGuardando(false)
    setConfirmarBorrar(false)
    if (r.success) {
      toast({ title: "Perfil eliminado", description: perfil.nombre })
      await onGuardado()
    } else toast({ title: "No se pudo eliminar", description: r.message, variant: "destructive" })
  }

  return (
    <Card className={esNuevo ? "border-primary/50" : !activo ? "opacity-70" : ""}>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-2">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del perfil (puesto)" className="h-9 font-semibold" />
            <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Descripción (para quién es)" className="h-8 text-xs" />
          </div>
          {!esNuevo && (
            <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
              <Users className="h-3 w-3" /> {perfil.usuarios}
            </Badge>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={activo} onCheckedChange={setActivo} /> {activo ? "Activo" : "Inactivo (no autoriza nada)"}
        </label>
      </CardHeader>
      <CardContent className="space-y-3">
        {grupos.map((g) => (
          <div key={g}>
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
              {g}
              {esGrupoSoloLip(g) && (
                <Badge variant="outline" className="h-4 gap-0.5 px-1 text-[9px] normal-case text-amber-800" title="Solo usuarios de LIP con módulos de Gestión Financiera">
                  <Lock className="h-2.5 w-2.5" /> solo LIP
                </Badge>
              )}
            </p>
            <div className="grid gap-1 sm:grid-cols-2">
              {procesos
                .filter((p) => p.grupo === g)
                .map((p) => (
                  <label key={p.codigo} className="flex items-start gap-2 rounded-md border p-1.5 text-xs hover:bg-muted/40" title={p.descripcion ?? ""}>
                    <Checkbox checked={sel.has(p.codigo)} onCheckedChange={(c) => toggle(p.codigo, Boolean(c))} className="mt-0.5" />
                    <span>{p.nombre}</span>
                  </label>
                ))}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1">
          <div>
            {!esNuevo && (
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-destructive hover:text-destructive" onClick={() => setConfirmarBorrar(true)} disabled={perfil.usuarios > 0 || guardando} title={perfil.usuarios > 0 ? "Quítaselo a los usuarios primero" : ""}>
                <Trash2 className="h-3.5 w-3.5" /> Eliminar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {esNuevo && (
              <Button variant="outline" size="sm" className="h-8" onClick={onCancelar} disabled={guardando}>
                Cancelar
              </Button>
            )}
            <Button size="sm" className="h-8" onClick={guardar} disabled={!cambiado || !nombre.trim() || guardando}>
              {guardando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Guardar
            </Button>
          </div>
        </div>
      </CardContent>
      <AlertDialog open={confirmarBorrar} onOpenChange={setConfirmarBorrar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el perfil “{perfil.nombre}”?</AlertDialogTitle>
            <AlertDialogDescription>No está asignado a nadie. Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={eliminar}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Bitácora
// ---------------------------------------------------------------------------

function BitacoraTab({ data, empresaId, nombreProyecto }: { data: ResumenAutorizaciones; empresaId: number | null; nombreProyecto: string }) {
  const { toast } = useToast()
  const [rows, setRows] = useState<LogAutorizacion[]>([])
  const [loading, setLoading] = useState(true)
  const [resultado, setResultado] = useState<string>("todos")

  const cargar = useCallback(async () => {
    setLoading(true)
    // Filtro global de proyecto: registros de ese proyecto + los sin proyecto
    // (procesos financieros y eventos de clave/administración).
    const r = await adminGetLog({ limit: 400, resultado: resultado === "todos" ? null : resultado, idempresa: empresaId })
    if (r.success && r.data) setRows(r.data)
    else toast({ title: "Error", description: r.message, variant: "destructive" })
    setLoading(false)
  }, [resultado, empresaId, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const nombreProceso = (codigo: string) => data.procesos.find((p) => p.codigo === codigo)?.nombre || PROCESO_INTERNO_LABEL[codigo] || codigo
  const nombreEmpresa = (id: number | null) => (id == null ? "" : data.empresas.find((e) => e.id === id)?.nombre || `Proyecto ${id}`)
  const labelResultado = (r: string) => RESULTADO_LABEL[r] || RESULTADO_INTERNO_LABEL[r] || r
  const colorResultado = (r: string) =>
    r === "ok" || r === "ok_compartida"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : r === "sin_permiso" || r === "clave_incorrecta" || r === "bloqueado"
        ? "border-red-300 bg-red-50 text-red-800"
        : "border-border bg-muted/40 text-muted-foreground"

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Bitácora de autorizaciones</CardTitle>
            <CardDescription>
              Cada intento de autorizar queda aquí: quién, qué proceso, en qué proyecto y el resultado.{" "}
              {empresaId != null ? (
                <>
                  Mostrando <b>{nombreProyecto}</b> (selector global) más los registros sin proyecto (financiero, claves, administración).
                </>
              ) : (
                <>Mostrando todos los proyectos.</>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={resultado} onValueChange={setResultado}>
              <SelectTrigger className="h-9 w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los resultados</SelectItem>
                {Object.entries(RESULTADO_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={cargar} disabled={loading} className="h-9 gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Proceso</TableHead>
              <TableHead>Proyecto</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Autorizó</TableHead>
              <TableHead>Referencia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {loading ? "Cargando…" : "Sin registros."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fmtFecha(r.created_at)}</TableCell>
                  <TableCell className="text-xs">{r.usuario ?? "—"}</TableCell>
                  <TableCell className="text-xs">{nombreProceso(r.proceso)}</TableCell>
                  <TableCell className="text-xs">{nombreEmpresa(r.idempresa)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${colorResultado(r.resultado)}`}>
                      {labelResultado(r.resultado)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{r.autorizado_por ?? ""}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.referencia ?? ""}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
