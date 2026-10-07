// Guias del modulo Aprendizaje — area "configuracion".
// Generado por entregas; la clave `modulo` debe coincidir EXACTA con el menu.
import type { ContenidoAprendizaje } from "@/lib/aprendizaje-content"

export const APRENDIZAJE_CONFIGURACION: ContenidoAprendizaje[] = [
  // ==========================================================================
  // CLIENTES
  // ==========================================================================
  {
    modulo: "Clientes",
    resumen: "Catalogo maestro de clientes: datos de contacto y datos fiscales para pedidos y facturacion.",
    proposito:
      "Aqui se crean y mantienen los clientes que usan los demas modulos: pedidos, ordenes de cargue y facturacion parten de este listado. Cada cliente nuevo queda registrado en la empresa que este seleccionada en el selector global, asi que conviene revisarlo antes de crear.",
    puedes: [
      "Crear un cliente con su documento, nombre, correos (incluido el de facturacion electronica), persona de contacto y celular.",
      "Clasificarlo como Persona o Empresa y registrar su regimen de IVA y responsabilidad fiscal.",
      "Editar cualquier dato de un cliente existente.",
      "Desactivar un cliente con la casilla Activo para que deje de ofrecerse, sin borrar su historial.",
      "Eliminar un cliente, con confirmacion previa.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Ver o crear clientes de otra empresa distinta a la del selector global: el listado siempre filtra por la empresa seleccionada.",
      "Gestionar aqui las sedes de entrega del cliente: eso se hace en el modulo Sucursales.",
    ],
    funcionalidades: [
      {
        nombre: "Formulario de cliente",
        descripcion:
          "Captura documento, nombre (obligatorio), correo general y correo de facturacion electronica, persona de contacto, celular, tipo de cliente, regimen de IVA y responsabilidad fiscal.",
      },
      {
        nombre: "Listado con busqueda y exportacion",
        descripcion:
          "Tabla con todos los clientes de la empresa seleccionada, buscador y boton Exportar Excel que descarga el listado del dia.",
      },
      {
        nombre: "Activar / desactivar",
        descripcion:
          "La casilla Activo saca al cliente de la operacion diaria sin perder su informacion ni sus pedidos historicos.",
      },
    ],
    consejos: [
      "Verifica la empresa del selector global antes de crear: el cliente queda amarrado a ella.",
      "El correo de facturacion electronica es el que se usa para enviar facturas; no lo confundas con el correo general.",
    ],
  },

  // ==========================================================================
  // SUCURSALES
  // ==========================================================================
  {
    modulo: "Sucursales",
    resumen: "Sedes o puntos de entrega de cada cliente, con direccion, departamento y ciudad.",
    proposito:
      "Cada cliente puede tener varias sedes donde recibe mercancia. Este catalogo las registra y las deja disponibles para pedidos y despachos. Toda sucursal debe quedar amarrada a un cliente existente.",
    puedes: [
      "Crear una sucursal escogiendo primero el cliente al que pertenece.",
      "Registrar el nombre de la sucursal, su direccion, departamento y ciudad (la lista de ciudades depende del departamento escogido).",
      "Editar los datos de una sucursal existente.",
      "Desactivar una sucursal con la casilla Activo sin borrarla.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Crear una sucursal sin cliente: el campo es obligatorio.",
      "Crear aqui al cliente: primero debe existir en el modulo Clientes.",
    ],
    funcionalidades: [
      {
        nombre: "Amarre al cliente",
        descripcion:
          "Cada sucursal se crea escogiendo su cliente de una lista; en la tabla se ve el nombre del cliente junto a cada sede.",
      },
      {
        nombre: "Departamento y ciudad encadenados",
        descripcion:
          "Al escoger el departamento, el campo ciudad solo ofrece las ciudades de ese departamento, lo que evita direcciones inconsistentes.",
      },
    ],
  },

  // ==========================================================================
  // PRODUCTOS
  // ==========================================================================
  {
    modulo: "Productos",
    resumen: "Catalogo maestro de productos: pesos, unidades por estiba, categoria y vida util.",
    proposito:
      "Define cada producto que se mueve en la operacion. Sus pesos y equivalencias alimentan los calculos de inventario, bascula, ordenes y liquidaciones, asi que un dato mal registrado aqui se propaga a todo el sistema. El codigo del producto se genera automaticamente al crearlo.",
    puedes: [
      "Crear un producto con nombre, gramaje, peso neto, peso bruto y unidades por estiba (todos obligatorios).",
      "Registrar unidades, unidad equivalente y equivalencia en bultos para las conversiones de la operacion.",
      "Clasificarlo con su categoria y subcategoria, y definir su vida util en dias.",
      "Abrir la gestion de Categorias desde el boton del propio modulo, sin salir de Productos.",
      "Editar, desactivar (casilla Activo) o eliminar un producto con confirmacion.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Escribir el codigo del producto a mano: se genera solo al guardar.",
      "Crear el producto sin categoria y subcategoria: son obligatorias.",
      "Ver productos de otra empresa distinta a la del selector global.",
    ],
    funcionalidades: [
      {
        nombre: "Ficha del producto",
        descripcion:
          "Reune gramaje, peso neto, peso bruto, unidades, equivalencias y unidades por estiba: son la base de los calculos de toneladas, estibas y capacidad en el resto de la aplicacion.",
      },
      {
        nombre: "Boton Gestionar Categorias",
        descripcion:
          "Abre una ventana con el catalogo de categorias para crear o ajustar una sin abandonar el modulo; al cerrarla, el formulario del producto ya la ofrece.",
      },
      {
        nombre: "Vida util en dias",
        descripcion: "Dato que permite controlar vencimientos del producto en los modulos de inventario.",
      },
    ],
    consejos: [
      "Revisa dos veces peso neto, peso bruto y unidades por estiba: de ellos dependen bascula, inventario y liquidaciones.",
    ],
  },

  // ==========================================================================
  // CATEGORIAS
  // ==========================================================================
  {
    modulo: "Categorías",
    resumen: "Familias de productos para clasificar el catalogo y agrupar reportes.",
    proposito:
      "Define las familias grandes en que se agrupan los productos (cada producto exige una). Es un catalogo sencillo: nombre y estado. Tambien se puede gestionar desde el boton Gestionar Categorias del modulo Productos.",
    puedes: [
      "Crear una categoria nueva con su nombre.",
      "Editar el nombre de una categoria existente.",
      "Desactivar una categoria con la casilla Activo para que no se ofrezca en productos nuevos.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Eliminar una categoria: solo se puede desactivar, para no romper los productos que ya la usan.",
      "Asignar productos desde aqui: la categoria se escoge en la ficha de cada producto.",
    ],
    funcionalidades: [
      {
        nombre: "Catalogo simple",
        descripcion: "Tabla de nombre y estado con creacion y edicion directas.",
      },
      {
        nombre: "Desactivar en lugar de borrar",
        descripcion:
          "Una categoria desactivada deja de ofrecerse en formularios nuevos, pero los productos historicos conservan su clasificacion.",
      },
    ],
  },

  // ==========================================================================
  // SUB CATEGORIAS
  // ==========================================================================
  {
    modulo: "Sub Categorías",
    resumen: "Subdivision de cada categoria para clasificar los productos con mas detalle.",
    proposito:
      "Cada subcategoria pertenece a una categoria y afina la clasificacion del catalogo de productos (cada producto exige categoria y subcategoria).",
    puedes: [
      "Crear una subcategoria escogiendo la categoria a la que pertenece.",
      "Editar el nombre o cambiar la categoria de una subcategoria.",
      "Desactivar una subcategoria con la casilla Activo.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Eliminar una subcategoria: solo se puede desactivar.",
      "Crear una subcategoria sin categoria padre: el campo es obligatorio.",
    ],
    funcionalidades: [
      {
        nombre: "Amarre a la categoria",
        descripcion:
          "Cada subcategoria se crea bajo una categoria y la tabla muestra ambas, ordenadas por categoria.",
      },
      {
        nombre: "Estado activo",
        descripcion: "Permite retirar subcategorias en desuso sin afectar los productos ya clasificados.",
      },
    ],
  },

  // ==========================================================================
  // BODEGAS
  // ==========================================================================
  {
    modulo: "Bodegas",
    resumen: "Catalogo de bodegas de la empresa donde vive el inventario.",
    proposito:
      "Registra las bodegas fisicas de la empresa seleccionada. Son la base de las localizaciones y de todos los movimientos de inventario: cada localizacion pertenece a una bodega de esta lista.",
    puedes: [
      "Crear una bodega con su nombre y una descripcion.",
      "Editar los datos de una bodega existente.",
      "Eliminar una bodega, con confirmacion previa.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Ver bodegas de otra empresa distinta a la del selector global.",
      "Definir aqui las posiciones internas: eso se hace en Localizaciones.",
    ],
    funcionalidades: [
      {
        nombre: "Catalogo por empresa",
        descripcion:
          "Cada bodega queda amarrada automaticamente a la empresa del selector global; los modulos de inventario y despacho trabajan contra estas bodegas.",
      },
      {
        nombre: "Base de las localizaciones",
        descripcion: "Al crear una localizacion se escoge una bodega de esta lista como su ubicacion madre.",
      },
    ],
  },

  // ==========================================================================
  // LOCALIZACIONES
  // ==========================================================================
  {
    modulo: "Localizaciones",
    resumen: "Posiciones internas de cada bodega, con codigo y capacidad, para ubicar el inventario.",
    proposito:
      "Divide cada bodega en posiciones identificadas por un codigo. El inventario se guarda y se consulta por estas posiciones, y su capacidad permite controlar cuanto cabe en cada una.",
    puedes: [
      "Crear una localizacion con su codigo y nombre (obligatorios), descripcion y capacidad.",
      "Amarrarla a una bodega existente (campo obligatorio).",
      "Editar o eliminar una localizacion, con confirmacion al eliminar.",
      "Desactivar una localizacion con la casilla Activo.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Crear una localizacion sin bodega: primero debe existir la bodega.",
      "Mover inventario desde aqui: los traslados se hacen en los modulos de inventario.",
    ],
    funcionalidades: [
      {
        nombre: "Codigo y capacidad",
        descripcion:
          "El codigo identifica la posicion en toda la operacion (ingresos, traslados, conteos) y la capacidad sirve para controlar la ocupacion de la bodega.",
      },
      {
        nombre: "Amarre a la bodega",
        descripcion: "Cada posicion pertenece a una bodega del catalogo; la tabla muestra a cual.",
      },
    ],
  },

  // ==========================================================================
  // TIPOS DESPACHO
  // ==========================================================================
  {
    modulo: "Tipos Despacho",
    resumen: "Catalogo de tipos de despacho o recepcion que se asignan a las citas de vehiculos.",
    proposito:
      "Define las modalidades de despacho/recepcion que se ofrecen al registrar un vehiculo (por ejemplo al agendar su cita). Es un catalogo simple de nombre y estado.",
    puedes: [
      "Crear un tipo de despacho nuevo con su nombre.",
      "Editar el nombre de un tipo existente.",
      "Desactivar un tipo con la casilla Activo para que deje de ofrecerse.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Asignar el tipo a un vehiculo desde aqui: eso se hace al registrar o editar el vehiculo.",
      "Borrar el historial: los registros antiguos conservan el tipo con que se crearon.",
    ],
    funcionalidades: [
      {
        nombre: "Catalogo simple",
        descripcion: "Tabla de nombre y estado, con creacion, edicion y exportacion a Excel.",
      },
      {
        nombre: "Estado activo",
        descripcion: "Los tipos desactivados dejan de aparecer en los formularios de vehiculos.",
      },
    ],
  },

  // ==========================================================================
  // TRANSPORTADORAS
  // ==========================================================================
  {
    modulo: "Transportadoras",
    resumen: "Catalogo de empresas transportadoras disponibles para vehiculos y ordenes de cargue.",
    proposito:
      "Mantiene la lista de transportadoras que se ofrecen al registrar vehiculos y al generar ordenes de cargue. Solo las transportadoras activas se ofrecen en esos formularios.",
    puedes: [
      "Crear una transportadora con su nombre.",
      "Editar el nombre de una transportadora existente.",
      "Desactivar una transportadora con la casilla Activo para sacarla de los formularios.",
      "Eliminar una transportadora, con confirmacion previa.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Asignar la transportadora a una orden desde aqui: eso ocurre en los modulos de despacho.",
      "Cambiar el historial: las ordenes antiguas conservan la transportadora con que se generaron.",
    ],
    funcionalidades: [
      {
        nombre: "Catalogo de transportadoras",
        descripcion: "Tabla simple de nombre y estado con las acciones de crear, editar y eliminar.",
      },
      {
        nombre: "Solo vigentes en la operacion",
        descripcion:
          "Los modulos de despacho ofrecen unicamente las transportadoras activas; si una cita trae una que ya no se usa, obligan a escoger una valida.",
      },
    ],
  },

  // ==========================================================================
  // TIPOS DE VEHICULOS
  // ==========================================================================
  {
    modulo: "Tipos de Vehiculos",
    resumen: "Catalogo de tipos de vehiculo con su capacidad de carga.",
    proposito:
      "Define los tipos de vehiculo (y su capacidad) que se ofrecen al registrar un vehiculo. La capacidad del tipo es la que despues usa la operacion para medir cuanto se puede cargar en cada orden.",
    puedes: [
      "Crear un tipo de vehiculo con su nombre y su capacidad (ambos obligatorios).",
      "Editar el nombre o la capacidad de un tipo existente.",
      "Desactivar un tipo con la casilla Activo.",
      "Eliminar un tipo, con confirmacion previa.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Registrar vehiculos individuales aqui: eso se hace en el modulo de registro de vehiculos.",
      "Cambiar la capacidad de una orden ya generada: la orden guarda la capacidad del momento.",
    ],
    funcionalidades: [
      {
        nombre: "Capacidad por tipo",
        descripcion:
          "La capacidad registrada alimenta la barra de ocupacion que se muestra al armar ordenes de cargue, para no sobrecargar el vehiculo.",
      },
      {
        nombre: "Catalogo con estado",
        descripcion: "Los tipos desactivados dejan de ofrecerse al registrar vehiculos nuevos.",
      },
    ],
  },

  // ==========================================================================
  // CONDICIONES PAGO
  // ==========================================================================
  {
    modulo: "Condiciones Pago",
    resumen: "Catalogo de condiciones de pago que se ofrecen en los pedidos.",
    proposito:
      "Mantiene la lista de condiciones de pago (contado, credito, plazos) que los demas modulos ofrecen al negociar y registrar pedidos.",
    puedes: [
      "Crear una condicion de pago con su nombre.",
      "Editar el nombre de una condicion existente.",
      "Desactivar una condicion con la casilla Activo para que deje de ofrecerse.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Eliminar una condicion: solo se puede desactivar, para no afectar pedidos historicos.",
      "Aplicar la condicion a un pedido desde aqui: se escoge en el propio pedido.",
    ],
    funcionalidades: [
      {
        nombre: "Catalogo simple",
        descripcion: "Tabla de nombre y estado con creacion y edicion directas.",
      },
      {
        nombre: "Desactivar en lugar de borrar",
        descripcion: "Las condiciones en desuso se apagan sin perder la referencia en pedidos antiguos.",
      },
    ],
  },

  // ==========================================================================
  // VENDEDORES
  // ==========================================================================
  {
    modulo: "Vendedores",
    resumen: "Catalogo de vendedores con sus datos de contacto, para amarrarlos a los pedidos.",
    proposito:
      "Registra a los vendedores de la empresa seleccionada. Los pedidos y sus filtros usan esta lista para saber quien vendio y para segmentar reportes.",
    puedes: [
      "Crear un vendedor con su nombre (obligatorio), cedula, celular y correo.",
      "Editar los datos de un vendedor existente.",
      "Desactivar un vendedor con la casilla Activo sin borrar su historial de ventas.",
      "Eliminar un vendedor, con confirmacion previa.",
      "Buscar en el listado y exportarlo a Excel.",
    ],
    noPuedes: [
      "Ver vendedores de otra empresa distinta a la del selector global.",
      "Asignar pedidos desde aqui: el vendedor se escoge en cada pedido.",
    ],
    funcionalidades: [
      {
        nombre: "Ficha del vendedor",
        descripcion: "Nombre, cedula, celular y correo, disponibles para los modulos de pedidos y sus filtros.",
      },
      {
        nombre: "Estado activo",
        descripcion: "Un vendedor desactivado deja de ofrecerse en pedidos nuevos pero conserva su historial.",
      },
    ],
  },

  // ==========================================================================
  // GESTION DE USUARIOS
  // ==========================================================================
  {
    modulo: "Gestión de Usuarios",
    resumen:
      "Pantalla única de seguridad (pestañas Usuarios · Perfiles · Claves): a cada persona se le asigna un perfil que trae empresas, owners, módulos y procesos que autoriza, y se ajusta lo fino a mano.",
    proposito:
      "Es la columna vertebral de que ve cada quien en la aplicacion. Desde aqui se crean, resetean y eliminan usuarios, y a cada uno se le definen dos cosas: sus permisos (que modulos puede abrir, marcados uno a uno y agrupados por area) y sus accesos (a que empresas y owners puede entrar). Ademas muestra la ultima conexion de cada usuario y un semaforo de actividad.",
    puedes: [
      "Crear un usuario con correo, nombre de usuario, contraseña (minimo 8 caracteres, con generador de contraseña segura) y su empresa; puede iniciar sesion de inmediato, sin validar el correo.",
      "Resetear la contraseña de un usuario y comunicarle la nueva.",
      "Eliminar un usuario del sistema, con confirmacion previa.",
      "Asignar o quitar permisos modulo por modulo, con buscador, botones Todo/Nada y seleccion por grupo de area.",
      "Copiar los permisos de otro usuario como punto de partida.",
      "Otorgar o revocar acceso por empresa y por owner desde la pestaña Accesos del mismo usuario.",
      "Ver la ultima conexion de cada usuario y su estado: Inactivo si lleva mas de 30 dias sin entrar.",
    ],
    noPuedes: [
      "Eliminar tu propio usuario: el boton se bloquea.",
      "Guardar una contraseña de menos de 8 caracteres.",
      "Crear el usuario sin correo, nombre de usuario, contraseña y empresa: son obligatorios.",
    ],
    funcionalidades: [
      {
        nombre: "Lista de usuarios con semaforo",
        descripcion:
          "Panel con buscador por nombre o correo, contadores (usuarios, activos, inactivos, sin conexion) y para cada usuario su correo, ultima conexion y estado Activo/Inactivo (mas de 30 dias sin entrar).",
      },
      {
        nombre: "Crear usuario",
        descripcion:
          "Formulario con correo, usuario, contraseña (con generador seguro) y empresa. El correo queda validado desde la creacion, asi que la persona entra de una vez.",
      },
      {
        nombre: "Pestaña Permisos",
        descripcion:
          "Arbol de modulos agrupado por area con casillas una a una, buscador para filtrar modulos, botones Todo/Nada, seleccion completa por grupo y la opcion de copiar los permisos de otro usuario. Los cambios se aplican al presionar Guardar.",
      },
      {
        nombre: "Pestaña Perfil (primera, por defecto) y ajuste fino",
        descripcion:
          "Muestra el acceso efectivo de la persona (empresas, owners y módulos; cuánto viene de perfiles y cuánto a mano) y los perfiles como tarjetas para marcar y aplicar. Las pestañas Módulos y Empresas y owners quedan como ajuste fino: cada casilla que trae un perfil lleva la etiqueta perfil, y lo marcado a mano se conserva aunque el perfil cambie.",
      },
      {
        nombre: "Resetear contraseña y eliminar",
        descripcion:
          "Botones sobre el perfil del usuario seleccionado; eliminar pide confirmacion y no permite borrarse a uno mismo.",
      },
    ],
    consejos: [
      "Para un usuario nuevo, usa Copiar permisos de un usuario con el mismo cargo y ajusta lo puntual: es mas rapido y mas seguro que marcar de cero.",
      "Un usuario sin acceso a ninguna empresa no vera datos aunque tenga permisos: revisa siempre las dos pestañas.",
    ],
  },

  // ==========================================================================
  // ACCESOS DE USUARIO
  // ==========================================================================
  {
    modulo: "Accesos de Usuario",
    resumen: "Hoy es la pestaña Perfiles de la pantalla única de Autorizaciones: el puesto, con las empresas, owners, módulos y procesos autorizables que trae.",
    proposito:
      "Administra el permiso maestro de datos: que empresas ve cada usuario en el selector global (y con ello que informacion ve en casi todo el sistema) y, como filtro adicional, que owners puede consultar en Pedidos. Se trabaja sobre una tabla de usuarios contra empresas u owners, marcando casillas.",
    puedes: [
      "Marcar o desmarcar las empresas a las que cada usuario tiene acceso; el cambio aplica de inmediato.",
      "Marcar o desmarcar los owners que cada usuario puede ver en Pedidos.",
      "Cambiar entre las pestañas Usuarios y Empresas / Usuarios y Owners.",
      "Ver de un vistazo, por filas, los accesos de todos los usuarios.",
    ],
    noPuedes: [
      "Crear usuarios o darles permisos de modulos: eso se hace en Gestion de Usuarios.",
      "Restringir por owner otros modulos distintos de Pedidos: el owner solo filtra la gestion y el dashboard de pedidos.",
    ],
    funcionalidades: [
      {
        nombre: "Usuarios y Empresas (permiso maestro)",
        descripcion:
          "Define que empresas ve el usuario en el selector global y, con ello, que datos puede ver y gestionar en casi todo el sistema: recepcion/despacho, pedidos, inventarios, produccion, operacion, financiera, gestion humana, SST y demas. Cada modulo filtra por la empresa seleccionada.",
      },
      {
        nombre: "Usuarios y Owners (filtro de Pedidos)",
        descripcion:
          "Restringe la gestion y el dashboard de Pedidos por la razon social que factura. Solo aplica si el usuario tiene owners marcados; si no tiene ninguno, no se restringe. Un owner agrupa varias empresas, asi que para ver los pedidos de una razon social suele necesitarse acceso a la empresa del sitio y a su owner.",
      },
      {
        nombre: "Aplicacion inmediata",
        descripcion:
          "Cada casilla otorga o revoca el acceso en el momento, sin boton de guardar; la aplicacion confirma cada cambio.",
      },
    ],
    consejos: [
      "Si un usuario dice que no ve datos de una sede, revisa primero esta tabla: casi siempre le falta la empresa marcada.",
    ],
  },

  // ==========================================================================
  // BITACORA DE AUDITORIA
  // ==========================================================================
  {
    modulo: "Bitácora de Auditoría",
    resumen: "Historial de solo lectura de cada cambio hecho en la aplicacion: quien, cuando y que cambio.",
    proposito:
      "Registra automaticamente toda creacion, edicion y eliminacion que ocurre en el sistema, con el usuario que la hizo, la fecha y hora, el modulo afectado y el detalle campo por campo del antes y el despues. Sirve para investigar quien cambio un dato y cuando, sin depender de la memoria de nadie. Es un modulo exclusivo de administradores.",
    puedes: [
      "Filtrar el historial por rango de fechas, usuario, modulo y tipo de accion (creacion, edicion, eliminacion).",
      "Buscar por texto en la descripcion o el registro afectado.",
      "Abrir cualquier fila para ver el detalle campo por campo, con el antes y el despues resaltados.",
      "Navegar el historial por paginas de 50 registros.",
      "Limpiar todos los filtros con un solo boton.",
    ],
    noPuedes: [
      "Modificar o borrar registros de la bitacora: es de solo lectura.",
      "Deshacer un cambio desde aqui: la bitacora muestra el antes y el despues, pero la correccion se hace en el modulo correspondiente.",
    ],
    funcionalidades: [
      {
        nombre: "Filtros combinables",
        descripcion:
          "Desde/Hasta, usuario, modulo, tipo de accion y buscador de texto se combinan para acotar la investigacion; el contador muestra cuantos registros cumplen el filtro.",
      },
      {
        nombre: "Detalle antes / despues",
        descripcion:
          "Al hacer clic en una fila se abre una ventana con la tabla Campo / Antes / Despues; lo que cambio se resalta (en rojo lo que salio, en verde lo que entro).",
      },
      {
        nombre: "Etiqueta de accion",
        descripcion:
          "Cada fila indica si el usuario Creo, Edito o Elimino, con su color, junto al modulo y la descripcion del cambio.",
      },
    ],
    consejos: [
      "Empieza filtrando por modulo y rango de fechas; el buscador de texto es util cuando conoces el nombre o numero del registro afectado.",
    ],
  },

  // ==========================================================================
  // PLACAS DE DISTRIBUCION
  // ==========================================================================
  {
    modulo: "Placas de Distribución",
    resumen:
      "Lista de vehiculos propios que, al montarles una orden de cargue, generan sola la orden de distribucion.",
    proposito:
      "Administra las placas propias de cada empresa que disparan la distribucion automatica: cuando a una de estas placas se le monta su orden de cargue, el sistema crea automaticamente la orden de distribucion hermana (mismo numero mas la letra D), que es la que despues se factura. Permite asignar o desasignar placas al momento, sin necesidad de un despliegue tecnico.",
    puedes: [
      "Asignar una placa nueva escogiendo la empresa, escribiendo la placa y una observacion opcional.",
      "Desasignar una placa para que deje de generar distribucion automatica, sin perder su historial.",
      "Reactivar una placa que estaba desasignada.",
      "Eliminar una placa definitivamente, con confirmacion (en ese caso se pierde el historial).",
      "Ver el estado de cada placa (Asignada o Desasignada) y su observacion.",
    ],
    noPuedes: [
      "Definir aqui a quien se factura el vehiculo: eso lo sigue determinando el producto que carga, no esta lista.",
      "Crear ordenes de distribucion manualmente desde aqui: solo se administra que placas la generan sola.",
    ],
    funcionalidades: [
      {
        nombre: "Asignacion por empresa",
        descripcion:
          "Cada placa se amarra a una empresa; la placa se escribe en mayusculas y basta con presionar Asignar placa para dejarla operando.",
      },
      {
        nombre: "Desasignar / Reactivar",
        descripcion:
          "Apaga o vuelve a encender la distribucion automatica de la placa conservando el registro; una placa desasignada se ve atenuada en la lista.",
      },
      {
        nombre: "Efecto casi inmediato",
        descripcion:
          "Los cambios surten efecto en cerca de un minuto (o de inmediato en la siguiente operacion), sin despliegues ni intervencion tecnica.",
      },
    ],
    consejos: [
      "Prefiere Desasignar en lugar de Eliminar: logras el mismo efecto operativo y conservas el historial de la placa.",
    ],
  },

  // ==========================================================================
  // MUELLES DE CARGUE
  // ==========================================================================
  {
    modulo: "Muelles de Cargue",
    resumen: "Administra los muelles fisicos disponibles por proyecto para asignar en Centro de Coordinacion.",
    proposito:
      "Cada proyecto tiene un numero fijo de muelles fisicos donde se atienden los vehiculos; este modulo permite agregar, desactivar o eliminar muelles sin necesidad de un despliegue tecnico. Los cambios los usa de inmediato Centro de Coordinacion al momento de asignar una orden a un muelle.",
    puedes: [
      "Agregar un muelle nuevo escogiendo la empresa y el numero de muelle (el formulario sugiere el siguiente numero disponible) mas una observacion opcional.",
      "Desactivar un muelle para que deje de ofrecerse en Centro de Coordinacion, sin perder su historial.",
      "Reactivar un muelle que estaba desactivado.",
      "Eliminar un muelle definitivamente, con confirmacion (en ese caso se pierde el historial).",
      "Ver el estado de cada muelle (Activo o Inactivo) y su observacion, agrupados por empresa.",
    ],
    noPuedes: [
      "Desactivar o eliminar un muelle que tiene una orden activa en este momento: el sistema lo bloquea hasta que esa orden cierre.",
      "Asignar ordenes a un muelle desde aqui: eso se sigue haciendo en Centro de Coordinacion; este modulo solo administra cuales muelles existen.",
    ],
    funcionalidades: [
      {
        nombre: "Alta de muelle",
        descripcion:
          "Se elige la empresa, se escribe el numero de muelle (sugerido automaticamente segun los que ya existen para esa empresa) y una observacion opcional.",
      },
      {
        nombre: "Desactivar / Reactivar / Eliminar",
        descripcion:
          "Desactivar y Eliminar validan primero que el muelle no tenga una orden abierta ahora mismo; si la tiene, avisan cual es y no dejan continuar. Un muelle inactivo se ve atenuado en la lista.",
      },
      {
        nombre: "Efecto casi inmediato",
        descripcion:
          "Los cambios surten efecto en Centro de Coordinacion en cerca de un minuto (o de inmediato en la siguiente operacion), sin despliegues ni intervencion tecnica.",
      },
    ],
    consejos: [
      "Prefiere Desactivar en lugar de Eliminar cuando un muelle se dane o se saque de operacion temporalmente: conservas su historial y evitas renumerar los demas muelles.",
    ],
  },
  // Guías agregadas 2026-09-30 (reorg de navegación: el buscador global usa este texto).
  {
    modulo: "Autorizaciones por clave",
    resumen: "Hoy es la pestaña Claves de la pantalla única de Autorizaciones: la clave personal de cada usuario, su alcance fino, excepciones y bitácora. Qué autoriza cada puesto se define en la pestaña Perfiles.",
    proposito: "Gestión de Usuarios dice qué pantallas ve cada uno; aquí se define quién puede autorizar qué proceso (aprobar un 702, liberar una cuarentena, anular un pedido…) mediante perfiles por puesto con alcance por proyecto. La clave con la que se autoriza es personal: cada usuario la crea desde su menú y la recupera por correo.",
    puedes: [
      "Crear y editar perfiles (Gerencia de proyecto, Calidad, Cartera, Coordinador LIP…) y qué procesos autoriza cada uno.",
      "Asignar perfiles y excepciones a usuarios, con alcance por proyecto.",
      "Ver el estado de la clave de cada usuario y su correo de recuperación, y probar el envío de correo.",
      "Revisar la bitácora: quién autorizó qué, cuándo y con qué resultado.",
      "Fijar la fecha límite de las claves compartidas de transición."
    ],
    noPuedes: [
      "Ver ni cambiar la clave de otra persona: es personal y va cifrada.",
      "Dar procesos financieros a usuarios sin módulos financieros: lo financiero es de LIP.",
      "Usarlo desde un ID: es exclusivo de LIPgo."
    ],
    funcionalidades: [
      {
        nombre: "Usuarios",
        descripcion: "Por usuario: perfiles asignados, excepciones por proceso, estado de la clave y correo de recuperación. Filtra por el proyecto del selector global."
      },
      {
        nombre: "Perfiles",
        descripcion: "Matriz perfil por proceso: qué puede autorizar cada puesto."
      },
      {
        nombre: "Bitácora",
        descripcion: "Cada intento de autorización con usuario, proceso, proyecto, resultado y referencia."
      },
      {
        nombre: "Correo de recuperación",
        descripcion: "Las cuentas @lipgo.app no reciben correo; aquí se registra el correo real de cada persona para recuperar su clave."
      }
    ]
  },
]
