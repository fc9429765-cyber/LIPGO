"use client"

// Mapa de Procesos del SIG.
//
// Réplica del diseño entregado por el usuario (Mapa de Procesos.html): las tres
// bandas del mapa --estratégicos, misionales y de apoyo-- dentro de sus figuras
// SVG, con la entrada de requerimientos a la izquierda y la salida de
// satisfacción a la derecha.
//
// CADA BOTÓN ABRE SUS DOCUMENTOS. Los once procesos --nueve más entrada y
// salida-- son clicables y despliegan un panel lateral con tres listas:
// FORMATOS, INFORMACIÓN DOCUMENTADA y REGISTROS. En cada una se cargan
// documentos con su código, nombre, versión y archivo adjunto.
//
// Los documentos van a `sig_documentos`, el MISMO maestro que alimenta el
// Listado Maestro del Dashboard SIG: lo que se carga acá también sale allá.

import { useCallback, useEffect, useState } from "react"
import { X } from "lucide-react"
import { DocumentosProceso } from "@/components/sig/documentos-proceso"
import { getConteoDocumentosPorProceso } from "@/lib/mapa-procesos-actions"
import { getMisProcesosPermitidos } from "@/lib/permisos-mapa-actions"
import { GRUPOS, PROCESOS, type Proceso, type TipoProceso } from "@/lib/mapa-procesos-tipos"

const PALETA: Record<TipoProceso, { fondo: string; tinta: string; meta: string }> = {
  Estratégico: { fondo: "linear-gradient(155deg, #0a6f6f, #05494c)", tinta: "#ffffff", meta: "#a8dedd" },
  Misional: { fondo: "linear-gradient(155deg, #1d7c8b, #14606f)", tinta: "#ffffff", meta: "#a9dfe6" },
  Apoyo: { fondo: "linear-gradient(155deg, #eaf4f4, #dcebec)", tinta: "#0f3b3b", meta: "#2f5b5b" },
  Interfaz: { fondo: "linear-gradient(155deg, #44A6B0, #2d8c96)", tinta: "#ffffff", meta: "#e8f7f7" },
}



export function MapaProcesos() {
  const [activoId, setActivoId] = useState<string | null>(null)
  // Cuántos documentos tiene cada proceso, para que se vea desde el mapa sin
  // tener que abrirlos uno por uno.
  const [conteos, setConteos] = useState<Record<string, number>>({})

  const cargarConteos = useCallback(async () => {
    const res = await getConteoDocumentosPorProceso()
    if (res.success && res.data) setConteos(res.data)
  }, [])

  // Procesos que este usuario puede abrir. `null` mientras se averigua: así
  // los botones no parpadean de bloqueados a habilitados al cargar.
  const [permitidos, setPermitidos] = useState<Set<string> | null>(null)

  useEffect(() => {
    cargarConteos()
    getMisProcesosPermitidos().then((r) => {
      // `todos` es el respaldo de cuando falta el script: el módulo ya está
      // protegido por `sig_matriz`, así que se deja pasar en vez de dejar el
      // mapa inservible sin decir por qué.
      setPermitidos(r.todos ? null : new Set(r.procesos))
    })
  }, [cargarConteos])
  // Los códigos (E-01, M-02…) se ocultan por defecto: en el mapa impreso son
  // ruido, pero sirven al auditor. Se muestran con el interruptor.
  const [mostrarCodigos, setMostrarCodigos] = useState(false)

  const activo = PROCESOS.find((p) => p.id === activoId) ?? null

  /** Sin lista todavía (o con el respaldo activo) se deja pasar. */
  const puedeAbrir = (id: string) => permitidos === null || permitidos.has(id)

  const botonProceso = (proc: Proceso, alto: string) => {
    const p = PALETA[proc.tipo]
    const seleccionado = activoId === proc.id
    const abre = puedeAbrir(proc.id)
    return (
      <button
        key={proc.id}
        type="button"
        disabled={!abre}
        onClick={() => abre && setActivoId(proc.id)}
        aria-label={
          abre ? `Ver ficha de ${proc.nombre}` : `${proc.nombre} — sin permiso para abrirlo`
        }
        title={abre ? undefined : "No tienes permiso para abrir este proceso."}
        className={`group flex flex-col justify-center gap-2 rounded-xl border p-4 text-left transition-transform ${
          abre ? "cursor-pointer hover:-translate-y-0.5" : "cursor-not-allowed"
        }`}
        style={{
          minHeight: alto,
          borderColor: "rgba(0, 102, 102, 0.14)",
          borderWidth: 1.5,
          background: p.fondo,
          color: p.tinta,
          // El mapa es un documento del SIG: muestra cómo opera la empresa, así
          // que los procesos sin permiso se ven --atenuados-- en vez de
          // desaparecer. Ocultarlos daría un mapa distinto a cada persona.
          opacity: abre ? 1 : 0.45,
          filter: abre ? undefined : "saturate(0.6)",
          boxShadow: seleccionado
            ? "0 0 0 3px #006666, 0 14px 30px rgba(0,70,70,0.22)"
            : "0 4px 14px rgba(16,40,40,0.09)",
        }}
      >
        {mostrarCodigos && (
          <span
            className="font-mono text-[10px] uppercase tracking-[0.16em]"
            style={{ color: p.meta }}
          >
            {proc.codigo}
          </span>
        )}
        <span className="text-sm font-semibold uppercase leading-tight sm:text-base">
          {proc.nombre}
        </span>
        <span className="text-[11px] uppercase tracking-wide" style={{ color: p.meta }}>
          {!abre
            ? "🔒 Sin acceso"
            : seleccionado
              ? "Abierto"
              : conteos[proc.id]
                ? `${conteos[proc.id]} documento(s) →`
                : "Ver documentos →"}
        </span>
      </button>
    )
  }

  const procesosDe = (clave: keyof typeof GRUPOS) =>
    GRUPOS[clave].items.map((n) => PROCESOS.find((p) => p.nombre === n)!).filter(Boolean)

  const entrada = PROCESOS.find((p) => p.id === "IN-01")!
  const salida = PROCESOS.find((p) => p.id === "OUT-01")!

  return (
    <div className="mx-auto max-w-[1500px] px-3 pb-14 pt-7 sm:px-6" style={{ color: "#10201f" }}>
      {/* Encabezado */}
      <header className="mb-6 flex flex-wrap items-center gap-5 border-b-2 pb-4" style={{ borderColor: "#d4dedf" }}>
        <div className="min-w-0 flex-1">
          <div
            className="font-mono text-[11px] uppercase tracking-[0.22em]"
            style={{ color: "#14606f" }}
          >
            Sistema de Gestión Integral
          </div>
          <h1
            className="mt-1 text-2xl font-bold uppercase leading-none tracking-wide sm:text-4xl"
            style={{ color: "#006666" }}
          >
            Mapa de Procesos
          </h1>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: "#66797a" }}>
          <input
            type="checkbox"
            checked={mostrarCodigos}
            onChange={(e) => setMostrarCodigos(e.target.checked)}
          />
          Mostrar códigos
        </label>
      </header>

      {/* Cuerpo: entrada · bandas · salida */}
      <div className="grid items-stretch gap-2 md:gap-3" style={{ gridTemplateColumns: "minmax(80px, 110px) minmax(0, 1fr) minmax(70px, 96px)" }}>
        {/* Entrada */}
        <div className="flex min-w-0 items-stretch gap-1.5">
          <button
            type="button"
            onClick={() => setActivoId(entrada.id)}
            aria-label={`Ver ficha de ${entrada.nombre}`}
            className="flex min-w-0 flex-1 cursor-pointer items-center justify-center border-0 py-6 transition-transform hover:-translate-x-0.5"
            style={{
              background: "linear-gradient(160deg, #44A6B0, #2d8c96)",
              borderRadius: "14px 4px 4px 14px",
              color: "#ffffff",
              boxShadow: activoId === entrada.id
                ? "0 0 0 3px #006666, 0 10px 24px rgba(0,60,60,0.14)"
                : "0 10px 24px rgba(0, 60, 60, 0.14)",
            }}
          >
            <span
              className="text-xs font-bold uppercase leading-tight tracking-[0.1em] sm:text-sm"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              {entrada.nombre}
            </span>
          </button>
          {/* Flecha de entrada */}
          <div className="relative h-20 flex-none self-center" style={{ width: 26 }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              <polygon
                points="0.5,28 54,28 54,1 99,50 54,99 54,72 0.5,72"
                fill="#ffffff"
                stroke="#44A6B0"
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>

        {/* Las tres bandas */}
        <div className="flex min-w-0 flex-col gap-3 md:gap-4">
          {/* Estratégicos — trapecio superior */}
          <section className="relative px-4 pb-16 pt-5 sm:px-8">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
              style={{ filter: "drop-shadow(0 8px 18px rgba(16, 40, 40, 0.10))" }}
            >
              <polygon
                points="0.6,0.6 99.4,0.6 99.4,74 50,99.4 0.6,74"
                fill="#ffffff"
                stroke="#5fb8c4"
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="relative">
              <EncabezadoBanda titulo="Procesos Estratégicos" nota="Direccionan" />
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                {procesosDe("estrategicos").map((p) => botonProceso(p, "92px"))}
              </div>
            </div>
          </section>

          {/* Misionales — flecha hacia la derecha */}
          <section className="relative py-11 pl-6 pr-20 sm:pl-12 sm:pr-32">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
              style={{ filter: "drop-shadow(0 8px 18px rgba(16, 40, 40, 0.10))" }}
            >
              <polygon
                points="0.6,14 79,14 79,0.6 99.4,50 79,99.4 79,86 0.6,86"
                fill="#ffffff"
                stroke="#5fb8c4"
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {/* Las dos barras de la cola de la flecha */}
            <div className="absolute bottom-[14%] left-1 top-[14%] flex gap-1.5">
              <div className="w-1 rounded-sm border bg-white" style={{ borderColor: "#5fb8c4", borderWidth: 1.5 }} />
              <div className="w-1 rounded-sm border bg-white" style={{ borderColor: "#5fb8c4", borderWidth: 1.5 }} />
            </div>
            <div className="relative">
              <EncabezadoBanda titulo="Procesos Misionales" nota="Cadena de valor" />
              <div
                className="grid justify-center gap-3 md:gap-4"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 300px))" }}
              >
                {procesosDe("misionales").map((p) => botonProceso(p, "80px"))}
              </div>
            </div>
          </section>

          {/* Apoyo — trapecio inferior */}
          <section className="relative px-4 pb-6 pt-[74px] sm:px-8">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
              style={{ filter: "drop-shadow(0 8px 18px rgba(16, 40, 40, 0.10))" }}
            >
              <polygon
                points="50,0.6 99.4,26 99.4,99.4 0.6,99.4 0.6,26"
                fill="#ffffff"
                stroke="#5fb8c4"
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="relative">
              <EncabezadoBanda titulo="Procesos de Apoyo" nota="Soportan" />
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
                {procesosDe("apoyo").map((p) => botonProceso(p, "92px"))}
              </div>
            </div>
          </section>
        </div>

        {/* Salida */}
        <button
          type="button"
          disabled={!puedeAbrir(salida.id)}
          onClick={() => puedeAbrir(salida.id) && setActivoId(salida.id)}
          aria-label={
            puedeAbrir(salida.id)
              ? `Ver ficha de ${salida.nombre}`
              : `${salida.nombre} — sin permiso para abrirlo`
          }
          title={puedeAbrir(salida.id) ? undefined : "No tienes permiso para abrir este proceso."}
          className="flex cursor-pointer items-center justify-center border-0 py-6 transition-transform hover:translate-x-0.5"
          style={{
            background: "linear-gradient(200deg, #006666, #0c4f52)",
            borderRadius: "4px 14px 14px 4px",
            color: "#ffffff",
            boxShadow: activoId === salida.id
              ? "0 0 0 3px #006666, 0 10px 24px rgba(0,60,60,0.16)"
              : "0 10px 24px rgba(0, 60, 60, 0.16)",
          }}
        >
          <span
            className="text-xs font-bold uppercase leading-tight tracking-[0.1em] sm:text-sm"
            style={{ writingMode: "vertical-rl" }}
          >
            {salida.nombre}
          </span>
        </button>
      </div>

      <p
        className="mt-6 text-center font-mono text-[10.5px] uppercase tracking-[0.08em]"
        style={{ color: "#6b7d7d" }}
      >
        Mejora continua · Ciclo PHVA · LIP Progressive Integral Logistics
      </p>

      {/* Ficha del proceso */}
      {activo && (
        <>
          <div
            onClick={() => setActivoId(null)}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(8, 26, 26, 0.42)" }}
          />
          <aside
            className="fixed bottom-0 right-0 top-0 z-50 overflow-auto bg-white"
            style={{ width: "min(820px, 96vw)", boxShadow: "-18px 0 50px rgba(8, 30, 30, 0.22)" }}
          >
            <div
              className="flex items-start gap-4 px-6 pb-5 pt-5"
              style={{ background: "#006666", color: "#ffffff" }}
            >
              <div className="min-w-0 flex-1">
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.2em]"
                  style={{ color: "#a8dedd" }}
                >
                  {activo.codigo} · {activo.tipo}
                </div>
                <h3 className="mt-1.5 text-2xl font-bold uppercase leading-tight">{activo.nombre}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActivoId(null)}
                aria-label="Cerrar ficha"
                className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border bg-transparent text-white transition-colors hover:bg-white/20"
                style={{ borderColor: "rgba(255,255,255,0.5)" }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Las tres listas del proceso: formatos, información
                documentada y registros. Escriben en `sig_documentos`, el mismo
                maestro del Listado Maestro del Dashboard SIG. */}
            <div className="px-5 pb-9 pt-4">
              <DocumentosProceso
                procesoId={activo.id}
                procesoNombre={activo.nombre}
                onCambio={cargarConteos}
              />
            </div>
          </aside>
        </>
      )}
    </div>
  )
}

function EncabezadoBanda({ titulo, nota }: { titulo: string; nota: string }) {
  return (
    <div
      className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b-[3px] pb-2"
      style={{ borderColor: "#006666" }}
    >
      <h2 className="text-base font-bold uppercase tracking-[0.14em] sm:text-lg" style={{ color: "#10201f" }}>
        {titulo}
      </h2>
      <span
        className="font-mono text-[10.5px] uppercase tracking-[0.1em]"
        style={{ color: "#66797a" }}
      >
        {nota}
      </span>
    </div>
  )
}

export default MapaProcesos
