"use client"

import { useEffect, useRef, useState } from "react"
import { useForm, Controller, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import {
  ArrowLeft,
  AlertTriangle,
  Star,
  CheckCircle2,
  Eraser,
  ShieldCheck,
  TrendingUp,
  Award,
  ClipboardCheck,
  Smile,
  Scale,
  FileText,
} from "lucide-react"
import {
  createEvaluacionDesempeno,
  getColaboradorBasico,
  type EvaluacionPayload,
} from "@/lib/evaluaciones-desempeno-actions"
import { generarPdfEvaluacion } from "@/lib/pdf-evaluacion"

/**
 * Esquema Zod mapeado 1:1 a la tabla evaluaciones_desempeno.
 * P1..P12 son numeros 1-5 (estrellas). P13..P16 son strings (radio).
 */
const evaluacionSchema = z.object({
  // Metadatos
  colaborador_id: z.number().int().positive(),
  idempresa: z.number().int().positive(),

  // Seccion 1 - Seguridad
  p1_seguridad_normas: z.number().int().min(1, "Requerido").max(5),
  p2_seguridad_conducta: z.number().int().min(1, "Requerido").max(5),

  // Seccion 2 - Productividad
  p3_productividad_metas: z.number().int().min(1, "Requerido").max(5),
  p4_productividad_ritmo: z.number().int().min(1, "Requerido").max(5),

  // Seccion 3 - Calidad
  p5_calidad_mercancia: z.number().int().min(1, "Requerido").max(5),
  p6_calidad_precision: z.number().int().min(1, "Requerido").max(5),

  // Seccion 4 - Disciplina
  p7_disciplina_puntualidad: z.number().int().min(1, "Requerido").max(5),
  p8_disciplina_asistencia: z.number().int().min(1, "Requerido").max(5),
  p9_disciplina_instrucciones: z.number().int().min(1, "Requerido").max(5),

  // Seccion 5 - Actitud
  p10_actitud_equipo: z.number().int().min(1, "Requerido").max(5),
  p11_actitud_disposicion: z.number().int().min(1, "Requerido").max(5),
  p12_actitud_proactividad: z.number().int().min(1, "Requerido").max(5),

  // Seccion 6 - Decisiones
  p13_continuidad: z.enum(["Si", "No", "Con condiciones"], {
    message: "Selecciona una opcion",
  }),
  p14_nivel_riesgo: z.enum(["Bajo", "Medio", "Alto"], {
    message: "Selecciona una opcion",
  }),
  p15_decision_sugerida: z.enum(
    ["Continuar", "Capacitar / Plan de mejora", "No continuar"],
    { message: "Selecciona una opcion" },
  ),
  p16_recontrataria: z.enum(["Si", "No"], { message: "Selecciona una opcion" }),

  // Seccion 7 - Cierre
  comentarios_adicionales: z.string().max(2000, "Maximo 2000 caracteres").optional().default(""),
  firma_coordinador: z.string().min(1, "La firma del coordinador es requerida"),
})

type EvaluacionFormValues = z.infer<typeof evaluacionSchema>

/**
 * Labels amigables para el resumen de errores mostrado al usuario.
 * Las claves deben coincidir con los nombres de campo del schema Zod.
 */
const FIELD_LABELS: Record<string, string> = {
  p1_seguridad_normas: "Seguridad: Cumplimiento de normas",
  p2_seguridad_conducta: "Seguridad: Conducta segura",
  p3_productividad_metas: "Productividad: Cumplimiento de metas",
  p4_productividad_ritmo: "Productividad: Ritmo de trabajo",
  p5_calidad_mercancia: "Calidad: Cuidado de mercancia",
  p6_calidad_precision: "Calidad: Precision en ejecucion",
  p7_disciplina_puntualidad: "Disciplina: Puntualidad",
  p8_disciplina_asistencia: "Disciplina: Asistencia",
  p9_disciplina_instrucciones: "Disciplina: Seguimiento de instrucciones",
  p10_actitud_equipo: "Actitud: Trabajo en equipo",
  p11_actitud_disposicion: "Actitud: Disposicion",
  p12_actitud_proactividad: "Actitud: Proactividad",
  p13_continuidad: "Decisiones: Recomienda continuidad",
  p14_nivel_riesgo: "Decisiones: Nivel de riesgo",
  p15_decision_sugerida: "Decisiones: Decision sugerida",
  p16_recontrataria: "Decisiones: Lo recontrataria",
  comentarios_adicionales: "Cierre: Comentarios",
  firma_coordinador: "Cierre: Firma del coordinador",
}

interface FormularioEvaluacionProps {
  colaboradorId: number
  onBack: () => void
}

export function FormularioEvaluacion({ colaboradorId, onBack }: FormularioEvaluacionProps) {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const [colaboradorNombre, setColaboradorNombre] = useState<string>("")
  const [colaboradorCargo, setColaboradorCargo] = useState<string>("")
  const [submitted, setSubmitted] = useState<null | {
    puntaje_total: number
    porcentaje_riesgo: number
  }>(null)

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    reset,
  } = useForm<EvaluacionFormValues>({
    resolver: zodResolver(evaluacionSchema),
    defaultValues: {
      colaborador_id: colaboradorId,
      idempresa: selectedEmpresaId ?? 0,
      p1_seguridad_normas: 0 as unknown as number,
      p2_seguridad_conducta: 0 as unknown as number,
      p3_productividad_metas: 0 as unknown as number,
      p4_productividad_ritmo: 0 as unknown as number,
      p5_calidad_mercancia: 0 as unknown as number,
      p6_calidad_precision: 0 as unknown as number,
      p7_disciplina_puntualidad: 0 as unknown as number,
      p8_disciplina_asistencia: 0 as unknown as number,
      p9_disciplina_instrucciones: 0 as unknown as number,
      p10_actitud_equipo: 0 as unknown as number,
      p11_actitud_disposicion: 0 as unknown as number,
      p12_actitud_proactividad: 0 as unknown as number,
      comentarios_adicionales: "",
      firma_coordinador: "",
    },
  })

  // Cargar datos del colaborador para la cabecera
  useEffect(() => {
    ;(async () => {
      const r = await getColaboradorBasico(colaboradorId)
      if (r.success && r.data) {
        setColaboradorNombre(r.data.nombre || "Colaborador")
        setColaboradorCargo(r.data.cargo || "")
        // Asegurar idempresa desde el colaborador si el selectedEmpresaId no coincide
        if (r.data.idempresa) {
          setValue("idempresa", r.data.idempresa)
        }
      }
    })()
  }, [colaboradorId, setValue])

  // Alerta critica reactiva - P1 o P2 <= 2
  const [p1, p2] = useWatch({ control, name: ["p1_seguridad_normas", "p2_seguridad_conducta"] })
  const alertaCritica = (p1 && p1 > 0 && p1 <= 2) || (p2 && p2 > 0 && p2 <= 2)

  const onSubmit = async (values: EvaluacionFormValues) => {
    console.log("[v0] onSubmit llamado - values:", values)
    const payload: EvaluacionPayload = {
      ...values,
      comentarios_adicionales: values.comentarios_adicionales || "",
    }

    const result = await createEvaluacionDesempeno(payload)
    console.log("[v0] createEvaluacionDesempeno result:", result)
    if (!result.success) {
      toast({
        title: "Error al guardar",
        description: result.error || "No se pudo registrar la evaluacion",
        variant: "destructive",
      })
      return
    }

    // Calcular resumen localmente para mostrar pantalla final
    const puntajes = [
      values.p1_seguridad_normas,
      values.p2_seguridad_conducta,
      values.p3_productividad_metas,
      values.p4_productividad_ritmo,
      values.p5_calidad_mercancia,
      values.p6_calidad_precision,
      values.p7_disciplina_puntualidad,
      values.p8_disciplina_asistencia,
      values.p9_disciplina_instrucciones,
      values.p10_actitud_equipo,
      values.p11_actitud_disposicion,
      values.p12_actitud_proactividad,
    ]
    const puntaje_total = puntajes.reduce((a, b) => a + b, 0)
    const porcentaje_riesgo = Math.round(((60 - puntaje_total) / 60) * 100)

    // Generar PDF automaticamente tras guardar, usando el util compartido.
    // La seccion de Decisiones (P13-P16) queda excluida del PDF por regla de negocio.
    try {
      await generarPdfEvaluacion({
        colaboradorNombre,
        colaboradorCargo,
        fecha: new Date(),
        p1_seguridad_normas: values.p1_seguridad_normas,
        p2_seguridad_conducta: values.p2_seguridad_conducta,
        p3_productividad_metas: values.p3_productividad_metas,
        p4_productividad_ritmo: values.p4_productividad_ritmo,
        p5_calidad_mercancia: values.p5_calidad_mercancia,
        p6_calidad_precision: values.p6_calidad_precision,
        p7_disciplina_puntualidad: values.p7_disciplina_puntualidad,
        p8_disciplina_asistencia: values.p8_disciplina_asistencia,
        p9_disciplina_instrucciones: values.p9_disciplina_instrucciones,
        p10_actitud_equipo: values.p10_actitud_equipo,
        p11_actitud_disposicion: values.p11_actitud_disposicion,
        p12_actitud_proactividad: values.p12_actitud_proactividad,
        comentarios_adicionales: values.comentarios_adicionales,
        firma_coordinador: values.firma_coordinador,
        puntaje_total,
        porcentaje_riesgo,
      })
    } catch (err) {
      console.log("[v0] Error generando PDF:", err)
      toast({
        title: "No se pudo generar el PDF",
        description: "La evaluacion quedo guardada pero hubo un problema al generar el documento.",
        variant: "destructive",
      })
    }

    toast({
      title: "Evaluacion registrada",
      description: "La evaluacion fue guardada y se descargo el PDF.",
    })
    setSubmitted({ puntaje_total, porcentaje_riesgo })
  }

  /**
   * Handler que se dispara cuando Zod falla en la validacion del formulario.
   * Da feedback claro al usuario sobre los campos faltantes para que no parezca que
   * el boton "Guardar evaluacion" no hace nada.
   */
  const onInvalid = (formErrors: typeof errors) => {
    const errorKeys = Object.keys(formErrors || {})
    console.log("[v0] Validacion fallo - campos con error:", errorKeys)
    toast({
      title: "Faltan campos por completar",
      description: `Hay ${errorKeys.length} campo${errorKeys.length !== 1 ? "s" : ""} pendiente${errorKeys.length !== 1 ? "s" : ""}. Revisa las secciones resaltadas en rojo.`,
      variant: "destructive",
    })
    // Hacer scroll al primer error para que el usuario lo vea
    if (typeof window !== "undefined") {
      setTimeout(() => {
        const firstError = document.querySelector("[data-error-summary]")
        firstError?.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 100)
    }
  }

  // Si el submit fue exitoso, mostrar pantalla de resumen
  if (submitted) {
    return (
      <ResumenEvaluacion
        colaboradorNombre={colaboradorNombre}
        puntajeTotal={submitted.puntaje_total}
        porcentajeRiesgo={submitted.porcentaje_riesgo}
        onNuevaEvaluacion={() => {
          setSubmitted(null)
          reset()
        }}
        onVolver={onBack}
      />
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack} className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
          <div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight">Evaluacion de Desempeno</h2>
            <p className="text-xs md:text-sm text-muted-foreground">
              {colaboradorNombre || "Cargando..."}
              {colaboradorCargo ? ` - ${colaboradorCargo}` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Alerta critica reactiva */}
      {alertaCritica && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>ALERTA: Criterio de seguridad critico no superado</AlertTitle>
          <AlertDescription>
            Requiere decision inmediata. Revisa cuidadosamente las secciones 6 (Decisiones) antes
            de cerrar la evaluacion.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4">
        {/* Resumen de campos faltantes: solo se muestra tras un intento fallido */}
        {Object.keys(errors).length > 0 && (
          <Alert variant="destructive" data-error-summary>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Faltan campos por completar</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-disc pl-5 text-sm space-y-0.5">
                {Object.keys(errors).map((key) => (
                  <li key={key}>{FIELD_LABELS[key] || key}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Accordion
          type="multiple"
          defaultValue={["seguridad", "productividad", "calidad", "disciplina", "actitud", "decisiones", "cierre"]}
          className="space-y-3"
        >
          {/* SECCION 1 - SEGURIDAD */}
          <SectionItem
            value="seguridad"
            icon={<ShieldCheck className="h-4 w-4" />}
            title="1. Seguridad"
            description="Cumplimiento de normas y conducta segura"
          >
            <StarField
              label="Cumplimiento de normas de seguridad"
              name="p1_seguridad_normas"
              control={control}
              error={errors.p1_seguridad_normas?.message}
            />
            <StarField
              label="Conducta segura en la operacion"
              name="p2_seguridad_conducta"
              control={control}
              error={errors.p2_seguridad_conducta?.message}
            />
          </SectionItem>

          {/* SECCION 2 - PRODUCTIVIDAD */}
          <SectionItem
            value="productividad"
            icon={<TrendingUp className="h-4 w-4" />}
            title="2. Productividad"
            description="Metas y ritmo de trabajo"
          >
            <StarField
              label="Cumplimiento de metas"
              name="p3_productividad_metas"
              control={control}
              error={errors.p3_productividad_metas?.message}
            />
            <StarField
              label="Ritmo de trabajo sostenido"
              name="p4_productividad_ritmo"
              control={control}
              error={errors.p4_productividad_ritmo?.message}
            />
          </SectionItem>

          {/* SECCION 3 - CALIDAD */}
          <SectionItem
            value="calidad"
            icon={<Award className="h-4 w-4" />}
            title="3. Calidad"
            description="Manejo de mercancia y precision"
          >
            <StarField
              label="Cuidado de mercancia"
              name="p5_calidad_mercancia"
              control={control}
              error={errors.p5_calidad_mercancia?.message}
            />
            <StarField
              label="Precision en la ejecucion"
              name="p6_calidad_precision"
              control={control}
              error={errors.p6_calidad_precision?.message}
            />
          </SectionItem>

          {/* SECCION 4 - DISCIPLINA */}
          <SectionItem
            value="disciplina"
            icon={<ClipboardCheck className="h-4 w-4" />}
            title="4. Disciplina"
            description="Puntualidad, asistencia y seguimiento de instrucciones"
          >
            <StarField
              label="Puntualidad"
              name="p7_disciplina_puntualidad"
              control={control}
              error={errors.p7_disciplina_puntualidad?.message}
            />
            <StarField
              label="Asistencia"
              name="p8_disciplina_asistencia"
              control={control}
              error={errors.p8_disciplina_asistencia?.message}
            />
            <StarField
              label="Seguimiento de instrucciones"
              name="p9_disciplina_instrucciones"
              control={control}
              error={errors.p9_disciplina_instrucciones?.message}
            />
          </SectionItem>

          {/* SECCION 5 - ACTITUD */}
          <SectionItem
            value="actitud"
            icon={<Smile className="h-4 w-4" />}
            title="5. Actitud"
            description="Trabajo en equipo, disposicion y proactividad"
          >
            <StarField
              label="Trabajo en equipo"
              name="p10_actitud_equipo"
              control={control}
              error={errors.p10_actitud_equipo?.message}
            />
            <StarField
              label="Disposicion"
              name="p11_actitud_disposicion"
              control={control}
              error={errors.p11_actitud_disposicion?.message}
            />
            <StarField
              label="Proactividad"
              name="p12_actitud_proactividad"
              control={control}
              error={errors.p12_actitud_proactividad?.message}
            />
          </SectionItem>

          {/* SECCION 6 - DECISIONES */}
          <SectionItem
            value="decisiones"
            icon={<Scale className="h-4 w-4" />}
            title="6. Decisiones"
            description="Decisiones clave sobre continuidad y riesgo"
          >
            <RadioField
              label="Recomienda continuidad del colaborador?"
              name="p13_continuidad"
              control={control}
              options={["Si", "No", "Con condiciones"]}
              error={errors.p13_continuidad?.message}
            />
            <RadioField
              label="Nivel de riesgo percibido"
              name="p14_nivel_riesgo"
              control={control}
              options={["Bajo", "Medio", "Alto"]}
              error={errors.p14_nivel_riesgo?.message}
            />
            <RadioField
              label="Decision sugerida"
              name="p15_decision_sugerida"
              control={control}
              options={["Continuar", "Capacitar / Plan de mejora", "No continuar"]}
              error={errors.p15_decision_sugerida?.message}
            />
            <RadioField
              label="Lo recontrataria?"
              name="p16_recontrataria"
              control={control}
              options={["Si", "No"]}
              error={errors.p16_recontrataria?.message}
            />
          </SectionItem>

          {/* SECCION 7 - CIERRE */}
          <SectionItem
            value="cierre"
            icon={<FileText className="h-4 w-4" />}
            title="7. Cierre"
            description="Comentarios adicionales y firma del coordinador"
          >
            <div className="space-y-2">
              <Label htmlFor="comentarios">Comentarios adicionales</Label>
              <Controller
                control={control}
                name="comentarios_adicionales"
                render={({ field }) => (
                  <Textarea
                    id="comentarios"
                    placeholder="Observaciones, fortalezas, areas de mejora, acuerdos..."
                    rows={4}
                    {...field}
                  />
                )}
              />
              {errors.comentarios_adicionales && (
                <p className="text-xs text-red-600">{errors.comentarios_adicionales.message}</p>
              )}
            </div>

            <Controller
              control={control}
              name="firma_coordinador"
              render={({ field }) => (
                <FirmaCanvas
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.firma_coordinador?.message}
                />
              )}
            />
          </SectionItem>
        </Accordion>

        {/* Footer con acciones */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Guardando...
              </>
            ) : (
              "Guardar evaluacion"
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}

/* ===================== Subcomponentes ===================== */

function SectionItem({
  value,
  icon,
  title,
  description,
  children,
}: {
  value: string
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <AccordionItem value={value} className="border rounded-lg px-4 bg-card">
      <AccordionTrigger className="hover:no-underline py-3">
        <div className="flex items-center gap-3 text-left">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <div className="font-semibold text-sm md:text-base">{title}</div>
            <div className="text-xs text-muted-foreground font-normal">{description}</div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pt-2 pb-4 space-y-4">{children}</AccordionContent>
    </AccordionItem>
  )
}

function StarRating({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const [hover, setHover] = useState(0)
  return (
    <div
      className="flex items-center gap-1"
      onMouseLeave={() => setHover(0)}
      role="radiogroup"
      aria-label="Calificacion de 1 a 5 estrellas"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const active = (hover || value) >= n
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            className="p-1 rounded-md transition hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={`${n} estrella${n > 1 ? "s" : ""}`}
            aria-checked={value === n}
            role="radio"
          >
            <Star
              className={`h-6 w-6 ${active ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40"}`}
            />
          </button>
        )
      })}
      {value > 0 && (
        <span className="ml-2 text-xs text-muted-foreground">{value} / 5</span>
      )}
    </div>
  )
}

function StarField({
  label,
  name,
  control,
  error,
}: {
  label: string
  name: keyof EvaluacionFormValues
  control: any
  error?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <Controller
        control={control}
        name={name as any}
        render={({ field }) => (
          <StarRating
            value={Number(field.value) || 0}
            onChange={(n) => field.onChange(n)}
          />
        )}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

function RadioField({
  label,
  name,
  control,
  options,
  error,
}: {
  label: string
  name: keyof EvaluacionFormValues
  control: any
  options: string[]
  error?: string
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">{label}</Label>
      <Controller
        control={control}
        name={name as any}
        render={({ field }) => (
          <RadioGroup
            value={String(field.value || "")}
            onValueChange={field.onChange}
            className="flex flex-wrap gap-4"
          >
            {options.map((opt) => (
              <div key={opt} className="flex items-center gap-2">
                <RadioGroupItem value={opt} id={`${String(name)}-${opt}`} />
                <Label htmlFor={`${String(name)}-${opt}`} className="text-sm font-normal cursor-pointer">
                  {opt}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

/**
 * Canvas simulado para firma. Guarda un string base64 al soltar el puntero.
 */
function FirmaCanvas({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (v: string) => void
  error?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    // Si el valor se pone en blanco desde afuera, limpiar el canvas.
    const canvas = canvasRef.current
    if (!canvas) return
    if (!value) {
      const ctx = canvas.getContext("2d")
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [value])

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    drawingRef.current = true
    lastPointRef.current = getPos(e)
    ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const p = getPos(e)
    const last = lastPointRef.current || p
    ctx.strokeStyle = "#0f172a"
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPointRef.current = p
  }

  const end = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPointRef.current = null
    const canvas = canvasRef.current
    if (canvas) {
      const dataUrl = canvas.toDataURL("image/png")
      onChange(dataUrl)
    }
  }

  const limpiar = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    ctx?.clearRect(0, 0, canvas.width, canvas.height)
    onChange("")
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Firma del coordinador</Label>
        <Button type="button" variant="ghost" size="sm" onClick={limpiar} className="gap-1 text-xs">
          <Eraser className="h-3.5 w-3.5" />
          Limpiar
        </Button>
      </div>
      <div className="rounded-md border bg-muted/20">
        <canvas
          ref={canvasRef}
          width={600}
          height={160}
          className="w-full h-40 touch-none cursor-crosshair rounded-md bg-white"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Firma con el puntero o dedo (dispositivos tactiles). La firma se guarda como imagen base64.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

/* ===================== Pantalla de resumen ===================== */

function ResumenEvaluacion({
  colaboradorNombre,
  puntajeTotal,
  porcentajeRiesgo,
  onNuevaEvaluacion,
  onVolver,
}: {
  colaboradorNombre: string
  puntajeTotal: number
  porcentajeRiesgo: number
  onNuevaEvaluacion: () => void
  onVolver: () => void
}) {
  // Nivel de riesgo por bandas
  const nivel =
    porcentajeRiesgo >= 60
      ? { label: "Alto", color: "text-red-700" }
      : porcentajeRiesgo >= 30
        ? { label: "Medio", color: "text-amber-700" }
        : { label: "Bajo", color: "text-green-700" }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onVolver} className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          Volver al listado
        </Button>
      </div>

      <Card>
        <CardHeader className="items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700 mb-2">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl md:text-2xl">Evaluacion registrada con exito</CardTitle>
          <CardDescription>
            {colaboradorNombre ? `Resumen de la evaluacion de ${colaboradorNombre}` : "Resumen de la evaluacion"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">Puntaje total</div>
              <div className="text-2xl font-bold">{puntajeTotal} <span className="text-base text-muted-foreground font-normal">/ 60</span></div>
              <div className="mt-3">
                <Progress value={(puntajeTotal / 60) * 100} />
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">Porcentaje de riesgo</div>
              <div className={`text-2xl font-bold ${nivel.color}`}>{porcentajeRiesgo}%</div>
              <div className="mt-3">
                <Progress value={porcentajeRiesgo} />
              </div>
              <div className={`mt-2 text-xs ${nivel.color}`}>Nivel: {nivel.label}</div>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button variant="outline" onClick={onNuevaEvaluacion}>
              Nueva evaluacion
            </Button>
            <Button onClick={onVolver}>Finalizar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
