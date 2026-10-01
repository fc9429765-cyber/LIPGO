// Guias del modulo Aprendizaje — area "certificaciones".
// Generado por entregas; la clave `modulo` debe coincidir EXACTA con el menu.
import type { ContenidoAprendizaje } from "@/lib/aprendizaje-content"

export const APRENDIZAJE_CERTIFICACIONES: ContenidoAprendizaje[] = [
  {
    modulo: "Dashboard SIG",
    resumen: "Tablero unico de auditoria: estado de las 3 normas ISO en una sola pantalla.",
    proposito:
      "Reune todo lo que un auditor suele pedir del Sistema Integrado de Gestion (ISO 9001, ISO 14001 e ISO 45001): avance por norma, avance por ciclo Planear-Hacer-Verificar-Actuar, brechas pendientes, referencia del SG-SST 0312, indicadores ambientales, objetivos y el listado maestro de documentos. Es el punto de entrada recomendado antes de una auditoria o revision gerencial. El SIG es uno solo para toda LIP: la informacion es la misma en todos los proyectos.",
    puedes: [
      "Ver el porcentaje de avance real de cada norma: sin evidencia no suma, documentado suma medio avance y verificado suma avance completo.",
      "Filtrar todo el tablero por una norma especifica o ver las tres juntas (solo aparecen las normas a las que tienes acceso).",
      "Revisar las brechas en dos listas: numerales que faltan por documentar y numerales documentados que faltan por verificar.",
      "Consultar el avance por ciclo de mejora continua (Planear, Hacer, Verificar, Actuar) en graficas comparativas por norma.",
      "Buscar en el listado maestro de documentos por codigo, nombre, proceso o numeral.",
      "Exportar todo el tablero a PDF para entregarlo al auditor o a la gerencia.",
    ],
    noPuedes: [
      "Cargar evidencias o cambiar estados desde aqui. Eso se hace en la Matriz Integrada SIG; este tablero es de consulta.",
      "Crear o editar documentos del listado maestro. Los documentos se alimentan desde la matriz y el repositorio.",
      "Ver normas para las que no tienes permiso: cada norma se muestra segun el acceso de tu usuario.",
    ],
    funcionalidades: [
      {
        nombre: "Tarjetas de avance por norma",
        descripcion:
          "Una tarjeta por norma con el avance real, cuanto esta verificado, cuanto documentado sin verificar y cuantos numerales aplican. Para la norma de seguridad y salud muestra ademas la referencia de los estandares minimos 0312 con su valoracion (aceptable, moderadamente aceptable o critico).",
      },
      {
        nombre: "Graficas comparativas",
        descripcion:
          "Dos graficas: documental vs verificado por norma, y avance por ciclo de mejora continua. Permiten ver de un vistazo donde esta debil el sistema.",
      },
      {
        nombre: "Que le falta a la norma",
        descripcion:
          "Listado de brechas en dos columnas: numerales sin evidencia (falta documentar) y numerales con documento cargado pero sin aprobar (falta verificar). Subir un documento no cierra el numeral por si solo.",
      },
      {
        nombre: "Indicadores ambientales y de objetivos",
        descripcion:
          "Tarjetas rapidas con los aspectos ambientales significativos, el porcentaje de cumplimiento legal ambiental, el estado de los objetivos del SIG y el total de documentos.",
      },
      {
        nombre: "Listado maestro de documentos",
        descripcion:
          "Tabla con todos los documentos del sistema: codigo, nombre, proceso, version, estado, normas que cubre y ultimo cambio registrado. Con buscador y filtro por norma.",
      },
      {
        nombre: "Exportar a PDF",
        descripcion:
          "Genera un informe completo con los avances, el ciclo de mejora, las brechas, los objetivos, la matriz legal ambiental y el listado maestro, listo para auditoria.",
      },
    ],
    consejos: [
      "Antes de una auditoria, revisa primero la seccion 'Que le falta a la norma': ahi esta el trabajo pendiente priorizado.",
      "El avance real premia verificar: si un numeral se queda en 'documentado', solo aporta la mitad del avance.",
    ],
  },
  {
    modulo: "Análisis de Contexto DOFA",
    resumen: "Matriz DOFA de la organizacion: fortalezas, debilidades, oportunidades y amenazas, con sus estrategias.",
    proposito:
      "Documenta la comprension de la organizacion y su contexto (numeral 4.1 de las normas ISO). Organiza los factores internos (fortalezas y debilidades) y externos (oportunidades y amenazas) en cuatro cuadrantes, y ademas registra las estrategias que salen de cruzarlos. Es la evidencia de que LIP entiende su entorno y actua en consecuencia.",
    puedes: [
      "Agregar, editar y eliminar factores en cualquiera de los cuatro cuadrantes: fortalezas, debilidades, oportunidades y amenazas.",
      "Registrar estrategias derivadas de los cruces: ofensivas (fortalezas + oportunidades), defensivas (fortalezas + amenazas), de reorientacion (debilidades + oportunidades) y de supervivencia (debilidades + amenazas).",
      "Agregar un item directamente desde el cuadrante donde va, con el boton de cada tarjeta.",
      "Cambiar un item de cuadrante al editarlo, si quedo mal clasificado.",
    ],
    noPuedes: [
      "Adjuntar archivos o soportes a los items. La matriz es de texto; los soportes documentales viven en la Matriz Integrada SIG.",
      "Recuperar un item eliminado: el borrado pide confirmacion pero es definitivo.",
    ],
    funcionalidades: [
      {
        nombre: "Cuatro cuadrantes DOFA",
        descripcion:
          "Tarjetas separadas para fortalezas y debilidades (factores internos) y oportunidades y amenazas (factores externos), cada una con su lista de items y edicion rapida al pasar el mouse.",
      },
      {
        nombre: "Cruces estrategicos",
        descripcion:
          "Seccion aparte con las estrategias accionables que salen de cruzar los factores (FO, FA, DO y DA), cada una con su propia lista.",
      },
      {
        nombre: "Formulario unico",
        descripcion:
          "Un solo formulario para crear o editar: eliges el cuadrante o el tipo de estrategia y escribes la descripcion.",
      },
    ],
    consejos: [
      "Manten los items cortos y accionables: al auditor le sirven mas diez factores claros que parrafos largos.",
      "Revisa la matriz cuando cambie algo grande del negocio: es evidencia de contexto vivo, no un documento de una sola vez.",
    ],
  },
  {
    modulo: "Matriz Integrada SIG",
    resumen: "La matriz madre del SIG: cada numeral ISO frente a las 3 normas, con su evidencia y estado.",
    proposito:
      "Es el corazon del Sistema Integrado de Gestion. Cruza cada requisito (numeral) con las tres normas ISO y controla su estado: pendiente, cargado, aprobado o no aplica. Aqui se sube la evidencia y se vincula el documento que cubre cada numeral; como muchas exigencias son comunes, un mismo documento puede servirle a las tres normas a la vez. La matriz esta organizada por el ciclo de mejora continua (Planear, Hacer, Verificar, Actuar).",
    puedes: [
      "Ver el avance real de cada norma en tarjetas: verificados, documentados sin verificar y numerales que aplican.",
      "Expandir cualquier numeral para ver la evidencia comun sugerida, el estado en cada norma y los documentos ya vinculados.",
      "Marcar el estado de un numeral por norma: pendiente, cargado o aprobado.",
      "Subir el soporte documental de un numeral, compartido por todas las normas de ese numeral.",
      "Vincular un documento del maestro del SIG a uno o varios numerales y normas a la vez (documento compartido), y quitar el vinculo si quedo mal.",
      "Trabajar en la pestaña de requisitos comunes: los numerales que comparten las 3 normas, donde un solo documento cubre todo.",
      "Ver la pestaña individual de cada norma (segun tu permiso), con la columna de como evidenciar cada requisito.",
    ],
    noPuedes: [
      "Cambiar a mano el estado de los numerales de calidad que llegan conectados desde el Centro de Evidencia ISO 9001: aqui se ven como referencia.",
      "Ver o editar pestañas de normas para las que no tienes permiso.",
      "Crear numerales nuevos: la estructura de requisitos ya viene definida por las normas.",
    ],
    funcionalidades: [
      {
        nombre: "Matriz numeral por 3 normas",
        descripcion:
          "Tabla completa con cada requisito, su tema, el estado en cada norma y si es comun, parcial o especifico. Las filas se agrupan por ciclo: Planear, Hacer, Verificar, Actuar.",
      },
      {
        nombre: "Detalle del numeral",
        descripcion:
          "Al expandir una fila ves la evidencia comun sugerida, el cargue de soporte, el vinculo de documentos y los botones de estado por norma.",
      },
      {
        nombre: "Documento compartido",
        descripcion:
          "Buscador de documentos del maestro para amarrar uno a varios numerales y normas de una sola vez: se sube una vez y aplica a ISO 9001, 14001 y 45001.",
      },
      {
        nombre: "Tablero de avance",
        descripcion:
          "Porcentaje de avance real por norma (documentado vale medio avance, verificado vale completo) y, para seguridad y salud, la referencia de los estandares minimos 0312 con su valoracion.",
      },
      {
        nombre: "Pestaña de requisitos comunes",
        descripcion:
          "Solo los numerales que comparten las normas, para avanzar rapido: ahi es donde un documento rinde triple.",
      },
    ],
    consejos: [
      "Empieza por los requisitos comunes: cada documento que subas ahi avanza las tres normas al tiempo.",
      "Marcar 'aprobado' es la verificacion: hazlo solo cuando la evidencia este revisada, porque es lo que completa el avance real.",
    ],
  },
  {
    modulo: "Repositorio por Norma SIG",
    resumen: "Los documentos del SIG organizados por norma, con los numerales que cubre cada uno.",
    proposito:
      "Vista documental del sistema: una pestaña por norma ISO con los documentos reales vinculados a ella desde la Matriz Integrada, mostrando que numerales cubre cada documento. Ademas lleva el control de cambios de cada documento (bitacora de versiones), que es un requisito de la norma sobre informacion documentada.",
    puedes: [
      "Navegar los documentos de cada norma en su propia pestaña, con el conteo de documentos por norma.",
      "Buscar por codigo, nombre, proceso o numeral.",
      "Abrir la ficha de un documento: proceso, version, estado, medio y los numerales que cubre en esa norma.",
      "Consultar y descargar el archivo del documento desde su ficha.",
      "Registrar un cambio de version en la bitacora: version nueva, tipo (creacion, modificacion o anulacion), motivo, descripcion y responsable.",
    ],
    noPuedes: [
      "Agregar documentos directamente aqui: los documentos aparecen cuando se vinculan a la norma desde la Matriz Integrada SIG.",
      "Editar o borrar registros de la bitacora de cambios: es un historial que se conserva.",
      "Ver pestañas de normas para las que no tienes permiso.",
    ],
    funcionalidades: [
      {
        nombre: "Pestañas por norma",
        descripcion:
          "ISO 9001, ISO 14001 e ISO 45001, cada una con la tabla de sus documentos: codigo, nombre, proceso y los numerales que cubre.",
      },
      {
        nombre: "Ficha del documento",
        descripcion:
          "Al hacer clic en una fila se abre la ficha con los datos del documento, los numerales cubiertos, el archivo para consulta y su control de cambios.",
      },
      {
        nombre: "Control de cambios",
        descripcion:
          "Bitacora de versiones del documento: cada cambio queda con version anterior y nueva, tipo, motivo, descripcion, responsable y fecha.",
      },
    ],
    consejos: [
      "Cada vez que actualices un documento del sistema, registra el cambio en la bitacora: es lo primero que revisa un auditor sobre control documental.",
    ],
  },
  {
    modulo: "Repositorio Universal",
    resumen: "Todos los documentos soporte de la empresa en un solo lugar, con filtros y descarga.",
    proposito:
      "Buscador central de documentos: reune en una sola tabla los soportes que se cargan en los distintos modulos de la aplicacion (hojas de vida, antecedentes, examenes medicos, contratos, expedientes de personal, investigaciones de accidentes, recobros de incapacidades, cierres de inventario y soportes de normas, entre otros). Sirve para encontrar y descargar cualquier soporte sin tener que recordar en que modulo se subio. Sigue el selector de empresa de la parte superior.",
    puedes: [
      "Buscar un documento por persona, titulo, submodulo o nombre de archivo.",
      "Filtrar por modulo de origen, norma, tipo de archivo y rango de fechas, combinando filtros.",
      "Ver o descargar cualquier documento de la lista con un clic.",
      "Ver de un vistazo cuantos documentos hay y como se reparten por modulo.",
      "Limpiar todos los filtros con un solo boton.",
    ],
    noPuedes: [
      "Subir o eliminar documentos desde aqui: cada soporte se carga y se administra en su modulo de origen.",
      "Editar los datos de un documento (titulo, fecha, norma): son un reflejo de lo registrado en el modulo donde nacio.",
    ],
    funcionalidades: [
      {
        nombre: "Tabla unificada",
        descripcion:
          "Una fila por documento con modulo, submodulo, norma, titulo, tipo, fecha y botones de ver y descargar. Muestra hasta 500 resultados; si hay mas, afina los filtros.",
      },
      {
        nombre: "Filtros combinables",
        descripcion:
          "Buscador de texto mas selectores de modulo, norma y tipo, y rango de fechas desde/hasta. Las opciones de los selectores salen de los documentos reales.",
      },
      {
        nombre: "Indicadores rapidos",
        descripcion:
          "Tarjetas con el total de documentos filtrados, la cantidad de modulos con soportes y el desglose de documentos por modulo.",
      },
    ],
    consejos: [
      "Si buscas el soporte de una persona, escribe su nombre en el buscador: la mayoria de documentos de gestion humana quedan titulados por persona.",
    ],
  },
  {
    modulo: "Objetivos y Metas SIG",
    resumen: "Los objetivos y metas del SIG para las 3 normas, con su indicador, valor actual y estado.",
    proposito:
      "Registra y hace seguimiento a los objetivos del sistema (numeral 6.2): que se quiere lograr, con que meta, con que indicador se mide, quien responde y como va (en curso, cumplido o atrasado). Cubre objetivos de calidad, ambiental, seguridad y salud, y objetivos integrados del SIG. El objetivo de digitalizacion muestra su valor real en vivo, calculado con los registros del sistema.",
    puedes: [
      "Crear, editar y eliminar objetivos, asignandolos a una norma o al SIG integrado.",
      "Definir para cada objetivo su meta, indicador, unidad, linea base, valor actual y responsable.",
      "Marcar el estado del objetivo: en curso, cumplido o atrasado.",
      "Filtrar la tabla por norma o ver todos los objetivos juntos.",
    ],
    noPuedes: [
      "Cambiar a mano el valor del objetivo de digitalizacion: ese se calcula en vivo con los registros reales del sistema.",
      "Adjuntar soportes a los objetivos: la evidencia documental vive en la Matriz Integrada SIG.",
    ],
    funcionalidades: [
      {
        nombre: "Tabla de objetivos",
        descripcion:
          "Cada objetivo con su norma (etiqueta de color), meta, indicador, valor actual, responsable y estado con semaforo.",
      },
      {
        nombre: "Filtro por norma",
        descripcion:
          "Botones para ver solo los objetivos de ISO 9001, ISO 14001, ISO 45001 o del SIG integrado.",
      },
      {
        nombre: "Indicador de digitalizacion en vivo",
        descripcion:
          "El objetivo de reduccion de papel muestra el conteo real de registros digitales del sistema, actualizado automaticamente.",
      },
    ],
    consejos: [
      "Estos objetivos alimentan el cuadro de mando: amarra cada indicador del tablero a su objetivo para que la trazabilidad quede completa.",
    ],
  },
  {
    modulo: "No Conformidades SIG",
    resumen: "Catalogo preventivo de posibles no conformes por proceso y registro de las no conformidades reales.",
    proposito:
      "Gestiona las no conformidades en dos frentes. Primero, el catalogo preventivo: los posibles no conformes anticipados por proceso y etapa, con su tipo (interno afecta a LIP, externo puede llegar al cliente), como se detectan y que accion tipica aplica; es el analisis basado en riesgos. Segundo, el registro real: las no conformidades que efectivamente ocurrieron, con correccion inmediata, causa raiz, accion correctiva, estado y verificacion de eficacia. El sistema es uno solo de LIP: las no conformidades se etiquetan por cliente o sitio.",
    puedes: [
      "Mantener el catalogo preventivo: crear, editar y eliminar posibles no conformes por proceso y etapa, con requisito ISO, forma de deteccion y accion tipica.",
      "Registrar una no conformidad real directamente desde un item del catalogo, que precarga los datos.",
      "Documentar el ciclo completo de cada no conformidad: correccion inmediata, analisis de causa raiz, accion correctiva, responsable y fecha compromiso.",
      "Llevar el estado (abierta, en proceso, cerrada, anulada) y la eficacia de la accion (pendiente, eficaz, no eficaz).",
      "Etiquetar cada no conformidad con el cliente o sitio donde ocurrio y marcar si afecta al cliente.",
      "Filtrar el registro por proceso y por cliente o sitio, y ver los contadores de abiertas, en proceso, cerradas y las que afectan cliente.",
    ],
    noPuedes: [
      "Adjuntar archivos a una no conformidad: el detalle es de texto; los soportes documentales van en los modulos de evidencia.",
      "Recuperar una no conformidad eliminada: si ya no aplica, es mejor marcarla como anulada que borrarla.",
    ],
    funcionalidades: [
      {
        nombre: "Catalogo preventivo por proceso",
        descripcion:
          "Tabla por proceso con las etapas y sus posibles no conformes: tipo interno o externo, si afecta al cliente, requisito ISO, como se detecta y la accion tipica. Desde cada item se puede disparar el registro de una no conformidad real.",
      },
      {
        nombre: "Registro de no conformidades",
        descripcion:
          "Tarjetas con semaforo por estado y todo el detalle: codigo, fecha, proceso, origen (proceso, auditoria, queja, inspeccion, autorreporte o revision por la direccion), cliente afectado y el ciclo de correccion y accion correctiva.",
      },
      {
        nombre: "Indicadores del registro",
        descripcion: "Contadores de total, abiertas, en proceso, cerradas y cuantas afectan al cliente.",
      },
      {
        nombre: "Cierre con eficacia",
        descripcion:
          "Al cerrar una no conformidad se registra la fecha de cierre y se evalua si la accion fue eficaz, que es lo que exige la norma para dar el ciclo por terminado.",
      },
    ],
    consejos: [
      "Registra las no conformidades desde el catalogo cuando exista el item: asi la descripcion y el requisito quedan consistentes.",
      "No cierres una no conformidad sin evaluar la eficacia: cerrada con eficacia pendiente sigue siendo un pendiente ante el auditor.",
    ],
  },
  {
    modulo: "Indicadores SIG",
    resumen: "El cuadro de mando integral (BSC) de LIP: objetivos, perspectivas e indicadores con eficacia en vivo.",
    proposito:
      "Es el tablero gerencial del sistema: conecta los objetivos de la empresa con los indicadores, organizados por las cuatro perspectivas del cuadro de mando integral (financiera, cliente, procesos internos, y aprendizaje y crecimiento) y tambien por area. Cada indicador tiene finalidad, formula, responsable, cliente interno y externo, meta y su eficacia (que tanto se acerca el resultado a la meta). Muchos indicadores se calculan en vivo con los datos reales de la operacion; los resultados se filtran por cliente o sitio con el selector global y por rango de fechas.",
    puedes: [
      "Ver la eficacia global del SIG, cuantos indicadores estan en meta, el estado de los objetivos estrategicos y cuantos indicadores se calculan en vivo.",
      "Navegar el tablero por area, por perspectiva del cuadro de mando o por objetivo estrategico, cada grupo con su eficacia promedio.",
      "Filtrar los valores por cliente o sitio (con el selector global de la aplicacion) y por periodo desde/hasta.",
      "Crear, editar y eliminar indicadores: codigo, nombre, formula, finalidad, perspectiva, area, proceso, objetivo al que aporta, meta, sentido (mayor o menor es mejor), frecuencia y responsable.",
      "Registrar el valor manual de los indicadores que no se calculan solos.",
      "Distinguir con el simbolo de rayo los indicadores en vivo: su valor sale de la operacion real y no se digita.",
    ],
    noPuedes: [
      "Digitar el valor de un indicador automatico: se calcula en vivo desde la operacion y no acepta captura manual.",
      "Cambiar la formula interna de los calculos automaticos: si un indicador en vivo no refleja lo esperado, reportalo en vez de crear uno paralelo.",
      "Evaluar personas desde aqui: la nota por area y por coordinador vive en el modulo de Evaluacion por Area.",
    ],
    funcionalidades: [
      {
        nombre: "Tarjetas de resumen",
        descripcion:
          "Eficacia global (promedio de eficacia contra meta), indicadores en meta, objetivos estrategicos cumplidos e indicadores calculados en vivo.",
      },
      {
        nombre: "Vista por area",
        descripcion:
          "Los indicadores agrupados por area de la empresa (direccion, cargue y descargue, almacenamiento, gestion humana, seguridad y salud, compras, mejora y tecnologia), con la eficacia promedio de cada area.",
      },
      {
        nombre: "Vista por perspectiva",
        descripcion:
          "Las cuatro perspectivas del cuadro de mando integral, cada una con sus indicadores y su eficacia promedio: financiera, cliente, procesos internos y aprendizaje.",
      },
      {
        nombre: "Vista por objetivo estrategico",
        descripcion:
          "Cada objetivo de la empresa con los indicadores que contribuyen a lograrlo y la eficacia promedio del grupo: la cascada objetivo, indicador, resultado.",
      },
      {
        nombre: "Catalogo de indicadores",
        descripcion:
          "Separado en gerenciales (estrategicos) y de resultado por proceso o area, con todo el detalle de cada uno y su edicion.",
      },
      {
        nombre: "Semaforo de eficacia",
        descripcion:
          "Cada indicador muestra su resultado contra la meta segun su sentido: verde en meta, amarillo cerca, rojo lejos. Los que no tienen meta quedan como informativos.",
      },
    ],
    consejos: [
      "Si el tablero se ve raro, revisa primero el selector global y el rango de fechas: cambian todos los valores en vivo.",
      "Al crear un indicador, amarralo siempre a un objetivo estrategico y a un area: sin eso no aparece completo en las cascadas.",
    ],
  },
  {
    modulo: "Evaluación por Área",
    resumen: "Nota de desempeño de cada area de LIP: los indicadores ponderados evaluan a la cabeza de area.",
    proposito:
      "Despliega el cuadro de mando a la evaluacion de desempeño: cada indicador pesa dentro de su area (los pesos deben sumar 100) y la nota del area es la suma del cumplimiento de cada indicador por su peso. Esa nota evalua a la cabeza del area. La evaluacion es global de LIP, no por proyecto, porque el sistema de gestion es uno solo; ademas incluye el despliegue en cascada hacia los coordinadores de operaciones, cuya nota si se calcula con los datos de su propio proyecto.",
    puedes: [
      "Ver la nota de cada area con semaforo, su responsable y el detalle de cada indicador: valor, meta, cumplimiento y peso.",
      "Ajustar los pesos de los indicadores de un area; el sistema valida que sumen 100 antes de guardar.",
      "Ver el desempeño global de LIP (promedio de las areas) y cuantas areas estan evaluadas.",
      "Consultar la nota de cada coordinador de operaciones por proyecto, calculada con los mismos indicadores pero con los datos de su sitio.",
    ],
    noPuedes: [
      "Cambiar los valores de los indicadores desde aqui: los valores llegan en vivo del cuadro de mando; aqui solo se ajustan los pesos.",
      "Evaluar las areas por proyecto: la nota de area es global de LIP a proposito; el unico desglose por proyecto es el de coordinadores.",
      "Guardar pesos que no sumen 100 en el area: el sistema lo bloquea.",
    ],
    funcionalidades: [
      {
        nombre: "Tarjeta por area",
        descripcion:
          "Cada area con su responsable, su nota con semaforo y la tabla de indicadores: valor actual, meta, porcentaje de cumplimiento y peso dentro del area.",
      },
      {
        nombre: "Edicion de pesos",
        descripcion:
          "Modo de edicion por area para repartir los 100 puntos entre los indicadores; muestra la suma en vivo y no deja guardar si no cuadra. Si un area aun no tiene pesos, se reparte en partes iguales entre los indicadores medibles.",
      },
      {
        nombre: "Cascada de coordinadores",
        descripcion:
          "Tabla de desempeño por proyecto: cada coordinador con su nota y el cumplimiento de sus indicadores de gestion, calculados con los datos de su propio sitio. La gerencia responde por el resultado global.",
      },
    ],
    consejos: [
      "Define los pesos con la cabeza de area antes del periodo a evaluar: cambiarlos a mitad de camino cambia la nota.",
      "Un indicador con peso cero no afecta la nota: sirve para indicadores informativos que aun no deben calificar.",
    ],
  },
  {
    modulo: "Mapa de Interacción del Proceso",
    resumen: "El paso a paso del proceso en el sistema: quien hace cada paso (LIP o cliente) y que evidencia queda.",
    proposito:
      "Documenta para el auditor como interactuan LIP y el cliente dentro del proceso que corre en el sistema: fase por fase, quien ejecuta cada paso, que accion se hace en la aplicacion, que soporte o registro queda como evidencia y bajo que requisito ISO. Los pasos que ejecuta el cliente dentro de la plataforma son valor agregado que LIP brinda para control y trazabilidad, no parte del alcance del servicio, y el mapa lo deja explicito.",
    puedes: [
      "Ver el proceso completo agrupado por fases, con cada paso numerado en orden.",
      "Identificar el responsable de cada paso: LIP (servicio), cliente (valor agregado) o ambos.",
      "Consultar para cada paso la accion en la aplicacion, la evidencia o soporte que queda, el campo o dato donde se registra y el requisito ISO que cubre.",
      "Crear, editar y eliminar pasos del mapa, con su fase, orden, responsable y evidencia.",
      "Ver el resumen de cuantos pasos son de servicio LIP y cuantos son valor agregado del cliente.",
    ],
    noPuedes: [
      "Adjuntar los soportes reales a cada paso: el mapa describe donde queda la evidencia, no la almacena.",
      "Recuperar un paso eliminado: el borrado pide confirmacion pero es definitivo.",
    ],
    funcionalidades: [
      {
        nombre: "Tabla por fases",
        descripcion:
          "Cada fase del proceso con sus pasos en orden: paso, responsable con etiqueta de color, accion en la aplicacion, evidencia y requisito ISO.",
      },
      {
        nombre: "Leyenda de responsables",
        descripcion:
          "Resumen visible de pasos de servicio LIP frente a pasos del cliente, con la aclaracion de que los del cliente son herramienta de valor agregado.",
      },
      {
        nombre: "Edicion de pasos",
        descripcion:
          "Formulario para crear o ajustar un paso: fase, orden, responsable, modulo de la aplicacion, accion, evidencia, campo de registro y requisito ISO. Al marcar responsable cliente se marca solo como valor agregado.",
      },
    ],
    consejos: [
      "Usa este mapa en la auditoria para mostrar trazabilidad: cada paso dice exactamente donde queda el registro.",
    ],
  },
  {
    modulo: "Centro de Evidencia ISO 9001",
    resumen: "Las clausulas de calidad con su estado de cumplimiento probado con datos reales del sistema.",
    proposito:
      "Controla el cumplimiento de la norma de calidad clausula por clausula. Cada requisito muestra su prueba o fuente en la operacion real, un estado calculado automaticamente con esos datos (cumple, parcial, documental o pendiente) que se puede ajustar a mano, un archivo de evidencia adjunto y el codigo del documento del SIG que lo respalda. Lo que se marca aqui alimenta el estado de la norma de calidad en la Matriz Integrada SIG.",
    puedes: [
      "Ver la cobertura general de requisitos y el conteo por estado: cumple, parcial, documental y pendiente.",
      "Recorrer las clausulas agrupadas por capitulo de la norma, con su requisito, descripcion y prueba o fuente.",
      "Subir o reemplazar el archivo de evidencia de cada clausula (documentos, hojas de calculo o imagenes).",
      "Cambiar el estado de una clausula a mano o devolverla al estado automatico calculado con datos reales.",
      "Editar una clausula: el texto del requisito, la prueba o fuente y el codigo del documento del SIG asociado.",
      "Actualizar el tablero para recalcular los estados con los datos mas recientes.",
    ],
    noPuedes: [
      "Eliminar clausulas ni agregar clausulas nuevas: la estructura viene de la norma.",
      "Borrar una evidencia ya subida: solo se puede reemplazar subiendo un archivo nuevo.",
    ],
    funcionalidades: [
      {
        nombre: "Barra de cobertura",
        descripcion:
          "Porcentaje de requisitos con evidencia activa (los que cumplen mas los documentales) sobre el total, con el desglose por estado.",
      },
      {
        nombre: "Tabla por capitulo",
        descripcion:
          "Una tarjeta por capitulo de la norma con sus clausulas: numero, requisito, prueba o fuente, estado, evidencia adjunta y documento del SIG.",
      },
      {
        nombre: "Estado automatico con ajuste manual",
        descripcion:
          "El estado base se calcula con datos reales de la operacion; si lo cambias a mano queda marcado como manual y puedes volver al automatico cuando quieras.",
      },
      {
        nombre: "Evidencia por clausula",
        descripcion:
          "Cada clausula acepta un archivo adjunto como evidencia, con enlace para abrirlo; los archivos quedan tambien visibles en el Repositorio ISO 9001.",
      },
    ],
    consejos: [
      "Prefiere el estado automatico: se defiende solo ante el auditor porque sale de datos reales. Usa el manual solo cuando la evidencia no este en el sistema.",
    ],
  },
  {
    modulo: "Repositorio ISO 9001",
    resumen: "Consulta y descarga de los archivos de evidencia adjuntos a las clausulas de calidad.",
    proposito:
      "Vista documental del Centro de Evidencia ISO 9001: lista las clausulas de la norma de calidad con su archivo de evidencia adjunto, para encontrar y descargar cualquier soporte sin recorrer el tablero completo. Util para armar el paquete documental de una auditoria.",
    puedes: [
      "Ver todas las clausulas con evidencia adjunta, con su archivo, fecha de cargue y documento del SIG asociado.",
      "Buscar por numero de clausula, requisito, nombre de archivo o codigo de documento.",
      "Filtrar por capitulo de la norma y alternar entre clausulas con evidencia, sin evidencia o todas.",
      "Abrir o descargar cualquier archivo de evidencia con un clic.",
      "Actualizar la lista para traer las evidencias mas recientes.",
    ],
    noPuedes: [
      "Subir, reemplazar o eliminar evidencias: eso se hace en el Centro de Evidencia ISO 9001.",
      "Cambiar el estado de una clausula: este modulo es solo de consulta.",
    ],
    funcionalidades: [
      {
        nombre: "Tabla de evidencias",
        descripcion:
          "Clausula, requisito, capitulo, documento del SIG, nombre del archivo, fecha y boton de descarga.",
      },
      {
        nombre: "Filtros y contadores",
        descripcion:
          "Buscador de texto, filtro por capitulo y filtro por evidencia (con, sin o todas), con tarjetas de clausulas con evidencia, totales y capitulos.",
      },
      {
        nombre: "Vista de faltantes",
        descripcion:
          "El filtro 'sin evidencia' muestra que clausulas siguen sin archivo adjunto: la lista de trabajo pendiente documental.",
      },
    ],
  },
  {
    modulo: "Aspectos e Impactos ISO 14001",
    resumen: "La matriz ambiental: aspectos e impactos por actividad, con su significancia y control.",
    proposito:
      "Identifica y valora los aspectos ambientales de la operacion (que actividad genera que aspecto y que impacto), como pide la norma ambiental. Cada aspecto se valora por frecuencia, severidad y alcance, se clasifica como significativo o no significativo, y se le define control y responsable. Los significativos son lo primero que revisa el auditor. Incluye ademas el indicador de digitalizacion en vivo: cuanto papel evita LIP al operar en el sistema.",
    puedes: [
      "Registrar, editar y eliminar aspectos ambientales: actividad, aspecto, impacto, tipo de recurso (energia, agua, residuos, peligrosos, aire, suelo o papel) y condicion (normal, anormal o emergencia).",
      "Valorar cada aspecto con frecuencia, severidad y alcance en escala de 1 a 5, y clasificarlo como significativo o no.",
      "Marcar si el aspecto cumple su requisito legal y definir su control o medida y su responsable.",
      "Ver los contadores de aspectos identificados, significativos y no significativos.",
      "Consultar el indicador de digitalizacion en vivo: registros digitales, resmas ahorradas y kilos de papel evitados, con desglose por tipo de registro.",
    ],
    noPuedes: [
      "Cambiar los valores del indicador de digitalizacion: se calcula solo con los registros reales del sistema.",
      "Adjuntar soportes a un aspecto: la evidencia documental ambiental vive en la Matriz Integrada SIG.",
    ],
    funcionalidades: [
      {
        nombre: "Matriz de aspectos",
        descripcion:
          "Tabla con actividad, aspecto, impacto, recurso, condicion, significancia con alerta visual, control y responsable. Los significativos se resaltan para verlos primero.",
      },
      {
        nombre: "Valoracion 1 a 5",
        descripcion:
          "Frecuencia, severidad y alcance en escala de 1 a 5 mas la marca de cumplimiento legal, que sustentan la clasificacion de significancia.",
      },
      {
        nombre: "Objetivo ambiental de digitalizacion",
        descripcion:
          "Tarjeta en vivo con los registros digitales del sistema traducidos a resmas y kilos de papel evitados: el control del aspecto consumo de papel y un diferenciador de LIP.",
      },
    ],
    consejos: [
      "Concentra los controles en los aspectos significativos: son los que el auditor pide primero y los que mueven el sistema ambiental.",
    ],
  },
  {
    modulo: "Matriz Legal Ambiental",
    resumen: "La normatividad ambiental aplicable a LIP y la evaluacion de su cumplimiento.",
    proposito:
      "Registra los requisitos legales ambientales que aplican a la operacion (leyes, decretos, resoluciones y otros), que exige cada uno, como lo cumple LIP y en que estado esta: cumple, parcial, no cumple o no aplica. Calcula el porcentaje de cumplimiento legal ambiental, que tambien se refleja en el Dashboard SIG. Es la evidencia del requisito legal de la norma ambiental.",
    puedes: [
      "Registrar, editar y eliminar normas legales: tipo (ley, decreto, resolucion u otro), identificacion, titulo y el requisito que exige.",
      "Documentar como cumple LIP cada requisito (evidencia o control) y quien es el responsable.",
      "Evaluar el cumplimiento de cada norma: cumple, parcial, no cumple o no aplica.",
      "Ver el porcentaje de cumplimiento legal, las normas aplicables y el total registrado.",
    ],
    noPuedes: [
      "Adjuntar el texto de la norma o soportes de cumplimiento: la matriz es de registro y evaluacion; los archivos van en los repositorios documentales.",
      "Recuperar una norma eliminada: el borrado pide confirmacion pero es definitivo.",
    ],
    funcionalidades: [
      {
        nombre: "Tabla de normatividad",
        descripcion:
          "Cada norma con su identificacion y tipo, titulo, requisito, como se cumple, estado de cumplimiento con semaforo y responsable.",
      },
      {
        nombre: "Porcentaje de cumplimiento",
        descripcion:
          "Se calcula sobre las normas que aplican: cumplir vale completo, parcial vale la mitad y no cumplir no suma; las marcadas como no aplica quedan por fuera del calculo.",
      },
      {
        nombre: "Indicadores rapidos",
        descripcion:
          "Tarjetas con el porcentaje de cumplimiento legal, las normas aplicables y el total de normas registradas.",
      },
    ],
    consejos: [
      "Cuando una norma cambie o salga una nueva, actualiza la matriz de una vez: el porcentaje de cumplimiento es de los primeros datos que mira el auditor ambiental.",
    ],
  },
  // Guías agregadas 2026-09-30 (reorg de navegación: el buscador global usa este texto).
  {
    modulo: "Mapa de Procesos",
    resumen: "Mapa de procesos del SIG, clicable: cada proceso abre sus formatos, información documentada y registros.",
    proposito: "Muestra los procesos estratégicos, misionales y de apoyo con la entrada de requerimientos y la salida de satisfacción. Cada proceso abre un panel con sus documentos, que van al mismo maestro del Listado Maestro del Dashboard SIG: lo que se carga aquí también sale allá.",
    puedes: [
      "Ver el mapa completo y cuántos documentos tiene cada proceso.",
      "Abrir un proceso y cargar o descargar sus formatos, información documentada y registros con código, versión y archivo."
    ],
    noPuedes: [
      "Cambiar la estructura del mapa: es la definida por la organización.",
      "Cargar documentos sin código y versión."
    ],
    funcionalidades: [
      {
        nombre: "Mapa",
        descripcion: "Las tres bandas del mapa (estratégicos, misionales, apoyo) con entrada y salida, cada proceso como botón con su conteo de documentos."
      },
      {
        nombre: "Panel de documentos",
        descripcion: "Tres listas por proceso: formatos, información documentada y registros, con carga de archivo y versión."
      },
      {
        nombre: "Conteo por proceso",
        descripcion: "Cuántos documentos tiene cada proceso, visible desde el mapa."
      }
    ]
  },
]
