"use client"

// Pestaña "Depurar pendientes": pedidos que nunca se van a entregar. Quedan como
// "no entregado" (o "entrega parcial" si eran parciales) con motivo, quién y cuándo.
// Nunca se borra nada. Requiere clave personal (proceso ped_depurar).
//
// Flujo (gerencia 2026-10-03): las TARJETAS son la entrada; al tocar una se abre su
// lista para trabajarla (paginada, con filtros y selección en bloque); al terminar,
// lo depurado queda consignado en la tarjeta (total, hoy, último). En celular es
// solo lectura.

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRight, Check, Eraser, Loader2, Lock, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Chip, Esqueleto, EstadoVacio, Eyebrow } from "@/components/ui/lipgo"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"
import { toast } from "@/hooks/use-toast"
import { depurarPedidos, getCandidatosDepuracion, type CandidatoDepuracion, type CandidatosDepuracion, type Consignado, type ItemDepuracion, type ResultadoDepuracion } from "@/lib/pedidos-cola-actions"
import { MOTIVOS_DEPURACION, type MotivoDepuracion } from "@/lib/pedidos-estado"
import { NUM, fechaNum, horaCorta, tTexto } from "./formato"

type Lista = "sin_rastro" | "parcial"
type FiltroAnt = "todos" | ">90" | "31-90" | "0-30" | "mes" | "corte" | "pista" | "nunca"
type MotivoClave = MotivoDepuracion["clave"]
const POR_PAGINA = 50

const bucket = (d: number): ">90" | "31-90" | "0-30" => (d > 90 ? ">90" : d > 30 ? "31-90" : "0-30")
const nombreMes = (iso: string) => new Date(`${iso}T12:00:00-05:00`).toLocaleDateString("es-CO", { month: "long", timeZone: "America/Bogota" })

function textoConsignado(c: Consignado): string {
  if (!c.disponible) return "Se verá al correr el SQL 215"
  if (c.total === 0) return "Aún no se ha depurado nada"
  const ult = c.ultimoEn ? ` · último ${fechaNum(c.ultimoEn)} ${horaCorta(c.ultimoEn)}${c.ultimoPor ? ` por ${c.ultimoPor}` : ""}` : ""
  return `${NUM.format(c.total)} depurados${c.hoy ? ` · ${NUM.format(c.hoy)} hoy` : ""}${ult}`
}

export function DepurarTab({ empresaId, onDepurado, onVerDetalle }: { empresaId: number | null; onDepurado: () => void; onVerDetalle: (idpedido: number) => void }) {
  const [data, setData] = useState<CandidatosDepuracion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modo, setModo] = useState<"tarjetas" | "lista">("tarjetas")
  const [lista, setLista] = useState<Lista>("sin_rastro")
  const [filtro, setFiltro] = useState<FiltroAnt>("todos")
  const [busqueda, setBusqueda] = useState("")
  /** Fecha de corte para depurar por tandas ("todo lo anterior a…"). Arranca en el 1.º del mes. */
  const [corte, setCorte] = useState("")
  const [pagina, setPagina] = useState(0)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [motivoLote, setMotivoLote] = useState<MotivoClave>("vencido")
  const [motivos, setMotivos] = useState<Map<number, MotivoClave>>(new Map())
  const [confirmando, setConfirmando] = useState(false)
  const [clave, setClave] = useState("")
  const [errorClave, setErrorClave] = useState("")
  const [trabajando, setTrabajando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoDepuracion | null>(null)

  const cargar = () => {
    if (!empresaId) return
    setData(null)
    setError(null)
    setSel(new Set())
    getCandidatosDepuracion(empresaId).then((r) => {
      if (r.success) setData(r.data)
      else setError(r.message)
    })
  }
  useEffect(cargar, [empresaId]) // eslint-disable-line react-hooks/exhaustive-deps
  // El corte arranca en el primer día del mes en curso: lo de antes es lo que ya no se va a entregar.
  useEffect(() => {
    if (data?.hoy && !corte) setCorte(`${String(data.hoy).slice(0, 7)}-01`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.hoy])

  const candidatos = useMemo(() => (data ? (lista === "sin_rastro" ? data.sinRastro : data.parciales) : []), [data, lista])

  // CORTE POR FECHA. Gerencia (2026-10-04): "depurar todos esos pedidos, los que estén antes de
  // agosto". El botón "Anteriores a <mes>" corta en el mes en curso; esto permite cualquier
  // fecha. La referencia es la misma de la antigüedad: la más reciente entre registro y promesa.
  const fechaRefDe = (c: CandidatoDepuracion) => {
    const reg = String(c.fecha ?? "").slice(0, 10)
    const prom = String(c.fecha_programada ?? "").slice(0, 10)
    return prom && prom > reg ? prom : reg
  }
  const anteriorAlCorte = (c: CandidatoDepuracion) => {
    const f = fechaRefDe(c)
    return !!f && !!corte && f < corte
  }

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return candidatos.filter((c) => {
      if (filtro === "pista" && !c.reemplazadoPor) return false
      if (filtro === "nunca" && !c.pistas.includes("Nunca aprobado")) return false
      if (filtro === "mes" && !c.calc.anteriorAlMes) return false
      if (filtro === "corte" && !anteriorAlCorte(c)) return false
      if ((filtro === ">90" || filtro === "31-90" || filtro === "0-30") && bucket(c.calc.antiguedadDias) !== filtro) return false
      if (q && ![String(c.idpedido), c.pedido, c.orden_de_compra, c.cliente].some((v) => (v ?? "").toLowerCase().includes(q))) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatos, filtro, busqueda, corte])
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const pag = Math.min(pagina, paginas - 1)
  const visibles = filtrados.slice(pag * POR_PAGINA, pag * POR_PAGINA + POR_PAGINA)

  const conteos = useMemo(() => {
    const c = { todos: candidatos.length, ">90": 0, "31-90": 0, "0-30": 0, mes: 0, corte: 0, pista: 0, nunca: 0 } as Record<FiltroAnt, number>
    for (const x of candidatos) {
      c[bucket(x.calc.antiguedadDias)]++
      if (x.calc.anteriorAlMes) c.mes++
      if (anteriorAlCorte(x)) c.corte++
      if (x.reemplazadoPor) c.pista++
      if (x.pistas.includes("Nunca aprobado")) c.nunca++
    }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatos, corte])

  const motivoDe = (c: CandidatoDepuracion): MotivoClave => motivos.get(c.idpedido) ?? c.motivoSugerido ?? motivoLote
  const seleccionados = candidatos.filter((c) => sel.has(c.idpedido))
  const conMotivoPropio = seleccionados.filter((c) => motivoDe(c) !== motivoLote).length
  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const seleccionar = (xs: CandidatoDepuracion[]) => setSel(new Set(xs.map((c) => c.idpedido)))

  const abrirLista = (l: Lista) => {
    setLista(l)
    setFiltro("todos")
    setBusqueda("")
    setPagina(0)
    setSel(new Set())
    setModo("lista")
  }

  const abrirConfirmacion = () => {
    setClave("")
    setErrorClave("")
    setResultado(null)
    setConfirmando(true)
  }

  const confirmar = async () => {
    if (!empresaId || !clave.trim()) return
    setTrabajando(true)
    setErrorClave("")
    const items: ItemDepuracion[] = seleccionados.map((c) => ({
      idpedido: c.idpedido,
      motivo: motivoDe(c),
      detalle: motivoDe(c) === "reemplazado" && c.reemplazadoPor ? `por #${c.reemplazadoPor}` : null,
    }))
    const r = await depurarPedidos({ empresaId, clave, items })
    setTrabajando(false)
    if (!r.success) {
      setErrorClave(r.message)
      return
    }
    setResultado(r.data)
    if (!r.data.simulado) {
      toast({ title: "Depuración aplicada", description: `${NUM.format(r.data.depurados)} pedidos depurados${r.data.omitidos.length ? ` · ${r.data.omitidos.length} omitidos` : ""}.` })
      onDepurado()
      cargar()
      setModo("tarjetas")
    }
  }

  if (error) return <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-4 text-sm text-atencion-fg">{error}</div>
  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="lg-card p-5"><Esqueleto lineas={4} /></div>
        <div className="lg-card p-5"><Esqueleto lineas={4} /></div>
      </div>
    )
  }

  const buckets = (arr: CandidatoDepuracion[]) => ({ v: arr.filter((c) => c.calc.antiguedadDias > 90).length, m: arr.filter((c) => c.calc.antiguedadDias > 30 && c.calc.antiguedadDias <= 90).length, r: arr.filter((c) => c.calc.antiguedadDias <= 30).length })
  const tarjetas: { k: Lista; titulo: string; lista: CandidatoDepuracion[]; sub: string; consignado: Consignado; destino: string }[] = [
    {
      k: "sin_rastro",
      titulo: "Sin rastro logístico · más de 15 días",
      lista: data.sinRastro,
      sub: `${tTexto(data.sinRastro.reduce((s, c) => s + c.kg, 0))} pedidas · ${NUM.format(data.sinRastro.filter((c) => c.reemplazadoPor).length)} con pista de reemplazo · ${NUM.format(data.sinRastro.filter((c) => c.pistas.includes("Nunca aprobado")).length)} nunca aprobados`,
      consignado: data.consignado.sinRastro,
      destino: "Quedan como No entregado",
    },
    {
      k: "parcial",
      titulo: "Parciales · más de 30 días",
      lista: data.parciales,
      sub: `${tTexto(data.parciales.reduce((s, c) => s + c.kg, 0))} pedidas · lo ya cargado se conserva`,
      consignado: data.consignado.parciales,
      destino: "Quedan como Entrega parcial",
    },
  ]
  const actual = tarjetas.find((t) => t.k === lista)!
  const b = buckets(actual.lista)

  // ───────────── Modo tarjetas ─────────────
  if (modo === "tarjetas") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-sm leading-relaxed">
            Pedidos que no se van a entregar: nunca tuvieron orden de cargue, vehículo, lote, inicio ni fin de cargue, ni peso de báscula, y son de meses anteriores o llevan más de 15 días. Toca una tarjeta para trabajar su lista: marca los pedidos, confirma con tu clave y salen de pendientes. Quedan como <b className="font-semibold">No entregado</b> con motivo, quién y cuándo, solo visibles en Historial; lo hecho queda consignado aquí.
          </p>
          <Chip tono="neutro"><Lock className="h-3 w-3" /> Clave personal · Gerencia de proyecto</Chip>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {tarjetas.map((t) => {
            const bb = buckets(t.lista)
            return (
              <button key={t.k} type="button" onClick={() => abrirLista(t.k)} className="lg-card group flex flex-col gap-3 p-5 text-left transition hover:border-acento hover:ring-2 hover:ring-acento-tinte">
                <Eyebrow className="text-muted-foreground">{t.titulo}</Eyebrow>
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className={`lg-num text-[34px] font-bold leading-none tracking-tight ${t.lista.length > 0 ? "text-atencion-fg" : "text-ok-fg"}`}>{NUM.format(t.lista.length)}</span>
                  <span className="text-xs text-muted-foreground">{t.lista.length === 1 ? "candidato" : "candidatos"} · {t.sub}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip tono="critico">más de 90 d · {bb.v}</Chip>
                  <Chip tono="atencion">31–90 d · {bb.m}</Chip>
                  {bb.r > 0 && <Chip tono="neutro">hasta 30 d · {bb.r}</Chip>}
                  <Chip tono="neutro">anteriores a {nombreMes(data.hoy)} · {t.lista.filter((c) => c.calc.anteriorAlMes).length}</Chip>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div className="min-w-0">
                    <Eyebrow className="text-muted-foreground">Consignado</Eyebrow>
                    <p className="lg-num mt-0.5 truncate text-xs" title={textoConsignado(t.consignado)}>{textoConsignado(t.consignado)}</p>
                    <p className="text-[11px] text-muted-foreground">{t.destino}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-acento">
                    Trabajar esta lista <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>
            )
          })}
        </div>
        <ResultadoDialogo resultado={resultado} abierto={confirmando && !!resultado} onClose={() => { setConfirmando(false); setResultado(null) }} />
      </div>
    )
  }

  // ───────────── Modo lista ─────────────
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setModo("tarjetas")}><ArrowLeft className="h-3.5 w-3.5" /> Tarjetas</Button>
          <div>
            <p className="text-sm font-semibold leading-tight">{actual.titulo}</p>
            <p className="lg-num text-xs text-muted-foreground">{NUM.format(actual.lista.length)} candidatos · {actual.destino.toLowerCase()} · {textoConsignado(actual.consignado)}</p>
          </div>
        </div>
        <div className="hidden flex-wrap gap-2 md:flex">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => seleccionar(filtrados)} disabled={filtrados.length === 0}><Check className="h-3.5 w-3.5" /> Seleccionar los {NUM.format(filtrados.length)} filtrados</Button>
          {conteos.mes > 0 && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => seleccionar(actual.lista.filter((c) => c.calc.anteriorAlMes))}>Anteriores a {nombreMes(data.hoy)} ({NUM.format(conteos.mes)})</Button>}
          {b.v > 0 && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => seleccionar(actual.lista.filter((c) => c.calc.antiguedadDias > 90))}>Solo los de más de 90 días ({NUM.format(b.v)})</Button>}
          {/* Corte libre: permite depurar por tandas ("todo lo anterior a agosto") sin depender del mes en curso. */}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Anteriores al
            <Input type="date" value={corte} onChange={(e) => { setCorte(e.target.value); setPagina(0) }} className="h-8 w-[150px]" />
          </label>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={conteos.corte === 0} onClick={() => seleccionar(actual.lista.filter(anteriorAlCorte))}>
            Seleccionar los {NUM.format(conteos.corte)} anteriores a esa fecha
          </Button>
        </div>
      </div>

      {/* Barra de acción: pegada arriba mientras se recorre la lista (no flota al pie,
          donde la barra lateral o LIPbot podían taparla). */}
      {sel.size > 0 ? (
        <div className="sticky top-2 z-20 hidden flex-wrap items-center justify-between gap-3 rounded-2xl bg-marca px-5 py-3 text-white shadow-xl md:flex">
          <div className="flex flex-wrap items-center gap-4">
            <span className="lg-num text-[15px] font-bold">{NUM.format(sel.size)} seleccionados</span>
            <span className="text-sm opacity-85">{NUM.format(conMotivoPropio)} con motivo propio · {NUM.format(sel.size - conMotivoPropio)} con el motivo del lote</span>
            <label className="flex items-center gap-2 text-sm">
              <span className="opacity-85">Motivo del lote</span>
              <Select value={motivoLote} onValueChange={(v) => setMotivoLote(v as MotivoClave)}>
                <SelectTrigger className="h-9 w-[230px] bg-white text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent>{MOTIVOS_DEPURACION.map((x) => <SelectItem key={x.clave} value={x.clave}>{x.texto}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            {sel.size > 2000 && <span className="text-xs text-amber-200">Máximo 2.000 por tanda</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setSel(new Set())}>Quitar selección</Button>
            <Button className="gap-1.5 bg-turquesa text-[#042F2E] hover:bg-turquesa/90" onClick={abrirConfirmacion} disabled={sel.size > 2000}><Lock className="h-4 w-4" /> Depurar {NUM.format(sel.size)} pedidos…</Button>
          </div>
        </div>
      ) : (
        candidatos.length > 0 && (
          <p className="hidden items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground md:flex">
            <Lock className="h-3.5 w-3.5" /> Paso 1: marca los pedidos, elige su motivo o usa "Anteriores a {nombreMes(data.hoy)}". Paso 2: pulsa <b className="font-semibold">Depurar N pedidos</b> en la barra que aparece aquí y confirma con tu clave. Solo entonces salen de pendientes{data.simulaEnEsteEntorno ? " (en esta previsualización solo se simula)" : ""}.
          </p>
        )
      )}

      {candidatos.length === 0 ? (
        <div className="lg-card"><EstadoVacio titulo="No hay candidatos en esta lista" texto="Todos los pedidos abiertos tienen rastro logístico o aún no cumplen la antigüedad." /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(0) }} placeholder="Pedido, N° o cliente" className="h-9 w-[240px] pl-8" />
            </div>
            {([
              ["todos", "Todos"],
              ["mes", `Anteriores a ${nombreMes(data.hoy)}`],
              ...(corte ? ([["corte", `Antes del ${fechaNum(corte)}`]] as [FiltroAnt, string][]) : []),
              [">90", "Más de 90 d"],
              ["31-90", "31–90 d"],
              ["0-30", "Hasta 30 d"],
              ...(lista === "sin_rastro" ? ([["pista", "Con pista"], ["nunca", "Nunca aprobados"]] as [FiltroAnt, string][]) : []),
            ] as [FiltroAnt, string][]).map(([v, et]) => (
              <button key={v} type="button" onClick={() => { setFiltro(v); setPagina(0) }} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${filtro === v ? "border-marca bg-marca text-white" : "border-input bg-background hover:bg-accent"}`}>
                {et} <span className="lg-num">{NUM.format(conteos[v] ?? 0)}</span>
              </button>
            ))}
          </div>

          <div className="lg-card hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2.5"><Checkbox aria-label="Seleccionar la página" checked={visibles.length > 0 && visibles.every((c) => sel.has(c.idpedido))} onCheckedChange={(v) => (v ? setSel(new Set([...sel, ...visibles.map((c) => c.idpedido)])) : setSel(new Set([...sel].filter((id) => !visibles.some((c) => c.idpedido === id)))))} /></th>
                  <th className="px-3 py-2.5 text-left font-semibold">Pedido</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Promesa</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Antig.</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{lista === "parcial" ? "Cargado" : "Kilos"}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Pista</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => {
                  const marcado = sel.has(c.idpedido)
                  const m = motivoDe(c)
                  return (
                    <tr key={c.idpedido} className={`border-t border-border/60 ${marcado ? "bg-acento-tinte/40" : "hover:bg-muted/30"}`}>
                      <td className="px-3 py-2 align-middle"><Checkbox aria-label={`Seleccionar pedido ${c.idpedido}`} checked={marcado} onCheckedChange={() => toggle(c.idpedido)} /></td>
                      <td className="whitespace-nowrap px-3 py-2 align-middle">
                        <button type="button" className="lg-num font-semibold hover:underline" onClick={() => onVerDetalle(c.idpedido)}>#{c.idpedido}</button>
                        <span className="lg-num block text-xs text-muted-foreground">{c.pedido ? `N° ${c.pedido}` : c.orden_de_compra ? `OC ${c.orden_de_compra}` : "sin N°"}</span>
                        <span className="block text-[11px] text-muted-foreground">{c.tipo_despacho || "sin tipo"}{c.destino ? ` · ${c.destino}` : ""}</span>
                      </td>
                      <td className="max-w-[260px] px-3 py-2 align-middle">
                        <span className="block truncate font-medium" title={c.cliente}>{c.cliente}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.vendedor || "—"} · registrado {fechaNum(c.fecha)}</span>
                      </td>
                      <td className="lg-num whitespace-nowrap px-3 py-2 align-middle">{fechaNum(c.fecha_programada)}</td>
                      <td className={`lg-num whitespace-nowrap px-3 py-2 text-right align-middle font-semibold ${c.calc.antiguedadDias > 90 ? "text-critico-fg" : ""}`}>{c.calc.antiguedadDias} d</td>
                      <td className="lg-num whitespace-nowrap px-3 py-2 text-right align-middle">
                        {lista === "parcial" ? (
                          <>
                            <span className="block">{NUM.format(c.unidadesCargadas)} de {NUM.format(c.unidades)} und</span>
                            <span className="block text-xs text-muted-foreground">{NUM.format(c.kg)} kg</span>
                          </>
                        ) : (
                          <>
                            <span className="block">{c.kg > 0 ? `${NUM.format(c.kg)} kg` : "—"}</span>
                            <span className="block text-xs text-muted-foreground">{NUM.format(c.unidades)} und</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {/* Todos los candidatos están sin orden de cargue y casi todos aprobados:
                            solo se muestran las pistas que distinguen un pedido de otro. */}
                        {c.pistas.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {c.pistas.map((p) => <Chip key={p} tono={p.startsWith("Reemplazado") ? "info" : "atencion"}>{p}</Chip>)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <Select
                          value={m}
                          onValueChange={(v) => {
                            // Elegir un motivo también MARCA el pedido: catalogar sin seleccionar no hacía nada.
                            setMotivos((mm) => new Map(mm).set(c.idpedido, v as MotivoClave))
                            setSel((s) => new Set(s).add(c.idpedido))
                          }}
                        >
                          <SelectTrigger className={`h-8 w-[200px] text-xs ${motivos.has(c.idpedido) || c.motivoSugerido ? "border-acento" : ""}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {MOTIVOS_DEPURACION.map((x) => <SelectItem key={x.clave} value={x.clave}>{x.texto}{x.clave === "reemplazado" && c.reemplazadoPor ? ` · #${c.reemplazadoPor}` : ""}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  )
                })}
                {visibles.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">Ningún candidato coincide con el filtro.</td></tr>}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              <span>Antigüedad desde la fecha más reciente entre registro y promesa. Sin motivo propio, el pedido toma el motivo del lote.</span>
              <div className="flex items-center gap-2">
                <span className="lg-num">{NUM.format(filtrados.length)} filtrados · página {pag + 1} de {paginas}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pag === 0} onClick={() => setPagina(pag - 1)}>Anterior</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)}>Siguiente</Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 md:hidden">
            {visibles.map((c) => (
              <article key={c.idpedido} className="lg-card flex flex-col gap-1.5 p-3.5">
                <div className="flex items-center justify-between gap-2"><Chip tono="neutro">{c.calc.antiguedadDias} d</Chip><span className="lg-num text-xs text-muted-foreground">#{c.idpedido}{c.pedido ? ` · N° ${c.pedido}` : ""}</span></div>
                <p className="text-[15px] font-semibold leading-snug">{c.cliente}</p>
                <p className="lg-num text-xs text-muted-foreground">Promesa {fechaNum(c.fecha_programada)} · {NUM.format(c.kg)} kg · {NUM.format(c.unidades)} und{c.pistas.length ? ` · ${c.pistas.join(" · ")}` : ""}</p>
              </article>
            ))}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="lg-num">Página {pag + 1} de {paginas}</span>
              <div className="flex gap-2"><Button size="sm" variant="outline" className="h-8 text-xs" disabled={pag === 0} onClick={() => setPagina(pag - 1)}>Anterior</Button><Button size="sm" variant="outline" className="h-8 text-xs" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)}>Siguiente</Button></div>
            </div>
            <p className="px-1 text-center text-xs text-muted-foreground">En celular, Depurar pendientes es solo lectura: la depuración con clave se hace en escritorio.</p>
          </div>
        </>
      )}

      <Dialog open={confirmando && !resultado} onOpenChange={(o) => !o && !trabajando && setConfirmando(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Depurar {NUM.format(sel.size)} pedidos</DialogTitle>
            <DialogDescription>{actual.titulo} · {data.simulaEnEsteEntorno ? "en esta previsualización solo se simula" : "se aplica con tu clave personal"}</DialogDescription>
          </DialogHeader>
          <dl className="text-sm">
            <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted-foreground">Quedan como</dt><dd><Chip tono="neutro">{lista === "sin_rastro" ? "No entregado" : "Entrega parcial"}</Chip></dd></div>
            <div className="flex justify-between gap-4 border-t border-border py-1.5"><dt className="text-muted-foreground">Motivo del lote</dt><dd className="text-right">{MOTIVOS_DEPURACION.find((m) => m.clave === motivoLote)?.texto} · {NUM.format(sel.size - conMotivoPropio)} pedidos</dd></div>
            <div className="flex justify-between gap-4 border-t border-border py-1.5"><dt className="text-muted-foreground">Con motivo propio</dt><dd className="lg-num text-right">{NUM.format(conMotivoPropio)}</dd></div>
            <div className="flex justify-between gap-4 border-t border-border py-1.5"><dt className="text-muted-foreground">Quién y cuándo</dt><dd className="text-right">Tu usuario, con la fecha y hora de esta confirmación</dd></div>
          </dl>
          <div className="rounded-xl border border-border bg-muted/30 p-3.5 text-sm">
            <p className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-acento" /> Salen de la Cola, de Generar órdenes de cargue y de los pendientes del Inicio.</p>
            <p className="mt-1.5 flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-acento" /> Siguen en Historial con el motivo, quién y cuándo; quedan consignados en la tarjeta.</p>
            <p className="mt-1.5 flex gap-2"><X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> No se borra ningún pedido ni sus líneas; no toca inventario ni órdenes de cargue.</p>
            <p className="mt-1.5 flex gap-2"><X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> Un pedido que ya tenga orden de cargue o vehículo se omite y se informa al final.</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label htmlFor="clave-depurar">Tu clave personal</Label><AyudaClaveAutorizacion /></div>
            <Input id="clave-depurar" type="password" value={clave} onChange={(e) => { setClave(e.target.value); setErrorClave("") }} placeholder="Clave de autorización" disabled={trabajando} autoComplete="off" className={errorClave ? "border-red-500" : ""} />
            {errorClave && <p className="text-xs text-critico-fg">{errorClave}</p>}
            <p className="text-xs text-muted-foreground">Autorizan los perfiles Gerencia de proyecto y Gerencia General LIPgo. Queda registrado quién depuró.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)} disabled={trabajando}>Cancelar</Button>
            <Button onClick={confirmar} disabled={!clave.trim() || trabajando} className="gap-1.5">
              {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
              {data.simulaEnEsteEntorno ? "Simular depuración" : `Depurar ${NUM.format(sel.size)} pedidos`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ResultadoDialogo resultado={resultado} abierto={confirmando && !!resultado} onClose={() => { setConfirmando(false); setResultado(null) }} />
    </div>
  )
}

function ResultadoDialogo({ resultado, abierto, onClose }: { resultado: ResultadoDepuracion | null; abierto: boolean; onClose: () => void }) {
  if (!resultado) return null
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{resultado.simulado ? "Simulación de la depuración" : "Depuración aplicada"}</DialogTitle>
          <DialogDescription>
            {resultado.simulado ? "Esta es una previsualización: no se escribió nada en la base. En producción el mismo botón sí aplica los cambios." : `Autorizó ${resultado.autorizadoPor ?? "tu clave"}. Quedó consignado en la tarjeta.`}
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">{resultado.simulado ? "Quedarían como" : "Quedaron como"} No entregado</dt><dd className="lg-num font-semibold">{NUM.format(resultado.comoNoEntregado)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{resultado.simulado ? "Quedarían como" : "Quedaron como"} Entrega parcial</dt><dd className="lg-num font-semibold">{NUM.format(resultado.comoEntregaParcial)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Omitidos</dt><dd className="lg-num font-semibold">{NUM.format(resultado.omitidos.length)}</dd></div>
        </dl>
        {resultado.omitidos.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
            {resultado.omitidos.map((o) => <li key={o.idpedido}><span className="lg-num font-semibold">#{o.idpedido}</span> · {o.razon}</li>)}
          </ul>
        )}
        <DialogFooter><Button onClick={onClose}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
