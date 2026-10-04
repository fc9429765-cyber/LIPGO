"use client"

// Demanda de un día DENTRO de Programación del cliente (entrega 3 del plan de Pedidos):
// para quien programa la ruta, los pedidos abiertos con promesa ese día (pedidos, kilos,
// unidades, por tipo de despacho), los atrasados recientes que también podrían salir, y la
// cobertura de la programación vigente frente a esa demanda. Solo en los modos cliente y
// gerencia: el coordinador LIP no ve pedidos. Misma fuente que la pestaña "Para mañana".

import { useEffect, useState } from "react"
import { Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip, Cifra, Esqueleto, Eyebrow } from "@/components/ui/lipgo"
import { getDemandaFecha, type DemandaFecha } from "@/lib/pedidos-cola-actions"
import { NUM, T1, abrirGestionar, fechaCorta, fechaLarga, tTexto } from "./formato"

export function DemandaDelDia({ empresaId, fecha, className }: { empresaId: number; fecha: string; className?: string }) {
  const [d, setD] = useState<DemandaFecha | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    getDemandaFecha(empresaId, fecha).then((r) => {
      if (!vivo) return
      if (r.success) {
        setD(r.data)
        setError(null)
      } else setError(r.message)
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [empresaId, fecha])

  if (error) return null // sin acceso a pedidos (p. ej. perfil sin empresas): la programación sigue funcionando sola
  if (!d) {
    return (
      <section className={`lg-card p-5 ${className ?? ""}`}>
        <Esqueleto lineas={3} />
      </section>
    )
  }

  const cobertura = d.programacion.tiene && d.programacion.capacidadT != null && d.kg > 0 ? Math.round(((d.programacion.capacidadT * 1000) / d.kg) * 100) : null
  const faltanT = d.programacion.tiene && d.programacion.capacidadT != null ? Math.max(0, d.kg / 1000 - d.programacion.capacidadT) : d.kg / 1000
  const refMula = d.tiposVehiculo.find((t) => (t.capacidad ?? 0) >= 30)
  const refDoble = d.tiposVehiculo.find((t) => t.capacidad != null && t.capacidad >= 14 && t.capacidad < 30)
  const chipCobertura =
    d.kg === 0 ? (
      <Chip tono="neutro">Sin pedidos para este día</Chip>
    ) : !d.programacion.tiene ? (
      <Chip tono="atencion">Sin programación · faltan {T1.format(faltanT)} t</Chip>
    ) : cobertura == null ? (
      <Chip tono="neutro">Tipo de vehículo sin capacidad</Chip>
    ) : cobertura >= 100 ? (
      <Chip tono="ok">Cubre · {cobertura} %</Chip>
    ) : (
      <Chip tono="atencion">Faltan {T1.format(faltanT)} t · {cobertura} %</Chip>
    )

  return (
    <section className={`lg-card ${className ?? ""}`} aria-busy={cargando}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <Eyebrow>Pedidos para ese día</Eyebrow>
          <h2 className="text-sm font-semibold">Demanda del {fechaLarga(d.fecha)}</h2>
        </div>
        {chipCobertura}
      </div>
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <Cifra label="Pedidos" valor={NUM.format(d.pedidos)} unidad={d.pedidos ? `${d.aprobados} aprobados${d.porAprobar ? ` · ${d.porAprobar} por aprobar` : ""}` : "con promesa ese día"} />
        <Cifra label="Kilos" valor={NUM.format(Math.round(d.kg))} unidad={d.kg ? `kg · ${tTexto(d.kg)}` : "kg"} />
        <Cifra label="Unidades" valor={NUM.format(d.unidades)} unidad="bultos y paquetes" />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => abrirGestionar({ tab: "cola", filtro: `fecha:${d.fecha}` })} disabled={d.pedidos === 0}>
          <Truck className="h-4 w-4" /> Ver pedidos de ese día
        </Button>
      </div>
      {(d.porDespacho.length > 0 || d.atrasadosRecientes.total > 0 || (d.kg > 0 && (refMula || refDoble))) && (
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3 text-sm">
          {d.porDespacho.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Por despacho:</span>
              {d.porDespacho.map((x) => (
                <Chip key={x.tipo} tono="neutro">{x.tipo} · {x.pedidos} · {tTexto(x.kg)}</Chip>
              ))}
            </p>
          )}
          {d.kg > 0 && (refMula || refDoble) && (
            <p className="lg-num text-xs text-muted-foreground">
              {tTexto(d.kg)} equivalen a{refMula && refMula.capacidad ? ` ${Math.ceil(d.kg / 1000 / refMula.capacidad)} ${refMula.nombre.toLowerCase()}${Math.ceil(d.kg / 1000 / refMula.capacidad) === 1 ? "" : "s"}` : ""}
              {refMula && refDoble ? " o" : ""}
              {refDoble && refDoble.capacidad ? ` ${Math.ceil(d.kg / 1000 / refDoble.capacidad)} ${refDoble.nombre.toLowerCase()}${Math.ceil(d.kg / 1000 / refDoble.capacidad) === 1 ? "" : "s"}` : ""}.
              {d.programacion.tiene ? ` Programados: ${d.programacion.vehiculos} vehículos${d.programacion.capacidadT != null ? ` (${T1.format(d.programacion.capacidadT)} t)` : ""}.` : ""}
            </p>
          )}
          {d.atrasadosRecientes.total > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <Chip tono="critico">{d.atrasadosRecientes.total} {d.atrasadosRecientes.total === 1 ? "atrasado" : "atrasados"} · {tTexto(d.atrasadosRecientes.kg)}</Chip>
              <span className="text-muted-foreground">
                de los últimos 15 días podrían salir también: {d.atrasadosRecientes.porCliente.slice(0, 3).map((c) => `${c.cliente} (${c.pedidos}, promesa ${c.promesas.sort().map(fechaCorta).join(", ")})`).join("; ")}.
              </span>
              <button type="button" className="text-xs font-medium text-acento underline-offset-2 hover:underline" onClick={() => abrirGestionar({ tab: "cola", filtro: "atrasados" })}>
                Ver atrasados
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  )
}
