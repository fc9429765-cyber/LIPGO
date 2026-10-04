"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { LogIn, Eye, EyeOff } from "lucide-react"
import Image from "next/image"
import { createBrowserClient } from "@supabase/ssr"
import { VerificarSegundoFactor } from "@/components/seguridad/verificar-segundo-factor"

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  // Segundo factor (solo para quien lo activó en "Mi clave › Seguridad").
  const [pasoCodigo, setPasoCodigo] = useState(false)

  // Tras autenticar: flag del splash y vuelta a la ruta protegida de origen si la hubo.
  const irADestino = () => {
    // Marcamos el flag de "recien iniciado" para que la pagina principal muestre el splash de
    // bienvenida una sola vez tras el login. sessionStorage: se limpia al cerrar la pestaña.
    try {
      sessionStorage.setItem("lipgo:just-logged-in", "1")
    } catch {
      // modo privado restrictivo: seguimos sin splash
    }
    // Si se llegó desde una URL protegida (p. ej. el QR de un montacarga: /login?next=/equipo/abc)
    // se vuelve allá. Solo rutas internas: un `next` con host propio sería un redirect abierto.
    let destino = "/"
    try {
      const next = new URLSearchParams(window.location.search).get("next")
      if (next && next.startsWith("/") && !next.startsWith("//")) destino = next
    } catch {
      // sin querystring utilizable, se va al inicio
    }
    window.location.href = destino
  }

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      console.log("[v0] Attempting client-side login with email:", email)

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        console.error("[v0] Login error:", signInError.message)
        setError(signInError.message || "Credenciales inválidas")
        setLoading(false)
        return
      }

      if (data.user) {
        console.log("[v0] Login successful, user:", data.user.id)
        // Segundo factor: si la cuenta lo tiene activo, la sesión queda en aal1 hasta que el
        // usuario escriba el código de su app autenticadora. Quien no lo activó entra directo.
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
          setPasoCodigo(true)
          setLoading(false)
          return
        }
        irADestino()
      }
    } catch (err) {
      console.error("[v0] Exception during login:", err)
      setError("Error al iniciar sesión. Intente nuevamente.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 flex flex-col items-center">
          <Image src="/lipgo-logo.png" alt="LiPGO" width={200} height={60} className="h-16 w-auto mb-4" priority />
          <CardTitle className="text-2xl font-bold">Iniciar Sesión</CardTitle>
          <CardDescription>Ingresa tus credenciales para acceder al sistema</CardDescription>
        </CardHeader>
        <CardContent>
          {pasoCodigo ? (
            <VerificarSegundoFactor
              onVerificado={irADestino}
              onCancelar={async () => {
                await supabase.auth.signOut()
                setPasoCodigo(false)
                setPassword("")
              }}
            />
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                placeholder="usuario@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="sr-only">{showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}</span>
                </Button>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                "Iniciando sesión..."
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  Iniciar Sesión
                </>
              )}
            </Button>
          </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
