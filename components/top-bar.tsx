"use client"

import { useEffect, useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { User, LogOut, MessageCircle, Building2, KeyRound, Search } from "lucide-react"
import { ColombiaClock } from "./colombia-clock"
import { useAuth } from "@/components/auth-provider"
import { MiClaveAutorizacionDialog } from "@/components/mi-clave-autorizacion"
import { CentroNotificaciones } from "@/components/centro-notificaciones"
import { getAvisoMiClave } from "@/lib/autorizaciones-actions"
import { useRouter } from "next/navigation"
import { useUnreadMessages } from "@/hooks/useUnreadMessages"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function TopBar() {
  const {
    profile,
    signOut,
    loading,
    accessibleEmpresas,
    selectedEmpresaId,
    selectedEmpresaNombre,
    setSelectedEmpresaId,
    loadingEmpresas,
  } = useAuth()
  const router = useRouter()
  const unreadCount = useUnreadMessages(profile?.id)
  // "Mi clave de autorización" (SQL 203): autoservicio de la clave personal.
  const [claveDialogOpen, setClaveDialogOpen] = useState(false)
  // Punto ámbar en el avatar cuando el usuario tiene procesos autorizados pero
  // aún no creó su clave (o tiene una provisional). Se recalcula al cerrar el diálogo.
  const [avisoClave, setAvisoClave] = useState<"sin_clave" | "provisional" | null>(null)
  useEffect(() => {
    if (!profile?.id || claveDialogOpen) return
    let vivo = true
    getAvisoMiClave()
      .then((r) => {
        if (vivo) setAvisoClave(r.motivo)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [profile?.id, claveDialogOpen])

  const handleEmpresaChange = (value: string) => {
    const newId = parseInt(value, 10)
    setSelectedEmpresaId(newId)
  }

  const handleSignOut = async () => {
    await signOut()
    router.push("/login")
  }

  const handleChatClick = () => {
    router.push("/chat")
  }

  const displayText = loading ? "Cargando..." : profile ? null : "LipGo tecnología que mueve tu logística"

  return (
    <div className="border-b border-border bg-card">
      <div className="container mx-auto px-2 sm:px-6 py-2 sm:py-4 max-w-7xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
            <ColombiaClock />
            <span className="text-[10px] sm:text-sm text-muted-foreground">·</span>
            {profile ? (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Empresa Selector */}
                {accessibleEmpresas.length > 1 ? (
                  <div className="flex items-center gap-1">
                    <Building2 className="h-3 w-3 sm:h-4 sm:w-4 text-primary" />
                    <Select
                      value={selectedEmpresaId?.toString() || ""}
                      onValueChange={handleEmpresaChange}
                      disabled={loadingEmpresas}
                    >
                      <SelectTrigger className="h-6 sm:h-7 w-auto min-w-[120px] max-w-[200px] text-[10px] sm:text-xs border-primary/30 bg-primary/5">
                        <SelectValue placeholder="Empresa..." />
                      </SelectTrigger>
                      <SelectContent>
                        {accessibleEmpresas.map((empresa) => (
                          <SelectItem key={empresa.id} value={empresa.id.toString()}>
                            <span className="font-medium">{empresa.id}</span> - {empresa.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <>
                    <span className="text-[10px] sm:text-sm font-bold text-primary">ID: {selectedEmpresaId || profile.empresa_id}</span>
                    <span className="text-[10px] sm:text-sm text-muted-foreground">·</span>
                    <span className="text-[10px] sm:text-sm font-semibold text-foreground">{selectedEmpresaNombre || profile.empresa_nombre}</span>
                  </>
                )}
                <span className="text-[10px] sm:text-sm text-muted-foreground">·</span>
                <span className="text-[10px] sm:text-sm font-medium text-muted-foreground">{profile.usuario}</span>
              </div>
            ) : (
              <span className="text-[10px] sm:text-sm font-medium text-foreground">{displayText}</span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* Buscador global "Buscar o ir a…" (Ctrl/⌘+K). Dispara el evento
                que escucha components/buscador-global.tsx (montado en app/page.tsx). */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("lipgo:open-palette"))}
              className="hidden items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:inline-flex"
              title="Buscar o ir a… (Ctrl+K)"
            >
              <Search className="h-3.5 w-3.5" />
              Buscar o ir a…
              <kbd className="rounded border border-border bg-background px-1 font-sans text-[10px] text-muted-foreground">Ctrl K</kbd>
            </button>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("lipgo:open-palette"))}
              className="rounded-lg p-1 transition-colors hover:bg-accent md:hidden sm:p-2"
              title="Buscar o ir a…"
              aria-label="Buscar o ir a"
            >
              <Search className="h-4 w-4 text-muted-foreground sm:h-5 sm:w-5" />
            </button>
            <button
              onClick={handleChatClick}
              className="relative p-1 sm:p-2 rounded-lg hover:bg-accent transition-colors"
              title="Chat"
            >
              <MessageCircle className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-0 right-0 flex items-center justify-center h-5 w-5 text-xs font-bold text-white bg-red-500 rounded-full">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {/* Una sola campana para todas las alertas (turnos, preoperacional,
                rendimiento, facturas, ciclo de facturación, stock reservado,
                evaluaciones, asistencia, operaciones del día, conteo cíclico y
                ajustes de inventario). Cada alerta conserva su hook, su permiso
                y su ritmo de refresco: ver components/centro-notificaciones.tsx. */}
            {/* `key` por ID: al cambiar el selector global, los 11 hooks de alertas se
                remontan limpios. Sin esto, un hook que al cambiar de empresa no tiene
                permiso o falla se quedaba mostrando las alertas del ID anterior. */}
            {profile && <CentroNotificaciones key={`notif-${selectedEmpresaId ?? "none"}`} empresaId={selectedEmpresaId} userId={profile.id} />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <span className="relative inline-flex" title={avisoClave ? "Crea tu clave de autorización" : "Menú de usuario"}>
                  <Avatar className={`h-7 w-7 sm:h-9 sm:w-9 cursor-pointer border-2 transition-colors ${avisoClave ? "border-amber-500 hover:border-amber-600" : "border-border hover:border-primary"}`}>
                    <AvatarFallback className="bg-muted">
                      <User className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                  {avisoClave && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-amber-500" aria-hidden />}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-base">Información de Sesión</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {profile ? (
                  <div className="px-3 py-3 space-y-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground font-medium">ID de Empresa</div>
                      <div className="text-lg font-bold text-primary">{profile.empresa_id}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground font-medium">Empresa</div>
                      <div className="text-base font-semibold text-foreground">{profile.empresa_nombre}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground font-medium">Usuario</div>
                      <div className="text-base font-medium text-foreground">{profile.usuario}</div>
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {loading ? "Cargando información de sesión..." : "No hay sesión activa"}
                  </div>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setClaveDialogOpen(true)} className={`cursor-pointer ${avisoClave ? "bg-amber-50 font-medium text-amber-900 focus:bg-amber-100" : ""}`}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  {avisoClave === "sin_clave"
                    ? "Crea tu clave de autorización"
                    : avisoClave === "provisional"
                      ? "Define tu clave de autorización (tienes una provisional)"
                      : "Mi clave de autorización"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar Sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <MiClaveAutorizacionDialog open={claveDialogOpen} onOpenChange={setClaveDialogOpen} />
          </div>
        </div>
      </div>
    </div>
  )
}
