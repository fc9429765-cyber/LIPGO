"use client"

/**
 * Candado del grupo "Gestión Financiera" — control ADICIONAL a los permisos
 * granulares de cada submódulo (los permisos ya otorgados en Gestión de
 * Usuarios siguen mandando; esto es una capa más, para que el grupo entero
 * no quede a la vista de cualquiera con acceso a la app).
 *
 * Se pide UNA vez por pestaña del navegador (sessionStorage — se borra al
 * cerrar la pestaña/el navegador) para no interrumpir el trabajo normal
 * dentro del grupo. El servidor revalida la clave real en cada intento
 * (`verificarClaveFinanciera`); esto solo evita repetir el prompt en cada
 * submódulo.
 *
 * NO incluye "Gestión de Facturas" (queda fuera a propósito, solo con sus
 * permisos de siempre — decisión explícita del usuario 2026-08-02).
 */

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Lock, AlertTriangle, Loader2, ShieldCheck } from "lucide-react"
import { verificarClaveFinanciera } from "@/lib/gestion-financiera-clave-actions"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"

const SESSION_KEY = "lipgo_gf_unlocked"

export function ClaveFinancieraGuard({ children }: { children: React.ReactNode }) {
  // null = todavía no se leyó sessionStorage (evita parpadeo del candado).
  const [unlocked, setUnlocked] = useState<boolean | null>(null)
  const [clave, setClave] = useState("")
  const [verificando, setVerificando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setUnlocked(sessionStorage.getItem(SESSION_KEY) === "1")
  }, [])

  const verificar = async () => {
    if (!clave) return
    setVerificando(true)
    setError(null)
    const r = await verificarClaveFinanciera(clave)
    setVerificando(false)
    if (r.success) {
      sessionStorage.setItem(SESSION_KEY, "1")
      setUnlocked(true)
    } else {
      setError(r.message || "Clave incorrecta.")
      setClave("")
    }
  }

  if (unlocked === null) return null
  if (unlocked) return <>{children}</>

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <Card className="w-full max-w-sm border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4" /> Gestión Financiera protegida
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Control adicional para proteger la información financiera de LIP. Ingresa tu clave de autorización (tu
            perfil debe tener el proceso “Entrar a Gestión Financiera”).
          </p>
          <Input
            type="password"
            placeholder="Tu clave de autorización"
            autoComplete="off"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && clave) verificar()
            }}
            autoFocus
          />
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
            </div>
          )}
          <Button onClick={verificar} disabled={!clave || verificando} className="w-full">
            {verificando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Entrar
          </Button>
          <div className="text-center">
            <AyudaClaveAutorizacion />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
