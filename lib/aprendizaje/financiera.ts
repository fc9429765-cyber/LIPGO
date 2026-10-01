// Guias del modulo Aprendizaje — area "financiera".
// Generado por entregas; la clave `modulo` debe coincidir EXACTA con el menu.
import type { ContenidoAprendizaje } from "@/lib/aprendizaje-content"

export const APRENDIZAJE_FINANCIERA: ContenidoAprendizaje[] = [
  // ==========================================================================
  // GESTION FINANCIERA · Indicador de Facturacion por Proyectos
  // ==========================================================================
  {
    modulo: "Indicador de Facturación por Proyectos",
    resumen: "Vista gerencial que compara los proyectos en gestion de facturacion y muestra el valor pendiente por solicitar.",
    proposito:
      "Responde de un vistazo la pregunta gerencial: de todo lo facturable, cuanto ya tiene solicitud de factura y cuanto sigue pendiente, proyecto por proyecto, contra una meta del 95%. Lo pendiente lo solicita el coordinador; la factura en firme la hace finanzas. Por defecto muestra el mes actual, porque el pendiente viejo ya se considera cerrado.",
    puedes: [
      "Ver el porcentaje de gestion de facturacion consolidado y por proyecto, con semaforo de color contra la meta del 95%.",
      "Ver el valor pendiente por facturar y cuantas ordenes lo componen.",
      "Detectar el valor en riesgo: lo que lleva mas de 8 dias sin gestionarse.",
      "Comparar los proyectos en una barra con marcador de meta y en una tabla de detalle (facturables, pendientes, gestion, valores y dias maximos sin gestion).",
      "Cambiar el rango de fechas, volver al mes actual con un clic o ver el historico completo.",
    ],
    noPuedes: [
      "Solicitar o montar facturas desde aqui: es un indicador de seguimiento, la gestion se hace en los modulos de facturacion.",
      "Modificar datos: es solo lectura.",
    ],
    funcionalidades: [
      {
        nombre: "Indicadores consolidados",
        descripcion:
          "Cuatro tarjetas: gestion de facturacion (solicitadas sobre el total, meta 95%), valor pendiente por facturar, valor en riesgo (mas de 8 dias) y operaciones facturables del periodo.",
      },
      {
        nombre: "Gestion por proyecto",
        descripcion:
          "Una barra por proyecto con el marcador de la meta del 95% y el color segun que tan cerca este; debajo, el numero de pendientes y su valor.",
      },
      {
        nombre: "Filtro de periodo",
        descripcion:
          "Arranca en el mes actual. El boton Este mes vuelve al presente y Ver historico abre todo lo acumulado: la informacion nunca se borra, solo se filtra.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Facturacion Proyectos
  // ==========================================================================
  {
    modulo: "Facturación Proyectos",
    resumen: "Consulta el detalle de lo que se factura por toneladas y por turnos, con totales y exportacion a Excel.",
    proposito:
      "Es la lupa de la facturacion: muestra registro por registro el valor a facturar de cada cargue (tarifa por toneladas) y, en pestana aparte, la facturacion de los turnos de especialidad con su costo y utilidad. Se usa para revisar, soportar y exportar lo que se le cobra al cliente.",
    puedes: [
      "Consultar la pestana de toneladas: cada registro con fecha, cliente, orden, tiquete de bascula, placa, producto, peso, tarifa y valor a facturar.",
      "Consultar la pestana de turnos: la facturacion de turnos de especialidad con horas extra, valor facturado, costo total y utilidad.",
      "Filtrar por rango de fechas, owner, placa, subcategoria, proyecto, transportadora y tipo de operacion (seleccion multiple).",
      "Ver los totales del filtro aplicado: valor total a facturar y toneladas; en turnos, facturacion, costo y utilidad.",
      "Exportar a Excel lo filtrado, con fila de totales incluida.",
    ],
    noPuedes: [
      "Cambiar tarifas o valores desde aqui: las tarifas se administran en el modulo Tarifas.",
      "Marcar ordenes como facturadas: el estado de factura se maneja en Gestion de Facturas y solo cambia con la factura real de Siigo.",
    ],
    funcionalidades: [
      {
        nombre: "Pestana Toneladas",
        descripcion:
          "El detalle de la facturacion por cargue. Arranca mostrando el proyecto activo del selector global, y en los filtros se puede cambiar a otro proyecto al que tengas acceso.",
      },
      {
        nombre: "Pestana Turnos",
        descripcion:
          "La facturacion de los turnos de especialidad: por persona, puesto y fecha, con horas extra, valor a facturar, costo y utilidad de cada turno.",
      },
      {
        nombre: "Exportacion a Excel",
        descripcion:
          "Cada pestana tiene su boton de descarga: genera el archivo con las columnas de la tabla y los totales, listo para anexar o revisar por fuera.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Cuadro de Control Facturacion
  // ==========================================================================
  {
    modulo: "Cuadro de Control Facturación",
    resumen: "Cruza las ordenes procesadas contra lo facturado por owner: en rojo lo que quedo sin facturar.",
    proposito:
      "Garantiza que todo lo procesado se facture. Parte de las ordenes de servicio ya procesadas (la fuente de verdad) y las cruza con lo facturado, owner por owner: en rojo queda lo sin gestionar (procesado sin facturar) y lo sin tarifa. La regla es firme: una orden queda facturada SOLO cuando se monta la factura real de Siigo; ningun otro paso cambia ese estado. De aqui salen los anexos por proyecto.",
    puedes: [
      "Elegir el proyecto a controlar y filtrar por fechas, owner, estado (facturado, en proceso, sin gestionar), cliente y operacion con chips de seleccion multiple.",
      "Ver el resumen por owner y el detalle orden por orden, con semaforo: verde lo que sigue por facturar y rojo lo que ya tiene factura de Siigo (para no recobrar).",
      "Armar una prefactura con lo filtrado, guardarla, cambiarle el estado o eliminarla.",
      "Revisar el cierre de facturacion del dia (siempre visible arriba) y la pestana de Cierre Financiero, que compara lo pagado contra lo facturado por proceso.",
      "Consultar las reglas de facturacion del proyecto seleccionado antes de leer los numeros: que se cobra, a quien y bajo que criterio.",
      "Exportar a Excel el detalle y los anexos agrupados por owner y operacion, con subtotales por hoja.",
    ],
    noPuedes: [
      "Marcar algo como facturado a mano: el estado solo cambia cuando se monta la factura real de Siigo.",
      "Controlar ordenes sin procesar: el cuadro parte de lo ya procesado.",
      "Sumar horas y turnos como tonelaje: comparten la columna de cantidad pero solo las toneladas suman al total de toneladas del documento.",
    ],
    funcionalidades: [
      {
        nombre: "Resumen por owner y detalle por orden",
        descripcion:
          "El resumen agrupa toneladas y valor por owner y operacion; el detalle baja hasta cada orden con su tarifa, valor y estado. Lo sin tarifa se resalta para corregirlo en el modulo Tarifas.",
      },
      {
        nombre: "Prefactura",
        descripcion:
          "Convierte lo filtrado en un documento de soporte (anexo) agrupado por owner y operacion, que se guarda con su historial y sirve de base para pasar la factura.",
      },
      {
        nombre: "Cierre de facturacion y Cierre Financiero",
        descripcion:
          "El cierre del dia muestra el estado diario y sus alertas; el Cierre Financiero cruza lo pagado contra lo facturado por proceso, con las reglas de medio de pago de cada proyecto.",
      },
      {
        nombre: "Filtro de operaciones",
        descripcion:
          "Sin marcar nada se ven todas las operaciones. Para la factura del owner en cedis se marcan solo Cargue y Distribucion (los descargues quedan fuera); el chip de Produccion aisla lo que se cobra por produccion.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
    consejos: [
      "La vista arranca desde la fecha en que la gestion paso a LIPgo (lo anterior ya se facturo manual). Cambia el filtro Desde si necesitas el historico completo.",
      "Si una linea aparece sin tarifa, corrigela en el modulo Tarifas antes de armar la prefactura: mientras tanto se cobra en cero.",
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Resumen de Facturacion por Proyecto
  // ==========================================================================
  {
    modulo: "Resumen de Facturación por Proyecto",
    resumen: "Consulta rapida por proyecto: lo esperado segun el acuerdo contra lo que de verdad se factura y a quien.",
    proposito:
      "Es la pagina de referencia rapida de gerencia: para cada proyecto muestra cuanto se esperaba facturar segun el acuerdo, cuanto se facturo de verdad, la diferencia y el cumplimiento de volumen, junto con el desglose de a quien se le factura cada operacion. Usa el mismo motor que el Cuadro de Control, asi que los numeros de ambos siempre cuadran.",
    puedes: [
      "Ver por proyecto cuatro indicadores: esperado segun acuerdo, real facturado, diferencia y cumplimiento de volumen.",
      "Ver a quien se le factura cada operacion, con sus toneladas y valor real; lo cubierto por el cargo fijo aparece marcado y en cero.",
      "Cambiar el periodo: un mes puntual o los doce meses completos del anio que elijas.",
      "Refrescar los datos con el boton Actualizar.",
    ],
    noPuedes: [
      "Editar nada: es una pagina de consulta, sin acciones.",
      "Bajar al detalle orden por orden: para eso esta el Cuadro de Control Facturacion.",
    ],
    funcionalidades: [
      {
        nombre: "Tarjeta por proyecto",
        descripcion:
          "Cada proyecto al que tienes acceso aparece con sus indicadores y su tabla de operaciones, todo en una sola pantalla para comparar de corrido.",
      },
      {
        nombre: "Esperado contra real",
        descripcion:
          "El esperado sale del acuerdo comercial del proyecto y el real de la facturacion efectiva; la diferencia se colorea segun quede por encima o por debajo.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Cargos Fijos
  // ==========================================================================
  {
    modulo: "Cargos Fijos",
    resumen: "Administra los cobros y pagos fijos mensuales: alquiler de montacargas y cargos de cada proyecto.",
    proposito:
      "Aqui viven los conceptos que se facturan o pagan por un monto fijo cada mes, sin relacion con ordenes de cargue ni turnos: el alquiler de montacargas por equipo y los cargos fijos del proyecto (un valor mensual o un tonelaje fijo, segun el proyecto). Cada mes se generan los registros del periodo y se les hace seguimiento con el mismo criterio de toda la facturacion: solo la factura real de Siigo los deja en facturado.",
    puedes: [
      "Generar los cargos del mes con un boton: crea lo que falte y no duplica lo que ya existia.",
      "Ver el ingreso fijo y el gasto fijo del mes, filtrando por proyecto y periodo.",
      "Marcar un cargo de ingreso como solicitado, subirle la factura de Siigo o quitarsela si se adjunto por error.",
      "Configurar el alquiler de cada montacargas: equipo, proveedor, valor pagado, valor facturado y vigencia.",
      "Configurar los cargos fijos de cada proyecto: concepto, valor o toneladas fijas mensuales.",
      "Ver el comparativo informativo de toneladas fijas contra las reales del mes, en el proyecto que cobra por tonelaje fijo.",
    ],
    noPuedes: [
      "Cobrar el fijo en proporcion al real: el fijo se cobra completo sin importar el tonelaje del mes; el comparativo es solo informativo.",
      "Dejar un cargo en facturado sin montar la factura real de Siigo.",
    ],
    funcionalidades: [
      {
        nombre: "Vista Del mes",
        descripcion:
          "La tabla del periodo: cada cargo con su proyecto, concepto, tipo (ingreso o gasto), valor y estado (facturado, en proceso o sin gestionar), con las acciones de solicitar y adjuntar factura en la misma fila.",
      },
      {
        nombre: "Configuracion",
        descripcion:
          "Dos bloques: alquiler de montacargas por equipo (con vigencias, porque no todos los proyectos lo facturan aparte) y cargos fijos por proyecto. Lo configurado aqui es lo que la generacion mensual usa.",
      },
      {
        nombre: "Generacion mensual segura",
        descripcion:
          "Generar el mes las veces que sea no duplica nada: el sistema informa cuantos cargos creo y cuantos ya existian.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
    consejos: [
      "Si el mes aparece vacio, primero usa Generar cargos del mes: la tabla solo muestra lo ya generado.",
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Conciliacion Avimol
  // ==========================================================================
  {
    modulo: "Conciliación Avimol",
    resumen: "Cruza dia a dia lo que se cobra por produccion contra lo que se paga en turnos en el proyecto Avimol.",
    proposito:
      "Ese proyecto tiene un modelo asimetrico: se paga al personal por turnos y se cobra al cliente por produccion (el tonelaje de tolva valorizado por tarifa), mas horas extra y turnos cobrables. Esta pantalla cruza ambos lados en dinero, dia por dia, muestra el margen y avisa de todo lo que impide cobrar o cuadrar: tarifas faltantes, turnos sin liquidar, horas extra sin solicitud, entre otros.",
    puedes: [
      "Conciliar un rango de fechas y ver los indicadores: toneladas de ingreso, cobro por produccion, cobro de horas extra, cobro de turnos, cobro total, pago total y margen (con los dias en perdida).",
      "Revisar las alertas agrupadas por tipo: sin tarifa vigente, turnos sin liquidar, horas extra sin solicitud aprobada, turnos trabajados sin solicitud (no se facturan) y mas.",
      "Expandir cualquier dia del cruce para ver el desglose de productos facturados y las personas del turno.",
      "Pasar a la pestana Prefactura y emitir la prefactura de produccion del proyecto sin salir del modulo.",
    ],
    noPuedes: [
      "Usarlo para otros proyectos: esta fijado al proyecto Avimol.",
      "Corregir aqui lo que dispara una alerta: la tarifa se arregla en Tarifas, el turno en su liquidacion y la hora extra en su solicitud; la conciliacion solo lo evidencia.",
    ],
    funcionalidades: [
      {
        nombre: "Cruce por dia",
        descripcion:
          "Una fila por dia con tonelaje, cobros, pago y margen; al expandirla se ve que productos se facturaron y que personas trabajaron el turno de ese dia.",
      },
      {
        nombre: "Alertas de conciliacion",
        descripcion:
          "Cada cosa que deja plata en el aire aparece listada con su detalle: lo que se cobra en cero por falta de tarifa, lo ejecutado por encima de lo solicitado, lo trabajado sin solicitud, etc.",
      },
      {
        nombre: "Prefactura embebida",
        descripcion:
          "La segunda pestana es el mismo modulo de Prefactura de Produccion, ya fijado a este proyecto, para pasar de la conciliacion al documento cobrable en un paso.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Prefactura de Produccion
  // ==========================================================================
  {
    modulo: "Prefactura de Producción",
    resumen: "Emite el documento cobrable de lo que se factura por produccion, con soporte y ciclo de aprobacion.",
    proposito:
      "Para los proyectos que facturan por produccion: en uno se cobra el tonelaje de salvado y estibado (con festivos) mas las horas extra; en el otro, sus ordenes de tolva. El ciclo es: generar el periodo, marcar que lineas se facturan, guardar el borrador y aprobarlo cuando ya se le paso al cliente.",
    puedes: [
      "Elegir el proyecto y el rango de fechas, y generar la prefactura del periodo con su resumen y su soporte detallado.",
      "Marcar o desmarcar las lineas que entran al documento antes de guardarlo.",
      "Guardar borradores con observaciones y aprobarlos cuando esten en firme.",
      "Eliminar un borrador que no va, o reabrir una prefactura aprobada si hay que corregirla.",
      "Revisar las alertas del periodo: ingresos con lote invalido que no se facturan, tarifas faltantes que cobran en cero, turnos sin liquidar, horas extra sin solicitud o por encima de lo solicitado.",
      "Descargar el documento y su soporte a Excel.",
    ],
    noPuedes: [
      "Eliminar una prefactura aprobada: primero hay que reabrirla, porque el documento ya se le paso al cliente.",
      "Facturar en firme desde aqui: la prefactura es el soporte del cobro; la factura real se monta en Siigo.",
      "Generar sin darte cuenta un periodo ya facturado: si el rango se solapa con una prefactura guardada, el sistema pide confirmacion.",
    ],
    funcionalidades: [
      {
        nombre: "Generacion por periodo",
        descripcion:
          "Arma el resumen cobrable del rango elegido segun el modelo del proyecto (tonelaje de produccion mas horas extra, u ordenes de tolva) con el anexo linea por linea.",
      },
      {
        nombre: "Ciclo borrador y aprobacion",
        descripcion:
          "Los documentos guardados quedan en una lista con su estado: un borrador se puede aprobar o eliminar; una aprobada solo se puede reabrir. Cada guardada conserva su soporte para consultarlo despues.",
      },
      {
        nombre: "Alertas del periodo",
        descripcion:
          "Antes de guardar, el modulo lista todo lo que afecta el cobro para corregirlo a tiempo en el modulo de origen.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
    consejos: [
      "El anexo en pantalla se corta cuando el mes es muy grande; el Excel descargado si trae todas las filas.",
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Tarifas
  // ==========================================================================
  {
    modulo: "Tarifas",
    resumen: "Administra por pestanas todas las tarifas que mueven la facturacion y la nomina.",
    proposito:
      "Aqui viven los valores que alimentan los calculos de toda la aplicacion: los parametros legales de nomina por vigencia, la tarifa de cobro al cliente por tonelada, la tarifa de pago a los auxiliares, las metas de toneladas, los turnos de especialidad y sus tarifas de facturacion y costo. Cada pestana explica que calculos dependen de esa tarifa antes de dejarte tocarla, porque un cambio aqui impacta ingresos, costos o nomina desde su vigencia.",
    puedes: [
      "Consultar y editar el cuadro de mando de nomina: parametros legales por vigencia de fecha (salario minimo, auxilio, dias, jornada y porcentajes de recargo), incluso programar cambios futuros como los de mitad de anio.",
      "Administrar la tarifa de facturacion al cliente por tonelada, que define el valor a facturar de cada cargue.",
      "Administrar la tarifa de pago a destajo de los auxiliares, que define el costo de nomina de produccion.",
      "Definir la meta de toneladas por persona y proyecto: es un indicador de productividad, no cambia la liquidacion ni el bono.",
      "Registrar que puestos son turno de especialidad con su vigencia, y las tarifas de facturacion y costo de esos turnos.",
      "Duplicar las tarifas de una pestana a otro periodo para no digitarlas de nuevo en cada vigencia.",
    ],
    noPuedes: [
      "Ver aqui el efecto de un cambio: las tarifas alimentan otros modulos (facturacion, estado de resultados, nomina) y alli es donde se refleja.",
      "Cambiar una tarifa sin impacto: todo cambio afecta los calculos desde su vigencia, por eso cada pestana muestra primero que depende de ella.",
    ],
    funcionalidades: [
      {
        nombre: "Pestanas con texto de impacto",
        descripcion:
          "Cada pestana (cuadro de mando, operacion, personal, metas, turnos, facturacion por turnos y tarifas base) abre con un recuadro que explica que calculos usan esa tarifa y como.",
      },
      {
        nombre: "Vigencias programables",
        descripcion:
          "Los parametros y tarifas se guardan por rango de fechas: se puede dejar cargado desde ya el valor que rige a futuro y el sistema aplica cada uno en su periodo.",
      },
      {
        nombre: "Duplicar a otro periodo",
        descripcion:
          "Copia las tarifas de la pestana actual a un periodo nuevo de una sola vez, para ajustar solo lo que cambia.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
    consejos: [
      "Lee el recuadro de impacto antes de editar: te dice exactamente que se mueve con esa tarifa.",
      "En la pestana de turnos lo que importa es el puesto, la especialidad y la vigencia; los valores de dinero de los turnos se calculan desde el salario con el cuadro de mando.",
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Estado de Resultados
  // ==========================================================================
  {
    modulo: "Estado de Resultados",
    resumen: "El estado de perdidas y ganancias de cada proyecto o de toda la empresa: ingresos, nomina, gastos y utilidad.",
    proposito:
      "Consolida el resultado del periodo: los ingresos (toneladas, turnos, produccion y cargos fijos, cada fila con su detalle), el costo de nomina con provisiones, la utilidad bruta, los gastos por categoria y la utilidad neta. Se puede mirar un proyecto o toda la empresa junta, por quincena, por mes o el periodo anual completo.",
    puedes: [
      "Elegir el proyecto con el selector propio del modulo, o la opcion de todos los proyectos para ver el total de la empresa (arranca en el proyecto del selector global, pero no depende de el).",
      "Elegir el periodo: quincena, mes o los doce meses completos del anio que quieras.",
      "Abrir el detalle de cada fila de ingresos para ver de donde sale el valor.",
      "Ver el costo de nomina con sus provisiones, la utilidad bruta, los gastos por categoria y la utilidad neta del periodo.",
      "Consultar la pestana de Analisis Financiero: lo acordado contra lo real por proyecto, el deficit y los valores adicionales a facturar.",
      "Refrescar todos los datos con el boton Actualizar.",
    ],
    noPuedes: [
      "Editar cifras: el estado se arma solo con lo registrado en los demas modulos (facturacion, nomina, gastos, cargos fijos).",
      "Divulgar el contenido del Analisis Financiero: los acuerdos comerciales que muestra son confidenciales y solo viven dentro del sistema.",
    ],
    funcionalidades: [
      {
        nombre: "Ingresos con detalle",
        descripcion:
          "Cada fuente de ingreso del periodo aparece como una fila con su valor y su detalle expandible, incluyendo la produccion, los turnos y los cargos fijos del proyecto.",
      },
      {
        nombre: "Costo de nomina y provisiones",
        descripcion:
          "Muestra el total liquidado de nomina del periodo mas las provisiones, para que la utilidad bruta refleje el costo real y no solo lo pagado.",
      },
      {
        nombre: "Gastos y utilidad neta",
        descripcion:
          "Los gastos registrados en el modulo de gastos entran por categoria y cierran el calculo: utilidad bruta menos gastos igual utilidad neta.",
      },
      {
        nombre: "Analisis Financiero",
        descripcion:
          "Pestana confidencial con los acuerdos de volumenes por proyecto: compara lo acordado contra lo real del periodo y calcula el deficit y lo adicional a facturar.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Registrar Gasto
  // ==========================================================================
  {
    modulo: "Registrar Gasto",
    resumen: "Reporta un gasto operativo desde el campo, con foto o PDF del soporte.",
    proposito:
      "Cualquier gasto del dia a dia (combustible, peajes, alimentacion, mantenimiento, etc.) se registra aqui en el momento, con su categoria, monto, descripcion y soporte. Queda amarrado al proyecto activo y alimenta de inmediato el Dashboard de Gastos y los gastos del Estado de Resultados.",
    puedes: [
      "Registrar la fecha, la categoria (de una lista fija), el monto y la descripcion del gasto.",
      "Adjuntar el soporte en foto o PDF (opcional, hasta 10 MB), con vista previa de la imagen antes de guardar.",
      "Registrar el gasto contra el proyecto activo del selector global.",
      "Ver que campos faltan antes de guardar: el formulario lo indica en lugar de dejar el boton apagado sin explicacion.",
    ],
    noPuedes: [
      "Guardar sin proyecto activo, sin categoria, sin monto valido o sin una descripcion minima.",
      "Editar o eliminar un gasto ya registrado desde este formulario.",
    ],
    funcionalidades: [
      {
        nombre: "Categorias fijas",
        descripcion:
          "El gasto se clasifica en una lista cerrada (combustible, peajes, mantenimiento, alimentacion, hospedaje, papeleria, servicios publicos, nomina, otros) para que el dashboard agrupe parejo.",
      },
      {
        nombre: "Soporte opcional",
        descripcion:
          "Se permite registrar sin adjunto (por ejemplo anticipos en efectivo o gastos menores); si se sube, el sistema valida el tipo y el tamano del archivo.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
    consejos: [
      "Registra el gasto con su soporte en el momento: despues es mas dificil recuperar la foto del recibo.",
    ],
  },

  // ==========================================================================
  // GESTION FINANCIERA · Dashboard Gastos
  // ==========================================================================
  {
    modulo: "Dashboard Gastos",
    resumen: "El tablero de los gastos operativos registrados: totales, filtros y acceso a los soportes.",
    proposito:
      "Es donde administracion revisa lo que el equipo registro en Registrar Gasto: el total del mes, el acumulado anual, cuantos gastos van y el valor promedio, con filtros para bajar a cualquier detalle y abrir el soporte de cada gasto.",
    puedes: [
      "Ver los indicadores del proyecto activo: total del periodo filtrado, acumulado anual, cantidad de gastos y valor promedio por gasto.",
      "Filtrar por rango de fechas y por categoria, y buscar por texto en la descripcion.",
      "Abrir el soporte (foto o PDF) de cualquier gasto en otra pestana del navegador.",
      "Ver quien registro cada gasto y cuando.",
    ],
    noPuedes: [
      "Editar, aprobar o eliminar gastos: es solo consulta.",
      "Ver gastos de un proyecto distinto al activo en el selector global: el tablero respeta el aislamiento por proyecto.",
    ],
    funcionalidades: [
      {
        nombre: "Indicadores de gasto",
        descripcion:
          "Cuatro tarjetas de lectura rapida: total del rango filtrado, acumulado del periodo anual, numero de gastos y ticket promedio.",
      },
      {
        nombre: "Tabla con soporte",
        descripcion:
          "Cada fila muestra fecha, categoria, monto, descripcion y quien lo registro, con el boton para ver el soporte adjunto cuando existe.",
      },
      {
        nombre: "Clave de acceso",
        descripcion:
          "Al abrir el modulo se pide la clave del grupo de Gestion Financiera. Se ingresa una sola vez por pestana del navegador y es un control adicional a los permisos de usuario.",
      },
    ],
  },
  // Guías agregadas 2026-09-30 (reorg de navegación: el buscador global usa este texto).
  {
    modulo: "Consulta Facturas SIIGO",
    resumen: "Ventana de solo lectura a las facturas de Siigo: listado, detalle y PDF.",
    proposito: "Permite consultar la contabilidad real de la empresa (todas las ventas, a todos los clientes, con sus saldos) sin salir de LIPgo y sin tocar nada en Siigo. Requiere la clave financiera porque muestra toda la facturación, no solo la que genera LIPgo.",
    puedes: [
      "Buscar facturas por cliente, fecha o número.",
      "Ver el detalle de cada factura y descargar su PDF.",
      "Revisar saldos y estado de pago tal como están en Siigo."
    ],
    noPuedes: [
      "Crear, modificar o anular facturas: eso se hace en Siigo.",
      "Verlo sin la clave financiera: es información de LIP."
    ],
    funcionalidades: [
      {
        nombre: "Listado",
        descripcion: "Facturas sincronizadas desde la API de Siigo con filtros por cliente, rango de fechas y número."
      },
      {
        nombre: "Detalle y PDF",
        descripcion: "Líneas, valores e impuestos de la factura y descarga del PDF oficial."
      },
      {
        nombre: "Sincronización",
        descripcion: "Muestra cuándo fue la última lectura desde Siigo; los datos no se editan aquí."
      }
    ]
  },
  {
    modulo: "Ciclo de Facturación",
    resumen: "Flujo documental de cada prefactura aprobada: anexo, firma del cliente, factura, firma y cierre, más cartera.",
    proposito: "Lleva paso a paso cada prefactura desde que se envía el anexo hasta que se cierra y se cobra. Separa lo que hace el Jefe de Facturación (enviar anexo, enviar factura, cerrar) de lo que confirma el Coordinador (firmas del cliente), y desde el cierre calcula días vencidos y pagos.",
    puedes: [
      "Ver en qué paso está cada prefactura y quién debe actuar.",
      "Registrar el envío del anexo y de la factura (Jefe) y la firma del cliente (Coordinador).",
      "Cerrar el ciclo y registrar pagos; ver cartera con días vencidos.",
      "Saltar a Gestión de Facturas, ya filtrado, para resolver órdenes sin gestionar."
    ],
    noPuedes: [
      "Saltarse pasos: cada etapa exige la anterior.",
      "Editar los valores de la prefactura: eso se hace en Prefactura de Producción o en el Cuadro de Control."
    ],
    funcionalidades: [
      {
        nombre: "Tablero por etapa",
        descripcion: "Prefacturas agrupadas por etapa del ciclo, con fechas y responsable de cada paso."
      },
      {
        nombre: "Acciones por rol",
        descripcion: "El Jefe de Facturación envía y cierra; el Coordinador confirma las firmas del cliente. Cada acción queda con fecha y usuario."
      },
      {
        nombre: "Cartera",
        descripcion: "Desde el cierre, días vencidos según las condiciones de pago y registro de pagos recibidos."
      },
      {
        nombre: "Alertas",
        descripcion: "Avisos de órdenes sin gestionar y de etapas atrasadas, con salto directo a resolverlas."
      }
    ]
  },
  {
    modulo: "Corrección de Órdenes",
    resumen: "Buscar una orden por número y corregir sus datos (peso, placa, producto, líneas) con motivo obligatorio y auditoría.",
    proposito: "Antes, un dato mal cargado en una orden solo se corregía a mano en la base de datos. Aquí Facturación busca la orden y corrige cabecera y líneas desde la app; cada corrección exige un motivo y queda auditada campo por campo en la Bitácora de Auditoría.",
    puedes: [
      "Corregir peso de báscula y de orden, placa, conductor, transporte, cliente, fecha de cargue, auxiliares, muelle y tipo de pago.",
      "Editar, agregar o eliminar líneas de producto.",
      "Dejar el motivo de la corrección, que queda registrado con quién y cuándo."
    ],
    noPuedes: [
      "Cambiar el número de orden ni los datos de factura (factura Siigo, estado de factura): esos los maneja el flujo de facturación.",
      "Corregir sin motivo."
    ],
    funcionalidades: [
      {
        nombre: "Búsqueda por número",
        descripcion: "Se escribe el número exacto de la orden y se carga su cabecera y sus líneas."
      },
      {
        nombre: "Cabecera editable",
        descripcion: "Los campos corregibles de la orden; los de factura se muestran solo para contexto."
      },
      {
        nombre: "Líneas",
        descripcion: "Tabla editable de productos con cantidad y toneladas; se pueden agregar y eliminar líneas."
      },
      {
        nombre: "Auditoría",
        descripcion: "El motivo va a un registro propio y el antes y después de cada campo queda en la Bitácora de Auditoría."
      }
    ]
  },
]
