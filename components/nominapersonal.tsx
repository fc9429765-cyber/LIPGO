"use client"

import { useState, useEffect, useMemo, Fragment } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/components/auth-provider"
import { createClient } from "@/lib/supabase-client"
import { fetchAllRows } from "@/lib/fetch-all-rows"
import { getArchivoPlano } from "@/lib/archivo-plano-actions"
import { useToast } from "@/components/ui/use-toast"
import { Download, RefreshCw } from "lucide-react"
import { Search } from "lucide-react" // Declare the Search variable
import { ChevronDown, ChevronRight } from "lucide-react"

// Helper function to safely parse dates from database without timezone conversion issues
const parseDateFromDB = (dateString: string | null | undefined): Date | null => {
  if (!dateString) return null
  // Parse date strings in format "DD/MM/YYYY" or "YYYY-MM-DD"
  let parts: string[] = []
  let day: number, month: number, year: number
  
  if (dateString.includes("/")) {
    // Format: DD/MM/YYYY
    parts = dateString.split("/")
    day = parseInt(parts[0])
    month = parseInt(parts[1]) - 1 // Month is 0-indexed
    year = parseInt(parts[2])
  } else if (dateString.includes("-")) {
    // Format: YYYY-MM-DD
    parts = dateString.split("-")
    year = parseInt(parts[0])
    month = parseInt(parts[1]) - 1 // Month is 0-indexed
    day = parseInt(parts[2])
  } else {
    return null
  }
  
  // Use UTC to avoid timezone conversion issues
  return new Date(year, month, day)
}

// Helper function to safely display dates from database without timezone conversion
const formatDateFromDB = (dateString: string | null | undefined): string => {
  if (!dateString) return "-"
  // Simply return the date string as-is from database
  // This avoids timezone conversion issues
  return dateString.toString()
}

interface TotalAuxiliar {
  fechacargue: string
  persona: string
  total_toneladas_dia: number
  total_pago_dia: number
  total_operaciones_realizadas: number
}

interface DetalleAuxiliar {
  ordendecargue: string
  fechacargue: string
  tipooperacion: string
  nombre_auxiliar: string
  peso_total_operacion: number
  cantidad_auxiliares: number
  toneladas_auxiliar: number
  tarifa_aplicada: number
  pago_total: number
}

export default function Nominapersonal() {
  const { selectedEmpresaId } = useAuth()
  const { toast } = useToast()
  const [viewMode, setViewMode] = useState<"total" | "detalle" | "liquidacion" | "archivoplano" | "adelantos">("total")
  const [loading, setLoading] = useState(false)
  const [currentPageArchivoplanano, setCurrentPageArchivoplanano] = useState(1) // Declare the variable here
  // El archivo plano se lee desde el SERVIDOR: ver el comentario de
  // `loadArchivoplanano` — desde el navegador se caia por statement timeout.
  
  // Total view states
  const [totales, setTotales] = useState<TotalAuxiliar[]>([])
  const [filtroFechaInicio, setFiltroFechaInicio] = useState("")
  const [filtroFechaFin, setFiltroFechaFin] = useState("")
  const [filtroPersona, setFiltroPersona] = useState("")
  const [mesActualToneladas, setMesActualToneladas] = useState(0)
  const [mesActualPago, setMesActualPago] = useState(0)
  
  // Detalle view states
  const [detalles, setDetalles] = useState<DetalleAuxiliar[]>([])
  const [filtroFechaInicioDetalle, setFiltroFechaInicioDetalle] = useState("")
  const [filtroFechaFinDetalle, setFiltroFechaFinDetalle] = useState("")
  const [filtroOrdenCargue, setFiltroOrdenCargue] = useState("")
  const [filtroTipoOperacion, setFiltroTipoOperacion] = useState("")
  const [filtroNombreAuxiliar, setFiltroNombreAuxiliar] = useState("")

  // Liquidación view states
  const [liquidaciones, setLiquidaciones] = useState<any[]>([])
  const [filtroFechaInicioLiq, setFiltroFechaInicioLiq] = useState("")
  const [filtroFechaFinLiq, setFiltroFechaFinLiq] = useState("")
  const [filtroPersonaLiq, setFiltroPersonaLiq] = useState("")
  // 'YYYY-MM-DD' en hora local del navegador (el usuario está en Colombia).
  const fechaLocalISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  // Sub-tab dentro de "Ver Liquidacion":
  //  - "detalle": tabla existente fila a fila.
  //  - "consolidado": agrupa por dia con desglose de personas al expandir.
  //  - "resumen": tabla pivote por persona (toneladas, dias en cargue,
  //    turno, FNJ, total dias y total liquidado del periodo).
  const [liquidacionSubTab, setLiquidacionSubTab] = useState<
    "detalle" | "consolidado" | "resumen"
  >("detalle")
  // Dia expandido en la vista consolidada (string fecha 'YYYY-MM-DD' o
  // null si todos colapsados). Se permite UN unico dia abierto a la vez
  // para mantener la lectura limpia.
  const [diaExpandido, setDiaExpandido] = useState<string | null>(null)
  // NOTA: `totalLiquidadoDia` se calcula como valor derivado (useMemo
  // mas abajo) para que SIEMPRE refleje la suma de las filas que muestra
  // la tabla / exporta a Excel. Antes era state y se sobrescribia desde
  // `loadLiquidaciones` con el total CRUDO (sin filtros), provocando que
  // la tarjeta mostrara un valor distinto al de la tabla filtrada.

  // Pagination states
  const [currentPageTotal, setCurrentPageTotal] = useState(1)
  const [currentPageDetalle, setCurrentPageDetalle] = useState(1)
  const [currentPageLiquidacion, setCurrentPageLiquidacion] = useState(1)
  const ITEMS_PER_PAGE = 50

  // Archivo Plano view states.
  //
  // `filtroMes` arranca en el MES EN CURSO, no en "Todos": `archivoplano` se
  // construye sobre `pagonomina`, que recalcula un calendario persona×día
  // completo en cada consulta. Traer todo el histórico de una vez se pasa del
  // tiempo límite y la pestaña quedaba vacía con un aviso genérico.
  const [archivoplanos, setArchivoplanos] = useState<any[]>([])
  const [filtroMes, setFiltroMes] = useState(() =>
    String(
      Number(
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", month: "2-digit" }).format(
          new Date(),
        ),
      ),
    ),
  )
  const [filtroQuincena, setFiltroQuincena] = useState("")

  // Archivo Plano de Adelantos: MISMA fuente (`archivoplano`, vía
  // getArchivoPlano) que la pestaña de arriba -- nunca se reimplementa el
  // cálculo del anticipo aparte, para no arriesgarse a que este archivo
  // diga un valor distinto al que ya viaja a Siigo por el archivo plano
  // general. Solo se filtra a la novedad de anticipo y se consolida por
  // persona (un anticipado puede pedir más de uno en la misma quincena).
  // Filtros propios (no comparten estado con la pestaña "Archivo Plano")
  // para que cambiar de una a otra no se pise el período elegido.
  const [filtroMesAdelantos, setFiltroMesAdelantos] = useState(() =>
    String(
      Number(
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", month: "2-digit" }).format(
          new Date(),
        ),
      ),
    ),
  )
  const [filtroQuincenaAdelantos, setFiltroQuincenaAdelantos] = useState("")
  const [adelantosRaw, setAdelantosRaw] = useState<any[]>([])
  const [currentPageAdelantos, setCurrentPageAdelantos] = useState(1)
  const NOVEDAD_ANTICIPO = "56-Dcto. Anticipo de Nomina-Deducción"

  /**
   * Carga las liquidaciones aplicando el rango de fechas COMO FILTRO EN
   * LA BD (no client-side). Antes la funcion traia TODO el historico de
   * la empresa y el filtrado por fechas se hacia en memoria, lo que:
   *   1) penalizaba el primer render con datasets grandes
   *   2) hacia que el boton "Buscar" no tuviera efecto real porque ya
   *      tenia los datos cacheados
   *
   * Ahora cada click en "Buscar" reconsulta `pagonomina` desde cero con
   * `fecha` acotada por `.gte` / `.lte`. Tambien paginamos en bloques
   * de 1000 filas (el tope por defecto de PostgREST) para no perder
   * registros cuando el rango es amplio.
   *
   * Los parametros son opcionales para mantener compatibilidad con
   * llamadas existentes; cuando no se pasan se usa el state actual de
   * los inputs de fecha. Esto permite que el `useEffect` inicial
   * dispare la carga apenas el usuario entra en la pestana, y que el
   * boton "Buscar" simplemente reuse la misma funcion.
   */
  const loadLiquidaciones = async (
    fechaInicio: string = filtroFechaInicioLiq,
    fechaFin: string = filtroFechaFinLiq,
  ) => {
    if (!selectedEmpresaId) return
    setLoading(true)
    try {
      const supabase = await createClient()

      // Paginamos: PostgREST limita a 1000 filas por consulta por
      // defecto. Sin esto, rangos amplios (ej. todo un mes) podian
      // cortar los datos silenciosamente.
      let allData: any[] = []
      let offset = 0
      const pageSize = 1000
      let hasMore = true

      while (hasMore) {
        // NOTA: La pestana "Ver Liquidacion" filtra por `idempresaliquidacion`
        // (no por `idempresa`) a peticion del negocio. Ese campo identifica
        // a la empresa CONTRATANTE de la liquidacion, mientras que
        // `idempresa` corresponde a la empresa donde se registro la
        // operacion. Las demas pestanas siguen usando `idempresa`.
        // `pagonomina_rango` calcula la nómina SOLO para el rango pedido (misma
        // lógica que la vista `pagonomina`, verificada fila por fila). Si el
        // usuario deja una fecha vacía y da "Buscar", se respeta su intención de
        // ver todo hacia atrás / hasta hoy — igual que antes, solo que más lento.
        let query = supabase
          .rpc("pagonomina_rango", {
            p_desde: fechaInicio || "2000-01-01",
            p_hasta: fechaFin || fechaLocalISO(new Date()),
          })
          .select(
            "fecha, persona, actividad_registrada, novedad_reportada, toneladas, pago_produccion, base_dia, bonif_prestacional, bonif_no_prestacional, hed, hedf, hen, hef, hn, pago_domingo, recargodominical, total_liquidado_dia",
          )
          .eq("idempresaliquidacion", selectedEmpresaId)

        // Filtros de fecha aplicados a nivel de BD. Solo se anaden si
        // el usuario realmente eligio una fecha; ambos son opcionales
        // e independientes (puede acotar solo el inicio, solo el fin,
        // o ambos).
        if (fechaInicio) query = query.gte("fecha", fechaInicio)
        if (fechaFin) query = query.lte("fecha", fechaFin)

        // `persona` como desempate: orden único y estable para paginar sin
        // duplicar/perder filas en los cortes de página (ver
        // lib/liquidaciones-actions.ts). El orden visual sigue siendo por fecha.
        const { data: dataRaw, error } = await query
          .order("fecha", { ascending: false })
          .order("persona")
          .range(offset, offset + pageSize - 1)

        if (error) {
          console.error("[v0] Error loading liquidaciones:", error)
          toast({ title: "Error", description: "Error al cargar datos", variant: "destructive" })
          return
        }
        // `.rpc()` tipa el resultado como T | T[] porque no sabe que la función
        // devuelve un SET de filas; siempre es un arreglo.
        const data = (dataRaw ?? []) as any[]

        if (!data || data.length === 0) {
          hasMore = false
        } else {
          allData = [...allData, ...data]
          if (data.length < pageSize) {
            hasMore = false
          } else {
            offset += pageSize
          }
        }
      }

      setLiquidaciones(allData)
      // `totalLiquidadoDia` se deriva via useMemo desde
      // `liquidacionesFiltradas`, asi que NO se calcula aqui (antes este
      // bloque sumaba los datos CRUDOS y rompia el total filtrado).
    } catch (error) {
      console.error("[v0] Error:", error)
      toast({ title: "Error", description: "Error inesperado", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const loadTotales = async () => {
    if (!selectedEmpresaId) return
    setLoading(true)
    try {
      const supabase = await createClient()
      // PAGINADO: la vista tiene más de 1.000 filas por empresa (al 2026-09-27:
      // ID1 3.179, ID2 1.774, ID3 1.422, ID4 1.145) y Supabase corta en 1.000
      // sin avisar -- esta tabla mostraba solo los días más recientes. Orden
      // único (fecha, persona) para que las páginas no se solapen.
      let data: any[]
      try {
        data = await fetchAllRows((from, to) =>
          supabase
            .from("toneladasauxiliarespago")
            .select("*")
            .eq("idempresa", selectedEmpresaId)
            .order("fechacargue", { ascending: false })
            .order("persona")
            .range(from, to),
        )
      } catch (error) {
        console.error("Error loading totales:", error)
        toast({ title: "Error", description: "Error al cargar datos", variant: "destructive" })
        return
      }

      setTotales(data || [])
      
      // Calculate current month totals using safe date parsing
      const now = new Date()
      const currentMonth = now.getMonth()
      const currentYear = now.getFullYear()
      
      let totalTonMes = 0
      let totalPagoMes = 0
      
      data?.forEach((item: TotalAuxiliar) => {
        const itemDate = parseDateFromDB(item.fechacargue)
        if (itemDate && itemDate.getMonth() === currentMonth && itemDate.getFullYear() === currentYear) {
          totalTonMes += item.total_toneladas_dia || 0
          totalPagoMes += item.total_pago_dia || 0
        }
      })
      
      setMesActualToneladas(totalTonMes)
      setMesActualPago(totalPagoMes)
    } catch (error) {
      console.error("Error:", error)
      toast({ title: "Error", description: "Error inesperado", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const loadDetalles = async () => {
    if (!selectedEmpresaId) return
    setLoading(true)
    try {
      const supabase = await createClient()
      console.log("[v0] Nominapersonal: Starting loadDetalles for empresa:", selectedEmpresaId)
      
      let allData: any[] = []
      let offset = 0
      const pageSize = 1000
      let hasMore = true

      // Fetch all data using pagination with offset
      while (hasMore) {
        const { data, error } = await supabase
          .from("toneladasauxiliares")
          .select("*")
          .eq("idempresa", selectedEmpresaId)
          .order("fechacargue", { ascending: false })
          .range(offset, offset + pageSize - 1)

        if (error) {
          console.error("[v0] Error loading detalles:", error)
          toast({ title: "Error", description: "Error al cargar datos", variant: "destructive" })
          return
        }

        if (!data || data.length === 0) {
          hasMore = false
        } else {
          allData = [...allData, ...data]
          console.log("[v0] Nominapersonal: Loaded batch at offset", offset, "records count:", data.length, "total so far:", allData.length)
          
          if (data.length < pageSize) {
            hasMore = false
          } else {
            offset += pageSize
          }
        }
      }

      console.log("[v0] Nominapersonal: Total detalles loaded:", allData.length)
      setDetalles(allData)
    } catch (error) {
      console.error("[v0] Error:", error)
      toast({ title: "Error", description: "Error inesperado", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  /**
   * Carga el archivo plano DESDE EL SERVIDOR (lib/archivo-plano-actions.ts).
   *
   * Antes se consultaba `archivoplano` directo desde el navegador y fallaba
   * siempre con 57014 (statement timeout). La vista se construye sobre
   * `pagonomina` —calendario persona×día cruzado contra headcount, tarifas y
   * parámetros legales— y Supabase le da a los roles del navegador un tiempo
   * límite corto, del orden de 8 segundos, frente al margen mucho mayor del
   * rol de servicio. Por eso en el editor SQL de Supabase los datos SÍ se
   * veían: ese editor no consulta con el rol del navegador.
   *
   * Los otros SIETE módulos que leen `pagonomina` (revisión de nómina, cierre
   * financiero, parafiscales, liquidaciones, conciliación Avimol, análisis
   * financiero, cierre diario) ya lo hacían desde el servidor. Esta pestaña era
   * la excepción, y era la que fallaba.
   */
  const loadArchivoplanano = async (
    mes: string = filtroMes,
    quincena: string = filtroQuincena,
  ) => {
    if (!selectedEmpresaId) return
    setLoading(true)
    try {
      const r = await getArchivoPlano(selectedEmpresaId, mes, quincena)
      if (!r.success) {
        console.error("[v0] Error loading archivoplano —", r.message)
        setArchivoplanos([])
        toast({
          title: "No se pudo cargar el archivo plano",
          description: r.message || "Error al cargar datos",
          variant: "destructive",
        })
        return
      }
      console.log("[v0] Nominapersonal: Total archivoplano loaded:", r.data.length)
      setArchivoplanos(r.data)
    } catch (error: any) {
      console.error("[v0] Error:", error)
      toast({ title: "Error", description: error?.message || "Error inesperado", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  // Trae el mismo `archivoplano` (misma llamada que la pestaña de arriba) y
  // guarda SOLO las filas crudas de anticipo -- la consolidación por persona
  // se hace después, derivada (`adelantosPorPersona`), para que nunca quede
  // desincronizada de lo que realmente devolvió el servidor.
  const loadAdelantos = async (
    mes: string = filtroMesAdelantos,
    quincena: string = filtroQuincenaAdelantos,
  ) => {
    if (!selectedEmpresaId) return
    setLoading(true)
    try {
      const r = await getArchivoPlano(selectedEmpresaId, mes, quincena)
      if (!r.success) {
        setAdelantosRaw([])
        toast({
          title: "No se pudo cargar los adelantos",
          description: r.message || "Error al cargar datos",
          variant: "destructive",
        })
        return
      }
      setAdelantosRaw(r.data.filter((f: any) => f.nombrenovedad === NOVEDAD_ANTICIPO))
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Error inesperado", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const totalesFiltrados = totales.filter((item) => {
    const itemDate = parseDateFromDB(item.fechacargue)
    const matchFechaInicio = !filtroFechaInicio || !itemDate || itemDate >= parseDateFromDB(filtroFechaInicio)!
    
    // For end date, compare with the start of the next day (midnight)
    const matchFechaFin = !filtroFechaFin || (() => {
      const endDate = parseDateFromDB(filtroFechaFin)
      if (!endDate) return true
      endDate.setDate(endDate.getDate() + 1)
      return itemDate && itemDate < endDate
    })()
    
    const matchPersona = !filtroPersona || item.persona.toLowerCase().includes(filtroPersona.toLowerCase())
    return matchFechaInicio && matchFechaFin && matchPersona
  })

  // Calculate filtered monthly totals for Ver Total view
  const mesActualFiltradoToneladas = totalesFiltrados.reduce((sum, item) => {
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    const itemDate = parseDateFromDB(item.fechacargue)
    if (itemDate && itemDate.getMonth() === currentMonth && itemDate.getFullYear() === currentYear) {
      return sum + (item.total_toneladas_dia || 0)
    }
    return sum
  }, 0)

  const mesActualFiltradoPago = totalesFiltrados.reduce((sum, item) => {
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    const itemDate = parseDateFromDB(item.fechacargue)
    if (itemDate && itemDate.getMonth() === currentMonth && itemDate.getFullYear() === currentYear) {
      return sum + (item.total_pago_dia || 0)
    }
    return sum
  }, 0)

  const detallesFiltrados = detalles.filter((item) => {
    const itemDate = parseDateFromDB(item.fechacargue)
    const matchFechaInicio = !filtroFechaInicioDetalle || !itemDate || itemDate >= parseDateFromDB(filtroFechaInicioDetalle)!
    
    // For end date, compare with the start of the next day (midnight)
    const matchFechaFin = !filtroFechaFinDetalle || (() => {
      const endDate = parseDateFromDB(filtroFechaFinDetalle)
      if (!endDate) return true
      endDate.setDate(endDate.getDate() + 1)
      return itemDate && itemDate < endDate
    })()
    
    const matchOrden = !filtroOrdenCargue || item.ordendecargue.toLowerCase().includes(filtroOrdenCargue.toLowerCase())
    const matchTipo = !filtroTipoOperacion || item.tipooperacion.toLowerCase().includes(filtroTipoOperacion.toLowerCase())
    const matchAuxiliar = !filtroNombreAuxiliar || item.nombre_auxiliar.toLowerCase().includes(filtroNombreAuxiliar.toLowerCase())
    return matchFechaInicio && matchFechaFin && matchOrden && matchTipo && matchAuxiliar
  })

  const totalPagoFiltrado = detallesFiltrados.reduce((sum, item) => sum + (item.pago_total || 0), 0)

  // El rango de fechas ya viene aplicado a nivel BD desde
  // `loadLiquidaciones`, por eso aqui SOLO filtramos por persona (que
  // sigue siendo busqueda en memoria, sin reconsultar). Si el usuario
  // cambia las fechas sin darle "Buscar", la tabla no se recalcula
  // hasta el siguiente click — eso es intencional para que el boton
  // sea quien gobierna la consulta, tal como pidio el negocio.
  const liquidacionesFiltradas = liquidaciones.filter((item) => {
    const matchPersona =
      !filtroPersonaLiq || item.persona.toLowerCase().includes(filtroPersonaLiq.toLowerCase())
    return matchPersona
  })

  const exportToExcelTotal = () => {
    try {
      console.log("[v0] Nominapersonal: Starting export total")
      const headers = ["Fecha Cargue", "Persona", "Total Toneladas", "Total Pago", "Operaciones Realizadas"]
      const data = totalesFiltrados.map((item) => [
        item.fechacargue,
        item.persona,
        (item.total_toneladas_dia || 0).toFixed(2),
        (item.total_pago_dia || 0).toFixed(2),
        item.total_operaciones_realizadas || 0,
      ])

      const csv = [
        headers.join(","),
        ...data.map((row) => row.map((cell) => `"${cell}"`).join(",")),
      ].join("\n")

      console.log("[v0] Nominapersonal: CSV generated, length:", csv.length)

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      console.log("[v0] Nominapersonal: Blob created, size:", blob.size)

      const url = URL.createObjectURL(blob)
      console.log("[v0] Nominapersonal: Object URL created:", url)

      const link = document.createElement("a")
      link.setAttribute("href", url)
      link.setAttribute("download", `nominapersonal-total-${new Date().toISOString().split("T")[0]}.csv`)
      link.style.visibility = "hidden"
      document.body.appendChild(link)
      
      console.log("[v0] Nominapersonal: Clicking download link")
      link.click()
      
      // Wait for download to start before cleanup
      setTimeout(() => {
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        console.log("[v0] Nominapersonal: Export total completed")
      }, 100)
      toast({ title: "Éxito", description: "Archivo exportado correctamente" })
    } catch (error) {
      console.error("[v0] Nominapersonal: Export total error:", error)
      toast({ title: "Error", description: "Error al exportar archivo", variant: "destructive" })
    }
  }

  const exportToExcelDetalle = () => {
    try {
      console.log("[v0] Nominapersonal: Starting export detalle")
      const headers = ["Orden Cargue", "Fecha", "Tipo Operación", "Auxiliar", "Peso Operación", "Cant. Auxiliares", "Toneladas", "Tarifa", "Pago Total"]
      const data = detallesFiltrados.map((item) => [
        item.ordendecargue,
        item.fechacargue,
        item.tipooperacion,
        item.nombre_auxiliar,
        (item.peso_total_operacion || 0).toFixed(2),
        item.cantidad_auxiliares || 0,
        (item.toneladas_auxiliar || 0).toFixed(2),
        (item.tarifa_aplicada || 0).toFixed(2),
        (item.pago_total || 0).toFixed(2),
      ])

      const csv = [
        headers.join(","),
        ...data.map((row) => row.map((cell) => `"${cell}"`).join(",")),
      ].join("\n")

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.setAttribute("href", url)
      link.setAttribute("download", `nominapersonal-detalle-${new Date().toISOString().split("T")[0]}.csv`)
      link.style.visibility = "hidden"
      document.body.appendChild(link)
      link.click()
      
      setTimeout(() => {
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      }, 100)

      toast({ title: "Éxito", description: "Archivo exportado correctamente" })
    } catch (error) {
      console.error("[v0] Nominapersonal: Export detalle error:", error)
      toast({ title: "Error", description: "Error al exportar archivo", variant: "destructive" })
    }
  }

  const exportToExcelLiquidacion = async () => {
    const XLSX = await import("xlsx")
    try {
      const headers = [
        "Fecha",
        "Persona",
        "Actividad Registrada",
        "Novedad Reportada",
        "Toneladas",
        "Pago Producción",
        "Base Día",
        "Bonif. Prestacional",
        "Bonif. No Prestacional",
        "HED",
        "HEDF",
        "HEN",
        "HEF",
        "HN",
        "Pago Domingo",
        "Recargo Dominical",
        "Total Liquidado",
      ]
      // Mantenemos los numericos como `number` (no strings con toFixed)
      // para que Excel los reconozca como numero y aplique el formato
      // de celda `#,##0.00` declarado mas abajo. Si los pasaramos como
      // string el archivo abriria con celdas tipo texto y no se podrian
      // sumar ni filtrar numericamente.
      const data = liquidacionesFiltradas.map((item: any) => [
        item.fecha || "",
        item.persona || "",
        item.actividad_registrada || "",
        item.novedad_reportada || "",
        Number(item.toneladas || 0),
        Number(item.pago_produccion || 0),
        Number(item.base_dia || 0),
        Number(item.bonif_prestacional || 0),
        Number(item.bonif_no_prestacional || 0),
        Number(item.hed || 0),
        Number(item.hedf || 0),
        Number(item.hen || 0),
        Number(item.hef || 0),
        Number(item.hn || 0),
        Number(item.pago_domingo || 0),
        // La columna en la BD es `recargodominical` (sin underscore),
        // tal como se selecciona en la query y se renderiza en la tabla.
        // Antes leiamos `recargo_dominical` (con underscore), campo que
        // no existe en el objeto, asi que `undefined || 0` devolvia 0
        // siempre y la columna salia en cero en el Excel.
        Number(item.recargodominical || 0),
        Number(item.total_liquidado_dia || 0),
      ])

      const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Liquidación")

      // Columnas numericas (indice 0-based en la fila de datos):
      // 4..16 son todos los valores monetarios / horas / toneladas.
      const numericColumns = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
      for (let rowIndex = 1; rowIndex < data.length + 1; rowIndex++) {
        numericColumns.forEach((colIndex) => {
          const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
          if (ws[cellRef] && typeof ws[cellRef].v === "number") {
            ws[cellRef].z = "#,##0.00"
          }
        })
      }

      // Anchos sugeridos por columna (caracteres). Las primeras dos son
      // largas (fecha + nombre completo); las textuales medias y las
      // numericas mas estrechas.
      const colWidths = [12, 28, 22, 22, 12, 16, 14, 18, 20, 10, 10, 10, 10, 10, 14, 18, 16]
      ws["!cols"] = colWidths.map((wch) => ({ wch }))

      XLSX.writeFile(wb, `liquidacion-nomina-${new Date().toISOString().split("T")[0]}.xlsx`)

      toast({ title: "Éxito", description: "Archivo exportado correctamente" })
    } catch (error) {
      console.error("[v0] Nominapersonal: Export liquidacion error:", error)
      toast({ title: "Error", description: "Error al exportar archivo", variant: "destructive" })
    }
  }

  // Archivo Plano filtering
  const archivoplanosFiltrados = archivoplanos.filter((item) => {
    const matchMes = !filtroMes || parseInt(item.mes) === parseInt(filtroMes)
    const matchQuincena = !filtroQuincena || item.quincena === parseInt(filtroQuincena)
    return matchMes && matchQuincena
  })

  // Consolida los adelantos por persona: el pedido explícito es "el valor
  // TOTAL de anticipos aprobados en el período para el empleado", no una
  // fila por solicitud -- una persona puede pedir más de un anticipo en la
  // misma quincena y en `archivoplano` cada uno viaja en su propia fila.
  const adelantosPorPersona = useMemo(() => {
    const porCedula = new Map<
      string,
      { identificacion: string; nombre: string; contrato: string; total: number; cantidad: number }
    >()
    for (const f of adelantosRaw) {
      const ced = f.identificacionempleado || "(sin identificación)"
      const actual = porCedula.get(ced) || {
        identificacion: ced,
        nombre: f.nombreempleado || "",
        contrato: f.contratoempleado || "",
        total: 0,
        cantidad: 0,
      }
      actual.total += Number(f.cantidadvalor) || 0
      actual.cantidad += 1
      porCedula.set(ced, actual)
    }
    return Array.from(porCedula.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
  }, [adelantosRaw])

  const exportToExcelArchivoplanano = async () => {
    const XLSX = await import("xlsx")
    try {
      // ORDEN EXIGIDO POR SIIGO: el NOMBRE del empleado va inmediatamente
      // después de la cédula. Este array es el que manda en el archivo — el
      // orden de columnas de la vista `archivoplano` NO se vuelca aquí.
      const headers = ["Contrato", "Identificación", "Nombre", "Novedad", "Tipo Novedad", "Cantidad/Valor", "Fecha Inicio", "Fecha Fin", "Días No Hábiles"]

      // Create data array with proper numeric formatting
      const data = archivoplanosFiltrados.map((item) => [
        item.contratoempleado || "",
        item.identificacionempleado || "",
        item.nombreempleado || "",
        item.nombrenovedad || "",
        item.tiponovedad || "",
        item.cantidadvalor || "",
        item.fechainicio || "",
        item.fechafin || "",
        item.diasnohabiles || 0,
      ])

      // Create a new workbook
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Archivo Plano")

      // Formato por POSICIÓN de columna: si se agrega o mueve una columna en
      // `headers`, estos índices hay que correrlos o el formato cae en la
      // columna equivocada (se corrieron +1 al entrar "Nombre" en la 3ª).
      // Numéricas: 5 (Cantidad/Valor) y 8 (Días No Hábiles)
      const numericColumns = [5, 8]
      // Fechas: 6 (Fecha Inicio) y 7 (Fecha Fin)
      const dateColumns = [6, 7]
      
      for (let rowIndex = 1; rowIndex < data.length + 1; rowIndex++) {
        numericColumns.forEach((colIndex) => {
          const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
          if (ws[cellRef]) {
            const value = ws[cellRef].v
            if (typeof value === 'number') {
              // Format with thousand separators and comma as decimal
              ws[cellRef].z = '#,##0.00'
            }
          }
        })
        
        dateColumns.forEach((colIndex) => {
          const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
          if (ws[cellRef]) {
            const value = ws[cellRef].v
            // Format date fields with date format (DD/MM/YYYY)
            ws[cellRef].z = 'dd/mm/yyyy'
          }
        })
      }

      // Set column widths for better readability
      const colWidths = [15, 15, 32, 20, 15, 15, 15, 15, 15]  // el nombre necesita más ancho
      ws["!cols"] = colWidths.map(width => ({ wch: width }))

      // Generate the file
      XLSX.writeFile(wb, `archivo-plano-${new Date().toISOString().split("T")[0]}.xlsx`)

      toast({ title: "Éxito", description: "Archivo exportado correctamente" })
    } catch (error) {
      console.error("[v0] Nominapersonal: Export archivoplano error:", error)
      toast({ title: "Error", description: "Error al exportar archivo", variant: "destructive" })
    }
  }

  // Mismo layout de columnas que exportToExcelArchivoplanano (el que exige
  // Siigo) -- una fila por persona, con el valor ya consolidado.
  const exportToExcelAdelantos = async () => {
    const XLSX = await import("xlsx")
    try {
      const headers = ["Contrato", "Identificación", "Nombre", "Novedad", "Tipo Novedad", "Cantidad/Valor", "Fecha Inicio", "Fecha Fin", "Días No Hábiles"]

      const data = adelantosPorPersona.map((p) => [
        p.contrato,
        p.identificacion,
        p.nombre,
        NOVEDAD_ANTICIPO,
        "Valor",
        Math.round(p.total),
        "",
        "",
        0,
      ])

      const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Adelantos")

      const numericColumns = [5, 8]
      for (let rowIndex = 1; rowIndex < data.length + 1; rowIndex++) {
        numericColumns.forEach((colIndex) => {
          const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })
          if (ws[cellRef] && typeof ws[cellRef].v === "number") ws[cellRef].z = "#,##0.00"
        })
      }

      const colWidths = [15, 15, 32, 30, 15, 15, 15, 15, 15]
      ws["!cols"] = colWidths.map((width) => ({ wch: width }))

      XLSX.writeFile(wb, `archivo-plano-adelantos-${new Date().toISOString().split("T")[0]}.xlsx`)
      toast({ title: "Éxito", description: "Archivo de adelantos exportado correctamente" })
    } catch (error) {
      console.error("[v0] Nominapersonal: Export adelantos error:", error)
      toast({ title: "Error", description: "Error al exportar archivo", variant: "destructive" })
    }
  }

  // Pagination helper functions
  const getPaginatedData = (data: any[], currentPage: number) => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
    return data.slice(startIndex, startIndex + ITEMS_PER_PAGE)
  }

  const getTotalPages = (data: any[]) => {
    return Math.ceil(data.length / ITEMS_PER_PAGE)
  }

  useEffect(() => {
    if (selectedEmpresaId && viewMode === "total") {
      loadTotales()
    }
  }, [selectedEmpresaId, viewMode])

  useEffect(() => {
    if (selectedEmpresaId && viewMode === "detalle") {
      loadDetalles()
    }
  }, [selectedEmpresaId, viewMode])

  useEffect(() => {
    if (selectedEmpresaId && viewMode === "liquidacion") {
      // Primera carga: MES EN CURSO. Antes entraba sin fechas y traía TODA la
      // historia de la empresa (~40 consultas de 1.000 filas, la pantalla más
      // lenta del módulo) para una tarjeta que dice "Total liquidado del mes".
      // Las fechas quedan visibles en los filtros; el usuario las cambia y da
      // "Buscar" si necesita otro periodo.
      const hoy = fechaLocalISO(new Date())
      const ini = filtroFechaInicioLiq || `${hoy.slice(0, 7)}-01`
      const fin = filtroFechaFinLiq || hoy
      if (!filtroFechaInicioLiq) setFiltroFechaInicioLiq(ini)
      if (!filtroFechaFinLiq) setFiltroFechaFinLiq(fin)
      loadLiquidaciones(ini, fin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId, viewMode])

  // Los filtros de mes/quincena se aplican EN LA BASE, así que cambiarlos
  // reconsulta. Antes solo filtraban en memoria sobre un dataset que muchas
  // veces ni llegaba a cargar.
  useEffect(() => {
    if (selectedEmpresaId && viewMode === "adelantos") {
      loadAdelantos(filtroMesAdelantos, filtroQuincenaAdelantos)
    }
  }, [selectedEmpresaId, viewMode, filtroMesAdelantos, filtroQuincenaAdelantos])

  useEffect(() => {
    if (selectedEmpresaId && viewMode === "archivoplano") {
      loadArchivoplanano(filtroMes, filtroQuincena)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId, viewMode, filtroMes, filtroQuincena])

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPageArchivoplanano(1)
  }, [filtroMes, filtroQuincena])

  useEffect(() => {
    setCurrentPageDetalle(1)
  }, [filtroFechaInicioDetalle, filtroFechaFinDetalle, filtroOrdenCargue, filtroTipoOperacion, filtroNombreAuxiliar])

  // Reset de paginacion: solo cuando cambia el filtro EN MEMORIA
  // (persona). Los filtros de fecha ya disparan reconsulta via "Buscar"
  // y al setear nueva data el array cambia, por lo que la pagina se
  // resetea naturalmente cuando convenga.
  useEffect(() => {
    setCurrentPageLiquidacion(1)
  }, [filtroPersonaLiq, liquidaciones])

  // Total liquidado del mes: SIEMPRE coincide con la tabla/Excel porque
  // se deriva directamente del array filtrado. No usamos state + effect
  // (la version anterior tenia closures stales y se sobrescribia con la
  // suma cruda al darle "Buscar").
  const totalLiquidadoDia = useMemo(
    () =>
      liquidacionesFiltradas.reduce(
        (acc, item: any) => acc + (Number(item.total_liquidado_dia) || 0),
        0,
      ),
    [liquidacionesFiltradas],
  )

  // Bono de productividad = excedente de destajo NETO por (persona, quincena), piso 0
  // y todo prestacional. NO se suma al total diario (que cuadra bit a bit con la tabla
  // y el Excel); se muestra aparte para reflejar el PAGO REAL = base + bono, igual que
  // el archivo plano de Siigo y el modulo "Revision de nomina".
  const bonoProductividad = useMemo(() => {
    const bucket = new Map<string, number>()
    for (const item of liquidacionesFiltradas as any[]) {
      const f = String(item.fecha || "")
      if (f.length < 10) continue
      const q = Number(f.slice(8, 10)) <= 15 ? "Q1" : "Q2"
      const key = String(item.persona || "") + "|" + f.slice(0, 7) + q
      bucket.set(key, (bucket.get(key) || 0) + (Number(item.bonif_prestacional) || 0))
    }
    let bono = 0
    for (const v of bucket.values()) bono += Math.max(0, v)
    return bono
  }, [liquidacionesFiltradas])

  /**
   * Consolidado por dia para la sub-pestana "Consolidado por dia".
   *
   * - Agrupa las filas filtradas por `fecha`, sumando `total_liquidado_dia`.
   * - Acumula tambien por persona dentro de cada dia (una persona puede
   *   tener varias filas en el mismo dia: produccion + horas extra +
   *   recargos, etc.) para que el desglose muestre cada persona UNA
   *   sola vez con su total real del dia.
   * - El total del dia incluye TODAS las filas (asi la suma de la
   *   columna coincide bit a bit con la tarjeta "Total Liquidado del Mes"
   *   y con la pestana Detalle).
   * - El listado de personas por dia se filtra a > 0 (solo quienes
   *   estan generando liquidacion ese dia).
   * - Orden descendente por fecha para que el dia mas reciente quede
   *   arriba, igual que la tabla de detalle.
   */
  const consolidadoPorDia = useMemo(() => {
    const personaPorDia = new Map<string, Map<string, number>>()

    for (const item of liquidacionesFiltradas as any[]) {
      if (!item.fecha) continue
      const total = Number(item.total_liquidado_dia) || 0
      if (!personaPorDia.has(item.fecha)) {
        personaPorDia.set(item.fecha, new Map())
      }
      const inner = personaPorDia.get(item.fecha)!
      inner.set(item.persona, (inner.get(item.persona) || 0) + total)
    }

    const dias: Array<{
      fecha: string
      totalDia: number
      personas: Array<{ persona: string; total: number }>
    }> = []

    for (const [fecha, inner] of personaPorDia) {
      let totalDia = 0
      const personas: Array<{ persona: string; total: number }> = []
      for (const [persona, total] of inner) {
        totalDia += total
        if (total > 0) personas.push({ persona, total })
      }
      personas.sort((a, b) => b.total - a.total)
      dias.push({ fecha, totalDia, personas })
    }

    dias.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
    return dias
  }, [liquidacionesFiltradas])

  /**
   * Resumen por persona para la sub-pestana "Resumen por persona".
   *
   * Reglas (definidas por el negocio):
   *  - "Cargue":     dias unicos donde `actividad_registrada` es
   *                  "Cargue/Descargue" o "Auxiliar Mixto".
   *  - "Turno":      dias unicos donde `actividad_registrada` NO es
   *                  ninguno de los anteriores Y NO es "Sin Registro".
   *  - "FNJ":        dias unicos donde `novedad_reportada` es
   *                  "13- Incapacidad por enfermedad general al 100%".
   *  - "Total dias": dias unicos con cualquier `actividad_registrada`
   *                  distinta de "Sin Registro" (es decir, dias
   *                  efectivamente trabajados/registrados).
   *  - "Toneladas":  suma plana de `toneladas`.
   *  - "Total liq":  suma plana de `total_liquidado_dia`.
   *
   * Usamos `Set<string>` por categoria para garantizar UN dia unico por
   * persona/categoria aunque haya varias filas el mismo dia.
   * Ordenado descendente por total liquidado.
   */
  const resumenPorPersona = useMemo(() => {
    type Acc = {
      toneladas: number
      fechasCargue: Set<string>
      fechasTurno: Set<string>
      fechasFNJ: Set<string>
      fechasTotal: Set<string>
      totalLiquidado: number
    }
    const map = new Map<string, Acc>()

    for (const item of liquidacionesFiltradas as any[]) {
      const persona = item.persona ?? "(Sin nombre)"
      if (!map.has(persona)) {
        map.set(persona, {
          toneladas: 0,
          fechasCargue: new Set(),
          fechasTurno: new Set(),
          fechasFNJ: new Set(),
          fechasTotal: new Set(),
          totalLiquidado: 0,
        })
      }
      const r = map.get(persona)!

      r.toneladas += Number(item.toneladas) || 0
      r.totalLiquidado += Number(item.total_liquidado_dia) || 0

      const fecha: string | null | undefined = item.fecha
      const actividad = String(item.actividad_registrada ?? "").trim()
      const novedad = String(item.novedad_reportada ?? "").trim()

      if (fecha && actividad && actividad !== "Sin Registro") {
        r.fechasTotal.add(fecha)
        if (actividad === "Cargue/Descargue" || actividad === "Auxiliar Mixto") {
          r.fechasCargue.add(fecha)
        } else {
          r.fechasTurno.add(fecha)
        }
      }

      if (
        fecha &&
        novedad === "13- Incapacidad por enfermedad general al 100%"
      ) {
        r.fechasFNJ.add(fecha)
      }
    }

    const arr = Array.from(map.entries()).map(([persona, r]) => ({
      persona,
      toneladas: r.toneladas,
      cargue: r.fechasCargue.size,
      turno: r.fechasTurno.size,
      fnj: r.fechasFNJ.size,
      totalDias: r.fechasTotal.size,
      totalLiquidado: r.totalLiquidado,
    }))
    arr.sort((a, b) => b.totalLiquidado - a.totalLiquidado)
    return arr
  }, [liquidacionesFiltradas])

  /**
   * Totales generales del resumen (fila "Total general" del pivote).
   * Se calculan como la SUMA de columnas del resumen ya agregado,
   * asi cargue/turno/etc. corresponden a "personas-dia" totales del
   * periodo (no dias unicos globales) — coincide con lo que muestra la
   * imagen de referencia (142 + 82 = 224).
   */
  const resumenTotales = useMemo(() => {
    return resumenPorPersona.reduce(
      (acc, r) => ({
        toneladas: acc.toneladas + r.toneladas,
        cargue: acc.cargue + r.cargue,
        turno: acc.turno + r.turno,
        fnj: acc.fnj + r.fnj,
        totalDias: acc.totalDias + r.totalDias,
        totalLiquidado: acc.totalLiquidado + r.totalLiquidado,
      }),
      {
        toneladas: 0,
        cargue: 0,
        turno: 0,
        fnj: 0,
        totalDias: 0,
        totalLiquidado: 0,
      },
    )
  }, [resumenPorPersona])

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant={viewMode === "total" ? "default" : "outline"}
          onClick={() => setViewMode("total")}
        >
          Pago de Toneladas
        </Button>
        <Button
          variant={viewMode === "detalle" ? "default" : "outline"}
          onClick={() => setViewMode("detalle")}
        >
          Detalle Toneladas
        </Button>
        <Button
          variant={viewMode === "liquidacion" ? "default" : "outline"}
          onClick={() => setViewMode("liquidacion")}
        >
          Ver Liquidación
        </Button>
        <Button
          variant={viewMode === "archivoplano" ? "default" : "outline"}
          onClick={() => setViewMode("archivoplano")}
        >
          Archivo Plano
        </Button>
        <Button
          variant={viewMode === "adelantos" ? "default" : "outline"}
          onClick={() => setViewMode("adelantos")}
        >
          Archivo Plano Adelantos
        </Button>
      </div>

      {viewMode === "total" ? (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Toneladas del Mes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{mesActualFiltradoToneladas.toFixed(2)} Ton</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Pago del Mes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${mesActualFiltradoPago.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Fecha Inicio</Label>
              <DatePickerField
                value={filtroFechaInicio}
                onChange={setFiltroFechaInicio}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha Fin</Label>
              <DatePickerField
                value={filtroFechaFin}
                onChange={setFiltroFechaFin}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Persona</Label>
              <Input
                placeholder="Buscar persona..."
                value={filtroPersona}
                onChange={(e) => setFiltroPersona(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Search Button */}
          <div className="flex justify-end">
            <Button onClick={() => loadTotales()} size="sm" className="gap-2 h-8 text-xs">
              <Search className="h-4 w-4" />
              Buscar
            </Button>
          </div>

          {/* Export Button */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={exportToExcelTotal}
              className="text-xs h-8 gap-2 bg-transparent"
            >
              <Download className="h-4 w-4" />
              Exportar a Excel
            </Button>
          </div>

          {/* Table with Scrollable Content */}
          <Card>
            <CardContent className="pt-4">
              <div className="border rounded-lg">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white">
                      <TableRow>
                        <TableHead className="text-xs">Fecha Cargue</TableHead>
                        <TableHead className="text-xs">Persona</TableHead>
                        <TableHead className="text-xs text-right">Total Toneladas</TableHead>
                        <TableHead className="text-xs text-right">Total Pago</TableHead>
                        <TableHead className="text-xs text-right">Operaciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs">
                            Cargando...
                          </TableCell>
                        </TableRow>
                      ) : totalesFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs">
                            No hay registros
                          </TableCell>
                        </TableRow>
                      ) : (
                        getPaginatedData(totalesFiltrados, currentPageTotal).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs">{formatDateFromDB(item.fechacargue)}</TableCell>
                            <TableCell className="text-xs">{item.persona}</TableCell>
                            <TableCell className="text-xs text-right">{(item.total_toneladas_dia || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.total_pago_dia || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">{item.total_operaciones_realizadas || 0}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Pagination Controls */}
              {getTotalPages(totalesFiltrados) > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageTotal(Math.max(1, currentPageTotal - 1))}
                    disabled={currentPageTotal === 1}
                    className="h-8 text-xs"
                  >
                    Anterior
                  </Button>
                  <span className="flex items-center text-xs px-2">
                    Página {currentPageTotal} de {getTotalPages(totalesFiltrados)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageTotal(Math.min(getTotalPages(totalesFiltrados), currentPageTotal + 1))}
                    disabled={currentPageTotal === getTotalPages(totalesFiltrados)}
                    className="h-8 text-xs"
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : viewMode === "detalle" ? (
        <div className="space-y-4">
          {/* Total Pago Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Total Pago Filtrado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${totalPagoFiltrado.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </CardContent>
          </Card>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Fecha Inicio</Label>
              <DatePickerField
                value={filtroFechaInicioDetalle}
                onChange={setFiltroFechaInicioDetalle}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha Fin</Label>
              <DatePickerField
                value={filtroFechaFinDetalle}
                onChange={setFiltroFechaFinDetalle}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Orden Cargue</Label>
              <Input
                placeholder="Buscar orden..."
                value={filtroOrdenCargue}
                onChange={(e) => setFiltroOrdenCargue(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo Operación</Label>
              <Input
                placeholder="Buscar tipo..."
                value={filtroTipoOperacion}
                onChange={(e) => setFiltroTipoOperacion(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Auxiliar</Label>
              <Input
                placeholder="Buscar auxiliar..."
                value={filtroNombreAuxiliar}
                onChange={(e) => setFiltroNombreAuxiliar(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Search Button */}
          <div className="flex justify-end">
            <Button onClick={() => loadDetalles()} size="sm" className="gap-2 h-8 text-xs">
              <Search className="h-4 w-4" />
              Buscar
            </Button>
          </div>

          {/* Export Button */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={exportToExcelDetalle}
              className="text-xs h-8 gap-2 bg-transparent"
            >
              <Download className="h-4 w-4" />
              Exportar a Excel
            </Button>
          </div>

          {/* Table with Scrollable Content */}
          <Card>
            <CardContent className="pt-4">
              <div className="border rounded-lg">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white">
                      <TableRow>
                        <TableHead className="text-xs">Orden Cargue</TableHead>
                        <TableHead className="text-xs">Fecha</TableHead>
                        <TableHead className="text-xs">Tipo Operación</TableHead>
                        <TableHead className="text-xs">Auxiliar</TableHead>
                        <TableHead className="text-xs text-right">Peso Operación</TableHead>
                        <TableHead className="text-xs text-right">Cant. Auxiliares</TableHead>
                        <TableHead className="text-xs text-right">Toneladas</TableHead>
                        <TableHead className="text-xs text-right">Tarifa</TableHead>
                        <TableHead className="text-xs text-right">Pago Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-xs">
                            Cargando...
                          </TableCell>
                        </TableRow>
                      ) : detallesFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-xs">
                            No hay registros
                          </TableCell>
                        </TableRow>
                      ) : (
                        getPaginatedData(detallesFiltrados, currentPageDetalle).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs">{item.ordendecargue}</TableCell>
                            <TableCell className="text-xs">{formatDateFromDB(item.fechacargue)}</TableCell>
                            <TableCell className="text-xs">{item.tipooperacion}</TableCell>
                            <TableCell className="text-xs">{item.nombre_auxiliar}</TableCell>
                            <TableCell className="text-xs text-right">{(item.peso_total_operacion || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">{item.cantidad_auxiliares || 0}</TableCell>
                            <TableCell className="text-xs text-right">{(item.toneladas_auxiliar || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.tarifa_aplicada || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.pago_total || 0).toFixed(2)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Pagination Controls */}
              {getTotalPages(detallesFiltrados) > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageDetalle(Math.max(1, currentPageDetalle - 1))}
                    disabled={currentPageDetalle === 1}
                    className="h-8 text-xs"
                  >
                    Anterior
                  </Button>
                  <span className="flex items-center text-xs px-2">
                    Página {currentPageDetalle} de {getTotalPages(detallesFiltrados)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageDetalle(Math.min(getTotalPages(detallesFiltrados), currentPageDetalle + 1))}
                    disabled={currentPageDetalle === getTotalPages(detallesFiltrados)}
                    className="h-8 text-xs"
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : viewMode === "liquidacion" ? (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Base liquidada del mes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${totalLiquidadoDia.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <p className="text-xs text-muted-foreground">Base por día trabajado (coincide con la tabla detalle)</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Bono productividad (neto quincena)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  ${bonoProductividad.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className="text-xs text-muted-foreground">Excedente de destajo neteado por quincena (todo prestacional)</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Pago real (base + bono)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${(totalLiquidadoDia + bonoProductividad).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <p className="text-xs text-muted-foreground">Lo que va a Siigo = base garantizada + bono de toneladas</p>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Fecha Inicio</Label>
              <DatePickerField
                value={filtroFechaInicioLiq}
                onChange={setFiltroFechaInicioLiq}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha Fin</Label>
              <DatePickerField
                value={filtroFechaFinLiq}
                onChange={setFiltroFechaFinLiq}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Persona</Label>
              <Input
                placeholder="Buscar persona..."
                value={filtroPersonaLiq}
                onChange={(e) => setFiltroPersonaLiq(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Search Button. Cada click reconsulta `pagonomina` desde
              cero aplicando el rango de fechas a nivel BD, no solo
              filtrando datos cacheados. */}
          <div className="flex justify-end">
            <Button
              onClick={() => loadLiquidaciones(filtroFechaInicioLiq, filtroFechaFinLiq)}
              size="sm"
              className="gap-2 h-8 text-xs"
              disabled={loading}
            >
              <Search className="h-4 w-4" />
              {loading ? "Buscando..." : "Buscar"}
            </Button>
          </div>

          {/* Sub-tabs: Detalle vs Consolidado por dia. Las tarjetas
              superiores y los filtros se comparten entre ambas vistas; lo
              unico que cambia es el contenido de la tabla. */}
          <div className="flex gap-2 border-b">
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 text-xs rounded-none border-b-2 ${
                liquidacionSubTab === "detalle"
                  ? "border-primary text-foreground font-semibold"
                  : "border-transparent text-muted-foreground"
              }`}
              onClick={() => setLiquidacionSubTab("detalle")}
            >
              Detalle
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 text-xs rounded-none border-b-2 ${
                liquidacionSubTab === "consolidado"
                  ? "border-primary text-foreground font-semibold"
                  : "border-transparent text-muted-foreground"
              }`}
              onClick={() => setLiquidacionSubTab("consolidado")}
            >
              Consolidado por día
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 text-xs rounded-none border-b-2 ${
                liquidacionSubTab === "resumen"
                  ? "border-primary text-foreground font-semibold"
                  : "border-transparent text-muted-foreground"
              }`}
              onClick={() => setLiquidacionSubTab("resumen")}
            >
              Resumen por persona
            </Button>
          </div>

          {liquidacionSubTab === "detalle" ? (
          // Rama 1: Detalle fila a fila (vista historica original)
          <>
          {/* Export Button */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={exportToExcelLiquidacion}
              className="text-xs h-8 gap-2 bg-transparent"
            >
              <Download className="h-4 w-4" />
              Exportar a Excel
            </Button>
          </div>

          {/* Table with Scrollable Content */}
          <Card>
            <CardContent className="pt-4">
              <div className="border rounded-lg">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white">
                      <TableRow>
                        <TableHead className="text-xs">Fecha</TableHead>
                        <TableHead className="text-xs">Persona</TableHead>
                        <TableHead className="text-xs">Actividad Registrada</TableHead>
                        <TableHead className="text-xs">Novedad Reportada</TableHead>
                        <TableHead className="text-xs text-right">Toneladas</TableHead>
                        <TableHead className="text-xs text-right">Pago Producción</TableHead>
                        <TableHead className="text-xs text-right">Base Día</TableHead>
                        <TableHead className="text-xs text-right">Bonif. Prestacional</TableHead>
                        <TableHead className="text-xs text-right">Bonif. No Prestacional</TableHead>
                        <TableHead className="text-xs text-right">HED</TableHead>
                        <TableHead className="text-xs text-right">HEDF</TableHead>
                        <TableHead className="text-xs text-right">HEN</TableHead>
                        <TableHead className="text-xs text-right">HEF</TableHead>
                        <TableHead className="text-xs text-right">HN</TableHead>
                        <TableHead className="text-xs text-right">Pago Domingo</TableHead>
                        <TableHead className="text-xs text-right">Recargo Dominical</TableHead>
                        <TableHead className="text-xs text-right">Total Liquidado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={17} className="text-center text-xs">
                            Cargando...
                          </TableCell>
                        </TableRow>
                      ) : liquidacionesFiltradas.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={17} className="text-center text-xs">
                            No hay registros
                          </TableCell>
                        </TableRow>
                      ) : (
                        getPaginatedData(liquidacionesFiltradas, currentPageLiquidacion).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs">{formatDateFromDB(item.fecha)}</TableCell>
                            <TableCell className="text-xs">{item.persona}</TableCell>
                            <TableCell className="text-xs">{item.actividad_registrada || "-"}</TableCell>
                            <TableCell className="text-xs">{item.novedad_reportada || "-"}</TableCell>
                            <TableCell className="text-xs text-right">{(item.toneladas || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.pago_produccion || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.base_dia || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.bonif_prestacional || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.bonif_no_prestacional || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.hed || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.hedf || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.hen || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.hef || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.hn || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.pago_domingo || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">${(item.recargodominical || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right font-bold">${(item.total_liquidado_dia || 0).toFixed(2)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Pagination Controls */}
              {getTotalPages(liquidacionesFiltradas) > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageLiquidacion(Math.max(1, currentPageLiquidacion - 1))}
                    disabled={currentPageLiquidacion === 1}
                    className="h-8 text-xs"
                  >
                    Anterior
                  </Button>
                  <span className="flex items-center text-xs px-2">
                    Página {currentPageLiquidacion} de {getTotalPages(liquidacionesFiltradas)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageLiquidacion(Math.min(getTotalPages(liquidacionesFiltradas), currentPageLiquidacion + 1))}
                    disabled={currentPageLiquidacion === getTotalPages(liquidacionesFiltradas)}
                    className="h-8 text-xs"
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          </>
          ) : liquidacionSubTab === "consolidado" ? (
          // Rama 2: Consolidado por dia (con expansion de personas)
          <>
            {/* Sub-pestana "Consolidado por dia": agrupa la informacion
                por fecha. Cada fila es un dia con su total y un boton
                para expandir/colapsar el desglose por persona (solo
                personas con liquidacion > 0, segun requisito). */}
            <Card>
              <CardContent className="pt-4">
                <div className="border rounded-lg">
                  <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white z-10">
                        <TableRow>
                          <TableHead className="text-xs w-10"></TableHead>
                          <TableHead className="text-xs">Fecha</TableHead>
                          <TableHead className="text-xs text-right">
                            # Personas con liquidación
                          </TableHead>
                          <TableHead className="text-xs text-right">
                            Total Liquidado del Día
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loading ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-xs">
                              Cargando...
                            </TableCell>
                          </TableRow>
                        ) : consolidadoPorDia.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-xs">
                              No hay registros
                            </TableCell>
                          </TableRow>
                        ) : (
                          consolidadoPorDia.map((dia) => {
                            const isOpen = diaExpandido === dia.fecha
                            return (
                              <Fragment key={dia.fecha}>
                                <TableRow
                                  className="cursor-pointer hover:bg-muted/50"
                                  onClick={() =>
                                    setDiaExpandido(isOpen ? null : dia.fecha)
                                  }
                                >
                                  <TableCell className="text-xs">
                                    {isOpen ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs font-medium">
                                    {formatDateFromDB(dia.fecha)}
                                  </TableCell>
                                  <TableCell className="text-xs text-right">
                                    {dia.personas.length}
                                  </TableCell>
                                  <TableCell className="text-xs text-right font-bold">
                                    ${dia.totalDia.toLocaleString("es-CO", {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </TableCell>
                                </TableRow>
                                {isOpen && (
                                  <TableRow>
                                    <TableCell
                                      colSpan={4}
                                      className="bg-muted/30 p-0"
                                    >
                                      <div className="px-4 py-3 space-y-2">
                                        <div className="text-xs font-semibold text-muted-foreground">
                                          Personas con liquidación &gt; 0 (
                                          {dia.personas.length})
                                        </div>
                                        {dia.personas.length === 0 ? (
                                          <div className="text-xs text-muted-foreground py-2">
                                            Ningún registro con liquidación
                                            mayor a 0 este día.
                                          </div>
                                        ) : (
                                          <div className="border rounded-md bg-background">
                                            <Table>
                                              <TableHeader>
                                                <TableRow>
                                                  <TableHead className="text-xs">
                                                    Persona
                                                  </TableHead>
                                                  <TableHead className="text-xs text-right">
                                                    Total Liquidado
                                                  </TableHead>
                                                </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                {dia.personas.map((p) => (
                                                  <TableRow key={p.persona}>
                                                    <TableCell className="text-xs">
                                                      {p.persona}
                                                    </TableCell>
                                                    <TableCell className="text-xs text-right font-medium">
                                                      ${p.total.toLocaleString(
                                                        "es-CO",
                                                        {
                                                          minimumFractionDigits: 2,
                                                          maximumFractionDigits: 2,
                                                        },
                                                      )}
                                                    </TableCell>
                                                  </TableRow>
                                                ))}
                                              </TableBody>
                                            </Table>
                                          </div>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                              </Fragment>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
          ) : (
          // Rama 3: Resumen por persona (pivote del periodo).
          <>
            <Card>
              <CardContent className="pt-4">
                <div className="border rounded-lg">
                  <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white z-10">
                        <TableRow>
                          <TableHead className="text-xs">Persona</TableHead>
                          <TableHead className="text-xs text-right">
                            Toneladas
                          </TableHead>
                          <TableHead className="text-xs text-right">
                            Cargue
                          </TableHead>
                          <TableHead className="text-xs text-right">
                            Turno
                          </TableHead>
                          <TableHead className="text-xs text-right">
                            FNJ
                          </TableHead>
                          <TableHead className="text-xs text-right">
                            Total Días
                          </TableHead>
                          <TableHead className="text-xs text-right">
                            Suma de Total Liquidado
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loading ? (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="text-center text-xs"
                            >
                              Cargando...
                            </TableCell>
                          </TableRow>
                        ) : resumenPorPersona.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={7}
                              className="text-center text-xs"
                            >
                              No hay registros
                            </TableCell>
                          </TableRow>
                        ) : (
                          <>
                            {resumenPorPersona.map((r) => (
                              <TableRow key={r.persona}>
                                <TableCell className="text-xs font-medium">
                                  {r.persona}
                                </TableCell>
                                <TableCell className="text-xs text-right">
                                  {r.toneladas.toLocaleString("es-CO", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </TableCell>
                                <TableCell className="text-xs text-right">
                                  {r.cargue}
                                </TableCell>
                                <TableCell className="text-xs text-right">
                                  {r.turno}
                                </TableCell>
                                <TableCell className="text-xs text-right">
                                  {r.fnj}
                                </TableCell>
                                <TableCell className="text-xs text-right">
                                  {r.totalDias}
                                </TableCell>
                                <TableCell className="text-xs text-right font-semibold">
                                  ${r.totalLiquidado.toLocaleString(
                                    "es-CO",
                                    {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    },
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                            {/* Fila Total general (footer pivote) */}
                            <TableRow className="bg-muted/50 border-t-2">
                              <TableCell className="text-xs font-bold">
                                Total general
                              </TableCell>
                              <TableCell className="text-xs text-right font-bold">
                                {resumenTotales.toneladas.toLocaleString(
                                  "es-CO",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  },
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-right font-bold">
                                {resumenTotales.cargue}
                              </TableCell>
                              <TableCell className="text-xs text-right font-bold">
                                {resumenTotales.turno}
                              </TableCell>
                              <TableCell className="text-xs text-right font-bold">
                                {resumenTotales.fnj}
                              </TableCell>
                              <TableCell className="text-xs text-right font-bold">
                                {resumenTotales.totalDias}
                              </TableCell>
                              <TableCell className="text-xs text-right font-bold">
                                ${resumenTotales.totalLiquidado.toLocaleString(
                                  "es-CO",
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  },
                                )}
                              </TableCell>
                            </TableRow>
                          </>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
          )}
        </div>
      ) : viewMode === "archivoplano" ? (
        <div className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Filtros</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Mes</Label>
                  <select
                    value={filtroMes}
                    onChange={(e) => setFiltroMes(e.target.value)}
                    className="w-full h-8 text-xs border rounded px-2"
                  >
                    <option value="">Todos</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((mes) => (
                      <option key={mes} value={mes}>
                        {mes}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Quincena</Label>
                  <select
                    value={filtroQuincena}
                    onChange={(e) => setFiltroQuincena(e.target.value)}
                    className="w-full h-8 text-xs border rounded px-2"
                  >
                    <option value="">Todas</option>
                    <option value="1">Primera (1-15)</option>
                    <option value="2">Segunda (16-30/31)</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actualizar + Export */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              // Se envuelve para no pasarle el evento del click como `mes`.
              onClick={() => loadArchivoplanano(filtroMes, filtroQuincena)}
              disabled={loading}
              className="text-xs h-8 gap-2 bg-transparent"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportToExcelArchivoplanano}
              className="text-xs h-8 gap-2 bg-transparent"
            >
              <Download className="h-4 w-4" />
              Exportar a Excel
            </Button>
          </div>

          {/* Table with Scrollable Content */}
          <Card>
            <CardContent className="pt-4">
              <div className="border rounded-lg">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white">
                      <TableRow>
                        <TableHead className="text-xs">Contrato</TableHead>
                        <TableHead className="text-xs">Identificación</TableHead>
                        <TableHead className="text-xs">Nombre</TableHead>
                        <TableHead className="text-xs">Novedad</TableHead>
                        <TableHead className="text-xs">Tipo Novedad</TableHead>
                        <TableHead className="text-xs">Cantidad/Valor</TableHead>
                        <TableHead className="text-xs">Fecha Inicio</TableHead>
                        <TableHead className="text-xs">Fecha Fin</TableHead>
                        <TableHead className="text-xs text-center">Días No Hábiles</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-xs">
                            Cargando...
                          </TableCell>
                        </TableRow>
                      ) : archivoplanosFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-xs">
                            No hay registros
                          </TableCell>
                        </TableRow>
                      ) : (
                        getPaginatedData(archivoplanosFiltrados, currentPageArchivoplanano).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs">{item.contratoempleado || "-"}</TableCell>
                            <TableCell className="text-xs">{item.identificacionempleado || "-"}</TableCell>
                            <TableCell className="text-xs">{item.nombreempleado || "-"}</TableCell>
                            <TableCell className="text-xs">{item.nombrenovedad || "-"}</TableCell>
                            <TableCell className="text-xs">{item.tiponovedad || "-"}</TableCell>
                            <TableCell className="text-xs">{item.cantidadvalor || "-"}</TableCell>
                            <TableCell className="text-xs">{item.fechainicio || "-"}</TableCell>
                            <TableCell className="text-xs">{item.fechafin || "-"}</TableCell>
                            <TableCell className="text-xs text-center">{item.diasnohabiles || 0}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Pagination Controls */}
              {getTotalPages(archivoplanosFiltrados) > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageArchivoplanano(Math.max(1, currentPageArchivoplanano - 1))}
                    disabled={currentPageArchivoplanano === 1}
                    className="h-8 text-xs"
                  >
                    Anterior
                  </Button>
                  <span className="flex items-center text-xs px-2">
                    Página {currentPageArchivoplanano} de {getTotalPages(archivoplanosFiltrados)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageArchivoplanano(Math.min(getTotalPages(archivoplanosFiltrados), currentPageArchivoplanano + 1))}
                    disabled={currentPageArchivoplanano === getTotalPages(archivoplanosFiltrados)}
                    className="h-8 text-xs"
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : viewMode === "adelantos" ? (
        <div className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Filtros</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Mes</Label>
                  <select
                    value={filtroMesAdelantos}
                    onChange={(e) => setFiltroMesAdelantos(e.target.value)}
                    className="w-full h-8 text-xs border rounded px-2"
                  >
                    <option value="">Todos</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((mes) => (
                      <option key={mes} value={mes}>
                        {mes}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Quincena</Label>
                  <select
                    value={filtroQuincenaAdelantos}
                    onChange={(e) => setFiltroQuincenaAdelantos(e.target.value)}
                    className="w-full h-8 text-xs border rounded px-2"
                  >
                    <option value="">Todas</option>
                    <option value="1">Primera (1-15)</option>
                    <option value="2">Segunda (16-30/31)</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                El período se aplica sobre la fecha en que se APROBÓ el anticipo, no sobre la fecha en que se pidió --
                mismo criterio que usa el archivo plano general para decidir a qué quincena pertenece.
              </p>
            </CardContent>
          </Card>

          {/* Actualizar + Export */}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadAdelantos(filtroMesAdelantos, filtroQuincenaAdelantos)}
              disabled={loading}
              className="text-xs h-8 gap-2 bg-transparent"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportToExcelAdelantos}
              disabled={adelantosPorPersona.length === 0}
              className="text-xs h-8 gap-2 bg-transparent"
            >
              <Download className="h-4 w-4" />
              Exportar a Excel
            </Button>
          </div>

          {/* Table with Scrollable Content */}
          <Card>
            <CardContent className="pt-4">
              <div className="border rounded-lg">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white">
                      <TableRow>
                        <TableHead className="text-xs">Contrato</TableHead>
                        <TableHead className="text-xs">Identificación</TableHead>
                        <TableHead className="text-xs">Nombre</TableHead>
                        <TableHead className="text-xs text-center"># Anticipos</TableHead>
                        <TableHead className="text-xs text-right">Valor Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs">
                            Cargando...
                          </TableCell>
                        </TableRow>
                      ) : adelantosPorPersona.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs">
                            No hay anticipos aprobados en este período
                          </TableCell>
                        </TableRow>
                      ) : (
                        getPaginatedData(adelantosPorPersona, currentPageAdelantos).map((p, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs">{p.contrato || "-"}</TableCell>
                            <TableCell className="text-xs">{p.identificacion || "-"}</TableCell>
                            <TableCell className="text-xs">{p.nombre || "-"}</TableCell>
                            <TableCell className="text-xs text-center">{p.cantidad}</TableCell>
                            <TableCell className="text-xs text-right">
                              {p.total.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                    {adelantosPorPersona.length > 0 && (
                      <tfoot>
                        <TableRow>
                          <TableCell colSpan={4} className="text-xs font-semibold text-right">
                            Total
                          </TableCell>
                          <TableCell className="text-xs font-semibold text-right">
                            {adelantosPorPersona
                              .reduce((s, p) => s + p.total, 0)
                              .toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}
                          </TableCell>
                        </TableRow>
                      </tfoot>
                    )}
                  </Table>
                </div>
              </div>

              {/* Pagination Controls */}
              {getTotalPages(adelantosPorPersona) > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageAdelantos(Math.max(1, currentPageAdelantos - 1))}
                    disabled={currentPageAdelantos === 1}
                    className="h-8 text-xs"
                  >
                    Anterior
                  </Button>
                  <span className="flex items-center text-xs px-2">
                    Página {currentPageAdelantos} de {getTotalPages(adelantosPorPersona)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPageAdelantos(Math.min(getTotalPages(adelantosPorPersona), currentPageAdelantos + 1))}
                    disabled={currentPageAdelantos === getTotalPages(adelantosPorPersona)}
                    className="h-8 text-xs"
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
