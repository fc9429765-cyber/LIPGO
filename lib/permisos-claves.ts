// CLAVES DE PERMISO QUE SE PUEDEN OTORGAR
//
// Server-safe a propósito: no importa el menú (lib/dashboard-data.ts), que
// trae iconos y es lo que usan las pantallas. El servidor solo necesita las
// CLAVES para validar lo que le mandan; el árbol con grupos y etiquetas vive
// en lib/permisos-arbol.ts y lo consumen las pantallas.

import { MODULE_PERMISSION_MAP } from "@/lib/permissions-map"

export type PermisoExtra = { key: string; label: string }

// Permisos que NO son módulos del menú pero deben poder otorgarse: las
// pestañas por norma del SIG y los dos roles dentro de Ciclo de Facturación
// (`ciclo_facturacion`, auto-derivado del menú, solo da acceso a VER el
// módulo; sin estos dos nadie podía dar de alta un Jefe o un Coordinador
// reales -- bug encontrado 2026-09-11). La clave del objeto es el título del
// subgrupo del menú bajo el que se muestran.
export const EXTRA_PERMS_POR_SUBGRUPO: Record<string, PermisoExtra[]> = {
  "Sistema Integrado (SIG)": [
    { key: "sig_iso9001", label: "— Pestaña ISO 9001:2015" },
    { key: "sig_iso14001", label: "— Pestaña ISO 14001:2015" },
    { key: "sig_iso45001", label: "— Pestaña ISO 45001:2018" },
  ],
  Facturación: [
    { key: "ciclo_facturacion_jefe", label: "— Ciclo de Facturación: rol Jefe (enviar anexo/factura, cerrar)" },
    { key: "ciclo_facturacion_coordinador", label: "— Ciclo de Facturación: rol Coordinador (subir firmado por el cliente)" },
  ],
}

/**
 * Todas las claves que una pantalla de permisos puede otorgar: las del mapa de
 * módulos más las extra. Es contra esto que el servidor valida un perfil de
 * acceso, para que nadie guarde una clave que no exista como columna en
 * `permisos_usuarios`.
 */
export const CLAVES_PERMISO: ReadonlySet<string> = new Set<string>([
  ...Object.values(MODULE_PERMISSION_MAP),
  ...Object.values(EXTRA_PERMS_POR_SUBGRUPO).flatMap((xs) => xs.map((x) => x.key)),
])
