# Inventario de módulos — LIPgo

Recorrido completo del repositorio. Todos los datos de este documento —nombre, ruta, permiso, tablas y documentos— fueron **extraídos del código**, no redactados de memoria:

- El **árbol de áreas, grupos y módulos** sale de `lib/dashboard-data.ts`, que es lo que construye el menú.
- La **ruta del archivo** sale del enrutador de `components/main-content.tsx`.
- El **permiso** sale de `MODULE_PERMISSION_MAP` en `lib/permissions-map.ts`.
- Las **tablas** salen de las llamadas `.from("tabla")` del componente y de sus dependencias directas (un nivel: sus acciones de servidor y rutas API). Se clasifica como *escritura* si la llamada lleva `insert`, `update`, `upsert` o `delete`.

> **Cómo leer las tablas.** Cuando un módulo importa una biblioteca compartida grande —por ejemplo `orders-actions`— hereda en la lista todas las tablas que esa biblioteca toca, no solo las que el módulo usa. Los casos afectados son los de Recepción y Despacho, Pedidos y SIG, donde varias entradas comparten lista. Se dejó así por fidelidad: es lo que el código realmente alcanza.

> Los módulos que no se pudieron determinar con certeza están marcados **Requiere revisión**.

## Índice

- [Recepción y Despacho](#recepción-y-despacho) — 12 módulos
- [Gestión de Pedidos](#gestión-de-pedidos) — 4 módulos
- [Almacenamiento](#almacenamiento) — 12 módulos
- [Producción](#producción) — 11 módulos
- [Torre de Control](#torre-de-control) — 2 módulos
- [Operación LIP](#operación-lip) — 18 módulos
- [Gestión Financiera](#gestión-financiera) — 11 módulos
- [Gestión Humana](#gestión-humana) — 25 módulos
- [Compensación](#compensación) — 7 módulos
- [Certificaciones · SIG (Calidad · Ambiente · SST)](#certificaciones-·-sig-calidad-·-ambiente-·-sst) — 15 módulos
- [Seguridad y Salud en el Trabajo (SST)](#seguridad-y-salud-en-el-trabajo-sst) — 20 módulos
- [Configuración](#configuración) — 16 módulos
- [MRP](#mrp) — 6 módulos
- [Lista completa de permisos](#lista-completa-de-permisos)
- [Vistas y funciones de base de datos por área](#vistas-y-funciones-de-base-de-datos-por-área)


---

## Recepción y Despacho

**12 módulos.**


### Órdenes y Recepción


#### Generar Órdenes de Cargue

Convierte pedidos aprobados en órdenes de servicio. Crea la cabecera y el detalle de la orden, reserva el vehículo contra su cita y descuenta el inventario comprometido. Genera el PDF de la orden con el detalle de producto, lote y cliente, y lo deja en el storage. Es el punto donde nace el documento del que después dependen la facturación y la liquidación de nómina.

- **Archivo:** `components/generate-load-orders.tsx`
- **Permiso:** `generar_ordenes_cargue`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `historialaprobaciones`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `qrestibacabecera`, `qrestibadetalle`, `registrosanitario`, `reprocesos`, `traslados`
- **Lee de:** `almacenes`, `archivos`, `bodegas`, `categorias`, `clientes`, `condicionespago`, `despachotraslados`, `destinos`, `empresas`, `empresas_permisos`, `historicolotes`, `indicativo`, `invglobal`, `locations`, `medio`, `owners`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `saldoinvdetalle`, `tipodespacho`, `tiposvehiculos`, `transportes`, `usuariocartera`, `vendedores`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel · archivos en almacenamiento

#### Generar Órdenes de Descargue

Crea órdenes de descargue para recepción de producto, incluidas las que vienen de traslados entre bodegas. Permite capturar el lote por producto en el momento de generar la orden. Produce el PDF de la orden de descargue.

- **Archivo:** `components/generate-unload-orders.tsx`
- **Permiso:** `generar_ordenes_descargue`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `transportes`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

#### Generar Orden de Distribución

Genera órdenes de distribución, tanto manuales como el clon automático que se crea al cerrar un cargue con vehículo propio. Excluye clientes configurados como no aplicables y valida que la placa esté registrada como propia del proyecto.

- **Archivo:** `components/generate-distribution-orders.tsx`
- **Permiso:** `distribucion`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `transportes`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

#### Gestión de Ordenes

Consulta, edición y anulación de órdenes ya generadas, con su documento asociado. Permite reimprimir el PDF y corregir datos de la orden antes de su cierre. Al borrar una orden de cargue elimina en cascada sus clones automáticos de distribución.

- **Archivo:** `components/load-orders-management.tsx`
- **Permiso:** `gestion_ordenes`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `usuariocartera`, `vendedores`
- **Genera:** PDF · Excel · archivos en almacenamiento

#### Recepción de Traslado

Recibe traslados provenientes de otra bodega y genera el ingreso correspondiente a inventario, conservando el lote de la bodega de origen. El ingreso queda pendiente de aprobación en el módulo de producción.

- **Archivo:** `components/transfer-requests-view.tsx`
- **Permiso:** `ver_solicitudes_traslado`
- **Escribe en:** `cabeceraoc`, `detalleoc`, `pedidoscabecera`, `pedidosdetalle`, `traslados`
- **Lee de:** `despachotraslados`, `empresas`, `invglobal`, `productos`
- **Genera:** PDF

#### Dashboard Despachos/Recepción

Tablero de la operación diaria de despacho y recepción: órdenes por estado, vehículos atendidos y avance del día. Solo lectura, sin escritura en base de datos.

- **Archivo:** `components/dashboard-recepcion.tsx`
- **Permiso:** `dashboardrecepcion`
- **Escribe en:** —
- **Lee de:** —

### Vehículos y Portería


#### Registrar Vehículos

Registra la cita del vehículo con su placa, conductor, transportadora y hora prevista. Es el paso previo que habilita la orden de cargue o descargue.

- **Archivo:** `components/vehicle-appointments-form.tsx`
- **Permiso:** `registrar_vehiculos`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `pedidoscabecera`, `pedidosdetalle`
- **Lee de:** `bodegas`, `categorias`, `clientes`, `condicionespago`, `destinos`, `detalleoc`, `empresas`, `medio`, `owners`, `perfil_acceso_empresas`, `productos`, `tipodespacho`, `tiposvehiculos`, `transportes`, `vendedores`
- **Genera:** PDF

#### Ver Vehículos

Consulta y edición de las citas de vehículos registradas. Se resuelve con la tabla genérica de configuración sobre `citasvehiculos`.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `ver_vehiculos`
- **Escribe en:** —
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `citasvehiculos`, `clientes`, `destinos`, `empresas_permisos`, `locations`, `materiales`, `owners`, `productos`, `proveedores`, `subcategorias`, `tarifas`, `tipodespacho`, `tiposvehiculos`, `transportes`

#### Registro sanitario

Registra la inspección sanitaria del vehículo antes de cargar, con su lista de verificación y resultado. Deja evidencia en `registrosanitario` y genera el documento de la inspección.

- **Archivo:** `components/sanitary-registry-form.tsx`
- **Permiso:** `registro_sanitario`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

#### Ver historial de Inspección

Consulta el histórico de inspecciones sanitarias por vehículo y fecha, con acceso al documento generado en cada una.

- **Archivo:** `components/sanitary-inspection-history.tsx`
- **Permiso:** `ver_historial_inspeccion`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

### Báscula


#### Báscula

Registra el pesaje del vehículo y su tiquete de báscula sobre la orden. El peso registrado es el que manda para facturar en las plantas, y se sincroniza con el clon de distribución cuando la placa es propia.

- **Archivo:** `components/bascula-form.tsx`
- **Permiso:** `bascula`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

#### Historial Báscula

Consulta histórica de pesajes con toneladas por producto y la diferencia contra el detalle de la orden. Solo lectura sobre `cabeceraoc`.

- **Archivo:** `components/bascula-history.tsx`
- **Permiso:** `historial_bascula`
- **Escribe en:** `cabeceraoc`
- **Lee de:** `detalleoc`, `invtrans`
- **Genera:** Excel

---

## Gestión de Pedidos

**4 módulos.**


#### Entrada de pedidos

Captura el pedido del cliente: sucursal, productos, cantidades y condiciones de despacho. El listado de clientes se filtra por el proyecto activo. Es el origen de la cadena que termina en orden de cargue.

- **Archivo:** `components/order-entry-form.tsx`
- **Permiso:** `entrada_pedidos`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `bodegas`, `categorias`, `clientes`, `condicionespago`, `despachotraslados`, `destinos`, `empresas`, `empresas_permisos`, `historicolotes`, `indicativo`, `medio`, `owners`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `tipodespacho`, `tiposvehiculos`, `transportes`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

#### Gestionar pedidos

Seguimiento y edición del pedido hasta su conversión en orden. Permite anular con clave de autorización; al eliminar una orden de cargue el pedido vuelve al estado aprobado.

- **Archivo:** `components/orders/orders-management.tsx`
- **Permiso:** `gestionar_pedidos`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `bodegas`, `categorias`, `clientes`, `condicionespago`, `despachotraslados`, `destinos`, `empresas`, `empresas_permisos`, `historicolotes`, `indicativo`, `medio`, `owners`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `tipodespacho`, `tiposvehiculos`, `transportes`, `usuariocartera`, `vendedores`
- **Genera:** PDF · Excel · archivos en almacenamiento

#### Gestión integral de pedidos

Vista consolidada del pedido con todo su recorrido: estado, orden asociada, despacho y documentos. Pensada para resolver consultas sin abrir varios módulos.

- **Archivo:** `components/orders/comprehensive-orders-management.tsx`
- **Permiso:** `gestion_integral_pedidos`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `bodegas`, `categorias`, `clientes`, `condicionespago`, `despachotraslados`, `destinos`, `empresas`, `empresas_permisos`, `historicolotes`, `indicativo`, `medio`, `owners`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `tipodespacho`, `tiposvehiculos`, `transportes`, `usuariocartera`, `vendedores`
- **Genera:** PDF · Excel · archivos en almacenamiento

#### Dashboard Pedidos

Tablero de estado y avance de pedidos del proyecto activo. Solo lectura.

- **Archivo:** `components/orders/dashboard-pedidos.tsx`
- **Permiso:** `dashboardpedidos`
- **Escribe en:** —
- **Lee de:** `pedidoscabecera`, `pedidosdetalle`, `perfil_acceso_empresas`, `perfil_acceso_owners`

---

## Almacenamiento

**12 módulos.**


### Gestión inventario


#### Transacciones de Inventario

Módulo central de movimientos de inventario, con dos modos: por código de transacción (estilo SAP, donde el código habilita solo los campos de ese movimiento) y clásico guiado por bodega, localización, producto y lote. Muestra el saldo disponible, reservado y total del artículo en su ubicación antes de confirmar. Cada corrección queda registrada en `inv_correcciones_log`.

- **Archivo:** `components/inventory-transactions-module.tsx`
- **Permiso:** `transacciones_inventario`
- **Escribe en:** `inv_correcciones_log`, `invtrans`, `reprocesos`
- **Lee de:** `inv_clave_movimiento`, `locations`, `productos`, `saldoinvdetalle`, `sig_tipos_movimiento`
- **Genera:** Excel · captura por cámara

#### Saldos de inventario

Detalle de saldos por producto, lote y localización, con la edad del lote en días calculada desde la fecha que codifica el propio lote. Exporta a Excel con la misma información que muestra en pantalla.

- **Archivo:** `components/inventory-balance-details.tsx`
- **Permiso:** `saldos_inventario`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `clientes`, `destinos`, `invglobal`, `locations`, `owners`, `productos`, `saldoinvdetalle`, `subcategorias`, `tarifas`, `tipodespacho`, `tiposvehiculos`, `transportes`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

#### Saldos por producto

Consolidado de existencias por producto, sin desagregar por lote ni ubicación. Oculta los productos con saldo final en cero.

- **Archivo:** `components/inventory-balance-global.tsx`
- **Permiso:** `saldos_producto`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `clientes`, `destinos`, `invglobal`, `locations`, `owners`, `productos`, `saldoinvdetalle`, `subcategorias`, `tarifas`, `tipodespacho`, `tiposvehiculos`, `transportes`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

#### Traslados de producto

Ejecuta traslados entre bodegas y entre localizaciones, generando los movimientos de salida y entrada correspondientes.

- **Archivo:** `components/product-transfer-form.tsx`
- **Permiso:** `traslados_producto`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `invglobal`, `locations`, `productos`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel · captura por cámara

#### Gestión de transacciones

Consulta y corrección de movimientos de inventario ya registrados, con su historial de correcciones. Requiere clave para los movimientos manuales.

- **Archivo:** `components/inventory-transactions-management.tsx`
- **Permiso:** `gestion_transacciones`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `invglobal`, `locations`, `productos`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

#### Capacidad Bodega

Muestra la ocupación por localización dentro de cada bodega, para identificar espacio disponible.

- **Archivo:** `components/warehouse-capacity.tsx`
- **Permiso:** `capacidad_bodega`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `invglobal`, `locations`, `productos`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

#### Montacargas y personal día

Registro diario de montacargas y personal disponible en la operación. Escribe en `montacargasdia`.

- **Archivo:** `components/inventario/montacargas-dia.tsx`
- **Permiso:** `montacargasdia`
- **Escribe en:** `montacargasdia`
- **Lee de:** `registroasistencia`
- **Genera:** Excel

#### Panel LIP Inventario

*En el menú aparece como «Panel de Inventario (Exactitud y movimientos)».*

Panel de indicadores de inventario del SIG: exactitud, movimientos del período y diferencias detectadas. Alimenta el cuadro de mando.

- **Archivo:** `components/sst/panel-inventario-lip.tsx`
- **Permiso:** `auditoria_inventario`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `archivos`, `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`
- **Genera:** PDF · archivos en almacenamiento

#### Cuadre de Inventario

*En el menú aparece como «Cuadre y Correcciones (Cierre mensual)».*

Cierre mensual de inventario por lote: acta de cruce, físico congelado, ajustes reales y kardex de movimientos con saldo corrido. Es el módulo que concilia el inventario del sistema contra el conteo físico.

- **Archivo:** `components/sst/cuadre-inventario.tsx`
- **Permiso:** `auditoria_inventario`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`
- **Genera:** PDF

#### Auditoría de Inventario

Conteo cíclico y auditoría de un producto o ubicación, con alerta de vencimiento y de diferencia contra el saldo del sistema.

- **Archivo:** `components/inventory-audit.tsx`
- **Permiso:** `auditoria_inventario`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `invglobal`, `locations`, `productos`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

### Asignación de Lotes


#### Asignación de Lotes

Asigna qué lotes se despachan en una orden de cargue, con su cantidad. Escribe en `historicolotes` y genera el documento de asignación. Es lo que da trazabilidad del lote hacia el cliente.

- **Archivo:** `components/batch-approval.tsx`
- **Permiso:** `asignacion_lotes`
- **Escribe en:** `cabeceraoc`, `historicolotes`, `invtrans`
- **Lee de:** `clientes`, `detalleoc`, `saldoinvdetalle`
- **Genera:** PDF

#### Historial de lotes

Consulta del histórico de asignaciones de lote por orden, producto y cliente.

- **Archivo:** `components/batch-history.tsx`
- **Permiso:** `historial_lotes`
- **Escribe en:** `cabeceraoc`, `historicolotes`, `invtrans`
- **Lee de:** `clientes`, `detalleoc`, `saldoinvdetalle`
- **Genera:** PDF · Excel

---

## Producción

**11 módulos.**


#### Ingreso de Producción

Registra la producción terminada que entra a inventario, de forma manual o automática desde el sistema de planta. Distingue producción propia de producción de terceros, que genera inventario pero nunca llega a facturación. El ingreso nace pendiente de aprobación.

- **Archivo:** `components/production-entry-form.tsx`
- **Permiso:** `ingreso_produccion`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `invglobal`, `locations`, `productos`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

#### Tolva

Registra la operación de tolva como orden de servicio, con su personal y toneladas. Es la vía por la que el descargue a granel se convierte en un documento facturable y liquidable.

- **Archivo:** `components/tolva.tsx`
- **Permiso:** `tolva`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `headcount`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

#### Ver Tolva

Consulta de las órdenes de tolva generadas, con su detalle de producto y toneladas.

- **Archivo:** `components/ver-tolva.tsx`
- **Permiso:** `ver_tolva`
- **Escribe en:** `cabeceraoc`, `detalleoc`
- **Lee de:** `headcount`, `productos`

#### Ver ingresos de producción

Listado de los ingresos de producción registrados, incluidos los pendientes de los centros de distribución, con paginación completa.

- **Archivo:** `components/production-entries-view.tsx`
- **Permiso:** `ver_ingresos_produccion`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `cabeceraoc`, `detalleoc`, `headcount`, `invglobal`, `locations`, `productos`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

#### Aprobación de ingreso de producción

Aprueba los ingresos de producción para que impacten el saldo disponible y entren a la liquidación. Sin esta aprobación la producción queda registrada pero no disponible ni liquidable.

- **Archivo:** `components/production-approval.tsx`
- **Permiso:** `aprobacion_produccion`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `empresas`, `invglobal`, `locations`, `productos`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

#### Liquidación Tolva del día

Toma las toneladas aprobadas del día y las reparte entre Turno 1 y Turno 2 según el horario de tolva configurado, generando la orden de servicio de cada turno con un clic. Solo considera producción con `creadopor = LOGO`. Incluye una pestaña de auditoría que cruza pago, cobro y entrega real.

- **Archivo:** `components/produccion/liquidacion-tolva.tsx`
- **Permiso:** `liquidacion_tolva`
- **Escribe en:** `cabeceraoc`, `detalleoc`, `invtrans`
- **Lee de:** `productos`, `registroasistencia`, `tarifasoperacion`, `tarifaspersonal`

#### Dashboard de Producción

Control de piso en tiempo real: velocidad de producción cada 2 minutos acotada al horario de tolva, cobertura del turno, cumplimiento hora a hora, cronómetro de inactividad, disponibilidad y OEE. Lee el contador de la máquina desde `historial_intervalos`.

- **Archivo:** `components/produccion/control-piso.tsx`
- **Permiso:** `controlpiso`
- **Escribe en:** `horario_tolva`, `paros_produccion`
- **Lee de:** `bodegas`, `historial_intervalos`, `produccion`, `productos`, `registroasistencia`, `vw_produccion_agrupada_10m`, `vw_produccion_dashboard`

#### Reporte de Paros

Detecta automáticamente los paros de línea a partir del contador de la máquina y permite al supervisor justificarlos. Escribe en `paros_produccion` y esos comentarios se reflejan en la cobertura del turno.

- **Archivo:** `components/produccion/reporte-paros.tsx`
- **Permiso:** `controlpiso`
- **Escribe en:** `paros_produccion`
- **Lee de:** `historial_intervalos`, `registroasistencia`

#### Historial Aprobaciones

Consulta del histórico de aprobaciones de ingreso de producción, con quién aprobó y cuándo.

- **Archivo:** `components/approval-history.tsx`
- **Permiso:** `historial_aprobaciones`
- **Escribe en:** `cabeceraoc`, `historicolotes`, `invtrans`
- **Lee de:** `clientes`, `detalleoc`, `saldoinvdetalle`
- **Genera:** PDF · Excel

#### Reprocesos

Gestiona el producto que vuelve a proceso: registra la salida del producto original y la entrada del reprocesado.

- **Archivo:** `components/reprocesos-management.tsx`
- **Permiso:** `reprocesos`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `invglobal`, `locations`, `productos`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

#### Servicios Adicionales

Solicitudes de servicio fuera del alcance normal del contrato, con las horas requeridas por el cliente. Al programar varias personas reparte las horas solicitadas entre ellas.

- **Archivo:** `components/solicitud-turnos.tsx`
- **Permiso:** `solicitudturnos`
- **Escribe en:** `solicitudesturnos`
- **Lee de:** `archivos`, `empresas_permisos`, `tarifasfacturacionturnos`
- **Genera:** Excel

---

## Torre de Control

**2 módulos.**


#### Dashboard Operacion

Tablero consolidado de la operación del día. Es un contenedor que muestra la vista diaria o la vista gerencial según la configuración activa; los datos los traen los componentes que envuelve.

- **Archivo:** `components/dashboard-operacion.tsx`
- **Permiso:** `dashboard_operacion`
- **Escribe en:** —
- **Lee de:** —

#### Asistente IA

Asistente conversacional (LIPbot) que responde preguntas sobre los datos del sistema en lenguaje natural, consulta indicadores y puede ejecutar acciones operativas puntuales previa confirmación explícita del usuario. Opera contra la ruta `/api/chat` sobre modelos de Anthropic.

- **Archivo:** `components/asistente-ia.tsx`
- **Permiso:** `asistenteia`
- **Escribe en:** —
- **Lee de:** —
- **Genera:** respuesta de modelo de lenguaje

---

## Operación LIP

**18 módulos.**


### Operación Lip


#### Picking

Alistamiento de la orden en piso: valida lo alistado contra el detalle del pedido, permite trabajar con o sin lectura de QR, asigna el personal que ejecuta y captura fotos. Permite pausar y reanudar la operación, registrando el tiempo de paro en `pausas`. Escribe los movimientos de salida en `invtrans` y cierra con el PDF de picking.

- **Archivo:** `components/picking.tsx`
- **Permiso:** `picking`
- **Escribe en:** `cabeceraoc`, `invtrans`, `pausas`, `qrestibadetalle`
- **Lee de:** `archivos`, `detalleoc`, `registroasistencia`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · archivos en almacenamiento · captura por cámara

#### Packing

Verificación de lo alistado antes del despacho, con asignación de personal y captura de fotografías. El cargue de fotos es el paso que cierra la orden escribiendo `fincargue`, que es lo que dispara facturación y liquidación. También permite pausar y reanudar.

- **Archivo:** `components/packing.tsx`
- **Permiso:** `packing`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `facturar_registro`, `invtrans`, `pausas`, `pedidoscabecera`, `pedidosdetalle`, `qrestibadetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `registroasistencia`, `saldoinvdetalle`, `usuariocartera`, `vendedores`, `view_inventario_por_estiba`
- **Genera:** PDF · archivos en almacenamiento · captura por cámara

#### Ver Picking/Packing

Consulta del estado de picking y packing por orden, con sus fotos y personal asignado. Solo lectura.

- **Archivo:** `components/view-picking.tsx`
- **Permiso:** `ver_picking`
- **Escribe en:** —
- **Lee de:** `cabeceraoc`

#### Registro de QR estibas

Genera e imprime el código QR de una estiba, asociándolo a su producto, lote, cantidad y ubicación. Es lo que permite después mover la estiba completa con un escaneo.

- **Archivo:** `components/qr-pallet-registration.tsx`
- **Permiso:** `registro_qr_estibas`
- **Escribe en:** `historialaprobaciones`, `invtrans`, `produccion`, `qrestibacabecera`, `qrestibadetalle`, `reprocesos`
- **Lee de:** `almacenes`, `bodegas`, `invglobal`, `locations`, `productos`, `saldoinvdetalle`, `view_inventario_por_estiba`
- **Genera:** PDF · Excel

#### Lectura de QR estibas

Lee el QR de una estiba con la cámara o por digitación y muestra su contenido: producto, lote, ubicación y stock. Consulta a través de la ruta API de inventario.

- **Archivo:** `components/qr-pallet-reading.tsx`
- **Permiso:** `lectura_qr_estibas`
- **Escribe en:** —
- **Lee de:** `view_inventario_por_estiba`
- **Genera:** captura por cámara

#### Inventario por Estiba

Inventario visto por estiba en lugar de por producto: qué hay en cada estiba, dónde está y cuánto le queda.

- **Archivo:** `components/pallet-inventory-view.tsx`
- **Permiso:** `inventario_estiba`
- **Escribe en:** `invtrans`, `produccion`, `qrestibacabecera`, `qrestibadetalle`
- **Lee de:** `bodegas`, `locations`, `productos`, `view_inventario_por_estiba`
- **Genera:** PDF

#### Dashboard Operaciones LIP

Contenedor de las vistas de operación diaria e histórica de LIP. Los datos los traen los componentes que envuelve.

- **Archivo:** `components/dashboard-operaciones-lip.tsx`
- **Permiso:** `dashboardop`
- **Escribe en:** —
- **Lee de:** —

#### Panel LIP Operación

*En el menú aparece como «Tablero del Coordinador».*

Tablero del coordinador: cumplimiento contra metas, SLA por sitio con su ajuste para centros de distribución, y toneladas movidas. Alimenta la evaluación del coordinador en el SIG.

- **Archivo:** `components/sst/panel-operacion-lip.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Control de Toneladas

Reporte de toneladas movidas por día, proyecto y persona, con el puesto programado y los vehículos atendidos. Consulta a través de sus propias acciones de servidor.

- **Archivo:** `components/control-toneladas.tsx`
- **Permiso:** `control_toneladas`
- **Escribe en:** —
- **Lee de:** `cabeceraoc`, `headcount`, `registroasistencia`

#### Gestión de Facturas

Control de las facturas emitidas y su amarre con el número de factura de Siigo, incluido el amarre por rango de órdenes. Filtra por transportadora y excluye las órdenes marcadas como no facturables.

- **Archivo:** `components/gestion-facturas.tsx`
- **Permiso:** `gestionfacturas`
- **Escribe en:** `cabeceraoc`, `prefacturas`
- **Lee de:** `archivos`, `facturacion`, `tarifasoperacion`
- **Genera:** Excel · archivos en almacenamiento

#### Satisfacción y PQRSF

*En el menú aparece como «Satisfacción y PQRSF (conductores y cliente)».*

Captura peticiones, quejas, reclamos y sugerencias de clientes y conductores, con su tratamiento dentro del SIG. Corresponde al numeral 9.1.2 de la norma.

- **Archivo:** `components/sst/satisfaccion-pqrsf.tsx`
- **Permiso:** `satisfaccion_pqrsf`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Calificación del Conductor

*En el menú aparece como «Calificación del Conductor (en caliente)».*

Evaluación inmediata del servicio al finalizar, diligenciada por el conductor. Escribe en `sig_satisfaccion` y alimenta el indicador de satisfacción.

- **Archivo:** `components/sst/calificacion-conductor.tsx`
- **Permiso:** `calificacion_conductor`
- **Escribe en:** `permisos_usuarios`, `sig_satisfaccion`
- **Lee de:** `cabeceraoc`, `citasvehiculos`, `empresas`, `profiles`

#### Aprobar Turnos

Aprueba las solicitudes de turno del personal, con nombre y firma del aprobador. Genera el PDF de los turnos aprobados con el total de la solicitud.

- **Archivo:** `components/aprobar-turnos.tsx`
- **Permiso:** `aprobacionturnos`
- **Escribe en:** `headcount`, `solicitudesturnos`
- **Lee de:** `archivos`, `empresas_permisos`, `tarifasfacturacionturnos`
- **Genera:** PDF

#### Bitácora

Registro libre de novedades de la operación por parte del coordinador, con fecha y responsable.

- **Archivo:** `components/lip/bitacora.tsx`
- **Permiso:** `bitacora`
- **Escribe en:** `bitacora`
- **Lee de:** —
- **Genera:** archivos en almacenamiento

#### Solicitud de Personal

Solicitud formal de personal nuevo para un proyecto, que abre el ciclo de selección.

- **Archivo:** `components/rrhh/solicitud-de-personal.tsx`
- **Permiso:** `solicitud_personal`
- **Escribe en:** `capacitaciones`, `capacitaciones_asistencia`, `colaboradores`, `colaboradores_th`, `contratos`, `dotacion_epp`, `headcount`, `vacantes`
- **Lee de:** `antecedentes`, `archivos`, `examenes_medicos`, `owners`
- **Genera:** archivos en almacenamiento

#### Programación de turnos

*En el menú aparece como «Programación de Turnos».*

Programa a futuro a las personas activas en una fecha y puesto, incluida la doble jornada del Auxiliar Mixto (Turno 1 y Turno 2 en el mismo día). Deriva la bandera de especialidad desde `tarifasturnos` en el servidor. Incluye la configuración del horario de tolva por día y turno.

- **Archivo:** `components/rrhh/programacion-turnos.tsx`
- **Permiso:** `programacionturnos`
- **Escribe en:** `horario_tolva`, `registroasistencia`
- **Lee de:** `asistencia`, `headcount`, `tarifasturnos`

#### Registro de asistencia

*En el menú aparece como «Registro de Asistencia».*

Marcación de entrada y salida por cédula con fotografía obligatoria tomada por cámara: sin foto no se registra la marcación. Escribe el evento en `asistencia` y sincroniza la hora y la foto en `registroasistencia`. Trabaja siempre en hora de Colombia.

- **Archivo:** `components/attendance-registration.tsx`
- **Permiso:** `registro_asistencia`
- **Escribe en:** `asistencia`, `registroasistencia`
- **Lee de:** `headcount`
- **Genera:** captura por cámara

#### Notificaciones al Personal

*En el menú aparece como «Notificaciones al Personal (WhatsApp)».*

Envío de notificaciones al personal por WhatsApp mediante la API de Meta. Mientras la integración esté deshabilitada opera en modo prueba: registra el envío en `notificaciones_enviadas` sin llamar al proveedor.

- **Archivo:** `components/rrhh/notificaciones-personal.tsx`
- **Permiso:** `notificaciones`
- **Escribe en:** `notificaciones_enviadas`
- **Lee de:** `citasvehiculos`, `headcount`, `hojas_de_vida`, `registroasistencia`

---

## Gestión Financiera

**11 módulos.**


### Facturación


#### Indicador de Facturación por Proyectos

Indicador de cumplimiento de facturación por proyecto, con exclusión de las órdenes marcadas como no facturables. Protegido con clave de Gestión Financiera.

- **Archivo:** `components/sst/facturacion-proyectos-indicador.tsx`
- **Permiso:** `facturacion_proyectos`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Facturación Proyectos

Detalle de la facturación por proyecto sobre la vista `facturacion`, con filtros por fecha, cliente y operación. Protegido con clave.

- **Archivo:** `components/facturacion-proyectos.tsx`
- **Permiso:** `facturacion_proyectos`
- **Escribe en:** —
- **Lee de:** `facturacion`, `facturacion_filtros`, `facturacionturnos`
- **Genera:** Excel

#### Cuadro de Control Facturación

Cuadro maestro de facturación con semáforo por estado —por facturar, en proceso, facturado— y la prefactura por owner y servicio. Incluye el desglose orden por orden de cada owner y un encabezado que explica las reglas de facturación del proyecto. Protegido con clave.

- **Archivo:** `components/cuadro-control-facturacion.tsx`
- **Permiso:** `cuadro_facturacion`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `prefacturas`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `facturacion`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `tarifasoperacion`, `usuariocartera`, `vendedores`
- **Genera:** PDF · Excel · archivos en almacenamiento

#### Resumen de Facturación por Proyecto

Resumen consolidado de lo facturado por proyecto contra el acuerdo de volúmenes pactado. Protegido con clave.

- **Archivo:** `components/resumen-facturacion-proyecto.tsx`
- **Permiso:** `cuadro_facturacion`
- **Escribe en:** `acuerdo_volumenes`, `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `prefacturas`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas`, `empresas_permisos`, `facturacion`, `headcount`, `historicolotes`, `indicativo`, `pagonomina`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `tarifasoperacion`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

#### Cargos Fijos

Conceptos mensuales fijos por proyecto (manejo de inventario, distribución fija, alquiler de montacargas). Los genera mensualmente sin duplicar si se ejecuta dos veces, y compara las toneladas fijas pactadas contra las reales. Protegido con clave.

- **Archivo:** `components/cargos-fijos.tsx`
- **Permiso:** `cargos_fijos`
- **Escribe en:** `cargos_fijos_generados`, `cargos_fijos_proyecto`, `montacargas_alquiler`, `pedidoscabecera`, `pedidosdetalle`, `soportes_documentales`
- **Lee de:** `archivos`, `bodegas`, `cabeceraoc`, `categorias`, `clientes`, `condicionespago`, `destinos`, `empresas`, `medio`, `owners`, `productos`, `sst_equipos`, `tipodespacho`, `tiposvehiculos`, `transportes`, `vendedores`
- **Genera:** archivos en almacenamiento

#### Conciliación Avimol

Concilia lo cobrado contra lo ejecutado en el proyecto Avimol: producción fechada por lote, turnos y horas extra, con las tarifas vigentes. Protegido con clave.

- **Archivo:** `components/conciliacion-avimol.tsx`
- **Permiso:** `conciliacion_avimol`
- **Escribe en:** —
- **Lee de:** `festivos`, `invtrans`, `pagonomina`, `productos`, `registroasistencia`, `solicitudesturnos`, `tarifasfacturacionturnos`, `tarifasoperacion`
- **Genera:** Excel

#### Prefactura de Producción

Prefactura de los conceptos de producción que no nacen de una orden de cargue. Guarda el borrador y su soporte congelado en `prefacturas`. Protegido con clave.

- **Archivo:** `components/prefactura-produccion.tsx`
- **Permiso:** `prefactura_produccion`
- **Escribe en:** `prefacturas`
- **Lee de:** `cabeceraoc`, `detalleoc`, `tarifasoperacion`
- **Genera:** Excel

#### Tarifas

Mantenimiento de las tarifas del sistema: de operación (lo que se cobra), de personal (lo que se paga), de turnos y de facturación de turnos, todas con vigencia por fechas. Protegido con clave.

- **Archivo:** `components/configuration/tarifas.tsx`
- **Permiso:** `tarifas`
- **Escribe en:** —
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `citasvehiculos`, `clientes`, `locations`, `materiales`, `owners`, `productos`, `proveedores`, `subcategorias`, `tarifas`, `tiposvehiculos`, `transportes`

### Resultados


#### Estado de Resultados

P&L de gestión por proyecto: ingresos de facturación por tonelada, turnos y cargos fijos, contra costo de nómina con provisiones prestacionales y gastos. Es una herramienta de análisis gerencial, no un estado financiero contable. Protegido con clave.

- **Archivo:** `components/estado-resultados/estado-resultados.tsx`
- **Permiso:** `estadoresultados`
- **Escribe en:** `acuerdo_volumenes`, `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas`, `empresas_permisos`, `facturacion`, `headcount`, `historicolotes`, `indicativo`, `pagonomina`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `tarifasoperacion`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

### Gastos


#### Registrar Gasto

Registro de egresos con su concepto, proyecto y soporte adjunto. Escribe en `gastos`. Protegido con clave.

- **Archivo:** `components/gastos/formulario-registro-gasto.tsx`
- **Permiso:** `gastos`
- **Escribe en:** `gastos`
- **Lee de:** `soportes_gastos`

#### Dashboard Gastos

Tablero de gasto por concepto y proyecto sobre lo registrado. Protegido con clave.

- **Archivo:** `components/gastos/dashboard-gastos.tsx`
- **Permiso:** `gastos`
- **Escribe en:** —
- **Lee de:** `gastos`

---

## Gestión Humana

**25 módulos.**


### Reclutamiento, Selección y Contratación


#### Gestión de Solicitudes

Bandeja de solicitudes de los trabajadores —certificados, anticipos y permisos— con su flujo de aprobación. Los permisos requieren doble aprobación: Gestión Humana y Coordinación. Genera el documento de autorización del anticipo para firma del trabajador.

- **Archivo:** `components/rrhh/gestion-solicitudes.tsx`
- **Permiso:** `gestionsolicitudes`
- **Escribe en:** `solicitudes_trabajadores`
- **Lee de:** `certificados`, `firmas`, `headcount`, `plantillas`

#### Aprobación de Solicitudes de Personal

Aprueba las solicitudes de personal nuevo abiertas por los coordinadores, habilitando el inicio del proceso de selección.

- **Archivo:** `components/rrhh/gestion-solicitudes-personal.tsx`
- **Permiso:** `gestionsolicitudes`
- **Escribe en:** `capacitaciones`, `capacitaciones_asistencia`, `colaboradores`, `colaboradores_th`, `contratos`, `dotacion_epp`, `headcount`, `vacantes`
- **Lee de:** `antecedentes`, `archivos`, `examenes_medicos`, `owners`
- **Genera:** archivos en almacenamiento

#### Hojas de Vida

Recepción y gestión de hojas de vida de aspirantes, con el archivo adjunto y los datos del candidato.

- **Archivo:** `components/rrhh/hojas-de-vida.tsx`
- **Permiso:** `gestionsolicitudes`
- **Escribe en:** `hojas_de_vida`
- **Lee de:** `archivos`, `headcount`
- **Genera:** archivos en almacenamiento

#### Antecedentes

Consulta de antecedentes del aspirante. Se integra con el servicio Compliance para la consulta automática y admite además la carga manual de los certificados de Policía, Procuraduría y Contraloría.

- **Archivo:** `components/rrhh/antecedentes.tsx`
- **Permiso:** `gestionsolicitudes`
- **Escribe en:** `antecedentes`, `hojas_de_vida`
- **Lee de:** `archivos`, `headcount`
- **Genera:** archivos en almacenamiento

#### Entrevistas

Registro de la entrevista al aspirante con su resultado, ligada a la hoja de vida.

- **Archivo:** `components/rrhh/entrevistas.tsx`
- **Permiso:** `gh_entrevistas`
- **Escribe en:** `entrevistas`, `hojas_de_vida`
- **Lee de:** `archivos`, `headcount`
- **Genera:** archivos en almacenamiento

#### Gestión de Contratos

Gestión del contrato del colaborador: tipo, fechas de inicio y fin, y su vínculo con el registro de Head Count.

- **Archivo:** `components/rrhh/gestion-contratos.tsx`
- **Permiso:** `gestion_contratos`
- **Escribe en:** `capacitaciones`, `capacitaciones_asistencia`, `colaboradores`, `colaboradores_th`, `contratos`, `dotacion_epp`, `headcount`, `vacantes`
- **Lee de:** `antecedentes`, `archivos`, `examenes_medicos`, `owners`
- **Genera:** archivos en almacenamiento

### Directorio y Expediente


#### Gestión de Colaboradores

*En el menú aparece como «Directorio de Colaboradores».*

Directorio ampliado de colaboradores con sus datos personales, contractuales y de contacto. Sincroniza un registro espejo en Head Count, pero no puede modificar el cargo, que solo se define en Head Count. Excluye a los retirados de los listados de evaluación.

- **Archivo:** `components/rrhh/gestion-colaboradores.tsx`
- **Permiso:** `gestion_colaboradores`
- **Escribe en:** `capacitaciones`, `capacitaciones_asistencia`, `colaboradores`, `colaboradores_th`, `contratos`, `dotacion_epp`, `headcount`, `vacantes`
- **Lee de:** `antecedentes`, `archivos`, `examenes_medicos`, `owners`
- **Genera:** archivos en almacenamiento

#### Head Count

Maestro de personal por proyecto: cargo, salario, estado, fechas de ingreso y retiro, y control de los documentos del expediente. El cargo se elige de un listado fijo (Auxiliar Logístico, Coordinador, Montacarguista) y es el único módulo que puede cambiarlo. Alimenta la nómina, la asistencia y el portal del trabajador.

- **Archivo:** `components/headcount-management.tsx`
- **Permiso:** `headcount`
- **Escribe en:** `headcount`
- **Lee de:** `archivos`, `empresas_permisos`
- **Genera:** archivos en almacenamiento

#### Carpetas de Trabajadores

*En el menú aparece como «Expediente del Colaborador».*

Expediente digital del colaborador con todos sus documentos, mostrando cuáles de los obligatorios faltan.

- **Archivo:** `components/rrhh/carpetas-trabajadores.tsx`
- **Permiso:** `gh_carpetas`
- **Escribe en:** `capacitaciones`, `capacitaciones_asistencia`, `capacitaciones_evaluacion_intentos`, `capacitaciones_evaluacion_preguntas`, `capacitaciones_evaluacion_respuestas`, `capacitaciones_evaluaciones`, `headcount`
- **Lee de:** `archivos`
- **Genera:** archivos en almacenamiento

#### Panel LIP Gestión Humana

*En el menú aparece como «Panel LIP · Gestión Humana (SIG)».*

Panel de indicadores del área de personal dentro del SIG.

- **Archivo:** `components/sst/panel-gestion-humana-lip.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

### Inducción, Formación y Desempeño


#### Inducciones

Asigna material de inducción al personal, controla su realización y deja evidencia. Incluye evaluación con preguntas e intentos, y genera el certificado.

- **Archivo:** `components/rrhh/inducciones-management.tsx`
- **Permiso:** `inducciones`
- **Escribe en:** `cabeceraoc`, `capacitaciones`, `capacitaciones_asistencia`, `capacitaciones_evaluacion_intentos`, `capacitaciones_evaluacion_preguntas`, `capacitaciones_evaluacion_respuestas`, `capacitaciones_evaluaciones`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `headcount`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

#### Evidencia de Inducciones

Tablero de evidencia de las inducciones realizadas, con quién la hizo, cuándo y su resultado.

- **Archivo:** `components/rrhh/inducciones-evidencia-dashboard.tsx`
- **Permiso:** `evidenciasinducciones`
- **Escribe en:** `capacitaciones`, `capacitaciones_asistencia`, `capacitaciones_evaluacion_intentos`, `capacitaciones_evaluacion_preguntas`, `capacitaciones_evaluacion_respuestas`, `capacitaciones_evaluaciones`
- **Lee de:** `archivos`, `headcount`
- **Genera:** PDF

#### Gestión de Capacitaciones

Programa capacitaciones, define su contenido y evaluación, y controla la cobertura del personal.

- **Archivo:** `components/rrhh/capacitaciones.tsx`
- **Permiso:** `capacitaciones`
- **Escribe en:** `capacitaciones`, `capacitaciones_asistencia`, `colaboradores`, `colaboradores_th`, `contratos`, `dotacion_epp`, `headcount`, `vacantes`
- **Lee de:** `antecedentes`, `archivos`, `empresas_permisos`, `examenes_medicos`, `owners`
- **Genera:** archivos en almacenamiento

#### Asistencia a Capacitaciones

Registro de asistencia a cada capacitación, con la evidencia correspondiente.

- **Archivo:** `components/rrhh/capacitaciones-asistencia.tsx`
- **Permiso:** `asistencia_capacitaciones`
- **Escribe en:** `capacitaciones`, `capacitaciones_asistencia`, `colaboradores`, `colaboradores_th`, `contratos`, `dotacion_epp`, `headcount`, `vacantes`
- **Lee de:** `antecedentes`, `archivos`, `examenes_medicos`, `owners`
- **Genera:** archivos en almacenamiento

#### Evaluaciones de Desempeño

Evaluación de desempeño del colaborador con su formato y resultado. Genera el PDF de la evaluación. Solo lista personal activo y contratado.

- **Archivo:** `components/rrhh/evaluaciones-dashboard.tsx`
- **Permiso:** `evaluacionpersonal`
- **Escribe en:** `evaluaciones_desempeno`
- **Lee de:** `headcount`, `profiles`
- **Genera:** PDF

### Asistencia, Turnos y Tiempos


#### Tabla Asistencia

*En el menú aparece como «Tabla de Asistencia».*

Pantalla operativa del supervisor: marca a cada persona como presente asignándole puesto (Operaciones o Especialidad) o como ausente registrando la novedad. Permite cambiar el puesto del día exigiendo un motivo escrito, que queda en `reasignacion_puesto_log`. Lo que se registre aquí determina quién aparece disponible en Picking y Packing.

- **Archivo:** `components/attendance-table.tsx`
- **Permiso:** `tabla_asistencia`
- **Escribe en:** `asignacionpersonal`, `reasignacion_puesto_log`, `registroasistencia`
- **Lee de:** `asistencia`, `headcount`, `tarifasturnos`

#### Visor

*En el menú aparece como «Visor de Asistencia».*

Visor de asistencia con el detalle por persona y día, incluidos ausentismos y parámetros legales aplicados.

- **Archivo:** `components/attendance-viewer.tsx`
- **Permiso:** `visor`
- **Escribe en:** `ausentismosst`, `colaboradores_th`, `headcount`, `parametros_legales_anio`, `registroasistencia`
- **Lee de:** `empresas`, `profiles`, `registro_conexiones`, `sst_incidentes`

#### Turnos

*En el menú aparece como «Turnos por Puesto».*

Maestro de puestos de turno con su bandera de especialidad y vigencia. Es la fuente de verdad que determina si un puesto se paga por jornada o por tonelada.

- **Archivo:** `components/rrhh/gestion-turnos.tsx`
- **Permiso:** `gestionturnos`
- **Escribe en:** `tarifasturnos`
- **Lee de:** —

#### Asignación horas extra

*En el menú aparece como «Asignación de Horas Extra».*

Asigna y ajusta las horas extra del personal sobre `registroasistencia`, con valor libre en el ajuste manual. Solo las horas aprobadas llegan a la liquidación.

- **Archivo:** `components/extra-hours-assignment.tsx`
- **Permiso:** `asignacion_horas_extra`
- **Escribe en:** `registroasistencia`
- **Lee de:** `solicitud_horas_extras`

### Relaciones Laborales y Ausentismo


#### Novedades de personal

*En el menú aparece como «Novedades de Personal».*

Registro de novedades del día —incapacidad, licencia, vacaciones, descanso, retiro— sobre la fila de asistencia de la persona. La novedad bloquea la marcación y afecta el pago del día.

- **Archivo:** `components/personnel-notices.tsx`
- **Permiso:** `novedades_personal`
- **Escribe en:** `registroasistencia`
- **Lee de:** —

#### Ausentismos

Gestión de ausentismos con su clasificación, días y soporte, diferenciando los planeados de los no planeados. Alimenta los indicadores de SST.

- **Archivo:** `components/rrhh/ausentismos.tsx`
- **Permiso:** `ausentismos`
- **Escribe en:** `ausentismosst`, `parametros_legales_anio`
- **Lee de:** `archivos`, `empresas`, `headcount`, `registroasistencia`, `sst_incidentes`
- **Genera:** archivos en almacenamiento

#### Recobro de Incapacidades

Seguimiento del recobro de incapacidades ante la entidad correspondiente, con su soporte.

- **Archivo:** `components/rrhh/recobro-incapacidades.tsx`
- **Permiso:** `recobro_incapacidades`
- **Escribe en:** `ausentismosst`, `parametros_legales_anio`
- **Lee de:** `archivos`, `empresas`, `headcount`, `registroasistencia`, `sst_incidentes`
- **Genera:** archivos en almacenamiento

### Bienestar


#### Programa de Bienestar

**Requiere revisión** — el componente es un placeholder declarado en el propio código: la pantalla anuncia el módulo pero el CRUD de programas, evidencias e indicadores está previsto para una fase posterior. No lee ni escribe en base de datos.

- **Archivo:** `components/rrhh/bienestar-programa.tsx`
- **Permiso:** `gh_bienestar`
- **Escribe en:** —
- **Lee de:** —

#### Participación y Evidencias

**Requiere revisión** — mismo caso que el anterior: placeholder declarado, sin lectura ni escritura en base de datos.

- **Archivo:** `components/rrhh/bienestar-participacion.tsx`
- **Permiso:** `gh_participacion`
- **Escribe en:** —
- **Lee de:** —

### Nómina


#### Proyecciones

*En el menú aparece como «Proyecciones de Nómina».*

Proyección de nómina por proyecto y período, a partir de las órdenes y el personal, para anticipar el costo de la quincena.

- **Archivo:** `components/proyecciones.tsx`
- **Permiso:** `proyecciones`
- **Escribe en:** `cabeceraoc`, `citasvehiculos`, `detalleoc`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `registrosanitario`, `traslados`
- **Lee de:** `archivos`, `clientes`, `despachotraslados`, `destinos`, `empresas_permisos`, `headcount`, `historicolotes`, `indicativo`, `perfil_acceso_empresas`, `perfil_acceso_owners`, `productos`, `usuariocartera`, `vendedores`
- **Genera:** PDF · archivos en almacenamiento

---

## Compensación

**7 módulos.**


#### Nominapersonal

*En el menú aparece como «Nómina de Personal».*

Módulo principal de nómina, con cuatro vistas: total por auxiliar, detalle por orden, liquidación diaria por persona y turno, y archivo plano. La liquidación se consulta por rango de fechas acotado y el archivo plano se lee desde el servidor por el peso de la vista. Solo lectura: el cálculo vive en las vistas `pagonomina` y `archivoplano`.

- **Archivo:** `components/nominapersonal.tsx`
- **Permiso:** `nominapersonal`
- **Escribe en:** —
- **Lee de:** `archivoplano`, `pagonomina`, `toneladasauxiliares`, `toneladasauxiliarespago`
- **Genera:** Excel

#### Liquidaciones

Liquidación definitiva de contrato con sus prestaciones, sobre los parámetros configurados en `parametros_prestaciones`.

- **Archivo:** `components/liquidaciones.tsx`
- **Permiso:** `liquidaciones`
- **Escribe en:** `liquidaciones_retiro`, `parametros_prestaciones`
- **Lee de:** `archivos`, `headcount`, `pagonomina`, `parametros_legales_anio`
- **Genera:** Excel · archivos en almacenamiento

#### Parafiscales

*En el menú aparece como «Parafiscales y Seguridad Social».*

Planilla de seguridad social (PILA) con su IBC, calculada desde la nómina. Aplica el mes vencido por defecto y corta por fecha de ingreso.

- **Archivo:** `components/parafiscales.tsx`
- **Permiso:** `parafiscales`
- **Escribe en:** `parametros_parafiscales`
- **Lee de:** `headcount`, `pagonomina`, `parametros_legales_anio`

#### Revisión de nómina

Cruza lo que calcula el sistema contra lo que resulta del archivo plano, para detectar diferencias antes de pagar. Incluye el ajuste de proyecciones por trabajador.

- **Archivo:** `components/revision-nomina.tsx`
- **Permiso:** `revision_nomina`
- **Escribe en:** `ajustes_proyeccion`
- **Lee de:** `archivoplano`, `asistencia`, `cabeceraoc`, `detalleoc`, `headcount`, `pagonomina`, `parametros_legales_vigencia`, `registroasistencia`, `tarifaspersonal`

#### Bonos

Bonos no prestacionales por concepto, con su aprobación. No entran al IBC ni a las prestaciones: llegan al trabajador por su propia novedad en el archivo plano.

- **Archivo:** `components/bonos.tsx`
- **Permiso:** `bonos`
- **Escribe en:** `bonos_nomina`, `pedidoscabecera`, `pedidosdetalle`
- **Lee de:** `bodegas`, `categorias`, `clientes`, `condicionespago`, `destinos`, `empresas`, `headcount`, `medio`, `owners`, `productos`, `tipodespacho`, `tiposvehiculos`, `transportes`, `vendedores`

#### Asignación de apoyo en cargue

Agrega personal de turno fijo a una orden de cargue o descargue existente para que participe del reparto de toneladas de ese día. La asignación queda en `apoyo_cargue_asignaciones`, que es el rastro que la vista de nómina usa para permitirle el bono de toneladas a alguien de especialidad solo ese día.

- **Archivo:** `components/apoyo-cargue.tsx`
- **Permiso:** `apoyo_cargue`
- **Escribe en:** `apoyo_cargue_asignaciones`, `cabeceraoc`
- **Lee de:** `registroasistencia`, `tarifaspersonal`

#### Vacaciones

Causación y disfrute de vacaciones con el saldo por trabajador. Al aprobar una solicitud crea el registro diario correspondiente en asistencia, de modo que se refleje en el control diario y en la nómina.

- **Archivo:** `components/rrhh/vacaciones.tsx`
- **Permiso:** `vacaciones`
- **Escribe en:** `registroasistencia`, `vacaciones_liquidaciones`, `vacaciones_solicitudes`
- **Lee de:** `contratos`, `festivos`, `headcount`

---

## Certificaciones · SIG (Calidad · Ambiente · SST)

**15 módulos.**


### Sistema Integrado (SIG) · Transversal


#### Dashboard SIG

*En el menú aparece como «Dashboard SIG (Auditoría)».*

Tablero de auditoría del Sistema Integrado de Gestión, con el estado de cumplimiento de las tres normas y sus evidencias.

- **Archivo:** `components/sst/dashboard-sig.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`
- **Genera:** PDF

#### Análisis de Contexto DOFA

*En el menú aparece como «Análisis de Contexto (DOFA)».*

Matriz DOFA del sistema de gestión: debilidades, oportunidades, fortalezas y amenazas, con su análisis. Corresponde al numeral 4 de las normas.

- **Archivo:** `components/sst/contexto-dofa.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Matriz Integrada SIG

*En el menú aparece como «Matriz Integrada (ISO 9001·14001·45001)».*

Matriz que cruza los requisitos de ISO 9001, 14001 y 45001 con su evidencia y responsable, para gestionar las tres normas en un solo lugar.

- **Archivo:** `components/sst/matriz-integrada-sig.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Repositorio por Norma SIG

*En el menú aparece como «Repositorio Documental por Norma».*

Repositorio documental organizado por norma y numeral, con la cobertura de cada requisito.

- **Archivo:** `components/sst/repositorio-sig.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Repositorio Universal

*En el menú aparece como «Repositorio Universal de Documentos».*

Repositorio general de documentos del sistema de gestión, con control de versión y cobertura por norma. Consulta a través de sus propias acciones de servidor.

- **Archivo:** `components/sst/repositorio-universal.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** —
- **Lee de:** `antecedentes`, `ausentismosst`, `contratos`, `examenes_medicos`, `headcount`, `hojas_de_vida`, `sig_inventario_cierre_mes`, `soportes_documentales`, `sst_incidentes`

#### Objetivos y Metas SIG

*En el menú aparece como «Objetivos y Metas (6.2)».*

Objetivos y metas del sistema de gestión (numeral 6.2), con su indicador, meta y seguimiento.

- **Archivo:** `components/sst/objetivos-sig.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### No Conformidades SIG

*En el menú aparece como «No Conformidades (10.2)».*

Registro y tratamiento de no conformidades (numeral 10.2), con su análisis de causa y acciones correctivas.

- **Archivo:** `components/sst/no-conformidades-sig.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidoscabecera`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `bodegas`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `categorias`, `citasvehiculos`, `clientes`, `condicionespago`, `destinos`, `empresas`, `facturacion`, `headcount`, `locations`, `medio`, `owners`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `tipodespacho`, `tiposvehiculos`, `transportes`, `v_pedidos_vs_salidas`, `vendedores`

#### Indicadores SIG

*En el menú aparece como «BSC · Cuadro de Mando Integral».*

Cuadro de Mando Integral (BSC) con los indicadores del sistema de gestión por perspectiva, y su comportamiento histórico.

- **Archivo:** `components/sst/indicadores-sig.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Evaluación por Área

*En el menú aparece como «Evaluación de Desempeño por Área».*

Evaluación de desempeño por área y por coordinador de proyecto, calculada desde los indicadores de la operación.

- **Archivo:** `components/sst/evaluacion-areas.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Mapa de Interacción del Proceso

*En el menú aparece como «Mapa de Interacción del Proceso (LIPgo)».*

Mapa de interacción de los procesos de LIPgo: entradas, salidas y su relación entre áreas.

- **Archivo:** `components/sst/mapa-interaccion-proceso.tsx`
- **Permiso:** `sig_matriz`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Satisfacción y PQRSF

*En el menú aparece como «Satisfacción y PQRSF (9.1.2)».*

Mismo módulo de satisfacción y PQRSF, accesible desde el área de certificaciones por corresponder al numeral 9.1.2.

- **Archivo:** `components/sst/satisfaccion-pqrsf.tsx`
- **Permiso:** `satisfaccion_pqrsf`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

### ISO 9001:2015 · Calidad


#### Centro de Evidencia ISO 9001

*En el menú aparece como «Centro de Evidencia».*

Centro de evidencia de ISO 9001: qué cláusula está cubierta, con qué documento y su estado. Escribe en `iso_clausulas`.

- **Archivo:** `components/iso9001/iso-evidence-dashboard.tsx`
- **Permiso:** `evidenciasido`
- **Escribe en:** `iso_clausulas`
- **Lee de:** `archivos`, `bascula`, `capacitaciones_evaluacion_intentos`, `headcount`, `registroasistencia`, `sig_documentos`
- **Genera:** archivos en almacenamiento

#### Repositorio ISO 9001

*En el menú aparece como «Repositorio Documental».*

Repositorio documental específico de ISO 9001, ligado a las cláusulas de la norma.

- **Archivo:** `components/iso9001/repositorio-iso9001.tsx`
- **Permiso:** `iso_repositorio`
- **Escribe en:** `iso_clausulas`
- **Lee de:** `bascula`, `capacitaciones_evaluacion_intentos`, `headcount`, `registroasistencia`, `sig_documentos`

### ISO 14001:2015 · Ambiental


#### Aspectos e Impactos ISO 14001

*En el menú aparece como «Aspectos e Impactos Ambientales».*

Matriz de aspectos e impactos ambientales con su valoración, según ISO 14001.

- **Archivo:** `components/sst/aspectos-ambientales.tsx`
- **Permiso:** `sig_iso14001`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

#### Matriz Legal Ambiental

Matriz de requisitos legales ambientales aplicables y su estado de cumplimiento.

- **Archivo:** `components/sst/matriz-legal-ambiental.tsx`
- **Permiso:** `sig_iso14001`
- **Escribe en:** `indicador_historico`, `invtrans`, `pedidosdetalle`, `reprocesos`, `sig_aspectos_ambientales`, `sig_contexto_dofa`, `sig_documento_cobertura`, `sig_documento_versiones`, `sig_indicadores`, `sig_inventario_acta_cruce`, `sig_inventario_acta_cruce_detalle`, `sig_inventario_ajuste`, `sig_inventario_cierre_mes`, `sig_inventario_cuadre`, `sig_inventario_cuadre_detalle`, `sig_nc_catalogo`, `sig_no_conformidades`, `sig_objetivos`, `sig_pqrsf`, `sig_proceso_interaccion`, `sig_requisitos_legales`, `sig_satisfaccion`
- **Lee de:** `ausentismosst`, `cabeceraoc`, `capacitaciones`, `capacitaciones_evaluacion_intentos`, `citasvehiculos`, `empresas`, `facturacion`, `headcount`, `locations`, `pedidoscabecera`, `productos`, `registroasistencia`, `saldoinvdetalle`, `sig_documentos`, `sig_normas`, `sig_procesos`, `sig_requisito_norma`, `sig_requisitos`, `sig_tipos_movimiento`, `sst_incidentes`, `sst_indicadores`, `sst_ipevr`, `v_pedidos_vs_salidas`

---

## Seguridad y Salud en el Trabajo (SST)

**20 módulos.**


### Autoevaluación y Mejora (Dec. 0312)


#### Auditoría 0312

Autoevaluación del SG-SST según el Decreto 0312, con las respuestas por estándar y su puntaje. Escribe en `sst_autoevaluaciones` y `sst_autoeval_respuestas`.

- **Archivo:** `components/sst/auditoria-0312.tsx`
- **Permiso:** `sst_auditoria`
- **Escribe en:** `sst_autoeval_respuestas`, `sst_autoevaluaciones`
- **Lee de:** `sst_estandar_items`, `sst_indicadores`, `v_sst_auditoria_estandar`, `v_sst_autoeval_por_ciclo`

#### Matriz de Estándares

*En el menú aparece como «Matriz 60 Estándares».*

Matriz de los 60 estándares mínimos del Decreto 0312, con su cumplimiento y soporte asociado.

- **Archivo:** `components/sst/matriz-60-estandares.tsx`
- **Permiso:** `sst_autoevaluacion`
- **Escribe en:** `sst_autoeval_respuestas`, `sst_autoevaluaciones`
- **Lee de:** `archivos`, `sst_estandar_items`, `sst_indicadores`, `v_sst_auditoria_estandar`, `v_sst_autoeval_por_ciclo`

#### Repositorio de Soportes

*En el menú aparece como «Repositorio de Soportes (Matriz)».*

Repositorio de los soportes documentales que respaldan cada estándar de la matriz.

- **Archivo:** `components/sst/repositorio-soportes.tsx`
- **Permiso:** `sst_repositorio_soportes`
- **Escribe en:** `soportes_documentales`
- **Lee de:** `archivos`
- **Genera:** archivos en almacenamiento

#### Plan de Mejoramiento

Plan de mejoramiento derivado de la autoevaluación: hallazgo, acción, responsable y fecha, con su seguimiento.

- **Archivo:** `components/sst/plan-mejoramiento.tsx`
- **Permiso:** `sst_plan_mejora`
- **Escribe en:** `sst_autoeval_respuestas`, `sst_indicadores`, `sst_plan_mejora`
- **Lee de:** `sst_autoevaluaciones`, `sst_estandar_items`

#### Indicadores SST

*En el menú aparece como «Indicadores SG-SST».*

Indicadores del SG-SST —frecuencia, severidad, ausentismo— calculados desde los incidentes y ausentismos registrados.

- **Archivo:** `components/sst/indicadores.tsx`
- **Permiso:** `sst_indicadores`
- **Escribe en:** `sst_autoeval_respuestas`, `sst_indicadores`, `sst_plan_mejora`
- **Lee de:** `sst_autoevaluaciones`, `sst_estandar_items`

### Peligros, Riesgos y Operación Segura


#### IPEVR

*En el menú aparece como «IPEVR (GTC 45)».*

Identificación de peligros, evaluación y valoración de riesgos según la GTC 45, por proceso y actividad. Escribe en `sst_ipevr`.

- **Archivo:** `components/sst/ipevr.tsx`
- **Permiso:** `sst_ipevr`
- **Escribe en:** `sst_ipevr`
- **Lee de:** —

#### Registro Preoperacional

Inspección previa al uso del equipo, con su lista de verificación y firma. Permite seleccionar a la persona desde el Head Count y captura su hora de entrada del día, para poder contrastarla con la hora de diligenciamiento. Genera el documento de la inspección.

- **Archivo:** `components/registro-preoperacional.tsx`
- **Permiso:** `prechequeo`
- **Escribe en:** `headcount`, `inspecciones_montacargas`
- **Lee de:** `archivos`, `asistencia`
- **Genera:** PDF · archivos en almacenamiento

#### Equipos y Mantenimiento

Maestro de equipos con su hoja de vida y el registro de mantenimientos realizados.

- **Archivo:** `components/sst/equipos-mantenimiento.tsx`
- **Permiso:** `sst_mantenimiento`
- **Escribe en:** `sst_equipos`, `sst_mantenimientos`
- **Lee de:** —

#### Gestión de Montacargas

Gestión de montacargas con su QR: para registrar bitácora o mantenimiento hay que leer el código del equipo o digitarlo, de modo que el registro siempre corresponda al equipo real. Guarda además los documentos del equipo.

- **Archivo:** `components/montacargas/gestion-montacargas.tsx`
- **Permiso:** `montacargas`
- **Escribe en:** `montacargas_documentos`, `soportes_documentales`, `sst_equipos`, `sst_mantenimientos`
- **Lee de:** `inspecciones_montacargas`
- **Genera:** captura por cámara

#### Entrega de EPP

Registro de la entrega de elementos de protección personal al trabajador, con su evidencia.

- **Archivo:** `components/sst/entrega-epp.tsx`
- **Permiso:** `sst_epp`
- **Escribe en:** `sst_entrega_epp`
- **Lee de:** —

#### Gestión de Dotación EPP

*En el menú aparece como «Dotación de EPP».*

Gestión de la dotación entregada al personal, con el documento PDF de la entrega firmada. El archivo se sube directo al almacenamiento mediante URL firmada, sin pasar por el servidor, para admitir archivos grandes.

- **Archivo:** `components/rrhh/dotacion-epp.tsx`
- **Permiso:** `dotacion_epp`
- **Escribe en:** `capacitaciones`, `capacitaciones_asistencia`, `colaboradores`, `colaboradores_th`, `contratos`, `dotacion_epp`, `headcount`, `vacantes`
- **Lee de:** `antecedentes`, `archivos`, `examenes_medicos`, `owners`
- **Genera:** archivos en almacenamiento

### Accidentalidad y Salud en el Trabajo


#### Investigación AT

*En el menú aparece como «Investigación de AT (SST-FOR-21)».*

Investigación de accidentes de trabajo según el formato SST-FOR-21: descripción, testigos, análisis de causa y acciones. Genera el PDF de la investigación.

- **Archivo:** `components/sst/investigacion-at.tsx`
- **Permiso:** `sst_incidentes`
- **Escribe en:** `sst_incidente_acciones`, `sst_incidente_testigos`, `sst_incidentes`
- **Lee de:** —
- **Genera:** PDF

#### Alertas de AT

*En el menú aparece como «Alertas de AT (Ausentismo)».*

Alertas de accidentes de trabajo derivadas del ausentismo registrado, para que ningún evento quede sin investigar.

- **Archivo:** `components/sst/alertas-at.tsx`
- **Permiso:** `sst_alertas_at`
- **Escribe en:** `sst_incidentes`
- **Lee de:** `ausentismosst`

#### Investigaciones Realizadas

*En el menú aparece como «Repositorio de Investigaciones».*

Repositorio de las investigaciones de accidente ya cerradas, con su documento.

- **Archivo:** `components/sst/investigaciones-repositorio.tsx`
- **Permiso:** `sst_investigaciones`
- **Escribe en:** `sst_incidente_acciones`, `sst_incidente_testigos`, `sst_incidentes`
- **Lee de:** `archivos`
- **Genera:** PDF · archivos en almacenamiento

#### Examenes Médicos

Gestión de exámenes médicos ocupacionales con su aptitud, que actúa como requisito de contratación. Al vincular a alguien nuevo crea su registro de Head Count con los documentos del expediente que ya tenga.

- **Archivo:** `components/rrhh/examenes-medicos.tsx`
- **Permiso:** `examenes_medicos`
- **Escribe en:** `examenes_medicos`, `headcount`, `hojas_de_vida`, `rrhh_config`
- **Lee de:** `antecedentes`, `archivos`, `contratos`
- **Genera:** archivos en almacenamiento

#### MEDEVAC

*En el menú aparece como «MEDEVAC (Plan de Emergencias Médicas)».*

Directorio de emergencias médicas por colaborador: grupo sanguíneo, alergias, EPS/ARL y a quién avisar. Filtra por colaborador, cargo, centro de trabajo, EPS y ARL, y exporta lo filtrado. La llave de cada persona es su documento, que es lo que enlaza esta ficha con su Perfil Sociodemográfico, con el head count y con lo que el trabajador diligencia desde el portal. Incluye la cobertura contra el head count —quién no tiene ficha— y las fichas pendientes por corregir.

- **Archivo:** `components/sst/medevac.tsx`
- **Permiso:** `sst_medevac`
- **Escribe en:** `sst_medevac`
- **Lee de:** `headcount`, `vw_sst_datos_colaborador`
- **Genera:** PDF (tarjeta individual y directorio)

#### Perfil Sociodemográfico

*En el menú aparece como «Perfil Sociodemográfico (SST-FOR-32)».*

Perfil sociodemográfico de la población trabajadora (SST-FOR-32), construido desde los datos del personal. Consulta a través de sus propias acciones de servidor.

- **Archivo:** `components/sst/perfil-sociodemografico.tsx`
- **Permiso:** `sst_perfil`
- **Escribe en:** —
- **Lee de:** `sst_perfil_sociodemografico`

### Comunicación, Cambio y Cultura


#### Comunicación SST

*En el menú aparece como «Comunicación / Autorreporte / PQRSF».*

Canal de comunicación, autorreporte de condiciones y PQRSF en materia de seguridad y salud. Consulta a través de sus propias acciones de servidor.

- **Archivo:** `components/sst/comunicacion.tsx`
- **Permiso:** `sst_comunicacion`
- **Escribe en:** —
- **Lee de:** —

#### Gestión del Cambio

Registro y evaluación de los cambios que puedan afectar la seguridad y salud en el trabajo, con su análisis previo.

- **Archivo:** `components/sst/gestion-cambio.tsx`
- **Permiso:** `sst_gestion_cambio`
- **Escribe en:** `sst_gestion_cambio`
- **Lee de:** —

#### Actividades y Comités

Actividades del SG-SST y conformación de los comités (COPASST, convivencia), con sus miembros y evidencias.

- **Archivo:** `components/sst/actividades.tsx`
- **Permiso:** `sst_actividades`
- **Escribe en:** `sst_actividades`, `sst_comite_miembros`
- **Lee de:** —

---

## Configuración

**16 módulos.**


### Gestión de Clientes


#### Clientes

Maestro de clientes con sus datos, resuelto por la tabla genérica de configuración sobre `clientes`.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_clientes`
- **Tipo:** CRUD genérico sobre `clientes`
- **Escribe en:** `clientes`
- **Lee de:** —

#### Sucursales

Maestro de sucursales del cliente, resuelto por la tabla genérica sobre `bodegas`.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_sucursales`
- **Tipo:** CRUD genérico sobre `bodegas`
- **Escribe en:** `bodegas`
- **Lee de:** —

### Productos


#### Productos

Maestro de productos con su código, peso unitario, categoría y subcategoría. El peso unitario es lo que convierte bultos a toneladas en toda la cadena de cobro y pago.

- **Archivo:** `components/configuration/productos-with-categories.tsx`
- **Permiso:** `config_productos`
- **Escribe en:** —
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `citasvehiculos`, `clientes`, `locations`, `materiales`, `owners`, `productos`, `proveedores`, `subcategorias`, `tarifas`, `tiposvehiculos`, `transportes`

#### Categorías

Maestro de categorías de producto, resuelto por la tabla genérica sobre `categorias`.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_categorias`
- **Tipo:** CRUD genérico sobre `categorias`
- **Escribe en:** `categorias`
- **Lee de:** —

#### Sub Categorías

Maestro de subcategorías, resuelto por la tabla genérica. La subcategoría determina la tarifa aplicable en facturación.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_subcategorias`
- **Escribe en:** —
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `citasvehiculos`, `clientes`, `destinos`, `empresas_permisos`, `locations`, `materiales`, `owners`, `productos`, `proveedores`, `subcategorias`, `tarifas`, `tipodespacho`, `tiposvehiculos`, `transportes`

### Bodegas


#### Bodegas

Maestro de bodegas, resuelto por la tabla genérica sobre `almacenes`.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_bodegas`
- **Tipo:** CRUD genérico sobre `almacenes`
- **Escribe en:** `almacenes`
- **Lee de:** —

#### Localizaciones

Maestro de localizaciones dentro de cada bodega, con letra y número que definen el orden de recorrido en los listados de inventario.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_localizaciones`
- **Escribe en:** —
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `citasvehiculos`, `clientes`, `destinos`, `empresas_permisos`, `locations`, `materiales`, `owners`, `productos`, `proveedores`, `subcategorias`, `tarifas`, `tipodespacho`, `tiposvehiculos`, `transportes`

### Transportes


#### Tipos Despacho

Maestro de tipos de despacho, resuelto por la tabla genérica sobre `tipodespacho`.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_tipos_despacho`
- **Tipo:** CRUD genérico sobre `tipodespacho`
- **Escribe en:** `tipodespacho`
- **Lee de:** —

#### Transportadoras

Maestro de transportadoras, resuelto por la tabla genérica. La transportadora decide a quién se le factura el movimiento en ciertos proyectos.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_transportadoras`
- **Escribe en:** —
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `citasvehiculos`, `clientes`, `destinos`, `empresas_permisos`, `locations`, `materiales`, `owners`, `productos`, `proveedores`, `subcategorias`, `tarifas`, `tipodespacho`, `tiposvehiculos`, `transportes`

#### Tipos de Vehiculos

Maestro de tipos de vehículo, resuelto por la tabla genérica.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_tipos_vehiculos`
- **Escribe en:** —
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `citasvehiculos`, `clientes`, `destinos`, `empresas_permisos`, `locations`, `materiales`, `owners`, `productos`, `proveedores`, `subcategorias`, `tarifas`, `tipodespacho`, `tiposvehiculos`, `transportes`

### General


#### Condiciones Pago

Maestro de condiciones de pago, resuelto por la tabla genérica sobre `condicionespago`.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_condiciones_pago`
- **Tipo:** CRUD genérico sobre `condicionespago`
- **Escribe en:** `condicionespago`
- **Lee de:** —

#### Vendedores

Maestro de vendedores, resuelto por la tabla genérica sobre `vendedores`.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `config_vendedores`
- **Tipo:** CRUD genérico sobre `vendedores`
- **Escribe en:** `vendedores`
- **Lee de:** —

#### Gestión de Usuarios

Alta y mantenimiento de usuarios, con sus permisos de módulo y los proyectos a los que tiene acceso. En la pestaña Accesos se le asignan **perfiles de acceso** (ver el módulo siguiente): al aplicarlos, el servidor recalcula y escribe las empresas, owners y módulos del usuario; lo marcado a mano se conserva. También permite copiar los permisos de otro usuario como punto de partida.

- **Archivo:** `components/configuration/user-permissions-management.tsx`
- **Permiso:** `gestion_usuarios`
- **Escribe en:** `perfil_acceso_empresas`, `perfil_acceso_owners`, `permisos_usuarios`, `profiles`, `acceso_perfil_usuarios`, `acceso_perfil_materializado`
- **Lee de:** `empresas_permisos`, `owners`, `acceso_perfiles`

#### Perfiles de acceso (antes "Accesos de Usuario")

Plantillas con nombre que juntan empresas, owners y permisos de módulo ("Coordinador Indupan"). Aquí se crean, editan, duplican y desactivan; la asignación a cada persona se hace en Gestión de Usuarios. Un perfil se puede arrancar a partir del acceso que un usuario ya tiene. Al editar un perfil se recalcula el acceso de todos los usuarios que lo tienen. Reemplazó a la grilla usuarios × empresas (2026-10-07); conserva el `name` y el permiso de aquella.

- **Archivo:** `components/configuration/perfiles-acceso.tsx`
- **Permiso:** `accesos_usuario`
- **Escribe en:** `acceso_perfiles`, `acceso_perfil_empresas`, `acceso_perfil_owners`, `acceso_perfil_permisos` y, vía recálculo, `perfil_acceso_empresas`, `perfil_acceso_owners`, `permisos_usuarios`, `acceso_perfil_materializado`
- **Lee de:** `empresas_permisos`, `owners`, `profiles`, `acceso_perfil_usuarios`

#### Bitácora de Auditoría

Consulta de la bitácora de auditoría con filtros por fecha, usuario, módulo, tabla y operación. Muestra el estado del registro antes y después del cambio y qué campos cambiaron. Se alimenta por triggers de base de datos, así que registra el cambio aunque se haga por fuera de la aplicación.

- **Archivo:** `components/configuration/bitacora-auditoria.tsx`
- **Permiso:** `bitacora_auditoria`
- **Escribe en:** —
- **Lee de:** `auditoria`, `auditoria_modulos`, `profiles`

#### Placas de Distribución

Maestro de las placas propias de cada proyecto. Determina qué movimientos se consideran de vehículo propio, lo que cambia a quién se le factura.

- **Archivo:** `components/configuration/placas-distribucion.tsx`
- **Permiso:** `placas_distribucion`
- **Escribe en:** `distribucion_placas`, `perfil_acceso_empresas`, `perfil_acceso_owners`
- **Lee de:** `empresas_permisos`, `owners`, `profiles`

---

## MRP

**6 módulos.**


#### Creación de materiales

Maestro de materiales de empaque y materia prima, resuelto por la tabla genérica de configuración.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `creacion_materiales`
- **Escribe en:** —
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `citasvehiculos`, `clientes`, `destinos`, `empresas_permisos`, `locations`, `materiales`, `owners`, `productos`, `proveedores`, `subcategorias`, `tarifas`, `tipodespacho`, `tiposvehiculos`, `transportes`

#### Ingresos MP

**Requiere revisión** — el módulo aparece en el menú y tiene permiso asignado (`ingresos_mp`), pero no tiene componente asociado en el enrutador: al seleccionarlo se muestra la pantalla de módulo no disponible. Está documentado en el módulo de Aprendizaje pero no implementado.

- **Archivo:** `—`
- **Permiso:** `ingresos_mp`
- **Tipo:** sin implementar
- **Escribe en:** —
- **Lee de:** —

#### Explosión de materiales

Descompone el producto terminado en sus componentes según la fórmula, para calcular el consumo de materiales. Escribe en `mrpexplosion`.

- **Archivo:** `components/material-explosion.tsx`
- **Permiso:** `explosion_materiales`
- **Escribe en:** `mrpexplosion`
- **Lee de:** `materiales`, `productos`

#### Gestión de proveedores

Maestro de proveedores, resuelto por la tabla genérica de configuración.

- **Archivo:** `components/configuration/generic-crud-table.tsx`
- **Permiso:** `gestion_proveedores`
- **Escribe en:** —
- **Lee de:** `almacenes`, `bodegas`, `categorias`, `citasvehiculos`, `clientes`, `destinos`, `empresas_permisos`, `locations`, `materiales`, `owners`, `productos`, `proveedores`, `subcategorias`, `tarifas`, `tipodespacho`, `tiposvehiculos`, `transportes`

#### Saldos de empaque

**Requiere revisión** — igual que Ingresos MP: figura en el menú con permiso (`saldos_empaque`) pero sin componente asociado en el enrutador.

- **Archivo:** `—`
- **Permiso:** `saldos_empaque`
- **Tipo:** sin implementar
- **Escribe en:** —
- **Lee de:** —

#### Saldos de materia prima

**Requiere revisión** — igual que los dos anteriores: en el menú con permiso (`saldos_materia_prima`) pero sin componente asociado.

- **Archivo:** `—`
- **Permiso:** `saldos_materia_prima`
- **Tipo:** sin implementar
- **Escribe en:** —
- **Lee de:** —


---

## Lista completa de permisos

La tabla `permisos_usuarios` tiene **142 campos de permiso**. No hay roles predefinidos: cada permiso se activa por usuario.

| # | Campo | Módulo(s) que habilita |
|---|---|---|
| 1 | `entrada_pedidos` | Entrada de pedidos |
| 2 | `gestionar_pedidos` | Gestionar pedidos |
| 3 | `gestion_integral_pedidos` | Gestión integral de pedidos |
| 4 | `dashboardpedidos` | Dashboard Pedidos |
| 5 | `generar_ordenes_cargue` | Generar Órdenes de Cargue |
| 6 | `generar_ordenes_descargue` | Generar Órdenes de Descargue |
| 7 | `distribucion` | Generar Orden de Distribución |
| 8 | `gestion_ordenes` | Gestión de Ordenes |
| 9 | `dashboardrecepcion` | Dashboard Despachos/Recepción |
| 10 | `registrar_vehiculos` | Registrar Vehículos |
| 11 | `ver_vehiculos` | Ver Vehículos |
| 12 | `bascula` | Báscula |
| 13 | `historial_bascula` | Historial Báscula |
| 14 | `transacciones_inventario` | Transacciones de Inventario |
| 15 | `saldos_inventario` | Saldos de inventario |
| 16 | `saldos_producto` | Saldos por producto |
| 17 | `reprocesos` | Reprocesos |
| 18 | `gestion_transacciones` | Gestión de transacciones |
| 19 | `ver_solicitudes_traslado` | Recepción de Traslado |
| 20 | `traslados_producto` | Traslados de producto |
| 21 | `capacidad_bodega` | Capacidad Bodega |
| 22 | `registro_qr_estibas` | Registro de QR estibas |
| 23 | `lectura_qr_estibas` | Lectura de QR estibas |
| 24 | `inventario_estiba` | Inventario por Estiba |
| 25 | `montacargasdia` | Montacargas y personal día |
| 26 | `ingreso_produccion` | Ingreso de Producción |
| 27 | `tolva` | Tolva |
| 28 | `ver_tolva` | Ver Tolva |
| 29 | `proyecciones` | Proyecciones |
| 30 | `ver_ingresos_produccion` | Ver ingresos de producción |
| 31 | `aprobacion_produccion` | Aprobación de ingreso de producción |
| 32 | `liquidacion_tolva` | Liquidación Tolva del día |
| 33 | `controlpiso` | Dashboard de Producción · Reporte de Paros |
| 34 | `asignacion_lotes` | Asignación de Lotes |
| 35 | `historial_lotes` | Historial de lotes |
| 36 | `registro_sanitario` | Registro sanitario |
| 37 | `ver_historial_inspeccion` | Ver historial de Inspección |
| 38 | `historial_aprobaciones` | Historial Aprobaciones |
| 39 | `picking` | Picking |
| 40 | `packing` | Packing |
| 41 | `ver_picking` | Ver Picking/Packing |
| 42 | `auditoria_inventario` | Panel LIP Inventario · Cuadre de Inventario · Auditoría de Inventario |
| 43 | `evidenciasido` | Centro de Evidencia ISO 9001 |
| 44 | `dashboard_operacion` | Dashboard Operacion |
| 45 | `asistenteia` | Asistente IA |
| 46 | `solicitudturnos` | Servicios Adicionales |
| 47 | `gestion_proveedores` | Gestión de proveedores |
| 48 | `creacion_materiales` | Creación de materiales |
| 49 | `explosion_materiales` | Explosión de materiales |
| 50 | `ingresos_mp` | Ingresos MP |
| 51 | `saldos_empaque` | Saldos de empaque |
| 52 | `saldos_materia_prima` | Saldos de materia prima |
| 53 | `tarifas` | Tarifas |
| 54 | `gestionfacturas` | Gestión de Facturas |
| 55 | `gastos` | Registrar Gasto · Dashboard Gastos |
| 56 | `estadoresultados` | Estado de Resultados |
| 57 | `dashboardop` | Dashboard Operaciones LIP |
| 58 | `prechequeo` | Registro Preoperacional |
| 59 | `aprobacionturnos` | Aprobar Turnos |
| 60 | `bitacora` | Bitácora |
| 61 | `headcount` | Head Count |
| 62 | `nominapersonal` | Nominapersonal |
| 63 | `liquidaciones` | Liquidaciones |
| 64 | `parafiscales` | Parafiscales |
| 65 | `revision_nomina` | Revisión de nómina |
| 66 | `registro_asistencia` | Registro de asistencia |
| 67 | `tabla_asistencia` | Tabla Asistencia |
| 68 | `asignacion_horas_extra` | Asignación horas extra |
| 69 | `novedades_personal` | Novedades de personal |
| 70 | `ausentismos` | Ausentismos |
| 71 | `recobro_incapacidades` | Recobro de Incapacidades |
| 72 | `vacaciones` | Vacaciones |
| 73 | `visor` | Visor |
| 74 | `gestion_contratos` | Gestión de Contratos |
| 75 | `dotacion_epp` | Gestión de Dotación EPP |
| 76 | `capacitaciones` | Gestión de Capacitaciones |
| 77 | `asistencia_capacitaciones` | Asistencia a Capacitaciones |
| 78 | `solicitud_personal` | Solicitud de Personal |
| 79 | `evaluacionpersonal` | Evaluaciones de Desempeño |
| 80 | `gestionsolicitudes` | Gestión de Solicitudes · Aprobación de Solicitudes de Personal · Hojas de Vida · Antecedentes |
| 81 | `evidenciasinducciones` | Evidencia de Inducciones |
| 82 | `inducciones` | Inducciones |
| 83 | `gestionturnos` | Turnos |
| 84 | `programacionturnos` | Programación de turnos |
| 85 | `notificaciones` | Notificaciones al Personal |
| 86 | `control_toneladas` | Control de Toneladas |
| 87 | `config_bodegas` | Bodegas |
| 88 | `config_categorias` | Categorías |
| 89 | `config_subcategorias` | Sub Categorías |
| 90 | `config_clientes` | Clientes |
| 91 | `config_condiciones_pago` | Condiciones Pago |
| 92 | `config_destinos` | *sin módulo en el menú actual* |
| 93 | `config_grupos` | *sin módulo en el menú actual* |
| 94 | `config_medios` | *sin módulo en el menú actual* |
| 95 | `config_productos` | Productos |
| 96 | `config_sucursales` | Sucursales |
| 97 | `config_tipos_despacho` | Tipos Despacho |
| 98 | `config_transportadoras` | Transportadoras |
| 99 | `config_tipos_vehiculos` | Tipos de Vehiculos |
| 100 | `config_vendedores` | Vendedores |
| 101 | `config_localizaciones` | Localizaciones |
| 102 | `gestion_usuarios` | Gestión de Usuarios |
| 103 | `accesos_usuario` | Accesos de Usuario |
| 104 | `bitacora_auditoria` | Bitácora de Auditoría |
| 105 | `placas_distribucion` | Placas de Distribución |
| 106 | `facturacion_proyectos` | Indicador de Facturación por Proyectos · Facturación Proyectos |
| 107 | `cuadro_facturacion` | Cuadro de Control Facturación · Resumen de Facturación por Proyecto |
| 108 | `conciliacion_avimol` | Conciliación Avimol |
| 109 | `prefactura_produccion` | Prefactura de Producción |
| 110 | `bonos` | Bonos |
| 111 | `apoyo_cargue` | Asignación de apoyo en cargue |
| 112 | `sst_auditoria` | Auditoría 0312 |
| 113 | `sst_autoevaluacion` | Matriz de Estándares |
| 114 | `sst_plan_mejora` | Plan de Mejoramiento |
| 115 | `sst_indicadores` | Indicadores SST |
| 116 | `sst_ipevr` | IPEVR |
| 117 | `sst_incidentes` | Investigación AT |
| 118 | `sst_epp` | Entrega de EPP |
| 119 | `sst_mantenimiento` | Equipos y Mantenimiento |
| 120 | `montacargas` | Gestión de Montacargas |
| 121 | `cargos_fijos` | Cargos Fijos |
| 122 | `sst_comunicacion` | Comunicación SST |
| 123 | `sst_gestion_cambio` | Gestión del Cambio |
| 124 | `sst_actividades` | Actividades y Comités |
| 125 | `sst_repositorio_soportes` | Repositorio de Soportes |
| 126 | `sst_alertas_at` | Alertas de AT |
| 127 | `sst_investigaciones` | Investigaciones Realizadas |
| 128 | `sst_medevac` | MEDEVAC |
| 129 | `sst_perfil` | Perfil Sociodemográfico |
| 130 | `examenes_medicos` | Examenes Médicos |
| 131 | `iso_repositorio` | Repositorio ISO 9001 |
| 132 | `sig_matriz` | Panel LIP Operación · Panel LIP Gestión Humana · Dashboard SIG · Análisis de Contexto DOFA · Matriz Integrada SIG · Repositorio por Norma SIG · Repositorio Universal · Objetivos y Metas SIG · No Conformidades SIG · Indicadores SIG · Evaluación por Área · Mapa de Interacción del Proceso |
| 133 | `sig_iso9001` | *sin módulo en el menú actual* |
| 134 | `sig_iso14001` | Aspectos e Impactos ISO 14001 · Matriz Legal Ambiental |
| 135 | `sig_iso45001` | *sin módulo en el menú actual* |
| 136 | `satisfaccion_pqrsf` | Satisfacción y PQRSF · Satisfacción y PQRSF |
| 137 | `calificacion_conductor` | Calificación del Conductor |
| 138 | `gestion_colaboradores` | Gestión de Colaboradores |
| 139 | `gh_carpetas` | Carpetas de Trabajadores |
| 140 | `gh_entrevistas` | Entrevistas |
| 141 | `gh_bienestar` | Programa de Bienestar |
| 142 | `gh_participacion` | Participación y Evidencias |

**5 permisos** no corresponden a ningún módulo del menú actual: `config_destinos`, `config_grupos`, `config_medios`, `sig_iso9001`, `sig_iso45001`. Pueden ser de módulos retirados o aún no publicados — **requieren revisión**.


---

## Vistas y funciones de base de datos por área

Las vistas concentran el cálculo del negocio: nómina y facturación no se calculan en la aplicación sino en SQL, para que todos los módulos obtengan el mismo número.

### Vistas principales

| Vista | Qué calcula |
|---|---|
| `pagonomina` | Liquidación diaria de nómina por persona: base del día, destajo, recargos, dominical y festivo, con corte por vínculo laboral |
| `archivoplano` | Novedades de la quincena por trabajador, en el formato que consume Siigo. Se construye sobre `pagonomina` |
| `facturacion` | Valor a facturar por línea de orden, según tarifa, owner y operación |
| `facturacionturnos` | Facturación de turnos y especialidades |
| `toneladasauxiliarespago` | Resumen diario de toneladas y pago por auxiliar |
| `saldoinvdetalle` | Saldo de inventario por producto, lote y localización |
| `invglobal` | Saldo consolidado por producto |
| `view_inventario_por_estiba` | Inventario visto por estiba (QR) |
| `vw_produccion_agrupada_10m` | Producción agregada en cubetas de 10 minutos |
| `historial_intervalos` | Lectura del contador de la máquina cada 2 minutos |
| `solicitud_horas_extras` | Solicitudes de horas extra (es una vista, no una tabla) |

### Qué vista consume cada área

| Área | Vistas |
|---|---|
| Recepción y Despacho | `invglobal`, `saldoinvdetalle`, `view_inventario_por_estiba` |
| Gestión de Pedidos | — |
| Almacenamiento | `facturacion`, `invglobal`, `saldoinvdetalle`, `view_inventario_por_estiba` |
| Producción | `historial_intervalos`, `horario_tolva`, `invglobal`, `saldoinvdetalle`, `view_inventario_por_estiba`, `vw_produccion_agrupada_10m` |
| Torre de Control | — |
| Operación LIP | `facturacion`, `horario_tolva`, `invglobal`, `saldoinvdetalle`, `view_inventario_por_estiba` |
| Gestión Financiera | `facturacion`, `facturacionturnos`, `pagonomina`, `saldoinvdetalle` |
| Gestión Humana | `facturacion`, `saldoinvdetalle`, `solicitud_horas_extras` |
| Compensación | `archivoplano`, `pagonomina`, `toneladasauxiliares`, `toneladasauxiliarespago` |
| Certificaciones · SIG (Calidad · Ambiente · SST) | `facturacion`, `saldoinvdetalle` |
| Seguridad y Salud en el Trabajo (SST) | — |
| Configuración | — |
| MRP | — |

> Esta tabla se construyó con el mismo criterio de las tablas por módulo: incluye lo que el módulo y sus dependencias directas alcanzan. Los módulos de `components/sst/` comparten una biblioteca de indicadores que lee `facturacion`, por eso esa vista aparece en áreas que no la usan directamente —por ejemplo Matriz Legal Ambiental—. **Requiere revisión** si se va a usar esta tabla para decidir permisos de base de datos.

### Funciones y disparadores

| Objeto | Qué hace | Script |
|---|---|---|
| `fn_sync_produccion_to_invtrans()` + `trg_produccion_after_insert` | Lleva a inventario, de forma automática, toda producción que entre a la tabla `produccion`, venga del sistema de planta o de LIPgo | `scripts/125_fix_trigger_produccion_fechaprod.sql` |
| `calcular_y_asignar_horas_extras()` | Calcula las horas extra al registrar la asistencia, según jornada y tolerancia vigentes | `scripts/049_fn_calcular_y_asignar_horas_extras.sql` |
| Disparadores de auditoría | Registran cada INSERT, UPDATE y DELETE en la tabla `auditoria`, con el estado antes y después y los campos que cambiaron | `scripts/auditoria/03_fn.sql`, `04_attach.sql` |


---

*Generado recorriendo el repositorio. Ante una diferencia entre este documento y el código, manda el código.*
