// Detector de TRUNCAMIENTO SILENCIOSO a 1.000 filas.
//
// PostgREST (Supabase) devuelve como máximo 1.000 filas por consulta aunque la
// tabla tenga más, y no da error: la app simplemente ve menos datos (totales
// cortos, filtros incompletos, personas que faltan). La única señal es la
// cabecera `Content-Range: 0-999/*` en la respuesta.
//
// Este `fetch` envuelve al de los clientes de Supabase y, cuando una respuesta
// trae exactamente las filas 0-999 y la consulta NO pidió `.range()` ni
// `.limit()` (parámetros `offset`/`limit` en la URL), deja un aviso en consola
// con la tabla/función y los filtros. No cambia el resultado: solo hace visible
// lo que antes pasaba en silencio, para ir paginando esas consultas
// (ver lib/orden-paginacion.ts y lib/fetch-all-rows.ts).
export function fetchConAvisoTruncamiento(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init).then((res) => {
    try {
      const cr = res.headers.get("content-range")
      // HEAD (conteos con `count: "exact", head: true`) no trae filas: el total
      // viene en la cabecera y es exacto, no hay nada truncado.
      const esHead = String(init?.method ?? (input as Request)?.method ?? "GET").toUpperCase() === "HEAD"
      if (!esHead && cr && /^0-999(\/|$)/.test(cr)) {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
        const url = new URL(raw)
        const pidioRango = url.searchParams.has("limit") || url.searchParams.has("offset")
        if (!pidioRango) {
          url.searchParams.delete("select")
          const donde = url.pathname.replace(/^\/rest\/v1\//, "") + (url.search ? url.search.slice(0, 200) : "")
          console.warn(`[supabase] posible truncamiento a 1.000 filas (sin .range/.limit): ${donde}`)
        }
      }
    } catch {
      // nunca interferir con la respuesta
    }
    return res
  })
}
