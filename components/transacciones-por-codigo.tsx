"use client"

// Movimiento por código (estilo SAP): escribe el código de la transacción y
// el formulario habilita SOLO los campos de ese movimiento. Nomenclatura
// siempre visible al lado. Todo queda trazado en inv_correcciones_log.

import { useEffect, useMemo, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { Loader2, Search, ShieldCheck, ArrowRight } from "lucide-react"
import {
  getCatalogoTransacciones,
  buscarMovimientoOriginal,
  ejecutarTransaccionPorCodigo,
  solicitarAjustePendiente,
  getCodigosQuePuedoAprobar,
  ejecutarAjusteConMiClave,
  getStockCuarentena,
} from "@/lib/transacciones-codigo-actions"
import {
  FIELDSETS,
  CODIGOS_REQUIEREN_APROBACION,
  CODIGOS_MAL_USADOS_PARA_CALIDAD,
  esMotivoDeCalidad,
  MENSAJE_REDIRECCION_CALIDAD,
  type CatalogoTransaccion,
  type MovimientoOriginal,
} from "@/lib/transacciones-codigo"
import {
  getLocationsFromSaldoInvDetalle,
  getDestinationLocationsFromLocationsTable,
  getProductosFromSaldoInvDetalleByLocation,
  getLotesFromSaldoInvDetalleByLocationAndProduct,
  getProductsWithCodes,
  searchInventoryByQR,
  getSaldoEnUbicacion,
  type SaldoEnUbicacion,
} from "@/lib/inventory-actions"
import { QRCameraScanner } from "@/components/qr-camera-scanner"
import { QrCode, Camera } from "lucide-react"

const fmtFecha = (iso: any) => {
  if (!iso) return ""
  try {
    return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }).format(new Date(String(iso)))
  } catch {
    return String(iso).slice(0, 16)
  }
}

export function TransaccionesPorCodigo() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const [catalogo, setCatalogo] = useState<CatalogoTransaccion[]>([])
  const [codigo, setCodigo] = useState("")
  const [busquedaNom, setBusquedaNom] = useState("")

  // Campos del movimiento
  const [location, setLocation] = useState("")
  const [producto, setProducto] = useState("")
  const [lote, setLote] = useState("")
  const [cantidad, setCantidad] = useState("")
  const [motivo, setMotivo] = useState("")
  const [clave, setClave] = useState("")
  const [locationDestino, setLocationDestino] = useState("")
  const [loteDestino, setLoteDestino] = useState("")
  const [productoDestino, setProductoDestino] = useState("")
  const [ocargueRef, setOcargueRef] = useState("")

  // Catálogos en cascada
  const [ubicaciones, setUbicaciones] = useState<string[]>([])
  const [ubicacionesDestino, setUbicacionesDestino] = useState<string[]>([])
  // Saldo del producto en la ubicación elegida (total + desglose por lote).
  const [saldo, setSaldo] = useState<SaldoEnUbicacion | null>(null)
  const [cargandoSaldo, setCargandoSaldo] = useState(false)
  // Se incrementa despues de ejecutar una transaccion para releer el saldo.
  const [refrescoSaldo, setRefrescoSaldo] = useState(0)

  const [productos, setProductos] = useState<string[]>([])
  const [productosLibres, setProductosLibres] = useState<string[]>([])
  const [lotes, setLotes] = useState<string[]>([])

  // Búsqueda de movimiento original (reversos)
  const [refBusqueda, setRefBusqueda] = useState("")
  const [refResultados, setRefResultados] = useState<MovimientoOriginal[]>([])
  const [refSel, setRefSel] = useState<MovimientoOriginal | null>(null)
  const [buscandoRef, setBuscandoRef] = useState(false)

  // Modo de captura del origen: aún NO todas las estibas tienen QR, así que
  // conviven las dos opciones (igual que el formulario clásico). "Sin QR" =
  // cascada manual; "Con QR" = escanear/digitar la estiba y precargar.
  const [modoQr, setModoQr] = useState<"sin-qr" | "con-qr">("sin-qr")
  const [qr, setQr] = useState("")
  const [qrCamaraAbierta, setQrCamaraAbierta] = useState(false)
  const [qrLineas, setQrLineas] = useState<any[]>([])
  const [buscandoQr, setBuscandoQr] = useState(false)
  // Contador de "saltos de limpieza": al precargar por QR, los efectos de
  // cascada (ubicación → limpia producto → limpia lote) NO deben borrar lo
  // que el QR acaba de poner.
  const prefillRef = useRef(0)

  const [confirmando, setConfirmando] = useState(false)
  const [ejecutando, setEjecutando] = useState(false)

  const fs = FIELDSETS[codigo] ?? null
  const info = useMemo(() => catalogo.find((c) => c.codigo === codigo) ?? null, [catalogo, codigo])
  const requiereAprobacion = CODIGOS_REQUIEREN_APROBACION.has(codigo)

  useEffect(() => {
    getCatalogoTransacciones().then((r) => {
      if (r.success) setCatalogo(r.data)
      else toast({ title: "No se pudo cargar la nomenclatura", description: r.error, variant: "destructive" })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Códigos con aprobación (601/702/555) que ESTE usuario puede aprobar en el
  // proyecto con su clave personal: el diálogo le ofrece "Ejecutar ahora" además
  // de "Enviar a Gerencia" (p. ej. el jefe de bodega de Avimol con el 555).
  const [puedoAprobar, setPuedoAprobar] = useState<string[]>([])
  useEffect(() => {
    if (!selectedEmpresaId) {
      setPuedoAprobar([])
      return
    }
    let vivo = true
    getCodigosQuePuedoAprobar(selectedEmpresaId).then((c) => {
      if (vivo) setPuedoAprobar(c)
    })
    return () => {
      vivo = false
    }
  }, [selectedEmpresaId])
  const puedoEjecutarYo = requiereAprobacion && puedoAprobar.includes(codigo)

  const limpiarCampos = () => {
    setLocation(""); setProducto(""); setLote(""); setCantidad(""); setMotivo(""); setClave("")
    setLocationDestino(""); setLoteDestino(""); setProductoDestino(""); setOcargueRef("")
    setRefBusqueda(""); setRefResultados([]); setRefSel(null)
  }

  // Cambio de código o de proyecto → limpiar y recargar cascadas base.
  useEffect(() => {
    limpiarCampos()
    if (!fs || !selectedEmpresaId) return
    if (fs.origen === "conStock") {
      getLocationsFromSaldoInvDetalle(undefined, selectedEmpresaId).then(setUbicaciones)
    }
    if (fs.origen === "cuarentena") {
      // Origen CUARENTENA (343 liberar / 555 desechar): la ubicación es
      // automática. Se toma DIRECTO de la tabla de ubicaciones del proyecto (no
      // de la lista de ubicaciones con saldo, que depende de filtros y de que el
      // saldo ya esté materializado) para que producto y lote carguen siempre.
      getStockCuarentena(selectedEmpresaId).then((r) => {
        if (r.ubicacion) {
          setUbicaciones([r.ubicacion])
          setLocation(r.ubicacion)
        } else {
          toast({ title: "Sin ubicación CUARENTENA", description: r.message || "Este proyecto no tiene ubicación CUARENTENA configurada.", variant: "destructive" })
        }
        if (r.success && r.data.length === 0) {
          toast({ title: "Cuarentena vacía", description: "No hay producto bloqueado en CUARENTENA en este proyecto. Primero bloquea con 344." })
        }
      })
    }
    if (fs.origen === "libre") {
      getDestinationLocationsFromLocationsTable(selectedEmpresaId).then(setUbicaciones)
      getProductsWithCodes().then((ps: any[]) => setProductosLibres(ps.map((p: any) => p.nombre)))
    }
    if (fs.destino) {
      getDestinationLocationsFromLocationsTable(selectedEmpresaId).then(setUbicacionesDestino)
      if (fs.destino === "loteProductoUbicacion") getProductsWithCodes().then((ps: any[]) => setProductosLibres(ps.map((p: any) => p.nombre)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo, selectedEmpresaId])

  // Cascadas de origen con stock
  useEffect(() => {
    if (!fs || (fs.origen !== "conStock" && fs.origen !== "cuarentena") || !location || !selectedEmpresaId) return
    getProductosFromSaldoInvDetalleByLocation(location, true, selectedEmpresaId).then(setProductos)
    if (prefillRef.current > 0) prefillRef.current--
    else { setProducto(""); setLote(""); setLotes([]) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location])
  useEffect(() => {
    if (!fs || (fs.origen !== "conStock" && fs.origen !== "cuarentena") || !location || !producto || !selectedEmpresaId) return
    getLotesFromSaldoInvDetalleByLocationAndProduct(location, producto, true, selectedEmpresaId).then(setLotes)
    if (prefillRef.current > 0) prefillRef.current--
    else setLote("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto])

  // SALDO ACTUAL del producto en la ubicación elegida, con desglose por lote.
  //
  // Se consulta apenas hay ubicación + producto, sin esperar al lote: es el
  // momento en que quien arma el movimiento necesita saber cuánto hay. El lote
  // solo resalta la línea correspondiente cuando ya se eligió.
  //
  // Se relee tambien cuando cambia `codigo`: cada transaccion ejecutada mueve
  // el saldo, y dejar en pantalla el de antes seria peor que no mostrarlo.
  useEffect(() => {
    let vigente = true
    if (!location || !producto || !selectedEmpresaId) {
      setSaldo(null)
      return
    }
    setCargandoSaldo(true)
    getSaldoEnUbicacion(location, producto, lote, selectedEmpresaId)
      .then((r) => {
        if (vigente) setSaldo(r)
      })
      .finally(() => {
        if (vigente) setCargandoSaldo(false)
      })
    return () => {
      vigente = false
    }
  }, [location, producto, lote, selectedEmpresaId, refrescoSaldo])

  // Buscar la estiba por QR y precargar ubicación/producto/lote.
  const aplicarLineaQr = (l: any) => {
    if (fs?.origen === "conStock") {
      prefillRef.current = 2 // saltar la limpieza de las 2 cascadas
      setProductos((prev) => (prev.includes(l.nombreproducto) ? prev : [...prev, l.nombreproducto]))
      setLotes((prev) => (prev.includes(l.lote) ? prev : [...prev, l.lote]))
    }
    setLocation(l.location || "")
    setProducto(l.nombreproducto || "")
    setLote(l.lote || "")
    setQrLineas([])
    toast({ title: `Estiba cargada`, description: `${l.nombreproducto} · Lote ${l.lote} · ${l.location} · Stock ${Number(l.stock_total ?? 0).toLocaleString("es-CO")}` })
  }
  const buscarQr = async (codigoQr?: string) => {
    const id = (codigoQr ?? qr).trim()
    if (!id) return
    setBuscandoQr(true)
    const r = await searchInventoryByQR(id)
    setBuscandoQr(false)
    if (!r.success) { toast({ title: "Error al buscar la estiba", description: r.error, variant: "destructive" }); return }
    const lineas = r.data ?? []
    if (!lineas.length) {
      toast({ title: "Estiba no encontrada", description: "Ese QR no tiene inventario registrado. Para registrar una estiba nueva usa el Formulario clásico en modo Con QR.", variant: "destructive" })
      return
    }
    if (lineas.length === 1) aplicarLineaQr(lineas[0])
    else setQrLineas(lineas) // varias líneas en la estiba: elegir
  }

  const buscarOriginal = async () => {
    if (!fs?.referencia || fs.referencia === "ocargueOpcional" || !selectedEmpresaId) return
    setBuscandoRef(true)
    const esId = /^\d+$/.test(refBusqueda.trim()) && refBusqueda.trim().length >= 4
    const r = await buscarMovimientoOriginal({
      selectedEmpresaId,
      tipo: fs.referencia,
      ...(esId ? { invtransId: Number(refBusqueda.trim()) } : {}),
      ...(!esId && refBusqueda.trim() ? (refBusqueda.trim().startsWith("PT") || refBusqueda.trim().startsWith("SP") ? { codproducto: refBusqueda.trim() } : /^\d{6,}$/.test(refBusqueda.trim()) ? { lote: refBusqueda.trim() } : refBusqueda.includes("2026") || /^[A-Z]{3}\d/.test(refBusqueda.trim()) ? { ocargue: refBusqueda.trim() } : { producto: refBusqueda.trim() }) : {}),
    })
    setBuscandoRef(false)
    if (r.success) {
      setRefResultados(r.data)
      if (!r.data.length) toast({ title: "Sin resultados", description: "No se encontraron movimientos con ese criterio." })
    } else toast({ title: "Error en la búsqueda", description: r.error, variant: "destructive" })
  }

  const listo = useMemo(() => {
    if (!fs || !selectedEmpresaId) return false
    const c = Number(cantidad)
    if (!Number.isFinite(c) || c <= 0) return false
    if (fs.requiereClave && (!clave.trim() || !motivo.trim())) return false
    if (fs.claveGerenciaProyecto && (!clave.trim() || !motivo.trim())) return false
    if (requiereAprobacion && !motivo.trim()) return false
    // Motivo de CALIDAD en un 702/601: código equivocado, no se deja enviar (el
    // aviso bajo el motivo explica que el camino es 344 → 343/555).
    if (CODIGOS_MAL_USADOS_PARA_CALIDAD.has(codigo) && esMotivoDeCalidad(motivo)) return false
    if (fs.referencia && fs.referencia !== "ocargueOpcional") return !!refSel
    if (!producto.trim() || !lote.trim() || !location.trim()) return false
    if (fs.destino === "ubicacion" && !locationDestino.trim()) return false
    if (fs.destino === "loteProductoUbicacion" && !loteDestino.trim() && !locationDestino.trim() && !productoDestino.trim()) return false
    return true
  }, [fs, codigo, requiereAprobacion, selectedEmpresaId, cantidad, clave, motivo, refSel, producto, lote, location, locationDestino, loteDestino, productoDestino])

  const ejecutar = async (conMiClave = false) => {
    if (!fs || !selectedEmpresaId) return
    setEjecutando(true)
    const payload = {
      codigo,
      selectedEmpresaId,
      clave: clave || null,
      motivo: motivo || null,
      location: location || null,
      producto: producto || null,
      lote: lote || null,
      cantidad: Number(cantidad),
      locationDestino: locationDestino || null,
      loteDestino: loteDestino || null,
      productoDestino: productoDestino || null,
      refInvtransId: refSel?.id ?? null,
      ocargueRef: ocargueRef || null,
    }
    // 601/702 (salida sin orden de cargue, sin ser avería/reproceso) nunca se
    // aplican de una: quedan pendientes de aprobación de Gerencia (SQL 62).
    // Con aprobación y permiso propio: "Ejecutar ahora" solicita y aprueba en un
    // solo paso con la clave del usuario (mismo rastro que el flujo normal).
    const r = requiereAprobacion
      ? conMiClave
        ? await ejecutarAjusteConMiClave(payload, clave)
        : await solicitarAjustePendiente(payload)
      : await ejecutarTransaccionPorCodigo(payload)
    setEjecutando(false)
    if (!r.success && conMiClave) {
      // Clave incorrecta o sin permiso: dejar el diálogo abierto para corregir.
      toast({ title: "No se pudo ejecutar", description: r.message, variant: "destructive" })
      return
    }
    setConfirmando(false)
    if (r.success) {
      if (requiereAprobacion && !conMiClave) {
        toast({ title: `Solicitud ${codigo} enviada a Gerencia`, description: r.message })
      } else {
        const conInvtrans = r as { invtransIds?: number[] }
        toast({ title: `Movimiento ${codigo} registrado`, description: `${r.message} Movimientos invtrans: ${conInvtrans.invtransIds?.join(", ")}` })
      }
      limpiarCampos()
      setCodigo("")
      // El movimiento acaba de cambiar el saldo. Hoy `limpiarCampos` borra
      // ubicacion y producto, asi que el panel se vacia solo; esto lo deja
      // amarrado igual si esa limpieza cambia — un saldo viejo en pantalla
      // despues de mover inventario es peor que no mostrar ninguno.
      setRefrescoSaldo((n) => n + 1)
    } else {
      toast({ title: requiereAprobacion ? "No se pudo enviar la solicitud" : "No se pudo ejecutar", description: r.message, variant: "destructive" })
    }
  }

  const catalogoFiltrado = useMemo(() => {
    const q = busquedaNom.trim().toLowerCase()
    if (!q) return catalogo
    return catalogo.filter((c) => c.codigo.includes(q) || c.nombre.toLowerCase().includes(q) || String(c.descripcion || "").toLowerCase().includes(q))
  }, [catalogo, busquedaNom])

  if (!selectedEmpresaId) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Selecciona un proyecto en el selector global para registrar movimientos.</p>
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* ==================== FORMULARIO ==================== */}
      <div className="space-y-4">
        <Card className="p-4">
          <Label htmlFor="codigo-tx" className="text-xs uppercase text-muted-foreground">Código de la transacción</Label>
          <div className="mt-1 flex items-center gap-3">
            <Input
              id="codigo-tx"
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder="Ej: 309"
              className="h-12 w-32 text-center font-mono text-2xl font-bold tracking-widest"
            />
            {info ? (
              <div>
                <p className="font-semibold">{info.nombre}</p>
                <p className="text-xs text-muted-foreground">{info.descripcion}</p>
              </div>
            ) : codigo.length >= 3 ? (
              <p className="text-sm text-destructive">Código no reconocido — revisa la nomenclatura de la derecha.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Escribe el código del movimiento (la nomenclatura está a la derecha).</p>
            )}
            {fs?.requiereClave && (
              <Badge variant="outline" className="ml-auto gap-1 text-[10px]" style={{ color: "#C0392B", borderColor: "#C0392B" }}>
                <ShieldCheck className="h-3 w-3" /> Requiere clave
              </Badge>
            )}
            {fs?.claveGerenciaProyecto && (
              <Badge variant="outline" className="ml-auto gap-1 text-[10px]" style={{ color: "#C0392B", borderColor: "#C0392B" }}>
                <ShieldCheck className="h-3 w-3" /> Requiere clave de la gerencia del proyecto
              </Badge>
            )}
            {requiereAprobacion && (
              <Badge variant="outline" className="ml-auto gap-1 text-[10px]" style={{ color: "#C0392B", borderColor: "#C0392B" }}>
                <ShieldCheck className="h-3 w-3" /> Requiere aprobación de la gerencia del proyecto
              </Badge>
            )}
          </div>
        </Card>

        {fs && (
          <Card className="space-y-4 p-4">
            {/* Referencia al movimiento original (reversos) */}
            {fs.referencia && fs.referencia !== "ocargueOpcional" && (
              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">Movimiento original a reversar</Label>
                <div className="flex gap-2">
                  <Input
                    value={refBusqueda}
                    onChange={(e) => setRefBusqueda(e.target.value)}
                    placeholder="Busca por # invtrans, código de producto, lote u orden de cargue"
                    onKeyDown={(e) => e.key === "Enter" && buscarOriginal()}
                  />
                  <Button type="button" variant="outline" onClick={buscarOriginal} disabled={buscandoRef}>
                    {buscandoRef ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {refResultados.length > 0 && !refSel && (
                  <div className="max-h-56 overflow-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60">
                        <tr className="text-left uppercase text-muted-foreground">
                          <th className="px-2 py-1.5">#</th>
                          <th className="px-2 py-1.5">Fecha</th>
                          <th className="px-2 py-1.5">Producto</th>
                          <th className="px-2 py-1.5">Lote · Ubic.</th>
                          <th className="px-2 py-1.5 text-right">Cant.</th>
                          <th className="px-2 py-1.5 text-right">Reversible</th>
                          <th className="px-2 py-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {refResultados.map((m) => (
                          <tr key={m.id} className="border-t">
                            <td className="px-2 py-1.5 font-mono">{m.id}</td>
                            <td className="px-2 py-1.5">{fmtFecha(m.creado)}</td>
                            <td className="px-2 py-1.5">{m.nombreproducto}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">{m.lote} · {m.location}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{m.cantidad}</td>
                            <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: m.reversible > 0 ? "#1E8449" : "#C0392B" }}>{m.reversible}</td>
                            <td className="px-2 py-1.5">
                              <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={m.reversible <= 0} onClick={() => { setRefSel(m); setCantidad(String(m.reversible)) }}>
                                Elegir
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {refSel && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                    <Badge variant="outline" className="font-mono">#{refSel.id}</Badge>
                    <span className="font-medium">{refSel.nombreproducto}</span>
                    <span className="text-muted-foreground">Lote {refSel.lote} · {refSel.location} · {fmtFecha(refSel.creado)} · por {refSel.creadopor}</span>
                    <span>Original <b className="tabular-nums">{refSel.cantidad}</b> · reversible <b className="tabular-nums" style={{ color: "#1E8449" }}>{refSel.reversible}</b></span>
                    <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs" onClick={() => { setRefSel(null); setCantidad("") }}>Cambiar</Button>
                  </div>
                )}
              </div>
            )}

            {/* Modo de captura: Sin QR (manual) / Con QR (escanear estiba).
                Conviven porque aún no todas las estibas tienen QR. */}
            {(fs.origen === "conStock" || fs.origen === "libre") && (
              <RadioGroup
                value={modoQr}
                onValueChange={(v) => { setModoQr(v as "sin-qr" | "con-qr"); setQr(""); setQrLineas([]) }}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="sin-qr" id="modo-sin-qr" />
                  <Label htmlFor="modo-sin-qr" className="cursor-pointer text-sm">Sin QR (manual)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="con-qr" id="modo-con-qr" />
                  <Label htmlFor="modo-con-qr" className="flex cursor-pointer items-center gap-1 text-sm"><QrCode className="h-4 w-4" /> Con QR (escanear estiba)</Label>
                </div>
              </RadioGroup>
            )}

            {/* Estiba por QR: precarga ubicación/producto/lote */}
            {modoQr === "con-qr" && (fs.origen === "conStock" || fs.origen === "libre") && (
              <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-3">
                <Label className="flex items-center gap-1 text-xs uppercase text-muted-foreground">
                  <QrCode className="h-3.5 w-3.5" /> Escanea o digita el código de la estiba — se precargan ubicación, producto y lote
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={qr}
                    onChange={(e) => setQr(e.target.value)}
                    placeholder="Código QR de la estiba"
                    className="max-w-xs"
                    onKeyDown={(e) => e.key === "Enter" && buscarQr()}
                  />
                  <Button type="button" variant="outline" onClick={() => setQrCamaraAbierta(true)} title="Escanear con la cámara">
                    <Camera className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" onClick={() => buscarQr()} disabled={buscandoQr}>
                    {buscandoQr ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {qrLineas.length > 1 && (
                  <div className="max-h-40 overflow-auto rounded-md border bg-background">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60">
                        <tr className="text-left uppercase text-muted-foreground">
                          <th className="px-2 py-1.5">Producto</th>
                          <th className="px-2 py-1.5">Lote</th>
                          <th className="px-2 py-1.5">Ubic.</th>
                          <th className="px-2 py-1.5 text-right">Stock</th>
                          <th className="px-2 py-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {qrLineas.map((l, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-2 py-1.5">{l.nombreproducto}</td>
                            <td className="px-2 py-1.5">{l.lote}</td>
                            <td className="px-2 py-1.5">{l.location}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{Number(l.stock_total ?? 0).toLocaleString("es-CO")}</td>
                            <td className="px-2 py-1.5"><Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => aplicarLineaQr(l)}>Usar</Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Origen directo (producto/lote/ubicación) */}
            {fs.origen && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">{fs.origen === "cuarentena" ? "Ubicación (CUARENTENA)" : "Ubicación"}</Label>
                  {fs.origen === "cuarentena" ? (
                    <Input value="CUARENTENA (automática)" disabled className="mt-1" />
                  ) : (
                    <Select value={location} onValueChange={setLocation}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Ubicación" /></SelectTrigger>
                      <SelectContent>{ubicaciones.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Producto</Label>
                  {fs.origen === "libre" ? (
                    <>
                      <Input list="tx-prod-libre" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Producto" className="mt-1" />
                      <datalist id="tx-prod-libre">{productosLibres.map((p) => <option key={p} value={p} />)}</datalist>
                    </>
                  ) : (
                    <Select value={producto} onValueChange={setProducto} disabled={!location && fs.origen !== "cuarentena"}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Producto con stock" /></SelectTrigger>
                      <SelectContent>{productos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Lote</Label>
                  {fs.origen === "libre" ? (
                    <Input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Lote (AAAAMMDD)" className="mt-1" />
                  ) : (
                    <Select value={lote} onValueChange={setLote} disabled={!producto}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Lote con stock" /></SelectTrigger>
                      <SelectContent>{lotes.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            )}

            {/* SALDO ACTUAL en la ubicación. Aparece apenas hay ubicación +
                producto, sin esperar al lote: es lo que hay que ver ANTES de
                escribir la cantidad. Se muestran las tres cifras porque no son
                lo mismo — `disponible` es lo que se puede mover, `reservado` lo
                comprometido en órdenes y `total` el físico. */}
            {fs.origen && location && producto && (
              <div className="rounded-md border bg-muted/20 p-3">
                {cargandoSaldo ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando saldo…
                  </div>
                ) : !saldo || saldo.lotes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sin saldo registrado para <strong>{producto}</strong> en <strong>{location}</strong>.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                      <span className="uppercase text-muted-foreground">
                        Saldo en {location}
                      </span>
                      <span>
                        <strong className="text-sm tabular-nums">
                          {saldo.totalDisp.toLocaleString("es-CO")}
                        </strong>{" "}
                        disponible
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {saldo.totalRes.toLocaleString("es-CO")} reservado
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {saldo.totalActual.toLocaleString("es-CO")} total
                      </span>
                    </div>

                    {/* Desglose por lote, del más viejo al más nuevo. El lote
                        elegido queda resaltado para no tener que buscarlo. */}
                    <div className="max-h-40 overflow-auto rounded border bg-background">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/60">
                          <tr className="text-left uppercase text-muted-foreground">
                            <th className="px-2 py-1">Lote</th>
                            <th className="px-2 py-1 text-right">Disponible</th>
                            <th className="px-2 py-1 text-right">Reservado</th>
                            <th className="px-2 py-1 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {saldo.lotes.map((l) => (
                            <tr
                              key={l.lote}
                              className={`border-t ${l.lote === lote ? "bg-primary/10 font-medium" : ""}`}
                            >
                              <td className="px-2 py-1">{l.lote || "(sin lote)"}</td>
                              <td className="px-2 py-1 text-right tabular-nums">
                                {l.stockDisp.toLocaleString("es-CO")}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                                {l.stockRes.toLocaleString("es-CO")}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                                {l.stockActual.toLocaleString("es-CO")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Aviso, no bloqueo: la validación real la hace el server
                        action. Aquí solo se advierte antes de enviar. */}
                    {saldo.loteSeleccionado &&
                      Number(cantidad) > saldo.loteSeleccionado.stockDisp && (
                        <p className="text-xs font-medium text-destructive">
                          La cantidad ({Number(cantidad).toLocaleString("es-CO")}) supera lo
                          disponible en el lote {saldo.loteSeleccionado.lote} (
                          {saldo.loteSeleccionado.stockDisp.toLocaleString("es-CO")}).
                        </p>
                      )}
                  </div>
                )}
              </div>
            )}

            {/* Ubicación destino / destino completo (309) */}
            {fs.destino && (
              <div className="grid gap-3 sm:grid-cols-3">
                {fs.destino === "cuarentena" ? (
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">Destino</Label>
                    <Input value="CUARENTENA (automática)" disabled className="mt-1" />
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs uppercase text-muted-foreground">Ubicación destino{codigo === "309" ? " (opcional)" : ""}</Label>
                    <Select value={locationDestino} onValueChange={setLocationDestino}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder={codigo === "309" ? "Igual al origen" : "Ubicación destino"} /></SelectTrigger>
                      <SelectContent>{ubicacionesDestino.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                {fs.destino === "loteProductoUbicacion" && (
                  <>
                    <div>
                      <Label className="text-xs uppercase text-muted-foreground">Lote correcto (opcional)</Label>
                      <Input value={loteDestino} onChange={(e) => setLoteDestino(e.target.value)} placeholder="Igual al origen" className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs uppercase text-muted-foreground">Producto correcto (opcional)</Label>
                      <Input list="tx-prod-libre" value={productoDestino} onChange={(e) => setProductoDestino(e.target.value)} placeholder="Igual al origen" className="mt-1" />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Referencia opcional a orden (653) */}
            {fs.referencia === "ocargueOpcional" && (
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Orden de cargue de la devolución (opcional)</Label>
                <Input value={ocargueRef} onChange={(e) => setOcargueRef(e.target.value)} placeholder="Ej: IND202607247162" className="mt-1 max-w-xs" />
              </div>
            )}

            {/* Cantidad + motivo + clave */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Cantidad</Label>
                <Input type="number" min="0.01" step="0.01" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="mt-1" />
                {refSel && Number(cantidad) > refSel.reversible && (
                  <p className="mt-1 text-xs text-destructive">Máximo reversible: {refSel.reversible}</p>
                )}
              </div>
              <div className={fs.requiereClave || fs.claveGerenciaProyecto ? "" : "sm:col-span-2"}>
                <Label className="text-xs uppercase text-muted-foreground">Motivo{fs.requiereClave || fs.claveGerenciaProyecto || requiereAprobacion ? "" : " (opcional)"}</Label>
                <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={1} className="mt-1" placeholder="Por qué se hace este movimiento" />
                {CODIGOS_MAL_USADOS_PARA_CALIDAD.has(codigo) && esMotivoDeCalidad(motivo) && (
                  <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                    <b>Código equivocado para este motivo.</b> {MENSAJE_REDIRECCION_CALIDAD}
                  </div>
                )}
              </div>
              {(fs.requiereClave || fs.claveGerenciaProyecto) && (
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">
                    {fs.claveGerenciaProyecto ? "Tu clave de autorización (gerencia del proyecto)" : "Tu clave de autorización (responsable)"}
                  </Label>
                  <Input type="password" value={clave} onChange={(e) => setClave(e.target.value)} className="mt-1" placeholder="••••" autoComplete="off" />
                  <div className="mt-1">
                    <AyudaClaveAutorizacion />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button disabled={!listo || ejecutando} onClick={() => setConfirmando(true)}>
                {requiereAprobacion ? "Revisar y enviar a Gerencia" : "Revisar y ejecutar"} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* ==================== NOMENCLATURA (sticky) ==================== */}
      <div>
        <Card className="sticky top-4 overflow-hidden">
          <div className="border-b bg-muted/40 px-3 py-2">
            <p className="text-sm font-semibold">Nomenclatura de transacciones</p>
            <Input value={busquedaNom} onChange={(e) => setBusquedaNom(e.target.value)} placeholder="Buscar código o nombre…" className="mt-2 h-8 text-xs" />
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-xs">
              <tbody>
                {catalogoFiltrado.map((c) => (
                  <tr
                    key={c.codigo}
                    className={`cursor-pointer border-b last:border-0 hover:bg-muted/40 ${c.codigo === codigo ? "bg-muted/60" : ""}`}
                    onClick={() => setCodigo(c.codigo)}
                  >
                    <td className="px-3 py-2 align-top">
                      <span className={`font-mono text-sm font-bold ${c.codigo === codigo ? "text-primary" : ""}`}>{c.codigo}</span>
                      {FIELDSETS[c.codigo]?.requiereClave && <ShieldCheck className="ml-1 inline h-3 w-3 text-muted-foreground" />}
                    </td>
                    <td className="px-2 py-2">
                      <p className="font-medium">{c.nombre}</p>
                      <p className="text-muted-foreground">{c.descripcion}</p>
                    </td>
                  </tr>
                ))}
                {catalogoFiltrado.length === 0 && (
                  <tr><td className="px-3 py-4 text-center text-muted-foreground">Sin códigos. ¿Corriste el SQL 52?</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Escáner de cámara para el QR de estiba */}
      <QRCameraScanner
        isOpen={qrCamaraAbierta}
        onClose={() => setQrCamaraAbierta(false)}
        onScan={(codigoQr: string) => {
          setQr(codigoQr)
          setQrCamaraAbierta(false)
          buscarQr(codigoQr)
        }}
      />

      {/* ==================== CONFIRMACIÓN ==================== */}
      <Dialog open={confirmando} onOpenChange={(o) => !o && setConfirmando(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-base">{requiereAprobacion ? `Enviar a Gerencia · movimiento ${codigo}` : `Confirmar movimiento ${codigo}`}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="font-medium">{info?.nombre}</p>
            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
              {refSel ? (
                <p>Reversa el movimiento <b className="font-mono">#{refSel.id}</b> — {refSel.nombreproducto}, lote {refSel.lote}, {refSel.location}.</p>
              ) : (
                <p>{producto} · Lote {lote} · {fs?.origen === "cuarentena" ? "CUARENTENA" : location}</p>
              )}
              {(locationDestino || loteDestino || productoDestino || fs?.destino === "cuarentena") && (
                <p className="mt-1">
                  → Destino: {productoDestino || producto || refSel?.nombreproducto} · Lote {loteDestino || lote || refSel?.lote} ·{" "}
                  {fs?.destino === "cuarentena" ? "CUARENTENA" : locationDestino || location}
                </p>
              )}
              <p className="mt-1">Cantidad: <b className="tabular-nums">{cantidad}</b></p>
              {motivo && <p className="mt-1">Motivo: {motivo}</p>}
            </div>
            {requiereAprobacion && puedoEjecutarYo ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Tu perfil te permite aprobar el {codigo} en este proyecto. Puedes <b>ejecutarlo ahora con tu clave</b> (queda registrado como
                  solicitado y aprobado por ti) o enviarlo a la cola de Aprobaciones pendientes para que lo apruebe otra persona.
                </p>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Tu clave de autorización</Label>
                  <Input
                    type="password"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    className="mt-1"
                    placeholder="••••"
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && clave.trim() && !ejecutando) ejecutar(true)
                    }}
                  />
                  <div className="mt-1">
                    <AyudaClaveAutorizacion />
                  </div>
                </div>
                <p className="text-xs font-medium" style={{ color: "#C0392B" }}>
                  Al ejecutar, el movimiento se aplica de inmediato al inventario real y no se puede deshacer desde aquí.
                </p>
              </div>
            ) : requiereAprobacion ? (
              <p className="text-xs font-medium" style={{ color: "#C0392B" }}>
                Este código saca producto sin una orden de cargue detrás y sin ser avería/reproceso — NO se aplica todavía. Queda pendiente hasta que alguien con permiso lo apruebe con su clave; el stock no se mueve hasta entonces.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                El movimiento queda en el inventario real (invtrans, saldo recalculado por el sistema) y en el Historial de correcciones con tu usuario. Esta acción no se puede deshacer desde aquí — un error se corrige con otro movimiento (reverso).
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmando(false)} disabled={ejecutando}>Cancelar</Button>
            {puedoEjecutarYo ? (
              <>
                <Button variant="secondary" onClick={() => ejecutar(false)} disabled={ejecutando}>
                  {ejecutando ? "Enviando…" : "Enviar a aprobación"}
                </Button>
                <Button onClick={() => ejecutar(true)} disabled={ejecutando || !clave.trim()}>
                  {ejecutando ? "Ejecutando…" : "Ejecutar ahora con mi clave"}
                </Button>
              </>
            ) : (
              <Button onClick={() => ejecutar(false)} disabled={ejecutando}>
                {ejecutando ? "Enviando…" : requiereAprobacion ? "Enviar a Gerencia" : "Ejecutar movimiento"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
