"use client"

// Paso de verificación del segundo factor (código de 6 dígitos de la app autenticadora).
// Lo usan el formulario de ingreso (después de la contraseña) y la compuerta de app/page.tsx
// (sesión que aún no pasó el segundo factor). Solo aparece a quien lo ACTIVÓ: es opcional
// por usuario (gerencia 2026-10-03: "no bloquear a los usuarios").

import { useEffect, useState } from "react"
import { Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { supabase } from "@/lib/supabase-client"

/** true si la sesión actual tiene un segundo factor activo y todavía no lo ha verificado. */
export async function requiereSegundoFactor(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) return false
    return data.nextLevel === "aal2" && data.currentLevel !== "aal2"
  } catch {
    return false
  }
}

export function VerificarSegundoFactor({ onVerificado, onCancelar, compacto = false }: { onVerificado: () => void; onCancelar?: () => void; compacto?: boolean }) {
  const [factorId, setFactorId] = useState<string | null>(null)
  const [codigo, setCodigo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)

  useEffect(() => {
    let vivo = true
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!vivo) return
      if (error) {
        setError(error.message)
        return
      }
      const f = (data?.totp ?? []).find((x: any) => x.status === "verified") ?? (data?.all ?? []).find((x: any) => x.status === "verified")
      if (!f) setError("No se encontró un segundo factor activo en esta cuenta.")
      else setFactorId(f.id)
    })
    return () => {
      vivo = false
    }
  }, [])

  const verificar = async () => {
    if (!factorId || codigo.length !== 6) return
    setVerificando(true)
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: codigo })
    setVerificando(false)
    if (error) {
      setError(/invalid|incorrect|expired/i.test(error.message) ? "Código incorrecto o vencido. Revisa la app autenticadora e inténtalo de nuevo." : error.message)
      setCodigo("")
      return
    }
    onVerificado()
  }

  useEffect(() => {
    if (codigo.length === 6 && factorId && !verificando) void verificar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo])

  return (
    <div className={compacto ? "space-y-3" : "space-y-4"}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-acento-tinte text-acento">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold">Código de verificación</p>
          <p className="text-xs text-muted-foreground">Abre tu app autenticadora (Google Authenticator, Microsoft Authenticator, Authy) y escribe el código de 6 dígitos de LIPgo.</p>
        </div>
      </div>
      <div className="flex justify-center">
        <InputOTP maxLength={6} value={codigo} onChange={setCodigo} disabled={!factorId || verificando} autoFocus>
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      {error && <p className="text-center text-xs text-critico-fg">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        {onCancelar ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={verificando}>
            Cancelar
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" size="sm" onClick={verificar} disabled={!factorId || codigo.length !== 6 || verificando}>
          {verificando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Verificar
        </Button>
      </div>
    </div>
  )
}
