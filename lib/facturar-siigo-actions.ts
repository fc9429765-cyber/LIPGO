"use server"

// FACTURAR A SIIGO — LAS ÓRDENES DE UN PERÍODO, LISTAS PARA DECIDIR
//
// La pestaña necesita ver de una vez TODO lo que hay en un período --contado y
// crédito, con su valor real, su owner y si se puede facturar o por qué no--
// para agrupar y emitir desde ahí. Antes esa información estaba repartida:
// el valor en Solicitar Facturas, la agrupación en el Ciclo, el "ya se
// facturó" en la bitácora de emisión.
//
// El VALOR es el mismo que muestra Solicitar Facturas: `valorpago` si ya se
// confirmó la factura, y si no el neto (operación × tarifa). El neto se
// calcula POR EMPRESA porque la tarifa depende de la empresa; es justo lo que
// fallaba en Pagos de Contado con "Todos los proyectos".
//
// Ver lib/siigo-emision-actions.ts para la emisión (una orden, una
// agrupación o una prefactura).

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getAccessibleEmpresesFromPermisos } from "@/lib/orders-actions"
import { getValoresNetosOrden } from "@/lib/facturacion-control-actions"
import { excluirNoFacturable, PLACAS_EXCLUIDAS_FACTURAS } from "@/lib/facturas-exclusiones"
import { medioPagoEsperado } from "@/lib/facturacion-medio-pago"
import { CORTE_CICLO_SIIGO } from "@/lib/ciclo-facturacion-shared"
import { ESTADO_SOLICITADA, type FiltroPeriodo, type MedioFactura, type OrdenFacturable } from "@/lib/facturar-siigo-tipos"

function hoyColombia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export async function listarOrdenesParaFacturar(
  f: FiltroPeriodo,
): Promise<{ success: boolean; data: OrdenFacturable[]; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()

    // El corte manda: lo anterior al 1 de octubre ya se facturó por fuera y
    // mostrarlo aquí invitaría a facturarlo dos veces.
    const desde = f.desde && f.desde > CORTE_CICLO_SIIGO ? f.desde : CORTE_CICLO_SIIGO
    const hasta = f.hasta || hoyColombia()

    const accesibles = (await getAccessibleEmpresesFromPermisos()).map((e) => e.id)
    if (!accesibles.length) return { success: true, data: [] }
    const empresasIds = f.empresaId ? accesibles.filter((id) => id === Number(f.empresaId)) : accesibles
    if (!empresasIds.length) return { success: true, data: [] }

    // Paginado a mano: PostgREST corta en 1.000 filas en silencio, y un mes de
    // todos los proyectos puede pasar de ahí.
    const filas: any[] = []
    for (let from = 0; ; from += 1000) {
      let q = sb
        .from("cabeceraoc")
        .select(
          "id, ordendecargue, fechacargue, placa, transporte, tipooperacion, cliente, mediopago, estadofactura, valorpago, facturasiigo, idempresa",
        )
        .neq("tipooperacion", "proyeccion")
        .in("idempresa", empresasIds)
        .gte("fechacargue", desde)
        .lte("fechacargue", hasta)
        .order("fechacargue", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + 999)
      q = excluirNoFacturable(q)
      const { data, error } = await q
      if (error) throw error
      filas.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }

    // Las placas que LIP no atiende en un proyecto no se facturan. La API las
    // excluye solo cuando hay UNA empresa; aquí hay varias, así que va en JS.
    const sinExcluidas = filas.filter((r) => {
      const ex = (PLACAS_EXCLUIDAS_FACTURAS[Number(r.idempresa)] ?? []).map((p) => p.toUpperCase())
      return !ex.includes(String(r.placa ?? "").trim().toUpperCase())
    })

    const { data: emps } = await sb.from("empresas").select("id, nombre").in("id", empresasIds)
    const nombreEmpresa = new Map<number, string>((emps ?? []).map((e: any) => [Number(e.id), String(e.nombre)]))

    // Neto y owner, por empresa.
    const porEmpresa = new Map<number, any[]>()
    for (const r of sinExcluidas) {
      const k = Number(r.idempresa)
      porEmpresa.set(k, [...(porEmpresa.get(k) ?? []), r])
    }
    const neto = new Map<string, number>()
    const ownersPorOrden = new Map<string, Set<string>>()
    for (const [emp, rs] of porEmpresa) {
      const nums = [...new Set(rs.map((r) => String(r.ordendecargue ?? "").trim()).filter(Boolean))]
      const vn = await getValoresNetosOrden(emp, nums)
      if (vn.success) for (const [k, v] of Object.entries(vn.data)) neto.set(`${emp}|${k}`, Number(v) || 0)
      /*
       * El owner sale de la vista `facturacion` (productos.id_empresa por
       * línea), que es la misma fuente del cuadro, la prefactura y el PDF de
       * la orden. `cabeceraoc.cliente` es texto libre y no sirve para agrupar.
       */
      for (let i = 0; i < nums.length; i += 200) {
        const chunk = nums.slice(i, i + 200)
        const { data } = await sb.from("facturacion").select("numeroorden, owner").eq("idempresa", emp).in("numeroorden", chunk)
        for (const l of data ?? []) {
          const o = String(l.owner ?? "").trim()
          if (!o) continue
          const k = `${emp}|${String(l.numeroorden ?? "").trim()}`
          ownersPorOrden.set(k, (ownersPorOrden.get(k) ?? new Set<string>()).add(o))
        }
      }
    }

    // Lo que ya se emitió desde LIPgo. Tabla chica: se lee entera.
    const { data: emitidas } = await sb.from("siigo_facturas_emitidas").select("ordenes, siigo_nombre").eq("exitosa", true)
    const emitidaDe = new Map<number, string>()
    for (const e of emitidas ?? []) for (const id of e.ordenes ?? []) emitidaDe.set(Number(id), String(e.siigo_nombre ?? "emitida"))

    const data: OrdenFacturable[] = sinExcluidas.map((r) => {
      const emp = Number(r.idempresa)
      const num = String(r.ordendecargue ?? "").trim()
      const k = `${emp}|${num}`
      const owners = [...(ownersPorOrden.get(k) ?? [])]
      const valorpago = Number(r.valorpago ?? 0)
      const valorNeto = neto.get(k) ?? 0
      // Manda lo confirmado; si no hay, el neto. Al revés se pisaría un valor
      // acordado con una estimación.
      const valor = valorpago > 0 ? valorpago : valorNeto

      const mp = String(r.mediopago ?? "").trim()
      const ef = String(r.estadofactura ?? "").trim()
      let medio: MedioFactura = "Sin definir"
      let medioEsperado = false
      if (mp === "Contado" || mp === "Crédito") medio = mp
      else if (ef === "A credito") medio = "Crédito"
      else {
        // Sin medio definido: la regla del proyecto dice qué se espera. Se
        // marca como "esperado" para que la pantalla lo distinga de lo que
        // alguien decidió a mano.
        const esp = medioPagoEsperado(emp, r.transporte, { placa: r.placa, operacion: r.tipooperacion })
        if (esp) {
          medio = esp
          medioEsperado = true
        }
      }

      const emitida = emitidaDe.get(Number(r.id)) ?? null
      // Las mismas reglas de `puedeFacturarOrden`, dichas ANTES de pulsar.
      let motivo: string | null = null
      if (ef !== ESTADO_SOLICITADA) motivo = `Está en "${ef || "sin gestionar"}": solo se factura lo solicitado en Solicitar Facturas`
      else if (String(r.facturasiigo ?? "").trim()) motivo = "Ya tiene factura de Siigo registrada"
      else if (emitida) motivo = `Ya se emitió la factura ${emitida}`
      else if (valor <= 0) motivo = "Sin valor a facturar"

      return {
        id: Number(r.id),
        ordendecargue: num,
        fechacargue: r.fechacargue ?? null,
        idempresa: emp,
        proyecto: nombreEmpresa.get(emp) ?? `Proyecto ${emp}`,
        placa: r.placa ?? null,
        transporte: r.transporte ?? null,
        tipooperacion: r.tipooperacion ?? null,
        cliente: r.cliente ?? null,
        owner: owners[0] ?? (r.cliente ? String(r.cliente) : "(sin owner)"),
        ownerMezclado: owners.length > 1,
        mediopago: r.mediopago ?? null,
        estadofactura: r.estadofactura ?? null,
        facturasiigo: r.facturasiigo ?? null,
        emitidaSiigo: emitida,
        valorpago,
        valorNeto,
        valor,
        medio,
        medioEsperado,
        facturable: motivo === null,
        motivo,
      }
    })

    return { success: true, data }
  } catch (e: any) {
    console.error("[facturar-siigo] listar:", e?.message ?? e)
    return { success: false, data: [], message: e?.message ?? "No se pudieron cargar las órdenes." }
  }
}
