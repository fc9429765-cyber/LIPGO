"use client"

// FINANZAS SIIGO
//
// Contenedor del módulo. Agrupa las vistas que leen de Siigo:
//
//   · Facturas  — las de venta, con su detalle y el PDF
//   · Maestros  — productos, clientes, formas de pago e impuestos
//
// Se separa del componente de facturas en vez de meterle las pestañas dentro:
// aquel ya es grande y mezclar la navegación con su contenido lo volvería más
// difícil de seguir. Aquí la navegación es lo único que hay.

import { useState } from "react"
import { Database, FileText } from "lucide-react"
import ConsultaSiigo from "@/components/facturacion/consulta-siigo"
import MaestrosSiigo from "@/components/facturacion/maestros-siigo"

type Vista = "facturas" | "maestros"

export default function SiigoFinanzas() {
  const [vista, setVista] = useState<Vista>("facturas")

  const pestanas: Array<{ id: Vista; nombre: string; Icono: typeof FileText }> = [
    { id: "facturas", nombre: "Facturas", Icono: FileText },
    { id: "maestros", nombre: "Maestros SIIGO", Icono: Database },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-border">
        {pestanas.map(({ id, nombre, Icono }) => (
          <button
            key={id}
            type="button"
            onClick={() => setVista(id)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm ${
              vista === id
                ? "border-primary font-medium text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icono className="h-4 w-4" />
            {nombre}
          </button>
        ))}
      </div>

      {/* Se monta solo la vista activa, no ambas ocultas: cada una consulta a
          Siigo al abrirse, y tenerlas montadas a la vez gastaría llamadas en
          algo que nadie está mirando. */}
      {vista === "facturas" ? <ConsultaSiigo /> : <MaestrosSiigo />}
    </div>
  )
}
