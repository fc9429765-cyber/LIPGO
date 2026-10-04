// Guias del modulo Aprendizaje — subgrupo "Materiales · MRP" de Producción (antes área "mrp").
// Generado por entregas; la clave `modulo` debe coincidir EXACTA con el menu.
import type { ContenidoAprendizaje } from "@/lib/aprendizaje-content"

export const APRENDIZAJE_MRP: ContenidoAprendizaje[] = [
  // ==========================================================================
  // CREACION DE MATERIALES
  // ==========================================================================
  {
    modulo: "Creación de materiales",
    resumen: "Catalogo de materias primas y empaques del proyecto.",
    proposito:
      "Aqui se crea y mantiene la lista maestra de materiales: cada materia prima y cada empaque queda registrado con su codigo, su proveedor, su tipo y su unidad de medida. Es el primer paso del grupo MRP: sin el material creado aqui, no se puede armar la lista de materiales de un producto en Explosion de materiales. Trabaja sobre el proyecto elegido en el selector global.",
    puedes: [
      "Crear un material nuevo con su codigo, nombre, proveedor, tipo y unidad de medida.",
      "Clasificar cada material como Materia Prima o como Empaque.",
      "Elegir la unidad de medida entre unidad, metro, kilogramo, tonelada o caja.",
      "Asignarle al material uno de los proveedores ya registrados en Gestion de proveedores.",
      "Editar los datos de un material existente o eliminarlo.",
      "Marcar un material como activo o inactivo; los inactivos dejan de aparecer al armar explosiones.",
      "Buscar en la lista y exportar el catalogo a Excel.",
    ],
    noPuedes: [
      "Ver o mover saldos de inventario. Aqui solo se define el catalogo, no las cantidades.",
      "Crear proveedores. Si el proveedor no existe, primero registralo en Gestion de proveedores.",
      "Crear productos terminados. Eso se hace en el modulo de Productos de Configuracion.",
    ],
    funcionalidades: [
      {
        nombre: "Registro de materiales",
        descripcion:
          "Formulario para dar de alta cada material con proyecto, codigo, nombre, proveedor, tipo (Materia Prima o Empaque) y unidad de medida. El codigo y el nombre son obligatorios.",
      },
      {
        nombre: "Listado con busqueda",
        descripcion:
          "Tabla con todos los materiales del proyecto seleccionado, con buscador para ubicar rapido un material.",
      },
      {
        nombre: "Edicion y eliminacion",
        descripcion:
          "Cada fila permite corregir los datos del material o eliminarlo si se registro por error.",
      },
      {
        nombre: "Exportar a Excel",
        descripcion: "Descarga el catalogo completo de materiales en un archivo de Excel.",
      },
    ],
    consejos: [
      "Define un codigo claro y consistente desde el inicio: ese codigo es el que se vera en las explosiones de materiales.",
      "Si un material se deja de usar, marcalo inactivo en lugar de eliminarlo, para conservar el historial.",
    ],
  },

  // ==========================================================================
  // INGRESOS MP (en desarrollo)
  // ==========================================================================
  {
    modulo: "Ingresos MP",
    resumen: "Registro de entradas de materia prima. Modulo en desarrollo.",
    proposito:
      "Esta pensado para registrar los ingresos de materia prima al proyecto. Todavia esta en construccion: al abrirlo se muestra un aviso de que el modulo esta en desarrollo y aun no tiene funcionalidades disponibles.",
    puedes: [
      "Abrir el modulo desde el grupo MRP del menu.",
      "Ver el aviso de que esta en desarrollo.",
      "Volver al menu con el boton de regreso.",
    ],
    noPuedes: [
      "Registrar ingresos de materia prima todavia. El modulo aun no esta habilitado.",
      "Consultar entradas anteriores. No hay informacion cargada en esta pantalla.",
    ],
    funcionalidades: [
      {
        nombre: "Aviso de modulo en desarrollo",
        descripcion: "Pantalla informativa que indica que el modulo estara disponible proximamente.",
      },
      {
        nombre: "Regreso al menu",
        descripcion: "Boton para volver al menu principal sin perder la navegacion.",
      },
    ],
  },

  // ==========================================================================
  // EXPLOSION DE MATERIALES
  // ==========================================================================
  {
    modulo: "Explosión de materiales",
    resumen: "Define que materiales y en que cantidad consume cada producto.",
    proposito:
      "Arma la lista de materiales de cada producto: por cada producto se indica que materias primas y empaques consume y en que cantidad. Es la receta que conecta el catalogo de materiales con el producto terminado. La explosion se guarda para el proyecto elegido en el selector global.",
    puedes: [
      "Seleccionar un producto y armar su explosion agregando materiales linea por linea.",
      "Indicar el consumo de cada material; la unidad, el codigo y el tipo se traen solos del catalogo.",
      "Agregar varias lineas de materiales antes de guardar la explosion completa.",
      "Ver la explosion actual del producto seleccionado y editar el consumo de cualquier linea.",
      "Eliminar una linea de la explosion, con confirmacion previa.",
      "Consultar todas las explosiones registradas, agrupadas por producto.",
    ],
    noPuedes: [
      "Cambiar el material de una linea ya guardada. Solo se edita el consumo; para cambiar el material, elimina la linea y agrega una nueva.",
      "Descontar inventario. La explosion define consumos teoricos, no mueve saldos.",
      "Agregar materiales que no existan en el catalogo. Primero crealos en Creacion de materiales.",
      "Guardar lineas sin material elegido o con consumo en cero; el sistema las rechaza.",
    ],
    funcionalidades: [
      {
        nombre: "Crear explosion por producto",
        descripcion:
          "Se elige el producto, se agregan lineas de materiales con su consumo y se guarda todo junto. Cada linea muestra el codigo y el tipo del material elegido y su unidad de medida.",
      },
      {
        nombre: "Explosion actual del producto",
        descripcion:
          "Al seleccionar un producto que ya tiene explosion, se muestra su tabla de materiales con codigo, tipo, consumo y unidad, lista para revisar.",
      },
      {
        nombre: "Editar consumo",
        descripcion:
          "Cada linea tiene un boton de edicion que abre una ventana para corregir solo la cantidad de consumo.",
      },
      {
        nombre: "Eliminar linea",
        descripcion: "Quita un material de la explosion del producto, pidiendo confirmacion antes de borrar.",
      },
      {
        nombre: "Vista general de explosiones",
        descripcion:
          "Al final de la pantalla se listan todas las explosiones registradas, agrupadas por producto, para revisar el panorama completo.",
      },
    ],
    consejos: [
      "Verifica el proyecto del selector global antes de guardar: la explosion queda amarrada al proyecto activo en ese momento.",
      "Guardar de nuevo una explosion agrega lineas, no reemplaza las anteriores; revisa la explosion actual para no duplicar materiales.",
    ],
  },

  // ==========================================================================
  // GESTION DE PROVEEDORES
  // ==========================================================================
  {
    modulo: "Gestión de proveedores",
    resumen: "Directorio de proveedores de materia prima y empaque.",
    proposito:
      "Mantiene el listado de proveedores que surten las materias primas y los empaques del proyecto. Cada proveedor creado aqui queda disponible para asignarlo a los materiales en Creacion de materiales. Trabaja sobre el proyecto elegido en el selector global.",
    puedes: [
      "Registrar un proveedor con su identificacion, nombre, pais y direccion.",
      "Guardar el correo de contacto del proveedor (opcional).",
      "Clasificar el proveedor como de Materia Prima o de Empaque.",
      "Editar los datos de un proveedor o eliminarlo.",
      "Marcar un proveedor como activo o inactivo.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Crear materiales desde aqui. Eso se hace en Creacion de materiales.",
      "Registrar compras, pagos o facturas del proveedor. Este modulo es solo el directorio.",
    ],
    funcionalidades: [
      {
        nombre: "Registro de proveedores",
        descripcion:
          "Formulario con proyecto, identificacion del proveedor, nombre, correo, pais, direccion y tipo. Identificacion, nombre, pais y direccion son obligatorios.",
      },
      {
        nombre: "Listado con busqueda",
        descripcion: "Tabla con los proveedores del proyecto seleccionado y buscador para ubicarlos rapido.",
      },
      {
        nombre: "Edicion y eliminacion",
        descripcion: "Permite corregir los datos de un proveedor o retirarlo del directorio.",
      },
      {
        nombre: "Exportar a Excel",
        descripcion: "Descarga el directorio de proveedores en un archivo de Excel.",
      },
    ],
    consejos: [
      "Registra el proveedor antes de crear sus materiales: el formulario de materiales solo ofrece proveedores ya existentes.",
    ],
  },

  // ==========================================================================
  // SALDOS DE EMPAQUE (en desarrollo)
  // ==========================================================================
  {
    modulo: "Saldos de empaque",
    resumen: "Consulta de saldos de empaques. Modulo en desarrollo.",
    proposito:
      "Esta pensado para consultar las existencias de material de empaque del proyecto. Todavia esta en construccion: al abrirlo se muestra un aviso de que el modulo esta en desarrollo y aun no tiene funcionalidades disponibles.",
    puedes: [
      "Abrir el modulo desde el grupo MRP del menu.",
      "Ver el aviso de que esta en desarrollo.",
      "Volver al menu con el boton de regreso.",
    ],
    noPuedes: [
      "Consultar saldos de empaque todavia. El modulo aun no esta habilitado.",
      "Registrar movimientos de empaque. No hay acciones disponibles en esta pantalla.",
    ],
    funcionalidades: [
      {
        nombre: "Aviso de modulo en desarrollo",
        descripcion: "Pantalla informativa que indica que el modulo estara disponible proximamente.",
      },
      {
        nombre: "Regreso al menu",
        descripcion: "Boton para volver al menu principal sin perder la navegacion.",
      },
    ],
  },

  // ==========================================================================
  // SALDOS DE MATERIA PRIMA (en desarrollo)
  // ==========================================================================
  {
    modulo: "Saldos de materia prima",
    resumen: "Consulta de saldos de materias primas. Modulo en desarrollo.",
    proposito:
      "Esta pensado para consultar las existencias de materia prima del proyecto. Todavia esta en construccion: al abrirlo se muestra un aviso de que el modulo esta en desarrollo y aun no tiene funcionalidades disponibles.",
    puedes: [
      "Abrir el modulo desde el grupo MRP del menu.",
      "Ver el aviso de que esta en desarrollo.",
      "Volver al menu con el boton de regreso.",
    ],
    noPuedes: [
      "Consultar saldos de materia prima todavia. El modulo aun no esta habilitado.",
      "Registrar movimientos de materia prima. No hay acciones disponibles en esta pantalla.",
    ],
    funcionalidades: [
      {
        nombre: "Aviso de modulo en desarrollo",
        descripcion: "Pantalla informativa que indica que el modulo estara disponible proximamente.",
      },
      {
        nombre: "Regreso al menu",
        descripcion: "Boton para volver al menu principal sin perder la navegacion.",
      },
    ],
  },
]
