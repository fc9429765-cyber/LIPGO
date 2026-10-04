"use client"

/**
 * Copiloto de rotación LIPbot -- panel dentro de "Programar el día" que pide
 * la sugerencia de `sugerirRotacion` (determinística, sin IA -- ver
 * lib/rotacion-sugerida-actions.ts) y la muestra lista para aplicar.
 *
 * "Aplicar sugerencia" NO guarda nada en la base de datos: solo entrega las
 * sugerencias al padre (`onAplicar`), que las escribe en el MISMO estado de
 * selección que ya usa el formulario manual. El guardado real sigue siendo
 * el botón "Guardar programación" de siempre.
 */

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Sparkles, AlertTriangle, Check, X } from "lucide-react"
import { sugerirRotacion, type SugerenciaPersona, type SugerenciaRotacion } from "@/lib/rotacion-sugerida-actions"

const CRITERIOS = [
  { n: 1, titulo: "Horas extra acumuladas", detalle: "Quien ya está topado de HED/HEN esta semana entra de último en la rotación." },
  { n: 2, titulo: "Toneladas vs. meta", detalle: "% de cumplimiento de Control de Toneladas — quien está más bajo en destajo, entra primero." },
  { n: 3, titulo: "Puesto que más nómina paga hoy", detalle: "Al más bajo se le asigna la especialidad/turno con cupo, para nivelar la quincena." },
  { n: 4, titulo: "Hora de entrada rotativa", detalle: "Alterna entre quienes llevan varios días entrando temprano y quienes entran tarde." },
]

export function CopilotoRotacion({
  empresaId,
  fecha,
  onAplicar,
}: {
  empresaId: number | null
  fecha: string
  onAplicar: (sugerencias: SugerenciaPersona[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState<SugerenciaRotacion | null>(null)
  const [aplicado, setAplicado] = useState(false)

  async function pedirSugerencia() {
    if (!empresaId || !fecha) return
    setLoading(true)
    setResultado(null)
    setAplicado(false)
    const res = await sugerirRotacion(empresaId, fecha)
    setLoading(false)
    if (res.success && res.data) setResultado(res.data)
    else setResultado({ fecha, reglaEmpresa: null, sugerencias: [], necesidadPorPuesto: [], alertas: [res.message || "No se pudo calcular la sugerencia."] })
  }

  function aplicar() {
    if (!resultado) return
    onAplicar(resultado.sugerencias)
    setAplicado(true)
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#33D9E8] to-[#00A8C2] p-px shadow-[0_14px_34px_-12px_rgba(0,168,194,0.45)]">
      <div className="rounded-[calc(1rem-1px)] bg-gradient-to-br from-[#0B1E30] to-[#102A42] p-4 text-[#EAF7FA] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#33D9E8] to-[#00A8C2] text-base shadow-[0_0_0_4px_rgba(51,217,232,0.14)]">
              💬
            </div>
            <div>
              <h3 className="text-sm font-bold leading-tight">LIPbot · Copiloto de rotación</h3>
              <p className="text-[11px] text-[#9FD8E3]">Cruza Control de Toneladas + horas extra + Cobertura de la quincena</p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={pedirSugerencia}
            disabled={loading || !empresaId || !fecha}
            className="gap-1.5 rounded-full border-0 bg-gradient-to-br from-[#33D9E8] to-[#00A8C2] font-bold text-[#04222A] hover:opacity-90"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Sugerir rotación para {fecha || "…"}
          </Button>
        </div>

        {!resultado && (
          <div className="mt-3.5 flex flex-wrap gap-2.5">
            {CRITERIOS.map((c) => (
              <div key={c.n} className="flex min-w-[200px] flex-1 gap-2.5 rounded-lg border border-white/10 bg-white/5 p-2.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#33D9E8]/15 font-mono text-[11px] font-bold text-[#33D9E8]">
                  {c.n}
                </div>
                <div>
                  <b className="block text-xs">{c.titulo}</b>
                  <span className="block text-[10.5px] leading-snug text-[#9FD8E3]">{c.detalle}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {resultado && (
          <div className="mt-4 space-y-3">
            {resultado.necesidadPorPuesto.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {resultado.necesidadPorPuesto.map((n) => (
                  <span key={n.puesto} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10.5px]">
                    {n.puesto}: <b className="tabular-nums">{n.asignadosHoy}/{n.requeridos}</b>
                  </span>
                ))}
              </div>
            )}

            {resultado.alertas.length > 0 && (
              <div className="space-y-1">
                {resultado.alertas.map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-[#F3B9BB]">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            )}

            {resultado.sugerencias.length > 0 && (
              <div className="space-y-2">
                {resultado.sugerencias.map((s) => (
                  <div key={s.identificacion} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
                    <div className="min-w-[170px]">
                      <b className="block text-xs">{s.nombre}</b>
                      <span className="text-[10.5px] text-[#9FD8E3]">{s.puestoActual || "—"} → <b>{s.puestoSugerido}</b></span>
                      {s.horaEntradaSugerida && (
                        <span className="mt-0.5 block font-mono text-[10px] text-[#9FD8E3]">
                          {s.horaEntradaSugerida}
                          {s.horaSalidaSugerida ? `–${s.horaSalidaSugerida}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-wrap gap-1.5">
                      {s.criteriosAplicados.map((c, i) => (
                        <span key={i} className="whitespace-nowrap rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-[#CFEFF5]">
                          {c}
                        </span>
                      ))}
                    </div>
                    {s.pctCumplimiento !== null && (
                      <div className="text-right">
                        <div className="font-mono text-[11px]">{s.pctCumplimiento}%</div>
                        <div className="ml-auto mt-1 h-[5px] w-[64px] overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, Math.max(0, s.pctCumplimiento))}%`,
                              background: s.pctCumplimiento < 70 ? "#F0C24B" : "#5FDBA0",
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                onClick={aplicar}
                disabled={resultado.sugerencias.length === 0 || aplicado}
                className="gap-1.5 rounded-lg border-0 bg-gradient-to-br from-[#33D9E8] to-[#00A8C2] font-bold text-[#04222A] hover:opacity-90"
              >
                <Check className="h-3.5 w-3.5" />
                {aplicado ? "Aplicado a la tabla" : "Aplicar sugerencia a la tabla"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setResultado(null)
                  setAplicado(false)
                }}
                className="gap-1.5 rounded-lg border border-white/15 bg-white/5 text-[#EAF7FA] hover:bg-white/10 hover:text-[#EAF7FA]"
              >
                <X className="h-3.5 w-3.5" />
                Descartar
              </Button>
            </div>
            {aplicado && (
              <p className="text-[11px] text-[#9FD8E3]">
                Las filas quedaron pre-marcadas y son editables — no se guardó nada todavía, confirma con "Guardar programación".
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
