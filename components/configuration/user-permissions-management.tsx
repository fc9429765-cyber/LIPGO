"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getAllUsersWithPermissions, updateUserPermissions } from "@/lib/permissions-actions"
import { crearUsuario, resetearPassword, eliminarUsuario, getAuthMetaUsuarios } from "@/lib/user-admin-actions"
import type { AuthMetaUsuario } from "@/lib/user-admin-types"
import {
  getAllEmpresas,
  getAllOwners,
  getUserAccess,
  grantUserAccess,
  revokeUserAccess,
  getUserOwnerAccess,
  grantUserOwnerAccess,
  revokeUserOwnerAccess,
} from "@/lib/user-access-actions"
import type { Empresa, Owner } from "@/lib/user-access-tipos"
// El tipo `UserPermissions` se importa desde el modulo compartido (sin
// "use server"): Next.js no permite exportar valores no async desde archivos
// con la directiva "use server".
import type { UserPermissions } from "@/lib/permissions-map"
import { PROCESOS } from "@/lib/mapa-procesos-tipos"
import { getProcesosDeUsuario, guardarProcesosDeUsuario } from "@/lib/permisos-mapa-actions"
import { PERMISSION_TREE, clavesDeItem, filtrarArbol, type PermGroup, type PermItem } from "@/lib/permisos-arbol"
import { ChipsAcciones, accionesDeLlave } from "@/components/configuration/chips-acciones"
import { esClaveAccion } from "@/lib/permisos-verbos"
import {
  listarPerfilesAcceso,
  getPerfilesDeUsuario,
  asignarPerfilesUsuario,
  getAccesoMaterializadoUsuario,
} from "@/lib/acceso-perfiles-actions"
import type { PerfilAcceso } from "@/lib/acceso-perfiles-tipos"
import {
  Loader2,
  Save,
  User,
  UserPlus,
  KeyRound,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Search,
  Building2,
  Tags,
  Copy,
  ShieldCheck,
  Users,
  Clock,
  CheckCircle2,
  ArrowRight,
  LayoutTemplate,
  Check,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { useClaveAccion } from "@/components/clave-accion-provider"

interface UserWithPermissions {
  id: string
  usuario: string
  empresa_id: number
  permisos_usuarios: UserPermissions | UserPermissions[] | null
}

// El árbol de permisos vive en lib/permisos-arbol.ts: lo dibujan esta
// pantalla y Perfiles de acceso, y un árbol duplicado se desincroniza en
// silencio. Se deriva del menú real (`groups`) con MODULE_PERMISSION_MAP.

// Genera una contraseña segura (14 caracteres, sin caracteres ambiguos) con el CSPRNG.
function generarPasswordSegura(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*"
  const n = 14
  const arr = new Uint32Array(n)
  window.crypto.getRandomValues(arr)
  let out = ""
  for (let i = 0; i < n; i++) out += chars[arr[i] % chars.length]
  return out
}

// inactivo = >30 dias sin iniciar sesion (o nunca).
function estadoConexion(meta?: AuthMetaUsuario): { activo: boolean; relativo: string; exacto: string | null } {
  const raw = meta?.last_sign_in_at
  if (!raw) return { activo: false, relativo: "Nunca", exacto: null }
  const last = new Date(raw)
  const dias = Math.floor((Date.now() - last.getTime()) / 86400000)
  const exacto = last.toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
  const relativo = dias <= 0 ? "Hoy" : dias === 1 ? "Ayer" : `Hace ${dias} días`
  return { activo: dias <= 30, relativo, exacto }
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return "?"
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

// Marca lo que un perfil puso en el usuario. Sin ella no se distingue lo que
// vino del perfil de lo marcado a mano, y desmarcar algo del perfil "no hace
// nada" (el proximo recalculo lo devuelve) sin que se entienda por que.
function TagPerfil() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-px align-middle text-[9px] font-semibold uppercase tracking-wide text-primary">
      <LayoutTemplate className="h-2.5 w-2.5" />
      perfil
    </span>
  )
}

function extraerPermisos(u: UserWithPermissions): UserPermissions | undefined {
  if (Array.isArray(u.permisos_usuarios)) return u.permisos_usuarios[0]
  return u.permisos_usuarios ?? undefined
}

function permsDeUsuario(u: UserWithPermissions): Partial<UserPermissions> {
  const src = extraerPermisos(u)
  const out: Partial<UserPermissions> = {}
  PERMISSION_TREE.forEach((g) =>
    g.sections.forEach((s) =>
      s.permissions.forEach((p) => {
        for (const k of clavesDeItem(p, true)) {
          // Una acción cuya columna aún no existe en la base (SQL 262 sin
          // correr) llega como undefined: se muestra apagada, pero el servidor
          // la trata como permitida hasta que la columna exista.
          ;(out as any)[k] = (src as any)?.[k] === true
        }
      }),
    ),
  )
  return out
}

export function UserPermissionsManagement() {
  const { selectedEmpresaId, user } = useAuth()
  const { conClave } = useClaveAccion()
  const { toast } = useToast()

  const [users, setUsers] = useState<UserWithPermissions[]>([])
  const [authMeta, setAuthMeta] = useState<Record<string, AuthMetaUsuario>>({})
  const [selectedUser, setSelectedUser] = useState<UserWithPermissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  // Catálogos (empresas / owners)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [owners, setOwners] = useState<Owner[]>([])

  // Permisos (copia de trabajo + snapshot original para detectar cambios)
  const [permissions, setPermissions] = useState<Partial<UserPermissions>>({})
  const [permOriginal, setPermOriginal] = useState<Partial<UserPermissions>>({})
  const [permSearch, setPermSearch] = useState("")
  const [openGroups, setOpenGroups] = useState<string[]>([])
  const [copyFromId, setCopyFromId] = useState<string>("")
  const [savingPerms, setSavingPerms] = useState(false)

  // Accesos (empresa / owner) del usuario seleccionado
  const [empresaAccess, setEmpresaAccess] = useState<number[]>([])
  const [empresaOriginal, setEmpresaOriginal] = useState<number[]>([])
  const [ownerAccess, setOwnerAccess] = useState<string[]>([])
  const [ownerOriginal, setOwnerOriginal] = useState<string[]>([])
  const [loadingAccess, setLoadingAccess] = useState(false)
  const [savingAccess, setSavingAccess] = useState(false)

  // Perfiles de acceso (las plantillas) y los que tiene el usuario seleccionado
  const [perfilesCatalogo, setPerfilesCatalogo] = useState<PerfilAcceso[]>([])
  const [faltaScriptPerfiles, setFaltaScriptPerfiles] = useState(false)
  const [perfilesUsuario, setPerfilesUsuario] = useState<number[]>([])
  const [perfilesOriginal, setPerfilesOriginal] = useState<number[]>([])
  const [savingPerfiles, setSavingPerfiles] = useState(false)
  // Qué parte del acceso de la persona vino de perfiles (para marcarlo en pantalla)
  const [matUsuario, setMatUsuario] = useState<{ empresas: number[]; owners: string[]; permisos: string[] }>({
    empresas: [],
    owners: [],
    permisos: [],
  })

  // Crear usuario
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [form, setForm] = useState({
    email: "",
    usuario: "",
    password: "",
    empresaId: "" as string,
    empresasAdicionales: [] as number[],
    owners: [] as string[],
  })

  // Resetear contraseña
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPwd, setResetPwd] = useState("")
  const [showResetPwd, setShowResetPwd] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Eliminar
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (selectedEmpresaId) {
      loadAll()
      setSelectedUser(null)
      setPermissions({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const loadAll = async () => {
    setLoading(true)
    const [result, meta, emp, own, perf] = await Promise.all([
      getAllUsersWithPermissions(selectedEmpresaId),
      getAuthMetaUsuarios(),
      empresas.length ? Promise.resolve(empresas) : getAllEmpresas(),
      owners.length ? Promise.resolve(owners) : getAllOwners(),
      listarPerfilesAcceso(),
    ])
    if (result.success && result.data) setUsers(result.data as UserWithPermissions[])
    if (meta.success && meta.data) setAuthMeta(meta.data)
    setEmpresas(emp)
    setOwners(own)
    setPerfilesCatalogo(perf.data)
    setFaltaScriptPerfiles(!!perf.faltaMigracion)
    setLoading(false)
  }

  // Procesos del Mapa de Procesos. Van aparte de `permissions` porque no son
  // columnas de `permisos_usuarios` sino filas de `permisos_mapa_procesos`.
  const [procesos, setProcesos] = useState<string[]>([])
  const [procesosOriginal, setProcesosOriginal] = useState<string[]>([])
  const [faltaScriptMapa, setFaltaScriptMapa] = useState(false)

  const handleSelectUser = async (u: UserWithPermissions) => {
    setSelectedUser(u)
    setPermSearch("")
    setOpenGroups([])
    setCopyFromId("")
    const p = permsDeUsuario(u)
    setPermissions(p)
    setPermOriginal(p)

    // Accesos
    setLoadingAccess(true)
    const [emp, own, proc, perf, mat] = await Promise.all([
      getUserAccess(u.id),
      getUserOwnerAccess(u.id),
      getProcesosDeUsuario(u.id),
      getPerfilesDeUsuario(u.id),
      getAccesoMaterializadoUsuario(u.id),
    ])
    setEmpresaAccess(emp)
    setEmpresaOriginal(emp)
    setOwnerAccess(own)
    setOwnerOriginal(own)
    setProcesos(proc.procesos)
    setProcesosOriginal(proc.procesos)
    setFaltaScriptMapa(!!proc.faltaMigracion)
    setPerfilesUsuario(perf)
    setPerfilesOriginal(perf)
    setMatUsuario(mat)
    setLoadingAccess(false)
  }

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.usuario.toLowerCase().includes(q) || (authMeta[u.id]?.email ?? "").toLowerCase().includes(q),
    )
  }, [users, search, authMeta])

  const stats = useMemo(() => {
    let activos = 0
    let nunca = 0
    users.forEach((u) => {
      const e = estadoConexion(authMeta[u.id])
      if (e.activo) activos++
      if (!authMeta[u.id]?.last_sign_in_at) nunca++
    })
    return { total: users.length, activos, inactivos: users.length - activos, nunca }
  }, [users, authMeta])

  const filteredTree = useMemo(() => filtrarArbol(permSearch), [permSearch])

  // Al buscar, expandimos automáticamente los grupos con coincidencias.
  useEffect(() => {
    if (permSearch.trim()) setOpenGroups(filteredTree.map((g) => g.title))
  }, [permSearch, filteredTree])

  const permsDirty = useMemo(() => {
    const keys = new Set([...Object.keys(permissions), ...Object.keys(permOriginal)])
    for (const k of keys) if ((permissions as any)[k] !== (permOriginal as any)[k]) return true
    // Los procesos del mapa se guardan con el mismo botón, así que también
    // cuentan como cambio pendiente.
    if (procesos.length !== procesosOriginal.length) return true
    if (procesos.some((p) => !procesosOriginal.includes(p))) return true
    return false
  }, [permissions, permOriginal, procesos, procesosOriginal])

  const accessDirty = useMemo(() => {
    const eqSet = (a: (string | number)[], b: (string | number)[]) =>
      a.length === b.length && a.every((x) => b.includes(x))
    return !eqSet(empresaAccess, empresaOriginal) || !eqSet(ownerAccess, ownerOriginal)
  }, [empresaAccess, empresaOriginal, ownerAccess, ownerOriginal])

  const perfilesDirty = useMemo(
    () =>
      perfilesUsuario.length !== perfilesOriginal.length ||
      perfilesUsuario.some((id) => !perfilesOriginal.includes(id)),
    [perfilesUsuario, perfilesOriginal],
  )

  const groupCount = (g: PermGroup) => {
    let total = 0
    let active = 0
    g.sections.forEach((s) =>
      s.permissions.forEach((p) => {
        total++
        if (permissions[p.key]) active++
      }),
    )
    return { total, active }
  }

  // Cuenta módulos; las acciones (`<llave>__<verbo>`) van aparte.
  const totalActivos = useMemo(
    () => Object.entries(permissions).filter(([k, v]) => v && !esClaveAccion(k)).length,
    [permissions],
  )

  // Claves marcadas (módulos y acciones), para los chips.
  const marcados = useMemo(
    () => new Set(Object.entries(permissions).filter(([, v]) => v === true).map(([k]) => k)),
    [permissions],
  )

  // Marcar un módulo enciende todas sus acciones (nadie pierde nada); quitarlo las apaga.
  const handlePermissionChange = (key: string, checked: boolean) =>
    setPermissions((prev) => {
      const next: Partial<UserPermissions> = { ...prev, [key]: checked }
      if (!esClaveAccion(key)) for (const a of accionesDeLlave(key)) (next as any)[a] = checked
      return next
    })

  const handleSelectAll = (items: PermItem[], checked: boolean) => {
    const updates: Partial<UserPermissions> = {}
    items.forEach((p) => {
      for (const k of clavesDeItem(p, true)) (updates as any)[k] = checked
    })
    setPermissions((prev) => ({ ...prev, ...updates }))
  }

  const handleGlobalAll = (checked: boolean) => {
    const updates: Partial<UserPermissions> = {}
    PERMISSION_TREE.forEach((g) =>
      g.sections.forEach((s) => s.permissions.forEach((p) => clavesDeItem(p, true).forEach((k) => ((updates as any)[k] = checked)))),
    )
    setPermissions(updates)
  }

  const handleCopyFrom = (sourceId: string) => {
    setCopyFromId(sourceId)
    const src = users.find((u) => u.id === sourceId)
    if (!src) return
    setPermissions(permsDeUsuario(src))
    toast({
      title: "Permisos copiados",
      description: `Se cargaron los permisos de ${src.usuario}. Revisa y presiona Guardar para aplicarlos.`,
    })
  }

  const handleSavePerms = async () => {
    if (!selectedUser) return
    setSavingPerms(true)
    const [result, resProc] = await Promise.all([
      updateUserPermissions(selectedUser.id, permissions),
      guardarProcesosDeUsuario(selectedUser.id, procesos),
    ])
    setSavingPerms(false)

    // Se avisa aparte: los permisos de módulo pueden haberse guardado bien y
    // los del mapa no. Un solo "listo" escondería la mitad que falló.
    if (!resProc.success) {
      toast({
        title: "Los procesos del mapa no se guardaron",
        description: resProc.message,
        variant: "destructive",
      })
    } else {
      setProcesosOriginal(procesos)
    }

    if (result.success) {
      toast({ title: "Permisos guardados", description: "Los cambios se aplicaron correctamente." })
      setPermOriginal(permissions)
      // Reflejar en la lista sin recargar todo.
      setUsers((prev) =>
        prev.map((u) => (u.id === selectedUser.id ? { ...u, permisos_usuarios: permissions as UserPermissions } : u)),
      )
    } else {
      toast({ title: "Error", description: result.error || "No se pudieron guardar los permisos.", variant: "destructive" })
    }
  }

  const handleSaveAccess = async () => {
    if (!selectedUser) return
    setSavingAccess(true)
    const id = selectedUser.id
    try {
      const empGrant = empresaAccess.filter((e) => !empresaOriginal.includes(e))
      const empRevoke = empresaOriginal.filter((e) => !empresaAccess.includes(e))
      const ownGrant = ownerAccess.filter((o) => !ownerOriginal.includes(o))
      const ownRevoke = ownerOriginal.filter((o) => !ownerAccess.includes(o))

      for (const e of empGrant) await grantUserAccess(id, e)
      for (const e of empRevoke) await revokeUserAccess(id, e)
      for (const o of ownGrant) await grantUserOwnerAccess(id, o)
      for (const o of ownRevoke) await revokeUserOwnerAccess(id, o)

      setEmpresaOriginal(empresaAccess)
      setOwnerOriginal(ownerAccess)
      toast({ title: "Accesos guardados", description: "Los accesos por empresa y owner se actualizaron." })
    } catch (error) {
      console.error("[user-admin] Error guardando accesos:", error)
      toast({ title: "Error", description: "No se pudieron guardar todos los accesos.", variant: "destructive" })
    } finally {
      setSavingAccess(false)
    }
  }

  /*
   * Aplica los perfiles marcados. El servidor recalcula y ESCRIBE empresas,
   * owners y módulos del usuario, así que después hay que volver a leer las
   * tres cosas: lo que se ve en las otras pestañas acaba de cambiar.
   */
  const handleSavePerfiles = async () => {
    if (!selectedUser) return
    setSavingPerfiles(true)
    const r = await asignarPerfilesUsuario(selectedUser.id, perfilesUsuario)
    setSavingPerfiles(false)
    if (!r.success) {
      toast({ title: "No se pudieron aplicar los perfiles", description: r.message, variant: "destructive" })
      return
    }
    setPerfilesOriginal(perfilesUsuario)
    const c = r.cambios
    toast({
      title: "Perfiles aplicados",
      description: c
        ? `Empresas +${c.empresas.agregadas} / -${c.empresas.retiradas} · Owners +${c.owners.agregadas} / -${c.owners.retiradas} · Módulos +${c.permisos.agregados} / -${c.permisos.retirados}`
        : undefined,
    })
    const [emp, own, result, perf, mat] = await Promise.all([
      getUserAccess(selectedUser.id),
      getUserOwnerAccess(selectedUser.id),
      getAllUsersWithPermissions(selectedEmpresaId),
      listarPerfilesAcceso(),
      getAccesoMaterializadoUsuario(selectedUser.id),
    ])
    setEmpresaAccess(emp)
    setEmpresaOriginal(emp)
    setOwnerAccess(own)
    setOwnerOriginal(own)
    setPerfilesCatalogo(perf.data)
    setMatUsuario(mat)
    if (result.success && result.data) {
      const lista = result.data as UserWithPermissions[]
      setUsers(lista)
      const fresco = lista.find((x) => x.id === selectedUser.id)
      if (fresco) {
        setSelectedUser(fresco)
        const p = permsDeUsuario(fresco)
        setPermissions(p)
        setPermOriginal(p)
      }
    }
  }

  // ----- Crear usuario -----
  const openCreate = () => {
    setForm({
      email: "",
      usuario: "",
      password: "",
      empresaId: selectedEmpresaId ? String(selectedEmpresaId) : "",
      empresasAdicionales: [],
      owners: [],
    })
    setShowPwd(false)
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    if (!form.email.trim() || !form.usuario.trim() || !form.password || !form.empresaId) {
      toast({ title: "Datos incompletos", description: "Correo, usuario, contraseña y empresa son obligatorios.", variant: "destructive" })
      return
    }
    if (form.password.length < 8) {
      toast({ title: "Contraseña muy corta", description: "Usa al menos 8 caracteres.", variant: "destructive" })
      return
    }
    setCreating(true)
    const result = await crearUsuario({
      email: form.email,
      usuario: form.usuario,
      password: form.password,
      empresaId: Number(form.empresaId),
      empresasAdicionales: form.empresasAdicionales,
      owners: form.owners,
    })
    setCreating(false)
    if (result.success) {
      toast({ title: "Usuario creado", description: `${form.usuario} puede iniciar sesión con su correo (ya validado).` })
      setCreateOpen(false)
      const [refreshed, meta] = await Promise.all([getAllUsersWithPermissions(selectedEmpresaId), getAuthMetaUsuarios()])
      const list = (refreshed.data as UserWithPermissions[]) || []
      setUsers(list)
      if (meta.success && meta.data) setAuthMeta(meta.data)
      const nuevo = list.find((u) => u.id === result.userId)
      if (nuevo) handleSelectUser(nuevo)
    } else {
      toast({ title: "No se pudo crear", description: result.error || "Error desconocido.", variant: "destructive" })
    }
  }

  const handleReset = async () => {
    if (!selectedUser) return
    if (resetPwd.length < 8) {
      toast({ title: "Contraseña muy corta", description: "Usa al menos 8 caracteres.", variant: "destructive" })
      return
    }
    setResetting(true)
    const result = await resetearPassword(selectedUser.id, resetPwd)
    setResetting(false)
    if (result.success) {
      toast({ title: "Contraseña actualizada", description: `Comunícale la nueva contraseña a ${selectedUser.usuario}.` })
      setResetOpen(false)
      setResetPwd("")
    } else {
      toast({ title: "Error", description: result.error || "No se pudo cambiar la contraseña.", variant: "destructive" })
    }
  }

  const handleDelete = async () => {
    if (!selectedUser) return
    setDeleting(true)
    const result = await conClave("Gestión de Usuarios", "eliminar", (clave) => eliminarUsuario(selectedUser.id, clave))
    setDeleting(false)
    if (result.success) {
      toast({ title: "Usuario eliminado", description: `${selectedUser.usuario} fue eliminado del sistema.` })
      setDeleteOpen(false)
      setSelectedUser(null)
      setPermissions({})
      await loadAll()
    } else {
      toast({ title: "Error", description: result.error || "No se pudo eliminar el usuario.", variant: "destructive" })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const isSelf = !!selectedUser && selectedUser.id === user?.id
  const estadoSel = estadoConexion(selectedUser ? authMeta[selectedUser.id] : undefined)
  const emailSel = selectedUser ? authMeta[selectedUser.id]?.email : null

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        {/* ---------- Hero ---------- */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
          <div className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md">
                <Users className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">Usuarios y Accesos</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Crea usuarios, asigna permisos y otorga acceso por empresa y owner — todo en un solo lugar.
                </p>
              </div>
            </div>
            <Button onClick={openCreate} size="lg" className="gap-2 shadow-md">
              <UserPlus className="h-4 w-4" />
              Crear Usuario
            </Button>
          </div>
          <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/60 border-t border-border/60">
            {[
              { label: "Usuarios", value: stats.total, icon: Users, tone: "text-primary" },
              { label: "Activos", value: stats.activos, icon: CheckCircle2, tone: "text-emerald-600" },
              { label: "Inactivos", value: stats.inactivos, icon: Clock, tone: "text-slate-500" },
              { label: "Sin conexión", value: stats.nunca, icon: User, tone: "text-amber-600" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2.5 bg-card px-4 py-3">
                <s.icon className={`h-4 w-4 ${s.tone}`} />
                <div className="leading-none">
                  <p className="text-xl font-bold tabular-nums text-foreground">{s.value}</p>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ---------- Maestro: lista de usuarios ---------- */}
          <Card className="ulist-card lg:col-span-1 overflow-hidden border-border/60 shadow-md bg-gradient-to-br from-card to-muted/20">
            <style>{`
              .ulist-row{ position:relative; display:flex; align-items:center; gap:12px; width:100%; text-align:left;
                cursor:pointer; border-radius:14px; border:1px solid transparent; background:var(--card); padding:10px;
                overflow:hidden; transition:transform .18s ease, box-shadow .2s ease, border-color .2s ease, background .2s ease; }
              /* Halo de color que aflora en hover */
              .ulist-row::after{ content:""; position:absolute; top:-55%; right:-25%; width:130px; height:130px; border-radius:50%;
                background:radial-gradient(closest-side, color-mix(in srgb, var(--primary) 30%, transparent), transparent);
                opacity:0; transition:opacity .25s, transform .25s; pointer-events:none; }
              /* Hairline degradado que se ilumina en hover / activo */
              .ulist-row::before{ content:""; position:absolute; inset:0; border-radius:14px; padding:1.3px; pointer-events:none;
                background:linear-gradient(135deg, color-mix(in srgb, var(--primary) 75%, transparent), transparent 60%);
                -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                -webkit-mask-composite:xor; mask-composite:exclude; opacity:0; transition:opacity .2s; }
              .ulist-row:hover{ transform:translateY(-2px); border-color:transparent;
                box-shadow:0 14px 30px color-mix(in srgb, var(--primary) 24%, transparent), 0 4px 10px rgba(20,42,68,.05); }
              .ulist-row:hover::before{ opacity:1; }
              .ulist-row:hover::after{ opacity:.75; transform:scale(1.12); }
              .ulist-row.is-active{ background:color-mix(in srgb, var(--primary) 10%, var(--card));
                box-shadow:0 8px 22px color-mix(in srgb, var(--primary) 20%, transparent); }
              .ulist-row.is-active::before{ opacity:1; }
              .ulist-row.is-active::after{ opacity:.5; }
              .ulist-ava{ position:relative; z-index:1; transition:transform .2s, box-shadow .2s; }
              .ulist-row:hover .ulist-ava{ transform:scale(1.08) rotate(-3deg); }
              .ulist-enter{ display:inline-flex; align-items:center; gap:2px; font-size:10.5px; font-weight:800; color:var(--primary);
                opacity:0; transform:translateX(-6px); transition:opacity .2s, transform .2s; white-space:nowrap; }
              .ulist-row:hover .ulist-enter{ opacity:1; transform:none; }
              .ulist-row.is-active .ulist-enter{ opacity:1; transform:none; }
              @media (prefers-reduced-motion:reduce){ .ulist-row, .ulist-row *{ transition:none !important } .ulist-row:hover{ transform:none } }
            `}</style>
            <CardHeader className="pb-3 bg-gradient-to-r from-primary/10 via-muted/40 to-transparent border-b border-border/60">
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
                    <Users className="h-3.5 w-3.5" />
                  </span>
                  Usuarios
                </span>
                <Badge className="bg-primary/15 text-primary hover:bg-primary/15 border-0 h-5 px-1.5 text-[11px] tabular-nums">
                  {filteredUsers.length}
                </Badge>
              </CardTitle>
              <div className="relative mt-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre o correo…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 bg-card focus-visible:ring-primary/40"
                />
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="space-y-2 max-h-[620px] overflow-y-auto px-0.5 -mx-0.5 py-0.5">
                {filteredUsers.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <Search className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">Sin usuarios que coincidan.</p>
                  </div>
                )}
                {filteredUsers.map((u) => {
                  const estado = estadoConexion(authMeta[u.id])
                  const email = authMeta[u.id]?.email
                  const active = selectedUser?.id === u.id
                  return (
                    <button
                      key={u.id}
                      onClick={() => handleSelectUser(u)}
                      className={`ulist-row ${active ? "is-active" : ""}`}
                    >
                      <Avatar className="ulist-ava h-10 w-10 flex-shrink-0 ring-2 ring-primary/25 shadow-sm">
                        <AvatarFallback className="bg-gradient-to-br from-primary to-primary/55 text-primary-foreground text-xs font-bold">
                          {iniciales(u.usuario)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="relative z-[1] flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate text-foreground">{u.usuario}</p>
                        {email && <p className="text-xs text-muted-foreground truncate">{email}</p>}
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {estado.relativo}
                        </p>
                      </div>
                      <div className="relative z-[1] flex flex-col items-end gap-1 flex-shrink-0">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                            estado.activo
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-50 text-slate-500 border-slate-200"
                          }`}
                          title={estado.activo ? "Activo" : "Inactivo (>30 días sin conexión)"}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${estado.activo ? "bg-emerald-500" : "bg-slate-400"}`} />
                          {estado.activo ? "Activo" : "Inactivo"}
                        </span>
                        <span className="ulist-enter">
                          Editar <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* ---------- Detalle: perfil + permisos + accesos ---------- */}
          <Card className="lg:col-span-2 overflow-hidden border-border/60 shadow-md bg-gradient-to-br from-card to-muted/20">
            {selectedUser ? (
              <>
                <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-r from-primary/10 via-card to-card p-5">
                  <div className="pointer-events-none absolute -top-12 right-8 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
                  <div className="relative flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5">
                      <Avatar className="h-14 w-14 ring-2 ring-primary/30 shadow-sm">
                        <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-lg font-bold">
                          {iniciales(selectedUser.usuario)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="text-xl font-bold leading-tight text-foreground">{selectedUser.usuario}</h3>
                        <p className="text-sm text-muted-foreground">{emailSel ?? "Sin correo"}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                              estadoSel.activo
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-slate-50 text-slate-500 border-slate-200"
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${estadoSel.activo ? "bg-emerald-500" : "bg-slate-400"}`} />
                            {estadoSel.activo ? "Activo" : "Inactivo"}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={estadoSel.exacto ?? undefined}>
                            <Clock className="h-3 w-3" />
                            {estadoSel.relativo}
                          </span>
                        </div>
                        {perfilesUsuario.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {perfilesUsuario.map((id) => {
                              const p = perfilesCatalogo.find((x) => x.id === id)
                              return p ? (
                                <span
                                  key={id}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                    p.activo
                                      ? "border-primary/30 bg-primary/10 text-primary"
                                      : "border-border bg-muted text-muted-foreground line-through"
                                  }`}
                                >
                                  <LayoutTemplate className="h-3 w-3" />
                                  {p.nombre}
                                </span>
                              ) : null
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 bg-card"
                        onClick={() => {
                          setResetPwd("")
                          setShowResetPwd(false)
                          setResetOpen(true)
                        }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        Contraseña
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 bg-card text-destructive hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40"
                        disabled={isSelf}
                        title={isSelf ? "No puedes eliminar tu propio usuario" : undefined}
                        onClick={() => setDeleteOpen(true)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Eliminar
                      </Button>
                    </div>
                  </div>
                </div>

                <CardContent className="pt-5">
                  {/* PERFIL va primero y por defecto: es la forma principal de
                      configurar a una persona. Modulos y Empresas quedan como
                      ajuste fino, y cada casilla que venga de un perfil lo dice. */}
                  <Tabs defaultValue="perfil" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 h-11 p-1 bg-muted/60">
                      <TabsTrigger value="perfil" className="gap-1.5 data-[state=active]:shadow-sm">
                        <LayoutTemplate className="h-4 w-4" />
                        Perfil
                        <Badge className="ml-1 h-5 px-1.5 text-[11px] bg-primary/15 text-primary hover:bg-primary/15 border-0">
                          {perfilesUsuario.length}
                        </Badge>
                      </TabsTrigger>
                      <TabsTrigger value="permisos" className="gap-1.5 data-[state=active]:shadow-sm">
                        <ShieldCheck className="h-4 w-4" />
                        Módulos
                        <Badge className="ml-1 h-5 px-1.5 text-[11px] bg-primary/15 text-primary hover:bg-primary/15 border-0">
                          {totalActivos}
                        </Badge>
                      </TabsTrigger>
                      <TabsTrigger value="accesos" className="gap-1.5 data-[state=active]:shadow-sm">
                        <Building2 className="h-4 w-4" />
                        <span className="hidden sm:inline">Empresas y owners</span>
                        <span className="sm:hidden">Empresas</span>
                        <Badge className="ml-1 h-5 px-1.5 text-[11px] bg-primary/15 text-primary hover:bg-primary/15 border-0">
                          {empresaAccess.length + ownerAccess.length}
                        </Badge>
                      </TabsTrigger>
                    </TabsList>

                    {/* ===== Perfil ===== */}
                    <TabsContent value="perfil" className="mt-4 space-y-4">
                      {loadingAccess ? (
                        <div className="flex items-center justify-center h-40">
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                      ) : (
                        <>
                          {/* Lo que esta persona tiene HOY, venga de donde venga. Va
                              primero porque es la pregunta que trae a quien abre esto. */}
                          <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-card to-muted/20 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Acceso efectivo hoy
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  Lo que {selectedUser.usuario} puede ver y abrir, venga de un perfil o esté marcado a mano.
                                </p>
                              </div>
                              {matUsuario.empresas.length + matUsuario.owners.length + matUsuario.permisos.length > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                  <LayoutTemplate className="h-3 w-3" />
                                  {matUsuario.empresas.length + matUsuario.owners.length + matUsuario.permisos.length} vienen de perfiles
                                </span>
                              )}
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              {[
                                { icon: Building2, label: "Empresas", total: empresaOriginal.length, perfil: matUsuario.empresas.length },
                                { icon: Tags, label: "Owners", total: ownerOriginal.length, perfil: matUsuario.owners.length },
                                {
                                  icon: ShieldCheck,
                                  label: "Módulos",
                                  total: Object.values(permOriginal).filter(Boolean).length,
                                  perfil: matUsuario.permisos.length,
                                },
                              ].map((st) => (
                                <div key={st.label} className="rounded-xl border border-border/60 bg-card p-2.5">
                                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                    <st.icon className="h-3.5 w-3.5 text-primary" />
                                    {st.label}
                                  </div>
                                  <p className="mt-1 text-xl font-bold leading-none tabular-nums">{st.total}</p>
                                  <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                                    {st.perfil > 0 ? `${st.perfil} por perfil · ${st.total - st.perfil} a mano` : "todo a mano"}
                                  </p>
                                </div>
                              ))}
                            </div>
                            {(empresaOriginal.length > 0 || ownerOriginal.length > 0) && (
                              <div className="mt-3 flex flex-wrap gap-1">
                                {empresaOriginal.map((id) => (
                                  <span
                                    key={`e${id}`}
                                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px]"
                                  >
                                    <Building2 className="h-3 w-3 text-muted-foreground" />
                                    {empresas.find((e) => e.id === id)?.nombre ?? `Empresa ${id}`}
                                    {matUsuario.empresas.includes(id) && <LayoutTemplate className="h-3 w-3 text-primary" />}
                                  </span>
                                ))}
                                {ownerOriginal.map((o) => (
                                  <span
                                    key={`o${o}`}
                                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px]"
                                  >
                                    <Tags className="h-3 w-3 text-muted-foreground" />
                                    {o}
                                    {matUsuario.owners.includes(o) && <LayoutTemplate className="h-3 w-3 text-primary" />}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Los perfiles como tarjetas: una decision por tarjeta, no
                              una casilla perdida en una lista. */}
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h3 className="flex items-center gap-2 text-sm font-bold">
                                <LayoutTemplate className="h-4 w-4 text-primary" />
                                Perfiles de acceso
                              </h3>
                              <span className="text-xs text-muted-foreground">Marca uno o varios: la persona recibe la unión.</span>
                            </div>
                            {faltaScriptPerfiles ? (
                              <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                                Falta correr <code>scripts/264_perfiles_unificados.sql</code> para poder usar perfiles.
                              </p>
                            ) : perfilesCatalogo.length === 0 ? (
                              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-6 text-center">
                                <LayoutTemplate className="h-8 w-8 text-muted-foreground/40" />
                                <p className="text-sm font-medium">Todavía no hay perfiles</p>
                                <p className="max-w-sm text-xs text-muted-foreground">
                                  Se crean en <strong>la pestaña Perfiles</strong>. Lo más rápido: «A partir de un
                                  usuario» con alguien que ya esté bien configurado. Mientras tanto, los módulos y empresas se
                                  marcan a mano en las otras pestañas.
                                </p>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {perfilesCatalogo.map((p) => {
                                  const on = perfilesUsuario.includes(p.id)
                                  return (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() =>
                                        setPerfilesUsuario((prev) => (on ? prev.filter((id) => id !== p.id) : [...prev, p.id]))
                                      }
                                      className={`group relative rounded-2xl border p-3.5 text-left transition-all ${
                                        on
                                          ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/30"
                                          : "border-border/60 bg-card hover:border-primary/40 hover:bg-accent/30"
                                      } ${!p.activo ? "opacity-60" : ""}`}
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className="truncate text-sm font-semibold">
                                            {p.nombre}
                                            {!p.activo && (
                                              <span className="ml-1 text-[10px] font-normal text-muted-foreground">(inactivo)</span>
                                            )}
                                          </p>
                                          {p.descripcion && (
                                            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{p.descripcion}</p>
                                          )}
                                        </div>
                                        <span
                                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                            on
                                              ? "border-primary bg-primary text-primary-foreground"
                                              : "border-border text-transparent group-hover:text-muted-foreground"
                                          }`}
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                        </span>
                                      </div>
                                      <div className="mt-2.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                                        <span className="rounded-full bg-muted px-1.5 py-0.5">{p.empresas.length} empresas</span>
                                        <span className="rounded-full bg-muted px-1.5 py-0.5">{p.owners.length} owners</span>
                                        <span className="rounded-full bg-muted px-1.5 py-0.5">{p.permisos.length} módulos</span>
                                        <span className="rounded-full bg-muted px-1.5 py-0.5">{p.procesos.length} autoriza</span>
                                        <span className="rounded-full bg-muted px-1.5 py-0.5">
                                          {p.usuarios} usuario{p.usuarios === 1 ? "" : "s"}
                                        </span>
                                      </div>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          {perfilesCatalogo.length > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                              <span className="text-xs text-muted-foreground">
                                {perfilesDirty
                                  ? "Cambios sin aplicar"
                                  : perfilesUsuario.length
                                    ? `${perfilesUsuario.length} perfil(es) aplicados`
                                    : "Sin perfil: todo marcado a mano"}
                              </span>
                              <Button onClick={handleSavePerfiles} disabled={savingPerfiles || !perfilesDirty} className="gap-2">
                                {savingPerfiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutTemplate className="h-4 w-4" />}
                                Aplicar perfiles
                              </Button>
                            </div>
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            Aplicar escribe de inmediato las empresas, owners y módulos de la persona. Lo que quieras ajustar a
                            mano va en las otras dos pestañas y se conserva aunque cambies el perfil.
                          </p>
                        </>
                      )}
                    </TabsContent>

                    {/* ===== Permisos ===== */}
                    <TabsContent value="permisos" className="mt-4 space-y-3">
                      {matUsuario.permisos.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          <TagPerfil /> lo trae un perfil. Si lo desmarcas, el próximo recálculo lo devuelve; para quitarlo,
                          cambia el perfil en la pestaña Perfil.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[180px]">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Filtrar módulos…"
                            value={permSearch}
                            onChange={(e) => setPermSearch(e.target.value)}
                            className="pl-8 h-9"
                          />
                        </div>
                        <Select value={copyFromId} onValueChange={handleCopyFrom}>
                          <SelectTrigger className="h-9 w-[190px]">
                            <div className="flex items-center gap-1.5">
                              <Copy className="h-3.5 w-3.5" />
                              <SelectValue placeholder="Copiar permisos de…" />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {users
                              .filter((u) => u.id !== selectedUser.id)
                              .map((u) => (
                                <SelectItem key={u.id} value={u.id}>
                                  {u.usuario}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" className="h-9" onClick={() => handleGlobalAll(true)}>
                          Todo
                        </Button>
                        <Button variant="outline" size="sm" className="h-9" onClick={() => handleGlobalAll(false)}>
                          Nada
                        </Button>
                      </div>

                      <div className="max-h-[460px] overflow-y-auto pr-2 -mr-2">
                        {filteredTree.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-8">
                            Ningún módulo coincide con “{permSearch}”.
                          </p>
                        ) : (
                          <Accordion type="multiple" value={openGroups} onValueChange={setOpenGroups} className="space-y-2">
                            {filteredTree.map((group) => {
                              const { total, active } = groupCount(group)
                              return (
                                <AccordionItem
                                  key={group.title}
                                  value={group.title}
                                  className="rounded-xl border border-border/60 bg-card px-3 data-[state=open]:border-primary/30 data-[state=open]:shadow-sm transition-colors"
                                >
                                  <AccordionTrigger className="hover:no-underline py-3">
                                    <div className="flex items-center gap-2 flex-1 pr-2">
                                      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${active > 0 ? "bg-primary" : "bg-border"}`} />
                                      <span className="font-semibold text-sm text-foreground">{group.title}</span>
                                      <Badge
                                        className={`h-5 px-1.5 text-[11px] border-0 ${
                                          active > 0 ? "bg-primary/15 text-primary hover:bg-primary/15" : "bg-muted text-muted-foreground hover:bg-muted"
                                        }`}
                                      >
                                        {active}/{total}
                                      </Badge>
                                    </div>
                                  </AccordionTrigger>
                                  <AccordionContent className="space-y-4 pt-1">
                                    {group.sections.map((section) => (
                                      <div key={section.title ?? `${group.title}-general`} className="space-y-2">
                                        <div className="flex items-center justify-between">
                                          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                            {section.title ?? "General"}
                                          </h4>
                                          <div className="flex gap-1.5">
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 text-xs px-2"
                                              onClick={() => handleSelectAll(section.permissions, true)}
                                            >
                                              Todos
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 text-xs px-2"
                                              onClick={() => handleSelectAll(section.permissions, false)}
                                            >
                                              Ninguno
                                            </Button>
                                          </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-3 border-l-2 border-border">
                                          {section.permissions.map((perm) => {
                                            const isEnabled = permissions[perm.key] || false
                                            const htmlId = `${selectedUser.id}-${perm.key}`
                                            return (
                                              <div
                                                key={perm.key as string}
                                                className={`p-1.5 rounded-md transition-colors ${
                                                  isEnabled ? "bg-primary/5" : "hover:bg-accent/50"
                                                }`}
                                              >
                                                <div className="flex items-center space-x-2">
                                                <Checkbox
                                                  id={htmlId}
                                                  checked={!!isEnabled}
                                                  onCheckedChange={(checked) =>
                                                    handlePermissionChange(perm.key as string, checked as boolean)
                                                  }
                                                />
                                                <Label
                                                  htmlFor={htmlId}
                                                  className={`text-sm cursor-pointer leading-tight flex-1 ${
                                                    isEnabled ? "font-medium text-primary" : ""
                                                  }`}
                                                >
                                                  {perm.label}
                                                  {matUsuario.permisos.includes(perm.key as string) && <TagPerfil />}
                                                </Label>
                                                </div>
                                                <ChipsAcciones
                                                  llave={perm.key as string}
                                                  marcados={marcados}
                                                  verActivo={!!isEnabled}
                                                  onToggle={(k, on) => handlePermissionChange(k, on)}
                                                  compacto
                                                />
                                              </div>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </AccordionContent>
                                </AccordionItem>
                              )
                            })}
                          </Accordion>
                        )}
                      </div>

                      {/* ===== Procesos del Mapa de Procesos =====
                          No salen del árbol derivado del menú: no son módulos,
                          son los botones DENTRO del Mapa de Procesos. Por eso
                          van en su propia sección. */}
                      <div className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-semibold">Mapa de Procesos — acceso por proceso</h4>
                            <p className="text-[11px] text-muted-foreground">
                              A qué procesos puede entrar dentro del mapa. Los demás los ve, pero no
                              los abre. Requiere además el permiso del módulo Mapa de Procesos.
                            </p>
                          </div>
                          <div className="flex gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setProcesos(PROCESOS.map((p) => p.id))}
                            >
                              Todos
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setProcesos([])}
                            >
                              Ninguno
                            </Button>
                          </div>
                        </div>

                        {faltaScriptMapa ? (
                          <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                            Falta correr{" "}
                            <code className="font-mono">scripts/189_permisos_mapa_procesos.sql</code>.
                            Mientras tanto, quien vea el mapa puede abrir todos los procesos.
                          </p>
                        ) : (
                          <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                            {PROCESOS.map((proc) => {
                              const marcado = procesos.includes(proc.id)
                              const htmlId = `proc-${proc.id}`
                              return (
                                <div key={proc.id} className="flex items-start gap-2">
                                  <Checkbox
                                    id={htmlId}
                                    checked={marcado}
                                    onCheckedChange={(v) =>
                                      setProcesos((prev) =>
                                        v === true
                                          ? [...prev, proc.id]
                                          : prev.filter((x) => x !== proc.id),
                                      )
                                    }
                                  />
                                  <Label
                                    htmlFor={htmlId}
                                    className={`flex-1 cursor-pointer text-sm leading-tight ${
                                      marcado ? "font-medium text-primary" : ""
                                    }`}
                                  >
                                    {proc.nombre}
                                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                                      {proc.codigo} · {proc.tipo}
                                    </span>
                                  </Label>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t">
                        <span className="text-xs text-muted-foreground">
                          {permsDirty ? "Tienes cambios sin guardar" : "Todo guardado"}
                        </span>
                        <Button onClick={handleSavePerms} disabled={savingPerms || !permsDirty} className="gap-2">
                          {savingPerms ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Guardar Permisos
                        </Button>
                      </div>
                    </TabsContent>

                    {/* ===== Accesos ===== */}
                    <TabsContent value="accesos" className="mt-4 space-y-5">
                      {matUsuario.empresas.length + matUsuario.owners.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          <TagPerfil /> lo trae un perfil. Si lo desmarcas, el próximo recálculo lo devuelve; para quitarlo,
                          cambia el perfil en la pestaña Perfil.
                        </p>
                      )}
                      {loadingAccess ? (
                        <div className="flex items-center justify-center h-40">
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                      ) : (
                        <>
                          {/* Empresas */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-primary" />
                              <h3 className="text-sm font-bold">Empresas</h3>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button type="button" className="text-xs text-muted-foreground underline decoration-dotted">
                                    ¿qué controla?
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs leading-relaxed">
                                  Permiso maestro: define qué empresas ve el usuario en el selector global y, con ello,
                                  qué datos ve y gestiona en casi todo el sistema (Pedidos, Inventario, Producción,
                                  Financiera, GH, SST, SIG…). Cada módulo filtra por la empresa seleccionada.
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 rounded-xl border border-border/60 bg-card p-2.5">
                              {empresas.map((e) => {
                                const checked = empresaAccess.includes(e.id)
                                return (
                                  <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer p-1 rounded hover:bg-accent/50">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(c) =>
                                        setEmpresaAccess((prev) => (c ? [...prev, e.id] : prev.filter((id) => id !== e.id)))
                                      }
                                    />
                                    <span className="truncate">{e.nombre}</span>
                                    {matUsuario.empresas.includes(e.id) && <TagPerfil />}
                                  </label>
                                )
                              })}
                            </div>
                          </div>

                          <Separator />

                          {/* Owners */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Tags className="h-4 w-4 text-primary" />
                              <h3 className="text-sm font-bold">Owners</h3>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button type="button" className="text-xs text-muted-foreground underline decoration-dotted">
                                    ¿qué controla?
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs leading-relaxed">
                                  Filtro adicional SOLO para Pedidos: restringe la Gestión y el Dashboard de Pedidos por
                                  la razón social que factura. Solo aplica si el usuario tiene owners asignados; si no,
                                  no se restringe por owner. No cambia el selector de empresa ni afecta otros módulos.
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 rounded-xl border border-border/60 bg-card p-2.5">
                              {owners.map((o) => {
                                const checked = ownerAccess.includes(o.nombre)
                                return (
                                  <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer p-1 rounded hover:bg-accent/50">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(c) =>
                                        setOwnerAccess((prev) => (c ? [...prev, o.nombre] : prev.filter((n) => n !== o.nombre)))
                                      }
                                    />
                                    <span className="truncate">{o.nombre}</span>
                                    {matUsuario.owners.includes(o.nombre) && <TagPerfil />}
                                  </label>
                                )
                              })}
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-3 border-t">
                            <span className="text-xs text-muted-foreground">
                              {accessDirty ? "Tienes cambios sin guardar" : "Todo guardado"}
                            </span>
                            <Button onClick={handleSaveAccess} disabled={savingAccess || !accessDirty} className="gap-2">
                              {savingAccess ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                              Guardar Accesos
                            </Button>
                          </div>
                        </>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-[420px] text-center px-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 mb-4">
                  <User className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Selecciona un usuario</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  Elige a alguien de la lista para editar sus permisos y accesos, o crea uno nuevo con “Crear Usuario”.
                </p>
              </div>
            )}
          </Card>
        </div>

        {/* ---------- Dialog: Crear Usuario ---------- */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Crear usuario</DialogTitle>
              <DialogDescription>
                El correo queda validado automáticamente: el usuario podrá iniciar sesión de inmediato.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="nu-email">Correo</Label>
                <Input
                  id="nu-email"
                  type="email"
                  autoComplete="off"
                  placeholder="usuario@lip-sas.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nu-usuario">Nombre de usuario</Label>
                <Input
                  id="nu-usuario"
                  autoComplete="off"
                  placeholder="Nombre visible en el sistema"
                  value={form.usuario}
                  onChange={(e) => setForm((f) => ({ ...f, usuario: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nu-pwd">Contraseña</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="nu-pwd"
                      type={showPwd ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Mínimo 8 caracteres"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setForm((f) => ({ ...f, password: generarPasswordSegura() }))
                      setShowPwd(true)
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Generar
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Empresa por defecto</Label>
                <Select value={form.empresaId} onValueChange={(v) => setForm((f) => ({ ...f, empresaId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {empresas.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Empresas adicionales de acceso (opcional)
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-32 overflow-y-auto rounded-md border p-2">
                    {empresas.map((e) => {
                      const checked = form.empresasAdicionales.includes(e.id)
                      return (
                        <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) =>
                              setForm((f) => ({
                                ...f,
                                empresasAdicionales: c
                                  ? [...f.empresasAdicionales, e.id]
                                  : f.empresasAdicionales.filter((id) => id !== e.id),
                              }))
                            }
                          />
                          <span className="truncate">{e.nombre}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {owners.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Owners con acceso (opcional)
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-32 overflow-y-auto rounded-md border p-2">
                    {owners.map((o) => {
                      const checked = form.owners.includes(o.nombre)
                      return (
                        <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) =>
                              setForm((f) => ({
                                ...f,
                                owners: c ? [...f.owners, o.nombre] : f.owners.filter((n) => n !== o.nombre),
                              }))
                            }
                          />
                          <span className="truncate">{o.nombre}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={creating} className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Crear usuario
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ---------- Dialog: Resetear contraseña ---------- */}
        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Resetear contraseña</DialogTitle>
              <DialogDescription>
                {selectedUser ? `Define una nueva contraseña para ${selectedUser.usuario}. Tendrá efecto inmediato.` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label htmlFor="rp-pwd">Nueva contraseña</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="rp-pwd"
                    type={showResetPwd ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Mínimo 8 caracteres"
                    value={resetPwd}
                    onChange={(e) => setResetPwd(e.target.value)}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPwd((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showResetPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    setResetPwd(generarPasswordSegura())
                    setShowResetPwd(true)
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                  Generar
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>
                Cancelar
              </Button>
              <Button onClick={handleReset} disabled={resetting} className="gap-2">
                {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Guardar contraseña
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ---------- AlertDialog: Eliminar usuario ---------- */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar a {selectedUser?.usuario}?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción es permanente. Se eliminará la cuenta de acceso, sus permisos y sus accesos a empresas y
                owners. El usuario no podrá volver a iniciar sesión.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  handleDelete()
                }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eliminar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}
