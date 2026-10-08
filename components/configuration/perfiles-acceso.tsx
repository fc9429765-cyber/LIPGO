"use client"

// PERFILES DE ACCESO
//
// Un perfil es un paquete con nombre: las empresas que abre, los owners a los
// que limita Pedidos y los módulos que enciende. Aquí se CREAN y EDITAN; la
// asignación a cada usuario se hace en la pestaña Usuarios.
//
// Reemplaza a la grilla "Accesos de Usuario" (usuarios × empresas con
// checkboxes), que obligaba a repetir ~140 clics por cada persona nueva y no
// podía responder "¿qué tiene un coordinador?" sin abrir a uno y mirar.
//
// Misma composición que Gestión de Usuarios --cabecera con indicadores, lista
// a la izquierda, detalle con pestañas a la derecha-- para que quien
// administra no tenga que aprender dos pantallas distintas.

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Copy,
  KeyRound,
  LayoutTemplate,
  Loader2,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Tags,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react"
import { getAllEmpresas, getAllOwners } from "@/lib/user-access-actions"
import type { Empresa, Owner } from "@/lib/user-access-tipos"
import {
  asignarUsuariosAPerfil,
  eliminarPerfilAcceso,
  guardarPerfilAcceso,
  listarPerfilesAcceso,
  plantillaDesdeUsuario,
  usuariosDePerfil,
  usuariosParaPlantilla,
} from "@/lib/acceso-perfiles-actions"
import type { PerfilAcceso, UsuarioDePerfil } from "@/lib/acceso-perfiles-tipos"
import { adminListarProcesos } from "@/lib/autorizaciones-actions"
import type { ProcesoAutorizable } from "@/lib/autorizaciones"
import { PERMISSION_TREE, clavesDeItem, clavesDelArbol, filtrarArbol, type PermGroup, type PermItem } from "@/lib/permisos-arbol"
import { ChipsAcciones, accionesDeLlave } from "@/components/configuration/chips-acciones"
import { esClaveAccion } from "@/lib/permisos-verbos"

type Form = {
  nombre: string
  descripcion: string
  activo: boolean
  empresas: number[]
  owners: string[]
  permisos: string[]
  /** Procesos que autoriza con clave personal. */
  procesos: string[]
}

const FORM_VACIO: Form = { nombre: "", descripcion: "", activo: true, empresas: [], owners: [], permisos: [], procesos: [] }

function mismoConjunto<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

function formDesde(p: PerfilAcceso): Form {
  return {
    nombre: p.nombre,
    descripcion: p.descripcion ?? "",
    activo: p.activo,
    empresas: [...p.empresas],
    owners: [...p.owners],
    permisos: [...p.permisos],
    procesos: [...p.procesos],
  }
}

export function PerfilesAcceso() {
  const { toast } = useToast()

  const [perfiles, setPerfiles] = useState<PerfilAcceso[]>([])
  const [usuariosCubiertos, setUsuariosCubiertos] = useState(0)
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [owners, setOwners] = useState<Owner[]>([])
  const [usuarios, setUsuarios] = useState<UsuarioDePerfil[]>([])
  const [procesosCat, setProcesosCat] = useState<ProcesoAutorizable[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  // Edición. `sel` es el id del perfil abierto, "nuevo" para uno sin guardar.
  const [sel, setSel] = useState<number | "nuevo" | null>(null)
  const [form, setForm] = useState<Form>(FORM_VACIO)
  const [original, setOriginal] = useState<Form>(FORM_VACIO)
  const [asignados, setAsignados] = useState<UsuarioDePerfil[]>([])
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [desdeUsuario, setDesdeUsuario] = useState("")

  // Quién tiene el perfil: copia de trabajo para marcar y desmarcar, y
  // aplicar aparte del guardado del perfil (asignar recalcula de inmediato).
  const [asignadosSel, setAsignadosSel] = useState<string[]>([])
  const [asigSearch, setAsigSearch] = useState("")
  const [savingAsig, setSavingAsig] = useState(false)

  const cargar = async () => {
    setLoading(true)
    const [lista, emp, own, usu, pro] = await Promise.all([
      listarPerfilesAcceso(),
      empresas.length ? Promise.resolve(empresas) : getAllEmpresas(),
      owners.length ? Promise.resolve(owners) : getAllOwners(),
      usuarios.length ? Promise.resolve(usuarios) : usuariosParaPlantilla(),
      procesosCat.length ? Promise.resolve({ success: true, data: procesosCat }) : adminListarProcesos(),
    ])
    if (pro.success && pro.data) setProcesosCat(pro.data)
    if (lista.success) {
      setPerfiles(lista.data)
      setUsuariosCubiertos(lista.usuariosCubiertos)
      setFaltaMigracion(!!lista.faltaMigracion)
    } else {
      toast({ title: "No se pudieron cargar los perfiles", description: lista.message, variant: "destructive" })
    }
    setEmpresas(emp)
    setOwners(own)
    setUsuarios(usu)
    setLoading(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const seleccionar = async (p: PerfilAcceso) => {
    setSel(p.id)
    const f = formDesde(p)
    setForm(f)
    setOriginal(f)
    const a = await usuariosDePerfil(p.id)
    setAsignados(a)
    setAsignadosSel(a.map((u) => u.id))
    setAsigSearch("")
  }

  const nuevo = () => {
    setSel("nuevo")
    setForm(FORM_VACIO)
    setOriginal(FORM_VACIO)
    setAsignados([])
    setAsignadosSel([])
    setDesdeUsuario("")
  }

  /*
   * Arrancar un perfil con lo que un usuario ya tiene. Es la forma rápida de
   * ordenar lo existente: se toma al coordinador que ya está bien configurado
   * y de ahí en adelante los nuevos reciben el perfil en vez de 140 clics.
   */
  const nuevoDesdeUsuario = async (uid: string) => {
    setDesdeUsuario(uid)
    const u = usuarios.find((x) => x.id === uid)
    const r = await plantillaDesdeUsuario(uid)
    if (!r.success || !r.data) {
      toast({ title: "No se pudo leer al usuario", description: r.message, variant: "destructive" })
      return
    }
    setSel("nuevo")
    const f: Form = {
      nombre: u ? `Perfil de ${u.usuario}` : "",
      descripcion: u ? `Creado a partir del acceso de ${u.usuario}.` : "",
      activo: true,
      ...r.data,
    }
    setForm(f)
    setOriginal(FORM_VACIO)
    setAsignados([])
    setAsignadosSel([])
    toast({
      title: "Plantilla cargada",
      description: `${r.data.empresas.length} empresas, ${r.data.owners.length} owners y ${r.data.permisos.length} módulos de ${u?.usuario ?? "ese usuario"}. Revisa, ponle nombre y guarda.`,
    })
  }

  const duplicar = () => {
    setSel("nuevo")
    const f = { ...form, nombre: `Copia de ${form.nombre}`.trim() }
    setForm(f)
    setOriginal(FORM_VACIO)
    setAsignados([])
    setAsignadosSel([])
  }

  const dirty = useMemo(
    () =>
      form.nombre !== original.nombre ||
      form.descripcion !== original.descripcion ||
      form.activo !== original.activo ||
      !mismoConjunto(form.empresas, original.empresas) ||
      !mismoConjunto(form.owners, original.owners) ||
      !mismoConjunto(form.permisos, original.permisos) ||
      !mismoConjunto(form.procesos, original.procesos),
    [form, original],
  )

  const asigDirty = useMemo(
    () => !mismoConjunto(asignadosSel, asignados.map((u) => u.id)),
    [asignadosSel, asignados],
  )

  const guardar = async () => {
    if (!form.nombre.trim()) {
      toast({ title: "Falta el nombre", description: "Ponle un nombre al perfil, por ejemplo «Coordinador Indupan»." })
      return
    }
    setSaving(true)
    const r = await guardarPerfilAcceso({
      id: sel === "nuevo" || sel === null ? undefined : sel,
      nombre: form.nombre,
      descripcion: form.descripcion,
      activo: form.activo,
      empresas: form.empresas,
      owners: form.owners,
      permisos: form.permisos,
      procesos: form.procesos,
    })
    setSaving(false)
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    const rc = r.recalculo
    toast({
      title: "Perfil guardado",
      description:
        rc && rc.usuarios > 0
          ? `Se recalculó el acceso de ${rc.usuarios} usuario(s) que lo tienen.${rc.errores.length ? ` ${rc.errores.length} con error.` : ""}`
          : "Todavía no lo tiene ningún usuario. Asígnalo desde la pestaña Usuarios.",
    })
    await cargar()
    if (r.id) {
      const lista = await listarPerfilesAcceso()
      const p = lista.data.find((x) => x.id === r.id)
      if (p) await seleccionar(p)
    }
  }

  const eliminar = async () => {
    if (sel === "nuevo" || sel === null) return
    setDeleting(true)
    const r = await eliminarPerfilAcceso(sel)
    setDeleting(false)
    setDeleteOpen(false)
    if (!r.success) {
      toast({ title: "No se pudo eliminar", description: r.message, variant: "destructive" })
      return
    }
    toast({
      title: "Perfil eliminado",
      description:
        r.recalculo && r.recalculo.usuarios > 0
          ? `A ${r.recalculo.usuarios} usuario(s) se les retiró lo que este perfil traía.`
          : undefined,
    })
    setSel(null)
    await cargar()
  }

  /*
   * Asigna o quita este perfil a los usuarios marcados y recalcula el acceso
   * de cada uno de inmediato. Por eso exige que el perfil esté guardado: si el
   * formulario tiene cambios sin guardar, lo que se les aplicaría sería la
   * versión vieja del perfil.
   */
  const aplicarUsuarios = async () => {
    if (sel === "nuevo" || sel === null) return
    setSavingAsig(true)
    const r = await asignarUsuariosAPerfil(sel, asignadosSel)
    setSavingAsig(false)
    if (!r.success) {
      toast({ title: "No se pudo asignar", description: r.message, variant: "destructive" })
      return
    }
    toast({
      title: "Usuarios actualizados",
      description: `${r.agregados} asignado(s), ${r.retirados} retirado(s).${
        r.errores.length ? ` ${r.errores.length} con error al recalcular.` : ""
      }`,
    })
    const a = await usuariosDePerfil(sel)
    setAsignados(a)
    setAsignadosSel(a.map((u) => u.id))
    const lista = await listarPerfilesAcceso()
    if (lista.success) {
      setPerfiles(lista.data)
      setUsuariosCubiertos(lista.usuariosCubiertos)
    }
  }

  const togglear = <T,>(campo: "empresas" | "owners" | "permisos" | "procesos", valor: T, on: boolean) =>
    setForm((f) => {
      const actual = f[campo] as unknown as T[]
      const siguiente = on ? [...new Set([...actual, valor])] : actual.filter((x) => x !== valor)
      return { ...f, [campo]: siguiente }
    })

  const togglearVarios = (claves: string[], on: boolean) =>
    setForm((f) => ({
      ...f,
      permisos: on ? [...new Set([...f.permisos, ...claves])] : f.permisos.filter((k) => !claves.includes(k)),
    }))

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return perfiles
    return perfiles.filter(
      (p) => p.nombre.toLowerCase().includes(q) || (p.descripcion ?? "").toLowerCase().includes(q),
    )
  }, [perfiles, search])

  const stats = useMemo(
    () => ({
      total: perfiles.length,
      activos: perfiles.filter((p) => p.activo).length,
      cubiertos: usuariosCubiertos,
      sinUsuarios: perfiles.filter((p) => p.usuarios === 0).length,
    }),
    [perfiles, usuariosCubiertos],
  )

  const editando = sel !== null
  const esNuevo = sel === "nuevo"
  const perfilSel = typeof sel === "number" ? perfiles.find((p) => p.id === sel) : undefined

  return (
    <div className="space-y-6">
      {/* ---------- Cabecera ---------- */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm">
        <div className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md">
              <LayoutTemplate className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">Perfiles de acceso</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                El puesto: qué empresas, owners y módulos abre, y qué procesos autoriza con su clave. Se asigna a
                una persona y queda lista para trabajar.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={desdeUsuario} onValueChange={nuevoDesdeUsuario}>
              <SelectTrigger className="h-10 w-[230px] bg-card">
                <div className="flex items-center gap-1.5">
                  <UserPlus className="h-4 w-4" />
                  <SelectValue placeholder="A partir de un usuario…" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {usuarios.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.usuario}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={nuevo} size="lg" className="gap-2 shadow-md">
              <Plus className="h-4 w-4" />
              Nuevo perfil
            </Button>
          </div>
        </div>
        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/60 border-t border-border/60">
          {[
            { label: "Perfiles", value: stats.total, icon: LayoutTemplate, tone: "text-primary" },
            { label: "Activos", value: stats.activos, icon: ShieldCheck, tone: "text-emerald-600" },
            { label: "Usuarios con perfil", value: stats.cubiertos, icon: Users, tone: "text-sky-600" },
            { label: "Sin usuarios", value: stats.sinUsuarios, icon: AlertTriangle, tone: "text-amber-600" },
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

      {faltaMigracion && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Las tablas de perfiles no existen todavía. Hay que correr{" "}
            <code className="rounded bg-amber-100 px-1">scripts/264_perfiles_unificados.sql</code> en la base de datos.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ---------- Lista ---------- */}
        <Card className="lg:col-span-1 overflow-hidden border-border/60 shadow-md bg-gradient-to-br from-card to-muted/20">
          <CardHeader className="pb-3 bg-gradient-to-r from-primary/10 via-muted/40 to-transparent border-b border-border/60">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
                  <LayoutTemplate className="h-3.5 w-3.5" />
                </span>
                Perfiles
              </span>
              <Badge className="bg-primary/15 text-primary hover:bg-primary/15 border-0 h-5 px-1.5 text-[11px] tabular-nums">
                {filtrados.length}
              </Badge>
            </CardTitle>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar perfil…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 bg-card"
              />
            </div>
          </CardHeader>
          <CardContent className="p-2.5">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : perfiles.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center px-3">
                <LayoutTemplate className="h-9 w-9 text-muted-foreground/40" />
                <p className="text-sm font-medium">Todavía no hay perfiles</p>
                <p className="text-xs text-muted-foreground">
                  Lo más rápido es crear el primero <strong>a partir de un usuario</strong> que ya esté bien
                  configurado, con el selector de arriba.
                </p>
              </div>
            ) : filtrados.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Ningún perfil coincide con «{search}».</p>
            ) : (
              <div className="space-y-1.5">
                {filtrados.map((p) => {
                  const activo = sel === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => seleccionar(p)}
                      className={`w-full rounded-xl border p-2.5 text-left transition-colors ${
                        activo
                          ? "border-primary/40 bg-primary/10 shadow-sm"
                          : "border-transparent bg-card hover:border-border hover:bg-accent/40"
                      } ${!p.activo ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{p.nombre}</p>
                          {p.descripcion && (
                            <p className="truncate text-[11px] text-muted-foreground">{p.descripcion}</p>
                          )}
                        </div>
                        {!p.activo && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Inactivo
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                        <span className="rounded-full bg-muted px-1.5 py-0.5">{p.empresas.length} empresas</span>
                        <span className="rounded-full bg-muted px-1.5 py-0.5">{p.owners.length} owners</span>
                        <span className="rounded-full bg-muted px-1.5 py-0.5">{p.permisos.length} módulos</span>
                        <span className="rounded-full bg-muted px-1.5 py-0.5">{p.procesos.length} autoriza</span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 ${
                            p.usuarios > 0 ? "bg-primary/15 text-primary font-medium" : "bg-muted"
                          }`}
                        >
                          {p.usuarios} usuario{p.usuarios === 1 ? "" : "s"}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------- Detalle ---------- */}
        <Card className="lg:col-span-2 overflow-hidden border-border/60 shadow-md bg-gradient-to-br from-card to-muted/20">
          {!editando ? (
            <div className="flex flex-col items-center justify-center h-[420px] text-center px-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 mb-4">
                <LayoutTemplate className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Selecciona un perfil</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Elige uno de la lista para ver qué trae y quién lo tiene, o crea uno nuevo. A cada persona se le
                asigna desde <strong>la pestaña Usuarios</strong>, o desde la pestaña Usuarios del propio perfil.
              </p>
            </div>
          ) : (
            <>
              <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-r from-primary/10 via-card to-card p-5">
                <div className="pointer-events-none absolute -top-12 right-8 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
                <div className="relative space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-[240px] space-y-2">
                      <Input
                        value={form.nombre}
                        onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                        placeholder="Nombre del perfil, p. ej. «Coordinador Indupan»"
                        className="h-11 text-lg font-bold bg-card"
                      />
                      <Textarea
                        value={form.descripcion}
                        onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                        placeholder="Para quién es y qué le permite hacer"
                        className="min-h-[52px] text-sm bg-card"
                      />
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5 bg-card" onClick={duplicar} disabled={esNuevo}>
                          <Copy className="h-3.5 w-3.5" />
                          Duplicar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 bg-card text-destructive hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40"
                          onClick={() => setDeleteOpen(true)}
                          disabled={esNuevo}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Eliminar
                        </Button>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={form.activo} onCheckedChange={(v) => setForm({ ...form, activo: v })} />
                        <span className={form.activo ? "font-medium" : "text-muted-foreground"}>
                          {form.activo ? "Activo" : "Inactivo"}
                        </span>
                      </label>
                      {/* Inactivo no es borrado: la asignacion queda como rastro y
                          se puede reactivar. Pero lo que traia se retira. */}
                      {!form.activo && (
                        <p className="max-w-[260px] text-right text-[11px] text-muted-foreground">
                          Sigue asignado a sus usuarios, pero no les aporta nada hasta que se reactive.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <CardContent className="pt-5">
                <Tabs defaultValue="empresas" className="w-full">
                  <TabsList className="grid w-full grid-cols-5 h-11 p-1 bg-muted/60">
                    <TabsTrigger value="empresas" className="gap-1.5 data-[state=active]:shadow-sm">
                      <Building2 className="h-4 w-4" />
                      <span className="hidden sm:inline">Empresas</span>
                      <Contador n={form.empresas.length} />
                    </TabsTrigger>
                    <TabsTrigger value="owners" className="gap-1.5 data-[state=active]:shadow-sm">
                      <Tags className="h-4 w-4" />
                      <span className="hidden sm:inline">Owners</span>
                      <Contador n={form.owners.length} />
                    </TabsTrigger>
                    <TabsTrigger value="permisos" className="gap-1.5 data-[state=active]:shadow-sm">
                      <ShieldCheck className="h-4 w-4" />
                      <span className="hidden sm:inline">Módulos</span>
                      <Contador n={form.permisos.length} />
                    </TabsTrigger>
                    <TabsTrigger value="autorizaciones" className="gap-1.5 data-[state=active]:shadow-sm">
                      <KeyRound className="h-4 w-4" />
                      <span className="hidden sm:inline">Autoriza</span>
                      <Contador n={form.procesos.length} />
                    </TabsTrigger>
                    <TabsTrigger value="usuarios" className="gap-1.5 data-[state=active]:shadow-sm">
                      <Users className="h-4 w-4" />
                      <span className="hidden sm:inline">Usuarios</span>
                      <Contador n={asignadosSel.length} />
                    </TabsTrigger>
                  </TabsList>

                  {/* ===== Empresas ===== */}
                  <TabsContent value="empresas" className="mt-4 space-y-3">
                    <Nota icon={Building2}>
                      <strong>Es el permiso maestro.</strong> Define qué empresas ve el usuario en el selector global
                      y, con ello, qué datos puede ver y gestionar en casi todo el sistema. Cada módulo filtra por la
                      empresa seleccionada.
                    </Nota>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 rounded-xl border border-border/60 bg-card p-2.5">
                      {empresas.map((e) => {
                        const checked = form.empresas.includes(e.id)
                        return (
                          <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-accent/50">
                            <Checkbox checked={checked} onCheckedChange={(c) => togglear("empresas", e.id, !!c)} />
                            <span className="truncate">{e.nombre}</span>
                          </label>
                        )
                      })}
                    </div>
                  </TabsContent>

                  {/* ===== Owners ===== */}
                  <TabsContent value="owners" className="mt-4 space-y-3">
                    <Nota icon={Tags}>
                      <strong>Filtro adicional solo para Pedidos.</strong> Limita la Gestión y el Dashboard de Pedidos
                      a la razón social que factura. Sin owners marcados no hay límite por owner. No cambia el
                      selector de empresa ni afecta a los demás módulos.
                    </Nota>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 rounded-xl border border-border/60 bg-card p-2.5">
                      {owners.map((o) => {
                        const checked = form.owners.includes(o.nombre)
                        return (
                          <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-accent/50">
                            <Checkbox checked={checked} onCheckedChange={(c) => togglear("owners", o.nombre, !!c)} />
                            <span className="truncate">{o.nombre}</span>
                          </label>
                        )
                      })}
                    </div>
                  </TabsContent>

                  {/* ===== Módulos ===== */}
                  <TabsContent value="permisos" className="mt-4">
                    <ArbolPermisos
                      seleccion={form.permisos}
                      onToggle={(k, on) => togglear("permisos", k, on)}
                      onToggleVarios={togglearVarios}
                    />
                  </TabsContent>

                  {/* ===== Autorizaciones por clave ===== */}
                  <TabsContent value="autorizaciones" className="mt-4 space-y-3">
                    <Nota icon={KeyRound}>
                      <strong>Qué puede autorizar con su clave personal</strong> quien tenga este perfil: aprobar un ajuste,
                      liberar una cuarentena, anular un pedido… El alcance por proyecto sigue a las empresas del perfil; si
                      el perfil no define empresas, vale en todos. Los procesos del grupo Financiera solo se pueden dar a
                      usuarios con módulos de Gestión Financiera: el servidor lo rechaza si no.
                    </Nota>
                    {procesosCat.some((p) => p.pendiente_sql) && (
                      <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                        {procesosCat.filter((p) => p.pendiente_sql).length} procesos nuevos del catálogo todavía no existen en la base: corre{" "}
                        <code className="rounded bg-amber-100 px-1">scripts/262_permisos_acciones.sql</code> para poder otorgarlos.
                      </p>
                    )}
                    {procesosCat.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">No hay procesos autorizables cargados.</p>
                    ) : (
                      <div className="space-y-3">
                        {Array.from(new Set(procesosCat.map((p) => p.grupo))).map((grupo) => {
                          const del = procesosCat.filter((p) => p.grupo === grupo)
                          const marcados = del.filter((p) => form.procesos.includes(p.codigo)).length
                          return (
                            <div key={grupo} className="rounded-xl border border-border/60 bg-card p-2.5">
                              <div className="mb-1.5 flex items-center justify-between">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{grupo}</p>
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] tabular-nums text-muted-foreground">
                                    {marcados}/{del.length}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5 text-[10px]"
                                    onClick={() =>
                                      setForm((f) => ({
                                        ...f,
                                        procesos: Array.from(new Set([...f.procesos, ...del.map((p) => p.codigo)])),
                                      }))
                                    }
                                  >
                                    Todo
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5 text-[10px]"
                                    onClick={() =>
                                      setForm((f) => ({ ...f, procesos: f.procesos.filter((c) => !del.some((p) => p.codigo === c)) }))
                                    }
                                  >
                                    Nada
                                  </Button>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                                {del.map((p) => {
                                  const checked = form.procesos.includes(p.codigo)
                                  return (
                                    <label
                                      key={p.codigo}
                                      className={`flex items-start gap-2 rounded p-1.5 text-sm cursor-pointer hover:bg-accent/50 ${
                                        checked ? "bg-primary/5" : ""
                                      }`}
                                    >
                                      <Checkbox
                                        className="mt-0.5"
                                        checked={checked}
                                        disabled={p.pendiente_sql}
                                        onCheckedChange={(c) => togglear("procesos", p.codigo, !!c)}
                                      />
                                      <span className="min-w-0">
                                        <span className={`block leading-tight ${checked ? "font-medium" : ""}`}>
                                          {p.nombre}
                                          {p.pendiente_sql && (
                                            <span className="ml-1.5 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase text-amber-800">falta SQL 262</span>
                                          )}
                                        </span>
                                        <span className="block text-[10px] text-muted-foreground">
                                          <span className="font-mono">{p.codigo}</span>
                                          {p.descripcion ? ` · ${p.descripcion}` : ""}
                                          {!p.con_alcance ? " · sin alcance por proyecto" : ""}
                                        </span>
                                      </span>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </TabsContent>

                  {/* ===== Usuarios ===== */}
                  <TabsContent value="usuarios" className="mt-4 space-y-3">
                    <Nota icon={Users}>
                      Marca quién tiene este perfil. Al aplicar, a cada persona que entra o sale se le recalcula el
                      acceso de inmediato. Lo mismo se puede hacer desde{" "}
                      <strong>la pestaña Usuarios</strong>, mirando a la persona.
                    </Nota>
                    {esNuevo ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">Guarda el perfil para poder asignarlo.</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="relative flex-1 min-w-[180px]">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Buscar usuario…"
                              value={asigSearch}
                              onChange={(e) => setAsigSearch(e.target.value)}
                              className="pl-8 h-9"
                            />
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {asignadosSel.length} de {usuarios.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 rounded-xl border border-border/60 bg-card p-2.5 max-h-[380px] overflow-y-auto">
                          {usuarios
                            .filter((u) => !asigSearch.trim() || u.usuario.toLowerCase().includes(asigSearch.trim().toLowerCase()))
                            .map((u) => {
                              const checked = asignadosSel.includes(u.id)
                              return (
                                <label
                                  key={u.id}
                                  className={`flex items-center gap-2 p-1.5 rounded text-sm cursor-pointer hover:bg-accent/50 ${
                                    checked ? "bg-primary/5" : ""
                                  }`}
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(c) =>
                                      setAsignadosSel((prev) => (c ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                                    }
                                  />
                                  <span
                                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                                      checked ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                                    }`}
                                  >
                                    {u.usuario.slice(0, 2).toUpperCase()}
                                  </span>
                                  <span className="truncate">{u.usuario}</span>
                                </label>
                              )
                            })}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {dirty
                              ? "Guarda primero los cambios del perfil"
                              : asigDirty
                                ? "Cambios de usuarios sin aplicar"
                                : asignados.length
                                  ? `${asignados.length} usuario(s) con este perfil`
                                  : "Nadie tiene este perfil todavía"}
                          </span>
                          <Button
                            size="sm"
                            variant={asigDirty && !dirty ? "default" : "outline"}
                            onClick={aplicarUsuarios}
                            disabled={savingAsig || !asigDirty || dirty}
                            className="gap-2 h-8"
                          >
                            {savingAsig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                            Aplicar a usuarios
                          </Button>
                        </div>
                      </>
                    )}
                  </TabsContent>
                </Tabs>

                <div className="flex items-center justify-between pt-4 mt-4 border-t">
                  <span className="text-xs text-muted-foreground">
                    {dirty ? "Tienes cambios sin guardar" : esNuevo ? "Perfil nuevo" : "Todo guardado"}
                    {!esNuevo && perfilSel && perfilSel.usuarios > 0 && dirty && (
                      <> · al guardar se recalcula el acceso de {perfilSel.usuarios} usuario(s)</>
                    )}
                  </span>
                  <Button onClick={guardar} disabled={saving || !dirty} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {esNuevo ? "Crear perfil" : "Guardar cambios"}
                  </Button>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      </div>

      {/* ---------- Confirmar eliminación ---------- */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el perfil «{form.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {asignados.length > 0 ? (
                  <p>
                    Lo tienen <strong>{asignados.length} usuario(s)</strong>. Al eliminarlo se les retira lo que este
                    perfil les traía: empresas, owners y módulos. Lo que tengan marcado a mano se conserva.
                  </p>
                ) : (
                  <p>Nadie lo tiene asignado, así que no cambia el acceso de ningún usuario.</p>
                )}
                <p className="text-muted-foreground">
                  Si solo quieres que deje de aplicarse por un tiempo, es mejor desactivarlo.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                eliminar()
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
  )
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function Contador({ n }: { n: number }) {
  return (
    <Badge className="ml-1 h-5 px-1.5 text-[11px] bg-primary/15 text-primary hover:bg-primary/15 border-0 tabular-nums">
      {n}
    </Badge>
  )
}

function Nota({ icon: Icon, children }: { icon: typeof Building2; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <p>{children}</p>
    </div>
  )
}

/**
 * El mismo árbol de módulos que dibuja Gestión de Usuarios, con buscador y
 * "todo / nada" por grupo. Reusa `PERMISSION_TREE` para que un módulo nuevo
 * aparezca aquí sin tocar esta pantalla.
 */
function ArbolPermisos({
  seleccion,
  onToggle,
  onToggleVarios,
}: {
  seleccion: string[]
  onToggle: (key: string, on: boolean) => void
  onToggleVarios: (keys: string[], on: boolean) => void
}) {
  const [q, setQ] = useState("")
  const [abiertos, setAbiertos] = useState<string[]>([])
  const marcados = useMemo(() => new Set(seleccion), [seleccion])
  const arbol = useMemo(() => filtrarArbol(q), [q])

  useEffect(() => {
    if (q.trim()) setAbiertos(arbol.map((g) => g.title))
  }, [q, arbol])

  // "Todo / Nada" incluyen las acciones de cada módulo; los contadores cuentan módulos.
  const todasLasClaves = useMemo(() => clavesDelArbol({ conAcciones: true }), [])
  const totalModulos = useMemo(() => clavesDelArbol().length, [])
  const clavesDe = (g: PermGroup) => g.sections.flatMap((s) => s.permissions.flatMap((p) => clavesDeItem(p, true)))
  const cuenta = (items: PermItem[]) => items.filter((p) => marcados.has(p.key as string)).length
  const modulosMarcados = seleccion.filter((k) => !esClaveAccion(k)).length
  const accionesMarcadas = seleccion.length - modulosMarcados
  // Marcar un módulo enciende todas sus acciones (nadie pierde nada); quitarlo las apaga.
  const toggleModulo = (k: string, on: boolean) => onToggleVarios([k, ...accionesDeLlave(k)], on)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Filtrar módulos…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 h-9" />
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={() => onToggleVarios(todasLasClaves, true)}>
          Todo
        </Button>
        <Button variant="outline" size="sm" className="h-9" onClick={() => onToggleVarios(todasLasClaves, false)}>
          Nada
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {modulosMarcados} de {totalModulos} módulos · {accionesMarcadas} acciones
        </span>
      </div>

      <div className="max-h-[460px] overflow-y-auto pr-2 -mr-2">
        {arbol.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Ningún módulo coincide con «{q}».</p>
        ) : (
          <Accordion type="multiple" value={abiertos} onValueChange={setAbiertos} className="space-y-2">
            {arbol.map((g) => {
              const claves = clavesDe(g)
              const soloModulos = claves.filter((k) => !esClaveAccion(k))
              const activos = soloModulos.filter((k) => marcados.has(k)).length
              return (
                <AccordionItem
                  key={g.title}
                  value={g.title}
                  className="rounded-xl border border-border/60 bg-card px-3 data-[state=open]:border-primary/30 data-[state=open]:shadow-sm transition-colors"
                >
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex items-center gap-2 flex-1 pr-2">
                      <span className="text-sm font-semibold">{g.title}</span>
                      <Badge
                        variant="outline"
                        className={`ml-auto h-5 px-1.5 text-[11px] tabular-nums ${
                          activos === soloModulos.length
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : activos > 0
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : ""
                        }`}
                      >
                        {activos}/{soloModulos.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3 space-y-3">
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onToggleVarios(claves, true)}>
                        Todo el grupo
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onToggleVarios(claves, false)}>
                        Nada
                      </Button>
                    </div>
                    {g.sections.map((s, i) => (
                      <div key={s.title ?? `s${i}`} className="space-y-1">
                        {s.title && (
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {s.title}
                            </p>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {cuenta(s.permissions)}/{s.permissions.length}
                            </span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1 pl-3 border-l-2 border-border">
                          {s.permissions.map((p) => {
                            const k = p.key as string
                            return (
                              <div key={k} className="rounded p-1 hover:bg-accent/50">
                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                  <Checkbox checked={marcados.has(k)} onCheckedChange={(c) => toggleModulo(k, !!c)} />
                                  <span className="truncate">{p.label}</span>
                                </label>
                                <ChipsAcciones llave={k} marcados={marcados} verActivo={marcados.has(k)} onToggle={onToggle} compacto />
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

      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <ArrowRight className="h-3 w-3" />
        Son los mismos módulos del menú: uno nuevo aparece aquí solo. Debajo de cada módulo, lo que se puede hacer dentro; los chips con
        candado se otorgan en la pestaña Autoriza.
      </p>
    </div>
  )
}
