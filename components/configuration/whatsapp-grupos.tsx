"use client"

// PRUEBA DE GRUPOS DE WHATSAPP
//
// Está aparte del flujo de destinatarios que ya funciona, porque la Groups API
// de Meta viene con restricciones que pueden hacerla inservible para el caso:
// tope de 8 personas, solo grupos creados por la propia API, cada uno entra por
// invitación, y exige Official Business Account.
//
// Esta pantalla sirve para averiguar si esas condiciones se cumplen aquí, antes
// de montar nada encima.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Users,
} from "lucide-react"
import {
  crearGrupo,
  enviarPlantillaAGrupo,
  getEnlaceInvitacion,
  getGrupos,
  type GrupoWhatsapp,
} from "@/lib/whatsapp-grupos-actions"

const PLANTILLA_PRUEBA = "reporte_interno_operacion"

export default function WhatsappGrupos() {
  const { toast } = useToast()
  const [grupos, setGrupos] = useState<GrupoWhatsapp[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [nombre, setNombre] = useState("Operación LIP")
  const [creando, setCreando] = useState(false)
  const [enlaces, setEnlaces] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await getGrupos()
    if (r.success && r.data) {
      setGrupos(r.data)
      setError(null)
    } else {
      setError(r.message ?? "No se pudieron leer los grupos.")
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function crear() {
    setCreando(true)
    const r = await crearGrupo({ asunto: nombre, descripcion: "Avisos automáticos de LIPgo." })
    setCreando(false)
    if (!r.success) {
      toast({ title: "No se pudo crear", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: "Grupo creado", description: "Ahora comparte el enlace para que entren." })
    cargar()
  }

  async function verEnlace(g: GrupoWhatsapp) {
    setOcupado(g.id)
    const r = await getEnlaceInvitacion(g.id)
    setOcupado(null)
    if (!r.success || !r.enlace) {
      toast({ title: "No se pudo obtener el enlace", description: r.message, variant: "destructive" })
      return
    }
    setEnlaces((prev) => ({ ...prev, [g.id]: r.enlace! }))
  }

  async function probar(g: GrupoWhatsapp) {
    if (g.participantes === 0) {
      const seguir = window.confirm(
        "Este grupo no tiene participantes todavía.\n\n" +
          "El mensaje se va a enviar y se va a cobrar, pero no lo va a leer nadie. " +
          "¿Continuar de todas formas?",
      )
      if (!seguir) return
    }

    setOcupado(g.id)
    const r = await enviarPlantillaAGrupo({
      grupoId: g.id,
      plantilla: PLANTILLA_PRUEBA,
      body: [
        "Prueba de grupo",
        "ABC123 · Orden IND20260923001",
        "Mensaje de prueba enviado desde LIPgo · " +
          new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
      ],
      origen: "grupo:prueba",
    })
    setOcupado(null)

    if (!r.success) {
      toast({ title: "No se pudo enviar", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: "Mensaje enviado", description: "Revisa el grupo en tu WhatsApp." })
  }

  return (
    <div className="space-y-4">
      {/* El resultado de la prueba va ARRIBA del todo: sin esto, alguien
          vuelve a intentarlo dentro de unos meses y repite el camino. */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          Meta no tiene habilitada esta función para nuestro número
        </p>
        <p className="mt-1 text-[11px] text-amber-900">
          Probado el 23/09/2026: <em>“Groups APIs are only available for eligible phone
          numbers.”</em> Hace falta que la cuenta sea <strong>Official Business Account</strong>,
          una marca que Meta otorga y que no se solicita desde el panel. Los botones siguen aquí
          por si algún día cambia.
        </p>
        <p className="mt-1 text-[11px] text-amber-900">
          Mientras tanto, los avisos llegan a cada destinatario por separado —sin tope de 8, sin
          invitaciones— desde la pestaña <strong>Reporte interno</strong>.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-sm font-medium">Qué exigiría la función, si se habilitara</p>
        <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
          <li>
            · <strong>Máximo 8 participantes.</strong> Es un tope de Meta, no configurable.
          </li>
          <li>
            · <strong>Solo funciona con grupos creados aquí.</strong> Un grupo que ya exista en
            WhatsApp no se puede usar.
          </li>
          <li>
            · <strong>Cada persona entra por invitación.</strong> Se comparte un enlace y ella
            acepta; no se puede agregar a nadie.
          </li>
          <li>
            · <strong>Exige Official Business Account.</strong> Es distinto de tener la empresa
            verificada. Si no lo es, esto responde error.
          </li>
          <li>
            · Cada mensaje al grupo <strong>se cobra</strong>, igual que uno individual.
          </li>
        </ul>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Meta no permitió la consulta
          </p>
          <p className="mt-1 text-[11px] text-amber-900">{error}</p>
        </div>
      )}

      <section className="lg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" />
            Grupos
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={cargar}
            disabled={cargando}
            className="gap-1.5"
          >
            {cargando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Actualizar
          </Button>
        </div>

        <div className="space-y-3 p-4">
          {cargando ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : grupos.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No hay grupos creados todavía.
            </p>
          ) : (
            <div className="space-y-2">
              {grupos.map((g) => (
                <div key={g.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{g.asunto}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {g.participantes} de 8 participantes
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => verEnlace(g)}
                        disabled={ocupado === g.id}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Enlace
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => probar(g)}
                        disabled={ocupado === g.id}
                      >
                        {ocupado === g.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Probar
                      </Button>
                    </div>
                  </div>

                  {enlaces[g.id] && (
                    <div className="mt-2 rounded border border-border bg-muted/40 p-2">
                      <p className="text-[10px] text-muted-foreground">
                        Comparte este enlace con quienes deban entrar:
                      </p>
                      <p className="mt-0.5 break-all font-mono text-[11px]">{enlaces[g.id]}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 h-6 px-2 text-[10px]"
                        onClick={() => {
                          navigator.clipboard.writeText(enlaces[g.id])
                          toast({ title: "Enlace copiado" })
                        }}
                      >
                        Copiar
                      </Button>
                    </div>
                  )}

                  <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{g.id}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div className="min-w-[10rem] flex-1">
              <Label className="text-xs">Nombre del grupo nuevo</Label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="mt-1 h-9 text-sm"
              />
            </div>
            <Button onClick={crear} disabled={creando} className="h-9 gap-1.5">
              {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Crear grupo
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
