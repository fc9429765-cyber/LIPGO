"use client"

import { useState, useEffect } from "react"
import { Sidebar } from "@/components/sidebar"
import { MainContent } from "@/components/main-content"
import { ErrorBoundary } from "@/components/error-boundary"
import { SplashScreen } from "@/components/splash-screen"
import { LipbotDock } from "@/components/lipbot-dock"
import { groups, type GroupKey } from "@/lib/dashboard-data"
import { useAuth } from "@/components/auth-provider"
import { getAtencionDelDiaCompartida } from "@/lib/atencion-del-dia-cache"
import type { AtencionItem } from "@/components/lip-ai-assistant"
import { useRouter } from "next/navigation"

export default function DashboardPage() {
  const { user, loading, selectedEmpresaId, profile } = useAuth()
  const router = useRouter()
  const [selectedGroup, setSelectedGroup] = useState<GroupKey | null>(null)
  const [selectedModule, setSelectedModule] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Atención del día (por empresa) para el badge del LIPbot flotante.
  const [alertas, setAlertas] = useState<AtencionItem[]>([])
  useEffect(() => {
    if (!selectedEmpresaId) return
    let cancel = false
    getAtencionDelDiaCompartida(profile?.id, selectedEmpresaId ?? undefined)
      .then((r) => {
        if (!cancel && r.success) setAlertas(r.items as AtencionItem[])
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [selectedEmpresaId, profile?.id])

  // Navegación robusta a un módulo (usada por el asistente IA con abrir_modulo).
  // Fija el GRUPO que contiene el módulo además del módulo, porque main-content
  // solo renderiza un módulo si hay un grupo seleccionado. Si no lo encuentra en
  // ningún grupo, cae a un grupo válido para salir del home.
  const navigateToModule = (moduleName: string) => {
    let gk: GroupKey | null = null
    for (const g of groups) {
      const enDirecto = g.modules?.some((m) => m.name === moduleName)
      const enSub = g.subgroups?.some((sg) => sg.modules.some((m) => m.name === moduleName))
      if (enDirecto || enSub) {
        gk = g.key
        break
      }
    }
    setSelectedGroup((prev) => gk ?? prev ?? (groups[0]?.key ?? null))
    setSelectedModule(moduleName)
  }

  // Canal de navegación por EVENTO GLOBAL (para enlaces internos, p. ej. el numeral
  // 3.1.4 de la Matriz 0312 → submódulo «Examenes Médicos», tras validar la clave).
  // El destino conserva su PermissionGuard: si el usuario no tiene el permiso
  // (que se entrega en Gestión de Usuarios), el submódulo no se muestra.
  useEffect(() => {
    const handler = (e: Event) => {
      const name = (e as CustomEvent).detail
      if (typeof name === "string" && name) navigateToModule(name)
    }
    window.addEventListener("lipgo:navigate-module", handler)
    return () => window.removeEventListener("lipgo:navigate-module", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Abrir un MÓDULO PRINCIPAL (grupo de la barra izquierda): muestra su submenú.
  const openGroup = (key: string) => {
    setSelectedGroup(key as GroupKey)
    setSelectedModule(null)
  }
  // Controla si la pantalla de bienvenida debe mostrarse antes del
  // dashboard. Solo se activa una vez por sesion: el login-form deja un
  // flag en `sessionStorage` que aqui leemos y limpiamos. Asi evitamos
  // que el splash aparezca en cada refresh.
  const [showSplash, setShowSplash] = useState(false)

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login")
    }
  }, [user, loading, router])

  useEffect(() => {
    // Leemos el flag solo cuando el usuario ya esta autenticado para
    // garantizar que el splash siempre se muestra DESPUES del login,
    // nunca antes (durante la fase de carga inicial podria aun no
    // haberse hidratado el AuthProvider).
    if (!user) return
    try {
      const flag = sessionStorage.getItem("lipgo:just-logged-in")
      if (flag === "1") {
        sessionStorage.removeItem("lipgo:just-logged-in")
        setShowSplash(true)
      }
    } catch {
      // sessionStorage no disponible — saltamos el splash silenciosa-
      // mente.
    }
  }, [user])

  if (loading) {
    // Reemplazamos el antiguo spinner "Cargando..." por la misma
    // pantalla de bienvenida que se usa post-login. Asi cualquier
    // estado de hidratacion del AuthProvider muestra una experiencia
    // unificada y de marca, en lugar de un spinner generico.
    //
    // Pasamos `onComplete` como no-op porque la transicion la gobierna
    // el flag `loading`: en cuanto el AuthProvider termina de cargar,
    // este componente vuelve a renderizar y el splash se desmonta.
    return <SplashScreen onComplete={() => {}} />
  }

  if (!user) {
    return null
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Pantalla de bienvenida tras login. Se monta encima del
          dashboard con z-index alto y se desmonta sola al terminar la
          animacion (~3s). */}
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}

      {/* Sidebar */}
      <Sidebar
        selectedGroup={selectedGroup}
        selectedModule={selectedModule}
        onSelectGroup={(group) => {
          setSelectedGroup(group)
          setSelectedModule(null)
        }}
        onSelectModule={setSelectedModule}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main Content — el ErrorBoundary evita que un error de render en un
          módulo (p. ej. al desbloquear una clave y montar contenido por
          primera vez) se lleve puesto TODO el árbol, sidebar incluido (ver
          components/error-boundary.tsx). El `key` remonta el boundary limpio
          cada vez que cambia el módulo/grupo seleccionado, así que navegar
          fuera de un módulo roto lo recupera solo. */}
      <ErrorBoundary key={`${selectedGroup ?? ""}|${selectedModule ?? ""}`}>
        <MainContent
          selectedGroup={selectedGroup}
          selectedModule={selectedModule}
          onSelectModule={setSelectedModule}
          onNavigateModule={navigateToModule}
          onOpenGroup={openGroup}
          onBack={() => {
            if (selectedModule) {
              setSelectedModule(null)
            } else {
              setSelectedGroup(null)
            }
          }}
          onSelectGroup={setSelectedGroup}
          sidebarCollapsed={sidebarCollapsed}
        />
      </ErrorBoundary>

      {/* LIPbot flotante — en submenús y módulos. En el INICIO no se muestra
          porque ahí LIPbot es el HÉROE (protagonista, embebido arriba), así que
          nunca hay dos superficies del asistente a la vez. Tampoco dentro del
          Asistente a pantalla completa. Consciente del módulo/área actual. */}
      {selectedModule !== "Asistente IA" && (selectedGroup || selectedModule) && (
        <LipbotDock
          contextLabel={
            selectedModule ??
            (selectedGroup ? groups.find((g) => g.key === selectedGroup)?.title : "Inicio")
          }
          groupKey={selectedGroup ?? undefined}
          alertas={alertas}
          onNavigate={navigateToModule}
          onOpenGroup={openGroup}
        />
      )}

      {/* Background Watermark */}
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-0">
        <img
          src="/images/design-mode/LipGoBG(1).png"
          alt=""
          className="w-[300px] h-[300px] sm:w-[500px] sm:h-[500px] lg:w-[800px] lg:h-[800px] object-contain opacity-[0.05]"
        />
      </div>
    </div>
  )
}
