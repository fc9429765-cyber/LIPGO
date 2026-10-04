"use client"

// Franja de Pedidos en el portal del área (Pedidos y solicitudes). Misma fuente y
// mismas definiciones que la franja de Gestionar pedidos (getResumenCola): la
// información es una sola. Cada cifra abre Gestionar en su vista.
// Reemplaza la tira anterior (vencidos / vence hoy / por vencer / pendientes /
// entregados), que usaba otra definición y no coincidía con la Cola.

import { useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Cifra, Esqueleto } from "@/components/ui/lipgo"
import { getResumenCola, type ResumenCola } from "@/lib/pedidos-cola-actions"
import { NUM, abrirGestionar, fechaCorta } from "@/components/orders/gestionar/formato"

type Datos = { hoy: string; manana: string; resumen: ResumenCola }

export function PedidosKpiStrip() {
  const { selectedEmpresaId } = useAuth()
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    setD(null)
    setError(null)
    if (!selectedEmpresaId) return
    getResumenCola(selectedEmpresaId)
      .then((r) => {
        if (cancel) return
        if (r.success) setD(r.data)
        else setError(r.message)
      })
      .catch((e) => !cancel && setError(String(e?.message ?? e)))
    return () => {
      cancel = true
    }
  }, [selectedEmpresaId])

  if (!selectedEmpresaId) return null
  if (error) return <p className="text-xs text-atencion-fg">No se pudo leer la cola de pedidos: {error}</p>
  if (!d) {
    return (
      <section className="lg-card grid grid-cols-2 gap-5 p-4 sm:grid-cols-3 lg:grid-cols-6" aria-busy>
        {Array.from({ length: 6 }).map((_, i) => <Esqueleto key={i} lineas={2} />)}
      </section>
    )
  }

  const r = d.resumen
  const items: { k: string; label: string; valor: number; tono: "ok" | "atencion" | "critico" | "info" | "neutro"; sub: string; abrir: () => void }[] = [
    { k: "atrasados", label: "Atrasados", valor: r.atrasados, tono: r.atrasados > 0 ? "critico" : "ok", sub: r.atrasados > 0 ? `${NUM.format(r.atrasadosRecientes)} recientes · ${NUM.format(r.atrasadosViejos)} de más de 15 d` : "ninguno", abrir: () => abrirGestionar({ tab: "cola", filtro: "atrasados" }) },
    { k: "hoy", label: "Para hoy", valor: r.hoy, tono: r.hoy > 0 ? "info" : "neutro", sub: r.hoy > 0 ? `${NUM.format(r.kgHoy)} kg` : "sin pedidos para hoy", abrir: () => abrirGestionar({ tab: "cola", filtro: "hoy" }) },
    { k: "manana", label: "Para mañana", valor: r.manana, tono: "neutro", sub: r.manana > 0 ? `${NUM.format(r.kgManana)} kg · ${fechaCorta(d.manana)}` : `${fechaCorta(d.manana)} sin pedidos`, abrir: () => abrirGestionar({ tab: "manana" }) },
    { k: "cargue", label: "En cargue / parcial", valor: r.enCargue + r.parciales, tono: r.parciales > 0 ? "atencion" : "neutro", sub: `${NUM.format(r.parciales)} parciales · ${NUM.format(r.enCargue)} en cargue`, abrir: () => abrirGestionar({ tab: "cola", filtro: "en_cargue" }) },
    { k: "aprobar", label: "Por aprobar", valor: r.porAprobar, tono: "neutro", sub: `${NUM.format(r.porAprobarConCartera)} con cartera lista`, abrir: () => abrirGestionar({ tab: "cola", filtro: "por_aprobar" }) },
    { k: "depurar", label: "Candidatos a depurar", valor: r.candidatosSinRastro + r.candidatosParciales, tono: r.candidatosSinRastro + r.candidatosParciales > 0 ? "atencion" : "ok", sub: `${NUM.format(r.candidatosSinRastro)} sin rastro · ${NUM.format(r.candidatosParciales)} parciales`, abrir: () => abrirGestionar({ tab: "depurar" }) },
  ]

  return (
    <section className="lg-card grid grid-cols-2 gap-y-4 p-4 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-6 lg:gap-y-0" aria-label="Cola logística del cliente">
      {items.map((c, i) => (
        <button key={c.k} type="button" onClick={c.abrir} title={`Abrir en Gestionar pedidos`} className={`rounded-lg text-left transition hover:ring-2 hover:ring-acento-tinte hover:ring-offset-2 ${i < 5 ? "lg:border-r lg:border-border lg:pr-4" : ""} ${i > 0 ? "lg:pl-4" : ""}`}>
          <Cifra label={c.label} valor={NUM.format(c.valor)} tono={c.tono} sub={c.sub} tamano="compacta" />
        </button>
      ))}
    </section>
  )
}
