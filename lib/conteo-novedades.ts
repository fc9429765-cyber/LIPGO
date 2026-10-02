// Novedades del conteo físico → código de corrección (nomenclatura LIPgo).
//
// El contador escribe la novedad en la línea (lote por lote); el revisor, en
// "Diferencias", ve el código que el sistema propone a partir de ese texto y
// lo confirma o lo cambia antes de aplicar. Es la lógica del documento de
// inventario físico de SAP: contar → analizar la diferencia con su causa →
// contabilizar con el tipo de movimiento que corresponde.
//
// Puro: sin acceso a datos, usable en cliente y servidor. Decisión de gerencia
// 2026-10-02: diccionario fijo primero; editable desde Configuración después.

export type CodigoNovedad = "701" | "702" | "309" | "311" | "653" | "551" | "344"

export interface OpcionCodigo {
  codigo: CodigoNovedad
  etiqueta: string
  /** Para qué signo de diferencia aplica: sobrante (+), faltante (−) o ambos. */
  aplicaA: "sobrante" | "faltante" | "ambos"
  /** Necesita una línea pareja del mismo producto: otro lote (309) u otra ubicación (311). */
  pareja: "lote" | "ubicacion" | null
  /** Se puede aplicar desde el conteo. 344 (cuarentena) se hace en Transacciones de Inventario. */
  aplicable: boolean
  /** tipo que se guarda en la corrección (postCorreccionInvtrans trata "averia" como Reproceso). */
  tipo: string
}

export const OPCIONES_CODIGO: OpcionCodigo[] = [
  { codigo: "701", etiqueta: "701 · Sobrante", aplicaA: "sobrante", pareja: null, aplicable: true, tipo: "sobrante" },
  { codigo: "702", etiqueta: "702 · Faltante", aplicaA: "faltante", pareja: null, aplicable: true, tipo: "faltante" },
  { codigo: "309", etiqueta: "309 · Cruce de lote (pareja: otro lote)", aplicaA: "ambos", pareja: "lote", aplicable: true, tipo: "reclasificacion" },
  { codigo: "311", etiqueta: "311 · Mal ubicado (pareja: otra ubicación)", aplicaA: "ambos", pareja: "ubicacion", aplicable: true, tipo: "traslado" },
  { codigo: "653", etiqueta: "653 · Devolución de cliente", aplicaA: "sobrante", pareja: null, aplicable: true, tipo: "devolucion" },
  { codigo: "551", etiqueta: "551 · Avería / merma", aplicaA: "faltante", pareja: null, aplicable: true, tipo: "averia" },
  { codigo: "344", etiqueta: "344 · Cuarentena (se aplica en Transacciones)", aplicaA: "ambos", pareja: null, aplicable: false, tipo: "cuarentena" },
]

export function opcionDe(codigo: string | null | undefined): OpcionCodigo | undefined {
  return OPCIONES_CODIGO.find((o) => o.codigo === codigo)
}

/** Minúsculas, sin tildes, espacios colapsados. */
export function normalizarNovedad(texto: string | null | undefined): string {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Orden de prioridad: lo más específico primero. Cada entrada: código y las
// expresiones (ya sin tildes) que lo identifican.
const DICCIONARIO: Array<{ codigo: CodigoNovedad; patrones: RegExp[] }> = [
  { codigo: "344", patrones: [/cuarentena/, /\bcalidad\b/, /bloquead/, /retenid/] },
  { codigo: "309", patrones: [/cruce de lote/, /lote (equivocad|cruzad|cambiad|errad|trocad|incorrect)/, /\bes del lote\b/, /\botro lote\b/, /\bmal lote\b/, /lote mal/, /cambio de lote/, /lote diferente/] },
  { codigo: "311", patrones: [/mal ubicad/, /otra ubicaci/, /ubicaci\S* (equivocad|errad|incorrect)/, /cambio de ubicaci/, /\btraslad/, /\bmovid[oa]/, /\best(a|aba|an|aban) en [a-z]{1,3}-?\d/, /\ben (otra )?(bodega|estiba|posicion)/] },
  { codigo: "653", patrones: [/devoluci/, /devuelt/, /\bregres/, /rechaz/, /reingres/] },
  { codigo: "551", patrones: [/aver[i]a/, /\brot[oa]s?\b/, /danad/, /mojad/, /\bmerma/, /reproces/, /vencid/, /contaminad/, /\bplaga/, /humed/, /rasgad/, /desperdici/, /\bmal estado/] },
  { codigo: "702", patrones: [/faltante/, /\bfalta/, /de menos/, /\brobo\b/, /hurto/, /perdid/, /no aparec/, /no esta/, /no hay/] },
  { codigo: "701", patrones: [/sobrante/, /\bsobra/, /de mas\b/, /aparecio/, /encontrad/] },
]

export interface PropuestaNovedad {
  codigo: CodigoNovedad
  etiqueta: string
  tipo: string
  /** Qué parte de la novedad disparó la propuesta (para mostrarla); null si es el valor por defecto. */
  coincidencia: string | null
  pareja: "lote" | "ubicacion" | null
  aplicable: boolean
  /** Aviso cuando la novedad sugiere un código que no cuadra con el signo de la diferencia. */
  aviso: string | null
}

/**
 * Propone el código para una línea con diferencia a partir de su novedad.
 * Sin novedad o sin coincidencia: 701 si sobra, 702 si falta (como hoy).
 * Si la novedad sugiere un código que no admite ese signo (p. ej. "avería" en
 * un sobrante), se vuelve al código por defecto y se deja el aviso.
 */
export function proponerCodigo(novedad: string | null | undefined, diferencia: number): PropuestaNovedad {
  const signo: "sobrante" | "faltante" = diferencia < 0 ? "faltante" : "sobrante"
  const porDefecto = opcionDe(signo === "faltante" ? "702" : "701")!
  const texto = normalizarNovedad(novedad)
  const base = (o: OpcionCodigo, coincidencia: string | null, aviso: string | null): PropuestaNovedad => ({
    codigo: o.codigo,
    etiqueta: o.etiqueta,
    tipo: o.tipo,
    coincidencia,
    pareja: o.pareja,
    aplicable: o.aplicable,
    aviso,
  })
  if (!texto) return base(porDefecto, null, null)
  for (const entrada of DICCIONARIO) {
    const m = entrada.patrones.map((p) => texto.match(p)).find(Boolean)
    if (!m) continue
    const o = opcionDe(entrada.codigo)!
    if (o.aplicaA !== "ambos" && o.aplicaA !== signo) {
      return base(porDefecto, null, `La novedad sugiere ${o.etiqueta}, pero la línea es un ${signo}; se propone ${porDefecto.etiqueta}.`)
    }
    return base(o, m[0], null)
  }
  return base(porDefecto, null, null)
}

/** Opciones válidas para el selector de una línea según el signo de su diferencia. */
export function opcionesPara(diferencia: number): OpcionCodigo[] {
  const signo = diferencia < 0 ? "faltante" : "sobrante"
  return OPCIONES_CODIGO.filter((o) => o.aplicaA === "ambos" || o.aplicaA === signo)
}
