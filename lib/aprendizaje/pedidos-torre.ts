// Guias del modulo Aprendizaje — area "pedidos-torre".
// Generado por entregas; la clave `modulo` debe coincidir EXACTA con el menu.
import type { ContenidoAprendizaje } from "@/lib/aprendizaje-content"

export const APRENDIZAJE_PEDIDOS: ContenidoAprendizaje[] = [
  // ==========================================================================
  // PROGRAMACION DEL CLIENTE (2026-10-01)
  // ==========================================================================
  {
    modulo: "Programación del cliente",
    resumen: "Si el cliente quiere, registra aqui los vehiculos que llegaran manana (el coordinador LIP la consigna si no) y ve cuanto se cumplio cada dia.",
    proposito:
      "Es la programacion para manana que el cliente entrega un dia antes: cuantos vehiculos, de que tipo y a que destino o ruta. El responsable de consignarla en LIPgo es el coordinador LIP (Operacion del dia > Programacion de manana), pero el cliente puede registrarla directamente aqui si lo prefiere; cualquiera de los dos, y vale la ultima version. Con ella LIP planea la operacion y el personal, y ambos miden el cumplimiento: cuantos de los vehiculos programados llegaron de verdad a porteria, por tipo de vehiculo.",
    puedes: [
      "Registrar la programacion de manana (o de otra fecha) con lineas de cantidad, tipo de vehiculo, destino o ruta y producto opcional.",
      "Corregirla las veces que haga falta: cada envio queda como version nueva y la ultima es la vigente.",
      "Ver si quedo a tiempo (antes de las 5:00 p. m. del dia anterior) o tarde, y a que hora se envio.",
      "Consultar el cumplimiento por semana, quincena, mes o fechas libres, con el detalle de cada dia por tipo de vehiculo.",
    ],
    noPuedes: [
      "Ver el cumplimiento por destino: porteria registra el tipo de vehiculo, no el destino, asi que la medicion es por tipo.",
      "Borrar una programacion enviada: queda el historial de versiones.",
      "Registrar vehiculos que llegaron: eso lo hace porteria en Registrar Vehiculos; aqui solo se programa y se compara.",
    ],
    funcionalidades: [
      {
        nombre: "Programacion de manana",
        descripcion:
          "Formulario con lineas (cantidad, tipo de vehiculo del catalogo, destino o ruta con sugerencias, producto, observacion) y el total de vehiculos. Muestra la hora limite y, si ya paso, avisa que quedara como tarde.",
      },
      {
        nombre: "Cumplimiento",
        descripcion:
          "Porcentaje de vehiculos programados que llegaron, los que no llegaron, los que llegaron sin programar y cuantas programaciones fueron a tiempo; grafico por dia y tabla con detalle desplegable.",
      },
    ],
    consejos: [
      "Enviala antes de las 5:00 p. m.: despues de esa hora queda marcada como tarde aunque llegue completa.",
      "Si cambia algo durante la noche, guarda una version nueva en vez de avisar por chat: asi el cumplimiento se mide contra lo ultimo que enviaste.",
    ],
  },
  // ==========================================================================
  // GESTION DE PEDIDOS
  // ==========================================================================
  {
    modulo: "Entrada de pedidos",
    resumen: "Registra pedidos nuevos con encabezado, productos y PDF automatico.",
    proposito:
      "Es la puerta de entrada de la operacion comercial: aqui se captura el pedido del cliente con todos sus datos (vendedor, cliente, destino, condicion de pago, tipo de despacho) y sus productos linea por linea. Al guardar, el sistema genera el PDF del pedido y lo descarga automaticamente para compartirlo o archivarlo.",
    puedes: [
      "Registrar un pedido nuevo eligiendo bodega origen, empresa que factura, vendedor, cliente, destino y fechas.",
      "Buscar el cliente y cada producto con un buscador con autocompletado, sin escribir el nombre completo.",
      "Agregar varias lineas de producto con cantidad y precio unitario; el total por linea y el total a pagar se calculan solos.",
      "Aplicar descuento de IVA y descuento por pronto pago (con porcentaje) al pedido completo.",
      "Anotar orden de compra, numero de pedido del cliente y observaciones adicionales.",
      "Obtener el PDF del pedido apenas se guarda: se genera y se descarga automaticamente.",
    ],
    noPuedes: [
      "Aprobar el pedido desde aqui. La aprobacion (cartera y gerencia) se hace en Gestionar pedidos.",
      "Guardar sin completar los campos obligatorios (*): vendedor, cliente, fecha programada, condicion de pago, tipo de despacho y bodega origen.",
      "Guardar un pedido sin al menos un producto agregado.",
      "Consultar o filtrar pedidos ya registrados. Para eso estan Gestionar pedidos y Gestion integral.",
    ],
    funcionalidades: [
      {
        nombre: "Encabezado del pedido",
        descripcion:
          "Datos generales: fecha, vendedor, cliente (con buscador), bodega/sucursal del cliente, destino, direccion, fecha programada de entrega, condicion de pago, tipo de despacho, orden de compra, numero de pedido y observaciones.",
      },
      {
        nombre: "Bodega origen y empresa que factura",
        descripcion:
          "La bodega origen define desde que proyecto sale el pedido (solo aparecen las bodegas a las que el usuario tiene acceso). La empresa factura indica a nombre de quien se emitira la factura.",
      },
      {
        nombre: "Lineas de producto",
        descripcion:
          "Cada linea se arma eligiendo categoria y producto (con buscador), cantidad y precio unitario. El subtotal y el total se recalculan en vivo al editar cualquier linea.",
      },
      {
        nombre: "Descuentos",
        descripcion:
          "Dos casillas opcionales: descuento de IVA y descuento por pronto pago con su porcentaje. Ambos se restan del total de la orden para obtener el total a pagar.",
      },
      {
        nombre: "PDF automatico",
        descripcion:
          "Al guardar, el sistema arma el PDF oficial del pedido con productos agrupados por categoria, totales y kilos de despacho, lo asocia al pedido y lo descarga de una vez.",
      },
    ],
    consejos: [
      "Este formulario tambien se abre en modo edicion desde Gestionar pedidos; en ese caso el titulo dice 'Editar Pedido #' y trae todos los datos cargados.",
      "La bodega origen se selecciona dentro del formulario segun tus accesos: revisa que sea el proyecto correcto antes de guardar, porque de ella depende a que operacion entra el pedido.",
    ],
  },
  {
    modulo: "Gestionar pedidos",
    resumen: "Consulta, edita, aprueba, anula y cierra los pedidos del proyecto activo.",
    proposito:
      "Es el centro de trabajo diario sobre los pedidos ya registrados. Aqui vive el ciclo de aprobacion en dos pasos (primero cartera, luego aprobacion final con contraseña) y las acciones de cierre: anular, cerrar un pedido parcial o cerrarlo con factura. Muestra los pedidos del proyecto seleccionado en la barra superior.",
    puedes: [
      "Filtrar los pedidos por cliente, vendedor, destino, estado, aprobado si/no y rango de fechas, y aplicar o limpiar los filtros.",
      "Ver el detalle completo de un pedido y abrir o descargar su PDF.",
      "Editar un pedido que aun no tenga revision de cartera ni aprobacion; al guardar se regenera el PDF automaticamente.",
      "Aprobar cartera y luego dar la aprobacion final del pedido, cada paso con su contraseña de autorizacion.",
      "Anular un pedido aprobado (con contraseña y observaciones) mientras no tenga orden de cargue asignada.",
      "Cerrar un pedido en estado parcial (Cerrar Pendiente) o hacer cierre con numero de factura para cualquier pedido aprobado.",
      "Exportar el listado filtrado a Excel.",
    ],
    noPuedes: [
      "Editar o eliminar un pedido que ya esta aprobado.",
      "Editar un pedido que ya tiene revision de cartera.",
      "Eliminar un pedido que ya tiene orden de cargue asignada.",
      "Dar la aprobacion final si el pedido no paso antes por la aprobacion de cartera.",
    ],
    funcionalidades: [
      {
        nombre: "Filtros y exportacion",
        descripcion:
          "Barra de filtros por cliente (con buscador), vendedor, destino, aprobado, estado y fechas desde/hasta. El boton Exportar a Excel baja exactamente lo que este filtrado en pantalla.",
      },
      {
        nombre: "Aprobacion en dos pasos",
        descripcion:
          "Primero 'Aprobar Cartera' (valida contraseña y deja registrado quien reviso) y despues 'Aprobar' (contraseña de aprobacion). Una vez aprobado, el pedido queda blindado: no se edita ni se elimina.",
      },
      {
        nombre: "Edicion con PDF regenerado",
        descripcion:
          "Mientras el pedido siga sin revision de cartera, se puede modificar todo (encabezado y productos). Al guardar, el PDF se regenera y descarga automaticamente.",
      },
      {
        nombre: "Anular pedido",
        descripcion:
          "Disponible solo para pedidos aprobados sin orden de cargue. Pide contraseña y observaciones del motivo, y deja el pedido anulado.",
      },
      {
        nombre: "Cierres",
        descripcion:
          "'Cerrar Pendiente' cierra un pedido en estado parcial (entrego parte y no va a completar). 'Cierre con Factura' registra el numero de factura para cerrar cualquier pedido aprobado.",
      },
    ],
    consejos: [
      "Este modulo obedece al selector global de empresa de la barra superior: si no ves un pedido, verifica primero en que proyecto estas parado.",
      "El orden importa: cartera revisa primero; sin esa revision el boton Aprobar queda deshabilitado.",
    ],
  },
  {
    modulo: "Gestión integral de pedidos",
    resumen: "Vista total de los pedidos de todos los proyectos, con filtro por owner.",
    proposito:
      "Panel para administrar los pedidos de todo el sistema en una sola tabla, sin depender del proyecto seleccionado. Suma el filtro por owner (dueño de la mercancia) y permite las mismas acciones de gestion: crear, editar, aprobar en dos pasos, anular y cerrar pendientes. Pensado para quien supervisa la operacion completa.",
    puedes: [
      "Ver los pedidos de todos los proyectos en una sola tabla, sin cambiar el selector de empresa.",
      "Filtrar por owner, cliente, vendedor, destino, estado, aprobado y fechas.",
      "Crear un pedido nuevo desde aqui (abre el mismo formulario de Entrada de pedidos) y volver a la tabla al guardar.",
      "Editar o eliminar pedidos que aun no esten aprobados ni revisados por cartera.",
      "Aprobar cartera y dar aprobacion final, anular pedidos aprobados sin orden de cargue y cerrar pedidos parciales.",
      "Descargar el PDF de cada pedido y exportar el listado filtrado a Excel.",
    ],
    noPuedes: [
      "Editar o eliminar pedidos ya aprobados, ni editar los que ya tienen revision de cartera.",
      "Anular un pedido que ya tiene orden de cargue asignada.",
      "Hacer cierre con factura desde esta vista; esa accion vive en Gestionar pedidos.",
    ],
    funcionalidades: [
      {
        nombre: "Alcance total del sistema",
        descripcion:
          "A diferencia de Gestionar pedidos, esta vista trae los pedidos de todos los proyectos. El foco se controla con los filtros, en especial el de owner.",
      },
      {
        nombre: "Filtro por owner",
        descripcion:
          "Permite quedarse solo con los pedidos de un dueño de mercancia especifico, algo clave cuando varios owners operan en las mismas bodegas.",
      },
      {
        nombre: "Nuevo pedido integrado",
        descripcion:
          "El boton 'Nuevo Pedido' abre el formulario de registro dentro del mismo modulo y regresa a la tabla actualizada al terminar.",
      },
      {
        nombre: "Acciones de gestion",
        descripcion:
          "Menu por fila con Editar, Eliminar, Aprobar Cartera, Aprobar, Anular y Cerrar Pendiente, con las mismas reglas de bloqueo que en Gestionar pedidos.",
      },
    ],
    consejos: [
      "Como muestra todo el sistema, usa siempre algun filtro (owner o fechas) para no trabajar sobre la lista completa por error.",
    ],
  },
  {
    modulo: "Dashboard Pedidos",
    resumen: "Tablero gerencial de pedidos: OTIF, tiempos de entrega y eficiencia de carga.",
    proposito:
      "Tablero de indicadores para leer la salud del proceso de pedidos sin abrir pedido por pedido. Arriba muestra un resumen ejecutivo (pedidos, lineas, facturado y ticket promedio) y luego tres pestañas: cumplimiento del dia, tiempos y atrasos, y eficiencia de carga. Es de consulta: aqui no se modifica ningun pedido.",
    puedes: [
      "Ver de un vistazo cuantos pedidos y lineas hay, cuanto suman en facturacion y el ticket promedio.",
      "Medir entregas a tiempo, pedidos completos (In-Full) y el OTIF global, ademas del volumen despachado.",
      "Comparar el tiempo de entrega prometido contra el real y detectar pedidos atrasados, que vencen hoy o por vencer.",
      "Revisar el cumplimiento de carga: porcentaje global, tasa de carga perfecta y unidades pendientes, con comparacion contra meses anteriores.",
      "Ver los top 5 de destinos, vendedores y clientes por volumen de pedidos.",
      "Actualizar los datos en el momento con el boton Actualizar.",
    ],
    noPuedes: [
      "Crear, editar o aprobar pedidos. Es un tablero de solo lectura.",
      "Exportar los graficos; para llevarte datos usa la exportacion a Excel de Gestionar pedidos.",
    ],
    funcionalidades: [
      {
        nombre: "Resumen ejecutivo",
        descripcion:
          "Franja superior con fecha y hora, total de pedidos, total de lineas, valor facturado y ticket promedio del alcance visible.",
      },
      {
        nombre: "Centro de Comando Operativo",
        descripcion:
          "Cumplimiento del cierre del dia/mes/año: entregas a tiempo vs tarde, In-Full, OTIF global, volumen despachado, cuantos pedidos ingresaron y se entregaron, y los top 5 de destinos, vendedores y clientes.",
      },
      {
        nombre: "Tiempos y Cuellos de Botella",
        descripcion:
          "Lead time prometido vs real, pedidos a tiempo vs atrasados, retraso promedio y semaforo de pedidos atrasados, que vencen hoy y por vencer.",
      },
      {
        nombre: "Eficiencia de Carga e In-Full",
        descripcion:
          "Porcentaje de cumplimiento global, tasa de carga perfecta y unidades pendientes, con tendencia del ultimo mes, delta contra el mes anterior, promedio de 3 meses y mejor/peor mes.",
      },
    ],
    consejos: [
      "El tablero sigue el selector global de empresa: cambia de proyecto en la barra superior y los indicadores se recargan solos.",
    ],
  },

  // ==========================================================================
  // TORRE DE CONTROL
  // ==========================================================================
  {
    modulo: "Dashboard Operacion",
    resumen: "Torre de control del dia: toneladas vs meta, patio, ordenes y programacion por hora.",
    proposito:
      "Pantalla de mando de la operacion diaria del proyecto activo. Muestra en vivo el avance de toneladas contra la meta del dia, el pulso de ordenes y personal, los vehiculos en patio, los clientes en proceso y la carga programada por franja horaria, ademas del detalle orden por orden. Cuando se mira el dia de hoy, se refresca sola cada dos minutos.",
    puedes: [
      "Seguir el cumplimiento de toneladas del dia: meta, programado y ejecutado, con estados tipo meta cumplida, en curso, en riesgo o critico.",
      "Ver el pulso operativo de ordenes y personal, y un ticker con anuncios de la informacion clave del dia.",
      "Revisar los vehiculos en patio y los clientes en proceso con sus tiempos.",
      "Leer la programacion por hora (franja 6:00 a 18:00) y detectar la hora pico de carga.",
      "Consultar el detalle de cada operacion: cliente, orden, placa, tipo de operacion, peso, horas de cada hito (llegada, pesaje, lote, inicio y fin) y su estado.",
      "Cambiar la fecha para revisar un dia pasado (queda marcado como Historico) y volver a hoy con un clic.",
      "Activar el modo TV para proyectar el tablero a pantalla completa en un monitor (se sale con ESC).",
    ],
    noPuedes: [
      "Modificar ordenes, pesos ni estados desde aqui. Todo se lee; los cambios se hacen en los modulos operativos.",
      "Ver fechas futuras: el selector solo permite hasta el dia de hoy.",
      "Ver varias empresas a la vez: siempre muestra el proyecto del selector global.",
    ],
    funcionalidades: [
      {
        nombre: "Cumplimiento de toneladas",
        descripcion:
          "Medidor principal del dia: meta contra ejecutado y pendiente programado, con codigo de color segun el avance.",
      },
      {
        nombre: "Pulso operativo",
        descripcion:
          "Tarjetas de ordenes (cargadas, descargadas, distribucion) y de personal del dia, para saber con que capacidad se esta operando.",
      },
      {
        nombre: "Vista de mando",
        descripcion:
          "Tres paneles: vehiculos en patio, clientes en proceso con sus tiempos y programacion por hora con la hora pico resaltada.",
      },
      {
        nombre: "Detalle de operaciones",
        descripcion:
          "Tabla orden por orden con placa, peso, horas de cada paso del proceso y estado (sin lote, por pesar, en cola, en proceso, fin de operacion).",
      },
      {
        nombre: "Modo TV",
        descripcion:
          "Boton TV que oculta menus, pasa a pantalla completa y deja el tablero listo para un televisor de planta. ESC o el mismo boton regresan a la vista normal.",
      },
    ],
    consejos: [
      "Depende del selector global de empresa: si el tablero se ve vacio, confirma el proyecto elegido en la barra superior.",
      "En el dia de hoy los datos se refrescan solos cada 2 minutos; en fechas pasadas la foto es fija.",
    ],
  },
  {
    modulo: "Asistente IA",
    resumen: "LIPbot a pantalla completa: pregunta por tus datos, navega y ejecuta acciones.",
    proposito:
      "Chat de inteligencia artificial del sistema en pantalla completa. Responde preguntas sobre los datos reales de la operacion (pedidos, ordenes de cargue, inventario, indicadores), puede abrirte el modulo que necesites y, con tu confirmacion, ejecutar acciones puntuales como registrar una novedad de personal o aprobar horas extra. Trabaja siempre sobre la empresa activa del selector global.",
    puedes: [
      "Preguntar en lenguaje natural por datos reales: cuantos pedidos van en el mes, que ordenes de cargue estan pendientes, el stock disponible de un producto.",
      "Consultar como van los indicadores y KPIs del proyecto: SLA, cumplimiento de cargues, toneladas contra meta, ausentismo, satisfaccion, entre otros.",
      "Pedirle que te abra un modulo o submodulo del sistema; el asistente navega por ti si tienes el permiso.",
      "Ejecutar acciones controladas previa confirmacion: registrar una novedad a un trabajador (incapacidad, licencia, vacaciones...) o aprobar horas extra.",
      "Usar las sugerencias rapidas de la pantalla inicial para descubrir que sabe hacer.",
      "Detener una respuesta en curso con el boton de parar.",
    ],
    noPuedes: [
      "Cambiar de empresa desde el chat: el chip del encabezado solo informa la empresa activa; se cambia en la barra superior.",
      "Saltarte permisos: el asistente valida tus accesos antes de abrir modulos o ejecutar acciones.",
      "Modificar las tablas nucleo del sistema: las escrituras estan limitadas a acciones y formatos habilitados, siempre con tu confirmacion explicita.",
    ],
    funcionalidades: [
      {
        nombre: "Consulta de datos reales",
        descripcion:
          "Lee la informacion de logistica e inventario del proyecto activo (solo lectura) y responde con cifras exactas cuando preguntas cantidades.",
      },
      {
        nombre: "Indicadores y KPIs",
        descripcion:
          "Responde 'como va' cualquier indicador del proyecto con su valor real, meta y unidad: SLA, cumplimiento, toneladas, satisfaccion, ausentismo y mas.",
      },
      {
        nombre: "Navegacion asistida",
        descripcion:
          "Pide 'abreme tal modulo' y el asistente te lleva directo, validando primero que tengas permiso sobre ese modulo.",
      },
      {
        nombre: "Acciones con confirmacion",
        descripcion:
          "Puede registrar novedades de personal, aprobar horas extra o llenar formatos habilitados, pero solo despues de que confirmes explicitamente la accion en el chat.",
      },
    ],
    consejos: [
      "Verifica el chip de empresa del encabezado antes de preguntar: las respuestas salen del proyecto activo en el selector global.",
      "Las respuestas son generadas por IA y pueden contener errores: valida las cifras criticas en el modulo correspondiente antes de decidir.",
      "Enter envia el mensaje; Shift + Enter inserta un salto de linea.",
    ],
  },
]
