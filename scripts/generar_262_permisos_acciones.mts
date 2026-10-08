// Genera scripts/262_permisos_acciones.sql desde el catálogo de políticas
// (lib/politicas-modulos.ts). Es la única forma legítima de cambiar ese SQL:
// se edita el catálogo y se vuelve a correr esto.
//
//   npx tsx scripts/generar_262_permisos_acciones.mts
//
// No toca la base ni necesita .env.local: solo escribe el archivo. La prueba
// tests/politicas-modulos.test.ts falla si el archivo versionado no coincide
// con lo que el catálogo produce.
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { sql262, columnas262 } from "../lib/politicas-sql"
import { validarPoliticas, PROCESOS_NUEVOS } from "../lib/politicas-modulos"

const errores = validarPoliticas()
if (errores.length) {
  console.error("El catálogo no es coherente; no se genera nada:\n  " + errores.join("\n  "))
  process.exit(1)
}

const destino = join(dirname(fileURLToPath(import.meta.url)), "262_permisos_acciones.sql")
writeFileSync(destino, sql262(), "utf8")
console.log(`Escrito ${destino}: ${columnas262().length} columnas de acción, ${PROCESOS_NUEVOS.length} procesos nuevos.`)
