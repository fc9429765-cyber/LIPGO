// Tipos y constantes del sistema de AUTORIZACIONES POR CLAVE (SQL 203). SIN
// "use server": lo importan tanto el cliente (pantallas) como el servidor.
//
// Idea (como SAP): la identidad es del usuario (su sesión), la clave personal
// confirma que es él, y el PERFIL (puesto) dice qué procesos/códigos puede
// autorizar y en qué proyectos. Quién autorizó queda con nombre real.

export type GrupoProceso = "Inventario" | "Pedidos" | "Financiera" | "Órdenes" | "Facturación" | "Nómina" | "Seguridad"

export interface ProcesoAutorizable {
  codigo: string
  nombre: string
  descripcion: string | null
  grupo: GrupoProceso | string
  orden: number
  con_alcance: boolean
  activo: boolean
}

/** Proceso que autoriza EJECUTAR un código de inventario (309/102/602/552/312/343). */
export function procesoInventarioEjecutar(codigo: string): string {
  return `inv_${String(codigo).trim()}`
}
/** Proceso que autoriza APROBAR/RECHAZAR un ajuste pendiente (601/702/555). */
export function procesoInventarioAprobar(codigo: string): string {
  return `inv_${String(codigo).trim()}_aprobar`
}

export const CLAVE_MIN_LARGO = 6
export const CLAVE_MAX_LARGO = 32

/** Reglas de formato de la clave personal. Devuelve el error o null si es válida. */
export function validarFormatoClave(clave: string): string | null {
  const c = String(clave ?? "")
  if (c.trim() !== c) return "La clave no puede empezar ni terminar con espacios."
  if (c.length < CLAVE_MIN_LARGO) return `La clave debe tener al menos ${CLAVE_MIN_LARGO} caracteres.`
  if (c.length > CLAVE_MAX_LARGO) return `La clave no puede superar ${CLAVE_MAX_LARGO} caracteres.`
  if (/^(\d)\1+$/.test(c) || /^(.)\1+$/.test(c)) return "La clave no puede ser un solo carácter repetido."
  if (/^(123456|654321|abcdef|qwerty|password|contrasena|contraseña|lipgo1)/i.test(c)) return "Esa clave es demasiado fácil de adivinar."
  return null
}

export interface ResultadoAutorizacion {
  ok: boolean
  /** Nombre visible de quien autorizó (usuario de LIPgo, o responsable de la clave compartida en transición). */
  autorizadoPor?: string
  usuarioId?: string | null
  via?: "personal" | "compartida"
  error?: string
}

export interface MiAutorizacion {
  proceso: string
  nombre: string
  grupo: string
  /** "Todos los proyectos" o la lista de proyectos. */
  alcance: string
  /** Perfil que la otorga, o "Excepción". */
  origen: string
}

export interface EstadoMiClave {
  tieneClave: boolean
  provisional: boolean
  bloqueadaHasta: string | null
  actualizadaEn: string | null
  /** Correo con el que el usuario ENTRA a LIPgo (enmascarado). Puede no ser un buzón real. */
  correoEnmascarado: string | null
  /** false si el dominio del correo de acceso no recibe mensajes (p. ej. @lipgo.app); null = no se pudo saber. */
  correoLoginRecibe: boolean | null
  /** Correo REAL de recuperación registrado por el usuario o la gerencia (enmascarado). */
  correoRecuperacion: string | null
  correoRecuperacionVerificado: boolean
  /** true si el servidor puede enviar correos (RESEND_API_KEY configurada). */
  correoDisponible: boolean
  transicionHasta: string | null
  autorizaciones: MiAutorizacion[]
  denegadas: MiAutorizacion[]
}

// --- Administración (pantalla "Autorizaciones por clave") -------------------

export interface PerfilAutorizacion {
  id: number
  nombre: string
  descripcion: string | null
  activo: boolean
  procesos: string[]
  usuarios: number
}

export interface AsignacionPerfil {
  id: number
  perfil_id: number
  perfil: string
  idempresa: number | null
}

export interface ExcepcionProceso {
  id: number
  proceso: string
  idempresa: number | null
  permitir: boolean
}

export interface UsuarioAutorizacion {
  id: string
  usuario: string
  empresa_id: number | null
  /** Correo de ACCESO (puede no ser un buzón real). */
  email: string | null
  /** false si el dominio del correo de acceso no recibe mensajes. */
  emailRecibe: boolean | null
  /** Correo real de recuperación (completo, solo lo ve la administración). */
  correoRecuperacion: string | null
  correoRecuperacionVerificado: boolean
  tieneClave: boolean
  provisional: boolean
  bloqueadaHasta: string | null
  actualizadaEn: string | null
  perfiles: AsignacionPerfil[]
  excepciones: ExcepcionProceso[]
}

export interface ResumenAutorizaciones {
  procesos: ProcesoAutorizable[]
  perfiles: PerfilAutorizacion[]
  usuarios: UsuarioAutorizacion[]
  empresas: { id: number; nombre: string }[]
  transicionHasta: string | null
  correoConfigurado: boolean
  /** Remitente en uso (EMAIL_FROM o el de prueba de Resend). */
  correoRemitente: string
  /** true si el remitente es el de prueba de Resend: solo llega al dueño de la cuenta de Resend. */
  correoRemitentePrueba: boolean
  /** Correo del administrador en sesión (destino del botón "Probar correo"). */
  correoAdmin: string | null
}

export interface LogAutorizacion {
  id: number
  usuario: string | null
  proceso: string
  idempresa: number | null
  resultado: string
  autorizado_por: string | null
  referencia: string | null
  created_at: string
}

export const RESULTADO_LABEL: Record<string, string> = {
  ok: "Autorizado",
  ok_compartida: "Autorizado (clave compartida, transición)",
  clave_incorrecta: "Clave incorrecta",
  sin_permiso: "Clave correcta, sin permiso",
  sin_clave: "Sin clave personal",
  bloqueado: "Bloqueada por intentos",
  provisional: "Clave provisional sin cambiar",
  sin_sesion: "Sin sesión",
}

/** Enmascara un correo para mostrarlo sin exponerlo: ju***@lipgo.app */
export function enmascararCorreo(email: string | null | undefined): string | null {
  const e = String(email ?? "").trim()
  if (!e || !e.includes("@")) return null
  const [u, d] = e.split("@")
  const vis = u.slice(0, Math.min(2, u.length))
  return `${vis}${"*".repeat(Math.max(3, u.length - vis.length))}@${d}`
}
