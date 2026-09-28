"use client"

// CONSULTA DE FACTURAS EN SIIGO
//
// Solo lectura contra la API de Siigo. No crea, no modifica y no anula nada:
// esto es una ventana a la contabilidad, no una forma de tocarla.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Search,
  X,
} from "lucide-react"
import {
  buscarFacturas,
  getDetalleFactura,
  getEstadoSiigo,
  getPdfFactura,
  type DetalleFactura,
  type FacturaListada,
} from "@/lib/siigo-actions"

const PAGE_SIZE = 50

const money = (n: number, moneda = "COP") =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(n || 0)

function fmtFecha(iso: string | null): string {
  if (!iso) return "—"
  const [a, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${a}`
}

/** El primer día del mes en curso, que es el filtro por defecto. */
function inicioMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

function hoy(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export default function ConsultaSiigo() {
  const { toast } = useToast()
  const [estado, setEstado] = useState<Awaited<ReturnType<typeof getEstadoSiigo>> | null>(null)
  const [facturas, setFacturas] = useState<FacturaListada[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [desde, setDesde] = useState(inicioMes())
  const [hasta, setHasta] = useState(hoy())
  const [identificacion, setIdentificacion] = useState("")
  const [numero, setNumero] = useState("")

  const [detalle, setDetalle] = useState<DetalleFactura | null>(null)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [bajando, setBajando] = useState<string | null>(null)

  useEffect(() => {
    getEstadoSiigo().then(setEstado)
  }, [])

  const buscar = useCallback(
    async (p = 1) => {
      setCargando(true)
      setError(null)
      const r = await buscarFacturas({
        fechaDesde: desde || undefined,
        fechaHasta: hasta || undefined,
        identificacion: identificacion.trim() || undefined,
        numero: numero.trim() ? Number(numero.trim()) : undefined,
        page: p,
        pageSize: PAGE_SIZE,
      })
      setCargando(false)
      if (!r.success) {
        setError(r.message ?? "No se pudo consultar.")
        setFacturas([])
        return
      }
      setFacturas(r.data ?? [])
      setTotal(r.total ?? 0)
      setPagina(r.pagina ?? p)
    },
    [desde, hasta, identificacion, numero],
  )

  // La primera carga espera a saber si la integración responde: sin eso, un
  // error de credenciales se vería como "no hay facturas".
  useEffect(() => {
    if (estado?.conecta) buscar(1)
  }, [estado?.conecta, buscar])

  async function verDetalle(f: FacturaListada) {
    setAbriendo(f.id)
    const r = await getDetalleFactura(f.id)
    setAbriendo(null)
    if (!r.success || !r.data) {
      toast({ title: "No se pudo abrir", description: r.message, variant: "destructive" })
      return
    }
    setDetalle(r.data)
  }

  async function descargarPdf(f: FacturaListada) {
    setBajando(f.id)
    const r = await getPdfFactura(f.id)
    setBajando(null)
    if (!r.success || !r.pdf) {
      toast({ title: "No se pudo descargar", description: r.message, variant: "destructive" })
      return
    }
    // Siigo lo manda en base64 dentro de un JSON, no como archivo.
    const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${f.nombre || `Factura ${f.numero ?? f.id}`}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const paginas = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const sumaTotal = facturas.reduce((a, f) => a + f.total, 0)
  const sumaSaldo = facturas.reduce((a, f) => a + f.saldo, 0)

  // --- Sin configurar ------------------------------------------------------
  if (estado && !estado.configurado) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          La conexión con Siigo no está configurada
        </p>
        <p className="mt-1 text-[11px] text-amber-900">
          Falta{estado.faltan.length > 1 ? "n" : ""}{" "}
          <span className="font-mono">{estado.faltan.join(", ")}</span> en las variables de entorno
          del proyecto (Vercel → Settings → Environment Variables).
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {estado && estado.configurado && !estado.conecta && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-900">
            <AlertTriangle className="h-4 w-4" />
            Siigo no respondió
          </p>
          <p className="mt-1 text-[11px] text-red-900">{estado.message}</p>
        </div>
      )}

      {/* --- Filtros --- */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Desde</Label>
            <Input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="mt-1 h-9 w-[9.5rem] text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Hasta</Label>
            <Input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="mt-1 h-9 w-[9.5rem] text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">NIT / cédula</Label>
            <Input
              value={identificacion}
              onChange={(e) => setIdentificacion(e.target.value)}
              placeholder="opcional"
              className="mt-1 h-9 w-[9rem] text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">N.º factura</Label>
            <Input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="opcional"
              className="mt-1 h-9 w-[7rem] text-sm"
            />
          </div>
          <Button onClick={() => buscar(1)} disabled={cargando} className="h-9 gap-1.5">
            {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </Button>
        </div>
      </section>

      {/* --- Resumen de lo encontrado --- */}
      {facturas.length > 0 && (
        <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm">
          <span>
            <strong>{total.toLocaleString("es-CO")}</strong>{" "}
            <span className="text-muted-foreground">facturas</span>
          </span>
          <span>
            <span className="text-muted-foreground">En esta página:</span>{" "}
            <strong>{money(sumaTotal)}</strong>
          </span>
          {sumaSaldo > 0.01 && (
            <span>
              <span className="text-muted-foreground">Por cobrar:</span>{" "}
              <strong className="text-amber-700">{money(sumaSaldo)}</strong>
            </span>
          )}
        </div>
      )}

      {/* --- Tabla --- */}
      <section className="rounded-xl border border-border bg-card">
        {error ? (
          <div className="p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        ) : cargando ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : facturas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No hay facturas en ese rango.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Factura</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((f) => (
                  <tr key={f.id} className="border-b border-border/50 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="font-medium">{f.nombre || f.numero}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {fmtFecha(f.fecha)}
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-xs">{f.cliente || "—"}</p>
                      {f.identificacion && (
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {f.identificacion}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {money(f.total, f.moneda)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {f.pagada ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                          Pagada
                        </span>
                      ) : (
                        <span className="font-medium text-amber-700">
                          {money(f.saldo, f.moneda)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => verDetalle(f)}
                          disabled={abriendo === f.id}
                        >
                          {abriendo === f.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FileText className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => descargarPdf(f)}
                          disabled={bajando === f.id}
                          title="Descargar el PDF de Siigo"
                        >
                          {bajando === f.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {paginas > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              Página {pagina} de {paginas}
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => buscar(pagina - 1)}
                disabled={pagina <= 1 || cargando}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => buscar(pagina + 1)}
                disabled={pagina >= paginas || cargando}
              >
                Siguiente
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* --- Detalle --- */}
      {detalle && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setDetalle(null)}
            aria-hidden
          />
          <aside
            className="fixed bottom-0 right-0 top-0 z-50 overflow-auto bg-background shadow-xl"
            style={{ width: "min(720px, 96vw)" }}
          >
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-border bg-background px-5 py-4">
              <div>
                <h3 className="text-base font-semibold">{detalle.nombre || detalle.numero}</h3>
                <p className="text-xs text-muted-foreground">
                  {fmtFecha(detalle.fecha)} · {detalle.cliente}
                  {detalle.identificacion ? ` · ${detalle.identificacion}` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDetalle(null)} className="h-8 px-2">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</p>
                  <p className="mt-0.5 text-xl font-bold">{money(detalle.total, detalle.moneda)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Saldo</p>
                  <p
                    className={`mt-0.5 text-xl font-bold ${detalle.pagada ? "text-emerald-700" : "text-amber-700"}`}
                  >
                    {detalle.pagada ? "Pagada" : money(detalle.saldo, detalle.moneda)}
                  </p>
                </div>
              </div>

              {detalle.items.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Productos y servicios</h4>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase text-muted-foreground">
                          <th className="px-2.5 py-1.5">Descripción</th>
                          <th className="px-2.5 py-1.5 text-right">Cant.</th>
                          <th className="px-2.5 py-1.5 text-right">Precio</th>
                          <th className="px-2.5 py-1.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalle.items.map((i, k) => (
                          <tr key={k} className="border-b border-border/50 last:border-0">
                            <td className="px-2.5 py-1.5">
                              {i.descripcion || i.codigo || "—"}
                              {i.impuestos.length > 0 && (
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  ({i.impuestos.map((t) => `${t.nombre} ${t.porcentaje}%`).join(", ")})
                                </span>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5 text-right">{i.cantidad}</td>
                            <td className="px-2.5 py-1.5 text-right">
                              {money(i.precio, detalle.moneda)}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-medium">
                              {money(i.total, detalle.moneda)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {detalle.pagos.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Medios de pago</h4>
                  <div className="space-y-1.5">
                    {detalle.pagos.map((p, k) => (
                      <div
                        key={k}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"
                      >
                        <span>
                          {p.nombre}
                          {p.vence && (
                            <span className="ml-1.5 text-muted-foreground">
                              vence {fmtFecha(p.vence)}
                            </span>
                          )}
                        </span>
                        <span className="font-medium">{money(p.valor, detalle.moneda)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detalle.observaciones && (
                <div>
                  <h4 className="mb-1 text-sm font-semibold">Observaciones</h4>
                  <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    {detalle.observaciones}
                  </p>
                </div>
              )}

              <Button
                onClick={() =>
                  descargarPdf({
                    ...detalle,
                  } as FacturaListada)
                }
                disabled={bajando === detalle.id}
                className="w-full gap-1.5"
              >
                {bajando === detalle.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Descargar el PDF de Siigo
              </Button>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
