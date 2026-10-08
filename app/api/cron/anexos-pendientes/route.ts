import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdminAsSystem } from "@/lib/supabase-admin"
import { registrarEventoCiclo, getCondicionesGeneracionPrefactura, generarPrefacturaAhora } from "@/lib/ciclo-facturacion-actions"
import { ownerDePrefactura, fechaAyerColombiaISO, proyectoEntregado } from "@/lib/ciclo-facturacion-shared"
import { construirPdfAnexoFacturacion } from "@/lib/anexo-facturacion-pdf"
import { registrarErrorServidor } from "@/lib/errores-servidor"

/**
 * CRON DIARIO -- dos fases, en este orden:
 *
 * FASE A -- GENERAR automáticamente la prefactura de los proyectos que lo
 * tengan activado (`condiciones_generacion_prefactura`, panel "Frecuencia de
 * generación de prefacturas" en Ciclo de Facturación). Antes esto lo hacía
 * siempre una persona a mano en Cuadro de Control/Prefactura de Producción;
 * ahora, si el proyecto lo pide, el propio cron calcula el período contiguo
 * (desde el día siguiente a la última prefactura aprobada, hasta ayer) y lo
 * genera solo -- decisión del negocio: "generar igual y avisar después", así
 * que si hay advertencias (sin tarifa vigente/pago no cuadra/avisos de
 * producción) igual se genera, pero quedan guardadas en `prefacturas.advertencias`
 * para que el Jefe las revise (alerta en el top-bar) y corrija si hace falta
 * con "Solicitar corrección". Nunca se adivina una fecha de arranque: si un
 * proyecto no tiene ninguna prefactura previa, usa `fecha_inicio` (la que el
 * Jefe escribió a mano en el panel, una sola vez); sin esa fecha tampoco, se
 * omite -- nunca inventa un punto de partida. Tampoco se fuerza nunca un
 * solape de período.
 *
 * FASE B -- envía automáticamente el anexo (evento `anexo_enviado`) de las
 * prefacturas YA APROBADAS (por una persona o por la Fase A de arriba) que
 * están esperando su anexo (estado_ciclo='pendiente_anexo'). Sin cambios
 * respecto al cron original -- una prefactura recién generada en la Fase A ya
 * queda en ese estado, así que esta fase la recoge en la misma corrida.
 *
 * Corre TODOS LOS DÍAS (ver vercel.json); cada proyecto decide, con su propia
 * config, si HOY le toca generar y/o enviar (son decisiones independientes:
 * un proyecto puede generar diario y enviar semanal, por ejemplo -- en ese
 * caso el cliente recibirá varios anexos separados el día de envío, uno por
 * cada prefactura generada esos días, no uno solo consolidado).
 */

const DIA_SEMANA_DEFAULT = 1 // lunes
const USUARIO_CRON = "sistema (cron diario)"

function diaSemanaColombiaHoy(): number {
  const ahora = new Date()
  const colombia = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Bogota" }))
  return colombia.getDay()
}

/**
 * Día-del-mes de "ayer" y cantidad de días que tuvo ese mes (Colombia) --
 * para la cadencia "cortes" (ver más abajo). Se deriva de la MISMA
 * `fechaAyerColombiaISO` que ya usa `generarPrefacturaAhora` para calcular
 * "hasta", así el disparo del cron y el período que termina generando la
 * prefactura son siempre consistentes entre sí.
 */
function diaYUltimoDiaDelMesDeAyer(): { diaMesAyer: number; diasEnMesAyer: number } {
  const [y, m, d] = fechaAyerColombiaISO().split("-").map(Number)
  return { diaMesAyer: d, diasEnMesAyer: new Date(y, m, 0).getDate() }
}

/**
 * Decide, por proyecto, si HOY le toca generar (activo + frecuencia/día) y,
 * si le toca, delega TODA la lógica de generación a `generarPrefacturaAhora`
 * -- la MISMA función que usa el botón manual "Generar ahora" de la UI, para
 * que nunca existan 2 fórmulas paralelas del mismo cálculo (mismo principio
 * ya aplicado al bono de productividad de Parafiscales/PILA esta sesión).
 *
 * "Cortes" (varios días del mes, ej. [8,16,25], definidos por el Jefe): cada
 * valor es el ÚLTIMO día incluido en su período -- el disparo real ocurre al
 * día siguiente (mismo patrón que "semanal": dispara lunes, cubre hasta el
 * domingo, vía el "hasta = ayer" que ya calcula `generarPrefacturaAhora`).
 * Por eso aquí se compara contra el día-del-mes de AYER, no de hoy. Cada día
 * configurado se recorta contra el último día real del mes de ayer, así un
 * corte en 31 también sirve como "fin de mes" en los meses más cortos.
 */
async function generarPrefacturasAutomaticas(hoy: number) {
  const resultado = { generadas: 0, omitidas: 0, errores: [] as { idempresa: number; error: string }[] }

  const condiciones = await getCondicionesGeneracionPrefactura()
  if (!condiciones.success) {
    resultado.errores.push({ idempresa: 0, error: "No se pudieron leer las condiciones de generación: " + condiciones.message })
    return resultado
  }

  const { diaMesAyer, diasEnMesAyer } = diaYUltimoDiaDelMesDeAyer()

  for (const cond of condiciones.data) {
    // Un proyecto entregado no se factura más desde aquí, aunque su condición
    // siga activa en la base (no se tocan parámetros por proyecto).
    if (!cond.activo || proyectoEntregado(cond.idempresa)) {
      resultado.omitidas++
      continue
    }
    const leToca =
      cond.frecuencia === "diario" ||
      (cond.frecuencia === "semanal" && cond.dia_semana === hoy) ||
      (cond.frecuencia === "cortes" && (cond.dias_corte || []).some((d) => Math.min(d, diasEnMesAyer) === diaMesAyer))
    if (!leToca) {
      resultado.omitidas++
      continue
    }

    // Una llamada puede generar VARIAS prefacturas -- una por owner real del
    // proyecto (ver generarPrefacturaAhora). Se cuenta por owner, no por
    // proyecto, para que el resumen del cron refleje lo que de verdad pasó.
    const r = await generarPrefacturaAhora(cond.idempresa, USUARIO_CRON)
    if (r.resultados.length === 0) {
      if (!r.success) resultado.errores.push({ idempresa: cond.idempresa, error: r.mensaje })
      else resultado.omitidas++ // sin_pendientes / sin_fecha_inicio: resultado esperado, no un error
      continue
    }
    for (const ro of r.resultados) {
      if (ro.estado === "generada") resultado.generadas++
      else if (!ro.success) resultado.errores.push({ idempresa: cond.idempresa, error: `${ro.owner}: ${ro.mensaje}` })
      else resultado.omitidas++ // al_dia / nada_que_facturar para ese owner: esperado, no un error
    }
  }

  return resultado
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/anexos-pendientes] CRON_SECRET no configurado -- el cron no puede correr (falla cerrado).")
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const resultados: {
    generacion: { generadas: number; omitidas: number; errores: { idempresa: number; error: string }[] }
    procesadas: number
    omitidas: number
    noLeToca: number
    errores: { id: number; error: string }[]
  } = {
    generacion: { generadas: 0, omitidas: 0, errores: [] },
    procesadas: 0,
    omitidas: 0,
    noLeToca: 0,
    errores: [],
  }

  try {
    const sb: any = await getSupabaseAdminAsSystem()
    const hoy = diaSemanaColombiaHoy()

    // FASE A -- generar automáticamente lo que corresponda hoy.
    resultados.generacion = await generarPrefacturasAutomaticas(hoy)

    // FASE B -- enviar el anexo de toda prefactura aprobada (recién generada
    // arriba, o aprobada por una persona) que esté esperando su anexo.
    const { data: condiciones } = await sb.from("condiciones_envio_anexo").select("idempresa, frecuencia, dia_semana")
    const condicionPorEmpresa = new Map<number, { frecuencia: string; dia_semana: number | null }>()
    for (const c of condiciones || []) condicionPorEmpresa.set(c.idempresa, c)

    const { data: candidatas, error: errCand } = await sb
      .from("prefacturas")
      .select("id, idempresa, proyecto, periodo_desde, periodo_hasta, soporte, lineas")
      .eq("estado", "aprobada")
      .eq("estado_ciclo", "pendiente_anexo")

    if (errCand) {
      return NextResponse.json({ error: errCand.message, ...resultados }, { status: 500 })
    }

    for (const p of candidatas || []) {
      // Un proyecto entregado no recibe más anexos.
      if (proyectoEntregado(p.idempresa)) {
        resultados.omitidas++
        continue
      }
      try {
        const cond = condicionPorEmpresa.get(p.idempresa)
        const frecuencia = cond?.frecuencia || "semanal"
        const diaSemana = cond ? cond.dia_semana : DIA_SEMANA_DEFAULT
        const leToca = frecuencia === "diario" || diaSemana === hoy
        if (!leToca) {
          resultados.noLeToca++
          continue
        }

        if (!p.soporte?.length) {
          resultados.omitidas++
          continue
        }

        const { owner } = ownerDePrefactura(p.lineas)
        const { data: empresa } = await sb.from("empresas_permisos").select("nombre, nit, direccion").eq("id", p.idempresa).maybeSingle()

        const buffer = await construirPdfAnexoFacturacion({
          empresaProyecto: { nombre: empresa?.nombre || p.proyecto || `Empresa ${p.idempresa}`, nit: empresa?.nit ?? null, direccion: empresa?.direccion ?? null },
          proyecto: p.proyecto || "",
          owner,
          periodoDesde: p.periodo_desde,
          periodoHasta: p.periodo_hasta,
          soporte: p.soporte,
        })

        const path = `ciclo_facturacion/anexo_enviado/prefactura_${p.id}_${Date.now()}.pdf`
        const { error: errUpload } = await sb.storage.from("archivos").upload(path, Buffer.from(buffer), {
          contentType: "application/pdf",
          upsert: true,
        })
        if (errUpload) throw new Error(`Storage: ${errUpload.message}`)

        const { data: pub } = sb.storage.from("archivos").getPublicUrl(path)
        const nombre = `Anexo_${owner}_${p.id}.pdf`.replace(/[^a-zA-Z0-9_.-]+/g, "_")

        const r = await registrarEventoCiclo(p.id, "anexo_enviado", [{ url: pub.publicUrl, nombre }], USUARIO_CRON, true)
        if (!r.success) throw new Error(r.message || "registrarEventoCiclo falló")

        resultados.procesadas++
      } catch (e: any) {
        resultados.errores.push({ id: p.id, error: e?.message || String(e) })
        // Hasta hoy un anexo que fallaba todos los días no dejaba rastro en ninguna parte.
        void registrarErrorServidor("cron.anexos-pendientes.enviar", e, { prefacturaId: p.id, idempresa: p.idempresa })
      }
    }

    return NextResponse.json(resultados)
  } catch (error: any) {
    console.error("[cron/anexos-pendientes] error fatal:", error)
    void registrarErrorServidor("cron.anexos-pendientes", error)
    return NextResponse.json({ error: error?.message || "Error inesperado", ...resultados }, { status: 500 })
  }
}
