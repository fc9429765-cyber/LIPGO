/**
 * A QUIÉN LE LLEGA CADA PASO DEL CICLO DE FACTURACIÓN.
 *
 * Módulo PURO (sin "use server", sin base de datos) para poder probarlo. Lo usan
 * `lib/bandeja-facturacion-actions.ts` (la bandeja del coordinador), la verificación
 * de permisos del ciclo y la campana.
 *
 * EL PROBLEMA QUE RESUELVE (medido el 2026-10-08)
 *
 * El ciclo alterna dos papeles: Cartera LIP (envía el anexo, factura, cierra) y el
 * Coordinador (consigue la firma del cliente sobre el anexo y sobre la factura). Hasta
 * hoy el papel "coordinador" era un PERMISO GLOBAL (`ciclo_facturacion_coordinador`)
 * que tenían solo cuatro personas de administración de LIP —ninguna es coordinadora
 * de un proyecto—. Los coordinadores LIP reales (Indupan, Avimol, CEDI Funza) no
 * tenían ningún papel en el ciclo, así que el anexo "se enviaba" a nadie: 59
 * prefacturas llevaban hasta un mes en el primer paso y el módulo no se usaba.
 *
 * LA REGLA, dicha por gerencia el 2026-10-08
 *
 * "El automatismo, dependiendo de la periodicidad que se escoja, debe enviar los
 * soportes a la bandeja del encargado de cartera LIP y al coordinador de ESE
 * proyecto de LIP."
 *
 * CÓMO SE SABE QUIÉN ES EL COORDINADOR DE UN PROYECTO
 *
 * Por el perfil de autorización «Coordinador LIP» asignado con alcance a ese
 * proyecto (`autorizacion_usuario_perfiles`), que es la misma fuente con la que ya
 * se decide quién autoriza con clave en cada ID. No se inventa una tabla nueva ni se
 * toca un permiso: el coordinador de Indupan ya está declarado como tal.
 */

import type { EstadoCiclo } from "@/lib/ciclo-facturacion-actions"
import { proyectoEntregado } from "@/lib/ciclo-facturacion-shared"

/** Nombre EXACTO del perfil de autorización que identifica al coordinador LIP de un proyecto. */
export const PERFIL_COORDINADOR_LIP = "Coordinador LIP"

/** A quién le toca actuar en cada paso. `null` = el ciclo ya cerró. */
export function papelDelPaso(estado: EstadoCiclo | string | null | undefined): "cartera" | "coordinador" | null {
  switch (estado) {
    case "pendiente_anexo":
    case "pendiente_factura":
    case "pendiente_cierre":
      return "cartera"
    case "pendiente_firma_anexo":
    case "pendiente_firma_factura":
      return "coordinador"
    default:
      return null
  }
}

/** Qué tiene que hacer el coordinador en ese paso, en sus palabras. */
export function tareaDelCoordinador(estado: EstadoCiclo | string | null | undefined): string | null {
  if (estado === "pendiente_firma_anexo") return "Conseguir la firma del cliente sobre el anexo y subirlo firmado"
  if (estado === "pendiente_firma_factura") return "Conseguir la firma del cliente sobre la factura y subirla firmada"
  return null
}

/** Qué evento registra el coordinador al subir el documento firmado en ese paso. */
export function eventoDelCoordinador(estado: EstadoCiclo | string | null | undefined): "anexo_firmado" | "factura_firmada" | null {
  if (estado === "pendiente_firma_anexo") return "anexo_firmado"
  if (estado === "pendiente_firma_factura") return "factura_firmada"
  return null
}

export interface AsignacionPerfil {
  /** Nombre del perfil de autorización, tal como está en `autorizacion_perfiles.nombre`. */
  perfil: string
  /** Alcance: un proyecto, o `null` = todos. */
  idempresa: number | null
  /** `false` si el perfil está desactivado; se ignora. */
  activo?: boolean
}

/**
 * Proyectos en los que esta persona es coordinador LIP, según sus perfiles de
 * autorización. Un perfil con alcance `null` cubre todos los proyectos que se le
 * pasen como universo. Los proyectos ENTREGADOS nunca entran: ya no son de LIPgo.
 */
export function proyectosComoCoordinadorLip(perfiles: readonly AsignacionPerfil[], universo: readonly number[]): number[] {
  const propios = new Set<number>()
  for (const p of perfiles) {
    if (p.activo === false) continue
    if (String(p.perfil ?? "").trim().toLowerCase() !== PERFIL_COORDINADOR_LIP.toLowerCase()) continue
    if (p.idempresa == null) {
      for (const e of universo) propios.add(Number(e))
    } else {
      propios.add(Number(p.idempresa))
    }
  }
  return [...propios].filter((e) => !proyectoEntregado(e)).sort((a, b) => a - b)
}

/** ¿Puede esta persona dar el paso del coordinador sobre una prefactura de `idempresa`? */
export function puedeActuarComoCoordinador(input: {
  /** Permiso global del ciclo (`ciclo_facturacion_coordinador`). */
  permisoGlobal: boolean
  perfiles: readonly AsignacionPerfil[]
  idempresa: number | null | undefined
}): boolean {
  if (input.idempresa != null && proyectoEntregado(input.idempresa)) return false
  if (input.permisoGlobal) return true
  if (input.idempresa == null) return false
  return proyectosComoCoordinadorLip(input.perfiles, [Number(input.idempresa)]).includes(Number(input.idempresa))
}

/** Días completos que una prefactura lleva esperando en su paso actual. */
export function diasEsperando(desdeISO: string | null | undefined, ahora: Date = new Date()): number | null {
  if (!desdeISO) return null
  const t = new Date(desdeISO).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((ahora.getTime() - t) / 86_400_000))
}
