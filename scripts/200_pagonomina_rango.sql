-- =====================================================================
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
-- con `node scripts/generar_200_201_funciones_rango.mjs`. Si se cambia la
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
 WITH transformacion AS (
         SELECT cabeceraoc.fechacargue,
            cabeceraoc.idempresa,
            cabeceraoc.tipooperacion,
                CASE
                    -- Cedis id3/4 DESCARGUE: se paga con el peso de BÁSCULA del tiquete
                    -- (normalizado a toneladas, IGUAL que el cobro / basculaTiqueteDescargue),
                    -- cayendo al detalle (pesoorden) si no hay báscula o el dato es corrupto.
                    -- Cargue/otros en cedis y plantas id1/2 quedan sin cambio.
                    WHEN ((cabeceraoc.idempresa = ANY (ARRAY[3, 4])) AND (cabeceraoc.tipooperacion = 'Descargue'::text)) THEN
                        CASE
                            WHEN (COALESCE(cabeceraoc.pesovascula, (0)::numeric) <= (0)::numeric) THEN cabeceraoc.pesoorden
                            WHEN ((
                                CASE WHEN ((cabeceraoc.pesovascula / NULLIF(cabeceraoc.pesoorden, (0)::numeric)) > (50)::numeric)
                                     THEN (cabeceraoc.pesovascula / (1000)::numeric) ELSE cabeceraoc.pesovascula END
                                ) / NULLIF(cabeceraoc.pesoorden, (0)::numeric) NOT BETWEEN (0.1)::numeric AND (10)::numeric) THEN cabeceraoc.pesoorden
                            ELSE (
                                CASE WHEN ((cabeceraoc.pesovascula / NULLIF(cabeceraoc.pesoorden, (0)::numeric)) > (50)::numeric)
                                     THEN (cabeceraoc.pesovascula / (1000)::numeric) ELSE cabeceraoc.pesovascula END
                                )
                        END
                    WHEN (cabeceraoc.idempresa = ANY (ARRAY[3, 4])) THEN cabeceraoc.pesoorden
                    ELSE cabeceraoc.pesovascula
                END AS peso_base_calculo,
            array_length(string_to_array(cabeceraoc.auxiliares, ','::text), 1) AS cantidad_auxiliares,
            TRIM(BOTH FROM regexp_split_to_table(cabeceraoc.auxiliares, ','::text)) AS nombre_auxiliar
           FROM cabeceraoc
          WHERE ((cabeceraoc.fincargue IS NOT NULL) AND ((cabeceraoc.fincargue)::text <> ''::text))
            -- AVIMOL (idempresa=2): la Distribución NO se paga por destajo — el clon
            -- automático "+D" de las placas propias (generarDistribucionAutomatica)
            -- HEREDA los mismos `auxiliares` de su Cargue madre, así que sin esta
            -- exclusión esas mismas personas cobraban su tonelaje de Cargue Y OTRA VEZ
            -- el de la Distribución clon (doble conteo real, no solo un pago de más).
            -- Ya está cubierta aparte por las 300 t fijas de facturación
            -- (lib/cargos-fijos-actions.ts, "Distribución Turno") — concepto de
            -- FACTURACIÓN, no de nómina; no se cruza con esto. Exclusión TOTAL (ni
            -- toneladas ni pago) para no caer en el patrón de excedente_bruto_destajo
            -- negativo cuando hay toneladas sin tarifa. Fuera de Avimol, sin cambio:
            -- id1/3/4 siguen pagando Distribución con su propia tarifa y auxiliares.
            AND NOT ((cabeceraoc.idempresa = 2) AND (cabeceraoc.tipooperacion = 'Distribucion'::text))
            -- PROYECCIÓN MANUAL DESCONTINUADA (2026-09-08, hallado en la reconciliación
            -- contra Siigo): hasta el 2026-08-30 "Ajuste de Proyecciones" (hoy "Ajuste
            -- Nómina Anterior") comparaba contra una fila manual `cabeceraoc.tipooperacion
            -- = 'proyeccion'` que el negocio dejó de usar (ver lib/ajuste-proyeccion-
            -- actions.ts, que YA descarta este tipo — `if (tipo === "proyeccion") continue`
            -- — pero esta vista nunca tuvo la misma exclusión). Esas filas quedaron con
            -- `fincargue` puesto (cierran igual que una orden real) y llevaban auxiliares
            -- reales en su columna `auxiliares` — 40 filas confirmadas, ene-jul 2026, 87
            -- personas, ~3.836 t fantasma, coincide con el hueco encontrado al reconciliar
            -- el bono de destajo contra los acumulados reales de Siigo (LIPgo salía ~21%
            -- más alto que Siigo en esos meses). Nunca fueron producción real — exclusión
            -- TOTAL, mismo criterio que la de Avimol arriba.
            AND NOT (cabeceraoc.tipooperacion = 'proyeccion'::text)
            AND (cabeceraoc.fechacargue BETWEEN (p_desde - 7) AND (p_hasta + 7))
        ), produccion_diaria AS (
         SELECT t.fechacargue AS fecha,
            t.nombre_auxiliar AS persona,
            max(t.idempresa) AS idempresa_operacion,
            sum(
                CASE
                    WHEN (t.cantidad_auxiliares > 0) THEN (t.peso_base_calculo / (t.cantidad_auxiliares)::numeric)
                    ELSE (0)::numeric
                END) AS toneladas_dia,
            sum(
                CASE
                    WHEN ((t.cantidad_auxiliares > 0) AND (tp.tarifa IS NOT NULL)) THEN ((t.peso_base_calculo / (t.cantidad_auxiliares)::numeric) * tp.tarifa)
                    ELSE (0)::numeric
                END) AS pago_produccion_dia
           FROM (transformacion t
             LEFT JOIN tarifaspersonal tp ON (((t.idempresa = tp.empresaid) AND (t.tipooperacion = tp.operacion) AND ((t.fechacargue >= tp.fechaini) AND (t.fechacargue <= tp.fechafin)))))
          GROUP BY t.fechacargue, t.nombre_auxiliar
        ), datos_asistencia_raw AS (
         SELECT registroasistencia.fecha,
            TRIM(BOTH FROM registroasistencia.nombre) AS persona,
            registroasistencia.idempresa AS idempresa_asistencia,
            registroasistencia.puesto,
            registroasistencia.asistencia,
                CASE
                    WHEN (registroasistencia.especialidad = 'true'::text) THEN true
                    ELSE false
                END AS especialidad,
            -- HORAS EXTRA: SOLO LAS APROBADAS.
            --
            -- Las horas se registran en `registroasistencia` (las calcula el trigger
            -- `calcular_y_asignar_horas_extras`) pero eso no significa que estén
            -- autorizadas. La autorización vive en la columna `aprobado`, y hasta
            -- ahora la vista la ignoraba: liquidaba TODA hora registrada, aprobada
            -- o no.
            --
            -- EL ÚNICO VALOR VÁLIDO ES 'aprobado', confirmado por el negocio.
            -- Cualquier otra cosa —vacío, null, 'true', 'si', 'pendiente'— NO
            -- cuenta como aprobación y esas horas no se liquidan.
            --
            -- OJO si se compara contra otros scripts:
            -- scripts/092_recalcular_horas_extra_retroactivo_16jul.sql acepta además
            -- 'true' y 'si'. Ese criterio quedó descartado aquí a propósito.
            --
            -- `LOWER(TRIM(...))` solo normaliza mayúsculas y espacios sobrantes del
            -- digitado — 'Aprobado ' sigue siendo la misma palabra —, no admite
            -- otros valores. `::text` porque la columna puede ser boolean en
            -- algunas instancias.
            --
            -- La bandera se evalúa POR FILA, antes del colapso multi-turno de
            -- `datos_asistencia`: un Auxiliar Mixto puede tener el Turno 1 aprobado
            -- y el Turno 2 no, y solo deben sumarse las horas del aprobado.
            CASE WHEN (LOWER(TRIM(registroasistencia.aprobado::text)) = 'aprobado'::text)
                 THEN COALESCE(registroasistencia.hed, (0)::numeric) ELSE (0)::numeric END AS cant_hed,
            CASE WHEN (LOWER(TRIM(registroasistencia.aprobado::text)) = 'aprobado'::text)
                 THEN COALESCE(registroasistencia.hedf, (0)::numeric) ELSE (0)::numeric END AS cant_hedf,
            CASE WHEN (LOWER(TRIM(registroasistencia.aprobado::text)) = 'aprobado'::text)
                 THEN COALESCE(registroasistencia.hen, (0)::numeric) ELSE (0)::numeric END AS cant_hen,
            CASE WHEN (LOWER(TRIM(registroasistencia.aprobado::text)) = 'aprobado'::text)
                 THEN COALESCE(registroasistencia.hef, (0)::numeric) ELSE (0)::numeric END AS cant_hef,
            CASE WHEN (LOWER(TRIM(registroasistencia.aprobado::text)) = 'aprobado'::text)
                 THEN COALESCE(registroasistencia.hn, (0)::numeric) ELSE (0)::numeric END AS cant_hn,
                CASE
                    WHEN ((registroasistencia.asistencia IS NULL) OR (TRIM(BOTH FROM registroasistencia.asistencia) = ''::text)) THEN 0
                    WHEN (TRIM(BOTH FROM registroasistencia.asistencia) = ANY (ARRAY['13- Incapacidad por enfermedad general al 100%'::text, '31- Vacaciones disfrutadas'::text, '15- Incapacidad por enfermedad general al 66%- ingreso'::text, '14- Incapacidad por enfermedad general al 50'::text, 'Descanso'::text, 'Descanso compensatorio domingo anterior'::text, '38- Licencia no remunerada- Deducción'::text, '38- Suspensión temporal de Contrato- Deducción'::text, 'Retiro'::text])) THEN 0
                    ELSE 1
                END AS es_falta_penalizable,
                -- Novedades que BLOQUEAN el pago del descanso dominical SIGUIENTE.
                -- OJO: 'Descanso compensatorio domingo anterior' NO va aquí — ese
                -- compensatorio afecta al domingo ANTERIOR (vía
                -- tiene_compensatorio_posterior, que le quita el doble pago al domingo
                -- que se trabajó), pero NO debe quitarle su descanso dominical al
                -- domingo SIGUIENTE (la semana con compensatorio es semana completa).
                CASE
                    WHEN (TRIM(BOTH FROM registroasistencia.asistencia) = ANY (ARRAY['Descanso'::text, '38- Licencia no remunerada- Deducción'::text, '38- Suspensión temporal de Contrato- Deducción'::text, 'Retiro'::text])) THEN 1
                    ELSE 0
                END AS bloquea_domingo
           FROM registroasistencia
          WHERE (registroasistencia.fecha BETWEEN (p_desde - 7) AND (p_hasta + 7))
        ), datos_asistencia AS (
         -- BLINDAJE multi-turno: registroasistencia.turno permite 2 filas el mismo
         -- día para la misma persona (Auxiliar Mixto con Turno 1 + Turno 2, cada uno
         -- con su propio horario). Se COLAPSAN aquí en UNA sola fila por
         -- (fecha,persona) ANTES de calculo_turnos/consolidado_completo, para que el
         -- resto de la vista siga viendo exactamente 1 fila por día, como siempre:
         -- las horas extra de ambos turnos se SUMAN (se trabajaron las dos), y la
         -- base del día (valor_diario_ley/base_turno) se sigue pagando UNA sola vez.
         -- Para el caso de hoy (1 fila/persona/día en el 100% de los puestos) este
         -- GROUP BY es un no-op exacto: MAX/SUM/bool_or de una sola fila = esa fila.
         SELECT r.fecha,
            r.persona,
            max(r.idempresa_asistencia) AS idempresa_asistencia,
            max(r.puesto) AS puesto,
            max(r.asistencia) AS asistencia,
            bool_or(r.especialidad) AS especialidad,
            sum(r.cant_hed) AS cant_hed,
            sum(r.cant_hedf) AS cant_hedf,
            sum(r.cant_hen) AS cant_hen,
            sum(r.cant_hef) AS cant_hef,
            sum(r.cant_hn) AS cant_hn,
            max(r.es_falta_penalizable) AS es_falta_penalizable,
            max(r.bloquea_domingo) AS bloquea_domingo
           FROM datos_asistencia_raw r
          GROUP BY r.fecha, r.persona
        ), calculo_turnos AS (
         -- Recargos y base del turno calculados POR PERSONA desde el salario de
         -- contrato (headcount.salario), sin auxilio en la base (norma CO). Se
         -- conserva el JOIN a tarifasturnos como registro de "puestos de turno".
         SELECT a.fecha,
            a.persona,
            COALESCE(calc.valor_dia, (0)::numeric) AS base_turno,
            a.cant_hed,
            a.cant_hedf,
            a.cant_hen,
            a.cant_hef,
            a.cant_hn,
            (a.cant_hed  * COALESCE(calc.hod, (0)::numeric) * ((1)::numeric + (COALESCE(pa.pct_hed,  (25)::numeric)  / 100.0))) AS val_hed,
            (a.cant_hedf * COALESCE(calc.hod, (0)::numeric) * ((1)::numeric + (COALESCE(pa.pct_hedf, (115)::numeric) / 100.0))) AS val_hedf,
            (a.cant_hen  * COALESCE(calc.hod, (0)::numeric) * ((1)::numeric + (COALESCE(pa.pct_hen,  (75)::numeric)  / 100.0))) AS val_hen,
            (a.cant_hef  * COALESCE(calc.hod, (0)::numeric) * ((1)::numeric + (COALESCE(pa.pct_hef,  (165)::numeric) / 100.0))) AS val_hef,
            (a.cant_hn   * COALESCE(calc.hod, (0)::numeric) * (COALESCE(pa.pct_hn, (35)::numeric) / 100.0)) AS val_hn,
            (
                (a.cant_hed  * COALESCE(calc.hod, (0)::numeric) * ((1)::numeric + (COALESCE(pa.pct_hed,  (25)::numeric)  / 100.0)))
              + (a.cant_hedf * COALESCE(calc.hod, (0)::numeric) * ((1)::numeric + (COALESCE(pa.pct_hedf, (115)::numeric) / 100.0)))
              + (a.cant_hen  * COALESCE(calc.hod, (0)::numeric) * ((1)::numeric + (COALESCE(pa.pct_hen,  (75)::numeric)  / 100.0)))
              + (a.cant_hef  * COALESCE(calc.hod, (0)::numeric) * ((1)::numeric + (COALESCE(pa.pct_hef,  (165)::numeric) / 100.0)))
              + (a.cant_hn   * COALESCE(calc.hod, (0)::numeric) * (COALESCE(pa.pct_hn, (35)::numeric) / 100.0))
            ) AS total_recargos
           FROM (((datos_asistencia a
             JOIN tarifasturnos tt ON ((((a.fecha >= tt.fechaini) AND (a.fecha <= tt.fechafin)) AND (TRIM(BOTH FROM a.puesto) = TRIM(BOTH FROM tt.puesto)))))
             LEFT JOIN headcount h2 ON ((TRIM(BOTH FROM h2.nombre) = a.persona)))
             -- Parámetros legales VIGENTES en la fecha del turno (una sola fuente por
             -- intervalos): jornada, recargo dominical y los pct de hora extra ya vienen
             -- correctos por fecha (jun-2026: 7,3333/80%/hedf 105; desde 16-jul: 7/90%/hedf 115).
             LEFT JOIN LATERAL (SELECT * FROM parametros_legales_vigencia pv
                                 WHERE (pv.fecha_desde <= a.fecha)
                                 ORDER BY pv.fecha_desde DESC LIMIT 1) pa ON (true))
             CROSS JOIN LATERAL (
                 SELECT (s.base_pers / NULLIF(s.dias_p, (0)::numeric)) AS valor_dia,
                        (s.base_pers / NULLIF((s.dias_p * s.jornada_p), (0)::numeric)) AS hod
                   FROM ( SELECT (COALESCE(h2.salario, pa.smlv))::numeric AS base_pers,  -- base = SALARIO (auxilio NO entra en la base de recargos)
                                 COALESCE(pa.dias_calendario, (30)::numeric) AS dias_p,
                                 COALESCE(pa.jornada_horas, (7)::numeric) AS jornada_p  -- jornada vigente por fecha
                        ) s
             ) calc
        ), rango_fechas AS (
         -- Calendario acotado al rango pedido ±7 días (las ventanas de la vista
         -- miran 6 días atrás/adelante), sin salirse del histórico real para que
         -- los conteos de la primera semana coincidan con la vista completa.
         SELECT GREATEST(min(tf.fecha)::date, (p_desde - 7)) AS fecha_inicio,
            LEAST(max(tf.fecha)::date, (p_hasta + 7)) AS fecha_fin
           FROM ( SELECT cabeceraoc.fechacargue AS fecha
                   FROM cabeceraoc
                UNION ALL
                 SELECT registroasistencia.fecha
                   FROM registroasistencia) tf
        ), lista_empleados AS (
         -- GLOBAL a propósito, igual que la vista: la lista de personas sale de
         -- TODA la historia de cabeceraoc (mismos filtros que `transformacion`,
         -- sin acotar por fecha) y de TODA registroasistencia. Si se acotara al
         -- rango, quien solo figura en órdenes viejas desaparecería del calendario
         -- y la vista sí lo trae como 'Sin Registro' (verificado: 3 personas/día).
         SELECT DISTINCT TRIM(BOTH FROM regexp_split_to_table(cabeceraoc.auxiliares, ','::text)) AS persona
           FROM cabeceraoc
          WHERE ((cabeceraoc.fincargue IS NOT NULL) AND ((cabeceraoc.fincargue)::text <> ''::text))
            AND NOT ((cabeceraoc.idempresa = 2) AND (cabeceraoc.tipooperacion = 'Distribucion'::text))
            AND NOT (cabeceraoc.tipooperacion = 'proyeccion'::text)
        UNION
         SELECT DISTINCT registroasistencia.nombre AS persona
           FROM registroasistencia
        ), calendario_base AS (
         SELECT (d.fecha)::date AS fecha,
            e.persona
           FROM rango_fechas r,
            (LATERAL generate_series((r.fecha_inicio)::timestamp with time zone, (r.fecha_fin)::timestamp with time zone, '1 day'::interval) d(fecha)
             CROSS JOIN lista_empleados e)
        -- BONOS no prestacionales del módulo "Bonos" (Compensación). Se AGREGA
        -- por (fecha, persona) ANTES de unirlo: una persona puede tener VARIOS
        -- bonos el mismo día (conceptos distintos) y sin este colapso el LEFT
        -- JOIN haría fan-out, DUPLICANDO la fila del día completa (misma trampa
        -- que blinda `datos_asistencia`). Solo entran los APROBADOS.
        -- OJO: es NO prestacional -> NO se suma a total_liquidado_dia (esa
        -- columna alimenta el IBC de la PILA, el costo del P&L y las
        -- prestaciones de retiro). Sale por `bonif_no_prestacional` y llega al
        -- trabajador vía el ARCHIVO PLANO.
        ), bonos_dia AS (
         SELECT b.fecha,
            TRIM(BOTH FROM b.nombre) AS persona,
            sum(b.valor) AS bono_no_prestacional
           FROM bonos_nomina b
          WHERE (b.estado = 'aprobado'::text)
            AND (b.fecha BETWEEN (p_desde - 7) AND (p_hasta + 7))
          GROUP BY b.fecha, TRIM(BOTH FROM b.nombre)
        ), consolidado_completo AS (
         SELECT c.fecha,
            c.persona,
            EXTRACT(dow FROM c.fecha) AS dia_semana,
            p.idempresa_operacion,
            COALESCE((p.idempresa_operacion)::integer, (a.idempresa_asistencia)::integer, (h.idempresa)::integer, 0) AS idempresa_origen,
            a.especialidad,
            h.salario,
            COALESCE((h.salario / (30)::numeric), (58364)::numeric) AS valor_diario_ley,
            -- Recargo dominical VIGENTE por fecha (viene de la vigencia pa2: 80% hasta
            -- 15-jul-2026, 90% desde 16-jul). Automático por intervalo.
            COALESCE(pa2.pct_recargo_dominical, (90)::numeric) AS pct_recargo_dominical,
            -- % pagado en incapacidad (13/14/15), editable en Compensación › Parámetros
            -- de ley -- confirmado con el usuario y datos reales de Siigo (2026-09-08)
            -- que hoy es 100%, sin importar el "50%"/"66%" del nombre de la novedad.
            COALESCE(pa2.pct_pago_incapacidad, (100)::numeric) AS pct_pago_incapacidad,
            COALESCE(p.toneladas_dia, (0)::numeric) AS toneladas,
            COALESCE(p.pago_produccion_dia, (0)::numeric) AS pago_produccion,
            ct.base_turno,
            COALESCE(ct.cant_hed, (0)::numeric) AS horas_hed,
            COALESCE(ct.cant_hedf, (0)::numeric) AS horas_hedf,
            COALESCE(ct.cant_hen, (0)::numeric) AS horas_hen,
            COALESCE(ct.cant_hef, (0)::numeric) AS horas_hef,
            COALESCE(ct.cant_hn, (0)::numeric) AS horas_hn,
            COALESCE(ct.val_hed, (0)::numeric) AS val_hed,
            COALESCE(ct.val_hedf, (0)::numeric) AS val_hedf,
            COALESCE(ct.val_hen, (0)::numeric) AS val_hen,
            COALESCE(ct.val_hef, (0)::numeric) AS val_hef,
            COALESCE(ct.val_hn, (0)::numeric) AS val_hn,
            COALESCE(ct.total_recargos, (0)::numeric) AS total_recargos_turno,
                CASE
                    WHEN (ct.base_turno IS NOT NULL) THEN a.puesto
                    WHEN (COALESCE(p.toneladas_dia, (0)::numeric) > (0)::numeric) THEN 'Cargue/Descargue'::text
                    WHEN (f.fecha IS NOT NULL) THEN 'Festivo'::text
                    WHEN (a.puesto IS NOT NULL) THEN a.puesto
                    ELSE 'Sin Registro'::text
                END AS actividad_registrada,
            a.asistencia AS asistencia_texto,
            COALESCE(a.es_falta_penalizable, 0) AS cuenta_como_falta,
            COALESCE(a.bloquea_domingo, 0) AS bloquea_domingo,
                CASE
                    WHEN (f.fecha IS NOT NULL) THEN 0
                    WHEN ((ct.base_turno IS NULL) AND (COALESCE(p.toneladas_dia, (0)::numeric) = (0)::numeric) AND (a.puesto IS NULL) AND ((a.asistencia IS NULL) OR (TRIM(BOTH FROM a.asistencia) = ''::text))) THEN 1
                    ELSE 0
                END AS es_sin_registro,
                CASE
                    WHEN (((ct.base_turno IS NOT NULL) OR (COALESCE(p.toneladas_dia, (0)::numeric) > (0)::numeric) OR (a.puesto IS NOT NULL) OR (f.fecha IS NOT NULL)) AND ((a.asistencia IS NULL) OR (TRIM(BOTH FROM a.asistencia) = ''::text))) THEN 1
                    ELSE 0
                END AS asistio_ok,
                -- TRABAJO EFECTIVO: igual que `asistio_ok` pero SIN el término
                -- `f.fecha IS NOT NULL`. La diferencia importa justo en los
                -- festivos: ahí `asistio_ok` vale 1 para TODO el mundo por el
                -- solo hecho de que el día sea festivo, haya trabajado o no.
                --
                -- Antes eso se compensaba excluyendo `actividad_registrada =
                -- 'Festivo'`, pero ese texto es un proxy imperfecto: quien tiene
                -- puesto asignado y trabaja un festivo sin toneladas y sin turno
                -- de especialidad TAMBIÉN queda etiquetado 'Festivo' (la rama de
                -- festivo se evalúa antes que la de puesto, arriba) y perdía el
                -- recargo. Aquí la prueba es directa: hay turno, hay toneladas o
                -- hay puesto, y no hay novedad.
                CASE
                    WHEN (((ct.base_turno IS NOT NULL) OR (COALESCE(p.toneladas_dia, (0)::numeric) > (0)::numeric) OR (a.puesto IS NOT NULL)) AND ((a.asistencia IS NULL) OR (TRIM(BOTH FROM a.asistencia) = ''::text))) THEN 1
                    ELSE 0
                END AS trabajo_efectivo,
                -- ¿Ese día la persona DESCANSÓ? Sirve para la ventana semanal de
                -- abajo, que decide si el domingo/festivo trabajado paga tarifa
                -- completa (1,9x) o parcial (0,9x).
                --
                -- '38- Licencia no remunerada' SÍ cuenta aquí (decisión explícita
                -- del usuario, 2026-08-31): aunque no sea un "Descanso" formal, es
                -- el código que se usa tanto para permiso aprobado como para falta
                -- sin justificación (mismo código de Siigo para ambos casos) — y
                -- para efectos de la tarifa del recargo dominical, la falta cuenta
                -- como si hubiera descansado esa semana. Caso real: RICHARD ANDRES
                -- ALTAMAR CUADRADO (ID2), falta el viernes 21-ago-2026 → el domingo
                -- 23-ago-2026 pasa de tarifa completa (110.890,65) a parcial
                -- (52.527,15).
                -- 'Retiro' sigue sin contar: quien se retira no "descansó", dejó de
                -- estar vinculado.
                CASE
                    WHEN (TRIM(BOTH FROM COALESCE(a.asistencia, ''::text)) = ANY (ARRAY['Descanso'::text, 'Descanso compensatorio domingo anterior'::text, '38- Licencia no remunerada- Deducción'::text, '38- Suspensión temporal de Contrato- Deducción'::text])) THEN 1
                    ELSE 0
                END AS es_descanso,
                CASE
                    WHEN (f.fecha IS NOT NULL) THEN 1
                    ELSE 0
                END AS es_festivo,
            -- Bono NO prestacional del día (módulo Bonos). Ya viene agregado
            -- por (fecha, persona) desde `bonos_dia`, así que el join no
            -- multiplica filas.
            COALESCE(bo.bono_no_prestacional, (0)::numeric) AS bono_no_prestacional
           FROM (((((((calendario_base c
             LEFT JOIN produccion_diaria p ON (((c.fecha = p.fecha) AND (c.persona = p.persona))))
             LEFT JOIN datos_asistencia a ON (((c.fecha = a.fecha) AND (c.persona = a.persona))))
             LEFT JOIN calculo_turnos ct ON (((c.fecha = ct.fecha) AND (c.persona = ct.persona))))
             LEFT JOIN festivos f ON ((c.fecha = f.fecha)))
             -- TRIM en los DOS lados: `persona` viene ya recortado (datos_asistencia_raw
             -- hace TRIM del nombre), pero `headcount.nombre` puede traer espacios de
             -- sobra del digitado. Sin TRIM el cruce falla en silencio y la persona
             -- queda SIN SALARIO (cae al default de $58.364) y SIN CÉDULA, así que
             -- tampoco la identifica el archivo plano. Casos reales encontrados:
             -- MIGUEL ANTONIO SANDOVAL (activo) y JUAN PABLO RAIGOSA GALEANO, ambos
             -- con un espacio al final del nombre en Head Count.
             LEFT JOIN headcount h ON ((TRIM(BOTH FROM h.nombre) = TRIM(BOTH FROM c.persona))))
             LEFT JOIN bonos_dia bo ON (((c.fecha = bo.fecha) AND (c.persona = bo.persona))))
             LEFT JOIN LATERAL (SELECT * FROM parametros_legales_vigencia pv
                                 WHERE (pv.fecha_desde <= c.fecha)
                                 ORDER BY pv.fecha_desde DESC LIMIT 1) pa2 ON (true))
        ), calculo_nomina_base AS (
         SELECT consolidado_completo.fecha,
            consolidado_completo.persona,
            consolidado_completo.dia_semana,
            consolidado_completo.idempresa_operacion,
            consolidado_completo.idempresa_origen,
            consolidado_completo.especialidad,
            consolidado_completo.salario,
            consolidado_completo.valor_diario_ley,
            consolidado_completo.pct_recargo_dominical,
            consolidado_completo.pct_pago_incapacidad,
            consolidado_completo.toneladas,
            consolidado_completo.pago_produccion,
            consolidado_completo.base_turno,
            consolidado_completo.horas_hed,
            consolidado_completo.horas_hedf,
            consolidado_completo.horas_hen,
            consolidado_completo.horas_hef,
            consolidado_completo.horas_hn,
            consolidado_completo.val_hed,
            consolidado_completo.val_hedf,
            consolidado_completo.val_hen,
            consolidado_completo.val_hef,
            consolidado_completo.val_hn,
            consolidado_completo.total_recargos_turno,
            consolidado_completo.actividad_registrada,
            consolidado_completo.asistencia_texto,
            consolidado_completo.cuenta_como_falta,
            consolidado_completo.bloquea_domingo,
            consolidado_completo.es_sin_registro,
            consolidado_completo.asistio_ok,
            consolidado_completo.trabajo_efectivo,
            consolidado_completo.es_festivo,
            consolidado_completo.bono_no_prestacional,
            -- ¿Descansó en los 6 días anteriores? Si NO descansó antes y tampoco
            -- tiene compensatorio después, el domingo/festivo trabajado se paga
            -- reforzado (ver `recargodominical`).
            sum(consolidado_completo.es_descanso) OVER (PARTITION BY consolidado_completo.persona ORDER BY consolidado_completo.fecha ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING) AS descansos_semana_anterior,
            sum(consolidado_completo.cuenta_como_falta) OVER (PARTITION BY consolidado_completo.persona ORDER BY consolidado_completo.fecha ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING) AS faltas_semana_anterior,
            sum(consolidado_completo.es_sin_registro) OVER (PARTITION BY consolidado_completo.persona ORDER BY consolidado_completo.fecha ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING) AS vacios_semana_anterior,
            sum(consolidado_completo.bloquea_domingo) OVER (PARTITION BY consolidado_completo.persona ORDER BY consolidado_completo.fecha ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING) AS novedades_semana_anterior,
            max(
                CASE
                    WHEN (TRIM(BOTH FROM consolidado_completo.asistencia_texto) = ANY (ARRAY['38- Licencia no remunerada- Deducción'::text, '38- Suspensión temporal de Contrato- Deducción'::text])) THEN 1
                    ELSE 0
                END) OVER (PARTITION BY consolidado_completo.persona ORDER BY consolidado_completo.fecha ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING) AS tuvo_licencia_no_rem_semana,
            max(
                CASE
                    WHEN (TRIM(BOTH FROM consolidado_completo.asistencia_texto) = 'Descanso compensatorio domingo anterior'::text) THEN 1
                    ELSE 0
                END) OVER (PARTITION BY consolidado_completo.persona ORDER BY consolidado_completo.fecha ROWS BETWEEN 1 FOLLOWING AND 6 FOLLOWING) AS tiene_compensatorio_posterior
           FROM consolidado_completo
        ), pre_calculo_valores AS (
         SELECT calculo_nomina_base.fecha,
            calculo_nomina_base.persona,
            calculo_nomina_base.dia_semana,
            calculo_nomina_base.idempresa_operacion,
            calculo_nomina_base.idempresa_origen,
            calculo_nomina_base.especialidad,
            calculo_nomina_base.salario,
            calculo_nomina_base.valor_diario_ley,
            calculo_nomina_base.pct_pago_incapacidad,
            calculo_nomina_base.toneladas,
            calculo_nomina_base.pago_produccion,
            calculo_nomina_base.base_turno,
            calculo_nomina_base.horas_hed,
            calculo_nomina_base.horas_hedf,
            calculo_nomina_base.horas_hen,
            calculo_nomina_base.horas_hef,
            calculo_nomina_base.horas_hn,
            calculo_nomina_base.val_hed,
            calculo_nomina_base.val_hedf,
            calculo_nomina_base.val_hen,
            calculo_nomina_base.val_hef,
            calculo_nomina_base.val_hn,
            calculo_nomina_base.total_recargos_turno,
            calculo_nomina_base.actividad_registrada,
            calculo_nomina_base.asistencia_texto,
            calculo_nomina_base.cuenta_como_falta,
            calculo_nomina_base.bloquea_domingo,
            calculo_nomina_base.es_sin_registro,
            calculo_nomina_base.asistio_ok,
            calculo_nomina_base.trabajo_efectivo,
            calculo_nomina_base.es_festivo,
            calculo_nomina_base.bono_no_prestacional,
            calculo_nomina_base.descansos_semana_anterior,
            calculo_nomina_base.faltas_semana_anterior,
            calculo_nomina_base.vacios_semana_anterior,
            calculo_nomina_base.novedades_semana_anterior,
            calculo_nomina_base.tuvo_licencia_no_rem_semana,
            calculo_nomina_base.tiene_compensatorio_posterior,
                CASE
                    -- DÍA 31 — MES CALENDARIO DE 30 DÍAS. El salario mensual ya cubre
                    -- el mes completo, así que el 31 NUNCA paga la base del TURNO (eso
                    -- no cambia). El DESTAJO es distinto DESDE 2026-08-31 (modelo "día
                    -- pleno" de Ajuste de Proyecciones): ese día SÍ se le paga el día
                    -- pleno (igual que un día normal), y lo que produjo de más/menos por
                    -- tonelaje se ajusta en la quincena SIGUIENTE — ya NO dentro de esta
                    -- misma quincena (ver scripts/059_archivoplano_reemplazo.sql, "EXCLUIR EL
                    -- DÍA DE CIERRE"; ambas migraciones van juntas o ninguna, si no hay
                    -- riesgo real de pagar la diferencia dos veces).
                    --
                    -- Antes del 2026-08-31 se conserva EXACTO el comportamiento viejo
                    -- (sin base para nadie, ni destajo) — no se reescriben quincenas ya
                    -- enviadas a Siigo con ese criterio.
                    --
                    -- Va PRIMERO para ganarle a festivo/novedades: el 31 no paga base
                    -- ni aunque sea festivo (ver también valor_domingo_final abajo).
                    WHEN (EXTRACT(day FROM calculo_nomina_base.fecha) = (31)::numeric) THEN
                    CASE
                        WHEN (calculo_nomina_base.fecha < DATE '2026-08-31') THEN (0)::numeric
                        WHEN ((calculo_nomina_base.especialidad = true) AND (calculo_nomina_base.base_turno IS NOT NULL)) THEN (0)::numeric
                        WHEN (calculo_nomina_base.asistio_ok = 1) THEN calculo_nomina_base.valor_diario_ley
                        ELSE (0)::numeric
                    END
                    -- INCAPACIDAD AL % PARAMETRIZABLE (2026-09-08, confirmado por el usuario +
                    -- verificado con datos reales de Siigo): el "66%"/"50%" del nombre de la
                    -- novedad es solo la clasificación LEGAL (quién asume el día, EPS vs
                    -- empleador), no necesariamente el peso que LIP le reconoce al trabajador.
                    -- Editable en Compensación › Parámetros de ley (`pct_pago_incapacidad`,
                    -- por vigencia) -- hoy en 100%. Caso real: IVAN ANDRES CASTRO BELTRAN,
                    -- novedad "Incapacidad... al 66%", Siigo le liquidó $408.544 por 7 días =
                    -- el valor_diario_ley COMPLETO, no el 66% ($272.363).
                    WHEN (calculo_nomina_base.es_festivo = 1) THEN calculo_nomina_base.valor_diario_ley
                    WHEN (TRIM(BOTH FROM calculo_nomina_base.asistencia_texto) = ANY (ARRAY['13- Incapacidad por enfermedad general al 100%'::text, '14- Incapacidad por enfermedad general al 50'::text, '15- Incapacidad por enfermedad general al 66%- ingreso'::text])) THEN (calculo_nomina_base.valor_diario_ley * (calculo_nomina_base.pct_pago_incapacidad / 100.0))
                    WHEN (TRIM(BOTH FROM calculo_nomina_base.asistencia_texto) = ANY (ARRAY['31- Vacaciones disfrutadas'::text, 'Descanso'::text, 'Descanso compensatorio domingo anterior'::text])) THEN calculo_nomina_base.valor_diario_ley
                    WHEN (calculo_nomina_base.asistio_ok = 1) THEN
                    CASE
                        WHEN ((calculo_nomina_base.especialidad = true) AND (calculo_nomina_base.base_turno IS NOT NULL)) THEN calculo_nomina_base.base_turno
                        ELSE calculo_nomina_base.valor_diario_ley
                    END
                    ELSE (0)::numeric
                END AS valor_base_final,
                CASE
                    -- DÍA 31: no paga dominical de ningún tipo (ni el día de descanso
                    -- ni el festivo). Decisión del negocio: el 31 solo lleva novedades.
                    WHEN (EXTRACT(day FROM calculo_nomina_base.fecha) = (31)::numeric) THEN (0)::numeric
                    -- DOMINGO TRABAJADO (desde 16-jul-2026): NO paga día de descanso.
                    -- El día trabajado ya lo cubre la base, y encima va el RECARGO
                    -- dominical (ver `recargodominical` abajo): total 1 + pct = 1,90.
                    -- Antes se pagaba el día otra vez (2,00 en Indupan, hasta 2,90 en
                    -- Avimol cuando además entraba el recargo) y descuadraba contra
                    -- Siigo, que solo recibe la novedad del recargo.
                    -- El descanso dominical de quien NO trabajó no se toca: sigue
                    -- pagándose completo por la rama de abajo.
                    WHEN ((calculo_nomina_base.fecha >= DATE '2026-07-16')
                      AND (calculo_nomina_base.dia_semana = (0)::numeric)
                      AND (calculo_nomina_base.asistio_ok = 1)
                      AND (calculo_nomina_base.actividad_registrada <> ALL (ARRAY['Festivo'::text, 'Sin Registro'::text]))) THEN (0)::numeric
                    WHEN ((calculo_nomina_base.dia_semana = (0)::numeric) AND ((calculo_nomina_base.faltas_semana_anterior = 0) OR (calculo_nomina_base.faltas_semana_anterior IS NULL)) AND ((calculo_nomina_base.vacios_semana_anterior = 0) OR (calculo_nomina_base.vacios_semana_anterior IS NULL)) AND ((calculo_nomina_base.novedades_semana_anterior = 0) OR (calculo_nomina_base.novedades_semana_anterior IS NULL)) AND ((calculo_nomina_base.tiene_compensatorio_posterior = 0) OR (calculo_nomina_base.tiene_compensatorio_posterior IS NULL))) THEN
                    CASE
                        WHEN ((calculo_nomina_base.especialidad = true) AND (calculo_nomina_base.base_turno IS NOT NULL)) THEN calculo_nomina_base.base_turno
                        ELSE calculo_nomina_base.valor_diario_ley
                    END
                    ELSE (0)::numeric
                END AS valor_domingo_final,
                -- Excedente de destajo del día CON SIGNO (nuevo modelo): en un día de
                -- toneladas se compara lo generado (pago_produccion) contra la base del
                -- día (valor_diario_ley). Positivo si movió por encima de su base,
                -- NEGATIVO si por debajo. Se suma por quincena para netear días buenos
                -- con días bajos (el bono nunca baja la base; ver archivoplano). Excluye
                -- especialidad (esos días son por turno/horas, no por tonelaje).
                CASE
                    -- DÍA 31 — HISTÓRICO (antes del 16-jul-2026): TODO el tonelaje va al
                    -- excedente, COMPLETO (sin restarle base, porque ese día no había
                    -- base que descontar). DESDE el 16-jul-2026 esta rama queda MUERTA
                    -- para el destajo normal: la manda la rama de más abajo
                    -- (`pago_produccion - valor_base_final` en el SELECT final, con piso
                    -- `fecha >= 2026-07-16`), que desde el piso `2026-08-31` de
                    -- `valor_base_final` ya resta el día pleno correcto también en el 31
                    -- — no la producción completa. Esta rama solo sigue viva para fechas
                    -- anteriores al 16-jul-2026 o para turno con la excepción de apoyo en
                    -- cargue (`especialidad=true` no entra a la rama de abajo).
                    WHEN (EXTRACT(day FROM calculo_nomina_base.fecha) = (31)::numeric) THEN
                    CASE
                        -- EXCEPCIÓN "apoyo en cargue": una persona de especialidad=true
                        -- SÍ entra al destajo cuando tiene una fila en
                        -- apoyo_cargue_asignaciones ese día (la agregaron desde el módulo
                        -- "Asignación de apoyo en cargue" a una orden de Cargue/Descargue).
                        -- No cambia la regla general de especialidad, solo la excepciona
                        -- para ese día/persona puntual.
                        WHEN ((calculo_nomina_base.toneladas > (0)::numeric) AND ((calculo_nomina_base.especialidad IS NOT TRUE) OR EXISTS (SELECT 1 FROM apoyo_cargue_asignaciones ap WHERE ((ap.fecha = calculo_nomina_base.fecha) AND (upper(TRIM(BOTH FROM ap.persona)) = upper(TRIM(BOTH FROM calculo_nomina_base.persona))))))) THEN calculo_nomina_base.pago_produccion
                        ELSE (0)::numeric
                    END
                    -- DESTAJO NORMAL (especialidad NOT true): el excedente es producción
                    -- MENOS la base del día — la base ya es un piso garantizado, así que
                    -- solo lo que pasa de ahí es bono.
                    WHEN ((calculo_nomina_base.toneladas > (0)::numeric) AND (calculo_nomina_base.especialidad IS NOT TRUE)) THEN (calculo_nomina_base.pago_produccion - calculo_nomina_base.valor_diario_ley)
                    -- APOYO EN CARGUE (especialidad=true, 2026-08-31, corregido): el apoyo
                    -- es ADICIONAL a su turno, no un reemplazo de él — lo hace normalmente
                    -- FUERA de su turno. Restarle la base de turno (como al destajo normal)
                    -- neteaba su tonelaje contra un salario de un trabajo distinto, y como
                    -- el apoyo puntual casi nunca supera un día completo de turno, el "bono"
                    -- daba siempre negativo y nunca se veía reflejado — el módulo pagaba $0
                    -- real pase lo que pase. Caso real: LUIS ANTONIO DE LEON GARCIA (ID2),
                    -- 12 días de apoyo en la quincena 16-31 ago, neto de la quincena
                    -- −$130.071 (piso $0, nunca cobró nada por esas 12 jornadas). Ahora el
                    -- apoyo paga su valor COMPLETO, sin restarle nada — confirmado
                    -- explícitamente por el usuario.
                    --
                    -- SIN el EXISTS de `apoyo_cargue_asignaciones` (quitado el mismo día):
                    -- esa tabla solo registra el camino MANUAL (módulo "Asignación de apoyo
                    -- en cargue", para ajustar un mal procedimiento o incluir/excluir
                    -- personal directo en `cabeceraoc.auxiliares` sin tocar la base de
                    -- datos). Pero hay un SEGUNDO camino igual de legítimo: el roster
                    -- automático de Pago Global (`computarRosterPagoGlobal`, lib/picking-
                    -- actions.ts) YA incluye a "Auxiliar Mixto" que terminó su turno y ayuda
                    -- a cargar un vehículo para ganar más — el MISMO caso de negocio, sin
                    -- pasar por el módulo manual. Exigir la fila de apoyo_cargue_asignaciones
                    -- dejaba fuera este segundo camino (verificado: 9 de 17 casos de agosto
                    -- no tenían esa fila y aun así son apoyo real fuera de turno). El único
                    -- requisito real es especialidad=true (turno) + toneladas>0 — ambos
                    -- caminos solo pueden darle toneladas a alguien de turno si en efecto
                    -- cargó algo, vía cualquiera de los dos mecanismos.
                    WHEN ((calculo_nomina_base.toneladas > (0)::numeric) AND (calculo_nomina_base.especialidad = true)) THEN calculo_nomina_base.pago_produccion
                    ELSE (0)::numeric
                END AS excedente_bruto_destajo,
                CASE
                    -- DÍA 31: sin recargo dominical (mismo criterio que arriba).
                    WHEN (EXTRACT(day FROM calculo_nomina_base.fecha) = (31)::numeric) THEN (0)::numeric
                    --
                    -- DOMINGO o FESTIVO TRABAJADO (desde 16-jul-2026).
                    --
                    -- Paga SIEMPRE el recargo, venga el día por toneladas o por turno.
                    -- El archivo plano decide 08 vs 25 con la columna
                    -- recargo_dominical_tasa_completa (ver más abajo): tasa completa
                    -- (1,90) → "08- Hora extra recargo dominical o festivo"; tasa
                    -- parcial (0,90) → "25- Recargo dominical o festivo".
                    --
                    -- EL FESTIVO ENTRA AQUÍ (corregido). Antes las dos ramas exigían
                    -- `dia_semana = 0`, así que un festivo ENTRE SEMANA no entraba a
                    -- ninguna: se pagaba 1,0 (la base, por la rama `es_festivo`) y el
                    -- recargo quedaba en CERO. Verificado con el viernes 07-ago-2026.
                    --
                    -- CUÁNTO SE PAGA — el FESTIVO y el DOMINGO no siguen la misma regla:
                    --
                    --   · FESTIVO trabajado: SIEMPRE (1 + pct) = 1,90 hoy, descansara o
                    --     CAMBIO 2026-09: el festivo trabajado se liquida IGUAL que
                    --     el domingo -- al pct del recargo (0,90), no a tarifa completa
                    --     (1,90). Lo definió RRHH: "debe tener el mismo efecto que el
                    --     domingo que se liquida al 0.9". Antes el festivo forzaba
                    --     tarifa completa sin mirar el descanso semanal, y por eso
                    --     viajaba al plano en la novedad 08; ahora viaja en la 25, que
                    --     es la que corresponde a esa tarifa.
                    --
                    --   · DOMINGO trabajado: depende del descanso. (1 + pct) = 1,90 si
                    --     NO descansó en los 6 días anteriores NI tiene compensatorio en
                    --     los 6 siguientes — nunca recibió su descanso semanal, así que
                    --     el día se le compensa completo dentro del recargo. Si sí
                    --     descansó (antes o después), el recargo es el pct normal =
                    --     0,90, porque el descanso ya se lo pagaron por otro lado.
                    --
                    -- Un domingo que ADEMÁS es festivo entra por la primera regla: 1,90.
                    --
                    -- El factor se ata a `pct_recargo_dominical`, que viene de la
                    -- vigencia (80% hasta 15-jul-2026, 90% desde el 16): así el 1,90 se
                    -- mueve solo si cambia la ley, sin tocar esta vista.
                    --
                    -- La condición de trabajo es `trabajo_efectivo`, no
                    -- `asistio_ok` + `actividad_registrada <> 'Festivo'`: en un festivo
                    -- `asistio_ok` vale 1 para todos por el solo hecho de la fecha, y el
                    -- texto 'Festivo' tapaba a quien sí trabajó (ver `trabajo_efectivo`).
                    WHEN ((calculo_nomina_base.fecha >= DATE '2026-07-16')
                      AND ((calculo_nomina_base.dia_semana = (0)::numeric) OR (calculo_nomina_base.es_festivo = 1))
                      AND (calculo_nomina_base.trabajo_efectivo = 1)) THEN
                    (
                        CASE
                            WHEN ((calculo_nomina_base.especialidad = true) AND (calculo_nomina_base.base_turno IS NOT NULL)) THEN calculo_nomina_base.base_turno
                            ELSE calculo_nomina_base.valor_diario_ley
                        END
                        *
                        CASE
                            -- Domingo O FESTIVO sin descanso ni compensatorio: completo.
                            -- El festivo ya NO tiene rama propia: se evalúa con la misma
                            -- regla del domingo (decisión de RRHH, 2026-09).
                            WHEN ((COALESCE(calculo_nomina_base.descansos_semana_anterior, 0) = 0)
                              AND (COALESCE(calculo_nomina_base.tiene_compensatorio_posterior, 0) = 0))
                                THEN ((1)::numeric + (calculo_nomina_base.pct_recargo_dominical / 100.0))
                            -- Con descanso ya tomado o compensatorio pendiente: solo el
                            -- recargo. Es la rama por la que ahora entra el festivo
                            -- trabajado de quien descansó su domingo, y la que lo manda
                            -- a la novedad 25 del archivo plano.
                            ELSE (calculo_nomina_base.pct_recargo_dominical / 100.0)
                        END
                    )
                    -- Histórico (antes del 16-jul-2026): se conserva EXACTAMENTE como
                    -- estaba para no reescribir quincenas ya pagadas y conciliadas.
                    WHEN ((calculo_nomina_base.dia_semana = (0)::numeric) AND (calculo_nomina_base.asistio_ok = 1) AND (calculo_nomina_base.especialidad = true) AND (COALESCE(calculo_nomina_base.toneladas, (0)::numeric) = (0)::numeric)) THEN (calculo_nomina_base.valor_diario_ley * (calculo_nomina_base.pct_recargo_dominical / 100.0))
                    ELSE (0)::numeric
                END AS recargodominical,
                -- ¿El `recargodominical` de arriba se pagó a tarifa COMPLETA
                -- (1 + pct, ej. 1,90) o solo al pct del recargo (ej. 0,90)?
                -- MISMA condición que decide el factor dentro de `recargodominical`
                -- (si se toca una, tocar la otra): festivo trabajado SIEMPRE
                -- completo; domingo trabajado completo SOLO si no descansó en
                -- los 6 días previos ni tiene compensatorio después.
                --
                -- Existe para que `archivoplano` pueda mandar la novedad correcta
                -- a Siigo: "08- Hora extra recargo dominical o festivo" cuando es
                -- tarifa completa (equivale a una hora extra encima del recargo),
                -- "25- Recargo dominical o festivo" cuando es solo el recargo.
                -- ANTES archivoplano decidía 08 vs 25 mirando `pago_domingo` (el
                -- pago del DÍA DE DESCANSO de quien NO trabajó) — una variable sin
                -- relación real con la tarifa aplicada, así que CUALQUIER domingo/
                -- festivo TRABAJADO caía siempre en 25, incluso a tarifa completa.
                -- Caso real: ROBERTO ENRIQUE HOYOS VIDEZ (ID2), domingo 30-ago-2026,
                -- trabajó los 7 días previos sin descanso → tarifa completa
                -- (58.363,50 × 1,9 = 110.890,65, verificado) → debía ir en 08, y
                -- archivoplano lo mandaba en 25.
                -- Tiene que espejar EXACTAMENTE el CASE del importe de arriba: si
                -- divergen, el plano manda una novedad cuya tarifa no es la que se
                -- liquidó. Por eso el festivo tampoco tiene aquí rama propia.
                CASE
                    WHEN (EXTRACT(day FROM calculo_nomina_base.fecha) = (31)::numeric) THEN false
                    WHEN ((calculo_nomina_base.fecha >= DATE '2026-07-16')
                      AND ((calculo_nomina_base.dia_semana = (0)::numeric) OR (calculo_nomina_base.es_festivo = 1))
                      AND (calculo_nomina_base.trabajo_efectivo = 1)) THEN
                        ((COALESCE(calculo_nomina_base.descansos_semana_anterior, 0) = 0)
                          AND (COALESCE(calculo_nomina_base.tiene_compensatorio_posterior, 0) = 0))
                    ELSE false
                END AS recargo_dominical_tasa_completa
           FROM calculo_nomina_base
        )
 SELECT fecha,
    idempresa_origen AS idempresa,
    COALESCE((idempresa_operacion)::integer, idempresa_origen, 0) AS idempresaliquidacion,
    persona,
    actividad_registrada,
        -- Marcador de domingo perdido por licencia no remunerada en la semana.
        -- OJO: `archivoplano` consume esta columna como NOVEDAD REAL, y Siigo
        -- procesa toda novedad de días DESCONTANDO el día. Por eso solo se marca
        -- el domingo que NO se trabajó: si la persona trabajó ese domingo, LIPgo
        -- le paga base + recargo (regla del 1,90), y mandar el 38 hacía que Siigo
        -- le descontara un día efectivamente trabajado. Caso real: CARLOS DANIEL
        -- OJITO, domingo 26-jul-2026, −$58.364 contra Siigo.
        -- Para quien NO trabajó el domingo el marcador sigue igual: ya perdió el
        -- descanso por `bloquea_domingo`, y la novedad lo deja documentado.
        --
        -- FIX 2026-09-14: `asistio_ok = 0` es cierto para CUALQUIER día con una
        -- novedad propia (Descanso, Vacaciones, Incapacidad...), no solo para un
        -- domingo genuinamente en blanco -- así que el domingo con SU PROPIA
        -- novedad quedaba tapado por el "38- Licencia no remunerada" aunque
        -- `valor_base_final` ya lo hubiera pagado completo por esa novedad. Se
        -- agrega la condición de que el día en sí esté REALMENTE vacío
        -- (`asistencia_texto` nulo/blanco) -- si el domingo tiene su propia
        -- novedad, esa es la que se reporta, cada una con el pago que ya le
        -- corresponde (ver `valor_base_final` arriba). Caso real: ELKIN DAVID
        -- DIAZ SANDOVAL (ID2), domingo 06-sep-2026 con novedad "Descanso" -- se
        -- le pagó el día completo ($58.363,50) pero `novedad_reportada` mostraba
        -- "38- Licencia no remunerada- Deducción" (tuvo una licencia real el
        -- 02-sep, dentro de los 6 días previos) en vez de "Descanso".
        CASE
            WHEN ((dia_semana = (0)::numeric) AND (tuvo_licencia_no_rem_semana = 1)
                  AND ((asistio_ok = 0) OR (actividad_registrada = ANY (ARRAY['Festivo'::text, 'Sin Registro'::text])))
                  AND (asistencia_texto IS NULL OR TRIM(BOTH FROM asistencia_texto) = ''::text)) THEN '38- Licencia no remunerada- Deducción'::text
            ELSE asistencia_texto
        END AS novedad_reportada,
    especialidad,
    toneladas,
    pago_produccion,
    valor_base_final AS base_dia,
        -- Bonificación por productividad = excedente de destajo del día CON SIGNO.
        -- TODO es prestacional (se elimina el tope de $9.948; cotiza completo al IBC).
        -- Va con signo para que la quincena netee (archivoplano suma y aplica MAX(0,·)).
        --
        -- SE RESTA LA BASE EFECTIVAMENTE PAGADA (`valor_base_final`), NO la teórica
        -- (`valor_diario_ley`), desde el 16-jul-2026.
        --
        -- El excedente es "lo que produjo POR ENCIMA de lo que se le pagó de base".
        -- Si ese día NO se le pagó base —porque tuvo una novedad que no remunera—,
        -- restarle igual salario/30 le cobra una base que nunca recibió y le borra
        -- el bono de toda la quincena. Caso real: DANILO JOSE DE LA HOZ CAMARGO,
        -- 21-jul-2026: movió 2,9 t ($11.889) en un día con base $0. La vista le
        -- calculaba 11.889 − 58.364 = −46.475 y su neto quincenal caía a −$43.560
        -- (bono $0), cuando el módulo de Revisión de nómina —que sí resta la base
        -- real— daba +$14.803. Esa era la diferencia entre LIPgo y el archivo plano.
        --
        -- En un día normal las dos fórmulas dan lo MISMO (valor_base_final =
        -- valor_diario_ley). Solo difieren en los días con tonelaje y sin base
        -- pagada: 5 personas en la quincena en curso.
        --
        -- DÍA 31 — esta rama (con piso `fecha >= 2026-07-16`) es la que MANDA
        -- para el destajo, y desde el piso `2026-08-31` de `valor_base_final`
        -- (arriba) las dos fórmulas también coinciden ahí: valor_base_final ya
        -- es el día pleno ese día, así que `pago_produccion - valor_base_final`
        -- da el excedente/déficit correcto contra esa base — no la producción
        -- completa. El día-31 propio de `excedente_bruto_destajo` (rama de
        -- abajo) queda como código histórico: solo se usa para fechas
        -- anteriores al 16-jul-2026 o para turno con la excepción de apoyo en
        -- cargue — nunca para el destajo normal de hoy en adelante.
        --
        -- PISO 16-jul-2026: antes de esa fecha se conserva `excedente_bruto_destajo`
        -- tal como estaba, para no reescribir quincenas ya enviadas a Siigo.
        CASE
            WHEN ((fecha >= DATE '2026-07-16')
              AND (toneladas > (0)::numeric)
              AND (especialidad IS NOT TRUE)) THEN (pago_produccion - valor_base_final)
            -- APOYO EN CARGUE (especialidad=true, 2026-08-31, corregido — ver
            -- excedente_bruto_destajo arriba, mismo caso real de LUIS ANTONIO DE LEON
            -- GARCIA, y mismo motivo para quitar el EXISTS de
            -- apoyo_cargue_asignaciones: ese registro solo cubre el camino MANUAL, no
            -- el roster automático de Pago Global que también le da toneladas reales
            -- a un turno que ya salió de su turno): paga el valor COMPLETO de su
            -- tonelaje, SIN restarle la base de turno — el apoyo es adicional a su
            -- turno (lo hace fuera de él), no un reemplazo. Restarle esa base (como al
            -- destajo normal) neteaba casi siempre a negativo y el módulo nunca pagaba
            -- nada real por el apoyo.
            WHEN ((fecha >= DATE '2026-07-16')
              AND (toneladas > (0)::numeric)
              AND (especialidad = true)) THEN pago_produccion
            ELSE excedente_bruto_destajo
        END AS bonif_prestacional,
        -- Bono NO prestacional del módulo "Bonos" (Compensación): suma de los
        -- bonos APROBADOS de ese día para esa persona. NO entra a
        -- total_liquidado_dia (no cotiza al IBC ni genera prestaciones); se
        -- paga vía la novedad propia del ARCHIVO PLANO (43/50/66).
        COALESCE(bono_no_prestacional, (0)::numeric) AS bonif_no_prestacional,
    horas_hed,
    horas_hedf,
    horas_hen,
    horas_hef,
    horas_hn,
    val_hed AS hed,
    val_hedf AS hedf,
    val_hen AS hen,
    val_hef AS hef,
    val_hn AS hn,
    total_recargos_turno AS total_recargos,
        CASE
            WHEN (TRIM(BOTH FROM asistencia_texto) = ANY (ARRAY['13- Incapacidad por enfermedad general al 100%'::text, '31- Vacaciones disfrutadas'::text, '14- Incapacidad por enfermedad general al 50'::text, '15- Incapacidad por enfermedad general al 66%- ingreso'::text, 'Descanso compensatorio domingo anterior'::text])) THEN (0)::numeric
            ELSE valor_domingo_final
        END AS pago_domingo,
    recargodominical,
    (((
        CASE
            -- DÍA 31 (mes calendario de 30 días): delega en `valor_base_final`, que
            -- YA trae la regla completa (turno sin base siempre; destajo sin base
            -- antes del 2026-08-31, día pleno desde esa fecha — ver esa misma rama
            -- en pre_calculo_valores). Va PRIMERO en sincronía con esa rama — este
            -- CASE es un duplicado histórico de aquel; si se toca uno, tocar el otro.
            WHEN (EXTRACT(day FROM fecha) = (31)::numeric) THEN valor_base_final
            -- INCAPACIDAD AL % PARAMETRIZABLE -- mismo criterio que valor_base_final arriba
            -- (si se toca uno, tocar el otro): confirmado por el usuario y verificado con
            -- datos reales de Siigo (caso IVAN ANDRES CASTRO BELTRAN). Editable en
            -- Compensación › Parámetros de ley (`pct_pago_incapacidad`).
            WHEN (es_festivo = 1) THEN valor_diario_ley
            WHEN (TRIM(BOTH FROM asistencia_texto) = ANY (ARRAY['13- Incapacidad por enfermedad general al 100%'::text, '14- Incapacidad por enfermedad general al 50'::text, '15- Incapacidad por enfermedad general al 66%- ingreso'::text])) THEN (valor_diario_ley * (pct_pago_incapacidad / 100.0))
            WHEN (TRIM(BOTH FROM asistencia_texto) = ANY (ARRAY['31- Vacaciones disfrutadas'::text, 'Descanso'::text, 'Descanso compensatorio domingo anterior'::text])) THEN valor_diario_ley
            WHEN (especialidad = true) THEN valor_base_final
            -- NUEVO MODELO: el día de destajo YA NO se liquida al valor de sus
            -- toneladas, sino a la BASE del día (valor_base_final = salario/30). Lo que
            -- generó de más/menos por tonelaje se netea por quincena como bonificación
            -- (bonif_prestacional, ver archivoplano). Así cada día trabajado paga su
            -- base como en SIIGO, sin nivelar hacia abajo el bono ni las horas extra.
            ELSE valor_base_final
        END + COALESCE(total_recargos_turno, (0)::numeric)) +
        CASE
            WHEN (TRIM(BOTH FROM asistencia_texto) = ANY (ARRAY['Descanso'::text, '31- Vacaciones disfrutadas'::text, 'Descanso compensatorio domingo anterior'::text, '13- Incapacidad por enfermedad general al 100%'::text, '14- Incapacidad por enfermedad general al 50'::text, '15- Incapacidad por enfermedad general al 66%- ingreso'::text])) THEN (0)::numeric
            ELSE valor_domingo_final
        END) + recargodominical) AS total_liquidado_dia,
    -- AL FINAL a propósito: esta vista usa CREATE OR REPLACE (no DROP+CREATE
    -- como archivoplano, que sí depende de ella), y Postgres solo deja AÑADIR
    -- columnas al final de un CREATE OR REPLACE VIEW — insertarla antes de
    -- `total_liquidado_dia` rompe con error 42P16.
    recargo_dominical_tasa_completa
   FROM pre_calculo_valores pc
  WHERE (fecha <= CURRENT_DATE)
    AND (fecha BETWEEN p_desde AND p_hasta)
    -- Auxiliares de PRUEBA (todos los ID): NUNCA entran a la nómina a pagar.
    AND (pc.persona !~* 'prueba')
    -- Estado / vínculo laboral: excluye días FUERA del vínculo — la persona tiene
    -- contrato(s) en colaboradores_th pero NINGUNO cubre esa fecha (antes de
    -- iniciar o después de terminar). Falla hacia pagar: si no se puede vincular su
    -- contrato (por nombre↔cédula), NO se excluye (nunca deja sin pago a un activo).
    AND NOT (
          EXISTS (SELECT 1 FROM headcount hh
                    JOIN colaboradores_th cc ON ((TRIM(BOTH FROM cc.numero_documento) = TRIM(BOTH FROM hh.identificacion)))
                  WHERE (TRIM(BOTH FROM hh.nombre) = TRIM(BOTH FROM pc.persona)))
      AND NOT EXISTS (SELECT 1 FROM headcount hh
                        JOIN colaboradores_th cc ON ((TRIM(BOTH FROM cc.numero_documento) = TRIM(BOTH FROM hh.identificacion)))
                      WHERE (TRIM(BOTH FROM hh.nombre) = TRIM(BOTH FROM pc.persona))
                        AND (pc.fecha >= cc.fecha_inicio_contrato)
                        AND ((cc.fecha_fin_contrato IS NULL) OR (pc.fecha <= cc.fecha_fin_contrato)))
    )
    -- Corte por FECHA DE RETIRO (headcount.fecha_retiro): no se liquidan los días
    -- POSTERIORES al retiro de la persona. Cierra la fuga que el filtro de vínculo
    -- de arriba deja pasar cuando el contrato en colaboradores_th sigue abierto
    -- (fecha_fin_contrato NULL) o no se puede vincular por nombre↔cédula.
    -- SALVAGUARDA (falla hacia pagar): NO corta a quien esté ACTIVO en algún Head
    -- Count (reingreso, o fecha_retiro vieja de un vínculo anterior); su vínculo
    -- vigente manda. Solo corta a los realmente retirados (sin registro Activo).
    AND NOT (
          EXISTS (SELECT 1 FROM headcount hr
                   WHERE (TRIM(BOTH FROM hr.nombre) = TRIM(BOTH FROM pc.persona))
                     AND (hr.fecha_retiro IS NOT NULL)
                     AND (pc.fecha > hr.fecha_retiro))
      AND NOT EXISTS (SELECT 1 FROM headcount ha
                       WHERE (TRIM(BOTH FROM ha.nombre) = TRIM(BOTH FROM pc.persona))
                         AND (UPPER(TRIM(BOTH FROM COALESCE(ha.estado, ''::text))) = 'ACTIVO'))
    )
    -- ------------------------------------------------------------------------
    -- CORTE POR FECHA DE INGRESO (headcount.fechainicio) — simétrico al de
    -- retiro. `headcount.fechainicio` es la FUENTE DE VERDAD del inicio de
    -- actividades: antes de esa fecha no se liquida NADA.
    --
    -- Por qué era necesario: el filtro de vínculo laboral de arriba compara
    -- contra `colaboradores_th` y FALLA HACIA PAGAR — solo excluye si la
    -- persona tiene contrato registrado allí y ninguno cubre la fecha. Quien
    -- no tenga fila en `colaboradores_th` (caso real y frecuente) cobraba días
    -- previos a su ingreso. Y el caso más silencioso son los FESTIVOS: el
    -- calendario es cartesiano (todos los días × todas las personas), así que
    -- un festivo se liquidaba a cualquiera de la lista aunque aún no existiera
    -- como empleado — sin pasar por registroasistencia ni por cabeceraoc, o
    -- sea, sin ningún dato que se pudiera corregir a mano.
    --
    -- PISO DE VIGENCIA (2026-07-16): la regla NO se aplica retroactivamente.
    -- Reescribir quincenas ya pagadas cambiaría liquidaciones cerradas, el IBC
    -- ya reportado a la PILA y archivos planos ya enviados a Siigo. Medido
    -- sobre datos reales: con este piso afecta 2 personas / $116.727 (el caso
    -- que originó la regla); sin piso serían 50 personas / $17.8 millones.
    -- Para extenderla hacia atrás, basta mover esta fecha — pero eso es una
    -- decisión de negocio, no técnica.
    --
    -- MULTI-EMPRESA: se toma la fechainicio MÍNIMA de la persona entre todas
    -- sus filas de Head Count. Si trabajó antes en otro proyecto, esos días
    -- siguen siendo válidos.
    -- FALLA HACIA PAGAR: si no tiene `fechainicio`, no se corta nada.
    -- ------------------------------------------------------------------------
    AND NOT (
          pc.fecha >= DATE '2026-07-16'
      AND EXISTS (SELECT 1 FROM headcount hi
                   WHERE (TRIM(BOTH FROM hi.nombre) = TRIM(BOTH FROM pc.persona))
                     AND (hi.fechainicio IS NOT NULL))
      AND pc.fecha < (SELECT min(hi2.fechainicio) FROM headcount hi2
                       WHERE (TRIM(BOTH FROM hi2.nombre) = TRIM(BOTH FROM pc.persona))
                         AND (hi2.fechainicio IS NOT NULL))
    )
$fn$;

-- Verificación (debe devolver las mismas filas que la vista para el rango):
-- select count(*) from public.pagonomina where fecha between '2026-09-01' and '2026-09-26';
-- select count(*) from public.pagonomina_rango('2026-09-01', '2026-09-26');
