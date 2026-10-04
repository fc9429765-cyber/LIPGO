"use client"

/* ============================================================================
 *  DashboardGastos
 *  ---------------------------------------------------------------------------
 *  Dashboard de gastos operativos para administracion. Muestra:
 *    - KPIs (total mes, total ano, conteo, ticket promedio).
 *    - Filtros de rango de fechas + categoria + busqueda.
 *    - Tabla con paginacion virtual ligera (limit 100) y boton "Ver soporte"
 *      que abre la foto/PDF en una nueva pestaña.
 *
 *  Filtra automaticamente por `selectedEmpresaId` (contexto global) para
 *  respetar el aislamiento multi-tenant del CRM.
 * ============================================================================
 */

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { useAuth } from "@/components/auth-provider"
import { leerGastos } from "@/lib/finanzas-lectura-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  ExternalLink,
  Filter,
  Loader2,
  Receipt,
  Search,
  TrendingUp,
  Wallet,
} from "lucide-react"

/**
 * Forma exacta de una fila de la tabla `public.gastos` (alineada al
 * esquema real: id es uuid, url_soporte se llama asi en BD, hay tanto
 * `registrado_por` (uuid de auth.users) como `creado_por` (texto legible).
 */
interface GastoRow {
  id: string
  id_empresa: number
  fecha: string
  categoria: string
  monto: number
  descripcion: string | null
  url_soporte: string | null
  registrado_por: string | null
  creado_por: string | null
  created_at: string
}

const CATEGORIAS = [
  "Todas",
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

const formatCOP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0)

/** Primer dia del mes actual en formato YYYY-MM-DD. */
function firstOfMonth(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

/** Hoy en formato YYYY-MM-DD. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface Props {
  idEmpresa?: number | null
}

export default function DashboardGastos({ idEmpresa: idEmpresaProp }: Props) {
  const { selectedEmpresaId } = useAuth()
  const idEmpresa = idEmpresaProp ?? selectedEmpresaId ?? null

  // Filtros
  const [desde, setDesde] = useState<string>(firstOfMonth())
  const [hasta, setHasta] = useState<string>(today())
  const [categoria, setCategoria] = useState<string>("Todas")
  const [search, setSearch] = useState<string>("")

  // Search debounced para no spamear al BE en cada keystroke
  const [debounced, setDebounced] = useState(search)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350)
    return () => clearTimeout(t)
  }, [search])

  // ---------------------------------------------------------------------------
  // Fetcher SWR
  //   - Clave incluye todos los filtros para que SWR cachee correctamente.
  //   - Si no hay empresa, no hace fetch.
  // ---------------------------------------------------------------------------
  const swrKey = idEmpresa
    ? ["gastos", idEmpresa, desde, hasta, categoria, debounced]
    : null

  // SEGURIDAD (2026-10-03): la consulta la hace el servidor con los mismos filtros,
  // orden y límite (lib/finanzas-lectura-actions.ts); el navegador no toca `gastos`.
  const fetcher = async (): Promise<GastoRow[]> => {
    const data = await leerGastos({ idEmpresa: idEmpresa as number, desde, hasta, categoria, buscar: debounced })
    return (data ?? []) as GastoRow[]
  }

  const { data, error, isLoading, mutate } = useSWR<GastoRow[]>(
    swrKey,
    fetcher,
    { revalidateOnFocus: false },
  )

  // ---------------------------------------------------------------------------
  // KPIs derivados de la lista visible
  // ---------------------------------------------------------------------------
  const kpis = useMemo(() => {
    const rows = data ?? []
    const total = rows.reduce((acc, r) => acc + Number(r.monto || 0), 0)
    const count = rows.length
    const promedio = count > 0 ? total / count : 0

    const mesActualKey = today().slice(0, 7) // YYYY-MM
    const totalMes = rows
      .filter((r) => r.fecha?.startsWith(mesActualKey))
      .reduce((acc, r) => acc + Number(r.monto || 0), 0)

    return { total, count, promedio, totalMes }
  }, [data])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Receipt className="h-4 w-4" />
          </div>
          <h2 className="text-xl font-semibold">Dashboard de gastos</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Visualiza y revisa los gastos operativos reportados por el equipo.
        </p>
      </header>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total del rango"
          value={formatCOP(kpis.total)}
          icon={<Wallet className="h-4 w-4" />}
        />
        <KpiCard
          label="Total mes actual"
          value={formatCOP(kpis.totalMes)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <KpiCard
          label="Cantidad de gastos"
          value={String(kpis.count)}
          icon={<Receipt className="h-4 w-4" />}
        />
        <KpiCard
          label="Ticket promedio"
          value={formatCOP(kpis.promedio)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            Filtros
          </CardTitle>
          <CardDescription>
            Ajusta el rango y la categoria. Los KPIs se recalculan en vivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="desde">Desde</Label>
              <DatePickerField
                id="desde"
                value={desde}
                maxDate={hasta}
                onChange={setDesde}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hasta">Hasta</Label>
              <DatePickerField
                id="hasta"
                value={hasta}
                minDate={desde}
                maxDate={today()}
                onChange={setHasta}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat">Categoria</Label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger id="cat">
                  <SelectValue placeholder="Categoria" />
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
            <div className="space-y-1.5">
              <Label htmlFor="busqueda">Buscar en descripcion</Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="busqueda"
                  placeholder="Ej: peaje, taxi, papeleria..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Gastos registrados</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => mutate()}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Actualizar"
              )}
            </Button>
          </div>
          <CardDescription>
            Mostrando hasta 100 registros recientes en el rango seleccionado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!idEmpresa ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Selecciona una empresa en la barra superior para ver los gastos.
            </p>
          ) : error ? (
            <p className="py-12 text-center text-sm text-destructive">
              Error cargando los gastos: {(error as Error).message}
            </p>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Cargando gastos...
            </div>
          ) : (data?.length ?? 0) === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No hay gastos registrados con los filtros actuales.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Descripcion</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Soporte</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {g.fecha}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {g.categoria}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[360px] truncate text-sm text-muted-foreground">
                        {g.descripcion || "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                        {formatCOP(Number(g.monto))}
                      </TableCell>
                      <TableCell className="text-right">
                        {g.url_soporte ? (
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-8 bg-transparent"
                          >
                            <a
                              href={g.url_soporte}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              Ver
                            </a>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Sin soporte
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * Subcomponente: tarjeta de KPI
 * ------------------------------------------------------------------------- */
function KpiCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold tabular-nums">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
