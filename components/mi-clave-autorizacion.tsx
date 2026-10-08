"use client"

/**
 * "Mi clave de autorización" — autoservicio del usuario (SQL 203).
 *
 *  - Crear la clave personal (primera vez) o cambiarla.
 *  - Recuperarla con un código de 6 dígitos enviado al correo del usuario
 *    (si el envío de correo está configurado; si no, camino asistido: clave
 *    provisional desde Gestión de Usuarios).
 *  - Ver qué procesos tiene autorizados y en qué proyectos.
 *
 * Se abre desde el menú de usuario (barra superior) y desde el enlace
 * "¿No tienes clave o la olvidaste?" que acompaña cada campo de clave
 * (`AyudaClaveAutorizacion`).
 */

import { useCallback, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck, Lock } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  cambiarMiClave,
  confirmarCorreoRecuperacion,
  crearMiClave,
  getMiEstadoClave,
  recuperarClaveConCodigo,
  solicitarCodigoRecuperacion,
  solicitarVerificacionCorreo,
} from "@/lib/autorizaciones-actions"
import { CLAVE_MIN_LARGO, validarFormatoClave, type EstadoMiClave } from "@/lib/autorizaciones"
import { SegundoFactorPanel } from "@/components/seguridad/segundo-factor"

type Pestana = "clave" | "correo" | "recuperar" | "autorizaciones" | "seguridad"

function fmtFecha(iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })
  } catch {
    return String(iso)
  }
}

function CampoClave({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  onEnter?: () => void
}) {
  const [mostrar, setMostrar] = useState(false)
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs uppercase text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={mostrar ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "••••••"}
          autoComplete="off"
          autoFocus={autoFocus}
          className="pr-10"
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter()
          }}
        />
        <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => setMostrar((m) => !m)}>
          {mostrar ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
          <span className="sr-only">{mostrar ? "Ocultar" : "Mostrar"}</span>
        </Button>
      </div>
    </div>
  )
}

function EstadoBadge({ estado }: { estado: EstadoMiClave }) {
  if (estado.bloqueadaHasta) {
    return (
      <Badge variant="destructive" className="gap-1">
        <Lock className="h-3 w-3" /> Bloqueada hasta {fmtFecha(estado.bloqueadaHasta)}
      </Badge>
    )
  }
  if (!estado.tieneClave) {
    return (
      <Badge className="gap-1 border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-100">
        <AlertTriangle className="h-3 w-3" /> Sin clave personal
      </Badge>
    )
  }
  if (estado.provisional) {
    return (
      <Badge className="gap-1 border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-100">
        <AlertTriangle className="h-3 w-3" /> Clave provisional: debes definir la tuya
      </Badge>
    )
  }
  return (
    <Badge className="gap-1 border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
      <CheckCircle2 className="h-3 w-3" /> Clave activa
    </Badge>
  )
}

export function MiClaveAutorizacionDialog({
  open,
  onOpenChange,
  pestanaInicial = "clave",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pestanaInicial?: Pestana
}) {
  const { toast } = useToast()
  const [estado, setEstado] = useState<EstadoMiClave | null>(null)
  const [cargando, setCargando] = useState(false)
  const [tab, setTab] = useState<Pestana>(pestanaInicial)

  // Crear / cambiar
  const [actual, setActual] = useState("")
  const [nueva, setNueva] = useState("")
  const [confirmar, setConfirmar] = useState("")
  const [guardando, setGuardando] = useState(false)

  // Recuperar
  const [enviando, setEnviando] = useState(false)
  const [destino, setDestino] = useState<string | null>(null)
  const [codigo, setCodigo] = useState("")
  const [nuevaRec, setNuevaRec] = useState("")
  const [confirmarRec, setConfirmarRec] = useState("")
  const [restableciendo, setRestableciendo] = useState(false)

  // Correo de recuperación (buzón real, distinto del correo de acceso)
  const [correoNuevo, setCorreoNuevo] = useState("")
  const [enviandoCorreo, setEnviandoCorreo] = useState(false)
  const [correoPendiente, setCorreoPendiente] = useState<string | null>(null)
  const [codigoCorreo, setCodigoCorreo] = useState("")
  const [confirmandoCorreo, setConfirmandoCorreo] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setEstado(await getMiEstadoClave())
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setTab(pestanaInicial)
    setActual("")
    setNueva("")
    setConfirmar("")
    setDestino(null)
    setCodigo("")
    setNuevaRec("")
    setConfirmarRec("")
    setCorreoNuevo("")
    setCorreoPendiente(null)
    setCodigoCorreo("")
    cargar()
  }, [open, pestanaInicial, cargar])

  const enviarVerificacionCorreo = async () => {
    setEnviandoCorreo(true)
    const r = await solicitarVerificacionCorreo(correoNuevo)
    setEnviandoCorreo(false)
    if (r.success) {
      setCorreoPendiente(r.destino ?? correoNuevo)
      setCodigoCorreo("")
      toast({ title: "Código enviado", description: r.message })
    } else toast({ title: "No se pudo enviar", description: r.message, variant: "destructive" })
  }

  const confirmarCorreo = async () => {
    if (codigoCorreo.length !== 6) return
    setConfirmandoCorreo(true)
    const r = await confirmarCorreoRecuperacion(codigoCorreo)
    setConfirmandoCorreo(false)
    if (r.success) {
      toast({ title: "Correo confirmado", description: r.message })
      setCorreoPendiente(null)
      setCorreoNuevo("")
      setCodigoCorreo("")
      await cargar()
    } else toast({ title: "No se pudo confirmar", description: r.message, variant: "destructive" })
  }

  const errorFormato = nueva ? validarFormatoClave(nueva) : null
  const puedeGuardar = Boolean(nueva && confirmar && !errorFormato && nueva === confirmar && (estado?.tieneClave ? actual : true))

  const guardar = async () => {
    if (!estado || !puedeGuardar) return
    const eraCreacion = !estado.tieneClave
    // Si hoy no tiene forma de recuperarla, hay que resolverlo AHORA que está aquí.
    const sinComoRecuperar = !estado.correoRecuperacion && estado.correoLoginRecibe === false
    setGuardando(true)
    const r = estado.tieneClave ? await cambiarMiClave(actual, nueva, confirmar) : await crearMiClave(nueva, confirmar)
    setGuardando(false)
    if (r.success) {
      setActual("")
      setNueva("")
      setConfirmar("")
      await cargar()
      /*
       * EL CORREO DE RECUPERACIÓN SE PIDE JUSTO DESPUÉS DE CREAR LA CLAVE.
       *
       * Medido el 2026-10-08: de las 22 personas con perfil de autorización, 21 no tienen
       * correo de recuperación, y su correo de acceso @lipgo.app NO es un buzón. Si crean su
       * clave y la olvidan, no pueden recuperarla solos: cada una depende de que Gestión de
       * Usuarios le genere una clave provisional. Con las claves compartidas venciendo el
       * 27 de octubre, son 19 personas a punto de pasar por aquí.
       *
       * Avisar DESPUÉS, cuando ya olvidaron la clave, no sirve de nada. Aquí ya están en la
       * ventana, con la cabeza en el tema y treinta segundos de trabajo por delante.
       */
      if (eraCreacion && sinComoRecuperar) {
        setTab("correo")
        toast({
          title: "Clave creada. Falta un paso para no quedarte por fuera",
          description:
            "Registra un correo real (tu Gmail o tu correo corporativo) para poder recuperar la clave si la olvidas. " +
            "Tu correo de acceso @lipgo.app no recibe mensajes. Toma treinta segundos y te evita depender de Gestión de Usuarios.",
        })
      } else {
        toast({ title: "Clave de autorización", description: r.message })
      }
    } else {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
    }
  }

  const enviarCodigo = async () => {
    setEnviando(true)
    const r = await solicitarCodigoRecuperacion()
    setEnviando(false)
    if (r.success) {
      setDestino(r.destino ?? estado?.correoEnmascarado ?? "tu correo")
      toast({ title: "Código enviado", description: r.message })
    } else {
      toast({ title: "No se pudo enviar el código", description: r.message, variant: "destructive" })
    }
  }

  const errorFormatoRec = nuevaRec ? validarFormatoClave(nuevaRec) : null
  const puedeRestablecer = Boolean(codigo.length === 6 && nuevaRec && confirmarRec && !errorFormatoRec && nuevaRec === confirmarRec)

  const restablecer = async () => {
    if (!puedeRestablecer) return
    setRestableciendo(true)
    const r = await recuperarClaveConCodigo(codigo, nuevaRec, confirmarRec)
    setRestableciendo(false)
    if (r.success) {
      toast({ title: "Clave restablecida", description: r.message })
      setDestino(null)
      setCodigo("")
      setNuevaRec("")
      setConfirmarRec("")
      setTab("clave")
      await cargar()
    } else {
      toast({ title: "No se pudo restablecer", description: r.message, variant: "destructive" })
    }
  }

  const hoy = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
  const transicionVigente = Boolean(estado?.transicionHasta && estado.transicionHasta >= hoy)
  const grupos = Array.from(new Set((estado?.autorizaciones ?? []).map((a) => a.grupo)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Mi clave de autorización
          </DialogTitle>
          <DialogDescription>
            Es tu clave PERSONAL para autorizar procesos en LIPgo (aprobar ajustes de inventario, liberar cuarentena, anular
            pedidos, cartera, financiera…). Solo tú la conoces y queda registrado tu nombre en cada autorización.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          {cargando && !estado ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </span>
          ) : estado ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <EstadoBadge estado={estado} />
                {estado.actualizadaEn && <span className="text-xs text-muted-foreground">Actualizada: {fmtFecha(estado.actualizadaEn)}</span>}
              </div>
              {estado.correoRecuperacion ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" /> Correo de recuperación: {estado.correoRecuperacion}
                  {estado.correoRecuperacionVerificado ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <span className="text-amber-700">(sin confirmar)</span>
                  )}
                </p>
              ) : estado.correoLoginRecibe === false ? (
                <p className="flex items-start gap-1.5 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Tu usuario de acceso ({estado.correoEnmascarado}) no es un buzón real. Registra un correo de recuperación en la
                    pestaña <b>Correo</b> para poder recuperar tu clave.
                  </span>
                </p>
              ) : estado.correoEnmascarado ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" /> Correo de recuperación: {estado.correoEnmascarado} (el de acceso)
                </p>
              ) : null}
              {transicionVigente && (
                <p className="text-xs text-muted-foreground">
                  Hasta el <b>{estado.transicionHasta}</b> también siguen valiendo las claves compartidas de antes. Después, solo
                  la personal.
                </p>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">No hay sesión activa.</span>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Pestana)}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="clave">Mi clave</TabsTrigger>
            <TabsTrigger value="correo" className="gap-1">
              Correo
              {estado && !estado.correoRecuperacion && estado.correoLoginRecibe === false && <AlertTriangle className="h-3 w-3 text-amber-600" />}
            </TabsTrigger>
            <TabsTrigger value="recuperar">Recuperar</TabsTrigger>
            <TabsTrigger value="autorizaciones">Permisos{estado ? ` (${estado.autorizaciones.length})` : ""}</TabsTrigger>
            <TabsTrigger value="seguridad" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Seguridad
            </TabsTrigger>
          </TabsList>

          {/* ===== Segundo factor (TOTP), opcional por usuario ===== */}
          <TabsContent value="seguridad" className="mt-4 space-y-3">
            <SegundoFactorPanel />
          </TabsContent>

          {/* ===== Correo de recuperación ===== */}
          <TabsContent value="correo" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              El correo de recuperación es un <b>buzón real</b> (tu Gmail, Outlook o corporativo) donde te llegan los códigos para
              recuperar tu clave. Es distinto del usuario con el que entras a LIPgo, que puede no recibir correo.
            </p>
            {estado?.correoRecuperacion && (
              <div className="flex items-center gap-2 rounded-md border p-2.5 text-xs">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>
                  Actual: <b>{estado.correoRecuperacion}</b>{" "}
                  {estado.correoRecuperacionVerificado ? (
                    <span className="text-emerald-700">confirmado</span>
                  ) : (
                    <span className="text-amber-700">sin confirmar (lo registró Gestión de Usuarios; puedes confirmarlo o cambiarlo abajo)</span>
                  )}
                </span>
              </div>
            )}
            {!estado?.correoDisponible ? (
              <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> El envío de correos no está configurado; pide a Gestión de Usuarios que
                registre tu correo de recuperación.
              </p>
            ) : !correoPendiente ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="correo-rec" className="text-xs uppercase text-muted-foreground">
                    {estado?.correoRecuperacion ? "Nuevo correo de recuperación" : "Tu correo de recuperación"}
                  </Label>
                  <Input
                    id="correo-rec"
                    type="email"
                    value={correoNuevo}
                    onChange={(e) => setCorreoNuevo(e.target.value)}
                    placeholder="nombre@gmail.com"
                    autoComplete="email"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && correoNuevo.includes("@")) enviarVerificacionCorreo()
                    }}
                  />
                </div>
                <Button onClick={enviarVerificacionCorreo} disabled={!correoNuevo.includes("@") || enviandoCorreo} className="w-full" variant="secondary">
                  {enviandoCorreo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Enviarme un código a ese correo
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enviado a <b>{correoPendiente}</b>. Escribe el código de 6 dígitos para confirmar que ese correo es tuyo.{" "}
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={enviarVerificacionCorreo} disabled={enviandoCorreo}>
                    Reenviar
                  </button>{" "}
                  ·{" "}
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setCorreoPendiente(null)}>
                    Cambiar correo
                  </button>
                </p>
                <InputOTP maxLength={6} value={codigoCorreo} onChange={setCodigoCorreo}>
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                <Button onClick={confirmarCorreo} disabled={codigoCorreo.length !== 6 || confirmandoCorreo} className="w-full">
                  {confirmandoCorreo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Confirmar correo
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ===== Mi clave ===== */}
          <TabsContent value="clave" className="mt-4 space-y-3">
            {estado?.provisional && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Gestión de Usuarios te asignó una clave <b>provisional</b>. Escríbela como “clave actual” y define aquí la tuya;
                  hasta que no lo hagas no podrás autorizar nada.
                </span>
              </div>
            )}
            {estado?.tieneClave ? (
              <CampoClave id="clave-actual" label={estado.provisional ? "Clave provisional (actual)" : "Clave actual"} value={actual} onChange={setActual} autoFocus />
            ) : (
              <p className="text-xs text-muted-foreground">
                Aún no tienes clave. Crea una de al menos {CLAVE_MIN_LARGO} caracteres (letras y/o números) que solo tú
                conozcas. No uses la misma contraseña con la que entras a LIPgo.
              </p>
            )}
            <CampoClave id="clave-nueva" label="Clave nueva" value={nueva} onChange={setNueva} autoFocus={!estado?.tieneClave} />
            <CampoClave id="clave-confirmar" label="Confirmar clave nueva" value={confirmar} onChange={setConfirmar} onEnter={guardar} />
            {errorFormato && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5" /> {errorFormato}
              </p>
            )}
            {!errorFormato && nueva && confirmar && nueva !== confirmar && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5" /> La confirmación no coincide.
              </p>
            )}
            <Button onClick={guardar} disabled={!puedeGuardar || guardando || !estado} className="w-full">
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {estado?.tieneClave ? "Cambiar mi clave" : "Crear mi clave"}
            </Button>
          </TabsContent>

          {/* ===== Recuperar ===== */}
          <TabsContent value="recuperar" className="mt-4 space-y-3">
            {!estado?.tieneClave ? (
              <p className="text-xs text-muted-foreground">Aún no tienes clave: créala en la pestaña “Mi clave”.</p>
            ) : !estado.correoDisponible ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  El envío de correos aún no está configurado en LIPgo. Si olvidaste tu clave, pide a <b>Gestión de Usuarios</b>{" "}
                  (Configuración › Autorizaciones por clave) una <b>clave provisional</b>; con ella entras aquí a “Mi clave” y
                  defines la tuya.
                </span>
              </div>
            ) : !estado.correoRecuperacion && estado.correoLoginRecibe === false ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Tu usuario de acceso ({estado.correoEnmascarado}) no es un buzón real, así que no hay dónde enviarte el código.
                  Registra primero un correo de recuperación en la pestaña <b>Correo</b>. Si ya no recuerdas tu clave y no puedes
                  entrar, pide a Gestión de Usuarios una clave provisional.
                </span>
              </div>
            ) : !destino ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Te enviaremos un código de 6 dígitos a <b>{estado.correoRecuperacion ?? estado.correoEnmascarado ?? "tu correo"}</b>. Vence en
                  15 minutos.
                </p>
                <Button onClick={enviarCodigo} disabled={enviando} className="w-full" variant="secondary">
                  {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  Enviarme el código
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enviado a <b>{destino}</b>. Revisa también la carpeta de spam.{" "}
                  <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={enviarCodigo} disabled={enviando}>
                    Reenviar
                  </button>
                </p>
                <div className="space-y-1">
                  <Label className="text-xs uppercase text-muted-foreground">Código recibido</Label>
                  <InputOTP maxLength={6} value={codigo} onChange={setCodigo}>
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <CampoClave id="rec-nueva" label="Clave nueva" value={nuevaRec} onChange={setNuevaRec} />
                <CampoClave id="rec-confirmar" label="Confirmar clave nueva" value={confirmarRec} onChange={setConfirmarRec} onEnter={restablecer} />
                {errorFormatoRec && (
                  <p className="flex items-center gap-1 text-xs text-red-600">
                    <AlertTriangle className="h-3.5 w-3.5" /> {errorFormatoRec}
                  </p>
                )}
                <Button onClick={restablecer} disabled={!puedeRestablecer || restableciendo} className="w-full">
                  {restableciendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  Restablecer mi clave
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ===== Autorizaciones ===== */}
          <TabsContent value="autorizaciones" className="mt-4 space-y-3">
            {!estado || estado.autorizaciones.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Tu usuario no tiene procesos autorizados. Si tu puesto lo requiere, pídelo a Gestión de Usuarios (Configuración ›
                Autorizaciones por clave).
              </p>
            ) : (
              grupos.map((g) => (
                <div key={g} className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">{g}</p>
                  <ul className="space-y-1">
                    {estado.autorizaciones
                      .filter((a) => a.grupo === g)
                      .map((a) => (
                        <li key={a.proceso} className="flex items-start justify-between gap-2 rounded-md border p-2 text-xs">
                          <div>
                            <p className="font-medium">{a.nombre}</p>
                            <p className="text-muted-foreground">{a.alcance}</p>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {a.origen}
                          </Badge>
                        </li>
                      ))}
                  </ul>
                </div>
              ))
            )}
            {estado && estado.denegadas.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase text-red-700">Negados expresamente</p>
                <ul className="space-y-1">
                  {estado.denegadas.map((a) => (
                    <li key={a.proceso} className="rounded-md border border-red-200 bg-red-50 p-2 text-xs">
                      <p className="font-medium">{a.nombre}</p>
                      <p className="text-muted-foreground">{a.alcance}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Enlace "¿No tienes clave o la olvidaste?" para poner debajo de cualquier
 * campo de clave de autorización. Abre el diálogo de autoservicio.
 */
export function AyudaClaveAutorizacion({ className, texto }: { className?: string; texto?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 text-[11px] text-primary underline-offset-2 hover:underline ${className ?? ""}`}
      >
        <KeyRound className="h-3 w-3" /> {texto ?? "¿No tienes clave o la olvidaste?"}
      </button>
      <MiClaveAutorizacionDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
