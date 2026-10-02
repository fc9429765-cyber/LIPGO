"use client"

// CONFIGURACIÓN DE WHATSAPP
//
// Tres cosas: estado de la conexión, envío de prueba y bitácora.
//
// El token NO se edita desde aquí y NO se muestra: vive en variables de entorno
// del servidor. Lo único que se ve son sus últimos 4 caracteres, para saber cuál
// está activo sin exponerlo.

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react"
import {
  enviarPlantilla,
  getEstadoWhatsapp,
  getMensajes,
  getPlantillas,
  getPlantillasDeMeta,
} from "@/lib/whatsapp-actions"
import type {
  EstadoConfigWhatsapp,
  MensajeWhatsapp,
  PlantillaWhatsapp,
} from "@/lib/whatsapp-tipos"

const ICONO_ESTADO: Record<string, { icono: typeof Clock; color: string; texto: string }> = {
  enviado: { icono: Clock, color: "#64748b", texto: "Enviado" },
  entregado: { icono: CheckCircle2, color: "#0284c7", texto: "Entregado" },
  leido: { icono: Eye, color: "#059669", texto: "Leído" },
  fallido: { icono: XCircle, color: "#dc2626", texto: "Falló" },
  error: { icono: AlertTriangle, color: "#ea580c", texto: "Error" },
}

export default function WhatsappConfig() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const [estado, setEstado] = useState<EstadoConfigWhatsapp | null>(null)
  const [plantillas, setPlantillas] = useState<PlantillaWhatsapp[]>([])
  const [enMeta, setEnMeta] = useState<
    {
      nombre: string
      idioma: string
      estado: string
      /** MARKETING | UTILITY | AUTHENTICATION. Decide si hay tope por persona. */
      categoria: string
      conNombre: boolean
      varsHeader: string[]
      varsBody: string[]
    }[]
  >([])
  const [mensajes, setMensajes] = useState<MensajeWhatsapp[]>([])
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)

  // Prueba
  const [telefono, setTelefono] = useState("")
  const [plantillaSel, setPlantillaSel] = useState("")
  // Idioma con el que se ENVIA. Arranca del registrado en LIPgo, pero se puede
  // corregir: Meta trata "es" y "es_CO" como idiomas DISTINTOS y rechaza el
  // envio con un error que dice "template name does not exist in es", como si
  // faltara la plantilla.
  const [idiomaEnvio, setIdiomaEnvio] = useState("")
  const [valores, setValores] = useState<Record<string, string>>({})

  const cargar = useCallback(async () => {
    setCargando(true)
    const [e, p, m] = await Promise.all([
      getEstadoWhatsapp(),
      getPlantillas(),
      getMensajes(selectedEmpresaId ?? null, 30),
    ])
    setEstado(e)
    if (p.success && p.data) {
      setPlantillas(p.data)
      if (!plantillaSel && p.data.length) setPlantillaSel(p.data[0].nombre)
    }
    setFaltaMigracion(!!p.faltaMigracion || !!m.faltaMigracion)
    if (m.success && m.data) setMensajes(m.data)
    setCargando(false)

    // Las plantillas de Meta van aparte: si el token falla, no debe bloquear
    // el resto de la pantalla.
    if (e.configurado) {
      const meta = await getPlantillasDeMeta()
      if (meta.success && meta.data) {
        setEnMeta(meta.data)
        // Si el idioma todavia no se ha tocado, se toma el de Meta.
        setIdiomaEnvio((actual) => {
          if (actual) return actual
          const nombre = plantillaSel || (p.success && p.data?.[0]?.nombre) || ""
          return meta.data!.find((t) => t.nombre === nombre)?.idioma ?? "es"
        })
      }
    }
  }, [selectedEmpresaId, plantillaSel])

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const plantilla = plantillas.find((p) => p.nombre === plantillaSel)
  // Todas las versiones de esa plantilla en Meta: la MISMA plantilla puede
  // existir en varios idiomas, y solo sirve la del idioma que se envia.
  const versionesEnMeta = enMeta.filter((t) => t.nombre === plantillaSel)
  const estadoEnMeta =
    versionesEnMeta.find((t) => t.idioma === idiomaEnvio) ?? versionesEnMeta[0] ?? null
  // El envio pide un idioma que Meta no tiene para esa plantilla.
  const idiomaNoCoincide =
    versionesEnMeta.length > 0 && !versionesEnMeta.some((t) => t.idioma === idiomaEnvio)

  // Variables efectivas: las de Meta si se pudieron leer, las registradas en
  // LIPgo si no. Las de Meta mandan porque son las que la API va a exigir.
  const varsHeader = estadoEnMeta?.varsHeader?.length
    ? estadoEnMeta.varsHeader
    : (plantilla?.variables.header ?? [])
  const varsBody = estadoEnMeta?.varsBody?.length
    ? estadoEnMeta.varsBody
    : (plantilla?.variables.body ?? [])
  // Si la plantilla usa {{nombre}}, cada parametro debe viajar con su nombre.
  const conNombre = estadoEnMeta?.conNombre === true

  async function probar() {
    if (!telefono.trim() || !plantilla) return
    setEnviando(true)
    const header = varsHeader.map((v) => valores[`h_${v}`] ?? "")
    const body = varsBody.map((v) => valores[`b_${v}`] ?? "")
    const r = await enviarPlantilla({
      empresaId: selectedEmpresaId ?? null,
      telefono: telefono.trim(),
      plantilla: plantilla.nombre,
      idioma: idiomaEnvio || plantilla.idioma,
      header,
      body,
      // Solo cuando la plantilla las usa: mandar `parameter_name` a una
      // plantilla posicional tambien falla.
      nombresHeader: conNombre ? varsHeader : undefined,
      nombresBody: conNombre ? varsBody : undefined,
      origen: "prueba",
    })
    setEnviando(false)
    if (!r.success) {
      toast({
        title: "No se pudo enviar",
        description: r.codigo ? `[${r.codigo}] ${r.message}` : r.message,
        variant: "destructive",
      })
    } else {
      toast({
        title: "Mensaje aceptado por WhatsApp",
        description: "Aceptado no es lo mismo que entregado: mira la bitácora en unos segundos.",
      })
    }
    cargar()
  }

  // La URL se arma con el origen ACTUAL. Si se abre LIPgo en localhost, sale una
  // URL que Meta no puede alcanzar: su servidor tiene que poder llamarla desde
  // internet. Se detecta para avisarlo en vez de dejar copiar algo inservible.
  const origen = typeof window !== "undefined" ? window.location.origin : ""
  const urlWebhook = origen ? `${origen}/api/whatsapp/webhook` : ""
  const esLocal = /localhost|127\.0\.0\.1|^http:\/\//.test(origen)

  if (cargando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="lg-eyebrow">Integraciones</p>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <MessageCircle className="h-5 w-5" />
            WhatsApp
          </h1>
        </div>
        <Button variant="outline" size="sm" onClick={cargar} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar
        </Button>
      </div>

      {faltaMigracion && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Falta correr <code className="font-mono text-xs">scripts/180_add_whatsapp.sql</code>
          </p>
          <p className="mt-1 text-xs">Sin él no se guarda la bitácora de los envíos.</p>
        </div>
      )}

      {/* ESTADO DE LA CONEXIÓN */}
      <section className="lg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Estado de la conexión</h2>
        </div>
        <div className="p-4">
          {!estado?.configurado ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Faltan variables de entorno</p>
              <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                {estado?.faltantes.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                Van en <code>.env.local</code> y en las variables del proyecto en Vercel. El token
                nunca se guarda en la base ni en el código.
              </p>
            </div>
          ) : estado.mensajeError ? (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              <p className="flex items-center gap-2 font-medium">
                <XCircle className="h-4 w-4" />
                Meta rechazó la conexión
              </p>
              <p className="mt-1 text-xs">{estado.mensajeError}</p>
              <p className="mt-2 text-xs">
                Lo más común: el token caducó. Los que empiezan por <code>EAA</code> y se generan
                en el panel de la app duran 24 horas; para producción hace falta uno de Usuario del
                sistema, sin caducidad.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="lg-eyebrow">Número</p>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {estado.numeroVerificado}
                </p>
              </div>
              <div>
                <p className="lg-eyebrow">
                  Nombre verificado
                </p>
                <p className="text-sm font-medium">{estado.nombreVerificado ?? "—"}</p>
              </div>
              <div>
                <p className="lg-eyebrow">Token</p>
                <p className="font-mono text-sm">····{estado.tokenFinal}</p>
              </div>
              <div>
                <p className="lg-eyebrow">API</p>
                <p className="font-mono text-sm">{estado.apiVersion}</p>
              </div>
            </div>
          )}

          {/* La URL que hay que pegar en el panel de Meta. */}
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[11px] font-medium">Webhook</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Pega esto en Meta → WhatsApp → Configuración → Webhook, y suscríbete al campo{" "}
              <code>messages</code>.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-background px-2 py-1 font-mono text-[11px]">
                {urlWebhook}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(urlWebhook)
                  toast({ title: "URL copiada" })
                }}
              >
                <Copy className="h-3 w-3" />
                Copiar
              </Button>
            </div>
            {esLocal && (
              <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                <p className="font-medium">Esta URL no le sirve a Meta</p>
                <p className="mt-0.5">
                  Estás viendo LIPgo en <code>{origen}</code>. El servidor de Meta tiene que poder
                  llamar la URL desde internet, y no alcanza tu máquina ni direcciones sin HTTPS.
                  Abre LIPgo con el dominio de producción y copia la URL desde ahí.
                </p>
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              El token de verificación es el valor de <code>WHATSAPP_VERIFY_TOKEN</code>. Solo llegan
              acuses reales con la app en modo <strong>Activo</strong>; en Desarrollo, Meta únicamente
              envía eventos de prueba.
            </p>
            {/* Probar el endpoint sin salir de la pantalla: si esto devuelve el
                challenge, el problema esta en lo que se pego en Meta. */}
            {!esLocal && urlWebhook && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Para comprobar que responde,{" "}
                <a
                  className="text-teal-700 underline"
                  href={`${urlWebhook}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
                    "" /* el token real no se expone: se escribe a mano */,
                  )}&hub.challenge=prueba123`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault()
                    const t = window.prompt("Escribe el valor de WHATSAPP_VERIFY_TOKEN para probar:")
                    if (!t) return
                    window.open(
                      `${urlWebhook}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(t)}&hub.challenge=prueba123`,
                      "_blank",
                    )
                  }}
                >
                  ábrela con el token
                </a>
                : debe mostrar <code>prueba123</code>.
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* PRUEBA */}
        <section className="h-fit lg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Enviar una prueba</h2>
          </div>
          <div className="space-y-3 p-4">
            <div>
              <Label className="text-xs">Plantilla</Label>
              <select
                value={plantillaSel}
                onChange={(e) => {
                  const nombre = e.target.value
                  setPlantillaSel(nombre)
                  setValores({})
                  // El idioma bueno es el de META, no el registrado en LIPgo:
                  // es el que decide si el envio funciona.
                  const enM = enMeta.find((t) => t.nombre === nombre)
                  const local = plantillas.find((p) => p.nombre === nombre)
                  setIdiomaEnvio(enM?.idioma ?? local?.idioma ?? "es")
                }}
                className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm"
              >
                {plantillas.length === 0 && <option value="">Sin plantillas registradas</option>}
                {plantillas.map((p) => (
                  <option key={p.nombre} value={p.nombre}>
                    {p.nombre} ({p.idioma})
                  </option>
                ))}
              </select>

              {/* El estado en Meta: registrada en LIPgo no es lo mismo que
                  aprobada por Meta. */}
              {estadoEnMeta ? (
                <p
                  className="mt-1 text-[11px]"
                  style={{ color: estadoEnMeta.estado === "APPROVED" ? "#059669" : "#ea580c" }}
                >
                  En Meta: {estadoEnMeta.estado === "APPROVED" ? "aprobada" : estadoEnMeta.estado} ·
                  idioma <strong>{estadoEnMeta.idioma}</strong> ·
                  categoría <strong>{estadoEnMeta.categoria}</strong> ·
                  variables {estadoEnMeta.conNombre ? "con nombre" : "posicionales"}
                  {estadoEnMeta.estado !== "APPROVED" && " — todavía no se puede enviar"}
                </p>
              ) : estado?.configurado && plantillaSel ? (
                <p className="mt-1 text-[11px] text-amber-700">
                  No aparece en Meta con ese nombre. Revisa que coincida exactamente.
                </p>
              ) : null}

              {/* La categoría decide si hay tope de envíos, y no se nota hasta
                  que un mensaje falla con 131049 -- que Meta explica como
                  "healthy ecosystem engagement", sin mencionar ni el límite ni
                  la categoría. Vale más decirlo antes. */}
              {estadoEnMeta?.categoria === "MARKETING" && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2">
                  <p className="text-[11px] text-amber-900">
                    <strong>Esta plantilla es de categoría MARKETING.</strong> Meta limita esos
                    mensajes a unos pocos por persona cada 24 horas —sumando todos los negocios, no
                    solo LIP— y los que pasan del tope fallan con el error{" "}
                    <code className="font-mono">131049</code>.
                  </p>
                  <p className="mt-1 text-[11px] text-amber-900">
                    Los avisos operativos (“su vehículo fue asignado al muelle 3”) son{" "}
                    <strong>UTILITY</strong>: no tienen ese límite y cuestan menos. La categoría se
                    cambia en WhatsApp Manager y Meta la revisa de nuevo.
                  </p>
                </div>
              )}

              {/* El fallo mas comun y el que peor se explica: Meta trata "es" y
                  "es_CO" como idiomas distintos, y su error dice "template name
                  does not exist in es" -- como si faltara la plantilla. */}
              {idiomaNoCoincide && (
                <div className="mt-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                  <p className="font-medium">El idioma no coincide</p>
                  <p className="mt-0.5">
                    Vas a enviar en <strong>{idiomaEnvio}</strong> y en Meta esta plantilla existe
                    en{" "}
                    <strong>{versionesEnMeta.map((t) => t.idioma).join(", ")}</strong>. Meta los
                    trata como idiomas distintos y rechaza el envío diciendo que la plantilla no
                    existe.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1.5 h-6 text-[11px]"
                    onClick={() => setIdiomaEnvio(versionesEnMeta[0].idioma)}
                  >
                    Usar {versionesEnMeta[0].idioma}
                  </Button>
                </div>
              )}

              <div className="mt-2">
                <Label className="text-xs">Idioma del envío</Label>
                <Input
                  value={idiomaEnvio}
                  onChange={(e) => setIdiomaEnvio(e.target.value)}
                  placeholder="es_CO"
                  className="mt-1 h-8 font-mono text-sm"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Debe coincidir exactamente con el de la plantilla aprobada en Meta.
                </p>
              </div>
            </div>

            {plantilla && (
              <>
                {/* Las variables salen de la ESTRUCTURA REAL de Meta cuando se
                    puede leer: es la que decide si el envio funciona. El
                    registro local solo sirve de respaldo. */}
                {varsHeader.map((v, i) => (
                  <div key={`h${i}`}>
                    <Label className="text-xs">
                      Encabezado · {v}{" "}
                      <span className="text-muted-foreground">
                        {conNombre ? `{{${v}}}` : `{{${i + 1}}}`}
                      </span>
                    </Label>
                    <Input
                      value={valores[`h_${v}`] ?? ""}
                      onChange={(e) => setValores({ ...valores, [`h_${v}`]: e.target.value })}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                ))}
                {varsBody.map((v, i) => (
                  <div key={`b${i}`}>
                    <Label className="text-xs">
                      Cuerpo · {v}{" "}
                      <span className="text-muted-foreground">
                        {conNombre ? `{{${v}}}` : `{{${i + 1}}}`}
                      </span>
                    </Label>
                    <Input
                      value={valores[`b_${v}`] ?? ""}
                      onChange={(e) => setValores({ ...valores, [`b_${v}`]: e.target.value })}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                ))}
              </>
            )}

            <div>
              <Label className="text-xs">Número de destino</Label>
              <Input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="3044421862"
                className="mt-1 h-9 text-sm"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                10 dígitos: el indicativo 57 se agrega solo.
              </p>
            </div>

            <Button
              className="w-full gap-1.5"
              disabled={!telefono.trim() || !plantilla || enviando || !estado?.configurado}
              onClick={probar}
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar prueba
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Cada mensaje de plantilla tiene costo.
            </p>
          </div>
        </section>

        {/* BITÁCORA */}
        <section className="lg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Últimos envíos</h2>
          </div>
          {mensajes.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              Todavía no se ha enviado ningún mensaje.
            </p>
          ) : (
            <ul className="max-h-[460px] divide-y divide-border overflow-y-auto">
              {mensajes.map((m) => {
                const meta = ICONO_ESTADO[m.estado] ?? ICONO_ESTADO.enviado
                const Icono = meta.icono
                return (
                  <li key={m.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm">{m.telefono}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {m.plantilla}
                          {m.origen ? ` · ${m.origen}` : ""}
                          {m.enviadoPor ? ` · ${m.enviadoPor}` : ""}
                        </p>
                      </div>
                      <span
                        className="flex shrink-0 items-center gap-1 text-[11px]"
                        style={{ color: meta.color }}
                      >
                        <Icono className="h-3.5 w-3.5" />
                        {meta.texto}
                      </span>
                    </div>
                    {m.errorDetalle && (
                      <p className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-800">
                        {m.errorCodigo ? `[${m.errorCodigo}] ` : ""}
                        {m.errorDetalle}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(m.creadoEn).toLocaleString("es-CO")}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="border-t border-border px-4 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              <strong>Enviado</strong> significa que WhatsApp aceptó el mensaje, no que haya
              llegado. <strong>Entregado</strong> y <strong>leído</strong> los confirma el webhook.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
