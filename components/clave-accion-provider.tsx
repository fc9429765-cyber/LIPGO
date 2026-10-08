"use client"

// PEDIR LA CLAVE PERSONAL CUANDO LA ACCIÓN ES "CON CLAVE".
//
// Un solo diálogo para toda la aplicación (components/dialogo-clave-autorizacion.tsx),
// montado en el layout, y un hook que cualquier pantalla usa así:
//
//   const { conClave } = useClaveAccion()
//   const r = await conClave("Gestión de Ordenes", "eliminar", (clave) => deleteLoadOrder(id, clave))
//
// `conClave` decide si hay que pedir la clave:
//   · si el catálogo declara (módulo, verbo) con clave Y el modo de las políticas es
//     'bloquear' → abre el diálogo, espera la clave y llama `fn(clave)`. Si la server
//     action responde { success:false } el error se muestra en el diálogo y se puede
//     volver a intentar; si responde bien, el diálogo se cierra y se devuelve el resultado.
//   · en cualquier otro caso (acción silenciosa, o modo 'aviso') → llama `fn(undefined)`
//     de una. En modo aviso NADA cambia para el usuario: el servidor deja rastro y pasa.
//
// Si el usuario cancela el diálogo, `conClave` devuelve `{ success:false, ok:false,
// cancelado:true, message:"Autorización cancelada." }`, con la misma forma que una
// respuesta fallida: así las pantallas existentes (`if (r.success) … else toast`) no
// necesitan un caso aparte.
//
// Para lotes (emitir varias facturas) está `pedirClave`: pide la clave UNA vez y la
// pantalla la pasa a cada llamada. Devuelve `undefined` si no hace falta, `null` si se
// canceló, o la clave.
//
// La clave NUNCA se valida aquí; viaja a la server action, que la valida con
// `autorizarAccion` de forma atómica con la escritura.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"
import { DialogoClaveAutorizacion } from "@/components/dialogo-clave-autorizacion"
import { useModulePermissions } from "@/hooks/use-module-permissions"
import type { Verbo } from "@/lib/permisos-verbos"
import { etiquetaAccion } from "@/lib/politicas-modulos"

type Opciones = { titulo?: string; descripcion?: string; destructivo?: boolean }

type Pendiente = {
  titulo: string
  descripcion?: string
  destructivo: boolean
  fn: (clave: string) => Promise<any>
  resolver: (r: any) => void
}

export const CANCELADO = { success: false, ok: false, cancelado: true, message: "Autorización cancelada.", error: "Autorización cancelada." } as const

type ContextoClaveAccion = {
  /**
   * Ejecuta `fn` pidiendo antes la clave personal si (módulo, verbo) es con clave y el
   * modo es 'bloquear'. Devuelve lo que devuelva `fn`, o `CANCELADO` si el usuario cerró.
   */
  conClave: <R>(modulo: string, verbo: Verbo, fn: (clave?: string) => Promise<R>, opciones?: Opciones) => Promise<R>
  /** Pide la clave una vez (lotes). `undefined` = no hace falta; `null` = cancelado. */
  pedirClave: (modulo: string, verbo: Verbo, opciones?: Opciones) => Promise<string | undefined | null>
  /** true si esa acción pedirá clave al pulsar (para marcar el botón con un candado). */
  pideClave: (modulo: string, verbo: Verbo) => boolean
}

const Ctx = createContext<ContextoClaveAccion | null>(null)

function esFallo(r: any): string | null {
  if (!r || typeof r !== "object") return null
  if (r.success === false || r.ok === false) return String(r.message ?? r.error ?? "No se pudo completar la acción.")
  return null
}

export function ClaveAccionProvider({ children }: { children: ReactNode }) {
  const { modoPoliticas, accionConClave, loaded } = useModulePermissions()
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const pendienteRef = useRef<Pendiente | null>(null)

  const pideClave = useCallback(
    (modulo: string, verbo: Verbo) => loaded && modoPoliticas === "bloquear" && accionConClave(modulo, verbo),
    [loaded, modoPoliticas, accionConClave],
  )

  const abrir = useCallback(<R,>(modulo: string, verbo: Verbo, fn: (clave: string) => Promise<R>, opciones?: Opciones): Promise<R> => {
    return new Promise<R>((resolver) => {
      const p: Pendiente = {
        titulo: opciones?.titulo ?? `${etiquetaAccion(modulo, verbo)} · ${modulo}`,
        descripcion: opciones?.descripcion,
        destructivo: opciones?.destructivo ?? ["eliminar", "anular"].includes(verbo),
        fn,
        resolver,
      }
      pendienteRef.current = p
      setPendiente(p)
    })
  }, [])

  const conClave = useCallback(
    async <R,>(modulo: string, verbo: Verbo, fn: (clave?: string) => Promise<R>, opciones?: Opciones): Promise<R> => {
      if (!pideClave(modulo, verbo)) return fn(undefined)
      return abrir<R>(modulo, verbo, (clave) => fn(clave), opciones)
    },
    [pideClave, abrir],
  )

  const pedirClave = useCallback(
    async (modulo: string, verbo: Verbo, opciones?: Opciones): Promise<string | undefined | null> => {
      if (!pideClave(modulo, verbo)) return undefined
      const r = await abrir<{ success: true; clave: string } | typeof CANCELADO>(modulo, verbo, async (clave) => ({ success: true as const, clave }), opciones)
      return "clave" in r ? r.clave : null
    },
    [pideClave, abrir],
  )

  const cerrar = () => {
    const p = pendienteRef.current
    pendienteRef.current = null
    setPendiente(null)
    p?.resolver(CANCELADO)
  }

  const confirmar = async (clave: string): Promise<string | null> => {
    const p = pendienteRef.current
    if (!p) return null
    const r = await p.fn(clave)
    const fallo = esFallo(r)
    if (fallo) return fallo
    pendienteRef.current = null
    setPendiente(null)
    p.resolver(r)
    return null
  }

  const valor = useMemo(() => ({ conClave, pedirClave, pideClave }), [conClave, pedirClave, pideClave])

  return (
    <Ctx.Provider value={valor}>
      {children}
      <DialogoClaveAutorizacion
        abierto={!!pendiente}
        onCerrar={cerrar}
        titulo={pendiente?.titulo ?? ""}
        descripcion={pendiente?.descripcion}
        destructivo={pendiente?.destructivo ?? false}
        textoConfirmar="Autorizar"
        onConfirmar={confirmar}
      />
    </Ctx.Provider>
  )
}

export function useClaveAccion(): ContextoClaveAccion {
  const ctx = useContext(Ctx)
  if (ctx) return ctx
  // Fuera del provider (pruebas, portal): sin diálogo, se ejecuta directo.
  return {
    conClave: (_m, _v, fn) => fn(undefined),
    pedirClave: async () => undefined,
    pideClave: () => false,
  }
}
