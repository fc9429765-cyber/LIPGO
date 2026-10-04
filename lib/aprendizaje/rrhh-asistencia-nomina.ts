// Guias del modulo Aprendizaje — area "rrhh-asistencia-nomina".
// Generado por entregas; la clave `modulo` debe coincidir EXACTA con el menu.
import type { ContenidoAprendizaje } from "@/lib/aprendizaje-content"

export const APRENDIZAJE_RRHH_B: ContenidoAprendizaje[] = [
  // ==========================================================================
  // ASISTENCIA, TURNOS Y TIEMPOS
  // ==========================================================================
  {
    modulo: "Tabla Asistencia",
    resumen: "Panorama de la asistencia de hoy y asignacion de puestos al personal presente.",
    proposito:
      "Es el tablero del dia: muestra quien llego, a que hora, si llego tarde frente a su hora programada y quien sigue ausente. Desde aqui el supervisor asigna el puesto del dia a cada persona presente (operaciones o especialidades) o marca con Novedad a los ausentes, para que la jornada quede organizada desde temprano.",
    puedes: [
      "Ver el total de personal, presentes y ausentes del dia en tarjetas de resumen.",
      "Comparar la hora de llegada contra la hora programada: si llego tarde, la hora se marca en rojo con la etiqueta Tarde.",
      "Ver las fotos que la camara tomo automaticamente al marcar ingreso y salida; al tocarlas se amplian.",
      "Asignar a cada persona presente un puesto de Operaciones (cargue/descargue, tolva, distribucion...) o de Especialidades (pacas, cosedor, aseo, montacargas...).",
      "Marcar con Novedad a las personas ausentes para que pasen al flujo de novedades.",
      "Detectar con la alerta ambar 'Registrar novedad' a quien tiene puesto asignado, sigue ausente y todavia no llega su hora de entrada.",
      "Guardar todas las asignaciones del dia con un solo boton de Registrar Cambios.",
    ],
    noPuedes: [
      "Marcar el ingreso o la salida de una persona. Eso se hace en Registro de Asistencia, con foto automatica.",
      "Asignar un puesto a una persona ausente: los ausentes solo pueden llevar Novedad, y los presentes no pueden llevar Novedad.",
      "Cambiar la asignacion de alguien que ya quedo programado: su fila queda bloqueada con la etiqueta Programado.",
      "Trabajar dias pasados: la tabla siempre muestra el dia de hoy.",
    ],
    funcionalidades: [
      {
        nombre: "Tarjetas de resumen",
        descripcion: "Total de personal activo, presentes y ausentes del dia, actualizados con la marcacion real.",
      },
      {
        nombre: "Tabla del dia",
        descripcion:
          "Por persona: identificacion, nombre, hora programada, llegada, salida, fotos de ingreso/salida, puesto, estado (Presente/Ausente) y las casillas de asignacion.",
      },
      {
        nombre: "Asignacion de puesto",
        descripcion:
          "Casillas de Operaciones y Especialidades con su lista de puestos; al marcar una se despliega el selector del puesto concreto.",
      },
      {
        nombre: "Marca de Novedad",
        descripcion:
          "Casilla exclusiva para ausentes; deja a la persona lista para que su novedad se registre en Novedades de Personal.",
      },
      {
        nombre: "Alerta de novedad anticipada",
        descripcion:
          "Etiqueta ambar parpadeante sobre ausentes con puesto cuya hora de entrada aun no llega, para registrar la novedad por anticipado.",
      },
    ],
    consejos: [
      "El proyecto lo define el selector global de la parte superior; verifica estar en el proyecto correcto antes de asignar.",
      "Si una persona tiene una novedad activa ese dia (incapacidad, licencia, vacaciones o descanso), el sistema le bloquea la marcacion de asistencia.",
    ],
  },
  {
    modulo: "Visor",
    resumen: "Historial completo de asistencia con dashboards, edicion de novedades y seguimiento de conexiones.",
    proposito:
      "Es la consulta historica de la asistencia: todos los registros del proyecto, con estadisticas de turnos, ausentismos y su detalle por tipo. Ademas permite corregir la novedad de cualquier dia, y esas correcciones disparan efectos automaticos: un Retiro da de baja al colaborador y una incapacidad o licencia crea el borrador correspondiente en Ausentismos.",
    puedes: [
      "Consultar todo el historial de asistencia del proyecto, no solo los ultimos dias.",
      "Filtrar por rango de fechas y por nombre de la persona.",
      "Ver estadisticas: turnos totales, turnos con asistencia, ausentismos y el detalle por tipo de novedad, incluyendo las no reportadas.",
      "Editar la novedad de cualquier registro eligiendo de la lista oficial (incapacidades, licencias, vacaciones, retiro, descanso...).",
      "Dar de baja automaticamente a un colaborador al registrarle la novedad de Retiro: queda inactivo y sale del archivo de nomina.",
      "Revisar el Dashboard Diario, el Dashboard Historico y el Seguimiento a Conexiones (ubicaciones de marcacion).",
    ],
    noPuedes: [
      "Crear registros de asistencia nuevos: aqui solo se consultan y se corrigen las novedades de registros existentes.",
      "Cambiar horas de llegada o salida; solo se edita la novedad del dia.",
      "Registrar una novedad por fuera de la lista oficial de tipos.",
    ],
    funcionalidades: [
      {
        nombre: "Registros",
        descripcion:
          "Tabla historica con fecha, nombre, identificacion, puesto y novedad; resalta en amarillo las novedades no reportadas y en rojo las registradas.",
      },
      {
        nombre: "Editar novedad",
        descripcion:
          "Cambia la novedad de un dia puntual. Si eliges Retiro, el sistema da de baja al colaborador automaticamente.",
      },
      {
        nombre: "Puente automatico a Ausentismos",
        descripcion:
          "Al guardar una incapacidad o licencia no remunerada se crea o actualiza el borrador en Ausentismos, que luego alimenta el recobro; si cambias la novedad a otra cosa, el borrador huerfano se limpia.",
      },
      {
        nombre: "Dashboard Diario e Historico",
        descripcion: "Vistas graficas de la asistencia del dia y de la tendencia en el tiempo.",
      },
      {
        nombre: "Seguimiento a Conexiones",
        descripcion: "Mapa de las ubicaciones desde donde el personal marco su asistencia.",
      },
    ],
    consejos: [
      "Las estadisticas responden a los filtros: acota el rango de fechas para leer un periodo concreto.",
      "Antes de registrar un Retiro confirma la persona y la fecha: la baja es automatica.",
    ],
  },
  {
    modulo: "Turnos",
    resumen: "Catalogo de turnos por puesto con hora de entrada, vigencia, tarifa base y recargos.",
    proposito:
      "Aqui se configura la plantilla de turnos del proyecto: cada puesto con su hora de entrada, el periodo en que aplica y sus valores de pago (tarifa base y recargos de horas extra y nocturnos). Estos turnos son la referencia contra la que el sistema compara llegadas tarde y calcula pagos.",
    puedes: [
      "Crear un turno nuevo indicando puesto, hora de entrada, vigencia (fecha inicio y fin) y tarifas.",
      "Registrar la tarifa base y los recargos HED, HEDF, HEN, HEF y HN de cada puesto.",
      "Activar la opcion 'Aplica por tonelada' cuando el turno se liquida segun las toneladas movidas.",
      "Editar cualquier turno existente y actualizar sus valores.",
      "Eliminar un turno, con confirmacion previa.",
      "Buscar entre los turnos por nombre del puesto.",
    ],
    noPuedes: [
      "Asignar turnos a personas: aqui solo se define el catalogo; la asignacion diaria se hace en Tabla Asistencia y en programacion de turnos.",
      "Recuperar un turno eliminado: la eliminacion es definitiva.",
      "Trabajar sin proyecto: la empresa la define el selector global y se aplica automaticamente a cada turno.",
    ],
    funcionalidades: [
      {
        nombre: "Listado de turnos",
        descripcion:
          "Tabla con puesto, hora de entrada, vigencia, tarifa base, cada recargo y si aplica por tonelada, con acciones de editar y eliminar.",
      },
      {
        nombre: "Formulario de turno",
        descripcion:
          "Ventana para crear o editar: puesto, hora de entrada, vigencia, bloque de tarifas y recargos, y el interruptor de aplica por tonelada.",
      },
      {
        nombre: "Busqueda por puesto",
        descripcion: "Filtra el listado al instante para localizar un turno entre muchos registros.",
      },
    ],
    consejos: [
      "Usa la vigencia para cambios de tarifa: cierra el turno viejo con fecha fin y crea el nuevo, asi el historico queda intacto.",
    ],
  },
  {
    modulo: "Asignación horas extra",
    resumen: "Aprueba, rechaza o ajusta las horas extra ejecutadas por el personal de especialidades cada dia.",
    proposito:
      "Cruza las horas extra que el personal realmente ejecuto contra lo que el cliente habia solicitado. Las que no estaban programadas se resaltan en rojo para revisarlas antes de aprobar, porque solo lo aprobado se paga. El rechazo deja las horas en cero y el ajuste permite alinear lo ejecutado con lo programado o fijar un valor manual.",
    puedes: [
      "Consultar por fecha los registros de especialidades con horas de entrada y salida programadas y reales.",
      "Ver las horas extra ejecutadas por tipo (HED, HEDF, HEN, HEF, HN) y la cantidad solicitada por el cliente.",
      "Identificar de inmediato las filas en rojo con la etiqueta 'Hora extra no programada' y el aviso resumen de cuantas hay.",
      "Aprobar un registro para que sus horas extra queden en firme.",
      "Rechazar un registro: queda marcado y todas sus horas extra pasan a cero.",
      "Ajustar con un clic la hora ejecutada al valor programado, aprobando el registro en el mismo paso.",
      "Aplicar un ajuste manual a un campo de hora extra con un valor entre 0,5 y 5.",
    ],
    noPuedes: [
      "Modificar un registro que ya fue aprobado: la fila queda bloqueada.",
      "Crear horas extra desde cero: aqui solo se gestiona lo que quedo marcado en la asistencia del dia.",
      "Aplicar un ajuste manual por fuera del rango permitido (0,5 a 5).",
    ],
    funcionalidades: [
      {
        nombre: "Especialidades del dia",
        descripcion:
          "Tabla por fecha con horarios programados vs reales, horas extra por tipo, lo solicitado por el cliente y el estado de cada registro.",
      },
      {
        nombre: "Aprobar / Rechazar",
        descripcion:
          "Decision por fila. El rechazo pone en cero todos los campos de hora extra para que no se paguen.",
      },
      {
        nombre: "Ajustar a lo programado",
        descripcion:
          "Reemplaza la hora extra ejecutada por la cantidad que el cliente solicito y aprueba el registro en un solo paso.",
      },
      {
        nombre: "Ajuste manual",
        descripcion: "Fija un valor puntual (0,5 a 5) en el campo de hora extra que elijas antes de aprobar.",
      },
      {
        nombre: "Acceso al historial de Aprobar Turnos",
        descripcion: "Boton que abre directamente la vista de historial del modulo Aprobar Turnos.",
      },
    ],
    consejos: [
      "Aprueba solo cuando estes seguro: despues de aprobar no hay mas cambios en esa fila.",
      "Revisa primero las filas rojas: son horas ejecutadas que el cliente no habia solicitado.",
    ],
  },

  // ==========================================================================
  // RELACIONES LABORALES Y AUSENTISMO
  // ==========================================================================
  {
    modulo: "Novedades de personal",
    resumen: "Registra la novedad del dia (incapacidad, licencia, vacaciones, retiro...) al personal sin puesto asignado.",
    proposito:
      "Cierra el dia de las personas que no asistieron ni recibieron puesto: a cada una se le asigna la novedad que explica su ausencia, eligiendo de la lista oficial. Esa novedad alimenta la nomina y los reportes de ausentismo, y ciertas novedades tienen efectos automaticos: el Retiro da de baja al colaborador y las novedades activas bloquean la marcacion de asistencia de ese dia.",
    puedes: [
      "Ver el listado del personal que quedo sin puesto y sin novedad en la fecha seleccionada.",
      "Cambiar la fecha de trabajo con el calendario para gestionar dias anteriores pendientes.",
      "Asignar a cada persona una novedad de la lista oficial: licencias, incapacidades, vacaciones, retiro, descanso o compensatorio.",
      "Aplicar un rango de fechas para dejar registrada la misma novedad en dias futuros (util en incapacidades o vacaciones largas).",
      "Guardar todas las novedades seleccionadas en un solo paso; las filas guardadas quedan en verde con la marca Registrada.",
      "Actualizar el listado para traer de nuevo solo los pendientes.",
    ],
    noPuedes: [
      "Editar una novedad ya guardada desde aqui: la fila queda bloqueada. Las correcciones se hacen en el Visor de asistencia.",
      "Inventar tipos de novedad: solo se acepta la lista oficial.",
      "Asignar novedades a personas que ya tienen puesto o novedad ese dia: no aparecen en el listado.",
    ],
    funcionalidades: [
      {
        nombre: "Listado de pendientes",
        descripcion:
          "Personal activo sin puesto ni novedad para la fecha elegida, con nombre, identificacion y el selector de novedad.",
      },
      {
        nombre: "Rango para futuras novedades",
        descripcion:
          "Casilla que abre fecha inicio y fecha fin: la novedad queda aplicada a todos los dias del rango, sin repetir el registro dia a dia.",
      },
      {
        nombre: "Guardado en lote",
        descripcion:
          "Un solo boton guarda todas las filas con novedad seleccionada y las marca en verde como Registrada.",
      },
    ],
    consejos: [
      "La novedad de Retiro dispara la baja automatica del colaborador: queda inactivo y sale del archivo de nomina.",
      "Mientras la novedad este activa (incapacidad, licencia, vacaciones o descanso), la persona no podra marcar asistencia ese dia.",
    ],
  },
  {
    modulo: "Ausentismos",
    resumen: "Matriz de ausentismo laboral: incapacidades por enfermedad general (EG) y accidente de trabajo (AT).",
    proposito:
      "Centraliza el control de incapacidades del proyecto: cada evento con su colaborador, fechas, dias, diagnostico, costos y soporte clinico. Distingue enfermedad general (EG) de accidente de trabajo (AT), resalta los diagnosticos osteomusculares (codigo M) para revision del profesional de SST y es la fuente que alimenta el Recobro de Incapacidades. Recibe tambien los borradores que crea el puente automatico desde el Visor de asistencia.",
    puedes: [
      "Registrar un ausentismo digitando la cedula: nombre, cargo, estado y centro de trabajo se autocompletan desde el Head Count.",
      "Clasificar el evento como EG o AT; el costo de la entidad se acomoda solo (EG paga la EPS, AT lo asume la ARL al 100%).",
      "Buscar el diagnostico por codigo CIE-10 con autocompletado; los codigos M quedan en rojo y exigen revision de SST.",
      "Registrar dias de incapacidad y prorroga (el total se calcula solo), dias a cargo de la empresa y de la EPS/ARL, y los costos.",
      "Adjuntar el soporte clinico de la incapacidad, primer eslabon de la cadena de recobro.",
      "Completar los borradores que llegan del Visor y marcarlos como completos para que entren al recobro.",
      "Importar la matriz de ausentismo desde el Excel oficial y filtrar por año, mes, estado, tipo de evento, solo revision SST o solo borradores.",
    ],
    noPuedes: [
      "Gestionar el recobro desde aqui: el seguimiento ante EPS/ARL vive en Recobro de Incapacidades.",
      "Ver la hoja de costos consolidada: se movio a la pestaña Costos de Recobro de Incapacidades.",
      "Marcar como completo un ausentismo medico sin diagnostico o sin dias registrados.",
      "Filtrar por proyecto dentro del modulo: el proyecto lo manda el selector global.",
    ],
    funcionalidades: [
      {
        nombre: "Registro y edicion de ausentismos",
        descripcion:
          "Formulario completo por secciones: colaborador (autocompletado por cedula), evento, diagnostico CIE-10, costos, soporte y observaciones.",
      },
      {
        nombre: "Alerta de revision SST",
        descripcion:
          "Los diagnosticos con codigo M se resaltan en rojo en el formulario y en la tabla, con un contador de casos por revisar.",
      },
      {
        nombre: "Borradores del puente",
        descripcion:
          "Las incapacidades registradas como novedad en el Visor llegan aqui como borrador (fila ambar); se completan con diagnostico y soporte y se marcan como completas.",
      },
      {
        nombre: "Resumen con filtros",
        descripcion:
          "Tarjetas de incapacidades, accidentes de trabajo (contados por evento: las prorrogas no suman casos nuevos), enfermedad general y dias de ausentismo.",
      },
      {
        nombre: "Pestañas de analisis",
        descripcion: "Registros, Analisis (control diario) y Resumen grafico del ausentismo del proyecto.",
      },
      {
        nombre: "Importar Excel",
        descripcion:
          "Carga la matriz oficial de ausentismos a la empresa seleccionada; reemplaza las importaciones previas, con confirmacion.",
      },
    ],
    consejos: [
      "Sube siempre el soporte clinico: sin el, el caso no avanza en la cadena de recobro.",
      "Un accidente de trabajo se cuenta por evento, no por filas: la prorroga se agrega a la misma incapacidad.",
    ],
  },
  {
    modulo: "Recobro de Incapacidades",
    resumen: "Seguimiento del dinero recuperable ante EPS y ARL por las incapacidades pagadas.",
    proposito:
      "Muestra cuanto dinero de las incapacidades puede recuperar la empresa y en que estado va cada gestion. Aplica la regla de negocio: en enfermedad general los dias 1 y 2 los asume la empresa y del dia 3 en adelante los reconoce la EPS; en accidente de trabajo la ARL reconoce el 100% desde el dia 1. Cada caso se gestiona con evidencia obligatoria: correo radicado y comprobante de pago.",
    puedes: [
      "Ver los indicadores del recobro: recobrable total, recobrado, pendiente, en riesgo o perdida, porcentaje de recuperacion y costo no recobrable de la empresa.",
      "Analizar graficos del recobrable por entidad (EPS vs ARL), por mes y por estado de gestion.",
      "Gestionar cada caso: cambiar el estado (pendiente, radicado, recobrado, glosado, perdido), registrar valor recobrado, fecha de radicacion y observaciones.",
      "Adjuntar el correo enviado a la EPS/ARL y el comprobante de pago como evidencia de la gestion.",
      "Consultar el soporte clinico de la incapacidad, que se adjunta en Ausentismos y aqui se ve en solo lectura.",
      "Filtrar por año, mes, tipo de evento y estado del recobro, y revisar la pestaña de Costos de incapacidades.",
    ],
    noPuedes: [
      "Crear o editar la incapacidad: nace y se corrige en Ausentismos; los borradores pendientes ni siquiera entran al recobro.",
      "Marcar un caso como Radicado sin adjuntar el correo enviado a la EPS/ARL.",
      "Cerrar un caso como Recobrado sin adjuntar el comprobante de pago.",
      "Recobrar una enfermedad general de 2 dias o menos: por regla no aplica, esos dias los asume la empresa.",
    ],
    funcionalidades: [
      {
        nombre: "Indicadores del recobro",
        descripcion:
          "Seis tarjetas con el estado financiero del recobro segun los filtros: recobrable, recobrado, pendiente, riesgo, % de recuperacion y costo empresa.",
      },
      {
        nombre: "Graficos de analisis",
        descripcion: "Recobrable por entidad, evolucion mensual (recuperado, pendiente, riesgo) y valor por estado de gestion.",
      },
      {
        nombre: "Gestion caso a caso",
        descripcion:
          "Tabla con cada incapacidad, sus dias, valor recobrable y estado; el boton Gestionar abre la ventana de estado, valores y soportes.",
      },
      {
        nombre: "Candados de evidencia",
        descripcion:
          "El sistema exige el correo para Radicado y el comprobante de pago para Recobrado; sin adjunto no deja guardar ese estado.",
      },
      {
        nombre: "Costos de incapacidades",
        descripcion: "Pestaña con la hoja de costos consolidada de las incapacidades, respondiendo a los mismos filtros.",
      },
    ],
    consejos: [
      "Si aparece el aviso ambar de borradores, completalos primero en Ausentismos: hasta entonces no suman al recobro.",
      "Radica a tiempo: los estados Glosado y Perdido son dinero en riesgo que se muestra en rojo.",
    ],
  },

  // ==========================================================================
  // BIENESTAR
  // ==========================================================================
  {
    modulo: "Programa de Bienestar",
    resumen: "Gestion de los programas de bienestar del personal (en construccion).",
    proposito:
      "Espacio reservado para administrar los programas de bienestar de la compañia: salud, recreacion, educacion, reconocimiento y familiar, con sus evidencias e indicadores de cobertura y ejecucion. La primera fase muestra el alcance; el registro completo llega en la siguiente fase.",
    puedes: [
      "Conocer el alcance previsto del modulo: programas de salud, recreacion, educacion, reconocimiento y familiar.",
      "Verificar que el submodulo esta habilitado para tu usuario.",
      "Anticipar la siguiente fase, donde se gestionaran los programas con evidencias e indicadores.",
    ],
    noPuedes: [
      "Registrar o editar programas todavia: el modulo esta en construccion.",
      "Cargar evidencias o consultar indicadores: llegan en la siguiente fase.",
    ],
    funcionalidades: [
      {
        nombre: "Aviso de alcance",
        descripcion: "Tarjeta que explica que se gestionara aqui cuando el modulo entre en operacion.",
      },
      {
        nombre: "Fase 2 (proximamente)",
        descripcion: "Registro de programas de bienestar con evidencias e indicadores de cobertura y porcentaje ejecutado.",
      },
    ],
  },
  {
    modulo: "Participación y Evidencias",
    resumen: "Registro de participacion del personal en actividades de bienestar (en construccion).",
    proposito:
      "Espacio reservado para registrar quien participo en cada actividad de bienestar, medir la satisfaccion y calcular la cobertura alcanzada. La primera fase muestra el alcance; el registro de asistentes llega en la siguiente fase.",
    puedes: [
      "Conocer el alcance previsto: participacion de colaboradores, satisfaccion y cobertura de las actividades.",
      "Verificar que el submodulo esta habilitado para tu usuario.",
      "Anticipar la siguiente fase, donde los asistentes se tomaran del personal registrado en Head Count.",
    ],
    noPuedes: [
      "Registrar participantes o evidencias todavia: el modulo esta en construccion.",
      "Consultar satisfaccion o cobertura: llegan en la siguiente fase.",
    ],
    funcionalidades: [
      {
        nombre: "Aviso de alcance",
        descripcion: "Tarjeta que explica que se registrara aqui cuando el modulo entre en operacion.",
      },
      {
        nombre: "Fase 2 (proximamente)",
        descripcion: "Registro de asistentes por actividad, encuesta de satisfaccion y calculo de cobertura.",
      },
    ],
  },

  // ==========================================================================
  // NOMINA
  // ==========================================================================
  {
    // 2026-10-01: ya no es la proyeccion de nomina del ultimo dia de la quincena
    // (se paga el dia base). Conserva el nombre y el permiso `proyecciones`.
    modulo: "Proyecciones",
    resumen: "Programacion de vehiculos que el cliente entrega para manana y cuanto la cumple cada dia (vista LIP, Torre de Control).",
    proposito:
      "El cliente entrega un dia antes la programacion de los vehiculos de manana (cantidad, tipo de vehiculo, destino o ruta). El coordinador LIP la consigna en Operacion del dia > Programacion de manana (el cliente tambien puede, desde Pedidos y solicitudes). Aqui gerencia ve el cumplimiento primero: cuantos vehiculos programados llegaron de verdad a porteria, por tipo de vehiculo, dia a dia; y tambien puede consignar o corregir una programacion. Es la misma pantalla en las tres entradas.",
    puedes: [
      "Registrar o corregir la programacion de cualquier dia (por defecto manana): cantidad, tipo de vehiculo del catalogo, destino o ruta y producto opcional.",
      "Ver si la programacion de un dia llego a tiempo (antes de las 5:00 p. m. del dia anterior) o tarde, quien la envio y cuantas versiones tuvo.",
      "Consultar el cumplimiento por rango (semana, quincena, mes, mes anterior o fechas libres): porcentaje, programados, llegaron, no llegaron y vehiculos fuera de programacion.",
      "Abrir el detalle de un dia: por tipo de vehiculo (programados vs. llegados) y las lineas que envio el cliente.",
      "Ver desde Operacion del dia cuantos vehiculos programados llegaron hoy y si ya llego la programacion de manana (cierre del dia).",
    ],
    noPuedes: [
      "Medir el cumplimiento por destino o ruta: porteria registra el tipo de vehiculo, no el destino, asi que el cruce es por tipo (decision de gerencia para arrancar).",
      "Borrar una programacion enviada: cada cambio queda como version nueva y las anteriores se conservan como historial.",
      "Proyectar tonelaje o personal para la nomina: eso ya no existe; el ultimo dia de la quincena se paga el dia base y el ajuste va en Revision de Nomina.",
    ],
    funcionalidades: [
      {
        nombre: "Programacion del dia elegido",
        descripcion:
          "Botones Manana y Hoy o una fecha libre. Muestra el estado (sin programacion, enviada a tiempo o tarde, version, total de vehiculos), las lineas vigentes y el boton para modificar creando una version nueva.",
      },
      {
        nombre: "Formulario de lineas",
        descripcion:
          "Cantidad, tipo de vehiculo (catalogo Tipos de Vehiculos con su capacidad), destino o ruta con sugerencias de los usados antes, producto opcional y observacion. Al enviar queda la hora, quien la envio y si fue a tiempo.",
      },
      {
        nombre: "Cumplimiento",
        descripcion:
          "Programado vs. llegado a porteria por dia y por tipo de vehiculo, con porcentaje, enviadas a tiempo, dias operados sin programacion y grafico de barras del rango.",
      },
    ],
    consejos: [
      "Un dia con vehiculos pero sin programacion cuenta como 'sin programacion': pidele al cliente que la envie antes de las 5:00 p. m. para que el indicador sea justo.",
      "Si el cliente escribe 'Doble troque' y el catalogo dice 'Dobletroque', el cruce igual los reconoce como el mismo tipo.",
    ],
  },
  // Guías agregadas 2026-09-30 (reorg de navegación: el buscador global usa este texto).
  {
    modulo: "Procesos Disciplinarios",
    resumen: "Radicar una solicitud de medida disciplinaria y seguir el trámite de descargos hasta la decisión.",
    proposito: "La empresa usuaria reporta la conducta y solicita la medida; el empleador cita a descargos y decide. La pantalla mantiene esa separación porque una sanción impuesta sin oír al trabajador es ineficaz. Cada caso guarda relato, testigos, citación, descargos y decisión.",
    puedes: [
      "Radicar la solicitud con relato de los hechos y testigos.",
      "Registrar la citación a descargos, los descargos y la decisión.",
      "Consultar el estado de cada caso y su bitácora."
    ],
    noPuedes: [
      "Imponer la sanción desde la solicitud: el trámite de descargos es obligatorio.",
      "Verlo sin permiso propio: contiene relatos de conducta y nombres de testigos."
    ],
    funcionalidades: [
      {
        nombre: "Radicar",
        descripcion: "Formulario de la solicitud de medida: trabajador, hechos, fecha, testigos y medida solicitada."
      },
      {
        nombre: "Trámite",
        descripcion: "Pasos del proceso en orden: citación, descargos, decisión y notificación, cada uno con fecha y responsable."
      },
      {
        nombre: "Bitácora del caso",
        descripcion: "Historial de todo lo registrado en el caso para soporte ante una reclamación."
      }
    ]
  },
]
