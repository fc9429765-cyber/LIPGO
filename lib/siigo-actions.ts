"use server"

// ---------------------------------------------------------------------------
// CONSULTA DE FACTURAS DE SIIGO
//
// Lee la facturación de LIP desde la API de Siigo. SOLO LECTURA: no crea, no
// modifica y no anula nada, y así debe seguir. Un error aquí no puede tocar la
// contabilidad.
//
// CADA ACCIÓN COMPRUEBA EL PERMISO. Un server action es un endpoint: se puede
// llamar sin pasar por la pantalla. Sin esta comprobación, cualquiera con
// sesión podría leer toda la facturación de la empresa.
// ---------------------------------------------------------------------------

import { checkModulePermission } from "@/lib/permissions-actions"
import {
  getFactura,
  getFacturaPdf,
  listarFacturas,
  nombreCliente,
  siigoConfigurado,
  type FiltroFacturas,
  type SiigoFactura,
} from "@/lib/siigo"

const MODULO = "Consulta Facturas SIIGO"

async function permitido(): Promise<boolean> {
  try {
    return await checkModulePermission(MODULO)
  } catch {
    // Falla cerrado: sin poder comprobar el permiso, no se entrega nada.
    return false
  }
}

export interface FacturaListada {
  id: string
  numero: number | null
  nombre: string | null
  fecha: string | null
  cliente: string
  identificacion: string | null
  total: number
  saldo: number
  /** true = ya está pagada. */
  pagada: boolean
  moneda: string
  observaciones: string | null
  creada: string | null
}

function aListada(f: SiigoFactura): FacturaListada {
  const total = Number(f.total ?? 0)
  const saldo = Number(f.balance ?? 0)
  return {
    id: f.id,
    numero: f.number ?? null,
    nombre: f.name ?? null,
    fecha: f.date ?? null,
    cliente: nombreCliente(f),
    identificacion: f.customer?.identification ?? null,
    total,
    saldo,
    // Se compara con un centavo de margen: Siigo redondea y un saldo de 0,004
    // no significa que quede algo por cobrar.
    pagada: saldo <= 0.01,
    moneda: f.currency?.code ?? "COP",
    observaciones: f.observations ?? null,
    creada: f.created ?? null,
  }
}

/** Estado de la integración. NO devuelve ninguna credencial. */
export async function getEstadoSiigo(): Promise<{
  configurado: boolean
  faltan: string[]
  conecta: boolean
  message?: string
}> {
  if (!(await permitido())) {
    return { configurado: false, faltan: [], conecta: false, message: "Sin permiso." }
  }

  const cfg = siigoConfigurado()
  if (!cfg.ok) return { configurado: false, faltan: cfg.faltan, conecta: false }

  // Se comprueba contra Siigo de verdad: unas variables puestas con una clave
  // revocada se ven igual de bien que unas correctas.
  const r = await listarFacturas({ page: 1, pageSize: 1 })
  return {
    configurado: true,
    faltan: [],
    conecta: r.ok,
    message: r.ok ? undefined : r.error,
  }
}

/** Una página de facturas, con el filtro de la pantalla. */
export async function buscarFacturas(filtro: FiltroFacturas = {}): Promise<{
  success: boolean
  data?: FacturaListada[]
  total?: number
  pagina?: number
  message?: string
}> {
  if (!(await permitido())) return { success: false, message: "No tienes permiso para este módulo." }

  const r = await listarFacturas(filtro)
  if (!r.ok || !r.data) return { success: false, message: r.error }

  return {
    success: true,
    data: (r.data.results ?? []).map(aListada),
    total: r.data.pagination?.total_results ?? 0,
    pagina: r.data.pagination?.page ?? filtro.page ?? 1,
  }
}

export interface DetalleFactura extends FacturaListada {
  items: Array<{
    codigo: string | null
    descripcion: string | null
    cantidad: number
    precio: number
    descuento: number
    impuestos: Array<{ nombre: string; porcentaje: number; valor: number }>
    total: number
  }>
  pagos: Array<{ nombre: string; valor: number; vence: string | null }>
  centroCosto: number | null
  vendedor: number | null
  actualizada: string | null
}

/** Una factura con todo: items, impuestos y pagos. */
export async function getDetalleFactura(
  id: string,
): Promise<{ success: boolean; data?: DetalleFactura; message?: string }> {
  if (!(await permitido())) return { success: false, message: "No tienes permiso para este módulo." }

  const r = await getFactura(id)
  if (!r.ok || !r.data) return { success: false, message: r.error }

  const f = r.data
  return {
    success: true,
    data: {
      ...aListada(f),
      items: (f.items ?? []).map((i) => ({
        codigo: i.code ?? null,
        descripcion: i.description ?? null,
        cantidad: Number(i.quantity ?? 0),
        precio: Number(i.price ?? 0),
        // Siigo manda el descuento como porcentaje o como valor según cómo se
        // haya capturado; se entrega el valor, que es lo que suma o resta.
        descuento: Number(i.discount?.value ?? 0),
        impuestos: (i.taxes ?? []).map((t) => ({
          nombre: t.name ?? "",
          porcentaje: Number(t.percentage ?? 0),
          valor: Number(t.value ?? 0),
        })),
        total: Number(i.total ?? 0),
      })),
      pagos: (f.payments ?? []).map((p) => ({
        nombre: p.name ?? "",
        valor: Number(p.value ?? 0),
        vence: p.due_date ?? null,
      })),
      centroCosto: f.cost_center ?? null,
      vendedor: f.seller ?? null,
      actualizada: f.last_updated ?? null,
    },
  }
}

/**
 * El PDF de una factura, en base64.
 *
 * Va en base64 porque un server action no devuelve binario; la pantalla lo
 * convierte para descargarlo.
 */
export async function getPdfFactura(
  id: string,
): Promise<{ success: boolean; pdf?: string; cufe?: string | null; message?: string }> {
  if (!(await permitido())) return { success: false, message: "No tienes permiso para este módulo." }

  const r = await getFacturaPdf(id)
  if (!r.ok || !r.base64) return { success: false, message: r.error }
  return { success: true, pdf: r.base64, cufe: r.cufe }
}
