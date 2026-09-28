// ---------------------------------------------------------------------------
// CLIENTE DE LA API DE SIIGO (facturación)
//
// Server-only: se importa desde server actions y route handlers, nunca desde el
// navegador. Las credenciales viven en `process.env` y NO salen de aquí: quien
// tenga el ACCESS_KEY puede leer toda la facturación de LIP.
//
// EL TOKEN SE CACHEA EN MEMORIA. Siigo lo entrega con vigencia de 24 h y pedir
// uno nuevo en cada consulta gastaría una llamada de más por cada página de
// resultados --y el barrido histórico son cientos de páginas--. Se guarda en el
// proceso, no en la base: un token en la base es un secreto más que proteger, y
// perderlo al reiniciar solo cuesta una llamada.
//
// Mismo patrón que lib/compliance.ts, que es la otra integración externa.
// ---------------------------------------------------------------------------

const OPS_BASE = (process.env.SIIGO_BASE_URL || "https://api.siigo.com/v1").replace(/\/$/, "")
const SIGNIN_URL =
  process.env.SIIGO_SIGNIN_URL ||
  "https://services.siigo.com/alliances/api/siigoapi-users/v1/sign-in"

/** Cuántas facturas pide cada página. Es el tope que admite Siigo. */
export const PAGE_SIZE = 100

/** Reintentos ante 408, 429 y 5xx: son fallos transitorios, no errores. */
const MAX_REINTENTOS = 5

// ---------------------------------------------------------------------------
// Tipos de lo que devuelve Siigo. Se declaran los campos que se usan; la API
// manda más y se ignoran sin romper nada.
// ---------------------------------------------------------------------------

export interface SiigoItem {
  id?: string
  code?: string
  description?: string
  quantity?: number
  price?: number
  discount?: { percentage?: number; value?: number }
  taxes?: Array<{
    id?: number
    name?: string
    percentage?: number
    value?: number
  }>
  total?: number
}

export interface SiigoPago {
  id?: number
  name?: string
  value?: number
  due_date?: string
}

export interface SiigoFactura {
  id: string
  document?: { id?: number }
  number?: number
  name?: string
  date?: string
  customer?: {
    id?: string
    identification?: string
    branch_office?: string
    /** Siigo lo manda a veces como arreglo de partes del nombre. */
    name?: string | string[]
  }
  cost_center?: number
  currency?: { code?: string; exchange_rate?: number }
  total?: number
  balance?: number
  seller?: number
  observations?: string
  items?: SiigoItem[]
  payments?: SiigoPago[]
  created?: string
  last_updated?: string
}

export interface PaginaFacturas {
  results: SiigoFactura[]
  pagination?: { page?: number; page_size?: number; total_results?: number }
}

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

let tokenCache: { token: string; expira: number } | null = null

function credenciales() {
  const usuario = process.env.SIIGO_API_USER
  const accessKey = process.env.SIIGO_ACCESS_KEY
  const partnerId = process.env.SIIGO_PARTNER_ID || "LipGO"
  const faltan: string[] = []
  if (!usuario) faltan.push("SIIGO_API_USER")
  if (!accessKey) faltan.push("SIIGO_ACCESS_KEY")
  return { usuario, accessKey, partnerId, faltan }
}

/** Si la integración está configurada. NO devuelve ningún secreto. */
export function siigoConfigurado(): { ok: boolean; faltan: string[] } {
  const { faltan } = credenciales()
  return { ok: faltan.length === 0, faltan }
}

/**
 * El token de acceso, del caché o pidiendo uno nuevo.
 *
 * Se renueva 5 minutos antes de expirar: un token que caduca a mitad de un
 * barrido de cientos de páginas dejaría el trabajo por la mitad.
 */
export async function getSiigoToken(): Promise<{ token?: string; error?: string }> {
  const { usuario, accessKey, faltan } = credenciales()
  if (faltan.length) {
    return { error: `Falta configurar ${faltan.join(" y ")} en las variables de entorno.` }
  }

  if (tokenCache && Date.now() < tokenCache.expira) {
    return { token: tokenCache.token }
  }

  try {
    const r = await fetch(SIGNIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usuario, access_key: accessKey }),
      cache: "no-store",
    })

    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      // El 401 aquí casi siempre es la clave rotada o revocada, no un problema
      // de la consulta. Decirlo ahorra buscar en el sitio equivocado.
      if (r.status === 401) {
        return {
          error:
            "Siigo rechazó las credenciales (401). Revisa SIIGO_API_USER y SIIGO_ACCESS_KEY: " +
            "la clave de acceso pudo haber sido rotada desde el panel de Siigo.",
        }
      }
      return { error: j?.message || `Siigo respondió ${r.status} al autenticar.` }
    }

    const token = j?.access_token
    if (!token) return { error: "Siigo no devolvió un token de acceso." }

    const vigencia = Number(j?.expires_in ?? 86400)
    tokenCache = { token, expira: Date.now() + (vigencia - 300) * 1000 }
    return { token }
  } catch (e: any) {
    return { error: e?.message || "No se pudo contactar a Siigo." }
  }
}

/**
 * Una llamada a la API, con reintentos.
 *
 * Reintenta ante 408, 429 y 5xx con espera creciente: son fallos transitorios
 * y un barrido largo los encuentra tarde o temprano. Un 4xx distinto NO se
 * reintenta --el problema es la petición, y repetirla da lo mismo--.
 */
async function llamar(
  ruta: string,
  opciones: { metodo?: string; cuerpo?: any } = {},
): Promise<{ ok: boolean; data?: any; error?: string; status?: number }> {
  const { token, error } = await getSiigoToken()
  if (!token) return { ok: false, error }

  const { partnerId } = credenciales()
  const url = ruta.startsWith("http") ? ruta : `${OPS_BASE}${ruta}`

  let espera = 500
  for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
    try {
      const r = await fetch(url, {
        method: opciones.metodo || "GET",
        headers: {
          Authorization: token,
          "Partner-Id": partnerId,
          "Content-Type": "application/json",
        },
        ...(opciones.cuerpo ? { body: JSON.stringify(opciones.cuerpo) } : {}),
        cache: "no-store",
      })

      if (r.ok) return { ok: true, data: await r.json(), status: r.status }

      const transitorio = r.status === 408 || r.status === 429 || r.status >= 500
      if (!transitorio || intento === MAX_REINTENTOS) {
        const j = await r.json().catch(() => ({}))
        // Un 401 a mitad del trabajo es el token caducado: se limpia el caché
        // para que la siguiente llamada pida uno nuevo.
        if (r.status === 401) tokenCache = null
        return {
          ok: false,
          status: r.status,
          error: j?.Errors?.[0]?.Message || j?.message || `Siigo respondió ${r.status}.`,
        }
      }

      await new Promise((res) => setTimeout(res, espera))
      espera *= 2
    } catch (e: any) {
      if (intento === MAX_REINTENTOS) {
        return { ok: false, error: e?.message || "No se pudo contactar a Siigo." }
      }
      await new Promise((res) => setTimeout(res, espera))
      espera *= 2
    }
  }
  return { ok: false, error: "Se agotaron los reintentos." }
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export interface FiltroFacturas {
  /** yyyy-MM-dd */
  fechaDesde?: string
  fechaHasta?: string
  /** Número de identificación del cliente. */
  identificacion?: string
  /** Consecutivo del comprobante. */
  numero?: number
  page?: number
  pageSize?: number
}

/** Una página de facturas. */
export async function listarFacturas(
  filtro: FiltroFacturas = {},
): Promise<{ ok: boolean; data?: PaginaFacturas; error?: string }> {
  const p = new URLSearchParams()
  if (filtro.fechaDesde) p.set("created_start", filtro.fechaDesde)
  if (filtro.fechaHasta) p.set("created_end", filtro.fechaHasta)
  if (filtro.identificacion) p.set("customer_identification", filtro.identificacion)
  if (filtro.numero != null) p.set("number", String(filtro.numero))
  p.set("page", String(filtro.page ?? 1))
  p.set("page_size", String(filtro.pageSize ?? PAGE_SIZE))

  const r = await llamar(`/invoices?${p.toString()}`)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, data: r.data as PaginaFacturas }
}

/** Una factura con todo su detalle: items, impuestos y pagos. */
export async function getFactura(
  id: string,
): Promise<{ ok: boolean; data?: SiigoFactura; error?: string }> {
  if (!id) return { ok: false, error: "Indica la factura." }
  const r = await llamar(`/invoices/${encodeURIComponent(id)}`)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, data: r.data as SiigoFactura }
}

/**
 * El PDF de una factura.
 *
 * Siigo lo devuelve en base64 dentro de un JSON, no como archivo binario. Se
 * entrega tal cual para que el caller decida: descargarlo en el navegador o
 * guardarlo.
 */
export async function getFacturaPdf(
  id: string,
): Promise<{ ok: boolean; base64?: string; cufe?: string | null; error?: string }> {
  if (!id) return { ok: false, error: "Indica la factura." }
  const r = await llamar(`/invoices/${encodeURIComponent(id)}/pdf`)
  if (!r.ok) return { ok: false, error: r.error }
  const base64 = r.data?.base64
  if (!base64) return { ok: false, error: "Siigo no devolvió el PDF de esa factura." }
  return { ok: true, base64, cufe: r.data?.cufe ?? null }
}

/** El nombre del cliente, que Siigo manda a veces partido en un arreglo. */
export function nombreCliente(f: SiigoFactura): string {
  const n = f.customer?.name
  if (Array.isArray(n)) return n.filter(Boolean).join(" ").trim()
  return String(n ?? "").trim()
}
