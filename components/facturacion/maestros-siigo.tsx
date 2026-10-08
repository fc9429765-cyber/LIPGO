"use client"

// MAESTROS DE SIIGO
//
// Los catálogos de Siigo guardados en LIPgo: productos, clientes, formas de
// pago e impuestos. Sirven para cruzar lo que factura Siigo con lo que opera
// LIPgo --un código de producto, un NIT-- sin tener que mirarlos a mano en el
// panel de Siigo.
//
// Todo lo que se ve aquí sale de la copia local, no de la API: responde al
// instante y sigue funcionando aunque Siigo esté caído.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  Boxes,
  Loader2,
  Percent,
  RefreshCw,
  Search,
  Users,
  Wallet,
} from "lucide-react"
import {
  buscarClientes,
  buscarProductos,
  getCatalogos,
  getEstadoMaestros,
  sincronizarMaestro,
  type ClienteGuardado,
  type EstadoMaestro,
  type Maestro,
  type ProductoGuardado,
} from "@/lib/siigo-maestros-actions"

const money = (n: number | null) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(n)

const NOMBRE: Record<Maestro, string> = {
  productos: "Productos",
  clientes: "Clientes",
  formas_pago: "Formas de pago",
  impuestos: "Impuestos",
}

const ICONO: Record<Maestro, typeof Boxes> = {
  productos: Boxes,
  clientes: Users,
  formas_pago: Wallet,
  impuestos: Percent,
}

export default function MaestrosSiigo() {
  const { toast } = useToast()
  const [estados, setEstados] = useState<EstadoMaestro[]>([])
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState<Maestro | null>(null)

  const [pestana, setPestana] = useState<Maestro>("productos")
  const [texto, setTexto] = useState("")
  const [soloActivos, setSoloActivos] = useState(true)

  const [productos, setProductos] = useState<ProductoGuardado[]>([])
  const [clientes, setClientes] = useState<ClienteGuardado[]>([])
  const [catalogos, setCatalogos] = useState<Awaited<ReturnType<typeof getCatalogos>> | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [total, setTotal] = useState(0)

  const cargarEstados = useCallback(async () => {
    const r = await getEstadoMaestros()
    if (r.faltaMigracion) setFaltaMigracion(true)
    if (r.success && r.data) setEstados(r.data)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargarEstados()
  }, [cargarEstados])

  const buscar = useCallback(async () => {
    setBuscando(true)
    if (pestana === "productos") {
      const r = await buscarProductos({ texto, soloActivos })
      if (r.success && r.data) {
        setProductos(r.data)
        setTotal(r.total ?? 0)
      }
    } else if (pestana === "clientes") {
      const r = await buscarClientes({ texto, soloActivos })
      if (r.success && r.data) {
        setClientes(r.data)
        setTotal(r.total ?? 0)
      }
    } else {
      const r = await getCatalogos()
      setCatalogos(r)
    }
    setBuscando(false)
  }, [pestana, texto, soloActivos])

  useEffect(() => {
    if (!faltaMigracion) buscar()
  }, [faltaMigracion, buscar])

  async function sincronizar(maestro: Maestro, desdeCero = false) {
    setSincronizando(maestro)
    let total = 0
    let pasadas = 0

    // Productos y clientes no caben en una sola llamada: se encadenan pasadas
    // hasta que no quede nada pendiente. El tope evita un bucle si algo falla.
    for (;;) {
      const r = await sincronizarMaestro(maestro, { desdeCero: desdeCero && pasadas === 0 })
      pasadas++
      if (!r.success) {
        setSincronizando(null)
        toast({ title: "No se pudo sincronizar", description: r.message, variant: "destructive" })
        cargarEstados()
        return
      }
      total += r.traidos
      if (!r.quedaPendiente || pasadas >= 30) break
    }

    setSincronizando(null)
    toast({
      title: `${NOMBRE[maestro]} sincronizados`,
      description: total > 0 ? `${total.toLocaleString("es-CO")} registro(s).` : "Ya estaba al día.",
    })
    cargarEstados()
    buscar()
  }

  if (cargando) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (faltaMigracion) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          Falta correr <code className="font-mono text-xs">scripts/229_siigo_maestros.sql</code>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* --- Estado de cada maestro --- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["productos", "clientes", "formas_pago", "impuestos"] as Maestro[]).map((m) => {
          const e = estados.find((x) => x.maestro === m)
          const Icono = ICONO[m]
          return (
            <div key={m} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <Icono className="h-3.5 w-3.5" />
                    {NOMBRE[m]}
                  </p>
                  <p className="mt-1 text-xl font-bold">
                    {(e?.guardados ?? 0).toLocaleString("es-CO")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {e?.ultimaCorrida
                      ? `al ${new Date(e.ultimaCorrida).toLocaleDateString("es-CO", {
                          day: "2-digit",
                          month: "2-digit",
                        })}`
                      : "sin traer"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => sincronizar(m)}
                  disabled={sincronizando !== null}
                  title={`Traer ${NOMBRE[m].toLowerCase()} de Siigo`}
                >
                  {sincronizando === m ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Productos y clientes traen solo lo modificado; los catálogos se traen
          enteros porque son pocos y casi nunca cambian. */}
      <p className="text-[11px] text-muted-foreground">
        Productos y clientes traen solo lo <strong>nuevo o modificado</strong> desde la última vez.
        Formas de pago e impuestos se traen completos: son pocos y casi no cambian.
      </p>

      {/* --- Pestañas --- */}
      <div className="flex flex-wrap gap-1.5 border-b border-border">
        {(["productos", "clientes", "formas_pago", "impuestos"] as Maestro[]).map((m) => {
          const Icono = ICONO[m]
          return (
            <button
              key={m}
              type="button"
              onClick={() => {
                setPestana(m)
                setTexto("")
              }}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                pestana === m
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icono className="h-4 w-4" />
              {NOMBRE[m]}
            </button>
          )
        })}
      </div>

      {/* --- Buscador (solo para productos y clientes) --- */}
      {(pestana === "productos" || pestana === "clientes") && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buscar()}
              placeholder={
                pestana === "productos" ? "Nombre, código o referencia" : "Nombre o NIT / cédula"
              }
              className="h-9 pl-8 text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={soloActivos}
              onChange={(e) => setSoloActivos(e.target.checked)}
            />
            Solo activos
          </label>
          <Button onClick={buscar} disabled={buscando} className="h-9 gap-1.5">
            {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </Button>
          {total > 0 && (
            <span className="text-xs text-muted-foreground">
              {total.toLocaleString("es-CO")} resultado(s)
            </span>
          )}
        </div>
      )}

      {/* --- Contenido --- */}
      <section className="rounded-xl border border-border bg-card">
        {buscando ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : pestana === "productos" ? (
          productos.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No hay productos. Pulsa el botón de recargar en la tarjeta de arriba para traerlos de
              Siigo.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2 text-right">Precio</th>
                    <th className="px-3 py-2 text-right">Disponible</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p) => (
                    <tr key={p.id} className="border-b border-border/50 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {p.codigo ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {p.nombre ?? "—"}
                        {p.grupo && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">{p.grupo}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {p.tipo ?? "—"}
                        {p.unidad ? ` · ${p.unidad}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{money(p.precio)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                        {p.disponible == null ? "—" : p.disponible.toLocaleString("es-CO")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : pestana === "clientes" ? (
          clientes.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No hay clientes. Pulsa el botón de recargar en la tarjeta de arriba.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">NIT / cédula</th>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Ciudad</th>
                    <th className="px-3 py-2">Contacto</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c) => (
                    <tr key={c.id} className="border-b border-border/50 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {c.identificacion ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {c.nombre ?? "—"}
                        {c.nombreComercial && c.nombreComercial !== c.nombre && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            {c.nombreComercial}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                        {c.ciudad ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {c.telefono ?? ""}
                        {c.telefono && c.email ? " · " : ""}
                        {c.email ?? ""}
                        {!c.telefono && !c.email ? "—" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : pestana === "formas_pago" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Id</th>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Vencimiento</th>
                </tr>
              </thead>
              <tbody>
                {(catalogos?.formasPago ?? []).map((f) => (
                  <tr key={f.id} className="border-b border-border/50 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{f.id}</td>
                    <td className="px-3 py-2">{f.nombre}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{f.tipo ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {f.vencimiento ? "sí maneja" : "no maneja"}
                    </td>
                  </tr>
                ))}
                {(catalogos?.formasPago ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      Sin formas de pago. Pulsa recargar en su tarjeta.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Id</th>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Porcentaje</th>
                </tr>
              </thead>
              <tbody>
                {(catalogos?.impuestos ?? []).map((t) => (
                  <tr key={t.id} className="border-b border-border/50 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{t.id}</td>
                    <td className="px-3 py-2">{t.nombre}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{t.tipo ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {t.porcentaje == null ? "—" : `${t.porcentaje}%`}
                    </td>
                  </tr>
                ))}
                {(catalogos?.impuestos ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      Sin impuestos. Pulsa recargar en su tarjeta.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
