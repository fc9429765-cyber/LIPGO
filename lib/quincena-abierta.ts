// ¿La quincena de una fecha todavía se puede modificar?
//
// Regla de gerencia (2026-10-06, armando Apoyo en cargue): el reparto de
// toneladas de una orden se puede corregir de forma retroactiva DENTRO DE LA
// QUINCENA EN CURSO. Las quincenas anteriores ya se pagaron, así que no se
// tocan: cambiar ahí movería un pago que el trabajador ya recibió y que ya salió
// en el archivo plano.
//
// Vive FUERA de los archivos con "use server" a propósito: ahí solo se pueden
// exportar funciones async (ver lib/ajuste-proyeccion-constants.ts). Lo usan las
// server actions del apoyo y también la pantalla, para avisar antes de intentar.

import { rangoQuincena } from "@/lib/ajuste-proyeccion-constants"

export interface QuincenaDeFecha {
  anio: number
  mes: number
  quincena: 1 | 2
  desde: string
  hasta: string
  /** "1 al 15 de octubre de 2026" */
  etiqueta: string
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

/** La quincena a la que pertenece una fecha ISO (YYYY-MM-DD). */
export function quincenaDeFecha(fechaISO: string): QuincenaDeFecha | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaISO || "").trim())
  if (!m) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const quincena: 1 | 2 = dia <= 15 ? 1 : 2
  const { desde, hasta } = rangoQuincena(anio, mes, quincena)
  return {
    anio,
    mes,
    quincena,
    desde,
    hasta,
    etiqueta: `${Number(desde.slice(8))} al ${Number(hasta.slice(8))} de ${MESES[mes - 1]} de ${anio}`,
  }
}

/** Hoy en Colombia (YYYY-MM-DD). */
export function hoyColombiaISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" })
}

export interface EstadoQuincena {
  abierta: boolean
  quincena: QuincenaDeFecha | null
  /** Texto para mostrar cuando NO se puede modificar. */
  motivo: string | null
}

/**
 * ¿La fecha cae en la quincena en curso? `hoyISO` se puede pasar para probar;
 * por defecto es hoy en Colombia.
 *
 * Una fecha FUTURA dentro de la quincena en curso se considera abierta (todavía
 * no se ha pagado); una de una quincena posterior no tiene sentido aquí, pero se
 * deja abierta igual porque tampoco se ha pagado.
 */
export function estadoQuincena(fechaISO: string, hoyISO: string = hoyColombiaISO()): EstadoQuincena {
  const q = quincenaDeFecha(fechaISO)
  const hoy = quincenaDeFecha(hoyISO)
  if (!q || !hoy) return { abierta: false, quincena: q, motivo: "Fecha inválida" }
  if (q.desde === hoy.desde) return { abierta: true, quincena: q, motivo: null }
  if (q.desde > hoy.desde) return { abierta: true, quincena: q, motivo: null }
  return {
    abierta: false,
    quincena: q,
    motivo: `La quincena del ${q.etiqueta} ya se pagó: solo se puede modificar la quincena en curso (${hoy.etiqueta}).`,
  }
}
