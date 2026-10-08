"use client"

// DIÁLOGO COMPARTIDO PARA PEDIR LA CLAVE PERSONAL DE AUTORIZACIÓN.
//
// Solo es interfaz: campo, ojo, error, Enter. La clave NO se valida aquí. Se
// manda a la server action del negocio, que la valida con `autorizarAccion`
// (lib/puerta-modulo.ts) de forma atómica con la escritura, igual que hoy hace
// closePendingOrder. Si la acción responde con error, se muestra y el diálogo
// sigue abierto para corregir.
//
// Antes cada pantalla tenía su propio diálogo (acciones-pedido.tsx, bonos.tsx…)
// con pequeñas diferencias. Con 16 procesos con clave nuevos, uno solo.
//
//   <DialogoClaveAutorizacion
//     abierto={abierto}
//     onCerrar={() => setAbierto(false)}
//     titulo="Eliminar la orden AVI202610069897"
//     descripcion="Revierte inventario y pedidos. No se puede deshacer."
//     textoConfirmar="Eliminar"
//     destructivo
//     onConfirmar={async (clave) => {
//       const r = await deleteLoadOrder(id, clave)
//       return r.success ? null : r.message   // null = listo; texto = error que se muestra
//     }}
//   />

import { useEffect, useRef, useState } from "react"
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** El campo de clave con el ojo, para pantallas que ya tienen su propio diálogo. */
export function CampoClaveAutorizacion({
  valor,
  onChange,
  onEnter,
  disabled,
  autoFocus,
  id = "clave-autorizacion",
  etiqueta = "Tu clave personal de autorización",
}: {
  valor: string
  onChange: (v: string) => void
  onEnter?: () => void
  disabled?: boolean
  autoFocus?: boolean
  id?: string
  etiqueta?: string | null
}) {
  const [ver, setVer] = useState(false)
  return (
    <div className="space-y-1.5">
      {etiqueta && (
        <Label htmlFor={id} className="flex items-center gap-1.5 text-xs">
          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" /> {etiqueta}
        </Label>
      )}
      <div className="relative">
        <Input
          id={id}
          type={ver ? "text" : "password"}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) {
              e.preventDefault()
              onEnter()
            }
          }}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          className="pr-9"
          placeholder="••••••••"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVer((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={ver ? "Ocultar clave" : "Mostrar clave"}
        >
          {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

export function DialogoClaveAutorizacion({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  textoConfirmar = "Autorizar",
  destructivo = false,
  onConfirmar,
  children,
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  descripcion?: React.ReactNode
  textoConfirmar?: string
  destructivo?: boolean
  /** Devuelve `null` si quedó hecho (el diálogo se cierra) o el texto del error (se muestra y sigue abierto). */
  onConfirmar: (clave: string) => Promise<string | null>
  /** Contenido extra entre la descripción y el campo (p. ej. un motivo obligatorio). */
  children?: React.ReactNode
}) {
  const [clave, setClave] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const montado = useRef(true)

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  // Al abrir, limpio: una clave de un intento anterior no debe quedar en el campo.
  useEffect(() => {
    if (abierto) {
      setClave("")
      setError(null)
      setTrabajando(false)
    }
  }, [abierto])

  const confirmar = async () => {
    if (!clave.trim() || trabajando) return
    setTrabajando(true)
    setError(null)
    try {
      const r = await onConfirmar(clave)
      if (!montado.current) return
      if (r === null) onCerrar()
      else setError(r)
    } catch (e: any) {
      if (montado.current) setError(e?.message || "No se pudo autorizar.")
    } finally {
      if (montado.current) setTrabajando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && !trabajando && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> {titulo}
          </DialogTitle>
          {descripcion && <DialogDescription>{descripcion}</DialogDescription>}
        </DialogHeader>
        {children}
        <CampoClaveAutorizacion valor={clave} onChange={setClave} onEnter={confirmar} disabled={trabajando} autoFocus />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-[11px] text-muted-foreground">
          Quien autoriza queda registrado con su nombre. Si aún no tienes clave personal, créala en el menú de usuario › Mi clave de
          autorización.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={trabajando}>
            Cancelar
          </Button>
          <Button variant={destructivo ? "destructive" : "default"} onClick={confirmar} disabled={!clave.trim() || trabajando}>
            {trabajando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {textoConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
