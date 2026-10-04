# SIG · Scripts para ejecutar en Supabase (SQL Editor)

Carpeta entregable del **Sistema Integrado de Gestión (SIG)** — Certificaciones LIP
(ISO 9001:2015 · ISO 14001:2015 · ISO 45001:2018).

> Todos los scripts son **aditivos e idempotentes**: usan `CREATE/ALTER ... IF NOT EXISTS`
> y seeds con `ON CONFLICT DO UPDATE`. No borran ni alteran datos existentes y se
> pueden re-ejecutar sin riesgo.

## Cómo correrlos
1. Entra a tu proyecto en **Supabase → SQL Editor**.
2. Abre cada archivo **en el orden numérico** de esta carpeta.
3. Copia el contenido, pégalo y ejecuta (**Run**).
4. Marca abajo el que ya corriste.

## Orden de ejecución

| # | Archivo | Qué hace | ¿Ejecutado? |
|---|---------|----------|-------------|
| 01 | `01_matriz_integrada.sql` | Tablas `sig_normas`, `sig_requisitos`, `sig_requisito_norma`, `sig_documento_cobertura` + seed (3 normas, 37 numerales, 111 evidencias por norma) + columnas `sig_matriz`, `sig_iso9001`, `sig_iso14001`, `sig_iso45001` en `permisos_usuarios`. | ⬜ |
| 02 | `02_permisos_sig.sql` | Otorga acceso al módulo (activa los permisos `sig_*` al usuario/correo indicado). | ⬜ |
| 03 | `03_rls_sig.sql` | **Opcional.** Quita RLS a las tablas `sig_*` para que la anon key pueda leerlas. No es necesario: las acciones del SIG ya usan service role. | ⬜ |
| 04 | `04_cobertura_documento.sql` | Agrega `documento_id` a `sig_documento_cobertura` para **vincular documentos reales de `sig_documentos`** a numerales/normas. Necesario para la función de vincular documentos. | ⬜ |
| 05 | `05_control_cambios.sql` | Tabla `sig_documento_versiones` (bitácora de cambios/versiones por documento, ISO 7.5.3) + permiso `sig_control_cambios`. | ⬜ |
| 06 | `06_aspectos_ambientales.sql` | Tabla `sig_aspectos_ambientales` (ISO 14001, matriz de aspectos e impactos) + seed catálogo (montacargas eléctricos). | ⬜ |
| 07 | `07_objetivos.sql` | Tabla `sig_objetivos` (Objetivos y Metas del SIG, numeral 6.2, las 3 normas) + seed. | ⬜ |
| 08 | `08_legal_ambiental.sql` | Tabla `sig_requisitos_legales` (Matriz Legal Ambiental ISO 14001, 6.1.3) + seed normatividad real. | ⬜ |
| 09 | `09_contexto_dofa.sql` | Tabla `sig_contexto_dofa` (Análisis de Contexto / DOFA, numeral 4.1) + seed. | ⬜ |
| 10 | `10_no_conformidades.sql` | Tablas `sig_procesos` (mapa de procesos), `sig_nc_catalogo` (catálogo de NC potenciales por proceso, 6.1) y `sig_no_conformidades` (registro real 10.2 / 8.7) + seed (7 procesos, ~29 NC potenciales, 1 NC de ejemplo). Sin permiso nuevo: el módulo "No Conformidades SIG" usa `sig_matriz`. Seeds bajo **alcance LIP (idempresa=100)**. | ⬜ |
| 11 | `11_alcance_lip_multisitio.sql` | **Re-anclaje del SIG a LIP.** Las `empresas` (1..6) son los CLIENTES (Indupan, Avimol, Cedi Funza, Cedi Medellín, Demogistics, Precocidos); no hay fila "LIP". Mueve las 8 tablas SIG por-empresa de `idempresa=1` (= Indupan) a **`idempresa=100` (alcance LIP)** y agrega `proyecto_id` a `sig_no_conformidades` para etiquetar el cliente/sitio. El módulo SIG es independiente del selector de cliente. | ⬜ |
| 12 | `12_indicadores.sql` | Tabla `sig_indicadores` (ISO 9001 9.1) + seed de 18 indicadores (5 gerenciales + 13 por proceso) bajo alcance LIP (100). Varios se calculan **en vivo** desde datos reales de LIPgo (cabeceraoc, citasvehiculos, invtrans, headcount), filtrables por cliente/sitio; el resto manuales. El cumplimiento de LIP se mide por su tramo (`fincargue`), no por el pesaje final del cliente. Módulo "Indicadores SIG" → permiso `sig_matriz`. | ⬜ |
| 13 | `13_proceso_interaccion.sql` | Tabla `sig_proceso_interaccion` + seed de 12 pasos (Mapa de Interacción del Proceso): intervención armónica LIP↔cliente en LIPgo, con responsable, acción, evidencia/soporte (PDF), campo y requisito ISO. Pasos del cliente = valor agregado de LIP. Módulo "Mapa de Interacción del Proceso" → permiso `sig_matriz`. | ⬜ |
| — | **(sin SQL)** Panel LIP · Inventario (Exactitud) | No requiere SQL: usa `invtrans`, `reprocesos` y `saldoinvdetalle` existentes. Diferencia de inventario = saldo teórico (entradas−salidas, traslados entre sedes cuentan, ubicación↔ubicación no) − saldo físico (saldoinvdetalle). Merma de proceso = reprocesos (aparte). Por año y mes, por cliente. Módulo "Panel LIP Inventario" → `sig_matriz`. | ✅ (solo código) |
| 14 | `14_inventario_cuadre.sql` | Tablas `sig_inventario_cuadre` (+`_detalle`) y `sig_inventario_ajuste` (estilo SAP B1): persiste el conteo físico vs sistema (saldoinvdetalle), documenta diferencias y genera ajustes contabilizados. Por cliente/sitio. Sin seed. Módulo "Cuadre de Inventario" (en **Almacenamiento**) → `sig_matriz`. | ⬜ |
| 17 | `17_tipos_movimiento.sql` | Catálogo `sig_tipos_movimiento` (nomenclatura **LIPgo**: 101 recepción, 601 despacho, 311 traslado, 701/702 ajuste, 561 inicial, 551 merma) + seed (7). Columna `codigo`. Se ve en Panel Inventario y en **Cuadre de Inventario → "Tipos de movimiento"**. | ⬜ |
| 18 | `18_invtrans_cod_movimiento.sql` | Agrega **`invtrans.cod_movimiento`**, lo **backfillea hacia atrás** según origen/tipomov y crea **trigger** para los movimientos nuevos. Así cada movimiento queda identificado por su código. (Tabla operativa; columna nullable + trigger no intrusivo.) | ⬜ |
| 16 | `16_acta_inventario.sql` | Columnas de **firma del cliente** en `sig_inventario_cuadre` (cliente_firmante, cliente_cargo, fecha_firma, firmado, acta_observaciones) → Acta de Revisión de Inventario para auditoría (el cliente firma cada 1 de mes). Idempotente (ADD COLUMN IF NOT EXISTS). | ⬜ |
| 15 | `15_satisfaccion_pqrsf.sql` | Tablas `sig_satisfaccion` (encuestas cliente/conductor 1-5, alimenta IND-G-01/G-02) y `sig_pqrsf` (peticiones/quejas/reclamos/sugerencias/felicitaciones). Por cliente/sitio. Sin seed. Módulo "Satisfacción y PQRSF" (en Certificaciones·SIG) → `sig_matriz`. | ⬜ |
| 23 | `23_ausentismo_vivo.sql` | Conecta IND-GH-02 (Ausentismo) al cálculo en vivo `gh_ausentismo` (días incapacidad de `ausentismosst` / días-hombre según planta). Hoy solo hay datos de Indupan en ausentismosst; los demás proyectos requieren carga. Planta real por proyecto en `lib/sla-acordados.ts`. | ⬜ |
| 22 | `22_indicadores_sla_vivo.sql` | Conecta a cálculo **EN VIVO** los indicadores de servicio tras definir los SLA reales: IND-CD-07 (SLA de tiempos = despachos dentro del tiempo acordado por tipo de vehículo, vía cabeceraoc+citasvehiculos), IND-GH-04 (cobertura = activos/planta acordada), IND-G-06 (nivel de servicio global = promedio). Amarra IND-G-06/CD-06/AI-03 al objetivo de satisfacción. SLA en `lib/sla-acordados.ts`. | ⬜ |
| 21 | `21_claves_movimiento.sql` | **Claves de responsable para mover inventario.** Tabla `inv_clave_movimiento` (responsable + clave + activo) + seed clave **2323** (Gerencia General). El registro de movimientos (Transacciones de Inventario) valida la clave: si hay claves activas la EXIGE, si la tabla no existe/no hay claves queda libre. Agregar más responsables con INSERT. | ⬜ |
| 20 | `20_indicadores_bsc.sql` | **Balanced Scorecard / cerebro del SIG.** Columnas BSC en `sig_indicadores` (`perspectiva`, `area`, `finalidad`, `cliente_interno`, `cliente_externo`, `contribucion`, `objetivo_id`) + backfill (área desde proceso, perspectiva, cliente externo) + enriquecimiento de los 15 indicadores + **5 indicadores propios del servicio LIP** (Nivel de servicio global SLA, Cumplimiento de meta de tonelaje [en vivo], SLA de tiempos, ERI cuadre, Cobertura de personal) + **amarre a objetivos** (`objetivo_id`). Idempotente. | ⬜ |
| 19 | `19_ajuste_inventario_campos.sql` | Campos en `sig_inventario_ajuste` para el **formulario de corrección guiado + aprobación + cierre operativo**: `location` (ubicación config LIPgo), `direccion` (ingreso/salida), `cod_movimiento` (código de transacción de la nomenclatura), `aprobado_por` + `aprobado_fecha` (aprobación), **`invtrans_id`** (enlaza el movimiento real generado al aprobar → mueve stock; evita doble conteo). Backfill de dirección/código en históricos. Idempotente. | ⬜ |

> **Ubicación de módulos (2026-06-28):** los paneles operativos viven en su módulo: Panel LIP Inventario + Cuadre de Inventario → **Almacenamiento**; Panel LIP Operación → **Gestión LIP**; Panel LIP Gestión Humana → **Gestión Humana**. En **Certificaciones** (módulo único) quedan solo los artefactos del SIG (Dashboard SIG, DOFA, Matriz, Repositorio, Objetivos, NC, Indicadores, Mapa de Interacción, Satisfacción/PQRSF + ISO 9001/14001/45001). Todos siguen con permiso `sig_matriz` (grantable en Gestión de Usuarios).

> **Inventario operativo (2026-06-28):** "Panel de Inventario" y "Cuadre y Correcciones" pasaron a ser **operativos** (no solo SIG): ahora se gobiernan con el permiso operativo **`auditoria_inventario`** (no `sig_matriz`). Las **correcciones mueven stock real**: al aprobar una corrección (o **Cerrar mes**), LIPgo genera el movimiento en **`invtrans`** (faltante=Salida/702, sobrante=Entrada/701, avería=Reproceso/551) y el trigger de la base recalcula `saldoinvdetalle`/`invglobal` → físico = sistema. **Asegúrate de tener `auditoria_inventario = true`** o los módulos no aparecerán:
> ```sql
> update public.permisos_usuarios set auditoria_inventario = true
>  where usuario_id in (select id from auth.users where email = 'gerenciageneral@lip-sas.com');
> ```

> Es **todo** lo que hay que correr en Supabase. El resto de los cambios del SIG
> (tipos, server actions, UI, cableado de menú y permisos) son código y NO requieren SQL.

_(se irán agregando filas a medida que avancemos por bloques)_

> **SQL 20 a 48 (tracker al día):** esta tabla llega hasta el bloque 23; el estado
> completo y actualizado de los scripts **20-48** está en `ESTADO_PROYECTO_SIG.md` §3.
> **Pendiente real por correr ahora: `48_cierre_firma_digital.sql`** (firma digital del
> acta de cierre de inventario; luego firmar las actas mes a mes). Opcionales/pausados:
> `36_cierre_facturacion_historica.sql` (opcional) y `46_cierre_fisico_congelado.sql`
> (**PAUSADO** — no correr aún). **44 = OBSOLETO, NO EJECUTAR.**

## Verificación rápida (opcional, tras correr el 01)
```sql
select (select count(*) from sig_normas)            as normas,        -- 3
       (select count(*) from sig_requisitos)         as requisitos,    -- 37
       (select count(*) from sig_requisito_norma)    as evidencias;    -- 111
```

## Otorgar acceso al módulo (tras correr el 01)
El módulo "Matriz Integrada SIG" requiere permiso (por eso no aparece en el menú
hasta activarlo). `usuario_id` en `permisos_usuarios` es el id del usuario de
auth. Para activártelo a ti por correo:
```sql
update public.permisos_usuarios
   set sig_matriz = true,
       sig_iso9001 = true,
       sig_iso14001 = true,
       sig_iso45001 = true
 where usuario_id in (
   select id from auth.users where email = 'gerenciageneral@lip-sas.com'
 );
```
Si devuelve "0 rows", es que ese usuario aún no tiene fila en `permisos_usuarios`.
Para activárselo a TODOS los usuarios (útil en pruebas):
```sql
update public.permisos_usuarios
   set sig_matriz = true, sig_iso9001 = true, sig_iso14001 = true, sig_iso45001 = true;
```
> `sig_matriz` abre el módulo (matriz integrada general). Cada `sig_iso*`
> habilita la pestaña de esa norma (acceso por responsabilidad).
> Tras el UPDATE: **recarga la página** (Ctrl+Shift+R) — el sidebar relee permisos al cargar.

---

## Pendiente de correr (al 2026-10-04)

| # | Archivo | Qué hace | ¿Ejecutado? |
|---|---------|----------|-------------|
| 63 | `63_orden_vs_salidas.sql` | **Conciliación del DESPACHO.** Vista `v_orden_vs_salidas`: cruza lo que la **orden de cargue autorizó** (`detalleoc`, solo `tipooperacion = 'Cargue'`) contra lo que **salió del inventario** (`invtrans`, movimiento 601 aprobado). Estados `CUADRA` · `SALIO_MAS` · `FUERA_DE_LA_ORDEN` · `SALIO_MENOS` · `SIN_SALIDA`. Es la medición que pidió gerencia: puede salir menos (merma en el cargue, se muestra) pero **nunca más**. Excluye Tolva (es producción), Descargue, Distribución, proyección y el movimiento 702 (salida de material). La alimenta la pestaña **"Orden de cargue vs salidas"** de Almacenamiento › Exactitud. Es una VISTA: no tiene datos y no toca inventario. | ⬜ |

> La numeración de esta carpeta tiene números repetidos de arrastre (44, 45, 46, 48, 51, 52).
> El `48_cierre_firma_digital.sql` es otro script y no tiene relación con el 63.
