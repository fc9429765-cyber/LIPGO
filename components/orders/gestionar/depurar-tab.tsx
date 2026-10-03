"use client"

// Pestaña "Depurar pendientes": pedidos que nunca se van a entregar. Quedan como
// "no entregado" (o "entrega parcial" si eran parciales) con motivo, quién y cuándo.
// Nunca se borra nada. Requiere clave personal (proceso ped_depurar). En celular es
// solo lectura.

import { useEffect, useMemo, useState } from "react"
import { Check, Eraser, Loader2, Lock, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Chip, Esqueleto, EstadoVacio, Eyebrow } from "@/components/ui/lipgo"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"
import { toast } from "@/hooks/use-toast"
import { depurarPedidos, getCandidatosDepuracion, type CandidatoDepuracion, type CandidatosDepuracion, type ItemDepuracion, type ResultadoDepuracion } from "@/lib/pedidos-cola-actions"
import { MOTIVOS_DEPURACION, type MotivoDepuracion } from "@/lib/pedidos-estado"
import { NUM, fechaCortaAnio, tTexto } from "./formato"

type Lista = "sin_rastro" | "parcial"
type FiltroAnt = "todos" | ">90" | "31-90" | "16-30" | "pista" | "nunca"
type MotivoClave = MotivoDepuracion["clave"]

const bucket = (d: number) => (d > 90 ? ">90" : d > 30 ? "31-90" : "16-30")

export function DepurarTab({ empresaId, onDepurado, onVerDetalle }: { empresaId: number | null; onDepurado: () => void; onVerDetalle: (idpedido: number) => void }) {
  const [data, setData] = useState<CandidatosDepuracion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lista, setLista] = useState<Lista>("sin_rastro")
  const [filtro, setFiltro] = useState<FiltroAnt>("todos")
  const [busqueda, setBusqueda] = useState("")
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

  const candidatos = useMemo(() => (data ? (lista === "sin_rastro" ? data.sinRastro : data.parciales) : []), [data, lista])
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return candidatos.filter((c) => {
      if (filtro === "pista" && !c.reemplazadoPor) return false
      if (filtro === "nunca" && !c.pistas.includes("Nunca aprobado")) return false
      if ((filtro === ">90" || filtro === "31-90" || filtro === "16-30") && bucket(c.calc.antiguedadDias) !== filtro) return false
      if (q && ![String(c.idpedido), c.pedido, c.orden_de_compra, c.cliente].some((v) => (v ?? "").toLowerCase().includes(q))) return false
      return true
    })
  }, [candidatos, filtro, busqueda])

  const conteos = useMemo(() => {
    const c = { todos: candidatos.length, ">90": 0, "31-90": 0, "16-30": 0, pista: 0, nunca: 0 } as Record<FiltroAnt, number>
    for (const x of candidatos) {
      c[bucket(x.calc.antiguedadDias) as FiltroAnt]++
      if (x.reemplazadoPor) c.pista++
      if (x.pistas.includes("Nunca aprobado")) c.nunca++
    }
    return c
  }, [candidatos])

  const motivoDe = (c: CandidatoDepuracion): MotivoClave => motivos.get(c.idpedido) ?? c.motivoSugerido ?? motivoLote
  const seleccionados = candidatos.filter((c) => sel.has(c.idpedido))
  const conMotivoPropio = seleccionados.filter((c) => motivoDe(c) !== motivoLote).length
  const toggle = (id: number) => setSel((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const seleccionarVisibles = () => setSel(new Set(visibles.map((c) => c.idpedido)))
  const seleccionarViejos = () => setSel(new Set(candidatos.filter((c) => c.calc.antiguedadDias > 90).map((c) => c.idpedido)))

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
    }
  }

  if (error) return <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-4 text-sm text-atencion-fg">{error}</div>
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2"><div className="lg-card p-5"><Esqueleto lineas={3} /></div><div className="lg-card p-5"><Esqueleto lineas={3} /></div></div>
        <div className="lg-card p-5"><Esqueleto lineas={6} /></div>
      </div>
    )
  }

  const kgSinRastro = data.sinRastro.reduce((s, c) => s + c.kg, 0)
  const kgParc = data.parciales.reduce((s, c) => s + c.kg, 0)
  const buckets = (arr: CandidatoDepuracion[]) => ({ v: arr.filter((c) => c.calc.antiguedadDias > 90).length, m: arr.filter((c) => c.calc.antiguedadDias > 30 && c.calc.antiguedadDias <= 90).length, r: arr.filter((c) => c.calc.antiguedadDias <= 30).length })
  const bSin = buckets(data.sinRastro)
  const bPar = buckets(data.parciales)

  return (
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm leading-relaxed">
          Pedidos que no se van a entregar: nunca tuvieron orden de cargue, vehículo, lote, inicio ni fin de cargue, ni peso de báscula. Al depurarlos quedan como <b className="font-semibold">No entregado</b> con motivo, quién y cuándo. <b className="font-semibold">No se borra nada</b>: siguen en Historial y dejan de aparecer en la Cola, en Generar órdenes de cargue y en los pendientes.
        </p>
        <Chip tono="neutro"><Lock className="h-3 w-3" /> Clave personal · Gerencia de proyecto</Chip>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {([
          { k: "sin_rastro" as Lista, titulo: "Sin rastro logístico · más de 15 días", n: data.sinRastro.length, sub: `${tTexto(kgSinRastro)} pedidas · ${data.sinRastro.filter((c) => c.reemplazadoPor).length} con pista de reemplazo · ${data.sinRastro.filter((c) => c.pistas.includes("Nunca aprobado")).length} nunca aprobados`, b: bSin, tono: "text-atencion-fg" },
          { k: "parcial" as Lista, titulo: "Parciales · más de 30 días", n: data.parciales.length, sub: `${tTexto(kgParc)} pedidas · lo ya cargado se conserva; quedan como Entrega parcial`, b: bPar, tono: "" },
        ]).map((t) => (
          <button key={t.k} type="button" onClick={() => { setLista(t.k); setFiltro("todos") }} aria-pressed={lista === t.k} className={`lg-card flex flex-col gap-2 p-5 text-left transition ${lista === t.k ? "border-acento ring-2 ring-acento-tinte" : "hover:border-acento/60"}`}>
            <Eyebrow className="text-muted-foreground">{t.titulo}</Eyebrow>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className={`lg-num text-[34px] font-bold leading-none tracking-tight ${t.n > 0 ? t.tono : ""}`}>{NUM.format(t.n)}</span>
              <span className="text-xs text-muted-foreground">{t.sub}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip tono="critico">más de 90 d · {t.b.v}</Chip>
              <Chip tono="atencion">31–90 d · {t.b.m}</Chip>
              {t.k === "sin_rastro" && <Chip tono="neutro">16–30 d · {t.b.r}</Chip>}
            </div>
          </button>
        ))}
      </div>

      {candidatos.length === 0 ? (
        <div className="lg-card"><EstadoVacio titulo="No hay candidatos en esta lista" texto="Todos los pedidos abiertos tienen rastro logístico o aún no cumplen la antigüedad." /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Pedido, N° o cliente" className="h-9 w-[240px] pl-8" />
              </div>
              {([
                ["todos", "Todos"],
                [">90", "Más de 90 d"],
                ["31-90", "31–90 d"],
                ...(lista === "sin_rastro" ? ([["16-30", "16–30 d"], ["pista", "Con pista"], ["nunca", "Nunca aprobados"]] as const) : []),
              ] as [FiltroAnt, string][]).map(([v, et]) => (
                <button key={v} type="button" onClick={() => setFiltro(v)} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${filtro === v ? "border-marca bg-marca text-white" : "border-input bg-background hover:bg-accent"}`}>
                  {et} <span className="lg-num">{NUM.format(conteos[v] ?? 0)}</span>
                </button>
              ))}
            </div>
            <div className="hidden gap-2 md:flex">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={seleccionarVisibles}><Check className="h-3.5 w-3.5" /> Seleccionar los {NUM.format(visibles.length)} visibles</Button>
              {(lista === "sin_rastro" ? bSin.v : bPar.v) > 0 && (
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={seleccionarViejos}>Solo los de más de 90 días ({NUM.format(lista === "sin_rastro" ? bSin.v : bPar.v)})</Button>
              )}
            </div>
          </div>

          <div className="lg-card hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2.5"><Checkbox aria-label="Seleccionar visibles" checked={visibles.length > 0 && visibles.every((c) => sel.has(c.idpedido))} onCheckedChange={(v) => (v ? seleccionarVisibles() : setSel(new Set()))} /></th>
                  <th className="px-3 py-2.5 text-left font-semibold">Pedido</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Promesa</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Antigüedad</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{lista === "parcial" ? "Cargado / pedido" : "Kilos · und"}</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Estado actual</th>
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
                      <td className="px-3 py-2"><Checkbox aria-label={`Seleccionar pedido ${c.idpedido}`} checked={marcado} onCheckedChange={() => toggle(c.idpedido)} /></td>
                      <td className="px-3 py-2">
                        <button type="button" className="lg-num font-semibold hover:underline" onClick={() => onVerDetalle(c.idpedido)}>#{c.idpedido}</button>
                        <span className="lg-num block text-xs text-muted-foreground">{c.pedido ? `N° ${c.pedido}` : c.orden_de_compra ? `OC ${c.orden_de_compra}` : "sin N°"}{c.destino ? ` · ${c.destino}` : ""}{c.tipo_despacho ? ` · ${c.tipo_despacho}` : ""}</span>
                      </td>
                      <td className="max-w-[280px] px-3 py-2"><span className="block truncate font-medium" title={c.cliente}>{c.cliente}</span><span className="block truncate text-xs text-muted-foreground">{c.vendedor || "—"} · registrado {fechaCortaAnio(c.fecha)}</span></td>
                      <td className="lg-num px-3 py-2">{fechaCortaAnio(c.fecha_programada)}</td>
                      <td className={`lg-num px-3 py-2 text-right font-semibold ${c.calc.antiguedadDias > 90 ? "text-critico-fg" : ""}`}>{c.calc.antiguedadDias} d</td>
                      <td className="lg-num px-3 py-2 text-right">{lista === "parcial" ? `${NUM.format(c.unidadesCargadas)} de ${NUM.format(c.unidades)} und` : `${c.kg > 0 ? NUM.format(c.kg) : "—"} · ${NUM.format(c.unidades)}`}</td>
                      <td className="px-3 py-2"><Chip tono="neutro">{c.pistas.includes("Nunca aprobado") ? "Nunca aprobado" : c.tipo === "parcial" ? "Parcial" : "Aprobado · sin OC"}</Chip></td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {c.pistas.filter((p) => p !== "Nunca aprobado").map((p) => <Chip key={p} tono={p.startsWith("Reemplazado") ? "info" : "atencion"}>{p}</Chip>)}
                          {c.pistas.filter((p) => p !== "Nunca aprobado").length === 0 && <span className="text-muted-foreground">—</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Select value={m} onValueChange={(v) => setMotivos((mm) => new Map(mm).set(c.idpedido, v as MotivoClave))}>
                          <SelectTrigger className={`h-8 w-[220px] text-xs ${motivos.has(c.idpedido) || c.motivoSugerido ? "border-acento" : ""}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {MOTIVOS_DEPURACION.map((x) => <SelectItem key={x.clave} value={x.clave}>{x.texto}{x.clave === "reemplazado" && c.reemplazadoPor ? ` · #${c.reemplazadoPor}` : ""}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">La antigüedad se cuenta desde la fecha más reciente entre el registro y la promesa. Sin motivo propio, el pedido toma el motivo del lote.</p>
          </div>

          <div className="flex flex-col gap-2.5 md:hidden">
            {visibles.slice(0, 50).map((c) => (
              <article key={c.idpedido} className="lg-card flex flex-col gap-1.5 p-3.5">
                <div className="flex items-center justify-between gap-2"><Chip tono="neutro">{c.calc.antiguedadDias} d</Chip><span className="lg-num text-xs text-muted-foreground">#{c.idpedido}{c.pedido ? ` · N° ${c.pedido}` : ""}</span></div>
                <p className="text-[15px] font-semibold leading-snug">{c.cliente}</p>
                <p className="lg-num text-xs text-muted-foreground">Promesa {fechaCortaAnio(c.fecha_programada)} · {NUM.format(c.kg)} kg · {NUM.format(c.unidades)} und{c.pistas.length ? ` · ${c.pistas.join(" · ")}` : ""}</p>
              </article>
            ))}
            <p className="px-1 text-center text-xs text-muted-foreground">En celular, Depurar pendientes es solo lectura: la depuración con clave se hace en escritorio.</p>
          </div>
        </>
      )}

      {sel.size > 0 && (
        <div className="fixed inset-x-3 bottom-3 z-30 hidden flex-wrap items-center justify-between gap-3 rounded-2xl bg-marca px-5 py-3.5 text-white shadow-2xl md:flex lg:inset-x-auto lg:left-1/2 lg:w-[min(1100px,calc(100vw-2rem))] lg:-translate-x-1/2">
          <div className="flex flex-wrap items-center gap-4">
            <span className="lg-num text-[15px] font-bold">{NUM.format(sel.size)} seleccionados</span>
            <span className="text-sm opacity-85">{conMotivoPropio} con motivo propio · {NUM.format(sel.size - conMotivoPropio)} con el motivo del lote</span>
            <label className="flex items-center gap-2 text-sm">
              <span className="opacity-85">Motivo del lote</span>
              <Select value={motivoLote} onValueChange={(v) => setMotivoLote(v as MotivoClave)}>
                <SelectTrigger className="h-9 w-[230px] bg-white text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent>{MOTIVOS_DEPURACION.map((x) => <SelectItem key={x.clave} value={x.clave}>{x.texto}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => setSel(new Set())}>Quitar selección</Button>
            <Button className="gap-1.5 bg-turquesa text-[#042F2E] hover:bg-turquesa/90" onClick={abrirConfirmacion}><Lock className="h-4 w-4" /> Depurar {NUM.format(sel.size)} pedidos…</Button>
          </div>
        </div>
      )}

      <Dialog open={confirmando} onOpenChange={(o) => !o && !trabajando && setConfirmando(false)}>
        <DialogContent className="max-w-lg">
          {resultado ? (
            <>
              <DialogHeader>
                <DialogTitle>{resultado.simulado ? "Simulación de la depuración" : "Depuración aplicada"}</DialogTitle>
                <DialogDescription>
                  {resultado.simulado ? "Esta es una previsualización: no se escribió nada en la base. En producción el mismo botón sí aplica los cambios." : `Autorizó ${resultado.autorizadoPor ?? "tu clave"}.`}
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
              <DialogFooter><Button onClick={() => { setConfirmando(false); if (resultado.simulado) setResultado(null) }}>Cerrar</Button></DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Depurar {NUM.format(sel.size)} pedidos</DialogTitle>
                <DialogDescription>{lista === "sin_rastro" ? "Sin rastro logístico" : "Parciales viejos"} · {data.simulaEnEsteEntorno ? "en esta previsualización solo se simula" : "se aplica con tu clave personal"}</DialogDescription>
              </DialogHeader>
              <dl className="text-sm">
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted-foreground">Quedan como</dt><dd><Chip tono="neutro">{lista === "sin_rastro" ? "No entregado" : "Entrega parcial"}</Chip></dd></div>
                <div className="flex justify-between gap-4 border-t border-border py-1.5"><dt className="text-muted-foreground">Motivo del lote</dt><dd className="text-right">{MOTIVOS_DEPURACION.find((m) => m.clave === motivoLote)?.texto} · {NUM.format(sel.size - conMotivoPropio)} pedidos</dd></div>
                <div className="flex justify-between gap-4 border-t border-border py-1.5"><dt className="text-muted-foreground">Con motivo propio</dt><dd className="lg-num text-right">{NUM.format(conMotivoPropio)}</dd></div>
                <div className="flex justify-between gap-4 border-t border-border py-1.5"><dt className="text-muted-foreground">Quién y cuándo</dt><dd className="text-right">Tu usuario, con la fecha y hora de esta confirmación</dd></div>
              </dl>
              <div className="rounded-xl border border-border bg-muted/30 p-3.5 text-sm">
                <p className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-acento" /> Salen de la Cola, de Generar órdenes de cargue y de los pendientes del Inicio.</p>
                <p className="mt-1.5 flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-acento" /> Siguen en Historial con el motivo, quién y cuándo.</p>
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
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
