/**
 * Genera el DICCIONARIO DE DATOS de LIPgo desde el esquema REAL de Postgres.
 *
 *   pnpm run diccionario
 *   (o: npx tsx --env-file=.env.local scripts/generar-diccionario.mts)
 *
 * Escribe dos archivos, los dos versionados en git:
 *   · docs/diccionario-datos.md    para leerlo
 *   · docs/diccionario-datos.json  para que lo lea el comprobador y cualquier script
 *
 * Es de SOLO LECTURA: llama a `public.diccionario_esquema()`, que solo lee catálogos.
 *
 * REQUISITO: haber corrido una vez `scripts/diccionario/01_funcion_diccionario.sql`.
 *
 * POR QUÉ SE GENERA Y NO SE ESCRIBE A MANO: un diccionario a mano se desactualiza en
 * semanas y entonces miente, que es peor que no tenerlo. Las DESCRIPCIONES sí las
 * escribe una persona, pero viven dentro de la base como `comment on`, así que viajan
 * pegadas a la columna. Lo que el esquema no puede contar está en docs/diccionario-trampas.md.
 */
import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"
import path from "node:path"

interface Columna {
  nombre: string
  orden: number
  tipo: string
  admite_nulos: boolean
  defecto: string | null
  generada: boolean
  expresion_generada: string | null
  identidad: boolean
  descripcion: string | null
}
interface Restriccion {
  tipo: string
  nombre: string
  columnas: string[] | null
  referencia_tabla: string | null
  referencia_columnas: string[] | null
}
interface IndiceUnico {
  nombre: string
  columnas: string[] | null
  parcial: boolean
}
interface Objeto {
  nombre: string
  tipo: string
  descripcion: string | null
  filas_aprox: number | null
  columnas: Columna[]
  restricciones: Restriccion[]
  indices_unicos: IndiceUnico[]
}
interface Esquema {
  generado_en: string
  base: string
  esquema: string
  objetos: Objeto[]
}

const NUM = new Intl.NumberFormat("es-CO")
const esc = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim()
const filas = (n: number | null) => (n === null || n === undefined ? "—" : NUM.format(n))
const ancla = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-")

const llavePrimaria = (o: Objeto) => o.restricciones.find((r) => r.tipo === "llave primaria")?.columnas ?? []
const foraneas = (o: Objeto) => o.restricciones.filter((r) => r.tipo === "llave foranea")
const unicas = (o: Objeto) => [
  ...o.restricciones.filter((r) => r.tipo === "unica").map((r) => ({ columnas: r.columnas ?? [], parcial: false })),
  ...o.indices_unicos.map((i) => ({ columnas: i.columnas ?? [], parcial: i.parcial })),
]

/** Marcas que hacen daño si no se saben, en orden de peligro. */
function señales(c: Columna): string {
  const s: string[] = []
  if (c.generada) s.push("**GENERADA**")
  if (c.identidad) s.push("identidad")
  if (!c.admite_nulos) s.push("obligatoria")
  return s.join(", ")
}

function construirDocumento(esquema: Esquema): string {
  const tablas = esquema.objetos.filter((o) => o.tipo.startsWith("tabla"))
  const vistas = esquema.objetos.filter((o) => !o.tipo.startsWith("tabla"))
  const totalColumnas = esquema.objetos.reduce((s, o) => s + o.columnas.length, 0)
  const generadas = esquema.objetos.flatMap((o) => o.columnas.filter((c) => c.generada).map((c) => ({ tabla: o.nombre, c })))
  // Columnas de texto cuyo NOMBRE promete una cantidad. Se excluyen a propósito los
  // nombres que son identificadores (`numero_factura`, `numero_documento`, `codigo`…):
  // esos son texto con toda la razón y llenarían la lista de ruido. Lo que se busca es
  // la columna sobre la que alguien va a intentar un `sum()` y se va a estrellar.
  const PROMETE_CANTIDAD = /(^|_)(cantidad|cantidades|unidades|peso|pesos|total|totales|precio|monto|saldo|stock|valor)($|_)/i
  const textoNumerico = esquema.objetos.flatMap((o) =>
    o.columnas
      .filter((c) => /^(text|character|varchar)/i.test(c.tipo) && PROMETE_CANTIDAD.test(c.nombre))
      .map((c) => ({ tabla: o.nombre, c })),
  )
  const sinDescripcion = esquema.objetos.filter((o) => !o.descripcion)

  const L: string[] = []
  L.push("# Diccionario de datos de LIPgo")
  L.push("")
  L.push("> **Este archivo se GENERA. No lo edites a mano.**")
  L.push("> Se regenera con `pnpm run diccionario`, que lee el esquema real de Postgres.")
  L.push("> Las descripciones se escriben en la propia base con `comment on table` y")
  L.push("> `comment on column`, para que viajen pegadas al dato.")
  L.push("> Lo que el esquema no puede contar está en [diccionario-trampas.md](diccionario-trampas.md).")
  L.push("")
  L.push(
    `Base \`${esquema.base}\`, esquema \`${esquema.esquema}\`. Generado el ${new Date(esquema.generado_en).toLocaleString("es-CO", { timeZone: "America/Bogota" })}.`,
  )
  L.push("")
  L.push("| | Cuántos |")
  L.push("|---|---|")
  L.push(`| Tablas | ${NUM.format(tablas.length)} |`)
  L.push(`| Vistas | ${NUM.format(vistas.length)} |`)
  L.push(`| Columnas | ${NUM.format(totalColumnas)} |`)
  L.push(`| Objetos con descripción | ${NUM.format(esquema.objetos.length - sinDescripcion.length)} de ${NUM.format(esquema.objetos.length)} |`)
  L.push("")

  L.push("## Lo que hay que mirar antes de escribir una consulta")
  L.push("")
  L.push("### Columnas generadas: la base las calcula y NO se pueden escribir")
  L.push("")
  if (generadas.length === 0) {
    L.push("Ninguna.")
  } else {
    L.push("Un `update` sobre una de estas falla con `column ... can only be updated to DEFAULT`.")
    L.push("")
    L.push("| Tabla | Columna | Se calcula como |")
    L.push("|---|---|---|")
    for (const g of generadas) L.push(`| \`${g.tabla}\` | \`${g.c.nombre}\` | \`${esc(g.c.expresion_generada)}\` |`)
  }
  L.push("")
  L.push("### Columnas de texto que guardan números")
  L.push("")
  if (textoNumerico.length === 0) {
    L.push("Ninguna detectada.")
  } else {
    L.push("`sum()` sobre texto no existe: hay que castear con `::numeric`. Antes de castear, comprobar que todas las filas tengan texto numérico limpio.")
    L.push("")
    L.push("| Tabla | Columna | Tipo |")
    L.push("|---|---|---|")
    for (const t of textoNumerico) L.push(`| \`${t.tabla}\` | \`${t.c.nombre}\` | ${esc(t.c.tipo)} |`)
  }
  L.push("")

  L.push("## Índice")
  L.push("")
  L.push("### Tablas")
  L.push("")
  for (const o of tablas) L.push(`- [\`${o.nombre}\`](#${ancla(o.nombre)})${o.descripcion ? ` — ${esc(o.descripcion)}` : ""}`)
  L.push("")
  L.push("### Vistas")
  L.push("")
  for (const o of vistas) L.push(`- [\`${o.nombre}\`](#${ancla(o.nombre)})${o.descripcion ? ` — ${esc(o.descripcion)}` : ""}`)
  L.push("")

  L.push("## Detalle")
  L.push("")
  for (const o of esquema.objetos) {
    const pk = llavePrimaria(o)
    const fks = foraneas(o)
    const uqs = unicas(o)
    L.push(`### ${o.nombre}`)
    L.push("")
    L.push(`${o.tipo.charAt(0).toUpperCase() + o.tipo.slice(1)} · ${filas(o.filas_aprox)} filas aprox. · ${o.columnas.length} columnas`)
    L.push("")
    if (o.descripcion) {
      L.push(esc(o.descripcion))
    } else {
      L.push(`_Sin descripción. Se escribe en la base con \`comment on table public.${o.nombre} is '...'\`._`)
    }
    L.push("")
    L.push(pk.length ? `**Llave primaria:** ${pk.map((c) => `\`${c}\``).join(", ")}` : "**Llave primaria:** ninguna declarada")
    L.push("")
    if (uqs.length) {
      L.push("**Unicidad:** " + uqs.map((u) => `${u.columnas.map((c) => `\`${c}\``).join(" + ")}${u.parcial ? " (parcial)" : ""}`).join(" · "))
      L.push("")
    }
    if (fks.length) {
      L.push(
        "**Se liga a:** " +
          fks
            .map((f) => `${(f.columnas ?? []).map((c) => `\`${c}\``).join(", ")} → \`${f.referencia_tabla}\`(${(f.referencia_columnas ?? []).join(", ")})`)
            .join(" · "),
      )
      L.push("")
    }
    L.push("| Columna | Tipo | Señales | Defecto | Descripción |")
    L.push("|---|---|---|---|---|")
    for (const c of o.columnas) {
      const marca = pk.includes(c.nombre) ? " 🔑" : ""
      L.push(`| \`${c.nombre}\`${marca} | ${esc(c.tipo)} | ${señales(c)} | ${c.defecto ? `\`${esc(c.defecto)}\`` : ""} | ${esc(c.descripcion)} |`)
    }
    L.push("")
  }
  return L.join("\n") + "\n"
}

async function main(): Promise<number> {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!URL || !KEY) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.")
    console.error("Corre desde la raíz del repo con: pnpm run diccionario")
    return 1
  }

  const sb = createClient(URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.rpc("diccionario_esquema")
  if (error) {
    const falta = /does not exist|schema cache|not find/i.test(error.message)
    console.error(
      falta
        ? "No existe la función `diccionario_esquema()`: falta correr scripts/diccionario/01_funcion_diccionario.sql en Supabase."
        : `No se pudo leer el esquema: ${error.message}`,
    )
    return 1
  }

  const esquema = data as Esquema
  if (!esquema?.objetos?.length) {
    console.error("La función respondió sin objetos. Nada que generar.")
    return 1
  }

  const docs = path.join(process.cwd(), "docs")
  fs.mkdirSync(docs, { recursive: true })
  fs.writeFileSync(path.join(docs, "diccionario-datos.md"), construirDocumento(esquema), "utf8")
  fs.writeFileSync(path.join(docs, "diccionario-datos.json"), JSON.stringify(esquema, null, 2) + "\n", "utf8")

  const tablas = esquema.objetos.filter((o) => o.tipo.startsWith("tabla")).length
  const vistas = esquema.objetos.length - tablas
  const columnas = esquema.objetos.reduce((s, o) => s + o.columnas.length, 0)
  const generadas = esquema.objetos.reduce((s, o) => s + o.columnas.filter((c) => c.generada).length, 0)
  const descritos = esquema.objetos.filter((o) => o.descripcion).length

  console.log(`Diccionario generado desde la base ${esquema.base}:`)
  console.log(`  ${NUM.format(tablas)} tablas · ${NUM.format(vistas)} vistas · ${NUM.format(columnas)} columnas`)
  console.log(`  ${NUM.format(generadas)} columnas generadas (no se pueden escribir)`)
  console.log(`  ${NUM.format(descritos)} de ${NUM.format(esquema.objetos.length)} objetos con descripción`)
  console.log("  docs/diccionario-datos.md")
  console.log("  docs/diccionario-datos.json")
  return 0
}

// No se usa `process.exit()`: en Windows, cortar el proceso con el cliente de Supabase
// todavía abierto imprime un "Assertion failed ... async.c" de libuv que parece un fallo
// y no lo es. Marcar el código de salida y dejar que el proceso termine solo es limpio.
process.exitCode = await main()
