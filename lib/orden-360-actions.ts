"use server"

// VISTA 360 DE UNA ORDEN DE CARGUE — para el CLIENTE (gerencia, 2026-10-04).
//
// "Deberíamos tener algo donde ingresemos la orden y realice un 360 de eso: quién la creó,
// cuándo se creó, a qué pedido está ligada, poder ver el pedido, qué carro la llevó, qué día
// cargó, quién la cargó... el sistema debe cerrar el ciclo: qué pidió la orden, qué lotes se
// asignaron y qué se despachó; todo debe coincidir, a no ser que un producto no esté
// disponible, mostrando sin problemas la diferencia, para saber qué se le despachó realmente
// al cliente."
//
// NO toca nada de la facturación de LIP (que se hace por peso de báscula): esto es información
// de la operación del cliente, para que sepa exactamente qué recibió su cliente final.
//
// Las tres fuentes y qué significa cada una:
//   · ORDEN      `detalleoc`  — lo que el cliente autorizó cargar (cantidades, sin lotes).
//   · ASIGNACIÓN `invtrans`   — qué lote y ubicación se eligió para cubrir cada producto.
//   · DESPACHO   `invtrans` aprobadas — lo que de verdad salió del inventario tras el picking.
// Las averías (entradas con status "Averia") explican por qué pudo salir menos.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { accesoPedidos, limitarPorOwners } from "@/lib/acceso-empresa"

const norm = (s: unknown) => String(s ?? "").trim().toUpperCase()
const n0 = (v: unknown) => Number(v) || 0

export interface Linea360 {
  producto: string
  /** Lo que autorizó la orden. */
  pedido: number
  /** Lo que de verdad salió del inventario (salidas aprobadas). */
  despachado: number
  /** Unidades reportadas como avería durante el cargue (explican un despacho menor). */
  averias: number
  diferencia: number
  estado: "cuadra" | "menos" | "mas" | "sin_despachar"
  clientes: string[]
  lotes: { lote: string; location: string; cantidad: number; estiba: number | null; estado: string }[]
}

export interface Pedido360 {
  idpedido: number
  cliente: string | null
  fecha: string | null
  fechaProgramada: string | null
  estado: string | null
  unidades: number
}

export interface Orden360 {
  ordendecargue: string
  empresaId: number
  fecha: string | null
  tipoOperacion: string | null
  estado: string | null
  placa: string | null
  conductor: string | null
  transporte: string | null
  muelle: string | null
  modoCarga: string | null
  /** Quienes cargaron de verdad (auxiliares_real; si no, los planeados). */
  cargaron: string[]
  /** Quién registró la asignación de lotes y quién verificó el picking. */
  asignoLotes: string | null
  tiqueteBascula: string | null
  pesoOrden: number | null
  pesoBascula: number | null
  /** Hitos del día, en orden. Solo los que tienen hora. */
  linea: { paso: string; hora: string }[]
  pedidos: Pedido360[]
  lineas: Linea360[]
  resumen: { pedido: number; despachado: number; averias: number; diferencia: number; cuadra: boolean }
  documentos: { nombre: string; url: string }[]
}

type Resp<T> = { success: true; data: T } | { success: false; message: string }

export async function getOrden360(ordendecargue: string, empresaId: number | null | undefined): Promise<Resp<Orden360>> {
  try {
    const oc = String(ordendecargue ?? "").trim()
    if (!oc) return { success: false, message: "Escribe el número de la orden de cargue." }
    if (!empresaId) return { success: false, message: "Selecciona un proyecto." }

    const sb: any = await getSupabaseAdminAsSystem()
    const acceso = await accesoPedidos(sb, empresaId)
    if (!acceso) return { success: false, message: "No tienes acceso a este proyecto." }

    // --- Cabecera ------------------------------------------------------------------------
    const { data: cab } = await sb
      .from("cabeceraoc")
      .select("*")
      .eq("idempresa", empresaId)
      .eq("ordendecargue", oc)
      .maybeSingle()
    if (!cab) return { success: false, message: `No se encontró la orden ${oc} en este proyecto.` }

    // --- Lo que autorizó la orden --------------------------------------------------------
    const { data: det } = await sb.from("detalleoc").select("producto, cantidad, cliente").eq("idorden", cab.id)

    // --- Movimientos de inventario de esa orden ------------------------------------------
    const { data: mov } = await sb
      .from("invtrans")
      .select("nombreproducto, lote, location, cantidad, tipomov, status, qrestiba, creado, creadopor")
      .eq("ocargue", oc)
      .order("creado", { ascending: true })

    // --- Pedidos ligados -----------------------------------------------------------------
    const { data: pdet } = await limitarPorOwners(
      sb.from("pedidosdetalle").select("idpedido, producto, unidades, unidadescargadas").eq("ocargue", oc),
      acceso,
    )
    const idsPedido = [...new Set((pdet ?? []).map((p: any) => Number(p.idpedido)).filter(Boolean))]
    let pedidos: Pedido360[] = []
    if (idsPedido.length) {
      const { data: pcab } = await sb
        .from("pedidoscabecera")
        .select("idpedido, cliente, fecha, fecha_programada, estado")
        .in("idpedido", idsPedido)
      const unidadesDe = new Map<number, number>()
      for (const p of pdet ?? []) unidadesDe.set(Number(p.idpedido), (unidadesDe.get(Number(p.idpedido)) ?? 0) + n0(p.unidades))
      pedidos = (pcab ?? [])
        .map((c: any) => ({
          idpedido: Number(c.idpedido),
          cliente: c.cliente ?? null,
          fecha: c.fecha ?? null,
          fechaProgramada: c.fecha_programada ?? null,
          estado: c.estado ?? null,
          unidades: unidadesDe.get(Number(c.idpedido)) ?? 0,
        }))
        .sort((a: Pedido360, b: Pedido360) => a.idpedido - b.idpedido)
    }

    // --- Cruce por producto: orden vs despacho -------------------------------------------
    const porProducto = new Map<string, Linea360>()
    const tomar = (producto: string): Linea360 => {
      const k = norm(producto)
      let l = porProducto.get(k)
      if (!l) {
        l = { producto, pedido: 0, despachado: 0, averias: 0, diferencia: 0, estado: "cuadra", clientes: [], lotes: [] }
        porProducto.set(k, l)
      }
      return l
    }
    for (const d of det ?? []) {
      const l = tomar(String(d.producto))
      l.pedido += n0(d.cantidad)
      const cli = String(d.cliente ?? "").trim()
      if (cli && !l.clientes.includes(cli)) l.clientes.push(cli)
    }
    for (const m of mov ?? []) {
      const l = tomar(String(m.nombreproducto))
      const aprobada = String(m.status ?? "").toLowerCase().startsWith("aprob")
      if (m.tipomov === "Salida" && aprobada) l.despachado += n0(m.cantidad)
      if (m.tipomov === "Entrada" && String(m.status ?? "").toLowerCase() === "averia") l.averias += n0(m.cantidad)
      if (m.tipomov === "Salida") {
        l.lotes.push({
          lote: String(m.lote ?? "—"),
          location: String(m.location ?? "—"),
          cantidad: n0(m.cantidad),
          estiba: m.qrestiba != null ? Number(m.qrestiba) : null,
          estado: String(m.status ?? ""),
        })
      }
    }
    const lineas = [...porProducto.values()].map((l) => {
      l.diferencia = Math.round(l.despachado - l.pedido)
      l.estado = l.despachado === 0 ? "sin_despachar" : l.diferencia === 0 ? "cuadra" : l.diferencia < 0 ? "menos" : "mas"
      return l
    })
    lineas.sort((a, b) => (a.estado === b.estado ? a.producto.localeCompare(b.producto) : a.estado === "cuadra" ? 1 : -1))

    const resumen = {
      pedido: lineas.reduce((s, l) => s + l.pedido, 0),
      despachado: lineas.reduce((s, l) => s + l.despachado, 0),
      averias: lineas.reduce((s, l) => s + l.averias, 0),
      diferencia: 0,
      cuadra: false,
    }
    resumen.diferencia = Math.round(resumen.despachado - resumen.pedido)
    resumen.cuadra = resumen.diferencia === 0

    // --- Quién hizo qué ------------------------------------------------------------------
    const auxReal = String(cab.auxiliares_real ?? cab.auxiliares ?? "").trim()
    const cargaron = auxReal ? auxReal.split(",").map((x: string) => x.trim()).filter(Boolean) : []
    const asignoLotes = (mov ?? []).find((m: any) => m.creadopor)?.creadopor ?? null

    // --- Línea de tiempo del día ---------------------------------------------------------
    const hitos: { paso: string; hora: unknown }[] = [
      { paso: "Llegada del vehículo", hora: cab.horavehiculo },
      { paso: "Pesaje inicial", hora: cab.pesajeinicial },
      { paso: "Orden creada", hora: cab.horaorden },
      { paso: "Lotes asignados", hora: cab.horalote },
      { paso: "Picking verificado", hora: cab.horapicking },
      { paso: "Inicio de cargue", hora: cab.iniciocargue },
      { paso: "Fin de cargue", hora: cab.fincargue },
      { paso: "Pesaje final", hora: cab.pesajefinal },
    ]
    const linea = hitos
      .filter((h) => h.hora != null && String(h.hora).trim() !== "")
      .map((h) => ({ paso: h.paso, hora: String(h.hora).slice(0, 8) }))

    // --- Documentos ----------------------------------------------------------------------
    const documentos: { nombre: string; url: string }[] = []
    if (cab.pdfoc) documentos.push({ nombre: "Orden de cargue (PDF)", url: String(cab.pdfoc) })
    if (cab.doccargue) documentos.push({ nombre: "Documento de cargue", url: String(cab.doccargue) })
    for (const campo of ["fotospicking", "comprobante"]) {
      const v = (cab as any)[campo]
      if (!v) continue
      try {
        const arr = typeof v === "string" ? JSON.parse(v) : v
        if (Array.isArray(arr)) arr.forEach((u: string, i: number) => documentos.push({ nombre: campo === "fotospicking" ? `Foto de picking ${i + 1}` : `Comprobante ${i + 1}`, url: u }))
      } catch {
        /* el campo no es una lista: se ignora */
      }
    }

    return {
      success: true,
      data: {
        ordendecargue: oc,
        empresaId,
        fecha: cab.fechacargue ?? cab.fechaorden ?? null,
        tipoOperacion: cab.tipooperacion ?? null,
        estado: cab.status ?? null,
        placa: cab.placa ?? null,
        conductor: cab.conductor ?? null,
        transporte: cab.transporte ?? null,
        muelle: cab.muelle != null ? String(cab.muelle) : null,
        modoCarga: cab.modo_carga ?? null,
        cargaron,
        asignoLotes,
        tiqueteBascula: cab.tiquetebascula != null ? String(cab.tiquetebascula) : null,
        pesoOrden: cab.pesoorden != null ? Number(cab.pesoorden) : null,
        pesoBascula: cab.pesovascula != null ? Number(cab.pesovascula) : null,
        linea,
        pedidos,
        lineas,
        resumen,
        documentos,
      },
    }
  } catch (e: any) {
    console.error("[orden-360] error:", e?.message ?? e)
    return { success: false, message: e?.message || "No se pudo armar el detalle de la orden." }
  }
}
