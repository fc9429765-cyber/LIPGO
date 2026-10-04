// Guias del modulo Aprendizaje — area "operacion-lip".
// Generado por entregas; la clave `modulo` debe coincidir EXACTA con el menu.
import type { ContenidoAprendizaje } from "@/lib/aprendizaje-content"

export const APRENDIZAJE_OPERACION_LIP: ContenidoAprendizaje[] = [
  // ==========================================================================
  // CONSIGNAR PROGRAMACION DEL CLIENTE (2026-10-01)
  // ==========================================================================
  {
    modulo: "Consignar programación del cliente",
    resumen: "El coordinador consigna los vehiculos que el cliente programa para manana y ve cuanto se cumplio cada dia.",
    proposito:
      "El cliente envia un dia antes su programacion de vehiculos para manana (cuantos, de que tipo, a que destino o ruta). El coordinador LIP es el responsable de consignarla en LIPgo antes de las 5:00 p. m. (el cliente tambien puede registrarla desde Pedidos y solicitudes si quiere; vale la ultima version). Con ella se planea la operacion y el personal, y se mide el cumplimiento del cliente: cuantos vehiculos programados llegaron de verdad a porteria, por tipo de vehiculo.",
    puedes: [
      "Consignar la programacion de manana (o de otra fecha) con lineas de cantidad, tipo de vehiculo del catalogo, destino o ruta y producto opcional.",
      "Corregirla cuando el cliente cambie algo: cada envio queda como version nueva y la ultima es la vigente.",
      "Ver si quedo a tiempo (antes de las 5:00 p. m. del dia anterior) o tarde, quien la consigno y el historial de versiones.",
      "Consultar el cumplimiento por semana, quincena, mes o fechas libres, con el detalle de cada dia por tipo de vehiculo.",
      "Llegar desde Operacion del dia: el chip 'Programacion del cliente' y el punto de cierre 'Programacion de manana recibida' abren esta pestana.",
    ],
    noPuedes: [
      "Medir el cumplimiento por destino: porteria registra el tipo de vehiculo, no el destino; la medicion es por tipo.",
      "Borrar una programacion consignada: queda el historial de versiones.",
      "Registrar la llegada de vehiculos: eso lo hace porteria en Registrar Vehiculos; aqui solo se programa y se compara.",
    ],
    funcionalidades: [
      {
        nombre: "Programacion del dia elegido",
        descripcion:
          "Botones Manana y Hoy o fecha libre. Estado (sin programacion, a tiempo o tarde, version, total de vehiculos), lineas vigentes y boton para modificar creando una version nueva.",
      },
      {
        nombre: "Formulario de lineas",
        descripcion:
          "Cantidad, tipo de vehiculo (catalogo Tipos de Vehiculos con capacidad), destino o ruta con sugerencias, producto opcional y observacion. Al enviar queda la hora, quien la consigno y si fue a tiempo.",
      },
      {
        nombre: "Cumplimiento",
        descripcion:
          "Programado vs. llegado a porteria por dia y por tipo de vehiculo: porcentaje, no llegaron, fuera de programacion, enviadas a tiempo, dias operados sin programacion y grafico del rango.",
      },
    ],
    consejos: [
      "Consignala apenas llegue el WhatsApp o el Excel del cliente: despues de las 5:00 p. m. queda marcada como tarde.",
      "Si el cliente escribe 'Doble troque' y el catalogo dice 'Dobletroque', el cruce igual los reconoce como el mismo tipo.",
    ],
  },
  // ==========================================================================
  // OPERACION LIP · Cargue / Descargue
  // ==========================================================================
  {
    modulo: "Picking",
    resumen: "Ejecuta y cierra el cargue de las ordenes pendientes, paso a paso.",
    proposito:
      "Es la pantalla del operario durante el cargue. Muestra las ordenes de cargue pendientes del proyecto y guia el ciclo completo en orden: realizar el picking (verificar producto por producto), generar el documento del cargue, asignar el personal que participo y cerrar la orden cargando las fotos. Cada paso se habilita solo cuando el anterior esta completo, asi el siguiente paso siempre es evidente.",
    puedes: [
      "Realizar el picking de una orden: verificar cada producto de forma simple o escaneando el QR de la estiba (la verificacion por QR descuenta del inventario la estiba real).",
      "Ajustar la cantidad verificada de una linea; si es menor a la pedida, el sistema pide confirmarlo antes de aceptar.",
      "Generar el documento del cargue, que ademas registra la hora de inicio del cargue.",
      "Asignar el personal del cargue (personal de planta y auxiliares escritos a mano) una sola vez por orden.",
      "Cerrar la orden cargando las fotos del cargue (hasta 30); ese paso registra la hora de fin.",
      "Pausar y reanudar un cargue ya iniciado, para que las pausas no cuenten como tiempo de cargue.",
      "Desmarcar el check de Facturar de una orden, confirmando y dejando el motivo por escrito.",
    ],
    noPuedes: [
      "Saltarte pasos: el documento, el personal y las fotos se habilitan en secuencia; una orden sin personal asignado no permite cargar fotos.",
      "Repetir un paso ya hecho: un picking realizado, un documento generado o un personal ya asignado quedan bloqueados.",
      "Cambiar el check de Facturar despues de cerrada la orden.",
      "Ver ordenes de otro proyecto: la lista sigue el selector global.",
    ],
    funcionalidades: [
      {
        nombre: "Verificacion de productos (picking)",
        descripcion:
          "Lista los productos de la orden con su cantidad. Cada linea se verifica de forma simple o escaneando el QR de la estiba (con camara en celular o digitando el numero); solo cuando todas las lineas estan verificadas se puede confirmar el picking.",
      },
      {
        nombre: "Check de Facturar",
        descripcion:
          "Viene encendido en todas las ordenes. Si se desmarca, el sistema pide confirmacion y un motivo, y deja registro del cambio. Una orden desmarcada NO se cobra al cliente NI genera pago de nomina por ese cargue.",
      },
      {
        nombre: "Ciclo con horas reales",
        descripcion:
          "Generar el documento marca el inicio del cargue y cargar las fotos marca el fin. Con eso el sistema mide el tiempo real de cada cargue, que alimenta los tableros y el cumplimiento de tiempos por vehiculo.",
      },
      {
        nombre: "Pausar / Reanudar",
        descripcion:
          "Disponible cuando el cargue ya inicio. Sirve para descontar interrupciones (por ejemplo, esperas ajenas a LIP) del tiempo del cargue.",
      },
      {
        nombre: "Version movil",
        descripcion:
          "En celular las ordenes se ven como tarjetas con los mismos botones del mismo flujo: Picking, PDF, Personal, Fotos y Pausar.",
      },
    ],
    consejos: [
      "Desmarcar Facturar es una decision seria: sin ese check no se cobra ni se paga la nomina de la orden. Usalo solo con motivo real y por escrito.",
      "Sube las fotos apenas termine el cargue: ese paso es el que cierra la orden y fija la hora de fin.",
    ],
  },

  {
    modulo: "Packing",
    resumen: "Ejecuta y cierra los descargues y las distribuciones pendientes.",
    proposito:
      "Es el equivalente del Picking para las operaciones de descargue y de distribucion. Muestra ambas listas juntas por proyecto y guia el mismo ciclo: generar el documento (inicio), asignar el personal y cerrar con las fotos (fin). Ademas permite verificar producto por producto lo recibido antes de confirmar.",
    puedes: [
      "Ver en una sola lista las ordenes de descargue y de distribucion pendientes del proyecto.",
      "Generar el documento de la operacion, que registra la hora de inicio.",
      "Asignar el personal que participo (personal de planta y auxiliares escritos a mano).",
      "Cerrar la orden cargando las fotos (hasta 30); ese paso registra la hora de fin.",
      "Verificar los productos de la orden uno por uno y confirmar el packing cuando todos esten revisados.",
      "En ordenes de distribucion, desmarcar el check de Facturar con confirmacion y motivo.",
    ],
    noPuedes: [
      "Cargar fotos sin haber asignado personal, salvo el caso especial de una distribucion marcada como no facturable.",
      "Marcar Facturar en un descargue: ese check solo existe para distribucion.",
      "Asignar personal a una distribucion marcada como no facturable: si no se factura es porque no se envio gente, y la orden se cierra solo con las fotos.",
    ],
    funcionalidades: [
      {
        nombre: "Descargue y distribucion juntos",
        descripcion:
          "Las dos operaciones pendientes aparecen en la misma tabla, ordenadas por numero de orden, con cliente, placa, conductor y fechas.",
      },
      {
        nombre: "Check de Facturar (solo distribucion)",
        descripcion:
          "Encendido por defecto. Al desmarcarlo pide confirmacion y motivo y deja registro; una distribucion desmarcada no se cobra ni genera pago de nomina, y por eso mismo el sistema no le permite asignar auxiliares.",
      },
      {
        nombre: "Verificacion de packing",
        descripcion:
          "Abre la lista de productos con cantidades; cada uno se marca como verificado y solo con todos revisados se puede confirmar.",
      },
      {
        nombre: "Cierre con fotos",
        descripcion:
          "Las fotos se comprimen y se suben una a una para que no fallen por tamano, y al final el sistema cierra la orden registrando la hora de fin.",
      },
    ],
  },

  {
    modulo: "Ver Picking/Packing",
    resumen: "Consulta las ordenes ya trabajadas con sus tiempos, personal, documento y fotos.",
    proposito:
      "Vista de solo lectura para revisar lo ejecutado en Picking/Packing sin riesgo de tocar nada: por cada orden muestra fechas, peso, hora de inicio y fin del cargue, los auxiliares que participaron, el documento generado y la galeria de fotos. Es la pantalla de consulta para supervisores o para responder a un cliente que pide soporte de una orden.",
    puedes: [
      "Ver el listado de ordenes del proyecto con fechas, peso, inicio y fin del cargue.",
      "Ver la lista de auxiliares asignados a cada orden.",
      "Abrir el documento de picking de la orden en otra pestana.",
      "Abrir la galeria de fotos de la orden y verlas en pantalla completa, navegando entre ellas.",
    ],
    noPuedes: [
      "Modificar ordenes, tiempos o personal: es una vista de solo lectura.",
      "Subir o borrar fotos o documentos desde aqui: eso se hace en Picking/Packing.",
    ],
    funcionalidades: [
      {
        nombre: "Tabla de ordenes",
        descripcion:
          "Orden de cargue, fecha de la orden, fecha de cargue, peso en toneladas, hora de inicio, hora de fin y auxiliares, con desplazamiento para listas largas.",
      },
      {
        nombre: "Soportes por orden",
        descripcion:
          "Boton de documento (abre el PDF del picking) y boton de fotos (abre la galeria). Si la orden no tiene soporte, el boton aparece deshabilitado.",
      },
      {
        nombre: "Visor de fotos",
        descripcion:
          "Las fotos se ven en cuadricula y al tocarlas pasan a pantalla completa con flechas para avanzar y retroceder.",
      },
    ],
  },

  // ==========================================================================
  // OPERACION LIP · QR de estibas
  // ==========================================================================
  {
    modulo: "Registro de QR estibas",
    resumen: "Registra la produccion en linea e imprime la etiqueta de la estiba.",
    proposito:
      "Formulario de la linea de produccion: se registra cada tanda producida (producto, almacen, localizacion, lote y bultos) y el sistema genera el registro e imprime la etiqueta termica con el QR que identifica esa estiba. Ese QR es el que despues se escanea en el picking y en la lectura de estibas. Ademas define de quien es la produccion: si es servicio de LIP sigue el flujo normal hasta facturarse, y si es produccion propia de Harinera genera inventario pero nunca se liquida ni se factura.",
    puedes: [
      "Registrar una produccion eligiendo producto, almacen, localizacion (segun el almacen), numero de lote y cantidad de bultos.",
      "Elegir el modo de almacenamiento: Arrume o Estiba.",
      "Elegir el tipo de produccion: LIP (flujo normal, se liquida y factura) o Harinera (genera inventario y pasa por aprobacion, pero no se liquida en Tolva ni se factura).",
      "Imprimir la etiqueta termica con el registro; el sistema muestra el numero generado.",
    ],
    noPuedes: [
      "Registrar con campos incompletos: todos los datos del formulario son obligatorios.",
      "Corregir desde aqui un registro ya impreso: si un registro de Harinera no quedo bien marcado, el aviso en pantalla indica los datos para reportarlo y corregirlo.",
      "Registrar sin conexion con el servidor de impresion: si la impresora no responde, no se crea el registro.",
    ],
    funcionalidades: [
      {
        nombre: "Formulario con buscadores",
        descripcion:
          "Producto, almacen y localizacion se eligen con buscador; las localizaciones disponibles dependen del almacen seleccionado.",
      },
      {
        nombre: "Tipo de produccion LIP / Harinera",
        descripcion:
          "Por defecto queda en LIP, que es el comportamiento de siempre. Marcar Harinera saca esa produccion de la liquidacion y de la facturacion, y el formulario lo advierte en el momento.",
      },
      {
        nombre: "Aviso persistente de correccion",
        descripcion:
          "Si un registro de Harinera se imprimio pero no se pudo marcar como tal, aparece un aviso rojo que no se cierra solo: indica que quedo como produccion de LIP (y se facturaria) y da los datos exactos para ubicarlo y reportarlo.",
      },
    ],
    consejos: [
      "Revisa el tipo de produccion ANTES de imprimir: una produccion de Harinera dejada en LIP termina facturada al cliente.",
    ],
  },

  {
    modulo: "Lectura de QR estibas",
    resumen: "Escanea o digita el QR de una estiba y muestra que contiene y donde esta.",
    proposito:
      "Consulta rapida de piso: frente a una estiba fisica, se escanea su codigo QR (o se digita el numero) y el sistema muestra el producto, la localizacion, el stock total y el detalle de lotes que la componen. Sirve para confirmar en segundos que hay en una estiba sin ir al computador ni abrir el inventario completo.",
    puedes: [
      "Buscar una estiba digitando su codigo QR o presionando Enter.",
      "En celular, abrir la camara y escanear el QR directamente.",
      "Ver el producto, la localizacion y el stock total de la estiba.",
      "Ver el detalle por lote: cada lote con su cantidad y su ubicacion.",
    ],
    noPuedes: [
      "Modificar el contenido de la estiba: es una consulta de solo lectura.",
      "Mover o trasladar la estiba desde aqui: eso se hace en los modulos de inventario.",
    ],
    funcionalidades: [
      {
        nombre: "Busqueda por QR",
        descripcion:
          "Campo grande para digitar o escanear el codigo; si el codigo no existe o la estiba no tiene inventario, lo avisa de inmediato.",
      },
      {
        nombre: "Ficha de la estiba",
        descripcion:
          "Tarjeta con el producto, su codigo, la localizacion y el stock total sumado de todos los lotes.",
      },
      {
        nombre: "Detalle de lotes",
        descripcion:
          "Lista numerada de los lotes de la estiba, cada uno con producto, localizacion y stock.",
      },
    ],
  },

  {
    modulo: "Inventario por Estiba",
    resumen: "Consulta el inventario abierto estiba por estiba, con filtros.",
    proposito:
      "Vista de detalle del inventario etiquetado con QR: cada fila es una combinacion de estiba, producto, lote y localizacion con su stock. Es la forma de responder preguntas como en que estibas esta tal producto o que hay en tal localizacion, sin recorrer la bodega.",
    puedes: [
      "Ver todas las estibas con su codigo QR, producto, lote, localizacion y stock.",
      "Filtrar por producto, por lote o por localizacion, y combinar los filtros.",
      "Limpiar los filtros para volver a ver todo.",
      "Ver el total de registros que devuelve la consulta.",
    ],
    noPuedes: [
      "Modificar saldos o mover estibas: es una vista de solo lectura.",
      "Imprimir etiquetas desde aqui: eso se hace en Registro de QR estibas.",
    ],
    funcionalidades: [
      {
        nombre: "Filtros combinables",
        descripcion:
          "Tres listas desplegables (producto, lote, localizacion) y boton Buscar; los filtros se pueden usar solos o combinados.",
      },
      {
        nombre: "Tabla de resultados",
        descripcion:
          "Codigo QR, codigo y nombre del producto, lote, localizacion y stock total, con encabezado fijo y desplazamiento para listas largas.",
      },
    ],
  },

  // ==========================================================================
  // OPERACION LIP · Tableros
  // ==========================================================================
  {
    modulo: "Dashboard Operaciones LIP",
    resumen: "Tablero de toneladas y cumplimiento: la operacion del dia y el historico mensual.",
    proposito:
      "Tablero de resultados de la operacion. La pestana Operacion del Dia muestra como va hoy (o cualquier fecha pasada) contra la meta: toneladas procesadas, cumplimiento global, operadores activos y viajes, con tendencia de 7 dias, alertas de rendimiento y desglose por producto, tipo de operacion y operador. La pestana Historico Mensual repite el analisis para el mes completo: toneladas diarias contra meta, volumen por producto, cumplimiento por tipo de operacion, mejores y peores operadores y el detalle completo.",
    puedes: [
      "Ver los indicadores del dia: toneladas, cumplimiento global, operadores activos y viajes, comparados contra el dia anterior.",
      "Cambiar la fecha para revisar un dia pasado y volver a hoy con un boton.",
      "Filtrar por producto y por tipo de operacion.",
      "Revisar la tendencia de cumplimiento de los ultimos 7 dias y las alertas de rendimiento.",
      "Ver el desglose de toneladas contra meta por producto y operacion, y la productividad por operador.",
      "Pasar al historico mensual: toneladas diarias contra meta, cumplimiento por tipo de operacion, top de operadores y operadores con menor rendimiento.",
    ],
    noPuedes: [
      "Modificar datos o metas desde aqui: el tablero es de solo lectura y se alimenta de la operacion registrada.",
      "Ver fechas futuras: la consulta llega hasta el dia de hoy.",
    ],
    funcionalidades: [
      {
        nombre: "Operacion del Dia",
        descripcion:
          "Cuatro indicadores grandes con comparacion contra el dia anterior, tendencia de 7 dias, alertas de rendimiento y graficas por producto, tipo de operacion y operador.",
      },
      {
        nombre: "Historico Mensual",
        descripcion:
          "El mismo analisis a nivel de mes: toneladas diarias contra meta, volumen diario por producto, cumplimiento por tipo de operacion, top 5 y menor rendimiento, y la tabla con el detalle completo de operadores.",
      },
      {
        nombre: "Filtros",
        descripcion:
          "Producto, tipo de operacion y fecha; los indicadores y las graficas se recalculan con el filtro aplicado.",
      },
    ],
  },

  {
    modulo: "Panel LIP Operación",
    resumen: "El Tablero del Coordinador: su desempeno contra las metas de LIP, con semaforo.",
    proposito:
      "Es el tablero de gestion del coordinador del proyecto. Reune en una sola vista todos los indicadores que dependen de el, cada uno contra su meta y con semaforo: cumplimiento de tiempos por vehiculo, cumplimiento de cargues y de meta de toneladas, evidencia fotografica, satisfaccion del conductor, asistencia y cobertura del equipo, y la gestion de facturacion. Ademas baja al detalle donde hay que actuar: que tipo de vehiculo incumple los tiempos, que ordenes se pasaron del tiempo acordado y que operaciones aun no se han mandado a facturar.",
    puedes: [
      "Ver el cumplimiento global del coordinador y cuantos indicadores estan en meta, con semaforo por indicador.",
      "Revisar el cumplimiento de tiempos por tipo de vehiculo (tiempo real contra el acordado) y su evolucion mensual.",
      "Abrir la lista de ordenes que se pasaron del tiempo acordado, ordenadas por mayor exceso y filtrables por periodo.",
      "Ver la facturacion pendiente por solicitar: valor pendiente, valor en riesgo por atraso mayor a 8 dias, mayor atraso y el detalle de ordenes.",
      "Ver los indicadores del equipo que presta el servicio: activos, cumplimiento de jornada, rotacion.",
      "Verificar el porcentaje de ordenes con soporte completo: documento de la orden, documento de cargue, fotos y ciclo cerrado.",
      "Filtrar todo por periodo (desde/hasta); el proyecto lo define el selector global.",
    ],
    noPuedes: [
      "Solicitar la facturacion desde aqui: el panel muestra lo pendiente, pero la solicitud se hace en Gestion de Facturas.",
      "Cambiar las metas de los indicadores: estan definidas por LIP.",
      "Calificar conductores desde aqui: eso se hace en Calificacion del Conductor.",
    ],
    funcionalidades: [
      {
        nombre: "Scorecard del coordinador",
        descripcion:
          "Tabla de indicadores agrupados (servicio y tiempos, conductor, equipo, facturacion) con resultado, meta y estado. Los indicadores sin datos se marcan como sin dato y no inflan el cumplimiento global.",
      },
      {
        nombre: "Tiempos por vehiculo",
        descripcion:
          "Compara el tiempo real de cargue (inicio a fin) contra el tiempo acordado por tipo de vehiculo, resalta el tipo con peor cumplimiento y muestra la evolucion mensual contra la meta del 90%.",
      },
      {
        nombre: "Facturacion pendiente por solicitar",
        descripcion:
          "Operaciones terminadas que el coordinador aun no ha mandado a facturar, con su valor, dias de atraso y semaforo. Lo pendiente afecta el flujo de caja de LIP, por eso se gestiona a tiempo.",
      },
      {
        nombre: "Valor agregado de la trazabilidad",
        descripcion:
          "Porcentaje de ordenes con cada soporte en el sistema (documento de orden, documento de cargue, fotos y ciclo completo): es lo que respalda a LIP ante cualquier reclamacion del cliente.",
      },
      {
        nombre: "Vista gerencial",
        descripcion:
          "Con acceso a todos los proyectos, agrega la operacion por cliente/sitio con ordenes, toneladas y cumplimiento de cada uno.",
      },
    ],
  },

  {
    modulo: "Centro de Coordinación",
    resumen: "El puesto de trabajo del coordinador: muelles en vivo, SLA, personal y las acciones de Picking/Packing en un solo lugar.",
    proposito:
      "Une en una sola pantalla lo que antes estaba repartido entre Picking, Packing y el control de muelles: cada muelle del proyecto (Cargue, Descargue o Distribucion, comparten los mismos muelles fisicos) se ve como una tarjeta con semaforo (verde libre, amarillo ocupado, rojo fuera de tiempo), toneladas contra la capacidad real del vehiculo, ritmo, proyeccion de cuando queda libre y la linea de 5 pasos del proceso (Muelle asignado, Realizar Picking o Packing, Generar PDF, Asignar Personal, Cargar fotos). Los dos primeros pasos operativos los hace el operario de montacargas desde su celular en Picking/Packing (aqui solo se ve el avance en vivo); el coordinador actua desde aqui en asignar muelle, asignar personal, pausar/reanudar, reasignar o liberar un muelle y cerrar con fotos.",
    puedes: [
      "Ver los 6 indicadores del turno: toneladas cargadas contra la meta del dia (con semaforo adelantado/cerca/atrasado y comparacion contra ayer a la misma hora), ritmo real, cumplimiento de SLA, personal en piso, muelles ocupados y la proyeccion de hora de cierre.",
      "Filtrar la grilla de muelles por tipo de operacion (Cargue, Descargue, Distribucion) o activar 'Solo atencion' para ver unicamente los muelles que necesitan accion.",
      "Abrir un muelle para ver la linea de los 5 pasos, quien es responsable de cada uno y el panel de accion del paso actual.",
      "Asignar una orden de la cola al primer muelle libre (dispara el mismo Generar PDF/inicio que usan Picking y Packing), reasignar una orden activa a otro muelle o liberar un muelle antes de iniciar.",
      "Asignar personal a la orden (mismo flujo y mismo personal disponible que Picking/Packing), pausar o reanudar el cargue, y cerrar con fotos (el mismo paso que cierra la orden en Picking/Packing).",
      "Ver la sugerencia de reforzar con un auxiliar cuando una orden esta vencida o a punto de vencer el SLA, y la sugerencia del siguiente vehiculo de patio para el proximo muelle libre.",
      "Abrir el Parte de Turno: resumen para el proximo coordinador con toneladas del turno, ordenes cerradas y en curso, SLA vencidos y los pendientes puntuales por muelle.",
    ],
    noPuedes: [
      "Escanear el QR de picking ni verificar linea por linea desde aqui: eso solo se hace en Picking/Packing, en el celular del operario de montacargas; el Centro de Coordinacion solo muestra el avance.",
      "Cerrar una orden sin personal asignado, salvo el caso de distribucion marcada como no facturable (igual que en Packing).",
      "Ver o gestionar muelles de otro proyecto: la grilla sigue el selector global de proyecto.",
    ],
    funcionalidades: [
      {
        nombre: "Semaforo de 3 colores por muelle",
        descripcion:
          "Verde = muelle libre, amarillo = ocupado dentro de tiempo (cargando, alistando o pausado), rojo = fuera de tiempo (SLA vencido). Antes de vencer, si queda poca holgura (80% o mas del SLA consumido) la insignia del muelle pulsa en amarillo como aviso temprano.",
      },
      {
        nombre: "Muelle real",
        descripcion:
          "El numero de muelle es un campo real de la orden (antes era una simulacion): el coordinador lo asigna a mano y puede reasignarlo o liberarlo mientras la orden no haya iniciado.",
      },
      {
        nombre: "Linea de 5 pasos con responsable",
        descripcion:
          "Muelle asignado y Asignar Personal/Cargar fotos son del coordinador; Realizar Picking (o Packing) y Generar PDF son del operario de montacargas. Cuando el paso actual es del operario, el panel de esa orden queda en solo lectura con el avance en vivo.",
      },
      {
        nombre: "Toneladas contra capacidad del vehiculo",
        descripcion:
          "La barra de avance de cada muelle muestra el objetivo de la orden y, si hay cita de vehiculo con capacidad registrada, el porcentaje contra esa capacidad real; mientras la orden esta en curso el avance se estima por lineas verificadas (Cargue) porque LIPgo no registra un peso en vivo antes del cierre.",
      },
      {
        nombre: "Parte de turno",
        descripcion:
          "Resumen bajo demanda con lo cargado en el turno, ordenes cerradas y en curso, SLA vencidos en el momento y una lista de pendientes (muelles pausados, sin personal, ordenes sin muelle) para dejarle el contexto listo al siguiente coordinador.",
      },
    ],
    consejos: [
      "Si un muelle esta en rojo por falta de personal, la sugerencia de reforzar con auxiliar y la lista de 'Personal disponible' del panel derecho son el mismo dato en vivo — no hace falta ir a otra pantalla.",
    ],
  },

  {
    modulo: "Control de Toneladas",
    resumen: "Toneladas por trabajador, por dia y acumuladas, para gestionar personal (quien rinde y quien no).",
    proposito:
      "Vista operativa para que el coordinador gestione personal: toneladas cargadas por cada trabajador en un periodo, comparadas contra la meta dinamica del proyecto (toneladas de Cargue/Distribucion del acuerdo entre dias habiles del mes, dividida entre el personal y las horas realmente programadas cada dia). Sirve para identificar quien mueve menos, quien es mas eficiente y en que ordenes/vehiculos trabajo cada quien.",
    puedes: [
      "Consultar un rango de fechas (con atajos: hoy, este mes, mes anterior, ultimos 3 meses, historial del ano) y ver el total de toneladas y trabajadores del periodo.",
      "Ver por trabajador: dias trabajados, toneladas acumuladas, promedio por dia, meta del dia y el porcentaje de cumplimiento contra esa meta.",
      "Filtrar por un trabajador puntual para ver su historial completo dia a dia.",
      "Abrir el detalle de un trabajador: cada orden en la que participo (fecha, orden, tipo de operacion, puesto programado, placa, toneladas asignadas) y sus vehiculos por dia.",
    ],
    noPuedes: [
      "Editar toneladas, metas o asistencia desde aqui: es una vista de solo lectura que se recalcula sola con lo registrado en Picking/Packing/Packing y en Programacion de turnos.",
      "Ver otros proyectos a la vez: sigue el selector global (o Todo LIP si se tiene ese acceso).",
    ],
    funcionalidades: [
      {
        nombre: "Meta dinamica por dia",
        descripcion:
          "La meta no es un numero fijo: sale de las toneladas del acuerdo del mes dividida en dias habiles, y luego entre el personal y las horas que ESE dia realmente tuvo programadas cada trabajador — la misma formula que usa Revision de Nomina y el Centro de Coordinacion, para que el numero nunca diverja entre pantallas.",
      },
      {
        nombre: "Detalle expandible por trabajador",
        descripcion:
          "Al tocar un trabajador se despliega su tabla de ordenes y su resumen de toneladas/vehiculos por dia, sin salir de la pantalla.",
      },
      {
        nombre: "Ordenado por menor rendimiento primero",
        descripcion:
          "El listado arranca ordenado de menor a mayor tonelaje acumulado, para que lo primero que vea el coordinador sea quien necesita seguimiento.",
      },
    ],
  },

  // ==========================================================================
  // OPERACION LIP · Facturacion
  // ==========================================================================
  {
    modulo: "Gestión de Facturas",
    resumen: "Gestiona el cobro de cada orden: pago de contado o solicitud de factura, hasta cerrarla.",
    proposito:
      "Aqui el coordinador convierte las operaciones terminadas en cobros. Cada orden pendiente se procesa por uno de dos caminos: SIN FACTURA (el cliente paga de contado y se registra el pago con sus comprobantes) o CON FACTURA (se solicita la factura, de contado o a credito, y pasa a la parte financiera). El modulo lleva el estado de cada orden hasta el cierre, permite montar la factura real de Siigo y amarrarla a todas las ordenes de un rango de fechas cuando una sola factura cubre varios dias.",
    puedes: [
      "Procesar una orden pendiente por el flujo SIN FACTURA: registrar el pago de contado con medio de pago, cuenta, comprobantes en foto y observaciones.",
      "Procesar una orden por el flujo CON FACTURA: solicitar la factura indicando si es de contado o a credito.",
      "Cerrar la facturacion de una orden con pago confirmado (paso protegido con clave).",
      "Montar la factura de Siigo en una orden con factura solicitada, o eliminarla si se cargo mal (ambas acciones protegidas con clave).",
      "Definir un rango de fechas de cargue para que, al montar la factura de Siigo, quede amarrada a TODAS las ordenes con factura solicitada de ese rango, y deshacer el amarre si es necesario.",
      "Filtrar por orden, fechas, placa, transporte, estado, tipo de operacion, medio de pago y cuenta; buscar, paginar y exportar a Excel.",
      "Ver el valor neto de cada orden (operacion por tarifa) y los comprobantes ya cargados.",
    ],
    noPuedes: [
      "Marcar una orden como facturada sin montar la factura real de Siigo: ese es el UNICO evento que la deja facturada, en todos los procesos.",
      "Cerrar facturacion ni montar/eliminar factura de Siigo sin la clave.",
      "Elegir credito en el flujo SIN FACTURA: el pago sin factura es siempre de contado.",
      "Editar una orden ya cerrada desde el listado.",
    ],
    funcionalidades: [
      {
        nombre: "Dos flujos desde Pendiente",
        descripcion:
          "Toda orden arranca en Pendiente por procesar con dos botones: SIN FACTURA (pago de contado con calculo del valor y comprobantes) y CON FACTURA (solicitud de factura). De ahi los estados avanzan: pago confirmado y cerrado en el primero, factura solicitada y cerrado en el segundo.",
      },
      {
        nombre: "Factura Siigo",
        descripcion:
          "En las ordenes con factura solicitada se monta el archivo de la factura real de Siigo; con eso la orden queda cerrada y marcada como facturada. Ver, montar y eliminar la factura piden clave.",
      },
      {
        nombre: "Rango de factura Siigo",
        descripcion:
          "Cuando una factura de Siigo cubre varios dias, se define el rango por fecha de cargue: las ordenes con factura solicitada del rango se marcan En rango y, al montar la factura en cualquiera de ellas, se amarra a todas y quedan cerradas. El boton Deshacer amarre las devuelve a factura solicitada.",
      },
      {
        nombre: "Comprobantes de pago",
        descripcion:
          "En el flujo SIN FACTURA se cargan fotos del comprobante (varias por orden, tomadas con la camara o desde archivo; se comprimen solas) y quedan visibles desde el listado.",
      },
      {
        nombre: "Filtros, busqueda y Excel",
        descripcion:
          "El listado arranca filtrado desde la fecha en que la facturacion se gestiona en LIPgo (lo anterior se facturo por fuera); se puede limpiar para ver el historico completo, buscar, paginar de a 50 y exportar a Excel.",
      },
    ],
    consejos: [
      "La regla de oro: facturado SOLO cambia cuando se monta la factura real de Siigo. Ningun otro paso deja la orden facturada.",
      "Define el rango de Siigo ANTES de montar la factura: asi el amarre cubre todas las solicitudes del periodo de una sola vez.",
    ],
  },

  // ==========================================================================
  // OPERACION LIP · Cliente y conductor
  // ==========================================================================
  {
    modulo: "Satisfacción y PQRSF",
    resumen: "Encuestas de satisfaccion de clientes y conductores + gestion de PQRSF.",
    proposito:
      "Reune la voz del cliente y de las partes interesadas del proyecto: por un lado las encuestas de satisfaccion (a clientes y a conductores, con calificacion de 1 a 5 estrellas), y por el otro las PQRSF (peticiones, quejas, reclamos, sugerencias y felicitaciones) con su estado y tiempo de respuesta. Lo registrado aqui alimenta los indicadores de satisfaccion del tablero de gestion.",
    puedes: [
      "Registrar encuestas de satisfaccion de cliente o de conductor: fecha, encuestado, calificacion en estrellas, si recomendaria el servicio, comentario y responsable.",
      "Registrar una PQRSF con tipo, parte interesada (cliente, conductor, proveedor, colaborador), canal, descripcion, respuesta, responsable y estado.",
      "Cerrar una PQRSF con su fecha de cierre y marcarla para escalar a No Conformidad si lo amerita.",
      "Editar o eliminar encuestas y PQRSF ya registradas.",
      "Ver los indicadores del proyecto: satisfaccion de cliente y de conductor, porcentaje que recomendaria, PQRSF abiertas y cerradas y tiempo promedio de respuesta.",
    ],
    noPuedes: [
      "Registrar sin proyecto seleccionado: el cliente/sitio lo define el selector global.",
      "Calificar cargues individuales de conductores aqui: eso se hace en Calificacion del Conductor.",
    ],
    funcionalidades: [
      {
        nombre: "Encuestas",
        descripcion:
          "Tabla de encuestas con tipo, encuestado, calificacion en estrellas y comentario. La satisfaccion se calcula como promedio de calificaciones y se compara contra la meta con semaforo.",
      },
      {
        nombre: "PQRSF",
        descripcion:
          "Cada registro se ve como tarjeta con color segun estado (abierta, en proceso, cerrada), su descripcion, la respuesta dada y los dias de respuesta. Una PQRSF puede escalar a No Conformidad.",
      },
      {
        nombre: "Indicadores",
        descripcion:
          "Seis tarjetas de resumen: satisfaccion de cliente, satisfaccion de conductor, porcentaje que recomendaria, PQRSF abiertas, cerradas y tiempo promedio de respuesta.",
      },
    ],
  },

  {
    modulo: "Calificación del Conductor",
    resumen: "Kiosko de caritas para que el conductor califique el servicio al fin del cargue.",
    proposito:
      "Al terminar cada cargue, el coordinador le pasa el dispositivo al conductor y este califica el servicio en caliente con tres caritas: Bueno (verde), Regular (amarillo) o Malo (rojo), con comentario opcional. El modulo muestra los cargues finalizados pendientes de calificar, mide la satisfaccion del conductor y la cobertura de calificacion (ambas son objetivos del coordinador) y alimenta el indicador de satisfaccion del tablero de gestion, por proyecto y gerencial.",
    puedes: [
      "Abrir el kiosko de un cargue finalizado y dejar que el conductor califique con una de las tres caritas, con comentario opcional.",
      "Buscar cargues pendientes de calificar por orden, conductor o placa.",
      "Ver la satisfaccion del conductor contra la meta del 85% y la cobertura de calificacion contra la meta del 80%.",
      "Ver la distribucion de calificaciones y la evolucion mensual de la satisfaccion.",
      "Filtrar por fechas (arranca en el mes actual) o limpiar el filtro para ver todo el historico.",
      "Con vista gerencial, comparar la satisfaccion por proyecto.",
    ],
    noPuedes: [
      "Calificar en linea cargues anteriores al 15 de julio de 2026: esos quedan como historico y solo se pueblan automaticamente por cumplimiento de tiempos.",
      "Cambiar una calificacion ya registrada por el conductor.",
      "Generar o limpiar el historico automatico sin ser administrador (y la limpieza solo borra lo generado automaticamente, nunca las calificaciones en linea).",
    ],
    funcionalidades: [
      {
        nombre: "Kiosko de calificacion",
        descripcion:
          "Pantalla grande y simple pensada para entregarle el equipo al conductor: nombre, placa y orden visibles, tres caritas gigantes y un campo de comentario. Al calificar muestra un agradecimiento y vuelve sola al listado.",
      },
      {
        nombre: "Pendientes de calificar",
        descripcion:
          "Tabla de cargues finalizados sin calificacion, con buscador. Los cargues anteriores al corte aparecen marcados como Historico y no se califican en vivo.",
      },
      {
        nombre: "Indicadores y graficas",
        descripcion:
          "Satisfaccion y cobertura con semaforo contra sus metas, distribucion de caritas, tendencia mensual y, en vista gerencial, comparativo por proyecto.",
      },
      {
        nombre: "Historico automatico (solo admin)",
        descripcion:
          "Para las fechas anteriores al corte, un administrador puede generar calificaciones automaticas segun el cumplimiento de tiempos de cada cargue (accion reversible) o limpiarlas sin tocar las calificaciones reales.",
      },
    ],
    consejos: [
      "La cobertura es un objetivo del coordinador: entre mas cargues se califiquen en el momento, mas confiable es el indicador de satisfaccion.",
    ],
  },

  // ==========================================================================
  // OPERACION LIP · Personal y turnos
  // ==========================================================================
  {
    modulo: "Aprobar Turnos",
    resumen: "Aprueba o rechaza solicitudes de turnos y horas extra, con firma y acta.",
    proposito:
      "Es el paso de autorizacion de las solicitudes de personal adicional (turnos y horas extra) del proyecto. Quien aprueba selecciona las solicitudes, escribe su nombre, firma en pantalla y asigna a las personas concretas que cubriran los turnos; el sistema valida que la cantidad asignada coincida con la solicitada, genera el acta de aprobacion (que se descarga y queda archivada) y deja todo consultable en el historial con las firmas.",
    puedes: [
      "Ver las solicitudes pendientes del proyecto con puesto, fecha requerida, cantidad, solicitante y tipo (Turnos u Horas Extra).",
      "Seleccionar una o varias solicitudes y aprobarlas en bloque con nombre y firma dibujada en pantalla.",
      "Asignar el personal que cubrira los turnos, buscandolo en el listado de personal activo.",
      "Rechazar solicitudes seleccionadas.",
      "Descargar el acta de aprobacion generada y volver a generarla desde el historial si hace falta.",
      "Consultar el historial de aprobadas/rechazadas, filtrar por fechas, ver las firmas y desplegar el personal asignado de cada una.",
    ],
    noPuedes: [
      "Aprobar sin firmar ni sin escribir el nombre de quien aprueba.",
      "Aprobar solicitudes de Turnos con un numero de personas distinto al solicitado: la cantidad debe coincidir exactamente.",
      "Editar una solicitud desde aqui: aqui solo se aprueba o se rechaza.",
    ],
    funcionalidades: [
      {
        nombre: "Aprobacion con firma",
        descripcion:
          "La firma se dibuja en pantalla (con opcion de borrar y repetir) y queda guardada junto con el nombre del aprobador y la fecha; tambien se muestra la firma del solicitante.",
      },
      {
        nombre: "Asignacion de personal",
        descripcion:
          "Buscador sobre el personal activo para armar la lista de quienes cubren los turnos. En horas extra, esa asignacion es la que deja las horas programadas por persona; si algo queda sin programar, el sistema lo advierte en pantalla.",
      },
      {
        nombre: "Acta de aprobacion",
        descripcion:
          "Al aprobar se genera un documento con las solicitudes, el personal y las firmas; se descarga siempre y ademas queda archivado en el sistema para consultarlo desde el historial.",
      },
      {
        nombre: "Historial",
        descripcion:
          "Todas las solicitudes ya resueltas, con filtros por fecha de solicitud y fecha requerida, acceso a las firmas, al personal asignado y al acta.",
      },
    ],
  },

  {
    modulo: "Bitácora",
    resumen: "El diario de la operacion del dia + el cierre ejecutivo imprimible.",
    proposito:
      "Registro diario de novedades de la operacion del proyecto. En la pestana principal se escribe la bitacora del dia (la fecha se asigna sola) y se consulta el historial con opcion de editar o eliminar. La pestana Cierre del Dia arma el resumen ejecutivo de la jornada listo para imprimir o exportar, y la pestana Historial guarda cada cierre generado para volver a verlo o reimprimirlo despues.",
    puedes: [
      "Escribir y guardar la bitacora del dia; la fecha queda asignada automaticamente.",
      "Consultar el historial de bitacoras del proyecto, editarlas o eliminarlas (con confirmacion).",
      "Abrir el Cierre del Dia: el tablero ejecutivo de la jornada, imprimible y exportable.",
      "Consultar el historial de cierres guardados, abrir cualquiera tal como salio, reimprimirlo o eliminarlo.",
    ],
    noPuedes: [
      "Recuperar una bitacora o un cierre eliminado: el borrado es definitivo y por eso pide confirmacion.",
      "Cambiar la fecha de una bitacora: siempre queda con la fecha del dia en que se registro.",
    ],
    funcionalidades: [
      {
        nombre: "Bitacora del dia",
        descripcion:
          "Area de texto amplia para registrar novedades, incidencias e informacion relevante, con guardado en un clic.",
      },
      {
        nombre: "Historial de bitacoras",
        descripcion:
          "Tabla con fecha y contenido completo (respeta los saltos de linea), con editar en ventana y eliminar con confirmacion.",
      },
      {
        nombre: "Cierre del Dia",
        descripcion:
          "Resumen ejecutivo de la jornada del proyecto; al imprimirlo se genera el documento y queda guardado automaticamente en el historial de cierres.",
      },
      {
        nombre: "Historial de cierres",
        descripcion:
          "Lista de los cierres guardados por fecha, con boton Ver, Imprimir (reabre el documento tal como salio) y Eliminar.",
      },
    ],
  },

  {
    modulo: "Solicitud de Personal",
    resumen: "Crea y gestiona las vacantes/solicitudes de personal por proyecto.",
    proposito:
      "Aqui la operacion pide gente: cada solicitud describe la vacante (proyecto, cargo, cuantas personas, turno, ciudad, rango salarial y requisitos) y queda en revision hasta que se apruebe o rechace. Es el punto de partida del proceso de seleccion: lo aprobado pasa al equipo de seleccion para conseguir los candidatos.",
    puedes: [
      "Crear una vacante con proyecto, cargo, cantidad de personas, turno (diurno, nocturno o mixto), ciudad, rango salarial y requisitos.",
      "Editar una solicitud mientras siga en revision.",
      "Eliminar una solicitud (con confirmacion).",
      "Filtrar el listado por estado, cargo, ciudad y turno.",
      "Ver el estado de cada solicitud: en revision, aprobado o rechazado.",
    ],
    noPuedes: [
      "Editar una solicitud ya aprobada: queda bloqueada.",
      "Aprobar o rechazar desde aqui: la aprobacion se hace en el modulo de aprobacion de solicitudes de personal.",
    ],
    funcionalidades: [
      {
        nombre: "Formulario de vacante",
        descripcion:
          "Todos los datos de la solicitud en una sola ventana: proyecto, cargo, cantidad, turno, ciudad, rango salarial minimo y maximo y el detalle de requisitos.",
      },
      {
        nombre: "Listado con filtros",
        descripcion:
          "Tabla de solicitudes con su estado en color (amarillo en revision, verde aprobado, rojo rechazado) y filtros combinables por estado, cargo, ciudad y turno.",
      },
    ],
  },

  {
    modulo: "Programación de turnos",
    resumen: "Programa a futuro al personal activo: puesto, horario o novedad por persona y fecha.",
    proposito:
      "Permite dejar lista la programacion de manana (o de cualquier fecha futura) para todo el personal activo del proyecto: a cada persona se le asigna puesto, hora de entrada y hora de salida, o en su lugar una novedad (incapacidad, licencia, vacaciones, descanso, retiro). La pantalla trabaja en dos paneles: a la izquierda se selecciona y configura la gente, a la derecha se ve lo que ya quedo programado para esa fecha. Esta programacion es la que luego reciben los tableros, la asistencia y la nomina.",
    puedes: [
      "Elegir la fecha objetivo (por defecto manana) y ver cuantas personas activas y puestos hay disponibles.",
      "Seleccionar personas una a una o todas las visibles, con buscador.",
      "Definir puesto, hora de entrada y hora de salida por persona, o aplicar valores por defecto a todos los seleccionados con un clic.",
      "Programar una novedad en lugar de turno (incapacidades, licencias, vacaciones, descanso, retiro); en ese caso el puesto y la hora se ignoran.",
      "Programar el puesto de doble jornada con Turno 1 o Turno 2, incluso las dos filas para la misma persona el mismo dia.",
      "Definir el Horario de Tolva del dia: la ventana de horas de Turno 1 y Turno 2 que usa la liquidacion de Tolva para clasificar los ingresos.",
      "Ver la programacion ya guardada de la fecha y eliminar registros puntuales (con confirmacion).",
    ],
    noPuedes: [
      "Programar personal inactivo: el panel solo muestra el personal activo del proyecto.",
      "Marcar la asistencia real desde aqui: eso ocurre en Registro de asistencia el dia del turno.",
    ],
    funcionalidades: [
      {
        nombre: "Programacion masiva",
        descripcion:
          "Se define puesto, horas y/o novedad por defecto y el boton Aplicar los asigna a todas las personas seleccionadas de una vez; luego se puede ajustar persona por persona.",
      },
      {
        nombre: "Modo novedad",
        descripcion:
          "El catalogo de novedades es el mismo del resto del sistema (incapacidades, licencias, vacaciones, descanso, retiro), asi lo programado se reconoce igual en nomina y tableros.",
      },
      {
        nombre: "Doble jornada (Turno 1/2)",
        descripcion:
          "El puesto mixto permite asignar Turno 1 o Turno 2 con horarios propios, y una misma persona puede quedar programada en ambos turnos del mismo dia.",
      },
      {
        nombre: "Horario de Tolva",
        descripcion:
          "Ventana de horas compartida del dia (Turno 1 y Turno 2), independiente del horario individual de cada persona; es la que usa la Liquidacion de Tolva del dia.",
      },
      {
        nombre: "Programacion existente",
        descripcion:
          "Panel derecho con lo ya guardado para la fecha: persona, puesto u novedad y horario, con opcion de eliminar cada registro.",
      },
    ],
  },

  {
    modulo: "Registro de asistencia",
    resumen: "Kiosko de marcacion de entrada y salida con foto automatica obligatoria.",
    proposito:
      "Pantalla de kiosko para que el personal marque su llegada y su salida: reloj de Colombia en grande, campo para el documento y dos botones gigantes, Entrada en verde y Salida en rojo. La camara permanece encendida y toma una foto automatica en cada marcacion; sin foto no se puede marcar. Esa marcacion alimenta la asistencia, los tableros y la nomina del dia.",
    puedes: [
      "Marcar la entrada digitando el documento y presionando el boton verde.",
      "Marcar la salida del dia con el boton rojo.",
      "Ver la hora y fecha de Colombia en vivo mientras se marca.",
      "Verse en la vista previa de la camara antes de marcar (la foto se toma sola al presionar el boton).",
    ],
    noPuedes: [
      "Marcar sin foto: si no hay camara, no hay permiso o la imagen esta congelada, el sistema bloquea la marcacion y explica que hacer.",
      "Marcar dos veces la entrada del mismo dia: el sistema avisa a que hora quedo la marcacion existente.",
      "Marcar si la persona tiene una novedad registrada hoy (incapacidad, licencia, vacaciones o descanso): la marcacion se bloquea.",
      "Marcar salida sin haber marcado entrada ese dia.",
    ],
    funcionalidades: [
      {
        nombre: "Marcacion con foto obligatoria",
        descripcion:
          "En cada entrada y salida se captura una foto automatica que queda guardada con el registro y se puede consultar despues en la tabla de asistencia. El sistema detecta camara desconectada o congelada y no deja marcar hasta corregirlo.",
      },
      {
        nombre: "Pantalla de kiosko",
        descripcion:
          "Reloj gigante con hora de Colombia, campo de documento con teclado numerico en pantallas tactiles y botones grandes con codigo de colores (verde entrada, rojo salida) legibles a distancia.",
      },
      {
        nombre: "Mensajes claros",
        descripcion:
          "Cada marcacion responde con un aviso grande de exito o de error con el motivo exacto (persona inactiva, ya marco, tiene novedad, sin foto), que desaparece solo a los pocos segundos.",
      },
    ],
  },

  {
    modulo: "Notificaciones al Personal",
    resumen: "Envia alertas, turnos y avisos a conductores por WhatsApp al celular del personal.",
    proposito:
      "Canal de comunicacion masiva con el personal del proyecto: permite enviar por WhatsApp una alerta general, la programacion de turnos de una fecha (cada persona recibe su puesto y horario) o un aviso a los conductores de los vehiculos de un dia. El mensaje se arma con plantillas que se personalizan solas con los datos de cada persona, y todo envio queda en un historial con su estado. Mientras WhatsApp no este activado, los envios se registran en modo prueba sin salir de la aplicacion.",
    puedes: [
      "Elegir el tipo de envio: Alerta (personal activo), Turnos (programados de una fecha) o Conductores (vehiculos de una fecha).",
      "Escribir el mensaje sobre la plantilla sugerida usando variables como el nombre, el puesto, la fecha, el horario o la placa, que se reemplazan por los datos de cada persona.",
      "Ver la vista previa del mensaje tal como lo recibira la primera persona seleccionada.",
      "Seleccionar los destinatarios uno a uno, todos los que tienen celular valido, o ninguno; los que no tienen celular quedan marcados.",
      "Enviar y ver el resultado: cuantos mensajes se procesaron, enviaron o simularon y cuantos fallaron.",
      "Consultar el historial de envios con fecha, persona, tipo, mensaje y estado (simulado, enviado, entregado, leido, error, sin celular).",
    ],
    noPuedes: [
      "Enviar a personas sin celular valido: aparecen deshabilitadas en la lista.",
      "Enviar mensajes reales mientras WhatsApp no este activado: en modo prueba el envio solo se registra, no llega al celular.",
      "Recibir respuestas aqui: es un canal de salida, no un chat.",
    ],
    funcionalidades: [
      {
        nombre: "Tres tipos de envio",
        descripcion:
          "Alerta va a todo el personal activo; Turnos toma a los programados de la fecha elegida y personaliza puesto y horario de cada uno; Conductores toma los vehiculos que llegan en la fecha y personaliza la placa.",
      },
      {
        nombre: "Plantillas con variables",
        descripcion:
          "El mensaje admite variables entre llaves (nombre, puesto, fecha, horario, placa) que se reemplazan con los datos reales de cada destinatario; la vista previa muestra el resultado antes de enviar.",
      },
      {
        nombre: "Destinatarios verificados",
        descripcion:
          "La lista muestra el celular de cada persona y marca a quienes no tienen numero valido; si el numero salio del banco de hojas de vida en lugar de la planta, aparece indicado.",
      },
      {
        nombre: "Historial con estados",
        descripcion:
          "Cada mensaje enviado queda registrado con su estado: simulado (modo prueba), enviado, entregado, leido, con error o sin celular.",
      },
    ],
    consejos: [
      "Mientras el canal este en modo prueba, usa el historial para validar que los mensajes queden bien armados antes de activar el envio real.",
    ],
  },
  // Guías agregadas 2026-09-30 (reorg de navegación: el buscador global usa este texto).
  {
    modulo: "Operación del día",
    resumen: "Panel del coordinador: cómo va el día en la planta, qué requiere atención y qué falta para cerrar.",
    proposito: "Reúne en una sola pantalla lo que el coordinador necesita al llegar y antes de irse: cobertura de personal de hoy, vehículos y toneladas contra la meta, pendientes que bloquean (vehículos sin cerrar, personas sin marcar, turnos por aprobar), solicitudes de personal y la lista de cierre del día. No calcula nada por su cuenta: reúne las cifras de los módulos que ya las producen.",
    puedes: [
      "Ver la cobertura de hoy por turno: programados, presentes y sin marcar.",
      "Ver vehículos de hoy, finalizados, sin cerrar, en patio, toneladas cerradas contra la meta y quién va más alto y más bajo.",
      "Resolver cada pendiente de la bandeja con un botón que abre el módulo donde se gestiona.",
      "Revisar las requisiciones de personal en curso y crear una nueva.",
      "Completar la lista de cierre del día y anotar la bitácora de hoy sin salir del panel.",
      "Generar el PDF de cierre del día desde Bitácora."
    ],
    noPuedes: [
      "Cerrar vehículos, aprobar turnos o marcar asistencia aquí: cada botón te lleva al módulo que lo hace.",
      "Ver dinero de nómina: el pago de la quincena vive en Compensación.",
      "Cambiar de fecha: el panel es siempre el día de hoy de la planta seleccionada."
    ],
    funcionalidades: [
      {
        nombre: "Cabecera de hoy",
        descripcion: "Vehículos y toneladas del día, finalizados y sin cerrar, meta del día, anillo de cobertura de hoy, vehículos en patio, personal activo y novedades abiertas."
      },
      {
        nombre: "Cobertura de hoy",
        descripcion: "Por cada turno, cuántos se programaron, cuántos marcaron y cuántos faltan por marcar, con la barra de asistencia confirmada."
      },
      {
        nombre: "Bandeja del día",
        descripcion: "Lo que requiere acción: turnos por aprobar, personas sin marcar, ausentismos sin completar y accidentes recientes, cada uno con su botón de ir a resolverlo."
      },
      {
        nombre: "Vehículos y toneladas de hoy",
        descripcion: "Las cifras del Centro de Coordinación y Control de Toneladas resumidas: toneladas cerradas contra la meta, más y menos toneladas por auxiliar, y los descargues por unidad aparte."
      },
      {
        nombre: "Cierre del día",
        descripcion: "Lista de lo que debe quedar en cero antes de irse: vehículos cerrados, asistencia completa, turnos aprobados y bitácora escrita. La bitácora se anota ahí mismo."
      }
    ],
    consejos: [
      "Si el anillo de cobertura baja, revisa primero 'personas sin marcar': suele ser gente que entró y no marcó en portería."
    ]
  },
  {
    modulo: "Productividad de Auxiliares",
    resumen: "Quién carga de verdad: toneladas reales por auxiliar según el equipo asignado a cada vehículo, ranking y ficha 360°.",
    proposito: "Informe de gerencia. Reparte el peso de cada vehículo cerrado entre el personal que el coordinador asignó de verdad en el Centro de Coordinación (no entre la lista de pago), para saber quién mueve más, quién menos y cómo se compara lo real con lo pagado. La tolva se muestra aparte porque es producción, y los descargues por unidad (huevos) no entran a toneladas.",
    puedes: [
      "Ver podios de cargue y descargue, ranking completo, toneladas por día y por mes, y vehículos por placa.",
      "Abrir la ficha 360° de un auxiliar: posición, días con operación frente a programados, comparación con el promedio del equipo, dónde estuvo cada día, con quién trabaja y qué vehículos atiende.",
      "Comparar toneladas reales contra las pagadas por nómina.",
      "Ocultar los apoyos externos ('AUXILIAR PRUEBA') para ver solo el personal de planta.",
      "Exportar todo a Excel."
    ],
    noPuedes: [
      "Modificar quién estuvo en un vehículo: eso se corrige en el Centro de Coordinación o en Corrección de Órdenes.",
      "Usarlo como nómina: la liquidación es la de Revisión de nómina.",
      "Tomar como reales los vehículos sin equipo registrado: se marcan como estimados con la lista de pago."
    ],
    funcionalidades: [
      {
        nombre: "Modo Equipo",
        descripcion: "Tarjetas por tipo de operación (cargue, descargue, distribución y tolva aparte), podios, ranking, vista por día, por mes y por vehículo."
      },
      {
        nombre: "Ficha 360°",
        descripcion: "Clic en cualquier auxiliar: toneladas y vehículos, días con operación contra programados, promedio del equipo en sus mismos días, gráfico diario, dónde estuvo día por día, compañeros frecuentes y placas que más atiende."
      },
      {
        nombre: "Tolva aparte",
        descripcion: "Las operaciones de tolva (producción de Indupan) se informan en su propia pestaña y nunca se suman a los vehículos."
      },
      {
        nombre: "Real contra pagado",
        descripcion: "Para cada auxiliar, lo que cargó de verdad frente a lo que la lista de pago le repartió; en verde cargó más de lo pagado, en rojo al revés."
      },
      {
        nombre: "Exportar",
        descripcion: "Excel con ranking, por día, matrices auxiliar por día y por mes, vehículos, tolva, detalle de órdenes y programación."
      }
    ]
  },
]
