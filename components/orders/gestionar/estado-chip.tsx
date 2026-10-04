"use client"

import { Chip } from "@/components/ui/lipgo"
import type { EstadoDerivado } from "@/lib/pedidos-estado"

/** Chip del estado derivado de un pedido (atrasado · para hoy · parcial · nuevo…). */
export function EstadoChip({ calc, className, title }: { calc: EstadoDerivado; className?: string; title?: string }) {
  return (
    <Chip tono={calc.tono} className={className} title={title}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {calc.etiqueta}
    </Chip>
  )
}
