"use client"

// Compuerta de identificacion del equipo por QR.
//
// Antes, desde el modulo de escritorio se podia registrar una actividad
// eligiendo el montacarga de una lista, sin estar cerca de la maquina. Ahora
// hay que identificarlo leyendo su QR (o digitando el codigo de la etiqueta),
// que es lo que garantiza que quien registra esta frente al equipo.
//
// El flujo del celular (/equipo/[codigo]) ya nacia del QR, asi que no cambia:
// esta compuerta es para las entradas del modulo de escritorio.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { QRCameraScanner } from "@/components/qr-camera-scanner"
import { AlertTriangle, Loader2, QrCode, Search } from "lucide-react"
import { getMontacargaPorQR, type Montacarga } from "@/lib/montacargas-actions"

/**
 * El QR pegado en el equipo codifica la URL `/equipo/{codigo}`, NO el codigo
 * pelado (ver components/montacargas/qr-etiquetas.tsx), porque asi la camara
 * nativa del celular lo abre sin app intermedia. El escaner devuelve esa URL
 * completa, de modo que hay que quedarse con el ultimo segmento.
 *
 * Tambien se acepta que alguien digite el codigo directamente desde la
 * etiqueta, que es el respaldo cuando el QR esta rayado o sucio.
 */
export function extraerCodigoQR(valor: string): string {
  const texto = String(valor || "").trim()
  if (!texto) return ""
  const m = texto.match(/\/equipo\/([^/?#\s]+)/i)
  return m ? decodeURIComponent(m[1]) : texto
}

export function SelectorEquipoQR({
  equipoEsperado,
  onConfirmado,
  onCancelar,
}: {
  /**
   * Equipo desde el que se abrio la accion. Si viene, el QR leido TIENE que
   * corresponder a el: evita que alguien abra la accion sobre un montacarga y
   * termine registrandole la actividad a otro.
   */
  equipoEsperado?: { id: number; identificacion: string }
  onConfirmado: (equipo: Montacarga) => void
  onCancelar?: () => void
}) {
  const [codigo, setCodigo] = useState("")
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [camaraAbierta, setCamaraAbierta] = useState(false)

  const resolver = async (valorCrudo: string) => {
    const c = extraerCodigoQR(valorCrudo)
    if (!c) {
      setError("Escanea el QR del equipo o digita el código de la etiqueta.")
      return
    }

    setBuscando(true)
    setError(null)
    const r = await getMontacargaPorQR(c)
    setBuscando(false)

    if (!r.success || !r.data) {
      setError(r.error || "No se encontró un equipo con ese código.")
      return
    }

    if (equipoEsperado && r.data.id !== equipoEsperado.id) {
      setError(
        `Ese QR es del equipo ${r.data.identificacion}, no de ${equipoEsperado.identificacion}. ` +
          "Verifica que estás en la máquina correcta.",
      )
      return
    }

    onConfirmado(r.data)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Identifica el equipo</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {equipoEsperado
            ? `Escanea el QR de ${equipoEsperado.identificacion} para confirmar que estás frente a la máquina.`
            : "Escanea el QR pegado en el montacarga para seleccionarlo."}
        </p>
      </div>

      <Button
        type="button"
        className="h-12 w-full text-base"
        onClick={() => {
          setError(null)
          setCamaraAbierta(true)
        }}
        disabled={buscando}
      >
        <QrCode className="mr-2 h-5 w-5" /> Escanear QR
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="lg-eyebrow">o</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Respaldo manual: la etiqueta lleva el codigo impreso, asi que si el QR
          esta rayado o la camara no funciona la operacion no se detiene. */}
      <div className="space-y-1.5">
        <Label htmlFor="codigo-equipo">Código de la etiqueta</Label>
        <div className="flex gap-2">
          <Input
            id="codigo-equipo"
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") resolver(codigo)
            }}
            placeholder="Digítalo tal como aparece en la etiqueta"
            className="h-11"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            onClick={() => resolver(codigo)}
            disabled={buscando || !codigo.trim()}
          >
            {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {onCancelar && (
        <Button variant="outline" className="h-11 w-full" onClick={onCancelar} disabled={buscando}>
          Cancelar
        </Button>
      )}

      <QRCameraScanner
        isOpen={camaraAbierta}
        onClose={() => setCamaraAbierta(false)}
        onScan={(valor) => {
          setCamaraAbierta(false)
          setCodigo(extraerCodigoQR(valor))
          resolver(valor)
        }}
      />
    </div>
  )
}

export default SelectorEquipoQR
