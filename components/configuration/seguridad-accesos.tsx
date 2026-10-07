"use client"

// SEGURIDAD Y ACCESOS — UNA SOLA PANTALLA
//
// Antes eran tres módulos del menú (Gestión de Usuarios, Accesos de Usuario,
// Autorizaciones por clave) que decían cosas distintas de la misma persona, y
// dos sistemas de perfiles que había que crear y asignar por duplicado. Desde
// el 2026-10-07 es una pantalla con tres pestañas y UN perfil:
//
//   · Usuarios: cada persona, su perfil y su ajuste fino.
//   · Perfiles: el puesto --empresas, owners, módulos y procesos que autoriza.
//   · Claves: la clave personal de cada uno, alcance fino, excepciones,
//     correo, transición y bitácora.
//
// Las tres pantallas se mantienen como componentes aparte: cada una tiene su
// propia carga de datos y su propio estado, y pegarlas en un solo archivo las
// volvería imposibles de leer. Este archivo solo las ordena.
//
// Cada pestaña se monta al abrirla y se desmonta al salir: la de Claves carga
// correos y verifica dominios, y pagar eso para quien solo quiere cambiar un
// permiso no tiene sentido.

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { KeyRound, LayoutTemplate, Users } from "lucide-react"
import { UserPermissionsManagement } from "@/components/configuration/user-permissions-management"
import { PerfilesAcceso } from "@/components/configuration/perfiles-acceso"
import AutorizacionesClave from "@/components/configuration/autorizaciones-clave"

export function SeguridadAccesos() {
  const [tab, setTab] = useState("usuarios")

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="grid h-11 w-full max-w-xl grid-cols-3 bg-muted/60 p-1">
            <TabsTrigger value="usuarios" className="gap-1.5 data-[state=active]:shadow-sm">
              <Users className="h-4 w-4" />
              Usuarios
            </TabsTrigger>
            <TabsTrigger value="perfiles" className="gap-1.5 data-[state=active]:shadow-sm">
              <LayoutTemplate className="h-4 w-4" />
              Perfiles
            </TabsTrigger>
            <TabsTrigger value="claves" className="gap-1.5 data-[state=active]:shadow-sm">
              <KeyRound className="h-4 w-4" />
              Claves
            </TabsTrigger>
          </TabsList>
          <p className="text-xs text-muted-foreground">
            {tab === "usuarios"
              ? "A cada persona se le asigna su perfil y se ajusta lo fino."
              : tab === "perfiles"
                ? "El puesto: qué empresas, owners y módulos abre, y qué procesos autoriza."
                : "La clave personal de cada uno: estado, alcance fino, excepciones y bitácora."}
          </p>
        </div>

        <TabsContent value="usuarios" className="mt-4">
          <UserPermissionsManagement />
        </TabsContent>
        <TabsContent value="perfiles" className="mt-4">
          <PerfilesAcceso />
        </TabsContent>
        <TabsContent value="claves" className="mt-4">
          <AutorizacionesClave soloClaves />
        </TabsContent>
      </Tabs>
    </div>
  )
}
