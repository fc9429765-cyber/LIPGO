import { type NextRequest, NextResponse } from "next/server"
import { notificarConductor } from "@/lib/notificacion-conductor-actions"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { getColombiaTime } from "@/lib/date-utils"
import { generarIngresoProduccionDesdeDescargue } from "@/lib/orders-actions"
import { computarRosterPagoGlobal, esDescargueSinPersonalRequerido } from "@/lib/picking-actions"
import { esModoCargaRequerido } from "@/lib/sla-acordados"
import { reportarInterno } from "@/lib/reporte-interno-actions"
import { exigirSesionApi } from "@/lib/puerta-api"

// Subimos un solo archivo (o pocos) por request para evitar el limite
// duro de ~4.5MB por body en Vercel serverless. Cuando un movil envia
// varias fotos pesadas en un mismo POST, el body total se sale del
// limite y la peticion ni siquiera entra a la funcion: por eso a los
// usuarios "se les queda pegado" el dialog. Con este endpoint el
// cliente puede llamar varias veces (1 a 1) y al final disparar
// `finalize` para cerrar la orden.
//
// Modos:
//  - mode = "append" (default): solo sube los archivos del request y
//    devuelve sus URLs. NO actualiza `cabeceraoc`.
//  - mode = "finalize": NO sube archivos. Recibe la lista completa
//    de URLs ya subidas y actualiza `cabeceraoc.fotospicking` y
//    `fincargue` para cerrar la orden.
export async function POST(request: NextRequest) {
  const puerta = await exigirSesionApi()
  if (puerta) return puerta
  try {
    const formData = await request.formData()
    const orderId = formData.get("orderId") as string
    const mode = (formData.get("mode") as string) || "append"

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "orderId requerido" },
        { status: 400 },
      )
    }

    const supabaseAdmin = await getSupabaseAdmin()

    if (mode === "finalize") {
      const urlsRaw = formData.get("urls") as string
      let urls: string[] = []
      try {
        urls = JSON.parse(urlsRaw || "[]")
      } catch {
        return NextResponse.json(
          { success: false, error: "urls inválido" },
          { status: 400 },
        )
      }
      if (!Array.isArray(urls) || urls.length === 0) {
        return NextResponse.json(
          { success: false, error: "Debe enviar al menos una URL" },
          { status: 400 },
        )
      }

      const orderIdNum = Number.parseInt(orderId)
      const { data: orderRow, error: orderErr } = await supabaseAdmin
        .from("cabeceraoc")
        .select("idempresa, fechacargue, tipooperacion, facturar, tipo_pago, modo_carga, ordendecargue")
        .eq("id", orderIdNum)
        .single()
      if (orderErr || !orderRow) {
        return NextResponse.json({ success: false, error: "No se encontró la orden" }, { status: 404 })
      }

      // No se puede cerrar (fin de operación) una orden que sigue con una
      // pausa abierta (tabla `pausas`, fin IS NULL) — hay que reanudarla
      // primero. Antes no había ningún gate para esto (ni UI ni servidor).
      const { data: pausasAbiertas } = await supabaseAdmin
        .from("pausas")
        .select("id")
        .eq("ordendecargue", orderRow.ordendecargue)
        .is("fin", null)
        .limit(1)
      if (pausasAbiertas && pausasAbiertas.length > 0) {
        return NextResponse.json(
          { success: false, error: "La orden está en pausa; reanúdela antes de cargar las fotos y cerrar" },
          { status: 400 },
        )
      }

      // Misma excepción que ya usan Picking/Packing/Centro de Coordinación
      // para no exigir personal: Distribución sin facturar tampoco exige
      // tipo de pago (no hay tonelaje que repartir).
      const exentoPorNoFacturable = orderRow.tipooperacion === "Distribucion" && orderRow.facturar === false

      // Descargue de Huevos en ID2: el personal se paga aparte (puesto
      // "Cargue/Descargue Huevos"), no por destajo de esta orden — tampoco
      // exige tipo de pago ni personal. Confirmado 2026-08-28, alcance
      // estricto (ver esDescargueSinPersonalRequerido).
      const exentoPorHuevos = await esDescargueSinPersonalRequerido(
        supabaseAdmin,
        orderIdNum,
        orderRow.idempresa,
        orderRow.tipooperacion,
      )

      // Un clon de Distribución automática ("+D", ver generarDistribucionAutomatica
      // en lib/orders-actions.tsx) es el MISMO vehículo/orden que su madre de
      // Cargue — desde que se excluyó de la asignación de muelle en Centro de
      // Coordinación (único lugar donde se elige tipo_pago), el clon ya no
      // tiene forma de elegir el suyo propio y quedaba trabado sin poder
      // cerrarse en Packing. Hereda el de la madre en vez de exigir uno nuevo.
      let tipoPagoEfectivo = orderRow.tipo_pago
      const esClonDistribucion = orderRow.tipooperacion === "Distribucion" && /D$/.test(String(orderRow.ordendecargue || ""))
      if (esClonDistribucion && tipoPagoEfectivo !== "global" && tipoPagoEfectivo !== "individual") {
        const codigoMadre = String(orderRow.ordendecargue).slice(0, -1)
        const { data: madre } = await supabaseAdmin
          .from("cabeceraoc")
          .select("tipo_pago")
          .eq("idempresa", orderRow.idempresa)
          .eq("ordendecargue", codigoMadre)
          .maybeSingle()
        if (madre?.tipo_pago === "global" || madre?.tipo_pago === "individual") {
          tipoPagoEfectivo = madre.tipo_pago
        }
      }

      let auxiliaresOverride: string | undefined
      if (!exentoPorNoFacturable && !exentoPorHuevos) {
        if (tipoPagoEfectivo !== "global" && tipoPagoEfectivo !== "individual") {
          return NextResponse.json(
            { success: false, error: "Debe elegir Pago Global o Individual antes de cerrar la orden" },
            { status: 400 },
          )
        }
        if (tipoPagoEfectivo === "global") {
          const roster = await computarRosterPagoGlobal(orderRow.idempresa, orderRow.fechacargue)
          if (roster.length === 0) {
            // Fail-CLOSED a propósito: sobrescribir con vacío perdería el
            // tonelaje del día en pagonomina. Mejor bloquear y que se
            // revise Registro de Asistencia antes de cerrar.
            return NextResponse.json(
              {
                success: false,
                error: "No se encontró personal elegible presente ese día en Registro de Asistencia; revise antes de cerrar",
              },
              { status: 400 },
            )
          }
          auxiliaresOverride = roster.join(",")
        }
        // tipo_pago === "individual": no se toca auxiliares, se respeta lo
        // que ya asignó el coordinador por vehículo.
      }

      // Modo de carga (Estibado/Arrume): obligatorio SOLO en Cargue de
      // ID1/ID2 (ver esModoCargaRequerido). No afecta ningún otro tipo de
      // operación ni proyecto — confirmado por el usuario 2026-08-29.
      if (esModoCargaRequerido(orderRow.idempresa, orderRow.tipooperacion)) {
        if (orderRow.modo_carga !== "Estibado" && orderRow.modo_carga !== "Arrume") {
          return NextResponse.json(
            { success: false, error: "Debe elegir Estibado o Arrume antes de cerrar la orden" },
            { status: 400 },
          )
        }
      }

      // Picking confirmado (invtrans "aprobado") obligatorio SOLO en Cargue.
      // Sin esto la orden cerraba dejando líneas en "por descontar" para
      // siempre — el inventario real (saldoinvdetalle) EXCLUYE lo no
      // aprobado, así que el stock quedaba inflado en libros aunque el
      // camión ya se había ido. "Cargar fotos" en Picking solo exigía
      // personal/tipo_pago, nunca picking confirmado. Confirmado con datos
      // reales 2026-08-29/30: 15 órdenes ya cerradas así. El coordinador
      // tiene ahora un botón "Confirmar Picking" en Centro de Coordinación
      // (confirmPicking) para resolverlo él mismo si el montacarguista ya
      // se fue sin confirmar.
      if (orderRow.tipooperacion === "Cargue") {
        const { data: lineasInv } = await supabaseAdmin
          .from("invtrans")
          .select("status")
          .eq("ocargue", orderRow.ordendecargue)
          .eq("origen", "orden de cargue")
        const totalLineas = lineasInv?.length ?? 0
        const lineasAprobadas = (lineasInv ?? []).filter(
          (l: any) => String(l.status || "").toLowerCase() === "aprobado",
        ).length
        if (totalLineas > 0 && lineasAprobadas < totalLineas) {
          return NextResponse.json(
            {
              success: false,
              error: "Debe confirmar el Picking antes de cerrar la orden (quedan líneas de inventario sin verificar)",
            },
            { status: 400 },
          )
        }
      }

      const fincargue = await getColombiaTime()
      const { error: updateError } = await supabaseAdmin
        .from("cabeceraoc")
        .update({
          fotospicking: JSON.stringify(urls),
          fincargue,
          ...(auxiliaresOverride !== undefined ? { auxiliares: auxiliaresOverride } : {}),
          // Deja trazado en el propio clon el tipo de pago heredado de la
          // madre (antes quedaba null aunque la orden ya cerrara con ese modo).
          ...(esClonDistribucion && tipoPagoEfectivo !== orderRow.tipo_pago ? { tipo_pago: tipoPagoEfectivo } : {}),
        })
        .eq("id", orderIdNum)

      if (updateError) {
        console.error("[v0] Error updating fotospicking:", updateError)
        return NextResponse.json(
          {
            success: false,
            error: "URLs guardadas pero falló al actualizar la orden",
            details: updateError.message,
          },
          { status: 500 },
        )
      }

      // Cierre real de la orden (fincargue ya quedó grabado arriba). Si es un
      // descargue de PT en un CEDI (id3/id4), esto crea el ingreso pendiente en
      // Producción → "Aprobación de ingreso". No-op para cualquier otro caso
      // (falla-seguro internamente, no bloquea la respuesta de cierre).
      await generarIngresoProduccionDesdeDescargue(supabaseAdmin, orderIdNum)

      // Aviso al conductor de que puede recoger el vehiculo. Mismo patron
      // falla-seguro que la linea de arriba: `notificarConductor` nunca lanza,
      // asi que la orden queda cerrada aunque la mensajeria este caida.
      //
      // OJO con el clon de Distribucion: es el MISMO vehiculo fisico que su
      // orden madre de Cargue, asi que avisar en ambos cierres le mandaria dos
      // mensajes al conductor por un solo camion. Se omite el clon.
      if (!esClonDistribucion) {
        try {
          await notificarConductor("cargue_finalizado", orderIdNum)
        } catch (e: any) {
          console.error("[v0] aviso cargue_finalizado:", e?.message ?? e)
        }
        // El reporte interno sigue la misma regla que el aviso al conductor:
        // el clon "+D" no es otro camión, así que contarlo dos veces daría un
        // cierre de más en la bandeja de quien lo recibe.
        try {
          await reportarInterno("cargue_cerrado", orderIdNum)
        } catch (e: any) {
          console.error("[v0] reporte interno cargue_cerrado:", e?.message ?? e)
        }
      }

      return NextResponse.json({ success: true, count: urls.length })
    }

    // mode = "append": subir archivos enviados en este request.
    const files: File[] = []
    for (const [key, value] of formData.entries()) {
      if (key === "files" && value instanceof File) {
        files.push(value)
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "No se enviaron archivos" },
        { status: 400 },
      )
    }

    // Validacion defensiva: si llegan archivos individualmente muy
    // grandes (>8MB), los rechazamos con un error claro en lugar de
    // dejar que el upstream se cuelgue.
    const tooBig = files.find((f) => f.size > 8 * 1024 * 1024)
    if (tooBig) {
      return NextResponse.json(
        {
          success: false,
          error: `La foto "${tooBig.name}" pesa más de 8MB. Reduce su tamaño antes de subir.`,
        },
        { status: 413 },
      )
    }

    const urls: string[] = []
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      const timestamp = Date.now()
      const extension = (file.name.split(".").pop() || "jpg").toLowerCase()
      const filename = `picking_${orderId}_${timestamp}_${index}_${Math.random()
        .toString(36)
        .slice(2, 8)}.${extension}`
      const filePath = `fotospicking/${filename}`

      const { error } = await supabaseAdmin.storage
        .from("archivos")
        .upload(filePath, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        })

      if (error) {
        console.error("[v0] Supabase upload error:", filePath, error)
        return NextResponse.json(
          {
            success: false,
            error: `Error al subir ${file.name}: ${error.message}`,
          },
          { status: 500 },
        )
      }

      const {
        data: { publicUrl },
      } = supabaseAdmin.storage.from("archivos").getPublicUrl(filePath)
      urls.push(publicUrl)
    }

    return NextResponse.json({ success: true, urls, count: urls.length })
  } catch (error) {
    console.error("[v0] Upload error:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Upload failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

// Aumentamos el body limit del runtime nodejs al maximo razonable.
// El verdadero cuello de botella esta en el cliente subiendo de a 1.
export const runtime = "nodejs"
export const maxDuration = 60
