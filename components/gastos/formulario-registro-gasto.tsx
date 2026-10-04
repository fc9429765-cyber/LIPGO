"use client"

/* ============================================================================
 *  FormularioRegistroGasto
 *  ---------------------------------------------------------------------------
 *  Formulario para que un usuario reporte un gasto operativo desde campo.
 *  - Multi-empresa: usa el `selectedEmpresaId` del contexto global (TopBar)
 *    como fallback si no se pasa por prop.
 *  - Sube el soporte (foto/PDF) al bucket `soportes_gastos` de Supabase
 *    Storage usando una ruta determinista por empresa (`<idEmpresa>/<uuid>`).
 *  - Inserta la fila en `public.gastos` con la URL publica del soporte.
 *  - Validacion: monto > 0, fecha valida, descripcion obligatoria, soporte
 *    requerido (imagen o PDF).
 * ============================================================================
 */

import { useMemo, useRef, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { supabase } from "@/lib/supabase-client"
import { registrarGasto } from "@/lib/finanzas-lectura-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import {
  Calendar as CalendarIcon,
  DollarSign,
  Loader2,
  Paperclip,
  Receipt,
  Upload,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

/** Categorias de gasto operativo. Texto plano para no requerir tabla extra. */
const CATEGORIAS = [
  "Combustible",
  "Peajes",
  "Mantenimiento vehiculo",
  "Alimentacion",
  "Hospedaje",
  "Papeleria",
  "Servicios publicos",
  "Nomina",
  "Otros",
] as const

const MAX_FILE_MB = 10
const ACCEPT = "image/*,application/pdf"

interface Props {
  idEmpresa?: number | null
  /** Llamado tras un guardado exitoso (para refrescar el dashboard). */
  onSuccess?: () => void
}

export default function FormularioRegistroGasto({
  idEmpresa: idEmpresaProp,
  onSuccess,
}: Props) {
  const { user, profile, selectedEmpresaId } = useAuth()
  const idEmpresa = idEmpresaProp ?? selectedEmpresaId ?? null
  const { toast } = useToast()

  // Estado del formulario
  const [fecha, setFecha] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [categoria, setCategoria] = useState<string>("")
  const [monto, setMonto] = useState<string>("")
  const [descripcion, setDescripcion] = useState<string>("")
  const [archivo, setArchivo] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Preview del archivo seleccionado: data URL para imagenes, nombre para PDFs.
  const previewUrl = useMemo(() => {
    if (!archivo) return null
    if (archivo.type.startsWith("image/")) {
      return URL.createObjectURL(archivo)
    }
    return null
  }, [archivo])

  /**
   * Calcula los campos que faltan. Se usa para:
   *  - mostrar al usuario QUE le falta (en lugar de un boton "muerto").
   *  - generar un toast claro si intenta guardar sin completar todo.
   */
  const camposFaltantes = useMemo(() => {
    const faltan: string[] = []
    if (!fecha) faltan.push("fecha")
    if (!categoria) faltan.push("categoria")
    if (!(Number.parseFloat(monto) > 0)) faltan.push("monto")
    if (descripcion.trim().length < 3) faltan.push("descripcion")
    // Soporte ahora es OPCIONAL: se permite registrar gastos sin adjunto
    // (ej. anticipos en efectivo, gastos menores). Si el usuario sube uno
    // se valida tamano/tipo en handleFileChange y se sube al storage.
    if (!idEmpresa) faltan.push("empresa activa")
    return faltan
  }, [fecha, categoria, monto, descripcion, idEmpresa])

  const isValid = camposFaltantes.length === 0

  /** Limpia el formulario tras un guardado exitoso. */
  const reset = () => {
    setFecha(new Date().toISOString().slice(0, 10))
    setCategoria("")
    setMonto("")
    setDescripcion("")
    setArchivo(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) {
      setArchivo(null)
      return
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Archivo demasiado grande",
        description: `El soporte no puede superar ${MAX_FILE_MB} MB.`,
      })
      e.target.value = ""
      setArchivo(null)
      return
    }
    setArchivo(f)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log("[v0] gasto submit click", {
      fecha,
      categoria,
      monto,
      descripcionLen: descripcion.trim().length,
      archivo: archivo?.name,
      idEmpresa,
      camposFaltantes,
    })

    if (submitting) return

    // Si la validacion no pasa, le decimos AL USUARIO exactamente que
    // falta. Antes el boton quedaba disabled y daba la sensacion de "no
    // pasa nada" al hacer click.
    if (!isValid) {
      toast({
        variant: "destructive",
        title: "Faltan datos para guardar el gasto",
        description: `Completa: ${camposFaltantes.join(", ")}.`,
      })
      return
    }

    setSubmitting(true)
    try {
      // 1) Subimos el soporte SOLO si el usuario adjunto un archivo.
      //    El soporte ahora es opcional: si no hay archivo, `urlSoporte`
      //    queda en null y el insert lo persiste asi.
      //    Ruta: <idEmpresa>/<timestamp>-<nombre-sanitizado>
      //    Esto evita colisiones, mantiene los archivos agrupados por
      //    empresa y respeta cualquier policy de Storage que filtre por
      //    la primera parte del path.
      let urlSoporte: string | null = null
      if (archivo) {
        const safeName = archivo.name
          .replace(/\s+/g, "_")
          .replace(/[^a-zA-Z0-9._-]/g, "")
        const path = `${idEmpresa}/${Date.now()}-${safeName}`

        const { error: uploadError } = await supabase.storage
          .from("soportes_gastos")
          .upload(path, archivo, {
            upsert: false,
            contentType: archivo.type || undefined,
          })

        if (uploadError) {
          throw new Error(`Error al subir el soporte: ${uploadError.message}`)
        }

        const { data: urlData } = supabase.storage
          .from("soportes_gastos")
          .getPublicUrl(path)

        urlSoporte = urlData?.publicUrl ?? null
      }

      // 2) Insertamos la fila en `gastos` siguiendo el esquema real:
      //    - id_empresa (smallint)
      //    - fecha (date), categoria (text), monto (numeric)
      //    - descripcion (text)
      //    - url_soporte (text)              <- antes lo llamabamos soporte_url
      //    - registrado_por (uuid -> auth.users.id) para trazabilidad
      //    - creado_por (text) con el username legible (o email como fallback)
      //    NO existe `soporte_path` en la tabla, asi que ya no se envia.
      // SEGURIDAD (2026-10-03): el insert lo hace el servidor con la sesión del usuario
      // (registrado_por y creado_por salen de la sesión, no del navegador).
      const r = await registrarGasto({
        idEmpresa: idEmpresa as number,
        fecha,
        categoria,
        monto: Number.parseFloat(monto),
        descripcion: descripcion.trim(),
        urlSoporte,
      })
      if (!r.success) {
        throw new Error(r.message)
      }

      toast({
        title: "Gasto registrado",
        description: `Se guardo el gasto del ${fecha} por $${Number.parseFloat(
          monto,
        ).toLocaleString("es-CO")}.`,
      })

      reset()
      onSuccess?.()
    } catch (err: any) {
      console.error("[v0] gasto submit error:", err)
      toast({
        variant: "destructive",
        title: "No se pudo guardar el gasto",
        description: err?.message ?? "Intenta nuevamente.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Registrar gasto</CardTitle>
              <CardDescription>
                Reporta un gasto operativo desde campo. Adjunta la foto del
                recibo o un PDF.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Fila 1: fecha + categoria */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fecha">Fecha del gasto</Label>
              <DatePickerField
                id="fecha"
                value={fecha}
                maxDate={new Date().toISOString().slice(0, 10)}
                onChange={setFecha}
                icon={<CalendarIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="categoria">Categoria</Label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger id="categoria">
                  <SelectValue placeholder="Selecciona una categoria" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Monto */}
          <div className="space-y-2">
            <Label htmlFor="monto">Monto (COP)</Label>
            <div className="relative">
              <DollarSign
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="monto"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="pl-9"
                required
              />
            </div>
          </div>

          {/* Descripcion */}
          <div className="space-y-2">
            <Label htmlFor="descripcion">Descripcion</Label>
            <Textarea
              id="descripcion"
              placeholder="Detalle del gasto (proveedor, motivo, ruta, etc.)"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={3}
              required
            />
          </div>

          {/* Soporte (opcional) */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="soporte">Soporte (foto o PDF)</Label>
              <span className="text-xs text-muted-foreground">Opcional</span>
            </div>
            <input
              ref={fileInputRef}
              id="soporte"
              type="file"
              accept={ACCEPT}
              onChange={handleFileChange}
              className="hidden"
            />

            {!archivo ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/50",
                )}
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                <div className="text-sm font-medium">
                  Toca para tomar foto o subir archivo
                </div>
                <div className="text-xs text-muted-foreground">
                  JPG, PNG o PDF. Maximo {MAX_FILE_MB} MB.
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl || "/placeholder.svg"}
                    alt="Vista previa del soporte"
                    className="h-16 w-16 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Paperclip className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {archivo.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(archivo.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setArchivo(null)
                    if (fileInputRef.current) fileInputRef.current.value = ""
                  }}
                  aria-label="Quitar soporte"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {!idEmpresa && (
            <p className="text-xs text-amber-700">
              Selecciona una empresa en la barra superior antes de guardar.
            </p>
          )}

          {/*
            Hint en vivo de campos faltantes. Solo aparece cuando algo falta
            para que el usuario sepa por que no se ha registrado el gasto.
          */}
          {camposFaltantes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Faltan por completar:{" "}
              <span className="font-medium text-foreground">
                {camposFaltantes.join(", ")}
              </span>
              .
            </p>
          )}
        </CardContent>

        <CardFooter className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            disabled={submitting}
          >
            Limpiar
          </Button>
          {/*
            El boton ya NO se deshabilita por validacion. Asi, si el usuario
            le da click cuando algo falta, recibe un toast con el motivo
            exacto en lugar de un boton "muerto" que parece bug.
          */}
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              "Guardar gasto"
            )}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
