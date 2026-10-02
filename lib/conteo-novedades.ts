// Novedades del conteo físico → código de corrección (nomenclatura LIPgo).
//
// El contador escribe la novedad en la línea (lote por lote); el revisor, en
// "Diferencias", ve el código que el sistema propone a partir de ese texto y
// lo confirma o lo cambia antes de aplicar. Es la lógica del documento de
// inventario físico de SAP: contar → analizar la diferencia con su causa →
// contabilizar con el tipo de movimiento que corresponde.
//
// Puro: sin acceso a datos, usable en cliente y servidor. Las reglas vienen
// del diccionario editable (tabla sig_conteo_novedad_regla, SQL 214); si no
// hay reglas guardadas se usan las fijas de REGLAS_FIJAS. Decisión de
// gerencia 2026-10-02.

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

/** Regla del diccionario: un patrón (texto simple o /regex/) que lleva a un código. */
export interface ReglaNovedad {
  id?: number
  codigo: string
  /** Texto simple (se busca normalizado) o expresión regular si empieza por "/". */
  patron: string
  etiqueta?: string | null
  orden?: number
}

// Diccionario fijo (semilla del editable). Orden: lo más específico primero.
export const REGLAS_FIJAS: ReglaNovedad[] = [
  { codigo: "344", patron: "cuarentena", etiqueta: "Cuarentena", orden: 10 },
  { codigo: "344", patron: "/\\bcalidad\\b/", etiqueta: "Retenido por calidad", orden: 11 },
  { codigo: "344", patron: "/bloquead|retenid/", etiqueta: "Bloqueado / retenido", orden: 12 },
  { codigo: "309", patron: "cruce de lote", etiqueta: "Cruce de lote", orden: 20 },
  { codigo: "309", patron: "/lote (equivocad|cruzad|cambiad|errad|trocad|incorrect)/", etiqueta: "Lote equivocado", orden: 21 },
  { codigo: "309", patron: "/\\bes del lote\\b|\\botro lote\\b|\\bmal lote\\b|lote mal|cambio de lote|lote diferente/", etiqueta: "Es de otro lote", orden: 22 },
  { codigo: "311", patron: "/mal ubicad|otra ubicaci|ubicaci\\S* (equivocad|errad|incorrect)|cambio de ubicaci/", etiqueta: "Mal ubicado", orden: 30 },
  { codigo: "311", patron: "/\\btraslad|\\bmovid[oa]|\\best(a|aba|an|aban) en [a-z]{1,3}-?\\d|\\ben (otra )?(bodega|estiba|posicion)/", etiqueta: "Está en otra ubicación", orden: 31 },
  { codigo: "653", patron: "/devoluci|devuelt|\\bregres|rechaz|reingres/", etiqueta: "Devolución de cliente", orden: 40 },
  { codigo: "551", patron: "/aver[i]a|\\brot[oa]s?\\b|danad|mojad|\\bmerma|reproces|vencid|contaminad|\\bplaga|humed|rasgad|desperdici|\\bmal estado/", etiqueta: "Avería / merma", orden: 50 },
  { codigo: "702", patron: "/faltante|\\bfalta|de menos|\\brobo\\b|hurto|perdid|no aparec|no esta|no hay/", etiqueta: "Faltante", orden: 60 },
  { codigo: "701", patron: "/sobrante|\\bsobra|de mas\\b|aparecio|encontrad/", etiqueta: "Sobrante", orden: 70 },
]

/** Compila el patrón de una regla: /regex/ o texto simple normalizado (escapado). Null si la regex es inválida. */
export function compilarPatron(patron: string): RegExp | null {
  const p = String(patron ?? "").trim()
  if (!p) return null
  try {
    if (p.startsWith("/")) {
      const fin = p.lastIndexOf("/")
      const cuerpo = fin > 0 ? p.slice(1, fin) : p.slice(1)
      // El texto ya viene normalizado (minúsculas, sin tildes); el patrón se escribe igual.
      return new RegExp(cuerpo, "i")
    }
    const simple = normalizarNovedad(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(simple, "i")
  } catch {
    return null
  }
}

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
 * `reglas`: diccionario editable; si no se pasa (o está vacío) se usan las fijas.
 */
export function proponerCodigo(novedad: string | null | undefined, diferencia: number, reglas?: ReglaNovedad[] | null): PropuestaNovedad {
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
  const lista = (reglas && reglas.length ? reglas : REGLAS_FIJAS).slice().sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100))
  for (const regla of lista) {
    const o = opcionDe(regla.codigo)
    if (!o) continue
    const re = compilarPatron(regla.patron)
    if (!re) continue
    const m = texto.match(re)
    if (!m) continue
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

/** Umbral por defecto (unidades) a partir del cual una corrección del conteo exige clave personal. */
export const UMBRAL_CLAVE_UNIDADES_DEFECTO = 50

/** Código de reverso de una corrección contabilizada (catálogo LIPgo). 309 se reversa con 309 en sentido contrario. */
export function codigoReversoDe(cod: string | null | undefined, direccion: string | null | undefined): { codigo: string; etiqueta: string } | null {
  switch (String(cod ?? "")) {
    case "701":
    case "653":
      return { codigo: "102", etiqueta: "102 · Reverso de ingreso" }
    case "702":
      return { codigo: "602", etiqueta: "602 · Reverso de salida" }
    case "551":
      return { codigo: "552", etiqueta: "552 · Reverso de merma" }
    case "311":
      return { codigo: "312", etiqueta: "312 · Reverso de traslado" }
    case "309":
      return { codigo: "309", etiqueta: `309 · Reclasificación en sentido contrario (${direccion === "salida" ? "vuelve a entrar" : "vuelve a salir"})` }
    default:
      return null // 102/602/552/312 y otros: no se reversan desde aquí
  }
}
