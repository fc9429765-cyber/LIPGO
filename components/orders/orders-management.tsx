"use client"

// GESTIONAR PEDIDOS — cola logística del cliente (rediseño aprobado por gerencia
// 2026-10-03 sobre el lienzo de maquetas). Pedidos es un proceso del CLIENTE: el
// pedido llega aprobado (del CRM de LIP, o por el canal manual de Entrada) y aquí
// se convierte en trabajo para Recepción y Despacho.
//
// Pestañas: Cola · Para mañana · Depurar pendientes · Historial. Las acciones con
// clave (aprobar cartera, aprobar, anular, cerrar pendiente, cierre con factura) y
// la edición usan las MISMAS server actions y el mismo formulario de siempre.

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, FileDown, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Chip, Cifra, Esqueleto, Eyebrow } from "@/components/ui/lipgo"
import { toast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { getColaPedidos, type ColaPedidos, type PedidoCola } from "@/lib/pedidos-cola-actions"
import OrderEntryForm from "./order-entry-form"
import { ColaTab, filtrarCola, ordenarCola, type FiltroCola } from "./gestionar/cola-tab"
import { ParaMananaTab } from "./gestionar/para-manana-tab"
import { DepurarTab } from "./gestionar/depurar-tab"
import { HistorialTab } from "./gestionar/historial-tab"
import { DetallePedido } from "./gestionar/detalle-pedido"
import { AccionesPedidoDialogos, type Accion, type TipoAccion } from "./gestionar/acciones-pedido"
import { MODULO_ENTRADA, MODULO_GENERAR_OC, MODULO_GESTION_OC, NUM, abrirOrdenCargue, fechaCorta, fechaLarga, horaCorta, irAModulo, tTexto } from "./gestionar/formato"

type Pestana = "cola" | "manana" | "depurar" | "historial"

export function OrdersManagement(_props?: { onEditOrder?: (orderId: number) => void; initialTab?: Pestana }) {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const [pestana, setPestana] = useState<Pestana>(_props?.initialTab ?? "cola")
  const [data, setData] = useState<ColaPedidos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actualizadoEn, setActualizadoEn] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroCola>("todos")
  const [detalleId, setDetalleId] = useState<number | null>(null)
  const [accion, setAccion] = useState<Accion | null>(null)
  const [vista, setVista] = useState<"gestion" | "edicion">("gestion")
  const [editOrderId, setEditOrderId] = useState<number | undefined>(undefined)

  const cargar = useCallback(async () => {
    if (!selectedEmpresaId) return
    setCargando(true)
    const r = await getColaPedidos(selectedEmpresaId)
    if (r.success) {
      setData(r.data)
      setError(null)
      setActualizadoEn(new Date().toISOString())
    } else {
      setError(r.message)
    }
    setCargando(false)
  }, [selectedEmpresaId])

  useEffect(() => {
    setData(null)
    setFiltro("todos")
    cargar()
  }, [cargar])

  const resumen = data?.resumen
  const exportarCola = async () => {
    if (!data) return
    const lista = ordenarCola(filtrarCola(data.pedidos, filtro))
    if (lista.length === 0) {
      toast({ title: "No hay datos", description: "No hay pedidos en esta vista para exportar.", variant: "destructive" })
      return
    }
    const XLSX = await import("xlsx")
    const filas = lista.map((p) => ({
      Pedido: p.idpedido,
      "N° cliente": p.pedido || "-",
      "Orden de compra": p.orden_de_compra || "-",
      Cliente: p.cliente,
      Vendedor: p.vendedor || "-",
      Destino: p.destino || "-",
      Despacho: p.tipo_despacho || "-",
      "Condición de pago": p.condicion_pago || "-",
      "Fecha registro": p.fecha,
      Promesa: p.fecha_programada || "-",
      "Días de atraso": p.calc.estado === "programado" && p.calc.atrasoDias > 0 ? p.calc.atrasoDias : "",
      Kilos: p.kg,
      Unidades: p.unidades,
      "Unidades cargadas": p.unidadesCargadas,
      Líneas: p.lineas,
      Estado: p.calc.etiqueta,
      "Siguiente paso": p.calc.siguientePaso?.texto ?? "",
      "Rev. cartera": p.revisioncartera || "-",
      "Rev. gerencia": p.revisiongerencia || "-",
      Aprobado: p.aprobado || "-",
      "Estado en la base": p.estado || "-",
      "Orden de cargue": p.ocargue || "-",
      Vehículo: p.vehiculo || "-",
      "Total a pagar": p.total_pagar,
    }))
    const ws = XLSX.utils.json_to_sheet(filas)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Cola")
    XLSX.writeFile(wb, `Pedidos_cola_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // ── Acciones comunes a todas las pestañas ──
  const abrirAccion = (tipo: TipoAccion, pedido: PedidoCola) => {
    setDetalleId(null)
    setAccion({ tipo, pedido })
  }
  const editar = (p: PedidoCola) => {
    if (p.calc.estado !== "nuevo" || p.calc.conCartera) {
      toast({ title: "No permitido", description: p.calc.conCartera && p.calc.estado === "nuevo" ? "No se puede editar un pedido que ya tiene revisión de cartera." : "No se puede editar un pedido que ya está aprobado.", variant: "destructive" })
      return
    }
    setDetalleId(null)
    setEditOrderId(p.idpedido)
    setVista("edicion")
  }
  const generarOC = (_p: PedidoCola) => irAModulo(MODULO_GENERAR_OC)
  const verOC = (p: PedidoCola) => {
    if (p.ocargue) abrirOrdenCargue(p.ocargue, p.idpedido, p.cliente)
    else irAModulo(MODULO_GESTION_OC)
  }
  const irACola = (f: FiltroCola) => {
    setFiltro(f)
    setPestana("cola")
  }

  if (vista === "edicion") {
    return (
      <OrderEntryForm
        editOrderId={editOrderId}
        onManageOrders={() => {
          setVista("gestion")
          setEditOrderId(undefined)
          cargar()
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Pedidos y solicitudes · Gestionar pedidos</Eyebrow>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Cola logística</h1>
          <p className="lg-num mt-0.5 text-[13px] text-muted-foreground">
            {selectedEmpresaNombre || (selectedEmpresaId ? `ID ${selectedEmpresaId}` : "Selecciona un proyecto")}
            {data ? ` · ${fechaLarga(data.hoy)} · ${NUM.format(data.resumen.abiertos)} pedidos abiertos` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actualizadoEn && <span className="lg-num hidden text-xs text-muted-foreground sm:inline">Actualizado {horaCorta(actualizadoEn)}</span>}
          <Button variant="outline" size="sm" onClick={cargar} disabled={cargando} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} /> Actualizar
          </Button>
          {pestana === "cola" && (
            <Button variant="outline" size="sm" className="hidden gap-1.5 sm:inline-flex" onClick={exportarCola} disabled={!data}>
              <FileDown className="h-3.5 w-3.5" /> Exportar Excel
            </Button>
          )}
          <Button size="sm" className="gap-1.5" onClick={() => irAModulo(MODULO_ENTRADA)}>
            <Plus className="h-3.5 w-3.5" /> Nuevo pedido
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-3 text-sm text-atencion-fg">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> {error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={cargar}>Reintentar</Button>
        </div>
      )}

      {/* FRANJA — seis cifras clicables que abren su vista */}
      {!resumen ? (
        <section className="lg-card grid grid-cols-2 gap-6 p-5 lg:grid-cols-6" aria-busy>
          {Array.from({ length: 6 }).map((_, i) => <Esqueleto key={i} lineas={3} />)}
        </section>
      ) : (
        <section className="lg-card grid grid-cols-2 gap-y-5 p-5 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-6 lg:gap-y-0" aria-label="Resumen de la cola">
          {([
            {
              k: "atrasados",
              label: "Atrasados",
              valor: resumen.atrasados,
              tono: resumen.atrasados > 0 ? "critico" : "ok",
              sub: resumen.atrasados > 0 ? `${NUM.format(resumen.atrasadosRecientes)} de los últimos 15 días · ${NUM.format(resumen.atrasadosViejos)} más antiguos` : "ninguno",
              ir: () => irACola("atrasados"),
            },
            { k: "hoy", label: "Para hoy", valor: resumen.hoy, tono: resumen.hoy > 0 ? "info" : "neutro", sub: resumen.hoy > 0 ? `${NUM.format(resumen.kgHoy)} kg · ${fechaCorta(data!.hoy)}` : "sin pedidos para hoy", ir: () => irACola("hoy") },
            { k: "manana", label: "Para mañana", valor: resumen.manana, tono: "neutro", sub: resumen.manana > 0 ? `${NUM.format(resumen.kgManana)} kg · ${fechaCorta(data!.manana)}` : `${fechaCorta(data!.manana)} sin pedidos · ${NUM.format(resumen.futuros)} programados después`, ir: () => setPestana("manana") },
            { k: "cargue", label: "En cargue / parcial", valor: resumen.enCargue + resumen.parciales, tono: resumen.parciales > 0 ? "atencion" : "neutro", sub: `${NUM.format(resumen.parciales)} parciales · ${NUM.format(resumen.enCargue)} en cargue`, ir: () => irACola("en_cargue") },
            { k: "aprobar", label: "Por aprobar", valor: resumen.porAprobar, tono: "neutro", sub: `canal manual · ${NUM.format(resumen.porAprobarConCartera)} con cartera lista${resumen.sinFecha ? ` · ${resumen.sinFecha} aprobados sin fecha` : ""}`, ir: () => irACola("por_aprobar") },
            { k: "depurar", label: "Candidatos a depurar", valor: resumen.candidatosSinRastro + resumen.candidatosParciales, tono: resumen.candidatosSinRastro + resumen.candidatosParciales > 0 ? "atencion" : "ok", sub: `${NUM.format(resumen.candidatosSinRastro)} sin rastro logístico · ${NUM.format(resumen.candidatosParciales)} parciales viejos`, ir: () => setPestana("depurar") },
          ] as { k: string; label: string; valor: number; tono: "ok" | "atencion" | "critico" | "info" | "neutro"; sub: string; ir: () => void }[]).map((c, i) => (
            <button key={c.k} type="button" onClick={c.ir} className={`rounded-lg text-left transition hover:ring-2 hover:ring-acento-tinte hover:ring-offset-2 ${i < 5 ? "lg:border-r lg:border-border lg:pr-5" : ""} ${i > 0 ? "lg:pl-5" : ""}`} title={`Abrir ${c.label.toLowerCase()}`}>
              <Cifra label={c.label} valor={NUM.format(c.valor)} tono={c.tono} sub={c.sub} />
            </button>
          ))}
        </section>
      )}

      <Tabs value={pestana} onValueChange={(v) => setPestana(v as Pestana)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="cola">Cola{resumen ? ` (${NUM.format(resumen.abiertos)})` : ""}</TabsTrigger>
          <TabsTrigger value="manana">Para mañana{resumen ? ` (${NUM.format(resumen.manana)})` : ""}</TabsTrigger>
          <TabsTrigger value="depurar">Depurar pendientes{resumen ? ` (${NUM.format(resumen.candidatosSinRastro + resumen.candidatosParciales)})` : ""}</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>
      </Tabs>

      {pestana === "cola" &&
        (data ? (
          <ColaTab data={data} filtro={filtro} onFiltro={setFiltro} onVerDetalle={(p) => setDetalleId(p.idpedido)} onAccion={abrirAccion} onEditar={editar} onGenerarOC={generarOC} onVerOC={verOC} onIrDepurar={() => setPestana("depurar")} />
        ) : (
          <div className="lg-card p-5"><Esqueleto lineas={6} /></div>
        ))}
      {pestana === "manana" && data && <ParaMananaTab empresaId={selectedEmpresaId} manana={data.manana} onVerPedidos={(f) => irACola(`fecha:${f}`)} />}
      {pestana === "depurar" && <DepurarTab empresaId={selectedEmpresaId} onDepurado={cargar} onVerDetalle={(id) => setDetalleId(id)} />}
      {pestana === "historial" && <HistorialTab empresaId={selectedEmpresaId} onVerDetalle={(p) => setDetalleId(p.idpedido)} />}

      {data && pestana !== "cola" && resumen && resumen.atrasadosRecientes > 0 && pestana === "manana" && (
        <p className="text-xs text-muted-foreground">
          <Chip tono="critico">{NUM.format(resumen.atrasadosRecientes)} atrasados recientes</Chip> siguen en la Cola{resumen.kgHoy ? ` · hoy ${tTexto(resumen.kgHoy)}` : ""}.
        </p>
      )}

      <DetallePedido empresaId={selectedEmpresaId} idpedido={detalleId} onClose={() => setDetalleId(null)} onAccion={abrirAccion} onEditar={editar} onGenerarOC={generarOC} onVerOC={verOC} />
      <AccionesPedidoDialogos accion={accion} onClose={() => setAccion(null)} onDone={cargar} />
    </div>
  )
}
