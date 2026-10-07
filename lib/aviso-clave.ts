// AVISO DE CLAVE DE AUTORIZACIÓN PENDIENTE. Parte pura, sin base de datos ni React.
//
// POR QUÉ EXISTE
//
// Las claves compartidas de transición vencen en una fecha concreta. Ese día, quien no
// tenga clave PERSONAL deja de poder autorizar en su proyecto: aprobar cartera, aprobar y
// anular pedidos, cerrar pendientes, aprobar movimientos de inventario, liberar cuarentena.
// Es decir, se le cae la operación.
//
// Medido el 2026-10-07, a 20 días del cierre: de 21 personas con perfil de autorización
// asignado, 19 NO tenían clave. Y **ninguna de las 19 tiene correo real registrado**, así
// que no se les puede escribir: las cuentas @lipgo.app no son buzones. Pero 18 de las 19 sí
// entran a la app, y dos habían entrado ese mismo día.
//
// O sea: el único canal que funciona es la propia aplicación. Y el aviso que había vivía
// dentro del menú del avatar, donde llevaba desde el 27 de septiembre sin que nadie lo
// viera. De ahí este módulo: el aviso tiene que estar a la vista y decir cuántos días
// faltan, porque "pendiente" sin fecha no mueve a nadie.

export type MotivoAviso = "sin_clave" | "provisional"

export type TonoAviso = "info" | "atencion" | "critico"

export interface Aviso {
  tono: TonoAviso
  titulo: string
  texto: string
  boton: string
  /** Días que faltan para el cierre. Negativo si ya pasó. `null` si no hay fecha. */
  dias: number | null
  /** Un aviso crítico no se puede posponer: vuelve a aparecer siempre. */
  sePuedePosponer: boolean
}

/** Días completos entre dos fechas `YYYY-MM-DD`. Positivo si `hasta` está en el futuro. */
export function diasHasta(hasta: string | null | undefined, hoy: string): number | null {
  const h = String(hasta ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h) || !/^\d{4}-\d{2}-\d{2}$/.test(hoy)) return null
  const ms = Date.UTC(+h.slice(0, 4), +h.slice(5, 7) - 1, +h.slice(8, 10)) - Date.UTC(+hoy.slice(0, 4), +hoy.slice(5, 7) - 1, +hoy.slice(8, 10))
  return Math.round(ms / 86400000)
}

const plural = (n: number, uno: string, varios: string) => (Math.abs(n) === 1 ? uno : varios)

/**
 * Qué mostrarle a una persona que tiene autorizaciones asignadas y aún no tiene su clave.
 *
 * El tono sube con la cercanía del cierre, y a partir de una semana el aviso deja de poder
 * posponerse. No es un adorno: pasada la fecha, esa persona no puede trabajar.
 */
export function avisoDeClave(motivo: MotivoAviso | null, hasta: string | null | undefined, hoy: string): Aviso | null {
  if (!motivo) return null
  const dias = diasHasta(hasta, hoy)

  const queEs =
    motivo === "sin_clave"
      ? "Todavía no has creado tu clave de autorización."
      : "Tu clave de autorización es provisional y tienes que cambiarla por una tuya."
  const boton = motivo === "sin_clave" ? "Crear mi clave" : "Cambiar mi clave"

  // Sin fecha de cierre no se puede meter prisa, pero el aviso se muestra igual.
  if (dias === null) {
    return { tono: "atencion", titulo: "Te falta tu clave de autorización", texto: `${queEs} Sin ella no podrás autorizar en tu proyecto.`, boton, dias: null, sePuedePosponer: true }
  }

  if (dias < 0) {
    const d = Math.abs(dias)
    return {
      tono: "critico",
      titulo: "No puedes autorizar: te falta tu clave",
      texto: `${queEs} Las claves compartidas vencieron hace ${d} ${plural(d, "día", "días")}, así que ahora mismo no puedes aprobar, anular ni cerrar nada en tu proyecto.`,
      boton,
      dias,
      sePuedePosponer: false,
    }
  }

  if (dias === 0) {
    return {
      tono: "critico",
      titulo: "Hoy vence el plazo de tu clave",
      texto: `${queEs} Las claves compartidas dejan de servir HOY. Si no creas la tuya, mañana no podrás autorizar nada en tu proyecto.`,
      boton,
      dias,
      sePuedePosponer: false,
    }
  }

  if (dias <= 7) {
    return {
      tono: "critico",
      titulo: `Te ${plural(dias, "queda", "quedan")} ${dias} ${plural(dias, "día", "días")} para crear tu clave`,
      texto: `${queEs} Cuando venzan las claves compartidas no podrás aprobar, anular ni cerrar nada en tu proyecto. Toma un minuto.`,
      boton,
      dias,
      sePuedePosponer: false,
    }
  }

  return {
    tono: "atencion",
    titulo: "Te falta tu clave de autorización",
    texto: `${queEs} Las claves compartidas dejan de servir en ${dias} días. Crear la tuya toma un minuto y evita quedarte sin poder autorizar.`,
    boton,
    dias,
    sePuedePosponer: true,
  }
}
