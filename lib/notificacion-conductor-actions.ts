"use server"

// ---------------------------------------------------------------------------
// NOTIFICACIÓN AL CONDUCTOR
//
// Dos avisos automáticos por WhatsApp:
//   · muelle_asignado    — al asignarle un muelle al vehículo
//   · cargue_finalizado  — al cerrar la orden, con la encuesta
//
// TRES GUARDAS, EN ESTE ORDEN:
//   1. El evento tiene que estar ACTIVO.
//   2. La empresa tiene que estar en la lista de habilitadas.
//   3. Si hay `telefono_prueba`, el aviso se DESVÍA ahí.
//
// UN FALLO DEL AVISO NO PUEDE ROMPER LA OPERACIÓN. Asignar un muelle y cerrar
// una orden son acciones críticas: si WhatsApp está caído o el token caducó,
// eso no puede impedir que el coordinador trabaje. Por eso todo va envuelto en
// try/catch y `notificarConductor` nunca lanza.
// ---------------------------------------------------------------------------

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getCurrentUsuarioForInsert } from "@/lib/user-context"
import { enviarAvisoConductor, normalizarTelefono } from "@/lib/whatsapp-actions"
import { getTokenEncuesta } from "@/lib/encuesta-conductor-actions"
import type {
  AvisoEnviado,
  ConfigConductor,
  ContextoOrden,
  EventoConductor,
  ResultadoAviso,
} from "@/lib/notificacion-conductor-tipos"
import { motivoSinAccion } from "@/lib/puerta-modulo"

function faltaTabla(msg: string | undefined): boolean {
  const m = String(msg ?? "").toLowerCase()
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("relation")
}

function mapear(r: any): ConfigConductor {
  return {
    id: Number(r.id),
    evento: r.evento,
    nombre: r.nombre,
    activo: r.activo === true,
    mensaje: r.mensaje ?? "",
    titulo: r.titulo ?? "LIP Logística",
    urlEncuesta: r.url_encuesta ?? null,
    empresas: Array.isArray(r.empresas) ? r.empresas.map(Number) : [],
    telefonoPrueba: r.telefono_prueba ?? null,
    actualizadoPor: r.actualizado_por ?? null,
  }
}

/** Configuración de los dos eventos. */
export async function getConfigConductor(): Promise<{
  success: boolean
  data?: ConfigConductor[]
  faltaMigracion?: boolean
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("notificaciones_conductor_config")
      .select("*")
      .order("evento", { ascending: true })
    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [], faltaMigracion: true }
      return { success: false, message: error.message }
    }
    return { success: true, data: (data ?? []).map(mapear) }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo leer la configuración." }
  }
}

/** Guarda la configuración de un evento. */
export async function guardarConfigConductor(payload: {
  evento: EventoConductor
  activo: boolean
  mensaje: string
  titulo: string
  urlEncuesta?: string | null
  empresas: number[]
  telefonoPrueba?: string | null
}): Promise<{ success: boolean; message?: string }> {
  // Política por acción (catálogo lib/politicas-modulos.ts).
  const motivoAccion = await motivoSinAccion(["Notificaciones al Personal"], "configurar", "Aviso al conductor")
  if (motivoAccion) return { success: false, message: motivoAccion }
  try {
    if (!payload.mensaje?.trim()) return { success: false, message: "El mensaje no puede estar vacío." }

    // Activar sin empresas habilitadas no enviaría nada y parecería roto.
    if (payload.activo && payload.empresas.length === 0) {
      return {
        success: false,
        message: "Selecciona al menos una empresa antes de activar el aviso.",
      }
    }

    // El desvío de pruebas se normaliza igual que cualquier destino: un número
    // mal escrito acá haría fallar TODOS los avisos del evento.
    let telefonoPrueba: string | null = null
    if (payload.telefonoPrueba?.trim()) {
      telefonoPrueba = await normalizarTelefono(payload.telefonoPrueba)
      if (!telefonoPrueba) {
        return { success: false, message: "El teléfono de pruebas no es un número válido." }
      }
    }

    const sb: any = await getSupabaseAdmin()
    const usuario = await getCurrentUsuarioForInsert().catch(() => null)
    const { error } = await sb
      .from("notificaciones_conductor_config")
      .update({
        activo: payload.activo,
        mensaje: payload.mensaje.trim(),
        titulo: payload.titulo?.trim() || "LIP Logística",
        url_encuesta: payload.urlEncuesta?.trim() || null,
        empresas: payload.empresas,
        telefono_prueba: telefonoPrueba,
        actualizado_por: usuario,
        updated_at: new Date().toISOString(),
      })
      .eq("evento", payload.evento)
    if (error) {
      if (faltaTabla(error.message)) {
        return { success: false, message: "Falta correr scripts/182_notificacion_conductor.sql." }
      }
      return { success: false, message: error.message }
    }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo guardar." }
  }
}

/** Reemplaza los marcadores del mensaje con los datos de la orden. */
function armarMensaje(plantilla: string, ctx: ContextoOrden, urlEncuesta: string | null): string {
  return String(plantilla ?? "")
    .replace(/\{conductor\}/gi, ctx.conductor ?? "")
    .replace(/\{muelle\}/gi, ctx.muelle != null ? String(ctx.muelle) : "")
    .replace(/\{placa\}/gi, ctx.placa ?? "")
    .replace(/\{orden\}/gi, ctx.ordenDeCargue ?? "")
    .replace(/\{cliente\}/gi, ctx.cliente ?? "")
    .replace(/\{encuesta\}/gi, urlEncuesta ?? "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/**
 * Envía el aviso al conductor. NUNCA lanza.
 *
 * Se llama desde las acciones que asignan muelle y cierran orden. Si algo
 * falla, devuelve `enviado: false` con el motivo y la operación sigue: nadie
 * debe quedarse sin poder cerrar una orden porque WhatsApp no respondió.
 */
/**
 * Dominio donde vive la encuesta pública.
 *
 * El enlace va en un WhatsApp a un conductor, así que tiene que ser una
 * dirección estable y presentable. Por eso el dominio propio es lo primero y no
 * depende de que alguien recuerde configurar una variable: si faltara, el
 * mensaje saldría con el enlace roto y nadie se enteraría hasta ver el
 * indicador vacío.
 *
 * `VERCEL_URL` queda de respaldo para las vistas previas de despliegue, donde
 * el dominio propio todavía no apunta a ese código. No sirve como principal:
 * cambia en cada despliegue, y un enlace así moriría al siguiente.
 */
function dominioPublico(): string {
  const configurado = String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim()
  if (configurado) return configurado.replace(/\/+$/, "")

  const vercel = String(process.env.VERCEL_URL ?? "").trim()
  if (vercel && process.env.VERCEL_ENV !== "production") {
    return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`
  }

  return "https://www.lipgo.app"
}

/**
 * Historial de los avisos automáticos al conductor.
 *
 * POR QUÉ NO BASTA CON `whatsapp_mensajes`
 * Esa tabla tiene el estado del mensaje pero no sabe de órdenes: guardaría
 * "se envió a 573202343157" sin decir a qué cargue correspondía. Revisar un
 * reclamo --"al conductor de la orden X nunca le llegó"-- exigiría cruzar a
 * mano por teléfono y hora.
 *
 * Se parte de `notificaciones_conductor_enviadas`, que sí tiene la orden, y se
 * trae el estado real del mensaje por `mensaje_id`.
 *
 * UN AVISO SIN MENSAJE NO ES UN HUECO EN LOS DATOS: es información. Significa
 * que se registró el intento pero el envío no llegó a crear una fila, casi
 * siempre porque faltaba configuración. Por eso `estado` puede venir en null y
 * la pantalla lo muestra como tal en vez de esconderlo.
 */
export async function getHistorialConductor(
  limite = 50,
): Promise<{ success: boolean; data?: AvisoEnviado[]; faltaMigracion?: boolean; message?: string }> {
  try {
    const sb: any = await getSupabaseAdmin()

    const { data: enviadas, error } = await sb
      .from("notificaciones_conductor_enviadas")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limite)

    if (error) {
      if (faltaTabla(error.message)) return { success: true, data: [], faltaMigracion: true }
      return { success: false, message: error.message }
    }
    if (!enviadas?.length) return { success: true, data: [] }

    // Estado real de cada mensaje.
    const ids = enviadas.map((e: any) => e.mensaje_id).filter(Boolean)
    const porMensaje: Record<string, any> = {}
    if (ids.length) {
      const { data: msgs } = await sb
        .from("whatsapp_mensajes")
        .select("message_id, estado, error_codigo, error_detalle")
        .in("message_id", ids)
      for (const m of msgs ?? []) porMensaje[String(m.message_id)] = m
    }

    // Datos de la orden, para reconocerla sin tener que buscarla aparte.
    const ordenIds = [...new Set(enviadas.map((e: any) => Number(e.orden_id)))]
    const porOrden: Record<number, any> = {}
    if (ordenIds.length) {
      const { data: ords } = await sb
        .from("cabeceraoc")
        .select("id, ordendecargue, placa, conductor")
        .in("id", ordenIds)
      for (const o of ords ?? []) porOrden[Number(o.id)] = o
    }

    const nombres: Record<string, string> = {
      muelle_asignado: "Asignación de muelle",
      cargue_finalizado: "Fin de cargue",
    }

    return {
      success: true,
      data: enviadas.map((e: any) => {
        const m = e.mensaje_id ? porMensaje[String(e.mensaje_id)] : null
        const o = porOrden[Number(e.orden_id)]
        return {
          id: Number(e.id),
          ordenId: Number(e.orden_id),
          evento: e.evento,
          eventoNombre: nombres[e.evento] ?? e.evento,
          ordenDeCargue: o?.ordendecargue ?? null,
          placa: o?.placa ?? null,
          conductor: o?.conductor ?? null,
          telefono: e.telefono ?? null,
          estado: m?.estado ?? null,
          errorCodigo: m?.error_codigo ?? null,
          errorDetalle: m?.error_detalle ?? null,
          motivo: e.motivo ?? null,
          creadoEn: e.created_at,
        }
      }),
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo leer el historial." }
  }
}

/**
 * Un enlace de encuesta REAL, de la última orden cerrada.
 *
 * La pantalla de configuración no puede mostrar "el enlace": hay uno distinto
 * por cada orden y se arma al enviar. Sin poder abrir uno, no hay forma de
 * comprobar que la encuesta responde antes de activar el aviso --y el primero
 * en descubrirlo sería un conductor con un enlace roto.
 */
export async function getEnlaceEncuestaEjemplo(): Promise<{
  success: boolean
  url?: string
  orden?: string
  message?: string
}> {
  try {
    const sb: any = await getSupabaseAdmin()
    const { data, error } = await sb
      .from("cabeceraoc")
      .select("id, ordendecargue, fechacargue")
      .not("fincargue", "is", null)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return { success: false, message: error.message }
    if (!data) {
      return { success: false, message: "Todavía no hay ninguna orden de cargue cerrada." }
    }

    const token = await getTokenEncuesta(Number(data.id))
    return {
      success: true,
      url: `${dominioPublico()}/encuesta/${token}`,
      orden: String(data.ordendecargue ?? data.id),
    }
  } catch (e: any) {
    return { success: false, message: e?.message || "No se pudo armar el enlace." }
  }
}

export async function notificarConductor(
  evento: EventoConductor,
  ordenId: number,
): Promise<ResultadoAviso> {
  try {
    const sb: any = await getSupabaseAdmin()

    // --- 1) ¿Está activo? --------------------------------------------------
    const { data: cfgRow, error: errCfg } = await sb
      .from("notificaciones_conductor_config")
      .select("*")
      .eq("evento", evento)
      .maybeSingle()
    if (errCfg || !cfgRow) {
      return { enviado: false, motivo: "Sin configuración para este evento." }
    }
    const cfg = mapear(cfgRow)
    if (!cfg.activo) return { enviado: false, motivo: "El aviso está desactivado." }

    // --- 2) Los datos de la orden -----------------------------------------
    const { data: orden } = await sb
      .from("cabeceraoc")
      // `celular` es el telefono del conductor. Se escribe al crear la orden
      // desde `citasvehiculos.telefono`, pero hasta hoy NINGUN codigo lo leia:
      // su tasa real de llenado esta sin verificar, de ahi el respaldo de abajo.
      .select("id, idempresa, conductor, placa, ordendecargue, cliente, muelle, celular")
      .eq("id", ordenId)
      .maybeSingle()
    if (!orden) return { enviado: false, motivo: "No se encontró la orden." }

    const empresaId = Number(orden.idempresa)
    if (!cfg.empresas.includes(empresaId)) {
      return { enviado: false, motivo: `El aviso no está habilitado para la empresa ${empresaId}.` }
    }

    // --- 3) Una sola vez por orden y evento --------------------------------
    // Reasignar muelle o volver a guardar una orden cerrada dispararía el mismo
    // aviso otra vez: dos mensajes iguales al conductor y dos cobros.
    const { data: ya } = await sb
      .from("notificaciones_conductor_enviadas")
      .select("id")
      .eq("orden_id", ordenId)
      .eq("evento", evento)
      .maybeSingle()
    if (ya) return { enviado: false, motivo: "Ya se había avisado de este evento." }

    const ctx: ContextoOrden = {
      ordenId,
      empresaId,
      conductor: orden.conductor ?? null,
      placa: orden.placa ?? null,
      ordenDeCargue: orden.ordendecargue ?? null,
      cliente: orden.cliente ?? null,
      muelle: orden.muelle == null ? null : Number(orden.muelle),
      telefonoConductor: orden.celular ?? null,
    }

    // Respaldo: si la orden no trae telefono, se busca en `citasvehiculos`, que
    // es de donde salio originalmente. Se cruza por la orden de cargue y, si no,
    // por placa. Esa tabla NO tiene unico por `ocargue` --hay duplicados-- asi
    // que se toma la fila mas reciente.
    if (!ctx.telefonoConductor && (ctx.ordenDeCargue || ctx.placa)) {
      try {
        let q = sb
          .from("citasvehiculos")
          .select("telefono, nombreconductor, id")
          .order("id", { ascending: false })
          .limit(1)
        q = ctx.ordenDeCargue
          ? q.eq("ocargue", ctx.ordenDeCargue)
          : q.eq("placa", ctx.placa)
        const { data: cita } = await q.maybeSingle()
        if (cita?.telefono) ctx.telefonoConductor = String(cita.telefono)
        if (!ctx.conductor && cita?.nombreconductor) ctx.conductor = cita.nombreconductor
      } catch (e: any) {
        console.error("[v0] notificarConductor citasvehiculos:", e?.message ?? e)
      }
    }

    /*
     * Registra un intento que NO llegó a enviarse.
     *
     * Sin esto, los fallos por dato --celular vacío o mal digitado-- serían
     * invisibles: la función retorna antes de llegar al registro, así que no
     * quedaría ni rastro. El conductor no recibe nada y en el historial no hay
     * ninguna línea que explique el hueco.
     *
     * Se registra con `mensaje_id` en null, que es lo que el historial lee como
     * "Sin enviar", más el motivo.
     */
    const registrarFallo = async (motivo: string, telefono?: string | null) => {
      try {
        await sb.from("notificaciones_conductor_enviadas").insert({
          orden_id: ordenId,
          evento,
          telefono: telefono ?? null,
          mensaje_id: null,
          motivo,
        })
      } catch {
        // El índice único lo rechaza si ya había un intento para esta orden y
        // evento. No es un error: ya está registrado.
      }
    }

    // --- 4) A qué número ---------------------------------------------------
    // El desvío de pruebas manda sobre todo lo demás: mientras tenga valor,
    // ninguna persona externa recibe nada.
    let destino = cfg.telefonoPrueba
    if (!destino) {
      // Sin desvío, va al conductor real.
      const crudo = ctx.telefonoConductor
      if (!crudo) {
        // El prefijo permite clasificar el fallo en el historial sin tener que
        // interpretar el texto. Son dos problemas distintos: aquí falta
        // capturar el dato; abajo el dato está pero mal escrito.
        const motivo = `SIN_CELULAR: la orden ${ctx.ordenDeCargue ?? ordenId} no tiene teléfono del conductor.`
        await registrarFallo(motivo)
        return { enviado: false, motivo }
      }

      /*
       * Se normaliza AQUÍ, y no se deja para el envío, por dos razones.
       *
       * En la base el celular se guarda sin indicativo (3215698570) y WhatsApp
       * lo exige completo. Eso lo resuelve `normalizarTelefono`, que antepone
       * el 57.
       *
       * Pero también hay números mal digitados --de 9 dígitos, o con letras--
       * que no se pueden arreglar adivinando. Antes, uno de esos llegaba al
       * envío y fallaba allá, con un mensaje genérico y sin decir de qué orden
       * venía. Fallar aquí permite nombrar la orden y el valor que trae, que es
       * lo único con lo que alguien puede ir a corregir el dato.
       */
      const normalizado = await normalizarTelefono(crudo)
      if (!normalizado) {
        const digitos = String(crudo).replace(/\D/g, "")
        const motivo = `CELULAR_INVALIDO: "${crudo}" (${digitos.length} dígitos). Se esperan 10 empezando por 3; el 57 lo antepone el sistema. Orden ${ctx.ordenDeCargue ?? ordenId}.`
        await registrarFallo(motivo, crudo)
        return { enviado: false, motivo }
      }
      destino = normalizado
    }

    // El enlace de la encuesta se arma POR ORDEN: lleva un token propio para
    // que la respuesta quede atada a ese cargue y para que nadie pueda recorrer
    // los enlaces de otras órdenes.
    //
    // Si `url_encuesta` ya es una URL completa (un formulario externo), se
    // respeta tal cual: quien configuró eso lo hizo a propósito.
    let urlEncuesta = cfg.urlEncuesta
    if (evento === "cargue_finalizado") {
      const propia = String(cfg.urlEncuesta ?? "").trim()
      // 'forms.gle/PENDIENTE' fue el marcador que sembró la primera versión del
      // script 182. Parece una URL externa y por eso le ganaría a la encuesta
      // propia, pero no abre nada: se ignora como si el campo estuviera vacío.
      const esMarcadorMuerto = propia === "https://forms.gle/PENDIENTE"
      const esExterna =
        !esMarcadorMuerto && /^https?:\/\//i.test(propia) && !propia.includes("/encuesta/")
      if (!esExterna) {
        const token = await getTokenEncuesta(ordenId)
        urlEncuesta = `${dominioPublico()}/encuesta/${token}`
      }
    }

    const texto = armarMensaje(cfg.mensaje, ctx, urlEncuesta)
    if (!texto) return { enviado: false, motivo: "El mensaje quedó vacío." }

    // Usa la plantilla propia del conductor --UTILITY, sin el tope por
    // destinatario de las de MARKETING-- y cae a la genérica si Meta todavía
    // no la aprobó.
    const r = await enviarAvisoConductor({
      telefono: destino,
      conductor: ctx.conductor || "conductor",
      placa: ctx.placa ?? "",
      orden: ctx.ordenDeCargue ?? String(ordenId),
      detalle: texto,
      titulo: cfg.titulo,
      empresaId,
      origen: `conductor:${evento}`,
    })

    // Se registra aunque falle: un intento fallido también cuenta como "ya se
    // intentó", y evita que un reintento automático inunde al conductor.
    //
    // `message_id` es lo que permite cruzar después con `whatsapp_mensajes` y
    // saber qué orden fue cada aviso. Sin él, el historial mostraría teléfonos
    // sueltos sin forma de decir a qué cargue correspondían.
    try {
      await sb.from("notificaciones_conductor_enviadas").insert({
        orden_id: ordenId,
        evento,
        telefono: destino,
        mensaje_id: r.messageId ?? null,
        motivo: r.success ? null : r.message ?? null,
      })
    } catch {
      // El índice único puede rechazarlo si dos llamadas corrieron a la vez.
      // No es un error: significa que otra ya lo registró.
    }

    if (!r.success) return { enviado: false, motivo: r.message, telefono: destino }
    return { enviado: true, telefono: destino }
  } catch (e: any) {
    // Nunca se propaga: asignar muelle y cerrar orden tienen que funcionar
    // aunque la mensajería esté caída.
    console.error("[v0] notificarConductor:", e?.message ?? e)
    return { enviado: false, motivo: e?.message || "Error al notificar." }
  }
}
