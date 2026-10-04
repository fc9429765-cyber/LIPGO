"use server"

// Acumulados LIPgo: LIPgo construye su PROPIO reporte de acumulados, en el
// mismo formato de columnas que el archivo real de Siigo (ver tabla
// `acumulados_siigo`, cargada 2026-09-09) -- Identificación, Nombre, No
// contrato, Periodo (Q1/Q2), Mes, Año, Centro de costo, Origen, Novedad,
// Tipo, Horas/Días, Valor total. Pedido explícito del usuario: "los próximos
// acumulados deben salir de acá de LIPgo, en adelante no habrá otra fuente
// de información" -- este módulo es el que los CONSTRUYE, no un comparador.
//
// Fuente: `pagonomina` día a día (mismo motor ya reconciliado con Siigo en
// esta sesión: sin órdenes fantasma, incapacidad al % editable, etc.) más
// `parametros_legales_vigencia` para el auxilio de transporte y la jornada.
// El bono de destajo usa la MISMA lógica de piso $0 por quincena que
// `archivoplano` (agrupado por idempresa_home vía headcount, no por ID
// trabajado).
//
// Alcance de esta primera versión (deliberado, documentado -- no oculto):
// Sueldo, bono de destajo (52/71 según fecha), incapacidades, vacaciones
// disfrutadas, licencia no remunerada/remunerada, horas extra (07/08/10/11/
// 12/25/26), auxilio de transporte, Fondo de salud/pensión (4%+4%). NO
// incluye: comisiones, licencia de maternidad/paternidad (rara, no hay caso
// real para verificar la fórmula), salario integral, bonos del módulo
// Compensación›Bonos (esos ya tienen su propio flujo, ver bonos_nomina).

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { clasificarDiaCotizacion } from "@/lib/parafiscales"

export interface FilaAcumuladoLIPgo {
  identificacion: string
  nombre_empleado: string
  no_contrato: string | null
  periodo: "Q1" | "Q2"
  mes: number
  anio: number
  centro_costo: string
  origen: "LIPgo"
  novedad: string
  tipo: "Ingreso" | "Deducción"
  horas_dias: number | null
  valor_total: number
}

const CENTRO_COSTO_POR_ID: Record<number, string> = {
  1: "Harinera Indupan Bta",
  2: "La Insuperable Bquilla",
  3: "Harinera Indupan Funza",
  4: "Molinos Medellin",
}

// Mismo corte que pagonomina/archivoplano: desde el 16-jul-2026 el bono de
// destajo viaja como "52-Bonificación Por Productividad", antes como
// "71-Bonificación Ajuste Toneladas" -- ver 053_pagonomina_reemplazo.sql.
function nombreNovedadDestajo(fechaCierreQuincena: string): string {
  return fechaCierreQuincena >= "2026-07-16" ? "52-Bonificación Por Productividad" : "71-Bonificación Ajuste Toneladas"
}

// `makeQuery` construye la consulta completa (fuente + filtros + un `.order`
// ÚNICO y estable, ver lib/orden-paginacion.ts); aquí solo se pagina.
async function fetchAllRows(makeQuery: () => any): Promise<any[]> {
  let all: any[] = []
  let from = 0
  while (true) {
    const { data, error } = await makeQuery().range(from, from + 999)
    if (error) throw new Error(error.message)
    all = all.concat(data || [])
    if (!data || data.length < 1000) break
    from += 1000
  }
  return all
}

/** Ejecuta `fn` sobre `items` con a lo sumo `limite` en vuelo; resultados en el MISMO orden. */
async function enParalelo<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let siguiente = 0
  const trabajador = async () => {
    for (;;) {
      const i = siguiente++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador))
  return out
}

function finDeQuincena(anio: number, mes: number, q: 1 | 2): string {
  if (q === 1) return `${anio}-${String(mes).padStart(2, "0")}-15`
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return `${anio}-${String(mes).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`
}

export async function getAcumuladosLIPgo(
  idempresa: number,
  anio: number,
  mesDesde: number,
  mesHasta: number,
): Promise<{ success: boolean; data: FilaAcumuladoLIPgo[]; message?: string }> {
  if (!idempresa || !anio || !mesDesde || !mesHasta) return { success: false, data: [], message: "Filtros incompletos." }
  try {
    const admin: any = await getSupabaseAdmin()
    const desde = `${anio}-${String(mesDesde).padStart(2, "0")}-01`
    const ultimoMesHasta = new Date(Date.UTC(anio, mesHasta, 0)).getUTCDate()
    const hasta = `${anio}-${String(mesHasta).padStart(2, "0")}-${String(ultimoMesHasta).padStart(2, "0")}`

    // 1) Personal del proyecto (activo hoy, o retirado dentro/después del rango).
    const { data: hc, error: hcErr } = await admin
      .from("headcount")
      .select("identificacion, nombre, contratosiigo, fecha_retiro, estado")
      .eq("idempresa", idempresa)
    if (hcErr) return { success: false, data: [], message: hcErr.message }
    const personas = (hc || []).filter(
      (h: any) => !h.fecha_retiro || String(h.fecha_retiro) >= desde,
    )
    if (personas.length === 0) return { success: true, data: [] }
    const nombres = personas.map((h: any) => String(h.nombre).trim())
    const infoPorNombre = new Map<string, { identificacion: string; contratosiigo: string }>()
    for (const h of personas) {
      infoPorNombre.set(String(h.nombre).trim(), {
        identificacion: String(h.identificacion || "").trim(),
        contratosiigo: String(h.contratosiigo || "").trim(),
      })
    }

    // 2) Parámetros legales por vigencia (auxilio, jornada) -- por fecha.
    const { data: vigencias } = await admin
      .from("parametros_legales_vigencia")
      .select("fecha_desde, auxilio_transporte, jornada_horas")
      .order("fecha_desde", { ascending: true })
    const vigenciaEnFecha = (fecha: string) => {
      let v = { auxilio_transporte: 249095, jornada_horas: 7 }
      for (const row of vigencias || []) {
        if (String(row.fecha_desde) <= fecha) v = row
        else break
      }
      return v
    }

    // 3) pagonomina día a día del rango.
    const cols =
      "fecha, persona, novedad_reportada, actividad_registrada, base_dia, hed, hedf, hen, hef, hn, recargodominical, recargo_dominical_tasa_completa, bonif_prestacional, toneladas, total_liquidado_dia"
    // pagonomina_rango: la misma nómina que la vista, calculada solo para el
    // rango (scripts/200); orden (persona, fecha) para paginar sin repetir filas.
    //
    // RENDIMIENTO (gerencia 2026-10-03, "acumulados se tarda tanto"): la función es
    // un conjunto calculado, así que CADA página de 1.000 filas la vuelve a ejecutar
    // completa. Medido: una quincena ~0,9 s, un mes ~1,2 s, enero–septiembre ~5,8 s por
    // página; un año de una empresa son 25+ páginas → minutos. Por eso se consulta MES
    // POR MES (cada llamada liviana, 2–3 páginas) y hasta 4 meses en paralelo. Mismas
    // columnas, mismos filtros y mismo orden: el resultado es idéntico, solo más rápido.
    const meses: { desde: string; hasta: string }[] = []
    for (let m = mesDesde; m <= mesHasta; m++) {
      const ultimo = new Date(Date.UTC(anio, m, 0)).getUTCDate()
      meses.push({ desde: `${anio}-${String(m).padStart(2, "0")}-01`, hasta: `${anio}-${String(m).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}` })
    }
    const porMes = await enParalelo(meses, 4, (mes) =>
      fetchAllRows(() =>
        admin
          .rpc("pagonomina_rango", { p_desde: mes.desde, p_hasta: mes.hasta })
          .select(cols)
          .in("persona", nombres)
          .gte("fecha", mes.desde)
          .lte("fecha", mes.hasta)
          .order("persona")
          .order("fecha"),
      ),
    )
    const rows = porMes.flat()
    const rowsPorPersona = new Map<string, any[]>()
    for (const r of rows) {
      const nombre = String(r.persona).trim()
      if (!infoPorNombre.has(nombre)) continue
      const arr = rowsPorPersona.get(nombre) || []
      arr.push(r)
      rowsPorPersona.set(nombre, arr)
    }

    const salida: FilaAcumuladoLIPgo[] = []
    const centroCosto = CENTRO_COSTO_POR_ID[idempresa] || `ID${idempresa}`

    for (const [nombre, info] of infoPorNombre) {
      const rowsPersona = rowsPorPersona.get(nombre) || []
      if (rowsPersona.length === 0) continue

      // Agrupar por quincena.
      const porQuincena = new Map<string, any[]>()
      for (const r of rowsPersona) {
        const f = String(r.fecha)
        const mes = Number(f.slice(5, 7))
        const dia = Number(f.slice(8, 10))
        const q = dia <= 15 ? 1 : 2
        const key = `${f.slice(0, 4)}-${String(mes).padStart(2, "0")}-Q${q}`
        const arr = porQuincena.get(key) || []
        arr.push(r)
        porQuincena.set(key, arr)
      }

      for (const [key, diasQuincena] of porQuincena) {
        const [anioQ, mesQ, qTxt] = key.split("-")
        const periodo = qTxt as "Q1" | "Q2"
        const quincena = qTxt === "Q1" ? 1 : 2
        const fechaCierre = finDeQuincena(Number(anioQ), Number(mesQ), quincena as 1 | 2)

        const agregar = (novedad: string, tipo: "Ingreso" | "Deducción", horas_dias: number | null, valor_total: number) => {
          if (Math.round(valor_total) === 0 && (horas_dias == null || horas_dias === 0)) return
          salida.push({
            identificacion: info.identificacion,
            nombre_empleado: nombre,
            no_contrato: info.contratosiigo || null,
            periodo,
            mes: Number(mesQ),
            anio: Number(anioQ),
            centro_costo: centroCosto,
            origen: "LIPgo",
            novedad,
            tipo,
            horas_dias,
            valor_total: Math.round(valor_total),
          })
        }

        // -- Días clasificados (Sueldo / incapacidad / vacaciones / licencias) --
        // El "componente base" del día se deriva de `total_liquidado_dia` (la
        // columna que pagonomina ya usa como verdad final en el resto de la
        // app), restándole horas extra y recargo dominical -- así sale
        // correcto sin importar qué rama interna disparó ese día (normal,
        // incapacidad %, festivo, domingo de descanso sin novedad, día de
        // retiro sin pago). `base_dia` (valor_base_final) NO sirve para esto:
        // verificado con el caso real de YAIR TRUYOL (retiro 2026-09-08) --
        // su domingo de descanso (06-sep, sin novedad) tenía base_dia=0 pero
        // total_liquidado_dia=$58.363,5 (vía pago_domingo). Con la resta,
        // ambos casos casan exacto contra Siigo: $350.181 / 6 días de Sueldo,
        // incluyendo ese domingo.
        const grupos = new Map<string, { dias: number; valor: number; tipo: "Ingreso" | "Deducción" }>()
        let diasAux = 0
        for (const r of diasQuincena) {
          const novedadTexto = String(r.novedad_reportada || "").trim()
          const clasificacion = clasificarDiaCotizacion(r.novedad_reportada)
          const recargosDia =
            Number(r.hed || 0) + Number(r.hedf || 0) + Number(r.hen || 0) + Number(r.hef || 0) + Number(r.hn || 0)
          const componenteBase = Number(r.total_liquidado_dia || 0) - recargosDia - Number(r.recargodominical || 0)
          const esDiaSinPagoPropio = (clasificacion === "TRAB" || clasificacion === "RETIRO") && Math.round(componenteBase) === 0
          if (esDiaSinPagoPropio) continue // hueco de captura real o día de retiro sin pago -- no se inventa un Sueldo aquí ("no inventar saldos")
          // TRAB y RETIRO (con pago) se funden en "Sueldo": son marcadores
          // administrativos (domingo de descanso, día de retiro trabajado),
          // no novedades que Siigo reporte como línea aparte.
          const nombreGrupo = clasificacion === "TRAB" || clasificacion === "RETIRO" ? "Sueldo" : novedadTexto || clasificacion
          const tipoGrupo: "Ingreso" | "Deducción" = clasificacion === "AUS" ? "Deducción" : "Ingreso"
          const g = grupos.get(nombreGrupo) || { dias: 0, valor: 0, tipo: tipoGrupo }
          g.dias += 1
          g.valor += componenteBase
          grupos.set(nombreGrupo, g)
          if (clasificacion === "TRAB") diasAux += 1
        }
        for (const [nombreGrupo, g] of grupos) agregar(nombreGrupo, g.tipo, g.dias, g.valor)

        // -- Bono de destajo: piso $0 por quincena (excluye día de cierre desde 2026-08-15) --
        let bonoQuincena = 0
        for (const r of diasQuincena) {
          const f = String(r.fecha)
          const dia = Number(f.slice(8, 10))
          const ultimoDiaMes = new Date(Date.UTC(Number(anioQ), Number(mesQ), 0)).getUTCDate()
          const esDiaCierre = dia === 15 || dia === ultimoDiaMes
          if (f >= "2026-08-15" && esDiaCierre) continue
          if (Number(r.toneladas || 0) > 0) bonoQuincena += Number(r.bonif_prestacional || 0)
        }
        agregar(nombreNovedadDestajo(fechaCierre), "Ingreso", null, Math.max(0, bonoQuincena))

        // -- Horas extra / recargos (peso ya calculado por pagonomina, sumado tal cual) --
        let hed = 0, hedf = 0, hen = 0, hef = 0, hn = 0, recargoCompleto = 0, recargoParcial = 0
        for (const r of diasQuincena) {
          hed += Number(r.hed || 0)
          hedf += Number(r.hedf || 0)
          hen += Number(r.hen || 0)
          hef += Number(r.hef || 0)
          hn += Number(r.hn || 0)
          if (Number(r.recargodominical || 0) > 0) {
            if (r.recargo_dominical_tasa_completa) recargoCompleto += Number(r.recargodominical)
            else recargoParcial += Number(r.recargodominical)
          }
        }
        agregar("10- Horas extras diurnas 125%", "Ingreso", null, hed)
        agregar("07- Hora extra diurna dominical o festiva", "Ingreso", null, hedf)
        agregar("11- Horas extras nocturnas 175%", "Ingreso", null, hen)
        agregar("12- Horas extras nocturnas dominical o festiva", "Ingreso", null, hef)
        agregar("26- Recargo nocturno", "Ingreso", null, hn)
        agregar("08- Hora extra recargo dominical o festivo", "Ingreso", null, recargoCompleto)
        agregar("25- Recargo dominical o festivo", "Ingreso", null, recargoParcial)

        // -- Auxilio de transporte: solo días "Sueldo" (TRAB), confirmado con datos reales --
        const vig = vigenciaEnFecha(fechaCierre)
        const auxTransporte = (Number(vig.auxilio_transporte) / 30) * diasAux
        agregar("Aux. de transporte/Aux. de conectividad digital", "Ingreso", diasAux || null, auxTransporte)

        // -- Deducciones de ley: 4% salud + 4% pensión sobre el IBC (sin el auxilio) --
        const ibcTotal =
          [...grupos.values()].reduce((s, g) => s + (g.tipo === "Ingreso" ? g.valor : 0), 0) +
          Math.max(0, bonoQuincena) +
          hed + hedf + hen + hef + hn + recargoCompleto + recargoParcial
        agregar("Fondo de salud", "Deducción", null, -(ibcTotal * 0.04))
        agregar("Fondo de pensión", "Deducción", null, -(ibcTotal * 0.04))
      }
    }

    salida.sort(
      (a, b) =>
        a.identificacion.localeCompare(b.identificacion) ||
        a.anio - b.anio ||
        a.mes - b.mes ||
        a.periodo.localeCompare(b.periodo),
    )
    return { success: true, data: salida }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al construir los Acumulados de LIPgo." }
  }
}
