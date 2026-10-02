"use client"

// Indicadores del SG-SST (Resolución 0312 · Dec. 1072). Tablero de gestión con
// COMPARATIVO INTERANUAL, pensado para demostrar gestión ante auditoría.
// Datos LIP (idempresa 100), tabla `sst_indicadores` (indexada por `periodo`:
// 'YYYY-MM' mensual y 'YYYY' para el consolidado anual).
//
// Cableado (visible en cada indicador para que la auditoría lo rastree):
//   · 0312   → numeral 3.3.x de la Resolución 0312.
//   · Matriz → auto-cumple el numeral en la Matriz de 60 Estándares cuando hay medición.
//   · BSC    → alimenta el Balanced Scorecard (sig_indicadores).
//
// DISEÑO (validado en preview con el usuario):
//   · Panel "Avance hacia la meta": DUMBBELL — cada indicador viaja de su punto
//     2025 a su 2026 sobre un mismo eje de % de cumplimiento del objetivo. Un solo
//     vistazo responde "¿mejoró o no?". El tramo es verde (↑ acerca a meta) o rojo
//     (↓ se aleja). Todos comparables aunque tengan unidades distintas.
//   · Detalle mensual: ÁREA a medida en SVG (no recharts) — 2026 con degradado y
//     punto final resaltado, 2025 como referencia punteada, meta etiquetada.
//   · Color: rampa ordinal azul para los años (clara→marca), ámbar SOLO para la
//     meta, verde/rojo SOLO para dirección (siempre con flecha). Claro y oscuro.

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { SST_TOKENS } from "@/components/sst/sst-utils"
import { Row3, Field, Sel } from "@/components/sst/sst-form-ui"
import { listIndicadores, upsertIndicador } from "@/lib/sst-plan-actions"
import type { IndicadorRow } from "@/lib/sst-evidencia-types"
import { FICHAS, MESES, enMeta, type Ficha } from "@/components/sst/indicador-detalle"
import { IndicadorModal3D } from "@/components/sst/indicador-modal-3d"
import { TrendingDown, TrendingUp, Minus, ArrowRight, CheckCircle2, AlertTriangle, CircleDashed } from "lucide-react"

const REG_TIPOS: [string, string][] = FICHAS.map((f) => [f.tipo, f.nombre])

// Paleta y clases del tablero. Rampa ordinal de años + estilos premium; el modo
// oscuro define sus propios escalones (no se detecta el tema en JS).
const ESTILO = `
.ind-scope {
  --y25: #9db2d4; --y26: #2f6fd0; --meta: #e08600;
  --up: #16a34a; --down: #dc2626; --neu: #64748b;
  --ind-card: #ffffff; --ind-line: #e2eaf4; --ind-line2: #eef3f9;
  --ind-muted: #5c7089; --ind-faint: #8598b0;
}
.dark .ind-scope {
  --y25: #6d86ac; --y26: #57a2ff; --meta: #f0a636;
  --up: #34d399; --down: #f87171;
  --ind-card: #141d2b; --ind-line: #26303f; --ind-line2: #1c2634;
  --ind-muted: #93a5bd; --ind-faint: #6b7d95;
}
.ind-panel { background: var(--ind-card); border: 1px solid var(--ind-line); border-radius: 18px; }
.ind-stat { background: var(--ind-card); border: 1px solid var(--ind-line); border-radius: 14px; }

/* Dumbbell */
.db-head, .db-row { display: grid; grid-template-columns: 190px 1fr 118px; align-items: center; gap: 14px; }
.db-head { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--ind-faint); padding-bottom: 8px; border-bottom: 1px solid var(--ind-line2); }
.db-row { padding: 11px 0; border-bottom: 1px solid var(--ind-line2); }
.db-row:last-child { border-bottom: 0; }
.db-track { position: relative; height: 26px; }
.db-track .rail { position: absolute; top: 50%; left: 0; right: 0; height: 3px; transform: translateY(-50%); background: var(--ind-line); border-radius: 3px; }
.db-track .meta100 { position: absolute; top: 2px; bottom: 2px; border-left: 2px dashed var(--meta); opacity: .85; }
.db-track .seg { position: absolute; top: 50%; height: 4px; transform: translateY(-50%); border-radius: 3px; opacity: .55; }
.db-track .pt { position: absolute; top: 50%; width: 13px; height: 13px; border-radius: 50%; transform: translate(-50%,-50%); }
.db-track .p25 { background: var(--ind-card); border: 2.5px solid var(--y25); }
.db-track .p26 { background: var(--y26); border: 2.5px solid var(--ind-card); box-shadow: 0 0 0 1px var(--y26); }

/* Tarjeta de detalle */
.ind-card { position: relative; background: var(--ind-card); border: 1px solid var(--ind-line); border-radius: 16px; transition: transform .18s ease, box-shadow .18s ease; }
.ind-card:hover { transform: translateY(-2px); box-shadow: 0 14px 30px -16px color-mix(in srgb, var(--y26) 45%, transparent); }
.ind-area-fill { opacity: 0; animation: ind-fade .7s ease .4s forwards; }
.ind-area-line { stroke-dasharray: var(--len); stroke-dashoffset: var(--len); animation: ind-draw 1s ease forwards; }
@keyframes ind-draw { to { stroke-dashoffset: 0; } }
@keyframes ind-fade { to { opacity: 1; } }
`

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: 2 })

// % de cumplimiento de la meta (0..100), según el sentido. Hace comparables
// indicadores de unidades distintas sobre un mismo eje.
function cumplimiento(v: number | null, meta: number | null, sentido: "menor" | "mayor"): number | null {
  if (v == null || meta == null) return null
  if (sentido === "menor") {
    if (meta === 0) return v <= 0 ? 100 : 0
    return v <= meta ? 100 : Math.max(0, Math.min(100, (meta / v) * 100))
  }
  if (meta === 0) return 100
  return Math.max(0, Math.min(100, (v / meta) * 100))
}

export function IndicadoresSST({ selectedEmpresaId: propEmpresaId }: { selectedEmpresaId?: number | null }) {
  const { selectedEmpresaId: ctxEmpresaId } = useAuth()
  const empresaId = propEmpresaId ?? ctxEmpresaId ?? null
  const { toast } = useToast()
  const [rows, setRows] = useState<IndicadorRow[]>([])
  const [tab, setTab] = useState("tablero")
  const [anio, setAnio] = useState<string>("")
  const [base, setBase] = useState<string>("")
  const [verTipo, setVerTipo] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, any>>(vacio())
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))

  async function cargar() {
    setRows(await listIndicadores(empresaId))
  }
  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  const anios = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) s.add(String(r.periodo).slice(0, 4))
    return Array.from(s).filter(Boolean).sort().reverse()
  }, [rows])

  useEffect(() => {
    if (anios.length && !anios.includes(anio)) setAnio(anios[0])
  }, [anios, anio])
  useEffect(() => {
    if (!anio) return
    const candidatos = anios.filter((a) => a < anio)
    if (!candidatos.includes(base)) setBase(candidatos[0] ?? "")
  }, [anios, anio, base])

  // Serie mensual + consolidado anual. Para el AÑO EN CURSO se cortan los meses
  // futuros (que en BD están en 0) para no dibujar una caída falsa a cero.
  const serieDe = useMemo(() => {
    const now = new Date()
    const thisYear = String(now.getFullYear())
    const thisMonth = now.getMonth() + 1 // 1..12
    return (tipo: string, y: string) => {
      const mens: (number | null)[] = Array(12).fill(null)
      let anual: IndicadorRow | null = null
      if (!y) return { mens, anual }
      for (const r of rows) {
        if (r.tipo !== tipo) continue
        if (r.periodo === y) anual = r
        const m = String(r.periodo).match(new RegExp(`^${y}-(\\d{2})$`))
        if (m) {
          const idx = Number(m[1]) - 1
          if (y === thisYear && idx >= thisMonth) continue // mes futuro: no dibujar
          mens[idx] = r.valor
        }
      }
      return { mens, anual }
    }
  }, [rows])

  const datos = useMemo(() => {
    const out: Record<string, DatoIndicador> = {}
    for (const f of FICHAS) {
      const act = serieDe(f.tipo, anio)
      const ant = serieDe(f.tipo, base)
      const valor = act.anual?.valor ?? null
      const meta = act.anual?.meta ?? null
      const prev = ant.anual?.valor ?? null
      out[f.tipo] = {
        valor,
        meta,
        unidad: act.anual?.unidad ?? "",
        prev,
        mens: act.mens,
        mensPrev: ant.mens,
        cAct: cumplimiento(valor, meta, f.sentido),
        cPrev: cumplimiento(prev, meta, f.sentido),
      }
    }
    return out
  }, [serieDe, anio, base])

  async function guardar() {
    const payload = {
      ...form,
      numerador: Number(form.numerador),
      denominador: Number(form.denominador),
      valor: Number(form.valor),
      meta: Number(form.meta),
    }
    const res = await upsertIndicador(payload as Partial<IndicadorRow>, empresaId)
    if (res.success) {
      toast({ title: "Indicador guardado" })
      setForm(vacio())
      cargar()
      setTab("tablero")
    } else toast({ title: "Error", description: res.message })
  }

  const medicion = FICHAS.filter((f) => f.clase === "resultado")
  const gestion = FICHAS.filter((f) => f.clase === "gestion")

  const resumen = useMemo(() => {
    let enM = 0, fuera = 0, sinM = 0, mejoran = 0, comparables = 0
    for (const f of FICHAS) {
      const d = datos[f.tipo]
      const ok = enMeta(d?.valor ?? null, d?.meta ?? null, f.sentido)
      if (ok == null) sinM++
      else if (ok) enM++
      else fuera++
      if (d?.cAct != null && d?.cPrev != null && Math.abs(d.cAct - d.cPrev) > 0.5) {
        comparables++
        if (d.cAct > d.cPrev) mejoran++
      }
    }
    return { enM, fuera, sinM, mejoran, comparables }
  }, [datos])

  return (
    <div className="ind-scope space-y-4">
      <style>{ESTILO}</style>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: SST_TOKENS.teal }}>
            <span className="inline-block h-0.5 w-5 rounded" style={{ background: SST_TOKENS.teal }} />
            Resolución 0312
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-tight" style={{ color: SST_TOKENS.navy }}>
            Indicadores del SG-SST · gestión {base ? `${base} › ${anio}` : anio}
          </h2>
          <p className="text-xs text-muted-foreground">
            Medición LIP · comparativo interanual para auditoría · cableado con la Matriz de 60 Estándares y el BSC.
          </p>
        </div>
        {tab !== "registrar" && anios.length > 0 && (
          <div className="flex items-end gap-3 text-sm">
            <label className="space-y-0.5">
              <span className="block text-xs text-muted-foreground">Año</span>
              <select className="rounded-md border border-input bg-background px-2 py-1" value={anio} onChange={(e) => setAnio(e.target.value)}>
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-0.5">
              <span className="block text-xs text-muted-foreground">Comparar contra</span>
              <select className="rounded-md border border-input bg-background px-2 py-1" value={base} onChange={(e) => setBase(e.target.value)}>
                <option value="">(sin comparativo)</option>
                {anios
                  .filter((a) => a !== anio)
                  .map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="tablero">Tablero</TabsTrigger>
          <TabsTrigger value="comparativo">Comparativo {base && `${base} vs ${anio}`}</TabsTrigger>
          <TabsTrigger value="registrar">Registrar</TabsTrigger>
        </TabsList>

        {/* ---------------- TABLERO ---------------- */}
        <TabsContent value="tablero" className="space-y-5">
          {rows.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">Sin indicadores registrados aún.</Card>
          ) : (
            <>
              {/* Banda resumen */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat l="En meta" v={`${resumen.enM} de ${FICHAS.length}`} c="var(--up)" />
                <Stat l="Fuera de meta" v={String(resumen.fuera)} c="var(--down)" />
                <Stat l={base ? `Mejoran vs ${base}` : "Mejoran"} v={base ? `${resumen.mejoran} de ${resumen.comparables}` : "—"} c="var(--up)" />
                <Stat l="Indicadores medidos" v={String(FICHAS.length)} c="var(--y26)" />
              </div>

              {/* Panel dumbbell: avance hacia la meta */}
              {base && (
                <div className="ind-panel p-5">
                  <h3 className="text-base font-bold tracking-tight text-foreground">
                    Avance hacia la meta · {base} → {anio}
                  </h3>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Cada indicador viaja de su punto {base} al {anio} sobre un mismo eje de cumplimiento del objetivo.
                    Más a la derecha = más cerca de la meta.
                  </p>
                  <div className="db-head">
                    <span>Indicador</span>
                    <span>Cumplimiento de la meta →</span>
                    <span className="text-right">Avance</span>
                  </div>
                  {FICHAS.map((f) => (
                    <Dumbbell key={f.tipo} f={f} d={datos[f.tipo]} base={base} anio={anio} />
                  ))}
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: "var(--y25)", background: "var(--ind-card)" }} />
                      {base}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: "var(--y26)" }} />
                      {anio}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-3 border-l-2 border-dashed" style={{ borderColor: "var(--meta)" }} />
                      meta (100%)
                    </span>
                    <span className="font-semibold" style={{ color: "var(--up)" }}>↑ se acerca a la meta</span>
                    <span className="font-semibold" style={{ color: "var(--down)" }}>↓ se aleja</span>
                  </div>
                </div>
              )}

              <Seccion titulo="Medición (numerales 3.3.1 – 3.3.6)">
                <Grid>
                  {medicion.map((f) => (
                    <TarjetaIndicador key={f.tipo} f={f} d={datos[f.tipo]} base={base} onVer={() => setVerTipo(f.tipo)} />
                  ))}
                </Grid>
              </Seccion>
              <Seccion titulo="Gestión del SG-SST">
                <Grid>
                  {gestion.map((f) => (
                    <TarjetaIndicador key={f.tipo} f={f} d={datos[f.tipo]} base={base} onVer={() => setVerTipo(f.tipo)} />
                  ))}
                </Grid>
              </Seccion>
            </>
          )}
        </TabsContent>

        {/* ---------------- COMPARATIVO ---------------- */}
        <TabsContent value="comparativo" className="space-y-5">
          {!base ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Elige arriba el año contra el cual comparar para ver la evolución.
            </Card>
          ) : (
            <>
              <Card className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-xs">
                  <caption className="px-4 pt-4 text-left text-sm font-semibold text-foreground">
                    Comparativo {base} vs {anio} · consolidado anual
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Indicador</th>
                      <th className="px-4 py-2 font-medium">0312</th>
                      <th className="px-4 py-2 text-right font-medium">{base}</th>
                      <th className="px-4 py-2 text-right font-medium">{anio}</th>
                      <th className="px-4 py-2 text-right font-medium">Variación</th>
                      <th className="px-4 py-2 text-right font-medium">Meta {anio}</th>
                      <th className="px-4 py-2 text-center font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FICHAS.map((f) => {
                      const d = datos[f.tipo]
                      const ok = enMeta(d?.valor ?? null, d?.meta ?? null, f.sentido)
                      const delta = d?.valor != null && d?.prev != null ? d.valor - d.prev : null
                      const mej = mejora(d?.valor ?? null, d?.prev ?? null, f.sentido)
                      return (
                        <tr key={f.tipo} className="border-b border-border/50 last:border-0">
                          <td className="px-4 py-2 font-medium text-foreground">{f.nombre}</td>
                          <td className="px-4 py-2 text-muted-foreground">{f.numeral ?? "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmt(d?.prev)}</td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums text-foreground">{fmt(d?.valor)}</td>
                          <td className="px-4 py-2 text-right tabular-nums" style={{ color: mej == null ? undefined : mej ? SST_TOKENS.ok : SST_TOKENS.bad }}>
                            {delta == null ? "—" : `${delta > 0 ? "+" : ""}${fmt(delta)}`}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmt(d?.meta)}</td>
                          <td className="px-4 py-2 text-center">
                            <EstadoChip ok={ok} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="px-4 pb-4 pt-2 text-xs text-muted-foreground">
                  La <strong>variación</strong> se colorea según el sentido de cada indicador: en los de “menor es mejor”
                  bajar es mejorar; en los de “mayor es mejor” es al revés.
                </p>
              </Card>

              <Seccion titulo={`Evolución mensual · ${base} vs ${anio}`}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {FICHAS.map((f) => (
                    <TarjetaIndicador key={f.tipo} f={f} d={datos[f.tipo]} base={base} grande onVer={() => setVerTipo(f.tipo)} />
                  ))}
                </div>
              </Seccion>
            </>
          )}
        </TabsContent>

        {/* ---------------- REGISTRAR ---------------- */}
        <TabsContent value="registrar">
          <Card className="space-y-3 p-4">
            <Row3>
              <Field l="Periodo (AAAA-MM o AAAA)">
                <Input value={form.periodo} onChange={(e) => set("periodo", e.target.value)} placeholder="2026-06" />
              </Field>
              <Field l="Indicador">
                <Sel v={form.tipo} on={(v) => set("tipo", v)} o={REG_TIPOS} />
              </Field>
              <Field l="Unidad">
                <Input value={form.unidad} onChange={(e) => set("unidad", e.target.value)} placeholder="%, índice…" />
              </Field>
              <Field l="Numerador">
                <Input type="number" value={form.numerador} onChange={(e) => set("numerador", e.target.value)} />
              </Field>
              <Field l="Denominador">
                <Input type="number" value={form.denominador} onChange={(e) => set("denominador", e.target.value)} />
              </Field>
              <Field l="Valor del indicador">
                <Input type="number" value={form.valor} onChange={(e) => set("valor", e.target.value)} />
              </Field>
              <Field l="Meta">
                <Input type="number" value={form.meta} onChange={(e) => set("meta", e.target.value)} />
              </Field>
            </Row3>
            <Field l="Análisis / observación del período">
              <Textarea value={form.observacion} onChange={(e) => set("observacion", e.target.value)} placeholder="Qué pasó y qué acciones se tomaron…" />
            </Field>
            <Button onClick={guardar} style={{ background: SST_TOKENS.navy, color: "white" }}>
              Guardar indicador
            </Button>
          </Card>
        </TabsContent>
      </Tabs>

      {verTipo && anio && <IndicadorModal3D tipo={verTipo} anio={anio} onClose={() => setVerTipo(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface DatoIndicador {
  valor: number | null
  meta: number | null
  unidad: string
  prev: number | null
  mens: (number | null)[]
  mensPrev: (number | null)[]
  cAct: number | null
  cPrev: number | null
}

function mejora(valor: number | null, prev: number | null, sentido: "menor" | "mayor"): boolean | null {
  if (valor == null || prev == null || valor === prev) return null
  return sentido === "menor" ? valor < prev : valor > prev
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: SST_TOKENS.ink }}>
        {titulo}
      </h3>
      {children}
    </div>
  )
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">{children}</div>
}

function Stat({ l, v, c }: { l: string; v: string; c: string }) {
  return (
    <div className="ind-stat p-4">
      <div className="flex items-center gap-1.5 lg-eyebrow">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} /> {l}
      </div>
      <div className="mt-1 lg-num text-2xl font-bold tracking-tight text-foreground">{v}</div>
    </div>
  )
}

/** Estado frente a meta — nunca por color solo: icono + texto. */
function EstadoChip({ ok }: { ok: boolean | null }) {
  const cfg =
    ok == null
      ? { c: "var(--neu)", t: "Sin meta", I: CircleDashed }
      : ok
        ? { c: "var(--up)", t: "En meta", I: CheckCircle2 }
        : { c: "var(--down)", t: "Fuera", I: AlertTriangle }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
      style={{ color: cfg.c, background: `color-mix(in srgb, ${cfg.c} 13%, transparent)` }}
    >
      <cfg.I className="h-3 w-3" /> {cfg.t}
    </span>
  )
}

function Cableado({ f }: { f: Ficha }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {f.numeral && (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: SST_TOKENS.navy }} title={`Numeral ${f.numeral} de la Resolución 0312`}>
          0312 · {f.numeral}
        </span>
      )}
      {f.numeral && (
        <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" style={{ borderColor: "var(--ind-line)" }} title="Auto-cumple el numeral en la Matriz de 60 Estándares cuando hay medición">
          Matriz
        </span>
      )}
      <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" style={{ borderColor: "var(--ind-line)" }} title="Alimenta el Balanced Scorecard (BSC)">
        BSC
      </span>
    </div>
  )
}

/** Fila del dumbbell: 2025 → 2026 sobre el eje de % de cumplimiento de la meta. */
function Dumbbell({ f, d, base, anio }: { f: Ficha; d: DatoIndicador; base: string; anio: string }) {
  const c25 = d?.cPrev ?? null
  const c26 = d?.cAct ?? null
  const diff = c25 != null && c26 != null ? c26 - c25 : null
  const mej = diff == null || Math.abs(diff) < 0.5 ? null : diff > 0
  const col = mej == null ? "var(--neu)" : mej ? "var(--up)" : "var(--down)"
  // El eje deja 2% de margen a cada lado; la meta (100%) queda al 96%.
  const x = (v: number) => `${2 + v * 0.94}%`
  const lo = c25 != null && c26 != null ? Math.min(c25, c26) : null
  const hi = c25 != null && c26 != null ? Math.max(c25, c26) : null

  return (
    <div className="db-row">
      <div className="text-[13px] font-semibold text-foreground">
        {f.nombre}
        <span className="block text-[10.5px] font-medium tracking-wide text-muted-foreground">
          {f.numeral ? `0312 · ${f.numeral}` : "gestión"} · meta {fmt(d?.meta)} {f.sentido === "menor" ? "↓" : "↑"}
        </span>
      </div>
      <div className="db-track">
        <div className="rail" />
        <div className="meta100" style={{ left: "96%" }} />
        {lo != null && hi != null && (
          <div className="seg" style={{ left: x(lo), width: `${(hi - lo) * 0.94}%`, background: col }} />
        )}
        {c25 != null && <div className="pt p25" style={{ left: x(c25) }} title={`${base}: ${Math.round(c25)}%`} />}
        {c26 != null && <div className="pt p26" style={{ left: x(c26) }} title={`${anio}: ${Math.round(c26)}%`} />}
      </div>
      <div className="flex items-center justify-end gap-1 text-right text-[12.5px] font-bold tabular-nums" style={{ color: col }}>
        {mej == null ? <ArrowRight className="h-3.5 w-3.5" /> : mej ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
        {diff == null ? "—" : `${diff > 0 ? "+" : ""}${Math.round(diff)} pp`}
      </div>
    </div>
  )
}

/** Área mensual a medida (SVG). 2026 con degradado + punto final; 2025 punteado; meta etiquetada. */
function AreaMensual({ f, d, grande }: { f: Ficha; d: DatoIndicador; grande?: boolean }) {
  const w = 520
  const h = grande ? 190 : 150
  const pad = 24
  const n26 = d?.mens ?? []
  const n25 = d?.mensPrev ?? []
  const meta = d?.meta ?? null
  const vals = [...n25, ...n26, meta].filter((v): v is number => v != null)
  const max = Math.max(...(vals.length ? vals : [1]), 1) * 1.15
  const min = 0
  const X = (i: number) => pad + i * ((w - pad * 1.5 - 4) / 11)
  const Y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 1.55)
  const path = (arr: (number | null)[], close: boolean) => {
    const pts = arr.map((v, i) => (v == null ? null : [X(i), Y(v)] as [number, number])).filter(Boolean) as [number, number][]
    if (!pts.length) return ""
    let s = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")
    if (close) s += ` L${pts[pts.length - 1][0].toFixed(1)} ${(h - pad).toFixed(1)} L${pts[0][0].toFixed(1)} ${(h - pad).toFixed(1)} Z`
    return s
  }
  let last = -1
  for (let i = n26.length - 1; i >= 0; i--) if (n26[i] != null) { last = i; break }
  const fid = `af-${f.tipo}${grande ? "-g" : ""}`
  const hayDatos = vals.length > 0

  if (!hayDatos) {
    return <div className="flex h-[120px] items-center justify-center text-xs text-muted-foreground">Sin medición mensual.</div>
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Evolución mensual de ${f.nombre}`}>
      <defs>
        <linearGradient id={fid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--y26)" stopOpacity={0.26} />
          <stop offset="100%" stopColor="var(--y26)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {meta != null && (
        <>
          <line x1={pad} y1={Y(meta)} x2={w - 4} y2={Y(meta)} stroke="var(--meta)" strokeWidth={1.1} strokeDasharray="5 4" opacity={0.8} />
          <text x={w - 2} y={Y(meta) - 4} fill="var(--meta)" fontSize={9} textAnchor="end" fontWeight={700}>
            meta {fmt(meta)}
          </text>
        </>
      )}
      <path className="ind-area-fill" d={path(n26, true)} fill={`url(#${fid})`} />
      <path d={path(n25, false)} fill="none" stroke="var(--y25)" strokeWidth={1.6} strokeDasharray="4 3" opacity={0.9} strokeLinejoin="round" strokeLinecap="round" />
      <path className="ind-area-line" style={{ ["--len" as any]: 560 }} d={path(n26, false)} fill="none" stroke="var(--y26)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
      {last >= 0 && <circle cx={X(last)} cy={Y(n26[last] as number)} r={4} fill="var(--y26)" stroke="var(--ind-card)" strokeWidth={2} />}
      {MESES.map((m, i) => (
        <text key={i} x={X(i)} y={h - 5} fill="var(--ind-faint)" fontSize={9} textAnchor="middle">
          {m}
        </text>
      ))}
    </svg>
  )
}

function TarjetaIndicador({ f, d, base, grande, onVer }: { f: Ficha; d: DatoIndicador; base: string; grande?: boolean; onVer: () => void }) {
  const valor = d?.valor ?? null
  const meta = d?.meta ?? null
  const ok = enMeta(valor, meta, f.sentido)
  const prev = d?.prev ?? null
  const delta = valor != null && prev != null ? Math.round((valor - prev) * 10) / 10 : null
  const mej = mejora(valor, prev, f.sentido)
  const color = ok == null ? "var(--ind-muted)" : ok ? "var(--up)" : "var(--down)"
  const dcol = mej == null ? "var(--neu)" : mej ? "var(--up)" : "var(--down)"

  return (
    <button type="button" onClick={onVer} className="ind-card block w-full p-4 text-left">
      <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: "linear-gradient(90deg, var(--y25), var(--y26))" }} />
      <div className="flex items-start justify-between gap-2">
        <Cableado f={f} />
        <EstadoChip ok={ok} />
      </div>
      <div className="mt-1.5 text-sm font-semibold text-foreground">{f.nombre}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`font-bold tabular-nums tracking-tight ${grande ? "text-3xl" : "text-4xl"}`} style={{ color }}>
          {fmt(valor)}
        </span>
        <span className="text-xs text-muted-foreground">
          {d?.unidad || ""} · meta {fmt(meta)}
        </span>
      </div>
      {delta != null && base ? (
        <div
          className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={{ color: dcol, background: `color-mix(in srgb, ${dcol} 12%, transparent)` }}
        >
          {mej == null ? <Minus className="h-3 w-3" /> : (f.sentido === "menor") === mej ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
          {delta > 0 ? "+" : ""}
          {fmt(delta)} vs {base}
        </div>
      ) : (
        <div className="h-[22px]" />
      )}
      <div className={`mt-2 ${grande ? "h-52" : "h-32"}`}>
        <AreaMensual f={f} d={d} grande={grande} />
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[11px]">
        {base ? (
          <span className="inline-flex items-center gap-3 text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-[3px] w-4 rounded" style={{ background: "var(--y26)" }} /> {"actual"}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-[2px] w-4" style={{ background: "repeating-linear-gradient(90deg,var(--y25) 0 4px,transparent 4px 7px)" }} /> {base}
            </span>
          </span>
        ) : (
          <span />
        )}
        <span className="font-medium text-primary">ver 3D →</span>
      </div>
    </button>
  )
}

const vacio = () => ({
  periodo: new Date().toISOString().slice(0, 7),
  tipo: "frecuencia_at",
  numerador: 0,
  denominador: 0,
  valor: 0,
  meta: 0,
  unidad: "",
  observacion: "",
})

export default IndicadoresSST
