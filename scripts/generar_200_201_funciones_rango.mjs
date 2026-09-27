// =====================================================================
// Genera scripts/200_pagonomina_rango.sql y scripts/201_archivoplano_periodo.sql
// a partir de las vistas de referencia:
//   · 053_pagonomina_reemplazo.sql   → pagonomina_rango(p_desde, p_hasta)
//   · 059_archivoplano_reemplazo.sql → archivoplano_periodo(p_anio, p_mes)
//
// POR QUÉ EXISTE: las dos funciones son COPIAS del cuerpo de su vista con unas
// pocas acotaciones de fecha. La base de datos NO las mantiene sincronizadas:
// si alguien corre de nuevo 053 o 059 con un cambio de lógica, las vistas
// cambian y las funciones se quedan con la lógica VIEJA en silencio — y la app
// (Nómina, Parafiscales, Revisión de nómina, Estado de Resultados, cierres...)
// lee las funciones, no las vistas. Regla: cada vez que se toque 053 o 059,
// correr esto y volver a ejecutar en Supabase el 200 y/o el 201 generados.
//
//   node scripts/generar_200_201_funciones_rango.mjs
//
// El script falla (no genera nada) si alguna ancla del texto de la vista dejó
// de encontrarse exactamente una vez — señal de que hay que revisar a mano.
// =====================================================================
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), "utf8").split(/\r?\n/)
const escribir = (rel, txt) => fs.writeFileSync(path.join(RAIZ, rel), txt)

function reemplazarUnico(body, pred, transform, nombre, cambios) {
  const idx = body.map((l, i) => (pred(l, i) ? i : -1)).filter((i) => i >= 0)
  if (idx.length !== 1) throw new Error(`ancla '${nombre}' aparece ${idx.length} veces`)
  body.splice(idx[0], 1, ...transform(body[idx[0]], idx[0]))
  cambios.push(`${nombre} @${idx[0] + 1}`)
}

// ---------------------------------------------------------------------
// 200 — pagonomina_rango
// ---------------------------------------------------------------------
function generar200() {
  const src = leer("scripts/053_pagonomina_reemplazo.sql")
  const ini = src.findIndex((l) => l.startsWith("create or replace view public.pagonomina as"))
  const fin = src.findIndex((l, i) => i > ini && l.trim() === ";")
  if (ini < 0 || fin < 0) throw new Error("053: no encontré el cuerpo de la vista")
  const body = src.slice(ini + 1, fin)
  const cambios = []
  const RANGO = "(p_desde - 7) AND (p_hasta + 7)"

  // 1) transformacion: cabeceraoc acotado
  reemplazarUnico(body, (l) => l.includes("AND NOT (cabeceraoc.tipooperacion = 'proyeccion'::text)"),
    (l) => [l, `            AND (cabeceraoc.fechacargue BETWEEN ${RANGO})`], "transformacion/cabeceraoc", cambios)
  // 2) datos_asistencia_raw: registroasistencia acotado
  reemplazarUnico(body, (l, i) => l.trim() === "FROM registroasistencia" && body[i + 1]?.includes("), datos_asistencia AS ("),
    (l) => [l, `          WHERE (registroasistencia.fecha BETWEEN ${RANGO})`], "datos_asistencia_raw/registroasistencia", cambios)
  // 3) rango_fechas: calendario acotado al rango ±7, sin salirse del histórico real
  {
    const a = body.findIndex((l) => l.includes("), rango_fechas AS ("))
    const b = body.findIndex((l) => l.includes("), lista_empleados AS ("))
    if (a < 0 || b < 0 || b <= a) throw new Error("053: bloque rango_fechas")
    body.splice(a, b - a, [
      "        ), rango_fechas AS (",
      "         -- Calendario acotado al rango pedido ±7 días (las ventanas de la vista",
      "         -- miran 6 días atrás/adelante), sin salirse del histórico real para que",
      "         -- los conteos de la primera semana coincidan con la vista completa.",
      "         SELECT GREATEST(min(tf.fecha)::date, (p_desde - 7)) AS fecha_inicio,",
      "            LEAST(max(tf.fecha)::date, (p_hasta + 7)) AS fecha_fin",
      "           FROM ( SELECT cabeceraoc.fechacargue AS fecha",
      "                   FROM cabeceraoc",
      "                UNION ALL",
      "                 SELECT registroasistencia.fecha",
      "                   FROM registroasistencia) tf",
    ].join("\n"))
    cambios.push(`rango_fechas @${a + 1}`)
  }
  // 3b) lista_empleados: GLOBAL como en la vista (se copian los filtros de transformacion)
  {
    const fromCab = body.findIndex((l) => l.trim() === "FROM cabeceraoc")
    const finTransf = body.findIndex((l) => l.includes("), produccion_diaria AS ("))
    if (fromCab < 0 || finTransf < 0 || finTransf <= fromCab) throw new Error("053: bloque transformacion")
    const filtros = body.slice(fromCab + 1, finTransf).filter((l) => !l.trim().startsWith("--") && !l.includes("p_desde"))
    if (!filtros[0]?.trim().startsWith("WHERE")) throw new Error("053: filtros de transformacion")
    const a = body.findIndex((l) => l.includes("), lista_empleados AS ("))
    const b = body.findIndex((l) => l.includes("), calendario_base AS ("))
    if (a < 0 || b < 0 || b <= a) throw new Error("053: bloque lista_empleados")
    body.splice(a, b - a, [
      "        ), lista_empleados AS (",
      "         -- GLOBAL a propósito, igual que la vista: la lista de personas sale de",
      "         -- TODA la historia de cabeceraoc (mismos filtros que `transformacion`,",
      "         -- sin acotar por fecha) y de TODA registroasistencia. Si se acotara al",
      "         -- rango, quien solo figura en órdenes viejas desaparecería del calendario",
      "         -- y la vista sí lo trae como 'Sin Registro' (verificado: 3 personas/día).",
      "         SELECT DISTINCT TRIM(BOTH FROM regexp_split_to_table(cabeceraoc.auxiliares, ','::text)) AS persona",
      "           FROM cabeceraoc",
      ...filtros,
      "        UNION",
      "         SELECT DISTINCT registroasistencia.nombre AS persona",
      "           FROM registroasistencia",
    ].join("\n"))
    cambios.push(`lista_empleados @${a + 1} (${filtros.length} filtros copiados)`)
  }
  // 4) bonos_dia acotado
  reemplazarUnico(body, (l) => l.includes("WHERE (b.estado = 'aprobado'::text)"),
    (l) => [l, `            AND (b.fecha BETWEEN ${RANGO})`], "bonos_dia", cambios)
  // 5) resultado final acotado al rango exacto
  reemplazarUnico(body, (l) => l.includes("WHERE (fecha <= CURRENT_DATE)"),
    (l) => [l, "    AND (fecha BETWEEN p_desde AND p_hasta)"], "resultado final", cambios)

  const header = `-- =====================================================================
-- 200 — pagonomina_rango(p_desde, p_hasta): la MISMA nómina que la vista
--       pagonomina, calculada solo para un rango de fechas.
--
-- Por qué: la vista pagonomina explota el CSV de auxiliares de TODAS las
-- órdenes, arma un calendario día×empleado de toda la historia y aplica
-- funciones de ventana antes de que cualquier filtro pueda aplicarse, así
-- que hasta pedir un mes de una empresa tarda ~5 s (medido: 40.637 filas,
-- ~5 s por consulta; Nómina, Estado de Resultados, Conciliación Avimol,
-- Análisis Financiero y Parafiscales la consumen, algunos en bucle).
--
-- Qué cambia: NADA en la lógica. Es el cuerpo de la vista (scripts/053) con
-- cuatro acotaciones: cabeceraoc, registroasistencia y bonos_nomina se leen
-- solo en [p_desde-7, p_hasta+7] (las ventanas de 6 días necesitan ese
-- margen), el calendario se genera solo para ese tramo (sin salirse del
-- histórico real), y el resultado se filtra a [p_desde, p_hasta]. La lista
-- de empleados sigue siendo la GLOBAL (toda la historia de cabeceraoc con los
-- mismos filtros, más toda registroasistencia), igual que en la vista, para
-- que los días 'Sin Registro' salgan idénticos.
--
-- La vista pagonomina NO se toca: sigue existiendo y siendo la referencia.
-- Los consumidores se migran uno a uno tras verificar igualdad exacta
-- (mismas filas, mismos valores) contra la vista para varios rangos.
--
-- Uso desde la app: supabase.rpc("pagonomina_rango", { p_desde, p_hasta })
-- (admite .eq/.in/.select encima, como cualquier tabla).
--
-- ARCHIVO GENERADO — NO EDITAR A MANO. Sale de scripts/053_pagonomina_reemplazo.sql
-- con \`node scripts/generar_200_201_funciones_rango.mjs\`. Si se cambia la
-- vista (053), hay que regenerar este archivo Y volver a correrlo en Supabase:
-- la base no sincroniza la función con la vista, y la app lee la función.
-- =====================================================================

drop function if exists public.pagonomina_rango(date, date);

create function public.pagonomina_rango(p_desde date, p_hasta date)
returns setof public.pagonomina
language sql
stable
-- SECURITY DEFINER a propósito: una vista corre con los privilegios de su
-- DUEÑO (postgres), y así es como hoy la lee cualquier rol autenticado desde
-- el navegador (Nómina, Estado de Resultados). Una función normal correría
-- con los privilegios del que la llama; si alguna tabla base tuviera RLS
-- vería menos filas que la vista y calcularía distinto EN SILENCIO. Con esto
-- la función expone exactamente lo mismo que la vista, ni más ni menos.
security definer
set search_path = public
as $fn$
`
  const footer = `
$fn$;

-- Verificación (debe devolver las mismas filas que la vista para el rango):
-- select count(*) from public.pagonomina where fecha between '2026-09-01' and '2026-09-26';
-- select count(*) from public.pagonomina_rango('2026-09-01', '2026-09-26');
`
  escribir("scripts/200_pagonomina_rango.sql", header + body.join("\n") + footer)
  console.log("200:", cambios.join(" | "), "| líneas cuerpo:", body.length)
}

// ---------------------------------------------------------------------
// 201 — archivoplano_periodo
// ---------------------------------------------------------------------
function generar201() {
  const src = leer("scripts/059_archivoplano_reemplazo.sql")
  const ini = src.findIndex((l) => l.startsWith("create view public.archivoplano as"))
  const fin = src.findIndex((l, i) => i > ini && l.trim() === "ORDER BY 1 DESC, 2, 4;")
  if (ini < 0 || fin < 0) throw new Error("059: no encontré el cuerpo de la vista")
  const body = src.slice(ini + 1, fin)
  // El comentario sobre el ORDER BY posicional acompañaba a la línea ORDER BY que
  // aquí se reemplaza por la del envoltorio: se quita para no dejarlo huérfano.
  while (body.length && body[body.length - 1].trim().startsWith("--")) body.pop()
  const cambios = []
  reemplazarUnico(body, (l) => l.includes("FROM (pagonomina p"), (l) => [
    "           -- FUENTE ACOTADA: la nómina del mes pedido vía pagonomina_rango (misma",
    "           -- lógica que la vista pagonomina, verificada fila por fila), desde UN",
    "           -- DÍA ANTES del mes: `fecha_efectiva_turno` corre el día de cierre",
    "           -- (15 y último del mes) a la quincena SIGUIENTE, así que las horas y",
    "           -- recargos del último día del mes anterior caen en la 1ª quincena de",
    "           -- este mes. Lo que ese día extra genere bajo el mes anterior se descarta",
    "           -- en el WHERE final; lo que el último día de ESTE mes corra al mes",
    "           -- siguiente también (igual que en la vista, donde sale bajo ese mes).",
    l.replace("FROM (pagonomina p",
      "FROM (pagonomina_rango((make_date(p_anio, p_mes, 1) - 1), ((make_date(p_anio, p_mes, 1) + interval '1 month' - interval '1 day')::date)) p"),
  ], "base_datos/pagonomina", cambios)

  const header = `-- =====================================================================
-- 201 — archivoplano_periodo(p_anio, p_mes): el MISMO archivo plano que la
--       vista archivoplano, calculado solo para un mes (ambas quincenas).
--
-- Por qué: la vista archivoplano se apoya en la vista pagonomina COMPLETA
-- (toda la historia) y luego agrupa por quincena; cualquier filtro por mes se
-- aplica después de haberlo calculado todo (~6 s por consulta; la usan
-- Nómina › Archivo plano, Parafiscales — en bucle desde Estado de Resultados —
-- y Revisión de nómina).
--
-- Qué cambia: NADA en la lógica. Es el cuerpo de la vista (scripts/059) con
-- dos acotaciones: \`base_datos\` lee pagonomina_rango(último día del mes
-- anterior, último día del mes) en vez de pagonomina, y el resultado se
-- filtra a mes = p_mes. Las ramas que no salen de pagonomina (Ajuste Nómina
-- Anterior, Bonos, Anticipos) quedan igual que en la vista: se filtran solo
-- por mes, como hace la vista (y sus consumidores) hoy.
--
-- La vista archivoplano NO se toca. Los consumidores se migran tras verificar
-- igualdad exacta (mismas filas, mismos valores) contra la vista por mes.
--
-- Uso desde la app: supabase.rpc("archivoplano_periodo", { p_anio, p_mes })
-- y encima .eq("quincena", q) / .eq("idempresa", id) / .in(...) como siempre.
--
-- ARCHIVO GENERADO — NO EDITAR A MANO. Sale de scripts/059_archivoplano_reemplazo.sql
-- con \`node scripts/generar_200_201_funciones_rango.mjs\`. Si se cambia la
-- vista (059) — o la 053, de la que depende vía pagonomina_rango — hay que
-- regenerar y volver a correr en Supabase: la base no sincroniza la función
-- con la vista, y la app lee la función.
-- =====================================================================

drop function if exists public.archivoplano_periodo(integer, integer);

create function public.archivoplano_periodo(p_anio integer, p_mes integer)
returns setof public.archivoplano
language sql
stable
-- SECURITY DEFINER por la misma razón que pagonomina_rango (scripts/200):
-- comportarse exactamente como la vista, que corre con los privilegios de su
-- dueño, sin importar qué rol la llame.
security definer
set search_path = public
as $fn$
 SELECT ap.*
   FROM (
`
  const footer = `
        ) ap
  -- Solo el mes pedido: descarta lo que el día extra del mes anterior y el
  -- corrimiento del día de cierre generen bajo otros meses.
  WHERE (ap.mes = to_char(make_date(p_anio, p_mes, 1), 'MM'::text))
  ORDER BY ap.mes DESC, ap.quincena, ap.identificacionempleado
$fn$;

-- Verificación (debe devolver las mismas filas que la vista para el mes):
-- select count(*) from public.archivoplano where mes = '09';
-- select count(*) from public.archivoplano_periodo(2026, 9);
`
  escribir("scripts/201_archivoplano_periodo.sql", header + body.join("\n") + footer)
  console.log("201:", cambios.join(" | "), "| líneas cuerpo:", body.length)
}

generar200()
generar201()
