// Convierte el archivo de inventario físico que entrega el cliente (.xlsx) al
// JSON que consume la reconciliación (scripts/sig/reconciliar_inventario_fisico.mts).
// SOLO LECTURA sobre la base: no toca Supabase, solo lee el Excel y escribe el JSON.
//
// La hoja de detalle debe traer, en este orden, las columnas:
//   #  |  Producto  |  Lote  |  Localización  |  Fisico   [ |  Nota ]
//
// Varias filas con el MISMO producto+lote+ubicación se SUMAN (son estibas
// distintas del mismo lote contadas aparte); la clave producto+lote+ubicación
// es única en el conteo, así que si no se suman el cargue se cae por el índice.
// El resumen impreso dice exactamente qué filas se agruparon.
//
// Uso:
//   npx tsx scripts/sig/convertir_fisico_xlsx.mts \
//     --input "C:/ruta/inventario 30 sep.xlsx" \
//     --hoja Inventario --desde 4 \
//     --output scripts/sig/data/id1-fisico-2026-10.json

import { readFileSync, writeFileSync } from "fs"
import * as XLSX from "xlsx"

interface FilaFisica {
  producto: string
  lote: string
  location: string
  fisico: number
  nota: string | null
}

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const input = get("--input")
  const output = get("--output")
  const hoja = get("--hoja") ?? "Inventario"
  // Fila (base 0) donde empiezan los DATOS, sin contar la de encabezados.
  const desde = Number(get("--desde") ?? "4")
  if (!input || !output) {
    console.error("Uso: --input <archivo.xlsx> --output <archivo.json> [--hoja Inventario] [--desde 4]")
    process.exit(1)
  }
  return { input, output, hoja, desde }
}

const norm = (s: any): string => String(s ?? "").trim().replace(/\s+/g, " ")
const fmt = (x: number) => (Math.round(x * 100) / 100).toLocaleString("es-CO")

function main() {
  const { input, output, hoja, desde } = parseArgs()
  const wb = XLSX.read(readFileSync(input), { type: "buffer" })
  if (!wb.Sheets[hoja]) {
    console.error(`⛔ La hoja "${hoja}" no existe. Hojas del archivo: ${wb.SheetNames.join(" | ")}`)
    process.exit(1)
  }
  const crudas = XLSX.utils.sheet_to_json<any>(wb.Sheets[hoja], {
    header: ["n", "producto", "lote", "location", "fisico", "nota"],
    range: desde,
    defval: null,
  })

  const validas = crudas.filter((f) => norm(f.producto) && f.fisico !== null && f.fisico !== "")
  const descartadas = crudas.length - validas.length

  // Agrupar por producto+lote+ubicación sumando el físico.
  const porClave = new Map<string, FilaFisica & { filas: number; detalle: number[] }>()
  for (const f of validas) {
    const producto = norm(f.producto)
    const lote = norm(f.lote)
    const location = norm(f.location)
    const fisico = Number(f.fisico) || 0
    const nota = norm(f.nota) || null
    const k = `${producto.toUpperCase()}||${lote}||${location.toUpperCase()}`
    const prev = porClave.get(k)
    if (prev) {
      prev.fisico += fisico
      prev.filas++
      prev.detalle.push(fisico)
      // Las notas se concatenan sin perder ninguna (p. ej. "DAÑADAS").
      if (nota) prev.nota = prev.nota ? `${prev.nota}; ${nota}` : nota
    } else {
      porClave.set(k, { producto, lote, location, fisico, nota, filas: 1, detalle: [fisico] })
    }
  }

  const agrupadas = Array.from(porClave.values())
  const salida: FilaFisica[] = agrupadas.map(({ producto, lote, location, fisico, nota }) => ({
    producto,
    lote,
    location,
    fisico: Math.round(fisico * 100) / 100,
    nota,
  }))

  const total = salida.reduce((s, f) => s + f.fisico, 0)
  const sumadas = agrupadas.filter((f) => f.filas > 1)

  console.log(`Archivo:  ${input}  (hoja "${hoja}", datos desde la fila ${desde + 1})`)
  console.log(`Filas leídas: ${crudas.length} · válidas: ${validas.length}${descartadas ? ` · descartadas (sin producto o sin físico): ${descartadas}` : ""}`)
  console.log(`Claves únicas producto+lote+ubicación: ${salida.length} · total físico: ${fmt(total)} und`)
  console.log(`\nClaves que venían en varias filas y se SUMARON: ${sumadas.length}`)
  for (const f of sumadas) {
    console.log(`  ${f.producto.slice(0, 44).padEnd(44)} L${f.lote.padEnd(10)} ${f.location.padEnd(10)} ${f.filas} filas (${f.detalle.map((d) => fmt(d)).join(" + ")}) = ${fmt(f.fisico)}`)
  }

  const porProducto: Record<string, number> = {}
  for (const f of salida) porProducto[f.producto] = (porProducto[f.producto] || 0) + f.fisico
  console.log(`\nTotal por producto (${Object.keys(porProducto).length}):`)
  for (const [p, v] of Object.entries(porProducto).sort((a, b) => b[1] - a[1])) console.log(`  ${p.slice(0, 48).padEnd(48)} ${fmt(v).padStart(10)}`)

  writeFileSync(output, JSON.stringify(salida, null, 2) + "\n", "utf8")
  console.log(`\n✅ Escrito ${output} (${salida.length} filas). La base de datos NO se tocó.`)
}
main()
