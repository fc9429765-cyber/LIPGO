/**
 * 256_bloquear_usuarios_id4.mts
 *
 * Cerrar el acceso a la plataforma a todos los usuarios de ID4 (Cedi Medellín).
 *
 * Ordenado por gerencia el 2026-10-07: "te pido de inmediato deshabilitar todos los
 * usuarios del ID 4, ese proyecto lo entregamos el 26 de octubre, ya no pertenece a LIPgo
 * y por ende no debe permitir a los usuarios seguir trabajando en la plataforma, no deben
 * poder ingresar a ningún módulo ni de consulta".
 *
 * POR QUÉ SE BLOQUEA EN AUTH Y NO SE TOCAN LOS PERMISOS
 *
 * El ingreso a LIPgo es 100 % Supabase Auth (`signInWithPassword` en lib/auth-actions.ts y
 * components/login-form.tsx). Bloquear la cuenta ahí cierra la puerta completa: sin sesión
 * no hay módulo, ni de escritura ni de consulta. Y no toca una sola fila de
 * `permisos_usuarios`, que es la regla de la casa: los permisos entregados no se alteran
 * de paso. Si mañana hay que devolverle el acceso a alguien, sus permisos están intactos.
 *
 * NO SE BORRA NADA. Borrar la cuenta (lo que se hizo con test@test.com) rompería el rastro:
 * `profiles` es lo que da nombre al actor en la auditoría, y las órdenes, conteos y
 * aprobaciones de ese proyecto quedarían firmadas por un usuario inexistente. El bloqueo
 * es reversible y deja la historia como está.
 *
 * QUÉ NO HACE
 *
 * No toca a los 7 usuarios de ID1 (personal de LIP y LIPgo) que tienen ID4 en su alcance:
 * Admon Indupan, Juan Sebastian Wild, Coordinador SST, Gerente Certificaciones, Yordin
 * Cueto, Brian Sanchez y Jeffrey Jimenez. No son usuarios del cliente y quitarles alcance
 * sería cambiar permisos de paso. Se informan para que gerencia decida.
 *
 * USO
 *   node --env-file=.env.local --experimental-strip-types scripts/256_bloquear_usuarios_id4.mts
 *     → solo la foto, no escribe nada.
 *   ... scripts/256_bloquear_usuarios_id4.mts --ejecutar
 *     → bloquea, y guarda la foto previa en scripts/respaldos/.
 *   ... scripts/256_bloquear_usuarios_id4.mts --desbloquear
 *     → deshace el bloqueo (el reverso viene con la acción, no después).
 */
import { createClient } from "@supabase/supabase-js"
import { mkdirSync, writeFileSync } from "node:fs"

const EMPRESA = 4
const CIEN_ANOS = "876000h"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const modo = process.argv.includes("--desbloquear") ? "desbloquear" : process.argv.includes("--ejecutar") ? "ejecutar" : "foto"

async function q<T = any>(p: any): Promise<T[]> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

async function cuentasDeAuth() {
  const out: any[] = []
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(error.message)
    out.push(...(data?.users ?? []))
    if ((data?.users ?? []).length < 1000) break
  }
  return out
}

const auth = await cuentasDeAuth()
const porId = new Map(auth.map((u) => [u.id, u]))
const perfiles = await q(sb.from("profiles").select("id, usuario, empresa_id").eq("empresa_id", EMPRESA).order("usuario"))

type Fila = { id: string; usuario: string; email: string | null; modulos: number; ultimo: string | null; bloqueada: boolean }
const filas: Fila[] = []
for (const p of perfiles) {
  const u: any = porId.get(p.id)
  const [pm] = await q(sb.from("permisos_usuarios").select("*").eq("usuario_id", p.id))
  const modulos = pm ? Object.entries(pm).filter(([, v]) => v === true).length : 0
  filas.push({
    id: p.id,
    usuario: String(p.usuario),
    email: u?.email ?? null,
    modulos,
    ultimo: u?.last_sign_in_at ?? null,
    bloqueada: !!u?.banned_until && new Date(u.banned_until) > new Date(),
  })
}

console.log(`\n══════ ID${EMPRESA} · ${filas.length} usuario(s) · modo: ${modo.toUpperCase()}\n`)
for (const f of filas)
  console.log(
    `   ${f.usuario.padEnd(24)} ${String(f.email ?? "sin correo").padEnd(34)} ${String(f.modulos).padStart(3)} módulos · último ingreso ${
      f.ultimo ? String(f.ultimo).slice(0, 16) : "nunca"
    } · ${f.bloqueada ? "YA BLOQUEADA" : "activa"}`,
  )

const conSesionReciente = filas.filter((f) => f.ultimo && Date.now() - new Date(f.ultimo).getTime() < 2 * 60 * 60 * 1000)
if (conSesionReciente.length)
  console.log(`\n   ⚠ ${conSesionReciente.length} entró en las últimas 2 horas: su sesión en curso caduca en menos de una hora y ya no podrá renovarla.`)

if (modo === "foto") {
  console.log(`\n   Nada escrito. Para aplicarlo: --ejecutar\n`)
  process.exit(0)
}

// La foto previa se guarda ANTES de escribir, para que el reverso no dependa de la memoria.
if (modo === "ejecutar") {
  mkdirSync("scripts/respaldos", { recursive: true })
  const ruta = `scripts/respaldos/id4_usuarios_antes_de_bloquear_${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(ruta, JSON.stringify({ tomada: new Date().toISOString(), empresa: EMPRESA, usuarios: filas }, null, 2), "utf8")
  console.log(`\n   Foto previa guardada en ${ruta}`)
}

let ok = 0
const fallos: string[] = []
for (const f of filas) {
  const { error } = await sb.auth.admin.updateUserById(f.id, { ban_duration: modo === "ejecutar" ? CIEN_ANOS : "none" } as any)
  if (error) {
    fallos.push(`${f.usuario}: ${error.message}`)
    continue
  }
  ok++
  await sb.from("auditoria").insert({
    actor_nombre: "Gerencia LIP (script 256)",
    idempresa: EMPRESA,
    modulo: "Gestión de Usuarios",
    tabla: "auth.users",
    operacion: "UPDATE",
    registro_id: f.id,
    descripcion:
      modo === "ejecutar"
        ? `Bloqueó el ingreso de ${f.usuario} (${f.email ?? "sin correo"}) por la entrega del proyecto ID4. Sus ${f.modulos} permisos de módulo quedan intactos.`
        : `Devolvió el ingreso a ${f.usuario} (${f.email ?? "sin correo"}).`,
    antes: { banned: modo !== "ejecutar" },
    despues: { banned: modo === "ejecutar" },
  })
}

// Comprobar contra Auth, no contra lo que creemos que pasó.
const despues = await cuentasDeAuth()
const mapa = new Map(despues.map((u) => [u.id, u]))
console.log(`\n══════ DESPUÉS`)
let bloqueadas = 0
for (const f of filas) {
  const u: any = mapa.get(f.id)
  const b = !!u?.banned_until && new Date(u.banned_until) > new Date()
  if (b) bloqueadas++
  console.log(`   ${f.usuario.padEnd(24)} ${b ? "BLOQUEADA hasta " + String(u.banned_until).slice(0, 10) : "activa"}`)
}
console.log(`\n   ${ok} de ${filas.length} procesadas · ${bloqueadas} bloqueadas ahora mismo`)
if (fallos.length) {
  console.log(`\n   ⚠ FALLARON:`)
  for (const x of fallos) console.log(`      ${x}`)
  process.exit(1)
}
const esperado = modo === "ejecutar" ? filas.length : 0
if (bloqueadas !== esperado) {
  console.log(`\n   ⚠ Se esperaban ${esperado} bloqueadas y hay ${bloqueadas}. Revisar antes de dar por cerrado.`)
  process.exit(1)
}
console.log(`\n   Listo. Ningún permiso de módulo fue alterado.\n`)
