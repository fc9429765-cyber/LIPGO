"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { CheckCircle2, XCircle, Loader2, LogIn, LogOut, Clock } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { MarcacionesDelDia } from "@/components/marcaciones-del-dia"
import { cn } from "@/lib/utils"

// Formateadores Intl creados UNA vez fuera del componente: son objetos
// pesados y no cambian entre renders. Ambos fijan zona horaria
// "America/Bogota" para que la hora mostrada sea SIEMPRE la de Colombia,
// independiente del huso horario del navegador del operador.
const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Bogota",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})
const DATE_FORMATTER = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

export default function AttendanceRegistration() {
  const [identificacion, setIdentificacion] = useState("")
  const [loading, setLoading] = useState(false)
  // `action` indica que boton esta activo durante el submit, para que el
  // spinner aparezca en el correcto. Se limpia al terminar.
  const [action, setAction] = useState<"entrada" | "salida" | null>(null)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const { selectedEmpresaId } = useAuth()

  // Reloj en vivo. Inicia como null para evitar mismatch SSR/CSR (el
  // server renderiza la hora del momento del request, el cliente
  // hidrata con otro valor unos ms despues). Se actualiza cada segundo
  // y solo se muestra cuando ya hay un valor del lado del cliente.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // CÁMARA OBLIGATORIA: se enciende al entrar al módulo y captura una foto en
  // cada marcación. Si no hay cámara, no hay permiso, o la foto no se puede
  // tomar, NO se permite marcar. (Antes era falla-segura y registraba sin foto.)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Ultima foto capturada. Sirve para detectar una camara CONGELADA: si el
  // frame nuevo sale byte a byte identico al anterior, el video no esta
  // avanzando (autoplay bloqueado, pestaña en segundo plano, equipo
  // suspendido) y todas las personas terminarian con la MISMA foto.
  const ultimaFotoRef = useRef<string | null>(null)
  const [camaraOk, setCamaraOk] = useState(false)
  const [camaraError, setCamaraError] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          // El error de play() ya NO se traga en silencio: si el autoplay
          // queda bloqueado el video se congela y esa era justamente la causa
          // de que varias personas salieran con la misma foto.
          await videoRef.current.play().catch((err) => {
            console.warn("[v0] video.play() fallo en asistencia:", err)
          })
        }
        setCamaraOk(true)
        setCamaraError(null)
      } catch (e: any) {
        console.warn("[v0] Cámara no disponible para asistencia:", e)
        setCamaraOk(false)
        setCamaraError(
          e?.name === "NotAllowedError" || e?.name === "SecurityError"
            ? "Permiso de cámara denegado. Habilítelo en el navegador para poder marcar."
            : "No se detectó ninguna cámara disponible en este equipo.",
        )
      }
    })()

    // En un kiosko la pestaña puede quedar en segundo plano o el equipo
    // suspenderse; al volver, el <video> queda pausado en el ultimo frame. Se
    // reanuda para que la siguiente foto no sea la misma de antes.
    const alVolverAlFrente = () => {
      if (document.visibilityState !== "visible") return
      const v = videoRef.current
      if (v && v.paused) v.play().catch(() => {})
    }
    document.addEventListener("visibilitychange", alVolverAlFrente)

    return () => {
      cancelado = true
      document.removeEventListener("visibilitychange", alVolverAlFrente)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  type ResultadoFoto = { ok: true; dataUrl: string } | { ok: false; motivo: string }

  /**
   * Captura un frame del video como JPEG comprimido.
   *
   * Antes de capturar verifica que la camara este VIVA, y despues verifica que
   * el frame no sea identico al anterior. Sin esas dos comprobaciones un video
   * congelado devolvia la misma imagen una y otra vez, que es el bug de
   * "varias personas con exactamente la misma foto".
   */
  const capturarFoto = async (): Promise<ResultadoFoto> => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return { ok: false, motivo: "La cámara no está inicializada." }

    const track = streamRef.current?.getVideoTracks()?.[0]
    if (!track || track.readyState !== "live") {
      return { ok: false, motivo: "La cámara se desconectó. Recargue la página." }
    }
    if (track.muted) {
      return {
        ok: false,
        motivo: "La cámara está en pausa. Verifique que no la esté usando otra aplicación.",
      }
    }

    // Si el video quedo pausado, se intenta reanudar antes de darlo por perdido.
    if (video.paused) {
      await video.play().catch(() => {})
    }

    // readyState < 2 (HAVE_CURRENT_DATA) = todavia no hay un frame disponible.
    if (video.paused || video.readyState < 2 || !video.videoWidth) {
      return {
        ok: false,
        motivo: "La cámara aún no está lista. Espere un momento e intente de nuevo.",
      }
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return { ok: false, motivo: "No se pudo procesar la imagen de la cámara." }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    let dataUrl: string
    try {
      dataUrl = canvas.toDataURL("image/jpeg", 0.6)
    } catch {
      return { ok: false, motivo: "No se pudo procesar la imagen de la cámara." }
    }
    if (!dataUrl.startsWith("data:image")) {
      return { ok: false, motivo: "No se pudo procesar la imagen de la cámara." }
    }

    // Camara congelada: dos frames de una camara real nunca salen byte a byte
    // iguales (siempre hay ruido de sensor). Si coinciden, el video no avanza.
    if (ultimaFotoRef.current === dataUrl) {
      return {
        ok: false,
        motivo: "La imagen de la cámara está congelada. Recargue la página antes de volver a marcar.",
      }
    }

    ultimaFotoRef.current = dataUrl
    return { ok: true, dataUrl }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!identificacion.trim()) {
      setMessage({ type: "error", text: "Por favor ingrese un documento de identificación" })
      return
    }

    if (!selectedEmpresaId) {
      setMessage({ type: "error", text: "No se pudo obtener la información de la empresa" })
      return
    }

    setLoading(true)
    setAction("entrada")
    setMessage(null)

    try {
      // La foto es REQUISITO: se captura ANTES de consultar al servidor para
      // fallar rapido y no gastar el viaje si igual no se va a poder marcar.
      const foto = await capturarFoto()
      if (!foto.ok) {
        setMessage({ type: "error", text: `No se puede marcar sin foto. ${foto.motivo}` })
        return
      }

      // First, check if person exists and is active (y si ya tiene una
      // novedad registrada hoy, que bloquea la marcacion).
      const checkResponse = await fetch("/api/attendance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identificacion: identificacion.trim(), idempresa: selectedEmpresaId }),
      })

      const checkData = await checkResponse.json()

      if (!checkData.success) {
        setMessage({ type: "error", text: checkData.message })
        setLoading(false)
        setAction(null)
        setIdentificacion("")
        return
      }

      // If person is active, register attendance (con foto de ingreso capturada).
      const registerResponse = await fetch("/api/attendance/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identificacion: identificacion.trim(),
          idempresa: selectedEmpresaId,
          foto: foto.dataUrl,
        }),
      })

      const registerData = await registerResponse.json()

      if (registerData.success) {
        setMessage({ type: "success", text: checkData.message })
        setIdentificacion("")
      } else {
        // El backend ahora devuelve `message` con el motivo exacto
        // (p.ej. "Ya se registró la asistencia... a las HH:MM:SS").
        // Caemos al texto generico solo si el endpoint no envia uno.
        setMessage({
          type: "error",
          text: registerData.message || "Error al registrar la asistencia",
        })
      }
    } catch (error) {
      console.error("[v0] Error processing attendance:", error)
      setMessage({ type: "error", text: "Error al procesar la solicitud" })
    } finally {
      setLoading(false)
      setAction(null)
      // Clear message after 4 seconds. Damos un segundo extra (vs el
      // anterior 3s) porque ahora la card de feedback es mas grande y
      // queremos que el operador alcance a leerla con calma.
      setTimeout(() => setMessage(null), 4000)
    }
  }

  // Registra la SALIDA del dia actual: golpea el endpoint que actualiza
  // `registroasistencia.horasalida` para la identificacion + fecha de hoy.
  //
  // SIN ENTRADA NO HAY SALIDA. La comprobacion de verdad la hace el endpoint
  // --es la frontera real y nadie la puede saltar--, pero aqui se consulta
  // ANTES de encender la camara: si el documento no tiene entrada de hoy no
  // tiene sentido tomarle la foto para despues rechazarlo, y el operador ve el
  // motivo de una vez.
  const handleRegisterDeparture = async () => {
    if (!identificacion.trim()) {
      setMessage({ type: "error", text: "Por favor ingrese un documento de identificación" })
      return
    }

    if (!selectedEmpresaId) {
      setMessage({ type: "error", text: "No se pudo obtener la información de la empresa" })
      return
    }

    setLoading(true)
    setAction("salida")
    setMessage(null)

    try {
      const estado = await fetch("/api/attendance/departure-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identificacion: identificacion.trim(),
          idempresa: selectedEmpresaId,
        }),
      })
      const estadoData = await estado.json()
      if (!estadoData.puedeSalir) {
        setMessage({
          type: "error",
          text: estadoData.message || "Este documento no puede registrar salida.",
        })
        return
      }

      // Misma regla que en la entrada: sin foto valida no se registra salida.
      const foto = await capturarFoto()
      if (!foto.ok) {
        setMessage({ type: "error", text: `No se puede marcar sin foto. ${foto.motivo}` })
        return
      }

      const response = await fetch("/api/attendance/register-departure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identificacion: identificacion.trim(),
          idempresa: selectedEmpresaId,
          foto: foto.dataUrl,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setMessage({ type: "success", text: data.message })
        setIdentificacion("")
      } else {
        setMessage({
          type: "error",
          text: data.message || "Error al registrar la salida",
        })
      }
    } catch (error) {
      console.error("[v0] Error registering departure:", error)
      setMessage({ type: "error", text: "Error al procesar la solicitud" })
    } finally {
      setLoading(false)
      setAction(null)
      setTimeout(() => setMessage(null), 6000)
    }
  }

  // Strings derivados del tick del reloj. Cuando `now` es null (primer
  // render / SSR) usamos placeholders neutros que ocupen el mismo
  // espacio para evitar saltos de layout durante la hidratacion.
  const timeString = now ? TIME_FORMATTER.format(now) : "--:--:--"
  const dateRaw = now ? DATE_FORMATTER.format(now) : ""
  // Capitalizamos la primera letra del dia/mes en español para que
  // "lunes, 4 de mayo de 2026" se lea como "Lunes, 4 de mayo de 2026".
  const dateString = dateRaw ? dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1) : ""

  // Banderas semanticas para feedback visual del input. El operador
  // sabe que escribir un documento valido habilita los botones grandes.
  // Aceptamos minimo 1 digito por requerimiento de negocio (algunos
  // codigos internos de identificacion son muy cortos). La validacion
  // de existencia real del documento la hace el backend al consultar
  // `headcount` antes de registrar la asistencia.
  const docOk = identificacion.trim().length >= 1
  const isSuccess = message?.type === "success"
  const isError = message?.type === "error"

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-muted/30 px-4 py-6 sm:py-10">
      {/* Dos columnas en pantalla ancha: a la izquierda lo que está pasando
          hoy, a la derecha el kiosco. En una tablet de portería --pantalla
          angosta-- se apilan y el kiosco queda primero, que es lo que ahí se
          usa. */}
      <div className="mx-auto flex max-w-[1500px] flex-col-reverse items-start gap-5 xl:flex-row">
        <div className="w-full min-w-0 xl:flex-1">
          <MarcacionesDelDia />
        </div>
        <div className="w-full space-y-5 xl:max-w-2xl">
        {/* Reloj en vivo: dominante, ocupa la franja superior. La hora
            mantiene tipografia mono y tabular-nums para que los digitos
            no "salten" cada segundo. */}
        <Card className="bg-card border-border/60 overflow-hidden">
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-col items-center text-center gap-2">
              <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Hora actual — Colombia
              </span>
              <p
                className="font-mono font-bold tabular-nums text-6xl sm:text-7xl md:text-8xl leading-none text-foreground"
                aria-live="polite"
              >
                {timeString}
              </p>
              <p className="text-sm sm:text-base font-medium text-muted-foreground text-pretty">
                {dateString}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card principal de registro. Todo el flujo cabe en un solo
            bloque vertical, sin pestañas ni pasos: input gigante arriba,
            par de botones gigantes en color semantico abajo, feedback
            inline al final. */}
        <Card className="border-border/60 overflow-hidden">
          <CardContent className="p-5 sm:p-8 space-y-6">
            <div className="text-center space-y-1.5">
              <h1 className="text-2xl sm:text-2xl font-bold tracking-tight text-balance">
                Registro de Asistencia
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground text-balance">
                Ingrese su documento y elija{" "}
                <span className="font-semibold text-[var(--chart-3)]">Entrada</span> al
                llegar o{" "}
                <span className="font-semibold text-destructive">Salida</span> al irse.
              </p>
            </div>

            {/* Cámara SIEMPRE activa: al marcar ingreso/salida se toma una foto
                automática. Preview en vivo para que la persona se ubique. */}
            <div className="mb-5 flex flex-col items-center">
              <div className="relative w-44 h-44 overflow-hidden rounded-full border-4 border-primary/30 bg-black/80 shadow-inner">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                {!camaraOk && (
                  <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-[10px] font-medium text-white">
                    Cámara no disponible — no se puede marcar
                  </div>
                )}
              </div>
              <span
                className={cn(
                  "mt-2 flex items-center gap-1 text-[11px]",
                  camaraOk ? "text-muted-foreground" : "text-destructive font-medium",
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    camaraOk ? "bg-green-500 animate-pulse" : "bg-destructive",
                  )}
                />
                {camaraOk ? "Cámara activa — se tomará foto al marcar" : "Sin cámara"}
              </span>
              {/* La foto es obligatoria: si la camara no esta disponible se
                  explica QUE hacer, en vez de dejar los botones muertos sin
                  motivo aparente. */}
              {!camaraOk && camaraError && (
                <p className="mt-1 max-w-xs text-center text-[11px] text-destructive">
                  {camaraError}
                </p>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Input gigante centrado. Usamos numerico para que en
                  dispositivos tactiles se abra el teclado de numeros
                  directamente, agilizando el registro en kioskos. */}
              <div className="space-y-2">
                <label
                  htmlFor="documento"
                  className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground text-center"
                >
                  Documento de identificación
                </label>
                <Input
                  id="documento"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Ej: 1234567890"
                  value={identificacion}
                  onChange={(e) => setIdentificacion(e.target.value)}
                  disabled={loading}
                  // Tipografía grande y centrada — esto NO es un campo
                  // mas en un formulario, es el protagonista. Un kiosko
                  // de planta debe leerse desde 1.5m de distancia.
                  className={cn(
                    "h-16 sm:h-20 text-center text-2xl sm:text-3xl font-mono tabular-nums tracking-wider rounded-xl",
                    "border-2 transition-colors",
                    docOk && "border-[var(--chart-3)]/50 focus-visible:border-[var(--chart-3)]",
                  )}
                  autoFocus
                  autoComplete="off"
                />
              </div>

              {/* Dos botones gigantes lado a lado: Entrada (verde) /
                  Salida (rojo). Cada uno muestra un icono enorme + un
                  rotulo grande para que sea claro a varios metros de
                  distancia. En mobile se apilan. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {/* ENTRADA - verde */}
                <Button
                  type="submit"
                  // Sin camara no se puede marcar: la foto es obligatoria.
                  disabled={loading || !docOk || !camaraOk}
                  className={cn(
                    "group relative h-32 sm:h-36 rounded-2xl border-2 transition-all",
                    "flex flex-col items-center justify-center gap-2",
                    // Verde solido usando el chart-3 (verde institucional
                    // del design system). Usamos !important via clases
                    // semanticas y forzamos el color de texto blanco
                    // para garantizar contraste AA sobre el verde.
                    "bg-[var(--chart-3)] hover:bg-[var(--chart-3)]/90 text-white border-transparent",
                    "shadow-sm hover:shadow-md active:scale-[0.98]",
                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[var(--chart-3)]",
                  )}
                  aria-label="Registrar entrada"
                >
                  {loading && action === "entrada" ? (
                    <>
                      <Loader2 className="h-12 w-12 animate-spin" />
                      <span className="text-base font-semibold">Procesando...</span>
                    </>
                  ) : (
                    <>
                      {/* Burbuja blanca traslucida detras del icono para
                          dar profundidad sin recurrir a sombras pesadas. */}
                      <span className="h-14 w-14 rounded-full bg-white/20 flex items-center justify-center transition-transform group-hover:scale-110">
                        <LogIn className="h-8 w-8" strokeWidth={2.5} />
                      </span>
                      <span className="flex flex-col items-center leading-tight">
                        <span className="text-2xl sm:text-3xl font-bold tracking-wide">
                          ENTRADA
                        </span>
                        <span className="text-[11px] uppercase tracking-widest opacity-85">
                          Registrar llegada
                        </span>
                      </span>
                    </>
                  )}
                </Button>

                {/* SALIDA - rojo */}
                <Button
                  type="button"
                  // Sin camara no se puede marcar: la foto es obligatoria.
                  disabled={loading || !docOk || !camaraOk}
                  onClick={handleRegisterDeparture}
                  className={cn(
                    "group relative h-32 sm:h-36 rounded-2xl border-2 transition-all",
                    "flex flex-col items-center justify-center gap-2",
                    "bg-destructive hover:bg-destructive/90 text-white border-transparent",
                    "shadow-sm hover:shadow-md active:scale-[0.98]",
                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-destructive",
                  )}
                  aria-label="Registrar salida"
                >
                  {loading && action === "salida" ? (
                    <>
                      <Loader2 className="h-12 w-12 animate-spin" />
                      <span className="text-base font-semibold">Procesando...</span>
                    </>
                  ) : (
                    <>
                      <span className="h-14 w-14 rounded-full bg-white/20 flex items-center justify-center transition-transform group-hover:scale-110">
                        <LogOut className="h-8 w-8" strokeWidth={2.5} />
                      </span>
                      <span className="flex flex-col items-center leading-tight">
                        <span className="text-2xl sm:text-3xl font-bold tracking-wide">
                          SALIDA
                        </span>
                        <span className="text-[11px] uppercase tracking-widest opacity-85">
                          Registrar partida
                        </span>
                      </span>
                    </>
                  )}
                </Button>
              </div>

              {/* Hint cuando no hay documento valido todavia: orienta al
                  empleado sin verse como un error. */}
              {!docOk && !message && (
                <p className="text-center text-xs text-muted-foreground">
                  Ingrese su documento para habilitar los botones.
                </p>
              )}

              {/* Feedback visual grande, tipo "toast en linea". Verde con
                  check para exitos, rojo con X para errores. La altura
                  fija evita layout shift cuando aparece/desaparece. */}
              {message && (
                <div
                  role={isError ? "alert" : "status"}
                  aria-live={isError ? "assertive" : "polite"}
                  className={cn(
                    "rounded-xl border-2 px-4 py-4 sm:py-5",
                    "flex items-center gap-3 sm:gap-4",
                    "animate-in fade-in slide-in-from-bottom-2 duration-300",
                    isSuccess &&
                      "border-[var(--chart-3)]/40 bg-[var(--chart-3)]/10 text-[var(--chart-3)]",
                    isError &&
                      "border-destructive/40 bg-destructive/10 text-destructive",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 h-12 w-12 rounded-full flex items-center justify-center",
                      isSuccess && "bg-[var(--chart-3)] text-white",
                      isError && "bg-destructive text-white",
                    )}
                  >
                    {isSuccess ? (
                      <CheckCircle2 className="h-7 w-7" strokeWidth={2.5} />
                    ) : (
                      <XCircle className="h-7 w-7" strokeWidth={2.5} />
                    )}
                  </span>
                  <p className="text-base sm:text-lg font-semibold leading-snug text-pretty">
                    {message.text}
                  </p>
                </div>
              )}
            </form>

            {/* Leyenda permanente: refuerza el codigo de colores en
                la base del card para que un empleado nuevo entienda
                el sistema sin tener que preguntar. */}
            <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border/60">
              <div className="flex items-center gap-2.5 rounded-lg bg-[var(--chart-3)]/10 border border-[var(--chart-3)]/20 px-3 py-2">
                <span className="h-3 w-3 rounded-full bg-[var(--chart-3)] shrink-0" />
                <div className="leading-tight min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Verde
                  </p>
                  <p className="text-sm font-bold text-[var(--chart-3)]">
                    Entrada
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
                <span className="h-3 w-3 rounded-full bg-destructive shrink-0" />
                <div className="leading-tight min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Rojo
                  </p>
                  <p className="text-sm font-bold text-destructive">
                    Salida
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  )
}
