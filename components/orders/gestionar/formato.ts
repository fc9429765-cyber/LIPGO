// Utilidades de presentación de Gestionar pedidos (código puro, lado cliente).
import type { EstadoDerivado } from "@/lib/pedidos-estado"
import type { RegistroEncontrado } from "@/lib/buscar-registros-actions"

export const NUM = new Intl.NumberFormat("es-CO")
export const T1 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 })
export const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

const enBogota = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00-05:00`)

/** "jue 2 oct" */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—"
  return enBogota(iso).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Bogota" }).replace(/\./g, "")
}

/** "jue 2 oct 2026" */
export function fechaCortaAnio(iso: string | null | undefined): string {
  if (!iso) return "—"
  return enBogota(iso).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" }).replace(/\./g, "")
}

/** "viernes 3 de octubre de 2026" */
export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return ""
  return enBogota(iso).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" })
}

/** Hora corta de un timestamp ISO, en Bogotá: "14:35". */
export function horaCorta(ts: string | null | undefined): string {
  if (!ts) return ""
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" })
}

/** Texto relativo a la promesa: "hace 2 días", "hoy", "mañana", "en 3 días". */
export function relativoPromesa(calc: EstadoDerivado, tienePromesa: boolean): string {
  if (!tienePromesa) return "sin fecha"
  if (calc.atrasoDias > 0) return calc.atrasoDias === 1 ? "hace 1 día" : `hace ${calc.atrasoDias} días`
  if (calc.esHoy) return "hoy"
  if (calc.esManana) return "mañana"
  const n = -calc.atrasoDias
  return `en ${n} días`
}

export function kgTexto(kg: number): string {
  return `${NUM.format(Math.round(kg))} kg`
}

export function tTexto(kg: number): string {
  return `${T1.format(kg / 1000)} t`
}

// ── Saltos entre módulos (los mismos eventos que ya usan Operación del día y el buscador) ──

export const MODULO_ENTRADA = "Entrada de pedidos"
export const MODULO_GENERAR_OC = "Generar Órdenes de Cargue"
export const MODULO_GESTION_OC = "Gestión de Ordenes"
export const MODULO_PROGRAMACION = "Programación del cliente"

/** Abre otro módulo. El destino conserva su propio PermissionGuard. */
export function irAModulo(nombre: string) {
  window.dispatchEvent(new CustomEvent("lipgo:navigate-module", { detail: nombre }))
}

/** Abre Gestión de Ordenes filtrada por el número de la orden de cargue. */
export function abrirOrdenCargue(ocargue: string, idpedido: number, cliente: string) {
  const detail: RegistroEncontrado = {
    tipo: "orden",
    id: `oc-${ocargue}`,
    titulo: ocargue,
    subtitulo: `Pedido #${idpedido} · ${cliente}`,
    modulo: MODULO_GESTION_OC,
    busqueda: ocargue,
    periodo: "todo",
  }
  window.dispatchEvent(new CustomEvent("lipgo:abrir-registro", { detail }))
}
