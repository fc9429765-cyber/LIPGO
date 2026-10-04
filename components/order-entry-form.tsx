"use client"

// ENTRADA DE PEDIDOS — rediseño con el sistema visual LIPgo (2026-10-02),
// aprobado por gerencia sobre el lienzo "hoy vs propuesta".
//
// Lo que NO cambia: campos, obligatorios, cálculo de descuentos (IVA 5 % y
// pronto pago), modo edición desde Gestionar pedidos, guardado en
// pedidoscabecera/pedidosdetalle (registerOrder/updateOrder) y el PDF
// (generateAndUploadOrderPDF + pdfpedido).
//
// Lo que cambia: organización en tres bloques (Quién · Cuándo y cómo ·
// Referencias) y Productos con fila de captura; kilos por línea visibles antes
// de guardar (peso_unitkg × cantidad, el mismo dato que ya se guardaba);
// precio sugerido = último precio vendido (mismo cliente, si no, el ID);
// aviso de N° de pedido repetido en el ID (no bloquea); barra fija de resumen
// con "Guardar y generar PDF"; aviso al guardar con Ver en Gestionar / Abrir
// PDF / Nuevo pedido; esqueleto de carga; celular con bloques apilados y
// líneas como tarjetas. Los alert() se reemplazan por avisos en pantalla.

import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { useState, useEffect, useMemo } from "react"
import {
  getVendedores,
  getClientes,
  getDestinos,
  getCategorias,
  getProductos,
  getCondicionesPago,
  getTiposDespacho,
  getBodegasByCliente,
  getEmpresas,
  getOwners,
  type Bodega,
  type Cliente,
  getOrderForEdit,
  registerOrder,
  updateOrder,
  getProductWeight,
} from "@/lib/actions"
import { getAccessibleEmpresesFromPermisos } from "@/lib/orders-actions"
import { getPrecioSugerido, getPedidosConNumero, type PrecioSugerido } from "@/lib/pedidos-entrada-actions"
import { useAuth } from "@/components/auth-provider"
import { generateAndUploadOrderPDF } from "@/lib/pdf-actions"
import { toast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Eyebrow, Chip, Esqueleto } from "@/components/ui/lipgo"
import { Loader2, Plus, Trash2, ArrowLeft, Check, ChevronsUpDown, Search, AlertTriangle, CheckCircle2, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"

interface ProductLine {
  id: string
  categoria: string
  producto: string
  cantidad: number
  precioUnitario: number
  totalLinea: number
  descuentoIVA: number
  descuentoPP: number
  subtotal: number
  comboOpen?: boolean
}

interface OrderEntryFormProps {
  onManageOrders?: () => void
  editOrderId?: number
  // Alias/callbacks opcionales usados por algunos contenedores (main-content,
  // comprehensive). Se declaran para compatibilidad de tipos.
  onNavigateToManageOrders?: () => void
  onOrderSaved?: () => void
}

const fmtCOP = (v: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(v) || 0)
const fmtKg = (v: number) => `${(Math.round((Number(v) || 0) * 100) / 100).toLocaleString("es-CO")} kg`
const hoyISO = () => new Date().toISOString().split("T")[0]
const sumarDias = (iso: string, n: number) => { const [y, m, d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d + n)); return dt.toISOString().slice(0, 10) }
const proximoLunes = () => { const h = hoyISO(); const [y, m, d] = h.split("-").map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); const faltan = ((8 - dow) % 7) || 7; return sumarDias(h, faltan) }
const fechaCorta = (iso: string) => { if (!iso) return "—"; const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) }
const fechaLarga = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) }

function OrderEntryForm({ onManageOrders, editOrderId, onNavigateToManageOrders }: OrderEntryFormProps = {}) {
  // Proyecto activo del selector global (top bar) — mismo valor que usa el
  // módulo Clientes al crear un cliente nuevo. Sin esto, getClientes() caía a
  // la empresa del PERFIL del usuario, distinta del proyecto activo.
  const { selectedEmpresaId: activeEmpresaId, selectedEmpresaNombre: proyectoNombre, profile, user } = useAuth()
  const actor = (profile as any)?.nombre || (profile as any)?.usuario || user?.email || ""
  const irAGestionar = onManageOrders ?? onNavigateToManageOrders

  const [vendedores, setVendedores] = useState<{ nombre: string }[]>([])
  const [selectedVendedor, setSelectedVendedor] = useState<string>("")

  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [selectedBodega, setSelectedBodega] = useState<string>("")
  const [selectedBodegaData, setSelectedBodegaData] = useState<Bodega | null>(null)

  const [clientes, setClientes] = useState<Cliente[]>([])
  const [selectedCliente, setSelectedCliente] = useState<string>("")
  const [selectedClienteId, setSelectedClienteId] = useState<number | null>(null)
  const [clienteComboOpen, setClienteComboOpen] = useState(false)

  const [destinos, setDestinos] = useState<{ nombre: string }[]>([])
  const [selectedDestino, setSelectedDestino] = useState<string>("")

  const [categorias, setCategorias] = useState<{ nombre: string }[]>([])
  const [allProductos, setAllProductos] = useState<{ nombre: string; categoria: string; peso_unitkg?: number }[]>([])

  const [condicionesPagoList, setCondicionesPagoList] = useState<{ nombrecondicion: string }[]>([])
  const [tiposDespachoList, setTiposDespachoList] = useState<{ nombretipodespacho: string }[]>([])

  const [aplicarDescuentoIVA, setAplicarDescuentoIVA] = useState(false)
  const [aplicarDescuentoPP, setAplicarDescuentoPP] = useState(false)
  const [descuentoPPPercent, setDescuentoPPPercent] = useState<number | string>("")
  const [products, setProducts] = useState<ProductLine[]>([])
  const [saving, setSaving] = useState(false)

  const [fechaProgramada, setFechaProgramada] = useState<string>("")
  const [direccion, setDireccion] = useState("")
  const [condicionPago, setCondicionPago] = useState("")
  const [tipoDespacho, setTipoDespacho] = useState("")
  const [ordenCompra, setOrdenCompra] = useState("")
  const [nPedido, setNPedido] = useState("")
  const [observaciones, setObservaciones] = useState("")

  const [fechaPedido, setFechaPedido] = useState(hoyISO())

  const [selectedEmpresaId, setSelectedEmpresaId] = useState<number | null>(null)
  const [selectedEmpresaNombre, setSelectedEmpresaNombre] = useState("")
  const [selectedEmpresaFacturaNombre, setSelectedEmpresaFacturaNombre] = useState("")
  const [allEmpresas, setAllEmpresas] = useState<Array<{ id: number; nombre: string; nit: string; direccion: string; logo?: string }>>([])
  const [bodegasAccesibles, setBodegasAccesibles] = useState<Array<{ id: number; nombre: string }>>([])
  const [selectedBodegaOrigen, setSelectedBodegaOrigen] = useState<number | null>(null)
  const [selectedBodegaOrigenNombre, setSelectedBodegaOrigenNombre] = useState("")
  const [allOwners, setAllOwners] = useState<Array<{ nombre: string }>>([])
  const [loading, setLoading] = useState(true)

  const [isEditMode, setIsEditMode] = useState(false)
  const [loadingOrderData, setLoadingOrderData] = useState(false)
  const [productComboOpen, setProductComboOpen] = useState<Record<string, boolean>>({})

  // --- Nuevo (rediseño): fila de captura, precio sugerido, aviso de número repetido, aviso al guardar ---
  const [nueva, setNueva] = useState<{ categoria: string; producto: string; cantidad: string; precio: string }>({ categoria: "", producto: "", cantidad: "", precio: "" })
  const [nuevaComboOpen, setNuevaComboOpen] = useState(false)
  const [sugerido, setSugerido] = useState<PrecioSugerido | null>(null)
  const [buscandoSugerido, setBuscandoSugerido] = useState(false)
  const [precioEsSugerido, setPrecioEsSugerido] = useState(false)
  const [repetidos, setRepetidos] = useState<Array<{ idpedido: number; cliente: string | null; fecha: string | null }>>([])
  const [guardado, setGuardado] = useState<{ idpedido: number; pdfUrl: string | null; accion: "guardado" | "actualizado"; resumen: string } | null>(null)
  const [errorForm, setErrorForm] = useState<string | null>(null)

  const empresaParaConsultas = selectedBodegaOrigen ?? activeEmpresaId ?? 0

  useEffect(() => {
    async function loadInitialData() {
      setLoading(true)
      try {
        const [vendedoresData, condicionesPagoData, tiposDespachoData, destinosData, clientesData, categoriasData, productosData, empresasData, ownersData, bodegasAccesiblesData] = await Promise.all([
          getVendedores(),
          getCondicionesPago(),
          getTiposDespacho(),
          getDestinos(),
          getClientes(activeEmpresaId ?? undefined),
          getCategorias(),
          getProductos(),
          getEmpresas(),
          getOwners(),
          getAccessibleEmpresesFromPermisos(),
        ])
        setVendedores(vendedoresData)
        setCondicionesPagoList(condicionesPagoData)
        setTiposDespachoList(tiposDespachoData)
        setDestinos(destinosData)
        setClientes(clientesData)
        setCategorias(categoriasData)
        setAllProductos(productosData)
        setAllEmpresas(empresasData)
        setAllOwners(ownersData)
        setBodegasAccesibles(bodegasAccesiblesData)
        if (bodegasAccesiblesData.length > 0) {
          setSelectedBodegaOrigen(bodegasAccesiblesData[0].id)
          setSelectedBodegaOrigenNombre(bodegasAccesiblesData[0].nombre)
        }
      } catch (error) {
        console.error("Error loading initial data:", error)
        toast({ title: "Error", description: "No se pudieron cargar los datos necesarios.", variant: "destructive" })
      } finally {
        setLoading(false)
      }
    }
    loadInitialData()
  }, [activeEmpresaId])

  useEffect(() => {
    async function loadOrderData() {
      if (!editOrderId || allEmpresas.length === 0 || clientes.length === 0) return
      setLoadingOrderData(true)
      setIsEditMode(true)
      try {
        const result = await getOrderForEdit(editOrderId)
        if (!result.success || !result.header) {
          toast({ title: "Error", description: result.message || "No se pudo cargar el pedido", variant: "destructive" })
          return
        }
        const header = result.header
        const details = result.details || []
        setFechaPedido(header.fecha ? header.fecha.split("T")[0] : hoyISO())
        setSelectedVendedor(header.vendedor || "")
        setSelectedCliente(header.cliente || "")
        setSelectedDestino(header.destino || "")
        setSelectedBodega(header.medio || "")
        setFechaProgramada(header.fecha_programada ? header.fecha_programada.split("T")[0] : "")
        setDireccion(header.direccion || "")
        setSelectedEmpresaNombre(header.empresa || "")
        setSelectedEmpresaFacturaNombre(header.empresafactura || "")
        setCondicionPago(header.condicion_pago || "")
        setTipoDespacho(header.tipo_despacho || "")
        setOrdenCompra(header.orden_de_compra || "")
        setNPedido(header.pedido || "")
        setObservaciones(header.observaciones || "")
        const empresa = allEmpresas.find((e) => e.nombre === header.empresa)
        if (empresa) setSelectedEmpresaId(empresa.id)
        const cliente = clientes.find((c) => c.nombre === header.cliente)
        if (cliente) setSelectedClienteId(cliente.id)
        const loadedProducts = details.map((detail: any) => ({
          id: detail.transid?.toString() || Date.now().toString(),
          categoria: detail.categoria || "",
          producto: detail.producto || "",
          cantidad: detail.unidades || 0,
          precioUnitario: detail.precio_und || 0,
          totalLinea: detail.total_linea || 0,
          descuentoIVA: detail.iva || 0,
          descuentoPP: detail.descuentopp || 0,
          subtotal: detail.subtotal || 0,
        }))
        setProducts(loadedProducts)
        const hasIVA = loadedProducts.some((p: any) => p.descuentoIVA > 0)
        const hasPP = loadedProducts.some((p: any) => p.descuentoPP > 0)
        setAplicarDescuentoIVA(hasIVA)
        setAplicarDescuentoPP(hasPP)
        if (hasPP && loadedProducts.length > 0) {
          const firstProduct = loadedProducts[0]
          if (firstProduct.totalLinea > 0) setDescuentoPPPercent(Math.round((firstProduct.descuentoPP / firstProduct.totalLinea) * 100))
        }
        toast({ title: "Pedido cargado", description: `Editando pedido #${editOrderId}` })
      } catch (error) {
        console.error("Error loading order data:", error)
        toast({ title: "Error", description: "Error al cargar los datos del pedido", variant: "destructive" })
      } finally {
        setLoadingOrderData(false)
      }
    }
    loadOrderData()
  }, [editOrderId, allEmpresas, clientes])

  useEffect(() => {
    async function loadBodegasByCliente() {
      if (selectedClienteId) {
        try {
          const data = await getBodegasByCliente(selectedClienteId)
          setBodegas(data)
          setSelectedBodega("")
          setSelectedBodegaData(null)
        } catch (error) {
          console.error("Error fetching bodegas:", error)
          toast({ title: "Error", description: "No se pudieron cargar las sucursales del cliente.", variant: "destructive" })
          setBodegas([])
        }
      } else {
        setBodegas([])
        setSelectedBodega("")
        setSelectedBodegaData(null)
      }
    }
    loadBodegasByCliente()
  }, [selectedClienteId])

  useEffect(() => {
    if (selectedBodegaData) {
      setSelectedDestino(selectedBodegaData.ciudad || "")
      setDireccion(selectedBodegaData.direccion || "")
    } else {
      setSelectedDestino("")
      setDireccion("")
    }
  }, [selectedBodegaData])

  // Precio sugerido: último precio vendido del producto elegido (mismo cliente, si no, el ID).
  useEffect(() => {
    if (!nueva.producto || !empresaParaConsultas) { setSugerido(null); return }
    let vivo = true
    setBuscandoSugerido(true)
    getPrecioSugerido(empresaParaConsultas, nueva.producto, selectedCliente || null)
      .then((r) => {
        if (!vivo) return
        setSugerido(r.data ?? null)
        if (r.data && (precioEsSugerido || !nueva.precio)) {
          setNueva((n) => ({ ...n, precio: String(r.data!.precio) }))
          setPrecioEsSugerido(true)
        }
      })
      .finally(() => { if (vivo) setBuscandoSugerido(false) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nueva.producto, selectedCliente, empresaParaConsultas])

  // Aviso de N° de pedido repetido en el mismo ID (no bloquea).
  useEffect(() => {
    const n = nPedido.trim()
    if (!n || !empresaParaConsultas) { setRepetidos([]); return }
    const t = setTimeout(() => { getPedidosConNumero(empresaParaConsultas, n, editOrderId ?? null).then((r) => setRepetidos(r.data)) }, 400)
    return () => clearTimeout(t)
  }, [nPedido, empresaParaConsultas, editOrderId])

  // --- Cálculo de líneas (misma fórmula de siempre) ---
  const calcularLinea = (p: ProductLine): ProductLine => {
    const baseTotal = (Number(p.cantidad) || 0) * (Number(p.precioUnitario) || 0)
    const descuentoIVA = aplicarDescuentoIVA ? baseTotal * 0.05 : 0
    const ppPercent = typeof descuentoPPPercent === "number" ? descuentoPPPercent : Number(descuentoPPPercent || 0)
    const descuentoPP = aplicarDescuentoPP && ppPercent > 0 ? baseTotal * (ppPercent / 100) : 0
    return { ...p, totalLinea: baseTotal, descuentoIVA, descuentoPP, subtotal: baseTotal - descuentoIVA - descuentoPP }
  }

  const updateProductLine = (id: string, field: keyof ProductLine, value: any) => {
    setProducts(products.map((p) => {
      if (p.id !== id) return p
      if ((field === "cantidad" || field === "precioUnitario") && Number(value) < 0) return p
      const updated: ProductLine = { ...p, [field]: value }
      if (field === "categoria") updated.producto = ""
      return calcularLinea(updated)
    }))
  }

  useEffect(() => {
    setProducts((prev) => prev.map((p) => calcularLinea(p)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aplicarDescuentoIVA, aplicarDescuentoPP, descuentoPPPercent])

  const removeProduct = (id: string) => setProducts(products.filter((p) => p.id !== id))

  const pesoDe = (nombre: string) => Number(allProductos.find((p) => p.nombre === nombre)?.peso_unitkg) || 0
  const kilosDe = (p: { producto: string; cantidad: number | string }) => pesoDe(p.producto) * (Number(p.cantidad) || 0)

  const agregarLinea = () => {
    const cantidad = Number(nueva.cantidad) || 0
    const precio = Number(nueva.precio) || 0
    if (!nueva.producto) { toast({ title: "Elige el producto" }); return }
    if (cantidad <= 0) { toast({ title: "Indica la cantidad" }); return }
    if (precio < 0) return
    const linea = calcularLinea({ id: Date.now().toString(), categoria: nueva.categoria, producto: nueva.producto, cantidad, precioUnitario: precio, totalLinea: 0, descuentoIVA: 0, descuentoPP: 0, subtotal: 0 })
    setProducts([...products, linea])
    setNueva((n) => ({ categoria: n.categoria, producto: "", cantidad: "", precio: "" }))
    setSugerido(null)
    setPrecioEsSugerido(false)
  }

  const totales = useMemo(() => {
    const totalOrden = products.reduce((s, p) => s + p.totalLinea, 0)
    const descuentoIVATotal = products.reduce((s, p) => s + p.descuentoIVA, 0)
    const descuentoPPTotal = products.reduce((s, p) => s + p.descuentoPP, 0)
    const kilos = products.reduce((s, p) => s + kilosDe(p), 0)
    return { totalOrden, descuentoIVATotal, descuentoPPTotal, totalPagar: totalOrden - descuentoIVATotal - descuentoPPTotal, kilos }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, allProductos])

  // Obligatorios: los mismos de siempre.
  const faltantes: string[] = []
  if (!selectedBodegaOrigen) faltantes.push("bodega origen")
  if (!selectedVendedor) faltantes.push("vendedor")
  if (!selectedCliente) faltantes.push("cliente")
  if (!fechaProgramada) faltantes.push("fecha programada")
  if (!tipoDespacho) faltantes.push("tipo de despacho")
  if (!condicionPago) faltantes.push("condición de pago")
  const lineasIncompletas = products.some((p) => !p.producto || !(Number(p.cantidad) > 0))
  const listo = faltantes.length === 0 && products.length > 0 && !lineasIncompletas
  const avisos = repetidos.length > 0 ? 1 : 0
  const bloqueado = saving || !!guardado

  const handleSaveOrder = async () => {
    if (faltantes.length > 0) { setErrorForm(`Faltan: ${faltantes.join(", ")}.`); toast({ title: "Faltan datos obligatorios", description: faltantes.join(", "), variant: "destructive" }); return }
    if (products.length === 0) { setErrorForm("Agrega al menos un producto."); toast({ title: "Agrega al menos un producto", variant: "destructive" }); return }
    if (lineasIncompletas) { setErrorForm("Hay líneas sin producto o sin cantidad."); toast({ title: "Hay líneas sin producto o sin cantidad", variant: "destructive" }); return }
    setErrorForm(null)
    setSaving(true)
    try {
      const bodegaOrigenId = selectedBodegaOrigen
      const bodegaOrigenData = bodegasAccesibles.find((b) => b.id === bodegaOrigenId)
      if (!bodegaOrigenId || !bodegaOrigenData) { setErrorForm("Selecciona una bodega origen válida."); setSaving(false); return }

      const productsWithDetails = await Promise.all(
        products.map(async (p) => {
          if (!p.producto) return null
          const weight = await getProductWeight(p.producto)
          const productInfo = allProductos.find((prod) => prod.nombre === p.producto)
          return { categoria: productInfo?.categoria || "Sin categoría", referencia: p.producto, precioUnitario: p.precioUnitario, cantidad: p.cantidad, peso: weight * p.cantidad }
        }),
      )
      const validProductsWithDetails = productsWithDetails.filter((p) => p !== null) as Array<{ categoria: string; referencia: string; precioUnitario: number; cantidad: number; peso: number }>
      const groupedProducts = validProductsWithDetails.reduce((acc, product) => {
        if (!acc[product.categoria]) acc[product.categoria] = []
        acc[product.categoria].push(product)
        return acc
      }, {} as Record<string, typeof validProductsWithDetails>)

      const headerData = {
        fecha: fechaPedido,
        vendedor: selectedVendedor,
        cliente: selectedCliente,
        destino: selectedDestino,
        medio: selectedBodega,
        fecha_programada: fechaProgramada,
        direccion: direccion,
        empresa: bodegaOrigenData.nombre,
        empresafactura: selectedEmpresaFacturaNombre,
        condicion_pago: condicionPago,
        orden_de_compra: ordenCompra,
        pedido: nPedido,
        total_linea: totales.totalOrden,
        total_pagar: totales.totalPagar,
        descuentopp: totales.descuentoPPTotal,
        descuentoiva: totales.descuentoIVATotal,
        tipo_despacho: tipoDespacho,
        pdfpedido: undefined,
      }
      const detailsData = products.map((p) => ({
        categoria: allProductos.find((prod) => prod.nombre === p.producto)?.categoria || "Sin categoría",
        producto: p.producto,
        cantidad: p.cantidad,
        precio_unitario: p.precioUnitario,
        total_linea: p.totalLinea,
        descuento_iva: p.descuentoIVA,
        descuento_pp: p.descuentoPP,
        subtotal: p.subtotal,
      }))

      const result = isEditMode && editOrderId ? await updateOrder(editOrderId, headerData, detailsData, bodegaOrigenId) : await registerOrder(headerData, detailsData, bodegaOrigenId)
      if (!result.success) { setErrorForm(result.message || "Error al guardar el pedido"); toast({ title: "No se pudo guardar", description: result.message, variant: "destructive" }); setSaving(false); return }

      const orderDataForPDF = {
        idpedido: result.idpedido,
        nit: selectedEmpresaNombre,
        carrera: "Not Available",
        fechaPedido: new Date().toLocaleDateString("es-CO"),
        nitCliente: "900653385",
        sucursalMolinos: selectedDestino,
        nombreCliente: selectedCliente,
        direccionEntrega: direccion || selectedDestino,
        ciudadEntrega: selectedDestino.split(",")[0] || selectedDestino,
        asesorComercial: selectedVendedor,
        fechaEntrega: new Date(fechaProgramada).toLocaleDateString("es-CO"),
        condicionPago: condicionPago,
        tipoDespacho: tipoDespacho,
        empresaFactura: selectedEmpresaFacturaNombre,
        groupedProducts: groupedProducts,
        subtotal: totales.totalOrden,
        iva: totales.descuentoIVATotal,
        total: totales.totalPagar,
        kgDespacho: validProductsWithDetails.reduce((sum, p) => sum + p.peso, 0),
        observaciones: observaciones,
      }
      const pdfResult = await generateAndUploadOrderPDF(orderDataForPDF, bodegaOrigenData.nombre)
      if (pdfResult.success && pdfResult.url && result.idpedido) {
        const { error: updateError } = await supabase.from("pedidoscabecera").update({ pdfpedido: pdfResult.url }).eq("idpedido", result.idpedido)
        if (updateError) console.error("[v0] Error updating PDF URL:", updateError)
      }

      const accion = isEditMode ? "actualizado" : "guardado"
      const resumen = `${selectedCliente} · ${products.length} ${products.length === 1 ? "línea" : "líneas"} · ${fmtKg(totales.kilos)} · ${fmtCOP(totales.totalPagar)}`
      setGuardado({ idpedido: Number(result.idpedido), pdfUrl: pdfResult.success && pdfResult.url ? pdfResult.url : null, accion, resumen })
      toast({ title: `Pedido #${result.idpedido} ${accion}`, description: pdfResult.success ? "PDF generado" : "El PDF no se pudo generar; puedes reintentarlo desde Gestionar pedidos" })

      // Mismo comportamiento de siempre: el PDF se abre al guardar.
      if (pdfResult.success && pdfResult.url) {
        const link = document.createElement("a")
        link.href = pdfResult.url
        link.download = `pedido_${result.idpedido || Date.now()}.pdf`
        link.target = "_blank"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
      // Edición desde Gestionar pedidos: vuelve al listado como antes.
      if (isEditMode && onManageOrders) onManageOrders()
    } catch (error) {
      console.error("Error saving order:", error)
      setErrorForm("Error al guardar el pedido")
      toast({ title: "Error al guardar el pedido", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const nuevoPedido = () => {
    setProducts([])
    setDireccion("")
    setOrdenCompra("")
    setNPedido("")
    setCondicionPago("")
    setTipoDespacho("")
    setObservaciones("")
    setSelectedVendedor("")
    setSelectedCliente("")
    setSelectedDestino("")
    setSelectedBodega("")
    setFechaProgramada("")
    setAplicarDescuentoIVA(false)
    setAplicarDescuentoPP(false)
    setDescuentoPPPercent("")
    setSelectedEmpresaNombre("")
    setSelectedEmpresaFacturaNombre("")
    setSelectedClienteId(null)
    setNueva({ categoria: "", producto: "", cantidad: "", precio: "" })
    setSugerido(null)
    setPrecioEsSugerido(false)
    setRepetidos([])
    setGuardado(null)
    setErrorForm(null)
    setFechaPedido(hoyISO())
  }

  // ---------- Carga ----------
  if (loading || loadingOrderData) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <Esqueleto lineas={3} className="max-w-md" />
        <div className="grid gap-4 md:grid-cols-[5fr_4fr_3fr]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="lg-card p-5"><Esqueleto lineas={6} /></div>
          ))}
        </div>
        <div className="lg-card p-5"><Esqueleto lineas={4} /></div>
      </div>
    )
  }

  const campo = "flex flex-col gap-1.5"
  const lbl = "text-[13px] font-medium leading-none"
  const req = <span className="text-red-600">*</span>
  const def = "flex items-center justify-between gap-3 border-t border-border/70 py-2 text-[13px]"
  const pill = (activo: boolean) => cn("h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors", activo ? "border-acento bg-acento text-white" : "border-input bg-background hover:bg-accent")
  const bloqueTitulo = (eyebrow: string, titulo: string) => (
    <div className="flex flex-col gap-1">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-base font-semibold leading-tight">{titulo}</h2>
    </div>
  )
  const usarPills = tiposDespachoList.length > 0 && tiposDespachoList.length <= 4
  const lunes = proximoLunes()

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Pedidos y solicitudes · Entrada de pedidos</Eyebrow>
          <h1 className="text-2xl font-bold leading-tight">{isEditMode ? `Editar pedido #${editOrderId}` : "Nuevo pedido"}</h1>
          <p className="text-[13px] text-muted-foreground">
            {activeEmpresaId ? `ID ${activeEmpresaId} · ` : ""}{selectedBodegaOrigenNombre || proyectoNombre || ""} · {fechaLarga(fechaPedido)}{actor ? ` · registra ${actor}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {guardado ? (
            <Chip tono="ok"><CheckCircle2 className="h-3.5 w-3.5" /> Pedido #{guardado.idpedido} {guardado.accion}</Chip>
          ) : (
            <Chip tono="neutro">{isEditMode ? "Editando" : "Borrador · sin guardar"}</Chip>
          )}
          {irAGestionar && (
            <Button variant="outline" size="sm" onClick={irAGestionar} disabled={saving}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Gestionar pedidos
            </Button>
          )}
        </div>
      </div>

      {/* Aviso al guardar */}
      {guardado && (
        <div className="lg-card flex flex-col gap-3 border-l-4 border-l-emerald-700 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ok-bg text-ok-fg"><CheckCircle2 className="h-4.5 w-4.5" /></span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <strong className="text-[15px] font-semibold">Pedido #{guardado.idpedido} {guardado.accion}{guardado.pdfUrl ? " · PDF generado" : " · sin PDF"}</strong>
              <span className="lg-num text-[13px] text-muted-foreground">{guardado.resumen} · pendiente de aprobación de Cartera</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:pl-11">
            {irAGestionar && <Button size="sm" onClick={irAGestionar}>Ver en Gestionar pedidos</Button>}
            {guardado.pdfUrl && (
              <Button size="sm" variant="outline" asChild>
                <a href={guardado.pdfUrl} target="_blank" rel="noreferrer"><FileText className="mr-1.5 h-4 w-4" /> Abrir PDF</a>
              </Button>
            )}
            {!isEditMode && <Button size="sm" variant="outline" onClick={nuevoPedido}><Plus className="mr-1.5 h-4 w-4" /> Nuevo pedido</Button>}
          </div>
        </div>
      )}

      <fieldset disabled={bloqueado} className="m-0 min-w-0 space-y-5 border-0 p-0">
        {/* Tres bloques */}
        <div className="grid gap-4 md:grid-cols-[5fr_4fr_3fr]">
          {/* QUIÉN */}
          <section className="lg-card flex flex-col gap-3.5 p-5">
            {bloqueTitulo("Quién", "Cliente y origen")}
            <div className={campo}>
              <Label htmlFor="bodega-origen" className={lbl}>Bodega origen {req}</Label>
              <Select value={selectedBodegaOrigen?.toString() || ""} onValueChange={(value) => { const id = Number.parseInt(value, 10); setSelectedBodegaOrigen(id); const b = bodegasAccesibles.find((x) => x.id === id); if (b) setSelectedBodegaOrigenNombre(b.nombre) }}>
                <SelectTrigger id="bodega-origen" className="h-10"><SelectValue placeholder="Seleccione bodega origen" /></SelectTrigger>
                <SelectContent>{bodegasAccesibles.map((b) => <SelectItem key={b.id} value={b.id.toString()}>{b.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className={campo}>
              <Label htmlFor="empresaFactura" className={lbl}>Empresa que factura {req}</Label>
              <Select value={selectedEmpresaFacturaNombre} onValueChange={setSelectedEmpresaFacturaNombre}>
                <SelectTrigger id="empresaFactura" className="h-10"><SelectValue placeholder="Seleccione empresa que factura" /></SelectTrigger>
                <SelectContent>{allOwners.map((o, i) => <SelectItem key={i} value={o.nombre}>{o.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className={campo}>
              <Label htmlFor="vendedor" className={lbl}>Vendedor {req}</Label>
              <Select value={selectedVendedor} onValueChange={setSelectedVendedor}>
                <SelectTrigger id="vendedor" className="h-10"><SelectValue placeholder="Seleccione vendedor" /></SelectTrigger>
                <SelectContent>{vendedores.map((v, i) => <SelectItem key={i} value={v.nombre}>{v.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className={campo}>
              <Label htmlFor="cliente" className={lbl}>Cliente {req}</Label>
              <Popover open={clienteComboOpen} onOpenChange={setClienteComboOpen}>
                <PopoverTrigger asChild>
                  <Button id="cliente" variant="outline" role="combobox" aria-expanded={clienteComboOpen} className={cn("h-10 w-full justify-between bg-transparent font-normal", selectedCliente && "border-acento")}>
                    <span className="flex min-w-0 items-center gap-2"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{selectedCliente || "Buscar cliente…"}</span></span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(400px,calc(100vw-32px))] p-0" align="start" side="bottom" sideOffset={4}>
                  <Command>
                    <CommandInput placeholder="Buscar cliente..." />
                    <CommandList>
                      <CommandEmpty>No se encontró ningún cliente.</CommandEmpty>
                      <CommandGroup>
                        {clientes.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={c.nombre}
                            onSelect={(currentValue) => {
                              // cmdk entrega el value recortado y en minúsculas; hay clientes guardados con espacios de más.
                              const cliente = clientes.find((cl) => cl.nombre.trim().toLowerCase() === currentValue.trim().toLowerCase())
                              if (cliente) {
                                setSelectedCliente(cliente.nombre)
                                setSelectedClienteId(cliente.id)
                                setSelectedBodega("")
                                setSelectedDestino("")
                                setDireccion("")
                              }
                              setClienteComboOpen(false)
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedCliente === c.nombre ? "opacity-100" : "opacity-0")} />
                            {c.nombre}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className={campo}>
              <Label htmlFor="bodega" className={lbl}>Bodega o sucursal del cliente</Label>
              <Select value={selectedBodega} onValueChange={(value) => { setSelectedBodega(value); setSelectedBodegaData(bodegas.find((b) => b.nombrebodega === value) || null) }} disabled={!selectedClienteId || bodegas.length === 0}>
                <SelectTrigger id="bodega" className="h-10"><SelectValue placeholder={!selectedClienteId ? "Elige primero el cliente" : bodegas.length === 0 ? "Sin sucursal · entrega en bodega origen" : "Seleccione sucursal"} /></SelectTrigger>
                <SelectContent>{bodegas.map((b) => <SelectItem key={b.idbodega} value={b.nombrebodega}>{b.nombrebodega}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="mt-1 flex flex-col">
              <div className={def}><b className="font-medium text-muted-foreground">Destino</b><span className="truncate">{selectedDestino || "—"}</span></div>
              <div className={def}><b className="font-medium text-muted-foreground">Dirección</b><span className="truncate">{direccion || "—"}</span></div>
              <p className="mt-1.5 text-xs text-muted-foreground">Se llenan solos al elegir la sucursal.</p>
            </div>
          </section>

          {/* CUÁNDO Y CÓMO */}
          <section className="lg-card flex flex-col gap-3.5 p-5">
            {bloqueTitulo("Cuándo y cómo", "Entrega")}
            <div className={cn(def, "border-t-0 pt-0")}><b className="font-medium text-muted-foreground">Fecha del pedido</b><span className="lg-num">{fechaCorta(fechaPedido)}{fechaPedido === hoyISO() ? " · hoy" : ""}</span></div>
            <div className={campo}>
              <Label htmlFor="fecha-programada" className={lbl}>Fecha programada {req}</Label>
              <DatePickerField id="fecha-programada" value={fechaProgramada} onChange={setFechaProgramada} />
              <div className="flex flex-wrap gap-2 pt-0.5">
                <button type="button" className={pill(fechaProgramada === hoyISO())} onClick={() => setFechaProgramada(hoyISO())}>Hoy</button>
                <button type="button" className={pill(fechaProgramada === sumarDias(hoyISO(), 1))} onClick={() => setFechaProgramada(sumarDias(hoyISO(), 1))}>Mañana</button>
                <button type="button" className={pill(fechaProgramada === lunes)} onClick={() => setFechaProgramada(lunes)}>Lunes {Number(lunes.slice(8, 10))}</button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label className={lbl}>Tipo de despacho {req}</Label>
              {usarPills ? (
                <div className="flex flex-wrap gap-2">
                  {tiposDespachoList.map((t) => (
                    <button key={t.nombretipodespacho} type="button" className={pill(tipoDespacho === t.nombretipodespacho)} onClick={() => setTipoDespacho(t.nombretipodespacho)}>{t.nombretipodespacho}</button>
                  ))}
                </div>
              ) : (
                <Select value={tipoDespacho} onValueChange={setTipoDespacho}>
                  <SelectTrigger id="tipo-despacho" className="h-10"><SelectValue placeholder="Seleccione" /></SelectTrigger>
                  <SelectContent>{tiposDespachoList.map((t) => <SelectItem key={t.nombretipodespacho} value={t.nombretipodespacho}>{t.nombretipodespacho}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
            <div className={campo}>
              <Label htmlFor="condicion-pago" className={lbl}>Condición de pago {req}</Label>
              <Select value={condicionPago} onValueChange={setCondicionPago}>
                <SelectTrigger id="condicion-pago" className="h-10"><SelectValue placeholder="Seleccione" /></SelectTrigger>
                <SelectContent>{condicionesPagoList.map((c) => <SelectItem key={c.nombrecondicion} value={c.nombrecondicion}>{c.nombrecondicion}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </section>

          {/* REFERENCIAS */}
          <section className="lg-card flex flex-col gap-3.5 p-5">
            {bloqueTitulo("Referencias", "Referencias del cliente")}
            <div className={campo}>
              <Label htmlFor="orden-compra" className={lbl}>Orden de compra</Label>
              <Input id="orden-compra" className="h-10" value={ordenCompra} onChange={(e) => setOrdenCompra(e.target.value)} placeholder="Número de la OC del cliente" />
            </div>
            <div className={campo}>
              <Label htmlFor="n-pedido" className={lbl}>N° pedido</Label>
              <div className="relative">
                <Input id="n-pedido" className={cn("h-10", repetidos.length > 0 && "border-amber-600 pr-9")} value={nPedido} onChange={(e) => setNPedido(e.target.value)} placeholder="Número de pedido del cliente" />
                {repetidos.length > 0 && <AlertTriangle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-700" aria-hidden />}
              </div>
              {repetidos.length > 0 && (
                <p className="text-xs leading-snug text-amber-700">
                  Ya existe en {activeEmpresaId ? `ID${empresaParaConsultas}` : "este proyecto"} con este número: pedido #{repetidos[0].idpedido}{repetidos[0].fecha ? ` del ${fechaCorta(String(repetidos[0].fecha).slice(0, 10))}` : ""}{repetidos[0].cliente ? `, ${repetidos[0].cliente}` : ""}{repetidos.length > 1 ? ` y ${repetidos.length - 1} más` : ""}. Es un aviso, puedes continuar.
                </p>
              )}
            </div>
            <div className={campo}>
              <Label htmlFor="observaciones" className={lbl}>Observaciones</Label>
              <Textarea id="observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Instrucciones para cargue, horario o contacto en destino" rows={5} />
            </div>
          </section>
        </div>

        {/* PRODUCTOS */}
        <section className="lg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
            {bloqueTitulo("Productos", "Líneas del pedido")}
            <div className="flex flex-wrap items-center gap-5 text-[13px]">
              <label className="flex items-center gap-2"><Switch checked={aplicarDescuentoIVA} onCheckedChange={(v) => setAplicarDescuentoIVA(v === true)} aria-label="Descuento IVA 5 %" /> Descuento IVA 5 %</label>
              <label className="flex items-center gap-2"><Switch checked={aplicarDescuentoPP} onCheckedChange={(v) => setAplicarDescuentoPP(v === true)} aria-label="Pronto pago" /> Pronto pago</label>
              {aplicarDescuentoPP && (
                <label className="flex items-center gap-2">%<Input type="number" className="h-8 w-20" value={descuentoPPPercent} onChange={(e) => setDescuentoPPPercent(e.target.value)} min="0" max="100" aria-label="Porcentaje de pronto pago" /></label>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3.5 px-5 pb-5 pt-4">
            {/* Fila de captura */}
            <div className="grid items-end gap-2.5 rounded-xl border border-teal-200 bg-teal-50/60 p-3.5 md:grid-cols-[180px_minmax(0,1fr)_120px_150px_160px]">
              <div className={campo}>
                <Label className={lbl}>Categoría</Label>
                <Select value={nueva.categoria} onValueChange={(v) => { setNueva({ categoria: v, producto: "", cantidad: nueva.cantidad, precio: "" }); setSugerido(null); setPrecioEsSugerido(false) }}>
                  <SelectTrigger className="h-10 bg-background"><SelectValue placeholder="Categoría" /></SelectTrigger>
                  <SelectContent>{categorias.map((c) => <SelectItem key={c.nombre} value={c.nombre}>{c.nombre}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className={campo}>
                <Label className={lbl}>Producto</Label>
                <Popover open={nuevaComboOpen} onOpenChange={setNuevaComboOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={nuevaComboOpen} disabled={!nueva.categoria} className={cn("h-10 w-full justify-between bg-background font-normal", nueva.producto && "border-acento")}>
                      <span className="flex min-w-0 items-center gap-2"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{nueva.producto || (nueva.categoria ? "Buscar por nombre…" : "Elige la categoría")}</span></span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[min(420px,calc(100vw-32px))] p-0" side="bottom" sideOffset={4} align="start">
                    <Command>
                      <CommandInput placeholder="Buscar producto..." />
                      <CommandList>
                        <CommandEmpty>No se encontró producto.</CommandEmpty>
                        <CommandGroup>
                          {allProductos.filter((p) => p.categoria === nueva.categoria).map((prod) => (
                            <CommandItem key={prod.nombre} value={prod.nombre} onSelect={() => { setNueva((n) => ({ ...n, producto: prod.nombre, precio: "" })); setPrecioEsSugerido(false); setNuevaComboOpen(false) }}>
                              <Check className={cn("mr-2 h-4 w-4", nueva.producto === prod.nombre ? "opacity-100" : "opacity-0")} />
                              {prod.nombre}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className={campo}>
                <Label className={lbl}>Cantidad</Label>
                <Input type="number" inputMode="numeric" className="h-10 bg-background" min="0" value={nueva.cantidad} onChange={(e) => setNueva((n) => ({ ...n, cantidad: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && agregarLinea()} placeholder="0" />
              </div>
              <div className={campo}>
                <Label className={lbl}>Precio unit.{precioEsSugerido && nueva.precio ? <span className="ml-1.5 text-[11px] font-semibold text-acento">sugerido</span> : null}</Label>
                <Input type="number" inputMode="decimal" className="h-10 bg-background" min="0" value={nueva.precio} onChange={(e) => { setNueva((n) => ({ ...n, precio: e.target.value })); setPrecioEsSugerido(false) }} onKeyDown={(e) => e.key === "Enter" && agregarLinea()} placeholder="$ 0" />
              </div>
              <Button type="button" className="h-10" onClick={agregarLinea} disabled={!nueva.producto || !(Number(nueva.cantidad) > 0)}>
                <Plus className="mr-1.5 h-4 w-4" /> Agregar línea
              </Button>
              {nueva.producto && (
                <p className="lg-num flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-snug text-teal-900 md:col-span-5">
                  <span className="font-semibold">{nueva.producto}</span>
                  {pesoDe(nueva.producto) > 0 ? (
                    <span>{fmtKg(pesoDe(nueva.producto))} por unidad{Number(nueva.cantidad) > 0 ? ` → ${nueva.cantidad} und = ` : ""}{Number(nueva.cantidad) > 0 && <b className="font-semibold">{fmtKg(kilosDe({ producto: nueva.producto, cantidad: nueva.cantidad }))}</b>}</span>
                  ) : (
                    <span>sin peso en el catálogo</span>
                  )}
                  <span className="text-muted-foreground">·</span>
                  {buscandoSugerido ? (
                    <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> buscando último precio…</span>
                  ) : sugerido ? (
                    <span>{sugerido.mismoCliente ? `Último precio a este cliente` : `${selectedCliente ? "Este cliente no lo ha pedido antes · " : ""}Último precio vendido en ID${empresaParaConsultas}`}: <b className="font-semibold">{fmtCOP(sugerido.precio)}</b>{sugerido.fecha ? ` (${fechaCorta(String(sugerido.fecha).slice(0, 10))}, pedido #${sugerido.idpedido})` : ` (pedido #${sugerido.idpedido})`}</span>
                  ) : (
                    <span>Sin precio anterior en este ID</span>
                  )}
                </p>
              )}
            </div>

            {/* Líneas — tabla en escritorio */}
            {products.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Aún no hay líneas. Elige categoría y producto arriba, indica la cantidad y agrega la línea.</p>
            ) : (
              <>
                <div className="hidden overflow-hidden rounded-xl border md:block">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[12px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3.5 py-2.5 text-left font-semibold">#</th>
                        <th className="px-3.5 py-2.5 text-left font-semibold">Producto</th>
                        <th className="px-3.5 py-2.5 text-left font-semibold">Categoría</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">Cantidad</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">Kilos</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">Precio unit.</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">Total línea</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">Descuentos</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold">Subtotal</th>
                        <th className="px-2 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p, i) => (
                        <tr key={p.id} className="border-t">
                          <td className="px-3.5 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-3.5 py-2 font-medium">{p.producto || <span className="text-muted-foreground">(sin producto)</span>}</td>
                          <td className="px-3.5 py-2"><Chip tono="neutro">{p.categoria || "—"}</Chip></td>
                          <td className="px-3.5 py-2 text-right"><Input type="number" className="ml-auto h-8 w-24 text-right" min="0" value={p.cantidad} onChange={(e) => updateProductLine(p.id, "cantidad", Number(e.target.value))} aria-label="Cantidad" /></td>
                          <td className="lg-num px-3.5 py-2 text-right text-muted-foreground">{pesoDe(p.producto) > 0 ? fmtKg(kilosDe(p)) : "—"}</td>
                          <td className="px-3.5 py-2 text-right"><Input type="number" className="ml-auto h-8 w-32 text-right" min="0" value={p.precioUnitario} onChange={(e) => updateProductLine(p.id, "precioUnitario", Number(e.target.value))} aria-label="Precio unitario" /></td>
                          <td className="lg-num px-3.5 py-2 text-right">{fmtCOP(p.totalLinea)}</td>
                          <td className="lg-num px-3.5 py-2 text-right text-muted-foreground">{p.descuentoIVA + p.descuentoPP > 0 ? `− ${fmtCOP(p.descuentoIVA + p.descuentoPP)}` : fmtCOP(0)}</td>
                          <td className="lg-num px-3.5 py-2 text-right font-semibold">{fmtCOP(p.subtotal)}</td>
                          <td className="px-2 py-2"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeProduct(p.id)} aria-label="Quitar línea"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Líneas — tarjetas en celular */}
                <div className="flex flex-col gap-2 md:hidden">
                  {products.map((p) => (
                    <div key={p.id} className="flex flex-col gap-2 rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-sm font-semibold">{p.producto || "(sin producto)"}</span>
                          <span className="lg-num text-xs text-muted-foreground">{p.categoria || "—"} · {p.cantidad} und × {fmtCOP(p.precioUnitario)}</span>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeProduct(p.id)} aria-label="Quitar línea"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input type="number" className="h-9" min="0" value={p.cantidad} onChange={(e) => updateProductLine(p.id, "cantidad", Number(e.target.value))} aria-label="Cantidad" />
                        <Input type="number" className="h-9" min="0" value={p.precioUnitario} onChange={(e) => updateProductLine(p.id, "precioUnitario", Number(e.target.value))} aria-label="Precio unitario" />
                      </div>
                      <div className="flex items-center justify-between border-t pt-2">
                        <Chip tono="neutro">{pesoDe(p.producto) > 0 ? fmtKg(kilosDe(p)) : "sin peso"}</Chip>
                        <span className="lg-num text-[15px] font-semibold">{fmtCOP(p.subtotal)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Kilos = peso unitario del catálogo × cantidad: es el mismo dato que se guarda como kg de despacho, visible antes de guardar. El precio sugerido sale del último pedido de ese producto (primero del mismo cliente, si lo hay); siempre se puede cambiar.</p>
              </>
            )}
          </div>
        </section>
      </fieldset>

      {errorForm && !guardado && (
        <p className="flex items-center gap-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" /> {errorForm}</p>
      )}

      {/* Barra fija de resumen */}
      <div className="lg-card sticky bottom-0 z-10 flex flex-col gap-3 px-4 py-3 shadow-[0_-6px_24px_rgba(11,18,32,.08)] sm:px-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="hidden flex-col gap-0.5 sm:flex"><Eyebrow className="text-muted-foreground">Líneas</Eyebrow><span className="lg-num text-lg font-semibold leading-none">{products.length}</span></div>
          <div className="hidden flex-col gap-0.5 sm:flex"><Eyebrow className="text-muted-foreground">Kilos</Eyebrow><span className="lg-num text-lg font-semibold leading-none">{fmtKg(totales.kilos)}</span></div>
          <div className="hidden flex-col gap-0.5 sm:flex"><Eyebrow className="text-muted-foreground">Subtotal</Eyebrow><span className="lg-num text-lg font-semibold leading-none">{fmtCOP(totales.totalOrden)}</span></div>
          <div className="hidden flex-col gap-0.5 sm:flex"><Eyebrow className="text-muted-foreground">Descuentos</Eyebrow><span className="lg-num text-lg font-semibold leading-none text-muted-foreground">− {fmtCOP(totales.descuentoIVATotal + totales.descuentoPPTotal)}</span></div>
          <div className="hidden h-9 w-px bg-border sm:block" />
          <div className="flex flex-col gap-0.5">
            <Eyebrow>Total a pagar</Eyebrow>
            <span className="lg-num text-[26px] font-bold leading-none">{fmtCOP(totales.totalPagar)}</span>
            <span className="lg-num text-xs text-muted-foreground sm:hidden">{products.length} {products.length === 1 ? "línea" : "líneas"} · {fmtKg(totales.kilos)} · desc. {fmtCOP(totales.descuentoIVATotal + totales.descuentoPPTotal)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {guardado ? (
            <Chip tono="ok"><CheckCircle2 className="h-3.5 w-3.5" /> Guardado</Chip>
          ) : listo ? (
            <Chip tono="ok"><CheckCircle2 className="h-3.5 w-3.5" /> Listo para guardar{avisos ? ` · ${avisos} aviso` : ""}</Chip>
          ) : (
            <Chip tono="atencion" title={faltantes.length ? `Faltan: ${faltantes.join(", ")}` : "Agrega al menos una línea completa"}>
              {faltantes.length ? `Faltan ${faltantes.length}: ${faltantes.slice(0, 2).join(", ")}${faltantes.length > 2 ? "…" : ""}` : products.length === 0 ? "Sin líneas" : "Línea incompleta"}
            </Chip>
          )}
          {irAGestionar && !guardado && (
            <Button variant="outline" className="h-10" onClick={irAGestionar} disabled={saving}>Cancelar</Button>
          )}
          <Button className="h-10 flex-1 md:flex-none" onClick={handleSaveOrder} disabled={bloqueado}>
            {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando…</>) : isEditMode ? "Actualizar y generar PDF" : "Guardar y generar PDF"}
          </Button>
        </div>
      </div>
    </div>
  )
}

export { OrderEntryForm }
export default OrderEntryForm
