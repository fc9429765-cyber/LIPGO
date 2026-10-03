"use server"

// Apoyos de la Entrada de pedidos (rediseño 2026-10-02). Solo lecturas sobre
// pedidoscabecera / pedidosdetalle; no cambian cómo se guarda un pedido.
//
//  - getPrecioSugerido: el catálogo de productos no tiene precios (precio base
//    vacío en todos), así que el vendedor digita de memoria. Se sugiere el
//    último precio vendido de ese producto: primero al mismo cliente y, si no
//    lo ha pedido, en el proyecto (ID). Siempre editable en el formulario.
//  - getPedidosConNumero: en 2026 hay 71 números de pedido repetidos dentro de
//    un mismo ID. Se avisa debajo del campo, sin bloquear.

import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"

export interface PrecioSugerido {
  precio: number
  idpedido: number
  fecha: string | null
  cliente: string | null
  /** true = el precio viene de un pedido del MISMO cliente. */
  mismoCliente: boolean
}

export async function getPrecioSugerido(
  empresaId: number,
  producto: string,
  cliente?: string | null,
): Promise<{ success: boolean; data: PrecioSugerido | null; error?: string }> {
  try {
    if (!empresaId || !producto?.trim()) return { success: true, data: null }
    const sb: any = await getSupabaseAdminAsSystem()
    // Últimas 60 líneas de ese producto en el proyecto con precio > 0, de la más reciente a la más antigua.
    const { data: lineas, error } = await sb
      .from("pedidosdetalle")
      .select("idpedido, precio_und")
      .eq("id_empresa", empresaId)
      .eq("producto", producto)
      .gt("precio_und", 0)
      .order("idpedido", { ascending: false })
      .limit(60)
    if (error) return { success: false, data: null, error: error.message }
    if (!lineas || lineas.length === 0) return { success: true, data: null }
    const ids = [...new Set(lineas.map((l: any) => Number(l.idpedido)))]
    const { data: cabs } = await sb.from("pedidoscabecera").select("idpedido, cliente, fecha").in("idpedido", ids)
    const cabDe = new Map<number, any>((cabs ?? []).map((c: any) => [Number(c.idpedido), c]))
    const norm = (s: any) => String(s ?? "").trim().toLowerCase()
    const buscar = (soloMismoCliente: boolean) => {
      for (const l of lineas as any[]) {
        const c = cabDe.get(Number(l.idpedido))
        if (!c) continue
        if (soloMismoCliente && (!cliente || norm(c.cliente) !== norm(cliente))) continue
        return { precio: Number(l.precio_und), idpedido: Number(l.idpedido), fecha: c.fecha ?? null, cliente: c.cliente ?? null, mismoCliente: soloMismoCliente }
      }
      return null
    }
    const data = (cliente ? buscar(true) : null) ?? buscar(false)
    return { success: true, data }
  } catch (e: any) {
    return { success: false, data: null, error: e?.message || "Error al buscar el precio" }
  }
}

export async function getPedidosConNumero(
  empresaId: number,
  numero: string,
  excluirIdpedido?: number | null,
): Promise<{ success: boolean; data: Array<{ idpedido: number; cliente: string | null; fecha: string | null }> }> {
  try {
    const n = String(numero ?? "").trim()
    if (!empresaId || !n) return { success: true, data: [] }
    const sb: any = await getSupabaseAdminAsSystem()
    let q = sb.from("pedidoscabecera").select("idpedido, cliente, fecha").eq("id_empresa", empresaId).eq("pedido", n).order("idpedido", { ascending: false }).limit(5)
    if (excluirIdpedido) q = q.neq("idpedido", excluirIdpedido)
    const { data, error } = await q
    if (error) return { success: false, data: [] }
    return { success: true, data: (data ?? []).map((r: any) => ({ idpedido: Number(r.idpedido), cliente: r.cliente ?? null, fecha: r.fecha ?? null })) }
  } catch {
    return { success: false, data: [] }
  }
}
