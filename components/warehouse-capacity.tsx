"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import {
  WarehouseIcon,
  AlertTriangle,
  PackageOpen,
  PackageCheck,
  RefreshCcw,
  X,
  Layers,
} from "lucide-react"
import { getWarehouseCapacities, type WarehouseCapacity } from "@/lib/inventory-actions"
import { useAuth } from "@/components/auth-provider"

/**
 * Token bucket usado para clasificar localizaciones.
 *  - "llena":    porcentaje >= 100
 *  - "parcial":  0 < porcentaje < 100
 *  - "vacia":    porcentaje === 0  (stock_actual = 0 sobre capacidad > 0)
 *
 * Localizaciones con `capacidad === 0` se ignoran de los buckets porque
 * no aportan informacion util para un dashboard de capacidad.
 */
type Bucket = "llena" | "parcial" | "vacia"

function classify(c: WarehouseCapacity): Bucket | null {
  if (c.capacidad <= 0) return null
  if (c.porcentajeUtilizacion >= 100) return "llena"
  if (c.porcentajeUtilizacion <= 0) return "vacia"
  return "parcial"
}

const TODOS = "__todos__"

type AlmacenSummary = {
  key: string
  id: number | null
  nombre: string
  capacidad: number
  stock: number
  utilizacion: number
  locations: number
}

export function WarehouseCapacityComponent() {
  const { selectedEmpresaId } = useAuth()
  const [capacities, setCapacities] = useState<WarehouseCapacity[]>([])
  const [loading, setLoading] = useState(true)
  // Filtro 1 (ambito): "Todos" o una key de almacen.
  const [almacenSeleccionado, setAlmacenSeleccionado] = useState<string>(TODOS)
  // Filtro 2 (estado de ocupacion): null = mostrar todas, o un bucket
  // especifico para mostrar SOLO esas localizaciones. Las dos tarjetas
  // de filtro se combinan con AND.
  const [bucketSeleccionado, setBucketSeleccionado] = useState<Bucket | null>(
    null,
  )
  // Token de petición: si el usuario cambia de empresa rápido, se descarta el
  // resultado de una petición anterior (más lenta) para que no pise a la nueva.
  const reqIdRef = useRef(0)

  useEffect(() => {
    loadCapacities()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const loadCapacities = async () => {
    const myId = ++reqIdRef.current
    setLoading(true)
    try {
      const data = await getWarehouseCapacities(selectedEmpresaId)
      if (myId !== reqIdRef.current) return // llegó una petición más nueva → descartar
      setCapacities(data)
    } catch (error) {
      console.error("Error loading warehouse capacities:", error)
    } finally {
      if (myId === reqIdRef.current) setLoading(false)
    }
  }

  /**
   * Resumen por almacen para alimentar las tarjetas-filtro de la parte
   * superior. Se calcula en el cliente a partir de las localizaciones
   * que ya trajimos del servidor (no requiere segundo fetch). Cada
   * tarjeta muestra capacidad acumulada, stock acumulado y % de
   * utilizacion del almacen completo.
   */
  const almacenesResumen = useMemo<AlmacenSummary[]>(() => {
    const map = new Map<string, AlmacenSummary>()
    for (const c of capacities) {
      const key = c.bodegaId != null ? String(c.bodegaId) : "__sin_almacen__"
      if (!map.has(key)) {
        map.set(key, {
          key,
          id: c.bodegaId,
          nombre: c.bodegaNombre ?? "(Sin almacén)",
          capacidad: 0,
          stock: 0,
          utilizacion: 0,
          locations: 0,
        })
      }
      const s = map.get(key)!
      s.capacidad += c.capacidad
      s.stock += c.stockActual
      s.locations += 1
    }
    for (const s of map.values()) {
      s.utilizacion = s.capacidad > 0 ? (s.stock / s.capacidad) * 100 : 0
    }
    return Array.from(map.values()).sort((a, b) =>
      a.nombre.localeCompare(b.nombre),
    )
  }, [capacities])

  /**
   * Resumen agregado de TODOS los almacenes — alimenta la tarjeta-filtro
   * "Todos los almacenes" (siempre la primera de la fila).
   */
  const resumenTodos = useMemo<AlmacenSummary>(() => {
    let capacidad = 0
    let stock = 0
    for (const c of capacities) {
      capacidad += c.capacidad
      stock += c.stockActual
    }
    return {
      key: TODOS,
      id: null,
      nombre: "Todos los almacenes",
      capacidad,
      stock,
      utilizacion: capacidad > 0 ? (stock / capacidad) * 100 : 0,
      locations: capacities.length,
    }
  }, [capacities])

  /**
   * Localizaciones del ambito (almacen) seleccionado, ANTES de aplicar
   * el filtro de bucket. Sirve para calcular los KPIs de los 3
   * buckets (que deben reflejar el ambito completo, no el bucket).
   */
  const capacidadesAmbito = useMemo(() => {
    if (almacenSeleccionado === TODOS) return capacities
    if (almacenSeleccionado === "__sin_almacen__") {
      return capacities.filter((c) => c.bodegaId == null)
    }
    const idNum = Number(almacenSeleccionado)
    return capacities.filter((c) => c.bodegaId === idNum)
  }, [capacities, almacenSeleccionado])

  /**
   * Localizaciones visibles en la grilla de detalle: combina ambito
   * (almacen) + bucket. Si no hay bucket seleccionado se usan todas las
   * del ambito.
   */
  const capacidadesFiltradas = useMemo(() => {
    if (!bucketSeleccionado) return capacidadesAmbito
    return capacidadesAmbito.filter((c) => classify(c) === bucketSeleccionado)
  }, [capacidadesAmbito, bucketSeleccionado])

  /**
   * KPIs agregados sobre las localizaciones del AMBITO (no del bucket
   * filtrado): asi los conteos Llenas/Parciales/Vacias siempre suman al
   * total de localizaciones del ambito y no varian al hacer click en un
   * bucket.
   */
  const kpis = useMemo(() => {
    let capacidadTotal = 0
    let stockTotal = 0
    const buckets = {
      llena: { count: 0, capacidad: 0, stock: 0 },
      parcial: { count: 0, capacidad: 0, stock: 0 },
      vacia: { count: 0, capacidad: 0, stock: 0 },
    } as Record<Bucket, { count: number; capacidad: number; stock: number }>

    for (const c of capacidadesAmbito) {
      capacidadTotal += c.capacidad
      stockTotal += c.stockActual
      const b = classify(c)
      if (!b) continue
      buckets[b].count += 1
      buckets[b].capacidad += c.capacidad
      buckets[b].stock += c.stockActual
    }

    const utilizacion =
      capacidadTotal > 0 ? (stockTotal / capacidadTotal) * 100 : 0
    return {
      totalLocations: capacidadesAmbito.length,
      capacidadTotal,
      stockTotal,
      utilizacion,
      buckets,
    }
  }, [capacidadesAmbito])

  const tituloAmbito =
    almacenSeleccionado === TODOS
      ? "todos los almacenes"
      : almacenesResumen.find((a) => a.key === almacenSeleccionado)?.nombre ?? ""

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground text-sm">
          Cargando capacidades de bodega...
        </div>
      </div>
    )
  }

  if (capacities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <WarehouseIcon className="h-12 w-12 text-muted-foreground" />
        <div className="text-muted-foreground text-sm">
          No hay localizaciones configuradas
        </div>
      </div>
    )
  }

  /**
   * Toggle de bucket: click sobre la tarjeta ya seleccionada la
   * deselecciona (vuelve a "todas"); click sobre una distinta cambia el
   * filtro. Mantiene la UX de "una sola accion para cambiar/limpiar".
   */
  const toggleBucket = (b: Bucket) =>
    setBucketSeleccionado((prev) => (prev === b ? null : b))

  return (
    <div className="space-y-4">
      {/* ---- Header ---- */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-bold">Reporte de Capacidad de Bodega</h2>
          <p className="text-xs text-muted-foreground">
            Resumen de utilización para {tituloAmbito}
            {bucketSeleccionado
              ? ` · filtrado por ${bucketLabel(bucketSeleccionado)}`
              : ""}
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bucketSeleccionado && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs gap-1"
              onClick={() => setBucketSeleccionado(null)}
            >
              <X className="h-3.5 w-3.5" />
              Limpiar filtro
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-9 text-xs bg-transparent"
            onClick={loadCapacities}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Actualizar
          </Button>
        </div>
      </div>

      {/* ---- Fila de tarjetas-filtro de almacenes (con scroll horizontal) ---- */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Almacenes
          </span>
        </div>
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-3 min-w-max">
            <AlmacenFilterCard
              summary={resumenTodos}
              isSelected={almacenSeleccionado === TODOS}
              onClick={() => setAlmacenSeleccionado(TODOS)}
              isAggregate
            />
            {almacenesResumen.map((s) => (
              <AlmacenFilterCard
                key={s.key}
                summary={s}
                isSelected={almacenSeleccionado === s.key}
                onClick={() => setAlmacenSeleccionado(s.key)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ---- KPIs por bucket: CLICKEABLES y filtran la grilla.
              Se posicionan ARRIBA de la tarjeta "Capacidad total" para que
              los estados de alerta (lleno/parcial/vacio) sean lo primero
              que ve el usuario al entrar al modulo. Cada tarjeta tiene un
              fondo semantico (rojo/amarillo/verde) acorde a la severidad. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <BucketCard
          icon={<AlertTriangle className="h-4 w-4 text-red-700" />}
          titulo="Llenas"
          descripcion="≥ 100% de utilización"
          count={kpis.buckets.llena.count}
          capacidad={kpis.buckets.llena.capacidad}
          stock={kpis.buckets.llena.stock}
          tone="danger"
          isSelected={bucketSeleccionado === "llena"}
          onClick={() => toggleBucket("llena")}
        />
        <BucketCard
          icon={<PackageCheck className="h-4 w-4 text-yellow-700" />}
          titulo="Parcialmente llenas"
          descripcion="Entre 1% y 99%"
          count={kpis.buckets.parcial.count}
          capacidad={kpis.buckets.parcial.capacidad}
          stock={kpis.buckets.parcial.stock}
          tone="warning"
          isSelected={bucketSeleccionado === "parcial"}
          onClick={() => toggleBucket("parcial")}
        />
        <BucketCard
          icon={<PackageOpen className="h-4 w-4 text-green-700" />}
          titulo="Vacías"
          descripcion="0% de utilización"
          count={kpis.buckets.vacia.count}
          capacidad={kpis.buckets.vacia.capacidad}
          stock={kpis.buckets.vacia.stock}
          tone="success"
          isSelected={bucketSeleccionado === "vacia"}
          onClick={() => toggleBucket("vacia")}
        />
      </div>

      {/* ---- Tarjeta principal: % utilizacion total del ambito ---- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <WarehouseIcon className="h-4 w-4" />
            Capacidad total – {tituloAmbito}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">% de utilización</div>
              <div
                className={`text-4xl font-bold tabular-nums ${
                  kpis.utilizacion >= 100 ? "text-destructive" : "text-foreground"
                }`}
              >
                {kpis.utilizacion.toFixed(1)}%
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <span className="text-muted-foreground">Capacidad total</span>
              <span className="font-semibold tabular-nums text-right">
                {kpis.capacidadTotal.toLocaleString()}
              </span>
              <span className="text-muted-foreground">Stock actual</span>
              <span className="font-semibold tabular-nums text-right">
                {kpis.stockTotal.toLocaleString()}
              </span>
              <span className="text-muted-foreground">Localizaciones</span>
              <span className="font-semibold tabular-nums text-right">
                {kpis.totalLocations.toLocaleString()}
              </span>
            </div>
          </div>
          <Progress value={Math.min(kpis.utilizacion, 100)} className="h-3" />
        </CardContent>
      </Card>

      {/* ---- Detalle: grilla de localizaciones (existente, filtrada) ---- */}
      {capacidadesFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-muted-foreground">
            No hay localizaciones que cumplan los filtros seleccionados.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
          {capacidadesFiltradas.map((capacity) => {
            const isOverCapacity = capacity.porcentajeUtilizacion >= 100
            const isEmpty = capacity.porcentajeUtilizacion <= 0

            return (
              <Card
                key={capacity.codigo}
                className={isOverCapacity ? "border-destructive border-2" : ""}
              >
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="flex items-center justify-between text-sm font-semibold">
                    <span className="flex items-center gap-1.5">
                      <WarehouseIcon className="h-3.5 w-3.5" />
                      {capacity.codigo}
                    </span>
                    {isOverCapacity && (
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    )}
                    {isEmpty && !isOverCapacity && (
                      <PackageOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </CardTitle>
                  {capacity.bodegaNombre && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      {capacity.bodegaNombre}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-2.5 px-3 pb-3">
                  <div className="space-y-0.5">
                    <div className="text-xs text-muted-foreground">Capacidad</div>
                    <div className="text-xl font-bold tabular-nums">
                      {capacity.capacidad.toLocaleString()}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-xs text-muted-foreground">Stock Actual</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {capacity.stockActual.toLocaleString()}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Utilización</span>
                      <span
                        className={`font-bold tabular-nums ${
                          isOverCapacity ? "text-destructive" : "text-primary"
                        }`}
                      >
                        {capacity.porcentajeUtilizacion.toFixed(1)}%
                      </span>
                    </div>
                    <Progress
                      value={Math.min(capacity.porcentajeUtilizacion, 100)}
                      className="h-2"
                    />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Tarjeta-filtro de almacen (fila superior). Es un boton: la Card
// completa actua como zona clickeable y el `aria-pressed` comunica el
// estado seleccionado a tecnologias de asistencia.
// -----------------------------------------------------------------------------

function AlmacenFilterCard({
  summary,
  isSelected,
  onClick,
  isAggregate = false,
}: {
  summary: AlmacenSummary
  isSelected: boolean
  onClick: () => void
  isAggregate?: boolean
}) {
  // Borde acentuado cuando esta seleccionado para que el filtro activo
  // sea inmediatamente reconocible. Hover sutil para indicar
  // interactividad sin distraer.
  const baseClasses =
    "min-w-[200px] text-left transition-colors cursor-pointer hover:border-primary/60"
  const selectedClasses = isSelected
    ? "border-primary border-2 bg-primary/5"
    : "border-border"
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Card className={`${baseClasses} ${selectedClasses}`}>
        <CardHeader className="pb-1.5 pt-3 px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs font-semibold">
            {isAggregate ? (
              <Layers className="h-3.5 w-3.5" />
            ) : (
              <WarehouseIcon className="h-3.5 w-3.5" />
            )}
            <span className="truncate">{summary.nombre}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-1.5">
          <div className="flex items-baseline gap-1">
            <span
              className={`text-2xl font-bold tabular-nums ${
                summary.utilizacion >= 100 ? "text-destructive" : ""
              }`}
            >
              {summary.utilizacion.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">% util.</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
            <span className="text-muted-foreground">Capacidad</span>
            <span className="font-semibold tabular-nums text-right">
              {summary.capacidad.toLocaleString()}
            </span>
            <span className="text-muted-foreground">Stock</span>
            <span className="font-semibold tabular-nums text-right">
              {summary.stock.toLocaleString()}
            </span>
            <span className="text-muted-foreground">Locations</span>
            <span className="font-semibold tabular-nums text-right">
              {summary.locations.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  )
}

// -----------------------------------------------------------------------------
// Tarjeta KPI por bucket (Llenas / Parciales / Vacias). Ahora actua como
// boton-filtro (toggle): click selecciona, click nuevamente deselecciona.
// -----------------------------------------------------------------------------

function BucketCard({
  icon,
  titulo,
  descripcion,
  count,
  capacidad,
  stock,
  tone,
  isSelected,
  onClick,
}: {
  icon: React.ReactNode
  titulo: string
  descripcion: string
  count: number
  capacidad: number
  stock: number
  // "danger" -> rojo (Llenas), "warning" -> amarillo (Parcialmente
  // llenas), "success" -> verde (Vacias). Cada uno aplica un fondo
  // semantico de alerta para que el estado de la bodega sea legible
  // de un vistazo, incluso para usuarios con baja visibilidad de
  // texto.
  tone: "danger" | "warning" | "success"
  isSelected: boolean
  onClick: () => void
}) {
  // Estilos por tono: borde + fondo claros como base, mas oscuros
  // cuando la tarjeta esta seleccionada. El fondo se mantiene incluso
  // sin seleccion para reforzar la lectura semantica (rojo = alerta,
  // amarillo = atencion, verde = ok).
  const toneStyles = {
    danger: {
      base: "bg-red-50 border-red-300 hover:bg-red-100",
      selected: "bg-red-100 border-red-500 border-2",
      label: "text-red-900",
      count: "text-red-800",
      muted: "text-red-700/80",
    },
    warning: {
      base: "bg-yellow-50 border-yellow-300 hover:bg-yellow-100",
      selected: "bg-yellow-100 border-yellow-500 border-2",
      label: "text-yellow-900",
      count: "text-yellow-800",
      muted: "text-yellow-800/80",
    },
    success: {
      base: "bg-green-50 border-green-300 hover:bg-green-100",
      selected: "bg-green-100 border-green-600 border-2",
      label: "text-green-900",
      count: "text-green-800",
      muted: "text-green-800/80",
    },
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className="rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Card
        className={`transition-colors cursor-pointer ${
          isSelected ? toneStyles.selected : toneStyles.base
        }`}
      >
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle
            className={`flex items-center gap-2 text-sm font-semibold ${toneStyles.label}`}
          >
            {icon}
            {titulo}
          </CardTitle>
          <p className={`text-[10px] ${toneStyles.muted}`}>{descripcion}</p>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          <div className={`text-2xl font-bold tabular-nums ${toneStyles.count}`}>
            {count.toLocaleString()}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            <span className={toneStyles.muted}>Capacidad</span>
            <span
              className={`font-semibold tabular-nums text-right ${toneStyles.label}`}
            >
              {capacidad.toLocaleString()}
            </span>
            <span className={toneStyles.muted}>Stock</span>
            <span
              className={`font-semibold tabular-nums text-right ${toneStyles.label}`}
            >
              {stock.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  )
}

// Mapea el bucket interno a un texto legible para mostrar en el header.
function bucketLabel(b: Bucket): string {
  if (b === "llena") return "llenas"
  if (b === "vacia") return "vacías"
  return "parcialmente llenas"
}
