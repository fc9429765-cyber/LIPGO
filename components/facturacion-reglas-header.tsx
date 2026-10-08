"use client"

// Encabezado del Cuadro de Control de Facturación: qué entra en la prefactura y
// bajo qué reglas, para el proyecto seleccionado.
//
// POR QUE EXISTE: las reglas de facturación estan repartidas en varios archivos
// (`facturacion-produccion-conceptos.ts`, `facturacion-cargue-propio.ts`,
// `facturacion-medio-pago.ts`, `facturacion-billed-party.ts`) y son MUY distintas
// entre proyectos: lo que en Indupan ya viene incluido, en Avimol hay que sumarlo
// aparte; lo que en Indupan siempre es crédito, en Avimol depende del transporte
// y hasta de la placa. Quien revisa una prefactura necesita tener eso a la vista
// para saber si un numero esta bien o esta mal.
//
// Lo que se puede leer de una constante se LEE, no se reescribe: los conceptos de
// produccion, su vigencia y su nota salen de PRODUCCION_POR_PROYECTO, y la nota
// del cargue por placa propia de CARGUE_SOLO_PLACA_PROPIA. Asi, si esas reglas
// cambian, el encabezado cambia solo. Lo que si esta escrito aqui son las reglas
// que hoy viven como logica y no como dato (medio de pago, a quien se factura).

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BookOpen, ChevronDown, ChevronUp, Info } from "lucide-react"
import { produccionDelProyecto } from "@/lib/facturacion-produccion-conceptos"
import { cargueSoloPlacaPropia } from "@/lib/facturacion-cargue-propio"
import { PLACAS_ZAMUDIO_CONTADO } from "@/lib/facturacion-medio-pago"

/** Reglas que hoy viven como lógica y no como dato, por proyecto. */
interface ReglasProyecto {
  nombre: string
  medioPago: string[]
  aQuienSeFactura: string[]
  particularidades: string[]
}

const REGLAS: Record<number, ReglasProyecto> = {
  1: {
    nombre: "Harinera Indupan",
    medioPago: [
      "TODO se factura a crédito al owner que corresponda.",
      "El contado no existe en este proyecto: un “Contado” aquí es un error a revisar.",
    ],
    aQuienSeFactura: ["Al owner del producto, sin excepciones por transporte."],
    particularidades: [
      "El vehículo SXX144 está excluido a propósito: no lo atiende LIP.",
    ],
  },
  2: {
    nombre: "Avimol",
    medioPago: [
      "Transporte TERCEROS → Contado, sin excepción (el cliente recoge y paga).",
      `Transporte ZAMUDIO → Crédito, salvo ${PLACAS_ZAMUDIO_CONTADO.size} placas declaradas que pagan de contado. La excepción es por placa a propósito: si aparece otra placa de Zamudio en contado, debe salir marcada y no quedar tragada por una regla general.`,
      "Resto (Avimol, Indupan, Molinos…) → Crédito.",
    ],
    aQuienSeFactura: [
      "En Cargue, Descargue y Distribución cada transportadora paga su propio cargue: ZAMUDIO se factura a Zamudio y TERCEROS a Terceros — no a Avimol.",
      "Los vehículos de AVIMOL sí son de Avimol, pero esa porción NO se cobra por tonelada: la cubre el fijo mensual de 600 toneladas de DISTRIBUCIÓN (dos tramos de 300 a tarifa distinta), así que la línea cuenta en toneladas con valor 0.",
      "Ese valor 0 aplica a cargue, descargue y distribución con placa propia, y NO tiene tope: si en el mes se mueven más de 600 toneladas, el fijo mensual sigue siendo el mismo.",
      "Producción, turnos y novedades adicionales sí se facturan a Avimol con normalidad: no nacen de una orden, así que no pasan por esa regla.",
    ],
    particularidades: [],
  },
  3: {
    nombre: "Cedi Funza",
    medioPago: ["Todo a crédito, igual que Indupan."],
    aQuienSeFactura: ["Al owner del producto."],
    particularidades: [],
  },
  4: {
    nombre: "Cedi Medellín",
    medioPago: [
      "El contado vive SOLO en los descargues. Un cargue o una distribución de contado es un error a revisar.",
      "Dentro del descargue conviven contado y crédito (los terceros pagan de contado y las transportadoras a crédito), así que ahí no se impone regla dura.",
    ],
    aQuienSeFactura: [
      "Al owner del producto, SALVO el vehículo propio LWY393: ese factura todo su viaje al owner del proyecto, sin importar de quién sea el producto.",
    ],
    particularidades: [
      "El vehículo WMP446 está excluido: no lo atiende LIP, salvo cuando carga a Susanita.",
    ],
  },
}

export function FacturacionReglasHeader({ empresaId }: { empresaId: number | null }) {
  const [abierto, setAbierto] = useState(true)

  const reglas = empresaId ? REGLAS[empresaId] : undefined
  const produccion = produccionDelProyecto(empresaId)
  const cargue = cargueSoloPlacaPropia(empresaId)

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">
                Reglas de facturación
                {reglas ? ` — ${reglas.nombre}` : ""}
              </h3>
              <p className="text-xs text-muted-foreground">
                Qué entra en la prefactura de este proyecto y bajo qué criterio.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 shrink-0" onClick={() => setAbierto((v) => !v)}>
            {abierto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <span className="ml-1 text-xs">{abierto ? "Ocultar" : "Ver"}</span>
          </Button>
        </div>

        {abierto && (
          <div className="mt-4 space-y-4 text-xs leading-relaxed">
            {/* --- Transversal: aplica a todos los proyectos --- */}
            <Bloque titulo="Qué cuenta como línea facturable (todos los proyectos)">
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  La fuente de verdad son las <strong>órdenes de servicio procesadas</strong>: una orden entra
                  cuando tiene <strong>fin de cargue</strong> registrado y no fue marcada como “no facturar”.
                </li>
                <li>
                  Si en <strong>Picking</strong> se desmarcó “facturar” —porque el personal que cargó no fue de
                  LIP— esa orden <strong>no entra</strong> en la prefactura.
                </li>
                <li>
                  El <strong>owner</strong> (a quién se factura) sale del producto, no del proyecto. Por eso en un
                  mismo vehículo pueden convivir varios owners y a cada uno se le cobra su parte.
                </li>
                <li>
                  Las órdenes de tipo <strong>proyección</strong> nunca entran.
                </li>
                <li>
                  En <span className="font-semibold text-red-600">rojo</span> queda lo que está{" "}
                  <strong>procesado sin facturar</strong> o <strong>sin tarifa</strong>: es lo que hay que
                  resolver antes de emitir.
                </li>
              </ul>
            </Bloque>

            {!empresaId ? (
              <div className="flex items-start gap-2 rounded-md border bg-background p-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">
                  Selecciona un proyecto arriba para ver sus reglas propias: producción, medio de pago esperado
                  y a quién se factura cada operación.
                </span>
              </div>
            ) : (
              <>
                {/* --- Producción: sale de la constante, no se reescribe --- */}
                <Bloque titulo="Producción">
                  {produccion ? (
                    <>
                      <p>
                        Conceptos: <strong>{produccion.conceptos.join(", ")}</strong>.{" "}
                        {produccion.fuente === "ordenes" ? (
                          <>
                            Ya son órdenes de cargue, así que la prefactura <strong>ya los trae</strong> por la vía
                            normal y <strong>no se suman aparte</strong> — hacerlo cobraría dos veces lo mismo.
                          </>
                        ) : (
                          <>
                            No tienen orden de cargue detrás, así que se <strong>suman aparte</strong>. Sin ese
                            bloque la factura de este proyecto sale incompleta.
                          </>
                        )}
                      </p>
                      {produccion.desde && (
                        <p className="mt-1">
                          Aplica desde el <strong>{produccion.desde}</strong>. Un período anterior se factura
                          exactamente como se venía facturando, para que volver a generar una prefactura ya
                          revisada dé el mismo documento.
                        </p>
                      )}
                      <p className="mt-1 text-muted-foreground">{produccion.nota}</p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      Este proyecto no factura conceptos de producción: todo lo facturable nace de órdenes de
                      servicio.
                    </p>
                  )}
                </Bloque>

                {/* --- A quién se le factura cada movimiento: nota de la constante --- */}
                {cargue && (
                  <Bloque titulo="A quién se le factura cada movimiento">
                    <p className="text-muted-foreground">{cargue.nota}</p>
                  </Bloque>
                )}

                {reglas && (
                  <>
                    <Bloque titulo="A quién se factura">
                      <ul className="ml-4 list-disc space-y-1">
                        {reglas.aQuienSeFactura.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </Bloque>

                    <Bloque titulo="Medio de pago esperado">
                      <ul className="ml-4 list-disc space-y-1">
                        {reglas.medioPago.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                      <p className="mt-1 text-muted-foreground">
                        El trámite no cambia: la factura siempre se solicita desde Solicitar Facturas. Lo que
                        cambia es la condición de pago.
                      </p>
                    </Bloque>

                    {reglas.particularidades.length > 0 && (
                      <Bloque titulo="Particularidades">
                        <ul className="ml-4 list-disc space-y-1">
                          {reglas.particularidades.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </Bloque>
                    )}
                  </>
                )}

                {!reglas && (
                  <div className="flex items-start gap-2 rounded-md border bg-background p-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Este proyecto no tiene reglas propias declaradas: aplica solo lo transversal de arriba.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="mb-1.5 font-semibold">{titulo}</p>
      {children}
    </div>
  )
}

export default FacturacionReglasHeader
