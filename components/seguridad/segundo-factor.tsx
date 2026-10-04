"use client"

// Segundo factor (TOTP) de la cuenta: activar, ver estado y desactivar. Vive en "Mi clave"
// (menú de usuario › pestaña Seguridad). Opcional por usuario; recomendado para las cuentas
// de LIPgo (gerencia y administración). Usa el MFA de Supabase Auth: el secreto se muestra
// una sola vez como QR; al verificar el primer código la sesión actual sube a aal2 y, desde
// entonces, cada ingreso con contraseña pide el código.

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Loader2, ShieldCheck, ShieldOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabase-client"

type Factor = { id: string; status: "verified" | "unverified"; friendly_name?: string | null; created_at?: string }

export function SegundoFactorPanel() {
  const { toast } = useToast()
  const [factores, setFactores] = useState<Factor[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enrolando, setEnrolando] = useState<{ id: string; qr: string; secreto: string } | null>(null)
  const [codigo, setCodigo] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const [desactivando, setDesactivando] = useState(false)
  const [codigoBaja, setCodigoBaja] = useState("")

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) {
      setError(error.message)
      setFactores([])
      return
    }
    setError(null)
    setFactores(((data?.totp ?? []) as any[]).map((f) => ({ id: f.id, status: f.status, friendly_name: f.friendly_name, created_at: f.created_at })))
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const activo = (factores ?? []).find((f) => f.status === "verified") ?? null

  const empezar = async () => {
    setOcupado(true)
    setError(null)
    try {
      // Limpia intentos anteriores sin verificar (Supabase no deja repetir el nombre).
      for (const f of (factores ?? []).filter((x) => x.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: f.id })
      const nombre = `LIPgo ${new Date().toISOString().slice(0, 10)} ${Math.random().toString(36).slice(2, 6)}`
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: nombre, issuer: "LIPgo" })
      if (error) throw error
      setEnrolando({ id: data.id, qr: data.totp.qr_code, secreto: data.totp.secret })
      setCodigo("")
    } catch (e: any) {
      const m = String(e?.message ?? e)
      setError(/not enabled|disabled|mfa/i.test(m) && /enabl|disabl/i.test(m) ? "El segundo factor no está habilitado en el proyecto de Supabase (Authentication › Multi-Factor › TOTP). Pídele a administración que lo active." : m)
    } finally {
      setOcupado(false)
    }
  }

  const confirmar = async () => {
    if (!enrolando || codigo.length !== 6) return
    setOcupado(true)
    setError(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolando.id, code: codigo })
    setOcupado(false)
    if (error) {
      setError(/invalid|incorrect|expired/i.test(error.message) ? "Código incorrecto o vencido. Escribe el código actual de la app." : error.message)
      setCodigo("")
      return
    }
    setEnrolando(null)
    toast({ title: "Segundo factor activo", description: "Desde ahora, al entrar con tu contraseña se te pedirá el código de la app autenticadora." })
    cargar()
  }

  const cancelarEnrolamiento = async () => {
    if (enrolando) await supabase.auth.mfa.unenroll({ factorId: enrolando.id }).catch(() => {})
    setEnrolando(null)
    setCodigo("")
    cargar()
  }

  const desactivar = async () => {
    if (!activo || codigoBaja.length !== 6) return
    setOcupado(true)
    setError(null)
    // Quitar un factor verificado exige una sesión que acabe de pasar el segundo factor.
    const v = await supabase.auth.mfa.challengeAndVerify({ factorId: activo.id, code: codigoBaja })
    if (v.error) {
      setOcupado(false)
      setError(/invalid|incorrect|expired/i.test(v.error.message) ? "Código incorrecto o vencido." : v.error.message)
      setCodigoBaja("")
      return
    }
    const { error } = await supabase.auth.mfa.unenroll({ factorId: activo.id })
    setOcupado(false)
    if (error) {
      setError(error.message)
      return
    }
    setDesactivando(false)
    setCodigoBaja("")
    toast({ title: "Segundo factor desactivado", description: "Tu cuenta vuelve a entrar solo con contraseña." })
    cargar()
  }

  if (factores === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando el estado de tu segundo factor…
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        El segundo factor pide, además de tu contraseña, un código de 6 dígitos que genera una app en tu celular (Google Authenticator, Microsoft Authenticator o Authy). Protege la cuenta aunque alguien conozca la contraseña. Es opcional; recomendado para quienes manejan información financiera, de nómina o de usuarios.
      </p>

      {activo && !desactivando && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ok-bd bg-ok-bg p-2.5 text-xs text-ok-fg">
          <span className="flex items-center gap-1.5 font-medium">
            <ShieldCheck className="h-4 w-4" /> Segundo factor activo{activo.created_at ? ` desde el ${new Date(activo.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}` : ""}
          </span>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setDesactivando(true)} disabled={ocupado}>
            <ShieldOff className="h-3.5 w-3.5" /> Desactivar
          </Button>
        </div>
      )}

      {activo && desactivando && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs">Para desactivarlo, escribe el código actual de tu app autenticadora.</p>
          <div className="flex justify-center">
            <InputOTP maxLength={6} value={codigoBaja} onChange={setCodigoBaja} disabled={ocupado}>
              <InputOTPGroup>{[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
            </InputOTP>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setDesactivando(false); setCodigoBaja("") }} disabled={ocupado}>Cancelar</Button>
            <Button size="sm" variant="destructive" onClick={desactivar} disabled={ocupado || codigoBaja.length !== 6}>
              {ocupado && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Desactivar segundo factor
            </Button>
          </div>
        </div>
      )}

      {!activo && !enrolando && (
        <Button size="sm" className="gap-1.5" onClick={empezar} disabled={ocupado}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Activar segundo factor
        </Button>
      )}

      {enrolando && (
        <div className="space-y-3 rounded-md border p-3">
          <ol className="list-decimal space-y-1 pl-5 text-xs">
            <li>Instala Google Authenticator, Microsoft Authenticator o Authy en tu celular, si no la tienes.</li>
            <li>En la app elige "Escanear código QR" y apunta a este código.</li>
            <li>Escribe aquí el código de 6 dígitos que te muestre, para confirmar.</li>
          </ol>
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrolando.qr} alt="Código QR para la app autenticadora" className="h-44 w-44 rounded-md border bg-white p-1" />
            <p className="text-center text-[11px] text-muted-foreground">
              Si no puedes escanear, ingresa esta clave a mano: <code className="select-all rounded bg-muted px-1 py-0.5 text-[11px]">{enrolando.secreto}</code>
            </p>
          </div>
          <div className="flex justify-center">
            <InputOTP maxLength={6} value={codigo} onChange={setCodigo} disabled={ocupado}>
              <InputOTPGroup>{[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
            </InputOTP>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancelarEnrolamiento} disabled={ocupado}>Cancelar</Button>
            <Button size="sm" onClick={confirmar} disabled={ocupado || codigo.length !== 6}>
              {ocupado ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-2 h-3.5 w-3.5" />} Confirmar y activar
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-critico-fg">{error}</p>}
    </div>
  )
}
