-- =====================================================================
-- ALINEAR "toneladas por persona" a UNA sola verdad (báscula = peso_base_calculo)
-- en el PANEL (operaciones_desglosadas) y el PORTAL del trabajador
-- (toneladasauxiliares), para que el total del mes de una persona sea IDÉNTICO
-- en ambos y coincida con lo que se COBRA y se PAGA.
--
-- Causa de la diferencia (diagnóstico):
--   · operaciones_desglosadas (panel) usaba d.toneladas (DETALLE de producto).
--   · toneladasauxiliares (portal) usaba peso_base_calculo (BÁSCULA).
--   Ambas dividen entre los mismos auxiliares; solo cambiaba el PESO -> ±20 t/persona.
--
-- Verdad absoluta = peso_base_calculo (báscula del tiquete, con la normalización del
-- descargue id3/4 que ya usan el cobro y la vista de pago toneladasauxiliarespago).
--
-- Idempotente (create or replace). NO cambia el esquema. Correr en Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) PORTAL: toneladasauxiliares — se le agrega la NORMALIZACIÓN DE BÁSCULA
--    del descargue id3/4 al peso_base_calculo (antes: id3/4 -> pesoorden a secas).
--    Así el portal muestra exactamente el peso cobrado/pagado también en descargues.
-- ---------------------------------------------------------------------
create or replace view public.toneladasauxiliares as
 WITH transformacion AS (
         SELECT cabeceraoc.ordendecargue,
            cabeceraoc.fechacargue,
            cabeceraoc.tipooperacion,
            cabeceraoc.transporte,
            cabeceraoc.idempresa,
                CASE
                    WHEN (cabeceraoc.idempresa = ANY (ARRAY[3, 4])) AND (cabeceraoc.tipooperacion = 'Descargue'::text) THEN
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
                    WHEN cabeceraoc.idempresa = ANY (ARRAY[3, 4]) THEN cabeceraoc.pesoorden
                    ELSE cabeceraoc.pesovascula
                END AS peso_base_calculo,
            array_length(string_to_array(cabeceraoc.auxiliares, ','::text), 1) AS cantidad_auxiliares,
            TRIM(BOTH FROM regexp_split_to_table(cabeceraoc.auxiliares, ','::text)) AS nombre_auxiliar
           FROM cabeceraoc
          WHERE cabeceraoc.fincargue IS NOT NULL AND cabeceraoc.fincargue::text <> ''::text
            -- "proyeccion" excluido (2026-09-08): residuo de un módulo manual
            -- descontinuado en jul-2026, nunca fue tonelaje real (ver
            -- scripts/053_pagonomina_reemplazo.sql) -- sin esto, el portal "Mi
            -- Aporte" del trabajador podía mostrarle un tonelaje personal inflado.
            AND cabeceraoc.tipooperacion <> 'proyeccion'::text
            -- POR UNIDAD (2026-09-30): Huevos y Empaque MP (Avimol) se pagan por turno,
            -- no por tonelada; su "peso" son unidades. Misma exclusión que pagonomina
            -- (scripts/053) y lib/ordenes-por-unidad.ts.
            AND NOT EXISTS (
                SELECT 1
                  FROM detalleoc du
                  JOIN productos pu ON pu.nombre = du.producto
                 WHERE du.numeroorden = cabeceraoc.ordendecargue
                   AND upper(btrim(pu.subcategoria)) = ANY (ARRAY['HUEVOS'::text, 'MATERIA PRIMA'::text])
            )
        ), liquidacion_final AS (
         SELECT t.ordendecargue,
            t.fechacargue,
            t.idempresa,
            t.tipooperacion,
            t.nombre_auxiliar,
            t.peso_base_calculo AS peso_total_operacion,
            t.cantidad_auxiliares,
                CASE
                    WHEN t.cantidad_auxiliares > 0 THEN t.peso_base_calculo / t.cantidad_auxiliares::numeric
                    ELSE 0::numeric
                END AS toneladas_auxiliar,
            tp.tarifa AS tarifa_aplicada,
                CASE
                    WHEN t.cantidad_auxiliares > 0 AND tp.tarifa IS NOT NULL THEN t.peso_base_calculo / t.cantidad_auxiliares::numeric * tp.tarifa
                    ELSE 0::numeric
                END AS pago_total
           FROM transformacion t
             LEFT JOIN tarifaspersonal tp ON t.idempresa = tp.empresaid AND t.tipooperacion = tp.operacion AND t.fechacargue >= tp.fechaini AND t.fechacargue <= tp.fechafin
        )
 SELECT ordendecargue, fechacargue, idempresa, tipooperacion, nombre_auxiliar,
        peso_total_operacion, cantidad_auxiliares, toneladas_auxiliar, tarifa_aplicada, pago_total
   FROM liquidacion_final
  WHERE nombre_auxiliar !~* 'prueba'   -- fuera los auxiliares de PRUEBA (todos los ID)
  ORDER BY fechacargue DESC, ordendecargue;

-- ---------------------------------------------------------------------
-- 2) PANEL: operaciones_desglosadas — el peso pasa de DETALLE a la MISMA
--    peso_base_calculo (báscula) PRORRATEADA por producto (para conservar el
--    desglose por producto/día). Σ por persona = peso_base_calculo / auxiliares
--    = EXACTAMENTE lo que muestra el portal.
--      · det_orden: Σ detalle por orden (para prorratear la báscula a cada producto).
--      · "Toneladas Cargadas" = Σ ( peso_bascula * det_producto/det_total / auxiliares ).
-- ---------------------------------------------------------------------
create or replace view public.operaciones_desglosadas as
 WITH det_orden AS (
         SELECT detalleoc.numeroorden,
            sum(detalleoc.toneladas) AS det_total
           FROM detalleoc
          GROUP BY detalleoc.numeroorden
        ), base AS (
         SELECT c.ordendecargue,
            c.fechacargue AS fecha,
            c.idempresa AS proyecto_id,
            c.tipooperacion,
            p.subcategoria AS tipo_producto,
            d.toneladas AS det_producto,
            do2.det_total,
                CASE
                    WHEN (c.idempresa = ANY (ARRAY[3, 4])) AND (c.tipooperacion = 'Descargue'::text) THEN
                        CASE
                            WHEN (COALESCE(c.pesovascula, (0)::numeric) <= (0)::numeric) THEN c.pesoorden
                            WHEN ((
                                CASE WHEN ((c.pesovascula / NULLIF(c.pesoorden, (0)::numeric)) > (50)::numeric)
                                     THEN (c.pesovascula / (1000)::numeric) ELSE c.pesovascula END
                                ) / NULLIF(c.pesoorden, (0)::numeric) NOT BETWEEN (0.1)::numeric AND (10)::numeric) THEN c.pesoorden
                            ELSE (
                                CASE WHEN ((c.pesovascula / NULLIF(c.pesoorden, (0)::numeric)) > (50)::numeric)
                                     THEN (c.pesovascula / (1000)::numeric) ELSE c.pesovascula END
                                )
                        END
                    WHEN c.idempresa = ANY (ARRAY[3, 4]) THEN c.pesoorden
                    ELSE c.pesovascula
                END AS peso_bascula,
            array_length(string_to_array(c.auxiliares, ','::text), 1) AS cantidad_auxiliares,
            TRIM(BOTH FROM regexp_split_to_table(c.auxiliares, ','::text)) AS operador
           FROM cabeceraoc c
             LEFT JOIN detalleoc d ON c.ordendecargue = d.numeroorden   -- LEFT: incluye órdenes SIN detalle (descargue directo) para que cuenten igual que el portal
             LEFT JOIN det_orden do2 ON do2.numeroorden = c.ordendecargue
             LEFT JOIN productos p ON d.producto = p.nombre
          WHERE c.fincargue IS NOT NULL AND c.fincargue::text <> ''::text
            -- "proyeccion" excluido (2026-09-08, mismo motivo que toneladasauxiliares
            -- arriba): residuo de un módulo manual descontinuado en jul-2026, nunca
            -- fue tonelaje real -- se saca de aquí también para seguir contando
            -- igual que el portal.
            AND c.tipooperacion <> 'proyeccion'::text
            -- POR UNIDAD (2026-09-30): Huevos y Empaque MP fuera del tonelaje del panel
            -- (misma exclusión que pagonomina y toneladasauxiliares).
            AND NOT EXISTS (
                SELECT 1
                  FROM detalleoc du
                  JOIN productos pu ON pu.nombre = du.producto
                 WHERE du.numeroorden = c.ordendecargue
                   AND upper(btrim(pu.subcategoria)) = ANY (ARRAY['HUEVOS'::text, 'MATERIA PRIMA'::text])
            )
        )
 SELECT fecha AS "Fecha",
    operador AS "Operador",
    proyecto_id AS "ID Proyecto",
    COALESCE(tipo_producto, 'Sin Categoría'::text) AS "Tipo de Producto",
    tipooperacion AS "Tipo de Operacion",
    cantidad_auxiliares AS "Cantidad Auxiliares en Operacion",
    count(*) AS "Total Viajes/Tickets",
    sum(
        (CASE
            WHEN det_total IS NULL OR det_total <= (0)::numeric THEN peso_bascula   -- sin detalle (p.ej. proyección): todo el peso a "Sin Categoría"
            ELSE peso_bascula * (det_producto / NULLIF(det_total, (0)::numeric))    -- con detalle: prorrateo por producto
        END) / NULLIF(cantidad_auxiliares, 0)::numeric
    ) AS "Toneladas Cargadas"
   FROM base
  WHERE operador IS NOT NULL AND operador <> ''::text
    AND operador !~* 'prueba'   -- fuera los auxiliares de PRUEBA (todos los ID)
  GROUP BY fecha, operador, proyecto_id, tipo_producto, tipooperacion, cantidad_auxiliares
  ORDER BY fecha DESC, operador, proyecto_id;
