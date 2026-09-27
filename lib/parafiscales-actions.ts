"use server"

// Submódulo "Parafiscales" (Gestión Humana › Nómina): cuadro de control de los
// aportes de Seguridad Social y Parafiscales que la EMPRESA debe pagar cada mes
// a los entes de control (Pensión, Salud, ARL, Caja, SENA, ICBF) — la guía para
// liquidar la planilla PILA.
//
// Fuente de los datos (todo real, nada simulado). Cada día del mes se clasifica
// por su novedad (`pagonomina.novedad_reportada`) y cotiza según la norma PILA:
//   · Trabajado  → IBC = `total_liquidado_dia` (BASE del día + extras + recargos +
//     dominical/festivo, SIN auxilio de transporte) + la BONIFICACIÓN por productividad
//     = excedente de destajo NETO de la quincena (piso 0), TODA prestacional -- pero
//     SOLO desde el 1-jul-2026 (`BONO_DESTAJO_IBC_DESDE`). Confirmado por el usuario
//     2026-09-07 (mismo corte ya validado en liquidaciones-actions.ts): antes de julio
//     el concepto 52 no estaba claro/consolidado, por eso no entra al IBC de esos meses;
//     desde julio sí, y debe coincidir 100% con lo realmente pagado. Cotiza TODO, incl.
//     ARL, cuando aplica.
//     NOTA pendiente: esto deja que lo PROYECTADO (`cabeceraoc.tipooperacion =
//     'proyeccion'`) entre al IBC vía este mismo bono si un mes se consulta ANTES de
//     cerrar sus proyecciones — no debería afectar meses ya cerrados, pero vigilar si
//     se usa para el mes en curso.
//   · Vacaciones → IBC = salario/día. Cotiza pensión + salud + caja (no ARL).
//   · Incapacidad→ IBC = salario/día (día completo). Cotiza 12%+4% pensión + 4% salud
//     EMPLEADO (el 8.5% patronal de salud NO se causa: lo asume la EPS/ARL). No caja, no ARL.
//   · Ausentismo → licencia no remunerada / suspensión temporal de contrato: solo 12%
//     de pensión (empleador). Mismo código PILA (SLN), mismo tratamiento.
//   · Licencia remunerada (luto/maternidad/paternidad) → pensión + salud + caja, SIN ARL.
//   · Retiro / día posterior a `headcount.fecha_retiro` → NO cotiza.
//   REGLA: ninguna novedad que impida asistir a trabajar causa ARL (solo los días trabajados).
//   · Vacaciones PAGADAS EN LIQUIDACIÓN de retiro (no disfrutadas, pago en dinero al
//     salir) → suman su valor al IBC de CAJA únicamente, en el mes del retiro. Fuente:
//     `getLiquidaciones()` (lib/liquidaciones-actions.ts), mismo valor que ve el
//     submódulo Liquidaciones.
//   · Auxilio de transporte → `parametros_legales_anio.auxilio_transporte`,
//     proporcional a los días trabajados y solo para quien devenga hasta 2 SMMLV.
//   · admin (clase de riesgo ARL), salario y fecha_retiro → `headcount`.
// El cálculo (bases por concepto, piso/tope, exoneración) vive en lib/parafiscales.ts
// (lógica pura); aquí solo se arman las entradas. Ver `parametros_parafiscales`.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import {
  calcularAportes,
  validarParametros,
  PARAFISCALES_DEFAULT,
  clasificarDiaCotizacion,
  type Aportes,
  type ClaseRiesgo,
  type ParametrosParafiscales,
} from "@/lib/parafiscales"
import { getLiquidaciones } from "@/lib/liquidaciones-actions"

export interface ParafiscalPersona extends Aportes {
  persona: string
  identificacion: string
  idempresa: number | null
  esAdmin: boolean
  dias: number
  devengado: number
  /** IBC REALMENTE radicado en Aportes en Línea ese mes (parafiscales_real), si se guardó. */
  ibcReal: number | null
  /** true si `ibc` viene del valor real guardado (no de la fórmula en vivo). */
  tieneValorReal: boolean
  /** Vacaciones pagadas en la liquidación de retiro (si se retiró este mes), ya
   *  incluidas en `ibcCaja`/`caja`/`totalEmpresa` -- ver comentario en getParafiscales(). */
  vacacionesLiquidacion: number
}

export interface ResumenParafiscales {
  personas: number
  exonerados: number
  ibc: number
  pensionEmpleador: number
  saludEmpleador: number
  arl: number
  caja: number
  sena: number
  icbf: number
  totalEmpresa: number
  pensionEmpleado: number
  saludEmpleado: number
  totalEmpleado: number
  totalPila: number
}

const CLASES: ClaseRiesgo[] = ["I", "II", "III", "IV", "V"]
const asClase = (v: unknown, def: ClaseRiesgo): ClaseRiesgo =>
  CLASES.includes(String(v) as ClaseRiesgo) ? (String(v) as ClaseRiesgo) : def

function finDeMes(anio: number, mes: number): string {
  const d = new Date(Date.UTC(anio, mes, 0))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

// Bono de destajo (concepto 52) al IBC solo desde esta fecha -- ver comentario
// de cabecera. Mismo corte confirmado ya en liquidaciones-actions.ts.
const BONO_DESTAJO_IBC_DESDE = "2026-07-01"

async function leerParametros(admin: any, anio: number): Promise<ParametrosParafiscales> {
  const { data } = await admin.from("parametros_parafiscales").select("*").eq("anio", anio).maybeSingle()
  if (!data) return { anio, ...PARAFISCALES_DEFAULT }
  const n = (v: unknown, d: number) => (v == null || v === "" ? d : Number(v))
  return {
    anio,
    pctPensionEmpleador: n(data.pct_pension_empleador, PARAFISCALES_DEFAULT.pctPensionEmpleador),
    pctPensionEmpleado: n(data.pct_pension_empleado, PARAFISCALES_DEFAULT.pctPensionEmpleado),
    pctSaludEmpleador: n(data.pct_salud_empleador, PARAFISCALES_DEFAULT.pctSaludEmpleador),
    pctSaludEmpleado: n(data.pct_salud_empleado, PARAFISCALES_DEFAULT.pctSaludEmpleado),
    pctSena: n(data.pct_sena, PARAFISCALES_DEFAULT.pctSena),
    pctIcbf: n(data.pct_icbf, PARAFISCALES_DEFAULT.pctIcbf),
    pctCaja: n(data.pct_caja, PARAFISCALES_DEFAULT.pctCaja),
    umbralExoneracionSmlv: n(data.umbral_exoneracion_smlv, PARAFISCALES_DEFAULT.umbralExoneracionSmlv),
    topeIbcSmlv: n(data.tope_ibc_smlv, PARAFISCALES_DEFAULT.topeIbcSmlv),
    claseArlAdmin: asClase(data.clase_arl_admin, PARAFISCALES_DEFAULT.claseArlAdmin),
    claseArlOperativo: asClase(data.clase_arl_operativo, PARAFISCALES_DEFAULT.claseArlOperativo),
    incluyeAuxParafiscales: data.incluye_aux_parafiscales !== false,
  }
}

export async function getParametrosParafiscales(
  anio: number,
): Promise<{ success: boolean; data: ParametrosParafiscales }> {
  try {
    const admin: any = await getSupabaseAdmin()
    return { success: true, data: await leerParametros(admin, anio) }
  } catch {
    return { success: true, data: { anio, ...PARAFISCALES_DEFAULT } }
  }
}

export async function guardarParametrosParafiscales(
  p: ParametrosParafiscales,
): Promise<{ success: boolean; message?: string }> {
  // Baranda legal del lado del servidor: un valor fuera del rango admisible no
  // se persiste aunque la UI lo mande. Los "avisos" (apartarse del valor de ley
  // vigente por una reforma) sí se permiten — los confirma el usuario en la UI.
  const errores = validarParametros(p).filter((a) => a.nivel === "error")
  if (errores.length > 0) {
    return { success: false, message: errores.map((e) => e.mensaje).join(" ") }
  }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin.from("parametros_parafiscales").upsert(
      {
        anio: p.anio,
        pct_pension_empleador: p.pctPensionEmpleador,
        pct_pension_empleado: p.pctPensionEmpleado,
        pct_salud_empleador: p.pctSaludEmpleador,
        pct_salud_empleado: p.pctSaludEmpleado,
        pct_sena: p.pctSena,
        pct_icbf: p.pctIcbf,
        pct_caja: p.pctCaja,
        umbral_exoneracion_smlv: p.umbralExoneracionSmlv,
        tope_ibc_smlv: p.topeIbcSmlv,
        clase_arl_admin: p.claseArlAdmin,
        clase_arl_operativo: p.claseArlOperativo,
        incluye_aux_parafiscales: p.incluyeAuxParafiscales,
        actualizado_at: new Date().toISOString(),
      },
      { onConflict: "anio" },
    )
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar los parámetros." }
  }
}

/**
 * Cuadro de parafiscales de un mes. `idempresa = null` → consolidado LIP
 * (todos los clientes), que es el total real de la planilla PILA.
 */
export async function getParafiscales(
  idempresa: number | null,
  anio: number,
  mes: number,
): Promise<{
  success: boolean
  data: ParafiscalPersona[]
  resumen?: ResumenParafiscales
  params?: ParametrosParafiscales
  smlv?: number
  auxilio?: number
  message?: string
}> {
  try {
    const admin: any = await getSupabaseAdmin()
    const params = await leerParametros(admin, anio)

    // Parámetros legales del año (SMLV + auxilio de transporte).
    const { data: pa } = await admin
      .from("parametros_legales_anio")
      .select("smlv, auxilio_transporte")
      .eq("anio", anio)
      .maybeSingle()
    const smlv = Number(pa?.smlv || 0)
    const auxilioMes = Number(pa?.auxilio_transporte || 0)
    if (!smlv) {
      return { success: false, data: [], message: `No hay parámetros legales cargados para el año ${anio}.` }
    }

    // Personal: quien tenga contrato (nº SIIGO). Se incluyen los retirados del
    // mes — sus días trabajados también cotizan.
    // Paginado (Supabase topa en 1000): en modo Consolidado (sin idempresa) headcount
    // suma las 4 empresas + TODOS los retirados Inactivo (que nunca se borran), así que
    // supera 1000 filas y algunos cotizantes quedaban fuera → planilla PILA subreportada.
    // Orden estable (idempresa, identificacion). Mismo patrón que la nómina de abajo.
    const hcPage = 1000
    let personal: any[] = []
    for (let offset = 0; ; offset += hcPage) {
      let q = admin
        .from("headcount")
        .select("identificacion, nombre, admin, salario, idempresa, contratosiigo, fecha_retiro, fechainicio, estado")
        .not("nombre", "ilike", "%prueba%") // fuera los auxiliares de PRUEBA (todos los ID): no cotizan
        .order("idempresa", { ascending: true })
        .order("identificacion", { ascending: true })
      if (idempresa) q = q.eq("idempresa", idempresa)
      const { data, error: hErr } = await q.range(offset, offset + hcPage - 1)
      if (hErr) return { success: false, data: [], message: hErr.message }
      if (!data || data.length === 0) break
      personal = personal.concat(data)
      if (data.length < hcPage) break
    }

    const infoPorNombre = new Map<
      string,
      {
        identificacion: string
        esAdmin: boolean
        salario: number
        idempresa: number | null
        /** Fecha de retiro (ISO YYYY-MM-DD) o null si sigue activo. */
        fechaRetiro: string | null
        /** Fecha de ingreso (ISO YYYY-MM-DD) — antes de esta fecha no hay nada que cotizar. */
        fechaInicio: string | null
        /** true si la persona está ACTIVA en algún Head Count (reingreso): no se le corta por retiro. */
        esActivo: boolean
      }
    >()
    for (const h of personal || []) {
      const nombre = String(h.nombre || "").trim()
      // Sin contrato SIIGO no cotiza; los auxiliares de PRUEBA nunca entran a PILA;
      // y el placeholder "SIN AUXILIAR" (usado en ordenes sin ayudante asignado)
      // tiene por error un contratosiigo relleno ("13-1", identificacion="13") que
      // lo deja colar como si fuera un cotizante real -- $3M de IBC fantasma
      // confirmado contra la planilla PILA real de agosto-2026.
      if (!nombre || !String(h.contratosiigo || "").trim() || /prueba/i.test(nombre) || /sin auxiliar/i.test(nombre)) continue
      // Multi-empresa: una persona puede tener varias filas. Acumular esActivo (si
      // está Activa en cualquiera) y conservar fecha_retiro/fechainicio si alguna la trae
      // (la más temprana de fechainicio, por si hay filas con el dato incompleto).
      const prev = infoPorNombre.get(nombre)
      const esActivoFila = String(h.estado || "").trim().toUpperCase() === "ACTIVO"
      const fechaInicioFila = h.fechainicio ? String(h.fechainicio).slice(0, 10) : null
      infoPorNombre.set(nombre, {
        identificacion: String(h.identificacion || "").trim() || prev?.identificacion || "",
        esAdmin: h.admin === true || prev?.esAdmin || false,
        salario: Number(h.salario) || prev?.salario || 0,
        idempresa: h.idempresa ?? prev?.idempresa ?? null,
        fechaRetiro: h.fecha_retiro ? String(h.fecha_retiro).slice(0, 10) : (prev?.fechaRetiro ?? null),
        fechaInicio:
          fechaInicioFila && (!prev?.fechaInicio || fechaInicioFila < prev.fechaInicio)
            ? fechaInicioFila
            : (prev?.fechaInicio ?? null),
        esActivo: (prev?.esActivo ?? false) || esActivoFila,
      })
    }
    if (infoPorNombre.size === 0) return { success: true, data: [], params, smlv, auxilio: auxilioMes }

    // Valor REAL (histórico) del IBC, cuando el mes ya se radicó en Aportes en
    // Línea y no coincide con la fórmula (destajo antes de julio-2026, ajustes
    // puntuales). Gana sobre el cálculo en vivo cuando está presente. Mismo
    // patrón que liquidaciones_retiro.*_real.
    const { data: reales } = await admin
      .from("parafiscales_real")
      .select("identificacion, ibc_real")
      .eq("anio", anio)
      .eq("mes", mes)
    const ibcRealPorCedula = new Map<string, number>()
    for (const r of reales || []) {
      if (r.ibc_real == null) continue
      ibcRealPorCedula.set(String(r.identificacion).trim(), Number(r.ibc_real))
    }

    // Nómina del mes (paginada — Supabase topa en 1000 filas por respuesta).
    const desde = `${anio}-${String(mes).padStart(2, "0")}-01`
    const hasta = finDeMes(anio, mes)
    const nombres = Array.from(infoPorNombre.keys())
    let filas: any[] = []
    const pageSize = 1000
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin
        .rpc("pagonomina_rango", { p_desde: desde, p_hasta: hasta })
        .select(
          "persona, fecha, total_liquidado_dia, novedad_reportada, especialidad, bonif_no_prestacional",
        )
        .in("persona", nombres)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .range(offset, offset + pageSize - 1)
      if (error) return { success: false, data: [], message: error.message }
      if (!data || data.length === 0) break
      filas = filas.concat(data)
      if (data.length < pageSize) break
    }

    // Agregar por persona clasificando CADA día por su novedad (matriz PILA):
    //   · ibcTrab = Σ devengado real de los días trabajados (con recargos).
    //   · días trabajados / vacaciones / incapacidad / ausentismo por separado.
    // Corte por fecha de retiro (defensa en profundidad; la vista pagonomina ya
    // corta, pero aquí se refuerza con el headcount.fecha_retiro de la persona).
    const acum = new Map<
      string,
      {
        ibcTrab: number
        diasTrab: number
        diasVac: number
        diasIncap: number
        diasAus: number
        diasLicr: number
        // Excedente de destajo acumulado CON SIGNO por quincena (se netea y se aplica
        // MAX(0,·) por quincena al final — igual que el archivo plano de Siigo).
      }
    >()
    for (const r of filas) {
      const nombre = String(r.persona || "").trim()
      const info = infoPorNombre.get(nombre)
      if (!info) continue
      const fecha = String(r.fecha || "").slice(0, 10)
      // Día posterior al retiro: no cotiza. SALVAGUARDA: si la persona está Activa
      // en algún Head Count (reingreso / fecha_retiro vieja), no se corta.
      if (info.fechaRetiro && !info.esActivo && fecha > info.fechaRetiro) continue
      // Día ANTERIOR al ingreso: tampoco cotiza — no puede haber aportes de un
      // trabajador que todavía no existía en la empresa. Defensa en profundidad:
      // `pagonomina` ya corta por `headcount.fechainicio` en el origen, pero ese
      // corte NO es retroactivo (rige desde 16-jul-2026), así que un dato viejo
      // podría colarse; este corte lo blinda aquí también, igual que fecha_retiro.
      if (info.fechaInicio && fecha < info.fechaInicio) continue
      // Un mes de LIP son SIEMPRE 30 días (igual que la nómina base): el día 31 de
      // un mes de 31 NO cotiza NADA -- ni día ni devengado (ver el `default` del
      // switch más abajo). Desde 2026-08-31 pagonomina le paga BASE COMPLETA al
      // día 31 (antes $0); si se sumara su valor aquí el mes quedaría inflado en
      // un día extra de salario -- bug real corregido 2026-09-11.
      const diaMes = Number(fecha.slice(8, 10))
      const esDia31 = diaMes === 31
      const a =
        acum.get(nombre) ||
        { ibcTrab: 0, diasTrab: 0, diasVac: 0, diasIncap: 0, diasAus: 0, diasLicr: 0 }
      switch (clasificarDiaCotizacion(r.novedad_reportada)) {
        case "VAC":
          if (!esDia31) a.diasVac += 1
          break
        case "INCAP":
          if (!esDia31) a.diasIncap += 1
          break
        case "AUS":
          if (!esDia31) a.diasAus += 1
          break
        case "LICR":
          if (!esDia31) a.diasLicr += 1
          break
        case "RETIRO":
          break // día de baja: no suma a ninguna base
        default: {
          // TRAB. Cada día trabajado ya liquida su BASE del día (`total_liquidado_dia`
          // = salario/30 + recargos de turno + dominical; el destajo ya NO se paga por
          // día). El bono de productividad (excedente de destajo neteado por quincena)
          // se lee de `archivoplano` más abajo, NO se re-suma aquí -- ver comentario
          // junto a `bonoRealPorCedulaQuincena`.
          //
          // El día 31 NO suma NADA (ni día ni valor) -- BUG REAL corregido
          // 2026-09-11: desde 2026-08-31 pagonomina le paga BASE COMPLETA al
          // día 31 (antes $0), así que sumar su `total_liquidado_dia` aquí
          // infla el mes en un día extra de salario. Su destajo/exceso no se
          // pierde: pagonomina lo manda a `bonif_prestacional`, que
          // archivoplano ya excluye de esta quincena y difiere a la
          // siguiente -- ese dinero entra por `bonoRealPorCedulaQuincena`,
          // no debe contarse aquí también. Confirmado con datos reales.
          if (!esDia31) {
            a.ibcTrab += Number(r.total_liquidado_dia || 0)
            a.diasTrab += 1
          }
        }
      }
      acum.set(nombre, a)
    }

    // Vacaciones pagadas en la LIQUIDACIÓN de retiro: la ley las suma al IBC de
    // Caja de Compensación del MES DEL RETIRO (no cotizan pensión/salud/ARL --
    // es un pago único de prestaciones, no un día trabajado). Confirmado por el
    // usuario 2026-09-11. Fuente: getLiquidaciones() -- MISMO cálculo (y el
    // mismo override manual `vacaciones_real`) que usa el submódulo
    // Liquidaciones, para no mantener una segunda fórmula que pueda divergir.
    // Solo se consulta si hay al menos un retiro este mes (la llamada es
    // pesada -- recalcula TODAS las prestaciones históricas de la empresa).
    const vacLiqPorCedula = new Map<string, number>()
    const idsEmpresaConRetiro = new Set(
      Array.from(infoPorNombre.values())
        .filter((i) => i.fechaRetiro && i.fechaRetiro >= desde && i.fechaRetiro <= hasta && i.idempresa != null)
        .map((i) => i.idempresa as number),
    )
    for (const idEmp of idsEmpresaConRetiro) {
      const liq = await getLiquidaciones(idEmp)
      if (!liq.success) continue
      for (const lp of liq.data) {
        if (lp.fecha_retiro && lp.fecha_retiro >= desde && lp.fecha_retiro <= hasta && lp.vacaciones > 0) {
          vacLiqPorCedula.set(lp.identificacion, lp.vacaciones)
        }
      }
    }

    // Bono de productividad REAL: se lee directo de `archivoplano` (la ÚNICA
    // fuente que de verdad se envía a Siigo) en vez de re-derivarlo sumando
    // `bonif_prestacional` por quincena aquí -- confirmado por el usuario
    // 2026-09-11 tras encontrar que las dos formas NO daban lo mismo (caso
    // real DEIVID PARRA OSSA: $312.218 re-derivados vs $204.299 reales en
    // archivoplano, porque esa vista excluye el día de cierre de la quincena
    // y funde el Ajuste Nómina Anterior). Mismo query que usa el exportador
    // PILA (lib/parafiscales-exportador-actions.ts) -- un solo punto de
    // cálculo para el mismo número. `archivoplano.anio` es columna nueva
    // (scripts/059_archivoplano_reemplazo.sql) para no mezclar años al filtrar
    // por mes. Se respeta `BONO_DESTAJO_IBC_DESDE`: antes de esa fecha el
    // bono no entra al IBC aunque archivoplano sí lo tenga (decisión de
    // negocio ya confirmada, ver comentario de cabecera del archivo).
    const bonoRealPorCedulaQuincena = new Map<string, number>()
    if (desde >= BONO_DESTAJO_IBC_DESDE) {
      const identificaciones = Array.from(infoPorNombre.values()).map((i) => i.identificacion).filter(Boolean)
      if (identificaciones.length > 0) {
        const { data: bonoRows, error: bonoErr } = await admin
          .from("archivoplano")
          .select("identificacionempleado, quincena, cantidadvalor")
          .in("identificacionempleado", identificaciones)
          .eq("anio", anio)
          .eq("mes", String(mes).padStart(2, "0"))
          .eq("tiponovedad", "Valor")
          .or("nombrenovedad.ilike.%Por Productividad%,nombrenovedad.ilike.%Ajuste Toneladas%")
        // Fallar RUIDOSO si la columna `anio` todavía no existe (falta correr
        // scripts/059_archivoplano_reemplazo.sql en Supabase) -- nunca seguir en
        // silencio con bono $0 para todo el mundo, eso sería peor que el bug
        // que se está corrigiendo.
        if (bonoErr) {
          return {
            success: false,
            data: [],
            message: `No se pudo leer el bono real de archivoplano (${bonoErr.message}). Probablemente falta correr scripts/059_archivoplano_reemplazo.sql en Supabase.`,
          }
        }
        for (const b of bonoRows || []) {
          const clave = `${String(b.identificacionempleado).trim()}-${b.quincena}`
          bonoRealPorCedulaQuincena.set(clave, (bonoRealPorCedulaQuincena.get(clave) || 0) + Number(b.cantidadvalor || 0))
        }
      }
    }

    const data: ParafiscalPersona[] = []
    for (const [nombre, a] of acum) {
      const diasCotizados = a.diasTrab + a.diasVac + a.diasIncap + a.diasAus + a.diasLicr
      if (diasCotizados === 0) continue
      const info = infoPorNombre.get(nombre)!
      // Auxilio de transporte: solo para quien devenga hasta 2 SMMLV, y
      // proporcional a los días TRABAJADOS del mes (no se causa en vac/incap/ausencia/licencia).
      const salarioRef = info.salario || smlv
      const auxilio = salarioRef <= smlv * 2 ? (auxilioMes / 30) * Math.min(a.diasTrab, 30) : 0
      // Bonificación por productividad -- ya viene con el piso 0 de
      // `archivoplano` (esa vista solo emite la fila si `bono_final > 0`).
      const bonoProductividad =
        (bonoRealPorCedulaQuincena.get(`${info.identificacion}-1`) || 0) +
        (bonoRealPorCedulaQuincena.get(`${info.identificacion}-2`) || 0)
      // Si hay valor REAL guardado para esta persona-mes, se ajusta el IBC de
      // días trabajados para que el total (`ap.ibc`) dé EXACTO el valor real
      // radicado (el resto de bases -- vacaciones/incapacidad/etc -- no cambian,
      // solo se re-cuadra la parte "trabajado", que es donde vive la diferencia).
      const ibcReal = ibcRealPorCedula.get(info.identificacion) ?? null
      const otrasBasesSalario =
        (Math.max(Number(info.salario) || 0, smlv) / 30) * (a.diasVac + a.diasIncap + a.diasAus + a.diasLicr)
      const ap = calcularAportes(
        {
          salario: info.salario,
          ibcTrabajado: ibcReal != null ? Math.max(0, ibcReal - otrasBasesSalario) : a.ibcTrab + bonoProductividad,
          diasTrabajados: a.diasTrab,
          diasVacaciones: a.diasVac,
          diasIncapacidad: a.diasIncap,
          diasAusentismo: a.diasAus,
          diasLicencia: a.diasLicr,
          auxilio,
          smlv,
          esAdmin: info.esAdmin,
          ibcTrabajadoEsReal: ibcReal != null,
        },
        params,
      )
      const vacLiq = vacLiqPorCedula.get(info.identificacion) || 0
      const cajaVacLiq = vacLiq * (params.pctCaja / 100)
      data.push({
        ...ap,
        ibcCaja: ap.ibcCaja + vacLiq,
        baseParafiscales: ap.baseParafiscales + vacLiq,
        caja: ap.caja + cajaVacLiq,
        totalEmpresa: ap.totalEmpresa + cajaVacLiq,
        totalPila: ap.totalPila + cajaVacLiq,
        persona: nombre,
        identificacion: info.identificacion,
        idempresa: info.idempresa,
        esAdmin: info.esAdmin,
        dias: diasCotizados,
        devengado: ap.ibc,
        ibcReal,
        tieneValorReal: ibcReal != null,
        vacacionesLiquidacion: vacLiq,
      })
    }

    data.sort((x, y) => y.totalEmpresa - x.totalEmpresa)

    const resumen = data.reduce<ResumenParafiscales>(
      (acc, p) => {
        acc.personas += 1
        if (p.exonerado) acc.exonerados += 1
        acc.ibc += p.ibc
        acc.pensionEmpleador += p.pensionEmpleador
        acc.saludEmpleador += p.saludEmpleador
        acc.arl += p.arl
        acc.caja += p.caja
        acc.sena += p.sena
        acc.icbf += p.icbf
        acc.totalEmpresa += p.totalEmpresa
        acc.pensionEmpleado += p.pensionEmpleado
        acc.saludEmpleado += p.saludEmpleado
        acc.totalEmpleado += p.totalEmpleado
        acc.totalPila += p.totalPila
        return acc
      },
      {
        personas: 0,
        exonerados: 0,
        ibc: 0,
        pensionEmpleador: 0,
        saludEmpleador: 0,
        arl: 0,
        caja: 0,
        sena: 0,
        icbf: 0,
        totalEmpresa: 0,
        pensionEmpleado: 0,
        saludEmpleado: 0,
        totalEmpleado: 0,
        totalPila: 0,
      },
    )

    return { success: true, data, resumen, params, smlv, auxilio: auxilioMes }
  } catch (e: any) {
    return { success: false, data: [], message: e?.message || "Error al calcular los parafiscales." }
  }
}

// Valor REAL (histórico) del IBC de una persona-mes, cuando lo radicado en
// Aportes en Línea no coincide con la fórmula en vivo. Pasar `ibcReal: null`
// lo deja SIN valor real (el cálculo en vivo vuelve a aplicar).
export async function guardarValorRealParafiscal(payload: {
  idempresa: number | null
  identificacion: string
  persona: string
  anio: number
  mes: number
  ibcReal: number | null
  diasReal: number | null
}): Promise<{ success: boolean; message?: string }> {
  if (!payload?.identificacion || !payload.anio || !payload.mes) {
    return { success: false, message: "Datos incompletos." }
  }
  try {
    const admin: any = await getSupabaseAdmin()
    const { error } = await admin.from("parafiscales_real").upsert(
      {
        idempresa: payload.idempresa,
        identificacion: payload.identificacion,
        persona: payload.persona,
        anio: payload.anio,
        mes: payload.mes,
        ibc_real: payload.ibcReal,
        dias_real: payload.diasReal,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "identificacion,anio,mes" },
    )
    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (e: any) {
    return { success: false, message: e?.message || "Error al guardar el valor real." }
  }
}
