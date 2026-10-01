"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { LipAiAssistant, type AtencionItem } from "@/components/lip-ai-assistant"

/**
 * LIPbot flotante GLOBAL: UN solo lugar consistente (abajo a la derecha) en
 * TODAS las pantallas. Si hay pendientes del día, muestra un badge con el
 * conteo. Al abrir, despliega el asistente completo (chat + voz + navegación +
 * acciones), consciente del contexto (módulo/área actual). Atajo: Ctrl/⌘ + K.
 *
 * Comportamiento acordado con la gerencia (2026-09-30): el botón NO puede tapar
 * información. Por eso:
 *  · Se ESCONDE mientras el usuario hace scroll (lee) y vuelve solo cuando el
 *    scroll se detiene (~1,4 s). En escritorio y en móvil.
 *  · En MÓVIL es un círculo compacto (48 px) sin texto ni pulso, arriba de la
 *    barra inferior; en escritorio conserva la píldora "LIPbot ⌘K".
 */
export function LipbotDock({
  contextLabel,
  groupKey,
  alertas,
  onNavigate,
  onOpenGroup,
}: {
  contextLabel?: string
  groupKey?: string
  alertas?: AtencionItem[]
  onNavigate?: (modulo: string) => void
  onOpenGroup?: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [oculto, setOculto] = useState(false)
  const [preguntaInicial, setPreguntaInicial] = useState<string | null>(null)
  const nAlertas = alertas?.length ?? 0

  // Atajo de teclado: Ctrl/⌘+J abre/cierra; Esc cierra. (Ctrl/⌘+K es del
  // buscador global desde 2026-09-30, estándar "buscar o ir a".)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "Escape") {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Canal global: cualquier pantalla puede abrir LIPbot con una pregunta ya
  // escrita (ej. el botón "Pedir ayuda a LIPbot" del módulo Aprendizaje).
  // Mismo patrón del evento "lipgo:navigate-module".
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (typeof detail === "string" && detail.trim()) {
        setPreguntaInicial(detail.trim())
        setOpen(true)
      }
    }
    window.addEventListener("lipgo:lipbot-ask", onAsk)
    return () => window.removeEventListener("lipgo:lipbot-ask", onAsk)
  }, [])

  // Se esconde mientras se hace scroll en CUALQUIER contenedor (fase de
  // captura: el scroll del <main> no burbujea a window) y reaparece al parar.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      setOculto(true)
      if (t) clearTimeout(t)
      t = setTimeout(() => setOculto(false), 1400)
    }
    window.addEventListener("scroll", onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll, true)
      if (t) clearTimeout(t)
    }
  }, [])

  return (
    <>
      <style>{`
        .lipbot-fab{ position:fixed; right:18px; bottom:84px; z-index:60; display:flex; align-items:center; gap:9px;
          padding:11px 16px 11px 12px; border-radius:999px; color:#04222a; font-weight:800; font-size:13.5px;
          background:linear-gradient(135deg,#3fe0ee,#00c2dc); border:0; cursor:pointer;
          box-shadow:0 10px 30px rgba(0,194,220,.45), 0 4px 14px rgba(0,0,0,.3);
          transition:transform .25s ease, opacity .25s ease, box-shadow .15s; }
        .lipbot-fab:hover{ transform:translateY(-2px); box-shadow:0 14px 36px rgba(0,194,220,.6), 0 6px 16px rgba(0,0,0,.35); }
        /* Escondido mientras se lee/hace scroll: se desliza fuera del borde derecho. */
        .lipbot-fab.oculto{ transform:translateX(calc(100% + 28px)); opacity:0; pointer-events:none; }
        .lipbot-fab .em{ font-size:16px; line-height:1; filter:drop-shadow(0 1px 1px rgba(0,0,0,.15)); }
        .lipbot-fab .kbd{ font-size:10px; font-weight:700; letter-spacing:.02em; opacity:.72; background:rgba(4,34,42,.18); padding:2px 6px; border-radius:6px; }
        /* Pulso para llamar la atención (respeta reduce-motion) */
        .lipbot-fab::before{ content:""; position:absolute; inset:0; border-radius:999px; box-shadow:0 0 0 0 rgba(0,194,220,.55);
          animation:lipbot-pulse 2.4s ease-out infinite; pointer-events:none; }
        @keyframes lipbot-pulse{ 0%{ box-shadow:0 0 0 0 rgba(0,194,220,.5) } 70%{ box-shadow:0 0 0 14px rgba(0,194,220,0) } 100%{ box-shadow:0 0 0 0 rgba(0,194,220,0) } }
        .lipbot-badge{ position:absolute; top:-6px; right:-4px; min-width:20px; height:20px; padding:0 5px; border-radius:999px;
          background:#ff5a5f; color:#fff; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center;
          border:2px solid #eafcff; box-shadow:0 2px 8px rgba(0,0,0,.35); }
        .lipbot-panel{ position:fixed; right:18px; bottom:84px; z-index:61; width:min(384px, calc(100vw - 32px));
          max-height:min(86vh, 680px); display:flex; flex-direction:column; animation:lipbot-pop .18s ease-out; }
        @keyframes lipbot-pop{ from{ opacity:0; transform:translateY(10px) scale(.98) } to{ opacity:1; transform:none } }
        .lipbot-closebar{ display:flex; justify-content:flex-end; margin-bottom:6px; }
        .lipbot-cx{ width:30px; height:30px; border-radius:10px; display:flex; align-items:center; justify-content:center;
          background:rgba(10,26,48,.9); color:#cfe6f0; border:1px solid rgba(150,210,240,.28); cursor:pointer; box-shadow:0 6px 16px rgba(0,0,0,.3); }
        .lipbot-cx:hover{ background:rgba(16,44,74,.95); }
        .lipbot-scroll{ overflow-y:auto; }
        @media (prefers-reduced-motion:reduce){ .lipbot-fab::before{ animation:none } .lipbot-panel{ animation:none } .lipbot-fab{ transition:none } }
        /* MÓVIL: círculo compacto, sin texto ni pulso, sobre la barra inferior. */
        @media (max-width:767px){
          .lipbot-fab{ right:12px; bottom:78px; width:48px; height:48px; padding:0; justify-content:center; gap:0;
            box-shadow:0 6px 18px rgba(0,194,220,.4), 0 3px 10px rgba(0,0,0,.25); }
          .lipbot-fab .txt, .lipbot-fab .kbd{ display:none }
          .lipbot-fab .em{ font-size:22px }
          .lipbot-fab::before{ animation:none }
          .lipbot-panel{ right:8px; left:8px; width:auto; bottom:72px; }
        }
        /* En escritorio no hay barra de navegación inferior, y los toasts ya
           no viven en esta esquina (se movieron arriba-derecha) — el
           lanzador puede ir con margen estándar, como en Intercom/Drift/
           Zendesk. */
        @media (min-width:768px){ .lipbot-fab, .lipbot-panel{ bottom:24px; right:24px; } }
      `}</style>

      {!open ? (
        <button
          className={`lipbot-fab${oculto ? " oculto" : ""}`}
          onClick={() => setOpen(true)}
          aria-label="Abrir LIPbot (Ctrl+J)"
          title="LIPbot · Ctrl+J"
          aria-hidden={oculto}
          tabIndex={oculto ? -1 : 0}
        >
          <span className="em" aria-hidden="true">💬</span>
          <span className="txt">LIPbot</span>
          <span className="kbd">⌘J</span>
          {nAlertas > 0 && <span className="lipbot-badge" aria-label={`${nAlertas} pendientes`}>{nAlertas}</span>}
        </button>
      ) : (
        <div className="lipbot-panel" role="dialog" aria-label="LIPbot">
          <div className="lipbot-closebar">
            <button className="lipbot-cx" onClick={() => setOpen(false)} aria-label="Cerrar LIPbot">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="lipbot-scroll">
            <LipAiAssistant
              contextLabel={contextLabel}
              groupKey={groupKey}
              alertas={alertas}
              onNavigate={onNavigate}
              onOpenGroup={onOpenGroup}
              preguntaInicial={preguntaInicial ?? undefined}
              onPreguntaInicialEnviada={() => setPreguntaInicial(null)}
            />
          </div>
        </div>
      )}
    </>
  )
}
