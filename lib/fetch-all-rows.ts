// Supabase / PostgREST topan CADA respuesta en 1000 filas (aunque se pida más).
// Para leer tablas grandes se pagina con .range() hasta agotar. `makeQuery(from,to)`
// debe construir la consulta con un `.order()` ESTABLE (idealmente por una columna
// única como id) + `.range(from, to)`, para que las páginas no se solapen ni salten.
//
// Uso indistinto en server actions, route handlers y componentes cliente (es una
// función pura; funciona con cualquier cliente de Supabase).
export async function fetchAllRows<T = any>(
  makeQuery: (from: number, to: number) => any,
): Promise<T[]> {
  const PAGE = 1000
  let offset = 0
  const all: T[] = []
  let ultimaDeLaPagina: string | null = null
  for (;;) {
    const { data, error } = await makeQuery(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []

    // AVISO DE EMPATE EN EL BORDE DE PÁGINA.
    //
    // Comprobado el 2026-10-04 (scripts/verificar_llaves_paginacion.mts): hay fuentes que
    // producen filas IDÉNTICAS en todas sus columnas, como `facturacion` (213 casos) y
    // `archivoplano` (1). Ahí ningún ORDER BY puede desempatar, así que si el corte de
    // página cae justo dentro de un grupo de filas iguales, la base podría devolver una dos
    // veces o saltarse una. El único síntoma observable es que la PRIMERA fila de una página
    // sea idéntica a la ÚLTIMA de la anterior. No se cambia el resultado: solo se hace
    // visible, igual que el detector de truncamiento (lib/supabase-fetch-truncamiento.ts).
    if (ultimaDeLaPagina !== null && batch.length > 0) {
      try {
        if (JSON.stringify(batch[0]) === ultimaDeLaPagina) {
          console.warn(
            `[paginacion] la primera fila de la pagina que empieza en ${offset} es identica a la ultima de la anterior: puede haber filas repetidas o perdidas. Revisa la llave en lib/orden-paginacion.ts. Fila: ${ultimaDeLaPagina.slice(0, 300)}`,
          )
        }
      } catch {
        /* el aviso nunca puede romper la lectura */
      }
    }

    all.push(...batch)
    if (batch.length < PAGE) break
    try {
      ultimaDeLaPagina = JSON.stringify(batch[batch.length - 1])
    } catch {
      ultimaDeLaPagina = null
    }
    offset += PAGE
    if (offset > 500000) break // salvaguarda anti-bucle (nunca esperado en la práctica)
  }
  return all
}
