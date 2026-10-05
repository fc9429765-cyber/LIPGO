"use client"

// CONFIGURACIÓN DE LA EMISIÓN A SIIGO
//
// Los datos que Siigo exige para crear una factura y que LIPgo no puede
// deducir: tipo de comprobante, vendedor, forma de pago, impuesto y el código
// del servicio con que se factura.
//
// Y el puente owner → tercero de Siigo, que es lo que evita elegir el cliente
// a mano en cada factura — donde se cometería el error más caro.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { AlertTriangle, Link2, Loader2, Plus, Save, Trash2 } from "lucide-react"
import {
  eliminarOwnerCliente,
  getConfigEmision,
  getOpcionesEmision,
  getOwnerClientes,
  guardarConfigEmision,
  guardarOwnerCliente,
  type ConfigEmision,
  type OwnerCliente,
} from "@/lib/siigo-emision-actions"

type Opciones = Awaited<ReturnType<typeof getOpcionesEmision>>

export default function EmisionSiigoConfig() {
  const { toast } = useToast()
  const [cfg, setCfg] = useState<ConfigEmision | null>(null)
  const [opciones, setOpciones] = useState<Opciones | null>(null)
  const [owners, setOwners] = useState<OwnerCliente[]>([])
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  // El formulario. Se edita aparte de `cfg` para poder saber si hay cambios.
  const [form, setForm] = useState({
    documentoId: "",
    vendedorId: "",
    formaPagoId: "",
    formaPagoCreditoId: "",
    impuestoId: "",
    centroCosto: "",
    productoCodigo: "",
    enviarDian: false,
    enviarCorreo: false,
  })

  const [nuevoOwner, setNuevoOwner] = useState({ owner: "", identificacion: "" })

  const cargar = useCallback(async () => {
    setCargando(true)
    const [c, o, ow] = await Promise.all([
      getConfigEmision(),
      getOpcionesEmision(),
      getOwnerClientes(),
    ])
    if (c.faltaMigracion) setFaltaMigracion(true)
    if (c.success && c.data) {
      setCfg(c.data)
      setForm({
        documentoId: c.data.documentoId?.toString() ?? "",
        vendedorId: c.data.vendedorId?.toString() ?? "",
        formaPagoId: c.data.formaPagoId?.toString() ?? "",
        formaPagoCreditoId: c.data.formaPagoCreditoId?.toString() ?? "",
        impuestoId: c.data.impuestoId?.toString() ?? "",
        centroCosto: c.data.centroCosto?.toString() ?? "",
        productoCodigo: c.data.productoCodigo ?? "",
        enviarDian: c.data.enviarDian,
        enviarCorreo: c.data.enviarCorreo,
      })
    }
    setOpciones(o)
    if (ow.success && ow.data) setOwners(ow.data)
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function guardar() {
    // Encender el envío a la DIAN cambia lo que pasa al pulsar el botón de
    // facturar: de un borrador revisable a un documento oficial.
    if (form.enviarDian && !cfg?.enviarDian) {
      const ok = window.confirm(
        "Vas a activar el envío a la DIAN.\n\n" +
          "A partir de ahora, cada factura que se emita saldrá firmada y oficial en el " +
          "momento. Una factura aceptada por la DIAN NO se puede borrar: se anula con una " +
          "nota crédito.\n\n¿Continuar?",
      )
      if (!ok) return
    }

    setGuardando(true)
    const n = (v: string) => (v.trim() === "" ? null : Number(v))
    const r = await guardarConfigEmision({
      documentoId: n(form.documentoId),
      vendedorId: n(form.vendedorId),
      formaPagoId: n(form.formaPagoId),
      formaPagoCreditoId: n(form.formaPagoCreditoId),
      impuestoId: n(form.impuestoId),
      centroCosto: n(form.centroCosto),
      productoCodigo: form.productoCodigo.trim() || null,
      enviarDian: form.enviarDian,
      enviarCorreo: form.enviarCorreo,
    })
    setGuardando(false)
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: "Configuración guardada" })
    cargar()
  }

  async function agregarOwner() {
    if (!nuevoOwner.owner.trim() || !nuevoOwner.identificacion.trim()) return
    const r = await guardarOwnerCliente(nuevoOwner)
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    setNuevoOwner({ owner: "", identificacion: "" })
    cargar()
  }

  async function quitarOwner(owner: string) {
    if (!window.confirm(`¿Quitar la correspondencia de "${owner}"?`)) return
    const r = await eliminarOwnerCliente(owner)
    if (!r.success) {
      toast({ title: "No se pudo quitar", description: r.message, variant: "destructive" })
      return
    }
    cargar()
  }

  if (cargando) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (faltaMigracion) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          Falta correr{" "}
          <code className="font-mono text-xs">scripts/230_siigo_emision_facturas.sql</code>
        </p>
      </div>
    )
  }

  const sinMaestros = !opciones?.success
  const cambios =
    cfg != null &&
    (form.documentoId !== (cfg.documentoId?.toString() ?? "") ||
      form.vendedorId !== (cfg.vendedorId?.toString() ?? "") ||
      form.formaPagoId !== (cfg.formaPagoId?.toString() ?? "") ||
      form.formaPagoCreditoId !== (cfg.formaPagoCreditoId?.toString() ?? "") ||
      form.impuestoId !== (cfg.impuestoId?.toString() ?? "") ||
      form.centroCosto !== (cfg.centroCosto?.toString() ?? "") ||
      form.productoCodigo !== (cfg.productoCodigo ?? "") ||
      form.enviarDian !== cfg.enviarDian ||
      form.enviarCorreo !== cfg.enviarCorreo)

  return (
    <div className="space-y-4">
      {sinMaestros && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            Faltan los maestros de Siigo
          </p>
          <p className="mt-1 text-[11px] text-amber-900">
            {opciones?.message ??
              "Tráelos desde Finanzas SIIGO → Maestros SIIGO. De ahí salen las formas de pago, los impuestos y los productos."}
          </p>
        </div>
      )}

      {/* El estado de si se puede facturar o no, antes que nada. */}
      {cfg && !cfg.completa && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            La emisión no está lista
          </p>
          <p className="mt-1 text-[11px] text-amber-900">
            Falta configurar: <strong>{cfg.faltan.join(", ")}</strong>. Hasta entonces, el botón de
            facturar no emite nada.
          </p>
        </div>
      )}

      {/* ===== Datos de Siigo ===== */}
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Datos que exige Siigo</h3>
          <p className="text-[11px] text-muted-foreground">
            Son identificadores de Siigo, no conceptos de la operación. Se consultan en su panel o
            en los maestros ya traídos.
          </p>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Tipo de comprobante *</Label>
            <Input
              value={form.documentoId}
              onChange={(e) => setForm({ ...form, documentoId: e.target.value })}
              placeholder="ej. 24"
              className="mt-1 h-9 text-sm"
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              El id del tipo FV en Siigo. Está en Configuración → Tipos de comprobante.
            </p>
          </div>

          <div>
            <Label className="text-xs">Vendedor *</Label>
            <Input
              value={form.vendedorId}
              onChange={(e) => setForm({ ...form, vendedorId: e.target.value })}
              placeholder="ej. 629"
              className="mt-1 h-9 text-sm"
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              El id del usuario de Siigo que va en las facturas.
            </p>
          </div>

          <div>
            <Label className="text-xs">Forma de pago *</Label>
            <select
              value={form.formaPagoId}
              onChange={(e) => setForm({ ...form, formaPagoId: e.target.value })}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Seleccionar</option>
              {(opciones?.formasPago ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nombre}
                  {f.vencimiento ? " (con vencimiento)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs">Impuesto</Label>
            <select
              value={form.impuestoId}
              onChange={(e) => setForm({ ...form, impuestoId: e.target.value })}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Sin impuesto</option>
              {(opciones?.impuestos ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.porcentaje != null ? ` · ${t.porcentaje}%` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <Label className="text-xs">Código del servicio *</Label>
            <select
              value={form.productoCodigo}
              onChange={(e) => setForm({ ...form, productoCodigo: e.target.value })}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Seleccionar</option>
              {(opciones?.productos ?? []).map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.codigo} · {p.nombre}
                </option>
              ))}
            </select>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {/* LIPgo factura un servicio, no mercancía: todas las líneas usan
                  el mismo código. */}
              El producto de Siigo con el que se factura el servicio logístico. Todas las facturas
              lo usan.
            </p>
          </div>

          <div>
            <Label className="text-xs">Centro de costo</Label>
            <Input
              value={form.centroCosto}
              onChange={(e) => setForm({ ...form, centroCosto: e.target.value })}
              placeholder="opcional"
              className="mt-1 h-9 text-sm"
            />
          </div>
        </div>

        {/* El interruptor que más pesa, aparte y advertido. */}
        <div
          className={`border-t p-4 ${form.enviarDian ? "border-red-200 bg-red-50" : "border-border"}`}
        >
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
              checked={form.enviarDian}
              onCheckedChange={(v) => setForm({ ...form, enviarDian: v === true })}
              className="mt-0.5"
            />
            <span>
              <span className={`text-sm font-medium ${form.enviarDian ? "text-red-900" : ""}`}>
                Enviar a la DIAN al crear
              </span>
              <span
                className={`mt-0.5 block text-[11px] ${form.enviarDian ? "text-red-800" : "text-muted-foreground"}`}
              >
                {form.enviarDian ? (
                  <>
                    Cada factura saldrá <strong>firmada y oficial</strong>. Una factura aceptada por
                    la DIAN no se puede borrar: se anula con nota crédito.
                  </>
                ) : (
                  <>
                    Las facturas quedan en <strong>borrador</strong> dentro de Siigo. Alguien las
                    revisa y las envía desde su panel.
                  </>
                )}
              </span>
            </span>
          </label>

          <label className="mt-3 flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={form.enviarCorreo}
              onCheckedChange={(v) => setForm({ ...form, enviarCorreo: v === true })}
            />
            <span className="text-sm">Enviarle copia por correo al cliente</span>
          </label>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {cambios ? "Tienes cambios sin guardar" : "Todo guardado"}
          </span>
          <Button onClick={guardar} disabled={guardando || !cambios} className="gap-1.5">
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </Button>
        </div>
      </section>

      {/* ===== El puente owner → cliente ===== */}
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4" />
            A qué tercero de Siigo corresponde cada cliente
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {/* Facturarle a quien no era es el error más caro, y deducirlo de un
                nombre escrito a mano es justo cómo pasaría. */}
            Sin esto hay que elegir el tercero a mano en cada factura. El nombre debe coincidir
            exactamente con el que LIPgo tiene en la orden.
          </p>
        </div>

        <div className="space-y-3 p-4">
          {owners.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              Sin correspondencias. Al facturar habrá que elegir el tercero cada vez.
            </p>
          ) : (
            <div className="space-y-2">
              {owners.map((o) => (
                <div
                  key={o.owner}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.owner}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{o.identificacion}</span>
                      {o.nombre ? ` · ${o.nombre}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground hover:text-red-600"
                    onClick={() => quitarOwner(o.owner)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div className="min-w-[9rem] flex-1">
              <Label className="text-xs">Cliente en LIPgo</Label>
              <Input
                value={nuevoOwner.owner}
                onChange={(e) => setNuevoOwner({ ...nuevoOwner, owner: e.target.value })}
                placeholder="como aparece en la orden"
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div className="min-w-[8rem] flex-1">
              <Label className="text-xs">NIT en Siigo</Label>
              <Input
                value={nuevoOwner.identificacion}
                onChange={(e) =>
                  setNuevoOwner({ ...nuevoOwner, identificacion: e.target.value })
                }
                placeholder="901234567"
                className="mt-1 h-9 text-sm"
              />
            </div>
            <Button onClick={agregarOwner} className="h-9 gap-1.5">
              <Plus className="h-4 w-4" />
              Agregar
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            El NIT se comprueba contra los clientes ya traídos de Siigo: si no existe, no se
            guarda.
          </p>
        </div>
      </section>
    </div>
  )
}
