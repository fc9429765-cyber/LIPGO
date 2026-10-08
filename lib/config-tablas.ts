// LISTA BLANCA DE TABLAS DEL CRUD GENÉRICO DE CONFIGURACIÓN (tabla → módulos del menú).
//
// Vive sin "use server" porque la leen dos lados: lib/config-actions.ts (la
// puerta del servidor) y components/configuration/generic-crud-table.tsx (para
// saber si una tabla pide clave personal, p. ej. las de Tarifas).
//
// Por qué existe (Fase 0, 2026-10-07): las acciones del CRUD recibían el nombre
// de la tabla desde el navegador; sin lista, `createConfigRecord("permisos_usuarios", …)`
// era una llamada válida para cualquiera con sesión. Cada tabla lleva su llave
// primaria real (la que manda el cliente debe coincidir) y los módulos que la
// editan; el servidor exige tener al menos uno y la acción (crear/editar/eliminar).
//
// `cabeceraoc` entra solo para LEER (Báscula la consulta con fetchConfigData).
// `perfil_acceso_empresas` queda fuera a propósito: se administra desde Autorizaciones.

export type TablaConfig = { modulos: string[]; pk: string; soloLectura?: boolean }

export const TABLAS_CONFIG: Record<string, TablaConfig> = {
  almacenes: { modulos: ["Bodegas"], pk: "id" },
  bodegas: { modulos: ["Sucursales", "Bodegas"], pk: "idbodega" },
  categorias: { modulos: ["Categorías"], pk: "id" },
  subcategorias: { modulos: ["Sub Categorías"], pk: "id" },
  clientes: { modulos: ["Clientes"], pk: "id" },
  condicionespago: { modulos: ["Condiciones Pago"], pk: "idcondicion" },
  destinos: { modulos: ["Destinos"], pk: "id" },
  grupos: { modulos: ["Grupos"], pk: "id" },
  medio: { modulos: ["Medios"], pk: "id" },
  productos: { modulos: ["Productos"], pk: "id" },
  tipodespacho: { modulos: ["Tipos Despacho"], pk: "idtipodespacho" },
  vendedores: { modulos: ["Vendedores"], pk: "idvendedor" },
  transportes: { modulos: ["Transportadoras"], pk: "id" },
  tiposvehiculos: { modulos: ["Tipos de Vehiculos"], pk: "id" },
  locations: { modulos: ["Localizaciones"], pk: "id" },
  citasvehiculos: { modulos: ["Ver Vehículos"], pk: "id" },
  proveedores: { modulos: ["Gestión de proveedores"], pk: "id" },
  materiales: { modulos: ["Creación de materiales"], pk: "id" },
  tarifas: { modulos: ["Tarifas"], pk: "id" },
  tarifasoperacion: { modulos: ["Tarifas"], pk: "id" },
  tarifaspersonal: { modulos: ["Tarifas"], pk: "id" },
  tarifasturnos: { modulos: ["Tarifas"], pk: "id" },
  tarifasfacturacionturnos: { modulos: ["Tarifas"], pk: "id" },
  cabeceraoc: { modulos: ["Báscula"], pk: "id", soloLectura: true },
}

/** El módulo del menú que gobierna una tabla del CRUD, o null si no está en la lista. */
export function moduloDeTabla(tableName: string): string | null {
  return TABLAS_CONFIG[tableName]?.modulos[0] ?? null
}
