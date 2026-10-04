// Guias del modulo Aprendizaje — area "compensacion".
// Generado por entregas; la clave `modulo` debe coincidir EXACTA con el menu.
import type { ContenidoAprendizaje } from "@/lib/aprendizaje-content"

export const APRENDIZAJE_COMPENSACION: ContenidoAprendizaje[] = [
  // ==========================================================================
  // NOMINAPERSONAL
  // ==========================================================================
  {
    modulo: "Nominapersonal",
    resumen: "Consulta el pago del personal: toneladas movidas, liquidacion diaria y archivo plano para Siigo.",
    proposito:
      "Es la ventana de consulta de la nomina del proyecto seleccionado. Reune en un solo lugar lo que cada persona gano por toneladas (destajo), la liquidacion completa dia a dia (base, bonos, horas extra y recargos) y las novedades que salen al archivo plano de Siigo. Se usa para revisar y exportar, no para modificar: los valores nacen de las operaciones ya registradas en el sistema.",
    puedes: [
      "Ver el total de toneladas y pago por persona y por dia, con el acumulado del mes en tarjetas.",
      "Abrir el detalle por orden de cargue: peso de la operacion, cuantos auxiliares participaron, toneladas y pago de cada uno con su tarifa.",
      "Consultar la liquidacion diaria completa: base del dia, bono de productividad, horas extra, recargos, pago de domingo y total liquidado.",
      "Cambiar entre tres lecturas de la liquidacion: detalle fila a fila, consolidado por dia (expandible por persona) y resumen por persona del periodo.",
      "Filtrar por rango de fechas, persona, orden de cargue o tipo de operacion segun la vista.",
      "Ver el archivo plano de novedades para Siigo, filtrado por mes y quincena.",
      "Exportar cualquiera de las vistas a Excel.",
    ],
    noPuedes: [
      "Modificar valores de pago, toneladas o novedades. Es solo consulta; los datos nacen de las ordenes, la asistencia y las aprobaciones de otros modulos.",
      "Generar o enviar el archivo a Siigo desde aqui. Solo se consulta y se exporta a Excel.",
      "Ver varios proyectos a la vez: la informacion sigue el proyecto elegido en el selector global.",
    ],
    funcionalidades: [
      {
        nombre: "Pago de Toneladas",
        descripcion:
          "Total de toneladas, pago y operaciones por persona y por dia. Incluye tarjetas con las toneladas y el pago del mes en curso, filtros por fechas y persona, y exportacion a Excel.",
      },
      {
        nombre: "Detalle Toneladas",
        descripcion:
          "Desglose por orden de cargue: peso total de la operacion, cantidad de auxiliares, toneladas que le tocaron a cada uno, tarifa aplicada y pago. Sirve para verificar como se repartio una orden puntual.",
      },
      {
        nombre: "Ver Liquidacion",
        descripcion:
          "Liquidacion diaria de nomina con base del dia, bonificaciones, horas extra (diurnas, nocturnas, festivas), recargos y total liquidado. Tarjetas de base liquidada del mes, bono de productividad (neto por quincena) y pago real (base + bono). El boton Buscar consulta por el rango de fechas elegido.",
      },
      {
        nombre: "Consolidado y resumen",
        descripcion:
          "Dentro de Ver Liquidacion: el consolidado agrupa por dia y se expande para ver el total de cada persona; el resumen por persona muestra toneladas, dias en cargue, dias de turno, festivos y total liquidado del periodo en una sola fila.",
      },
      {
        nombre: "Archivo Plano",
        descripcion:
          "Novedades de nomina en el formato que espera Siigo: contrato, identificacion, novedad, cantidad o valor, fechas y dias no habiles. Se filtra por mes y quincena y se exporta a Excel.",
      },
    ],
    consejos: [
      "El modelo es base + bono: cada dia trabajado paga su base y el excedente del destajo se convierte en bono neto por quincena. Por eso el pago real es base mas bono, no la suma directa de toneladas.",
      "El dia 31 del mes no paga base: solo novedades (horas extra, recargos) y lo producido a destajo.",
      "Si un rango amplio parece incompleto, usa el boton Buscar para reconsultar con las fechas elegidas.",
    ],
  },

  // ==========================================================================
  // LIQUIDACIONES
  // ==========================================================================
  {
    modulo: "Liquidaciones",
    resumen: "Controla la liquidacion final del personal retirado: nomina pendiente mas prestaciones sociales.",
    proposito:
      "Cuando una persona con contrato se retira, aqui aparece automaticamente con todo lo que se le debe: la nomina que quedo pendiente de pago (los dias posteriores a la fecha 'Pagado hasta') y sus prestaciones sociales (prima, cesantias, intereses a las cesantias y vacaciones), calculadas segun la ley colombiana. Sirve para cerrar cada retiro con soporte y dejar constancia de que quedo pagado.",
    puedes: [
      "Ver el listado de retirados con contrato del proyecto, con su nomina pendiente, cada prestacion y el total a pagar.",
      "Definir por persona la fecha 'Pagado hasta': la nomina pendiente son las novedades posteriores a esa fecha y hasta el retiro.",
      "Expandir cada persona para ver el detalle dia a dia de lo que se le debe (base, extras y recargos por fecha).",
      "Marcar una liquidacion como Liquidada cuando se paga, o reabrirla si hizo falta algo.",
      "Adjuntar el soporte del pago (PDF o imagen) y consultarlo despues desde la misma fila.",
      "Ajustar los porcentajes de ley de las prestaciones y recalcular en el momento.",
      "Exportar todo el cuadro a Excel y consultar la hoja de nomenclatura legal con la norma detras de cada concepto.",
    ],
    noPuedes: [
      "Registrar el retiro desde aqui: la persona entra a este cuadro cuando se registra su novedad de retiro en el flujo de personal.",
      "Pagar desde el modulo: es un cuadro de control; el pago se hace por fuera y aqui se marca y se soporta.",
      "Ver retirados sin contrato: el cuadro cubre solo al personal retirado con numero de contrato.",
    ],
    funcionalidades: [
      {
        nombre: "Cuadro de retirados",
        descripcion:
          "Una fila por persona retirada con nomina pendiente, prima, cesantias, intereses, vacaciones, total a pagar y estado (pendiente o liquidada). Tarjetas superiores con retirados, pendientes y totales.",
      },
      {
        nombre: "Pagado hasta y detalle diario",
        descripcion:
          "Al expandir una persona se fija hasta que fecha ya se le pago; el sistema recalcula la nomina pendiente y muestra las novedades dia a dia que la componen.",
      },
      {
        nombre: "Parametros de ley",
        descripcion:
          "Porcentajes editables de prima, cesantias, intereses y vacaciones. La base incluye el bono de productividad (es salario para prestaciones); las vacaciones van sobre el salario ordinario, sin horas extra ni auxilio.",
      },
      {
        nombre: "Soporte y cierre",
        descripcion:
          "Boton para subir el comprobante del pago y boton Liquidar/Reabrir para dejar el estado real de cada liquidacion. Todo exportable a Excel.",
      },
    ],
    consejos: [
      "Antes de marcar Liquidada, verifica que la fecha 'Pagado hasta' este bien puesta: de ella depende cuanta nomina pendiente calcula el sistema.",
      "La hoja de nomenclatura legal explica la norma y la formula de cada concepto; usala si hay dudas con un calculo. Siempre prima la ley.",
    ],
  },

  // ==========================================================================
  // PARAFISCALES
  // ==========================================================================
  {
    modulo: "Parafiscales",
    resumen: "Cuadro mensual de aportes a seguridad social y parafiscales (planilla PILA) por entidad y por persona.",
    proposito:
      "Calcula cuanto debe girar la empresa cada mes a los entes de control: pension, salud, ARL, caja de compensacion, SENA e ICBF. El calculo parte del ingreso base de cotizacion real de cada trabajador (salario mas extras, recargos y dominicales, sin auxilio de transporte) y aplica automaticamente la exoneracion del articulo 114-1 para quienes devengan menos de 10 salarios minimos. Sirve para preparar y verificar la planilla PILA antes de pagarla.",
    puedes: [
      "Elegir el año y el mes a consultar, por proyecto o consolidado de todo LIP.",
      "Ver una tarjeta por entidad (pension, salud, ARL, caja, SENA, ICBF) con lo que paga la empresa, lo retenido al trabajador y el total a girar.",
      "Revisar el detalle por trabajador: dias del mes por tipo (trabajados, vacaciones, incapacidad, ausentismo, licencia), su base de cotizacion y cada aporte.",
      "Editar los parametros de ley por año, con cada valor contrastado contra la norma que lo fija.",
      "Elegir la clase de riesgo ARL del personal operativo y del administrativo por separado.",
      "Ver un ejemplo en vivo de cuanto cuesta un trabajador de salario minimo con los parametros actuales.",
      "Consultar la nomenclatura legal con la norma, base y formula de cada aporte.",
    ],
    noPuedes: [
      "Generar o pagar la planilla PILA desde aqui: es el cuadro de control para verificarla, el pago se hace en el operador de planilla.",
      "Guardar parametros fuera del rango legal: el sistema lo bloquea; y si un valor se aparta de la ley vigente exige confirmar que responde a una reforma.",
      "Marcar quien es administrativo: eso se define en Head Count y aqui solo se aplica (cambia su clase de ARL).",
    ],
    funcionalidades: [
      {
        nombre: "Resumen por entidad",
        descripcion:
          "Tarjetas con el aporte del mes a cada ente de control, separando lo que asume la empresa de lo retenido al trabajador, y totales del mes: trabajadores, base de cotizacion, aporte empresa y total planilla.",
      },
      {
        nombre: "Detalle por trabajador",
        descripcion:
          "Cada dia cotiza segun su tipo: vacaciones aportan a pension y caja; incapacidad a pension y salud; licencia remunerada a pension, salud y caja; ausentismo solo pension del empleador. La ARL solo se causa sobre dias efectivamente trabajados.",
      },
      {
        nombre: "Exoneracion articulo 114-1",
        descripcion:
          "Quien devenga menos de 10 salarios minimos exonera a la empresa de salud patronal, SENA e ICBF. La caja de compensacion nunca se exonera. Los conceptos que no se causan aparecen con guion.",
      },
      {
        nombre: "Cuadro de mando de parametros",
        descripcion:
          "Los porcentajes se guardan por año: cambiar el año edita ese año sin tocar los anteriores. Cada valor muestra la norma, el valor de ley y su estado (conforme, difiere o fuera de rango), con boton para restaurar los valores de ley.",
      },
    ],
    consejos: [
      "Si un trabajador aparece con base de ARL menor que su base total es normal: las novedades que impiden asistir (vacaciones, incapacidad) no pagan ARL.",
      "Usa el consolidado LIP para el total real de la planilla; por proyecto sirve para repartir el costo entre clientes.",
    ],
  },

  // ==========================================================================
  // REVISION DE NOMINA
  // ==========================================================================
  {
    modulo: "Revisión de nómina",
    resumen: "Arma el cuadro definitivo de la quincena y cruza nomina, bascula, asistencia y el ajuste de la quincena anterior.",
    proposito:
      "Es el modulo de auditoria de la nomina antes de pagar. Para un colaborador (o el proyecto completo) y una quincena, arma el cuadro definitivo del modelo base + bono: liquidacion diaria, cruce del destajo contra la base, archivo plano y simulacion de como quedaria el pago en Siigo. Ademas trae cruces de control: personas reales por dia contra el plan, toneladas de bascula contra lo pagado, auxiliares que cobraron tonelaje contra su asistencia, y el Ajuste Nomina Anterior de los dias que se pagaron a dia pleno.",
    puedes: [
      "Revisar a un colaborador o al proyecto completo por año, mes y quincena con un solo boton.",
      "Ver la liquidacion diaria (cada dia paga su base; el turno suma recargos) y el cruce del destajo: dias altos aportan, dias bajos consumen, y el neto define el bono o la perdida que asume la empresa.",
      "Verificar el cumplimiento de la meta de toneladas por trabajador y los dias bajo meta.",
      "Comparar el archivo plano contra la simulacion del pago en Siigo y ver la diferencia por componente y por colaborador.",
      "Consultar las personas reales que movieron toneladas cada dia frente al plan configurado.",
      "Conciliar las toneladas de bascula contra las asignadas al personal y las que liquida la nomina, con alertas cuando algo no cuadra.",
      "Cruzar quien cobro tonelaje contra su asistencia del dia: en regla, sin marcar, con novedad o sin registro.",
      "Generar, aprobar o rechazar el Ajuste Nomina Anterior: para quien gana por toneladas, la diferencia entre el dia pleno que se le pago el ultimo dia de la quincena (base fija, sin mirar el tonelaje) y lo que produjo real ese dia; se aplica en la siguiente quincena.",
    ],
    noPuedes: [
      "Editar la liquidacion a mano: el cuadro se arma con lo ya registrado en operaciones, asistencia y novedades.",
      "Pagar desde aqui: es revision; el unico cambio que produce son los ajustes de nomina anterior aprobados, que entran como novedad a la quincena siguiente.",
      "Revisar colaboradores de otro proyecto: el listado sigue el selector global.",
    ],
    funcionalidades: [
      {
        nombre: "Por colaborador",
        descripcion:
          "Cuadro definitivo de la quincena en secciones: liquidacion diaria, cruce de destajo (base garantizada, ingreso por turno, bono neto o perdida de productividad), archivo plano hacia Siigo y simulacion del pago con su diferencia. Tambien disponible consolidado para todo el proyecto.",
      },
      {
        nombre: "HC por dia",
        descripcion:
          "Por proyecto y mes: cuantos trabajadores distintos movieron toneladas cada dia (real) contra el plan configurado, toneladas por trabajador y si cumplen la meta.",
      },
      {
        nombre: "Conciliacion bascula-pago",
        descripcion:
          "La bascula es la fuente de verdad: compara sus toneladas contra las repartidas al personal y contra las que liquida la nomina, marca ordenes con diferencia entre peso de producto y peso de bascula, y consolida por colaborador.",
      },
      {
        nombre: "Auxiliares vs Asistencia",
        descripcion:
          "Cruza quien cobro tonelaje en las ordenes contra los registros de asistencia del dia. Clasifica cada asignacion: en regla, programado sin marcar ingreso, con novedad (incapacidad o ausencia ese dia) o sin ningun registro.",
      },
      {
        nombre: "Ajuste Nomina Anterior",
        descripcion:
          "El ultimo dia de cada quincena (el 15, o el ultimo dia del mes) a quien gana por toneladas se le paga el 'dia pleno' (base fija, sin mirar produccion). Esta pantalla cruza ese dia pleno pagado contra lo que realmente produjo ese dia en cargue/descargue/distribucion, genera lineas de ajuste (a favor o en contra) que quedan pendientes, y permite aprobarlas o rechazarlas. Volver a generar actualiza el ajuste, no lo duplica.",
      },
    ],
    consejos: [
      "Revisa la quincena completa antes del pago: la seccion de simulacion muestra la diferencia exacta entre lo que liquida el sistema y lo que saldria en Siigo.",
      "En el cruce de asistencia, 'sin registro' suele ser un nombre mal escrito o una persona no registrada ese dia: corrige la causa antes de pagar.",
    ],
  },

  // ==========================================================================
  // BONOS
  // ==========================================================================
  {
    modulo: "Bonos",
    resumen: "Registra y aprueba bonos operativos y administrativos por dia y por persona.",
    proposito:
      "Permite reconocer pagos adicionales puntuales al personal, con su motivo y su novedad de Siigo. Todo bono nace pendiente: solo cuando alguien con la clave de aprobacion lo aprueba, entra a la nomina y sale en el archivo plano. Son bonos no prestacionales: se pagan al trabajador pero no cotizan a seguridad social ni sirven de base para prima, cesantias o vacaciones.",
    puedes: [
      "Registrar un bono eligiendo tipo (operativo o administrativo), colaborador, fecha, valor, concepto y la novedad con la que saldra a Siigo.",
      "Elegir operativos del proyecto del selector global, o administrativos de todo LIP sin importar el proyecto.",
      "Consultar los bonos de un periodo con filtros propios de fechas, proyecto, estado y tipo, con tarjetas de pendientes, aprobados y rechazados.",
      "Aprobar bonos pendientes ingresando la clave de aprobacion (se pide una vez por pantalla).",
      "Rechazar un bono dejando el motivo escrito, o eliminar uno que siga pendiente.",
    ],
    noPuedes: [
      "Aprobar sin la clave: sin ella se puede consultar y rechazar, pero no aprobar. El sistema la valida en cada aprobacion.",
      "Eliminar un bono ya aprobado: si fue un error, se rechaza para dejar rastro.",
      "Hacer que un bono cotice a seguridad social: por diseño no entra a la base de cotizacion ni genera prestaciones.",
    ],
    funcionalidades: [
      {
        nombre: "Registrar",
        descripcion:
          "Formulario con el tipo como interruptor: habilita el campo de colaborador operativo o el administrativo, para no cruzar bonos entre poblaciones. El bono queda pendiente y todavia no impacta la nomina.",
      },
      {
        nombre: "Aprobacion y consulta",
        descripcion:
          "Listado del periodo con filtros adicionales al selector global (proyecto, estado, tipo, rango de fechas). Cada fila muestra concepto, novedad de Siigo, valor, estado y quien lo aprobo o el motivo del rechazo.",
      },
      {
        nombre: "Clave de aprobacion",
        descripcion:
          "Aprobar convierte el bono en plata pagada, por eso va detras de clave. Se desbloquea por pantalla y se puede volver a bloquear; el control real esta en el servidor, que revalida en cada aprobacion.",
      },
    ],
    consejos: [
      "Escribe conceptos claros: el motivo queda registrado y es lo que ve quien aprueba.",
      "Si no aparece nadie en el listado administrativo, primero hay que marcar a esas personas como administrativas en Head Count.",
    ],
  },

  // ==========================================================================
  // ASIGNACION DE APOYO EN CARGUE
  // ==========================================================================
  {
    modulo: "Asignación de apoyo en cargue",
    resumen: "Suma personal extra a una orden de cargue o descargue del dia para que entre al reparto de toneladas.",
    proposito:
      "Cuando una orden necesita manos adicionales (por ejemplo, alguien de turno fijo que baja a apoyar el cargue), aqui se le agrega a la orden sin quitar a nadie: el apoyo se suma al personal ya asignado y el tonelaje de la orden se reparte entre todos. Asi la persona que apoyo tambien cobra su parte de las toneladas de esa orden.",
    puedes: [
      "Ver las ordenes de cargue y descargue de una fecha, con su peso base, tarifa y el personal ya asignado con su pago actual.",
      "Agregar una o varias personas presentes ese dia como apoyo de una orden.",
      "Ver antes de confirmar como queda el pago por persona: cuanto ganaba cada uno antes y cuanto despues de sumar el apoyo.",
      "Quitar un apoyo agregado desde este modulo si se asigno por error.",
      "Buscar personal por nombre; los de turno fijo aparecen marcados.",
    ],
    noPuedes: [
      "Reemplazar o quitar al personal asignado originalmente en Picking o Packing: el apoyo solo se suma.",
      "Agregar como apoyo a alguien que ya esta asignado a esa orden.",
      "Quitar personal que no fue agregado desde este modulo.",
    ],
    funcionalidades: [
      {
        nombre: "Ordenes del dia",
        descripcion:
          "Listado por fecha de las ordenes de cargue y descargue del proyecto, cada una con su peso base, tarifa, y la tabla de personas con sus toneladas y pago actual.",
      },
      {
        nombre: "Agregar apoyo con vista previa",
        descripcion:
          "Se selecciona el personal disponible del dia y el sistema muestra en vivo el antes y despues del pago de cada persona de la orden. Solo al confirmar se aplica el cambio.",
      },
      {
        nombre: "Quitar apoyo",
        descripcion:
          "Cada persona de la orden tiene un boton para retirarla del reparto, valido solo para quienes entraron como apoyo desde este modulo.",
      },
    ],
    consejos: [
      "Al agregar apoyo, el pago de los ya asignados baja porque el tonelaje se reparte entre mas personas: la vista previa lo muestra antes de confirmar.",
      "Para el personal de turno fijo que apoya, lo ganado por toneladas se le reconoce como bono ademas de su turno: no pierde su especialidad por apoyar.",
    ],
  },

  // ==========================================================================
  // VACACIONES
  // ==========================================================================
  {
    modulo: "Vacaciones",
    resumen: "Controla causacion, disfrute, saldo y liquidacion de vacaciones por trabajador.",
    proposito:
      "Lleva la cuenta de las vacaciones de cada trabajador activo: los dias que va causando (15 dias habiles por año trabajado), los que ya disfruto, los programados y el saldo con su valor en dinero. Desde aqui se crean y aprueban las solicitudes de disfrute y se registra la liquidacion en dinero del saldo cuando aplica.",
    puedes: [
      "Ver el saldo de cada trabajador: fecha de ingreso, antiguedad, dias causados, disfrutados, programados, saldo y su valor.",
      "Identificar con semaforo a quienes acumulan demasiados dias sin disfrutar.",
      "Crear una solicitud de vacaciones eligiendo colaborador y fechas; el sistema cuenta solo dias habiles (lunes a sabado, sin festivos).",
      "Aprobar una solicitud (los dias quedan registrados en el control diario de asistencia) o rechazarla con motivo.",
      "Registrar la liquidacion en dinero del saldo: dias por valor dia, con observaciones.",
      "Buscar por nombre o cedula y ver los totales del proyecto en tarjetas.",
    ],
    noPuedes: [
      "Cambiar la regla de causacion: son 15 dias habiles por año, calculados desde la fecha de ingreso.",
      "Editar los dias ya disfrutados a mano: salen del control diario de asistencia, donde quedan al aprobar la solicitud.",
      "Pagar desde el modulo: la liquidacion registrada deja constancia del valor; el pago sigue su flujo de nomina.",
    ],
    funcionalidades: [
      {
        nombre: "Saldos",
        descripcion:
          "Tabla por trabajador activo con causados, disfrutados, programados, saldo y valor del saldo. El color del saldo alerta la acumulacion alta y cada fila tiene botones para solicitar o liquidar.",
      },
      {
        nombre: "Solicitudes",
        descripcion:
          "Pestana con las solicitudes pendientes, aprobadas y rechazadas, con contador de pendientes. Al aprobar, los dias habiles quedan registrados como vacaciones en el control diario; al rechazar se puede dejar el motivo.",
      },
      {
        nombre: "Liquidacion en dinero",
        descripcion:
          "Para saldos a favor: se indican los dias y el valor dia (el sistema lo propone) y calcula el total en el momento antes de registrar.",
      },
    ],
    consejos: [
      "Atiende primero a las personas marcadas con acumulacion alta: el saldo de vacaciones acumulado es plata y riesgo laboral.",
      "El conteo de dias habiles excluye domingos y festivos automaticamente: revisa el numero que muestra el dialogo antes de crear la solicitud.",
    ],
  },
  // Guías agregadas 2026-09-30 (reorg de navegación: el buscador global usa este texto).
  {
    modulo: "Acumulados LIPgo",
    resumen: "Genera el reporte de acumulados de nómina con el formato de Siigo, desde la propia data de LIPgo.",
    proposito: "Desde septiembre de 2026 los acumulados salen de LIPgo, no de Siigo: este módulo construye el reporte con la data ya reconciliada, en las mismas columnas del export de Siigo, para que sea la única fuente hacia adelante.",
    puedes: [
      "Elegir periodo y planta y generar el reporte.",
      "Revisar por persona y concepto y exportar."
    ],
    noPuedes: [
      "Comparar contra Siigo: eso se hacía antes; ahora LIPgo es la fuente.",
      "Editar valores: salen de la nómina ya liquidada."
    ],
    funcionalidades: [
      {
        nombre: "Generación",
        descripcion: "Construye los acumulados por persona y concepto para el periodo elegido con los parámetros legales vigentes."
      },
      {
        nombre: "Exportación",
        descripcion: "Mismas columnas del export de Siigo, listo para entregar."
      }
    ]
  },
  {
    modulo: "Asistencia Administrativa",
    resumen: "Registrar o corregir asistencia y novedades de cualquier fecha, para operativos y administrativos.",
    proposito: "Tapa huecos de captura: si alguien no quedó registrado o hay que corregir una fecha pasada, aquí se registra o corrige la asistencia y la novedad para cualquier día, incluidos meses ya cerrados. También lleva la asistencia diaria del personal administrativo, que no marca turnos en portería. Alimenta directo la nómina, por eso tiene permiso propio.",
    puedes: [
      "Registrar asistencia, horario y novedad para una persona y una fecha cualquiera.",
      "Corregir registros existentes.",
      "Llevar la asistencia del personal administrativo."
    ],
    noPuedes: [
      "Programar turnos: eso es Programación de turnos.",
      "Verlo sin permiso propio: puede tocar meses cerrados de nómina."
    ],
    funcionalidades: [
      {
        nombre: "Registro por fecha",
        descripcion: "Persona, fecha, horario y novedad; se guarda en el mismo registro de asistencia que usa la nómina."
      },
      {
        nombre: "Corrección",
        descripcion: "Busca el registro existente y lo corrige; el cambio queda en la Bitácora de Auditoría."
      },
      {
        nombre: "Administrativos",
        descripcion: "Para el personal administrativo, 'Trabajado normal' se registra directo sin flujo de turnos."
      }
    ]
  },
]
