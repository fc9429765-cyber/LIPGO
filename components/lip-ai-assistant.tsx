"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Sparkles, Mic, Lightbulb, ArrowUp, Square, Maximize2, Bot, X } from "lucide-react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { useAuth } from "@/components/auth-provider"
import { sugerenciasDe } from "@/lib/kpis-area"

export interface AtencionItem {
  label: string
  sev: "crit" | "warn" | "info"
}

interface LipAiAssistantProps {
  /** Contexto (ej. el área/grupo) para personalizar las preguntas sugeridas. */
  contextLabel?: string
  /** Etiqueta de empresa para el subtítulo "lee tu operación en vivo · X". */
  empresaLabel?: string | null
  /** Opcional: abrir el Asistente a pantalla completa (botón "Ampliar"). */
  onOpen?: () => void
  /** Alertas REALES (por empresa/área) que la IA prioriza. Si viene vacío se oculta. */
  alertas?: AtencionItem[]
  /** Acción al tocar una alerta (ej. abrir el módulo relacionado). */
  onAlerta?: (a: AtencionItem) => void
  /** Abrir un SUBMÓDULO cuando la IA lo decide (herramienta abrir_submodulo). */
  onNavigate?: (modulo: string) => void
  /** Abrir un MÓDULO PRINCIPAL/grupo cuando la IA lo decide (abrir_modulo). */
  onOpenGroup?: (key: string) => void
  /** Clave del grupo actual (para sugerencias contextuales de ese módulo). */
  groupKey?: string
  /** Variante HERO (Inicio): presencia más grande e imponente — LIPbot protagonista. */
  hero?: boolean
  /** Variante BARRA DE COMANDO (Inicio): compacta (una fila) que se EXPANDE al
   *  preguntar/enfocar. Protagonista por tratamiento, no por tamaño — deja los
   *  módulos visibles. Patrón Raycast/Linear/Perplexity. */
  variant?: "card" | "bar"
  /** Pregunta a enviar automáticamente UNA vez al montar/recibir (ej. botón
   *  "Pedir ayuda a LIPbot" del módulo Aprendizaje). */
  preguntaInicial?: string
  /** Avisa al padre que ya se envió `preguntaInicial`, para que la limpie. */
  onPreguntaInicialEnviada?: () => void
}

/**
 * Asistente LIP — superficie de IA premium con CHAT INLINE (el "sello" de la app).
 * Se pregunta DENTRO de la tarjeta (sin cambiar de ventana): campo de texto,
 * botón "Preguntar" y micrófono (dictado por voz). Responde en vivo por streaming
 * usando el mismo backend Claude (/api/chat), gobernado por los permisos del
 * usuario. Reutilizable en Inicio y en cada submenú.
 */
export function LipAiAssistant({ contextLabel, empresaLabel, onOpen, alertas, onAlerta, onNavigate, onOpenGroup, groupKey, hero, variant = "card", preguntaInicial, onPreguntaInicialEnviada }: LipAiAssistantProps) {
  const isBar = variant === "bar"
  // En modo barra: colapsada por defecto; se expande al enfocar o al haber chat.
  const [focused, setFocused] = useState(false)
  const { selectedEmpresaId } = useAuth()
  const area = contextLabel?.trim()

  // idEmpresa + contexto siempre frescos para inyectarlos en cada request (el
  // transport se captura una sola vez, así que leemos de refs, no del closure).
  const idEmpresaRef = useRef<number | null>(selectedEmpresaId ?? null)
  useEffect(() => {
    idEmpresaRef.current = selectedEmpresaId ?? null
  }, [selectedEmpresaId])
  const contextoRef = useRef<string | undefined>(contextLabel)
  useEffect(() => {
    contextoRef.current = contextLabel
  }, [contextLabel])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, id }) => ({
          // El selector global manda: idEmpresa es SIEMPRE la empresa seleccionada.
          body: { id, messages, idEmpresa: idEmpresaRef.current, contexto: contextoRef.current },
        }),
      }),
    [],
  )

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({ transport })
  const isThinking = status === "submitted" || status === "streaming"

  const [input, setInput] = useState("")
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<any>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // Modo barra: ⌘K / Ctrl+K enfoca la barra de comando (patrón command-palette).
  useEffect(() => {
    if (!isBar) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault()
        setFocused(true)
        taRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isBar])

  // Auto-crecer del campo: se agranda mientras escribes (o dictas por voz) para
  // que SIEMPRE se vea lo que escribes; vuelve a su alto mínimo al enviar/limpiar.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }, [input])
  // Voz conversacional: si la pregunta se hizo por voz, la respuesta se lee en
  // voz alta (TTS) y, si la IA repregunta, se reabre el micrófono.
  const speakNextRef = useRef(false)
  const spokenRef = useRef<Set<string>>(new Set())
  const finalVozRef = useRef("")
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)

  // Preguntas sugeridas PROPIAS del módulo/área actual (no fuera de contexto).
  const sugs = sugerenciasDe(groupKey)

  // Cerrar el chat: limpia el hilo y vuelve la tarjeta a su tamaño compacto.
  const cerrarChat = () => {
    try {
      window.speechSynthesis?.cancel()
    } catch {}
    try {
      recognitionRef.current?.stop()
    } catch {}
    setMessages([])
    setInput("")
    spokenRef.current = new Set()
  }

  const placeholder = area ? `Pregúntale a LIPbot sobre ${area}…` : "Pregúntale a LIPbot: ¿cómo va la operación hoy?"

  // Auto-scroll del hilo inline al llegar nuevos chunks.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [messages, isThinking])

  // Navegación: si la IA usó la herramienta 'abrir_modulo' y el backend
  // autorizó (permitido:true), abrimos ese módulo. Cada llamada se ejecuta
  // una sola vez (rastreo por toolCallId).
  const navegadosRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant" || !m.parts) continue
      for (const p of m.parts as any[]) {
        if (p?.state !== "output-available" || !p?.output?.permitido || navegadosRef.current.has(p.toolCallId)) continue
        if (p?.type === "tool-abrir_submodulo" && p.output.navegar_a) {
          navegadosRef.current.add(p.toolCallId)
          onNavigate?.(p.output.navegar_a as string)
        } else if (p?.type === "tool-abrir_modulo" && p.output.navegar_grupo) {
          navegadosRef.current.add(p.toolCallId)
          onOpenGroup?.(p.output.navegar_grupo as string)
        }
      }
    }
  }, [messages, onNavigate, onOpenGroup])

  const enviar = (text: string, porVoz = false) => {
    const t = text.trim()
    if (!t || isThinking) return
    // No bloqueamos por empresa: el backend resuelve la empresa activa desde
    // el cookie si el estado del cliente aún no cargó. Escribir/hablar/enviar
    // SIEMPRE está habilitado.
    if (porVoz) speakNextRef.current = true // la respuesta se leerá en voz alta
    sendMessage({ text: t })
    setInput("")
  }

  // Pregunta precargada (ej. "Pedir ayuda a LIPbot" desde el módulo
  // Aprendizaje): se envía UNA sola vez al llegar, con guarda anti-duplicado
  // (mismo patrón de `navegadosRef`).
  const preguntaEnviadaRef = useRef<string | null>(null)
  useEffect(() => {
    const t = preguntaInicial?.trim()
    if (!t || preguntaEnviadaRef.current === t) return
    preguntaEnviadaRef.current = t
    enviar(t)
    onPreguntaInicialEnviada?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preguntaInicial])

  // Limpia markdown y emojis para que la voz suene natural (sin *, #, `,
  // enlaces… ni el sintetizador leyendo "cara feliz", "cohete", etc.).
  const limpiarParaVoz = (t: string) =>
    t
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`#>]/g, "")
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu, "")
      .replace(/[\u200D\uFE0F]/g, "") // zero-width joiner / variation selector sueltos de emojis compuestos
      .replace(/\s+/g, " ")
      .trim()

  // Inicia el comando de voz. Al terminar de hablar el usuario, ENVÍA solo
  // (voz = comando) y marca que la respuesta se leerá en voz alta.
  const iniciarVoz = () => {
    const SR = (typeof window !== "undefined" &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) as any
    if (!SR) {
      alert("El comando de voz necesita Chrome o Edge. Escribe tu pregunta mientras tanto.")
      return
    }
    try {
      window.speechSynthesis?.cancel() // que no se escuche a sí mismo
    } catch {}
    const rec = new SR()
    rec.lang = "es-CO"
    rec.interimResults = true
    rec.continuous = false
    finalVozRef.current = ""
    rec.onresult = (e: any) => {
      let interim = ""
      let final = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript
        if (e.results[i].isFinal) final += seg
        else interim += seg
      }
      if (final) finalVozRef.current += final
      setInput((finalVozRef.current + interim).trim())
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => {
      setListening(false)
      const txt = finalVozRef.current.trim()
      finalVozRef.current = ""
      if (txt) enviar(txt, true) // por voz -> responde hablando
    }
    recognitionRef.current = rec
    setListening(true)
    rec.start()
  }

  const toggleVoz = () => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    iniciarVoz()
  }

  // Voz de salida (TTS): lee la respuesta en voz alta. Si la IA hizo una
  // pregunta (contiene '?'), reabre el micrófono para que respondas por voz.
  const hablar = (texto: string) => {
    try {
      const synth = window.speechSynthesis
      if (!synth) return
      const clean = limpiarParaVoz(texto)
      if (!clean) return

      let lanzado = false
      const doSpeak = () => {
        if (lanzado) return
        lanzado = true
        try {
          synth.cancel() // limpia cualquier cola previa
          const u = new SpeechSynthesisUtterance(clean)
          // Elige una voz en español si el sistema la tiene; si no, deja la
          // por defecto (forzar es-CO sin voz instalada hace que no suene).
          const voces = synth.getVoices()
          const esVoz =
            voces.find((v) => /^es[-_]co/i.test(v.lang)) ||
            voces.find((v) => /^es/i.test(v.lang))
          if (esVoz) {
            u.voice = esVoz
            u.lang = esVoz.lang
          } else {
            u.lang = "es-CO"
          }
          u.rate = 1.02
          u.onend = () => {
            if (/\?/.test(texto)) iniciarVoz() // repreguntó -> te escucha por voz
          }
          utterRef.current = u // mantener referencia: Chrome corta la voz si se recolecta
          // Chrome a veces "pierde" el speak justo tras cancel; un microdelay + resume lo estabiliza.
          setTimeout(() => {
            try {
              synth.speak(u)
              synth.resume()
            } catch {}
          }, 60)
        } catch {}
      }

      // Las voces pueden no estar cargadas la primera vez; espera el evento (con respaldo).
      if (synth.getVoices().length === 0) {
        const onVoces = () => {
          synth.removeEventListener("voiceschanged", onVoces)
          doSpeak()
        }
        synth.addEventListener("voiceschanged", onVoces)
        setTimeout(doSpeak, 350) // respaldo por si 'voiceschanged' no llega
      } else {
        doSpeak()
      }
    } catch {}
  }

  // Cuando la pregunta vino por voz, lee la respuesta en voz alta (una sola vez
  // por mensaje). Se dispara al terminar el streaming (isThinking pasa a false).
  useEffect(() => {
    if (isThinking || !speakNextRef.current) return
    const last = [...messages].reverse().find((m) => m.role === "assistant")
    if (!last || spokenRef.current.has(last.id)) return
    const texto = getMessageText(last)
    if (!texto) return
    spokenRef.current.add(last.id)
    speakNextRef.current = false
    hablar(texto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThinking, messages])

  // Al desmontar: corta voz y micrófono.
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel()
      } catch {}
      try {
        recognitionRef.current?.stop()
      } catch {}
    }
  }, [])

  return (
    <div
      className={`lipai ${hero ? "lipai-hero" : ""} ${isBar ? "lipai-bar" : ""} ${
        isBar && (focused || messages.length > 0) ? "lipai-open" : ""
      }`}
    >
      <style>{`
        @property --lipai-a{ syntax:'<angle>'; initial-value:0deg; inherits:false; }
        .lipai{ position:relative; border-radius:20px; padding:1.6px;
          background:conic-gradient(from var(--lipai-a), #00c2dc, #3fe0ee, #4f8ff0, #12233f, #00c2dc);
          animation:lipai-spin 6s linear infinite;
          box-shadow:0 0 34px rgba(0,194,220,.16), 0 16px 40px rgba(0,0,0,.28); }
        @keyframes lipai-spin{ to{ --lipai-a:360deg; } }
        @media (prefers-reduced-motion:reduce){ .lipai{ animation:none; background:linear-gradient(120deg,#00c2dc,#4f8ff0); } }
        .lipai-in{ position:relative; overflow:hidden; border-radius:18.4px; padding:12px 14px 12px;
          background:linear-gradient(180deg,#0c2140,#0a1a30); }
        .lipai-in::after{ content:""; position:absolute; inset:0; pointer-events:none;
          background:radial-gradient(70% 130% at 100% -10%, rgba(0,194,220,.20), transparent 55%); }
        .lipai-orb{ position:relative; width:38px; height:38px; flex:none; }
        .lipai-orb .core{ position:absolute; inset:6px; border-radius:50%;
          background:radial-gradient(circle at 35% 30%, #b9f6ff, #00c2dc 55%, #0a6b7d); box-shadow:0 0 16px rgba(0,194,220,.8); }
        .lipai-orb .halo{ position:absolute; inset:0; border-radius:50%; border:1.5px solid rgba(0,220,240,.5); animation:lipai-halo 2.6s ease-out infinite; }
        @keyframes lipai-halo{ 0%{transform:scale(.7);opacity:.9} 100%{transform:scale(1.35);opacity:0} }
        @media (prefers-reduced-motion:reduce){ .lipai-orb .halo{ animation:none } }
        .lipai-live{ width:6px; height:6px; border-radius:50%; background:#37f5a0; box-shadow:0 0 8px #37f5a0; animation:lipai-blink 1.8s ease-in-out infinite; }
        @keyframes lipai-blink{ 0%,100%{opacity:1} 50%{opacity:.35} }
        .lipai-sug:hover{ background:rgba(0,194,220,.16) !important; border-color:rgba(0,194,220,.5) !important; }
        .lipai-ta{ background:transparent; border:0; outline:none; resize:none; color:#eaf7fb; font-size:14.5px; line-height:21px; width:100%; min-height:40px; max-height:150px; overflow-y:auto; }
        .lipai-ta::placeholder{ color:#7fbdcf; }
        .lipai-mic-on{ animation:lipai-mic 1.1s ease-in-out infinite; }
        @keyframes lipai-mic{ 0%,100%{box-shadow:0 0 0 0 rgba(255,90,90,.5)} 50%{box-shadow:0 0 0 6px rgba(255,90,90,0)} }
        .lipai-thread::-webkit-scrollbar{ width:6px } .lipai-thread::-webkit-scrollbar-thumb{ background:rgba(120,190,230,.3); border-radius:6px }
        /* Variante HERO (Inicio): LIPbot protagonista — más grande y con más aire. */
        .lipai-hero .lipai-in{ padding:18px 20px 16px; }
        .lipai-hero .lipai-orb{ width:52px; height:52px; }
        .lipai-hero .lipai-ta{ font-size:15px; line-height:22px; }
        .lipai-hero .lipai-thread{ max-height:220px; }

        /* ===== Variante BARRA DE COMANDO: compacta (una fila) que se expande ===== */
        .lipai-bar .lipai-in{ display:flex; flex-direction:column; padding:9px 11px; }
        .lipai-bar .lipai-header{ display:none; }        /* el orbe va en la fila del composer */
        .lipai-bar .lipai-alertas{ display:none; }       /* las alertas van fuera, en su franja */
        .lipai-bar .lipai-composer{ order:-2; margin-top:0 !important; background:transparent !important; border:0 !important; padding:0 !important; }
        .lipai-bar .lipai-sugs{ order:-1; margin-top:11px !important; }
        .lipai-bar .lipai-thread{ order:0; margin-top:11px !important; }
        /* Colapsada: solo la fila de comando (se ocultan hilo y sugerencias). */
        .lipai-bar:not(.lipai-open) .lipai-thread,
        .lipai-bar:not(.lipai-open) .lipai-sugs{ display:none; }
        /* Orbe compacto embebido en la fila (solo en modo barra). */
        .lipai-orb-inline{ display:none; }
        .lipai-bar .lipai-orb-inline{ display:block; width:30px; height:30px; flex:none; }
        .lipai-bar .lipai-ta{ font-size:14.5px; }
        /* Badge ⌘K (solo barra colapsada) — afford del atajo command-palette. */
        .lipai-kbd{ display:none; font:700 10px/1 ui-sans-serif,system-ui; color:#9fd4e6; flex:none;
          background:rgba(4,34,42,.35); padding:4px 7px; border-radius:6px; border:1px solid rgba(150,210,240,.18); }
        .lipai-bar:not(.lipai-open) .lipai-kbd{ display:inline-flex; }
      `}</style>

      <div className="lipai-in">
        <div className="lipai-header relative z-[2] flex items-center gap-3">
          <div className="lipai-orb">
            <div className="halo" />
            <div className="core" />
          </div>
          <div className="min-w-0">
            <div
              className={`${hero ? "text-[19px]" : "text-[15px]"} font-extrabold tracking-tight`}
              style={{ color: "#eaf7fb" }}
            >
              LIPbot
            </div>
            <div className={`flex items-center gap-1.5 ${hero ? "text-[12.5px]" : "text-[11.5px]"}`} style={{ color: "#7fbdcf" }}>
              <span className="lipai-live" />
              Lee tu operación en vivo{empresaLabel ? ` · ${empresaLabel}` : ""}
            </div>
          </div>
          <div className="ml-auto flex flex-none items-center gap-1.5">
            {messages.length > 0 && (
              <button
                onClick={cerrarChat}
                title="Cerrar chat"
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ color: "#7fbdcf", background: "rgba(255,255,255,.06)" }}
              >
                <X className="h-[15px] w-[15px]" />
              </button>
            )}
            {onOpen ? (
              <button
                onClick={onOpen}
                title="Abrir a pantalla completa"
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ color: "#7fbdcf", background: "rgba(255,255,255,.06)" }}
              >
                <Maximize2 className="h-[15px] w-[15px]" />
              </button>
            ) : (
              <Sparkles className="h-4 w-4" style={{ color: "#3fe0ee" }} />
            )}
          </div>
        </div>

        {/* Hilo de conversación INLINE (aparece al preguntar) */}
        {messages.length > 0 && (
          <div
            ref={scrollRef}
            className="lipai-thread relative z-[2] mt-3 max-h-[168px] space-y-2.5 overflow-y-auto pr-1"
          >
            {messages.map((m) => (
              <InlineBubble key={m.id} message={m} />
            ))}
            {status === "submitted" && (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "#9fd4e6" }}>
                <Bot className="h-3.5 w-3.5" /> Pensando…
              </div>
            )}
            {error && (
              <div className="rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: "rgba(255,90,90,.14)", color: "#ff9a94" }}>
                Ocurrió un error: {error.message}
              </div>
            )}
          </div>
        )}

        {/* Composer: (orbe en modo barra) + escribir + micrófono + Preguntar */}
        <div
          className="lipai-composer relative z-[2] mt-3.5 flex items-end gap-2.5 rounded-xl px-3 py-2"
          style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(150,210,240,.2)" }}
          onClick={() => {
            if (isBar) taRef.current?.focus()
          }}
        >
          <div className="lipai-orb lipai-orb-inline">
            <div className="halo" />
            <div className="core" />
          </div>
          <textarea
            ref={taRef}
            rows={1}
            className="lipai-ta flex-1 py-1"
            placeholder={placeholder}
            value={input}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 140)}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                enviar(input)
              }
            }}
          />

          <span className="lipai-kbd" aria-hidden="true">⌘J</span>

          {/* Micrófono (dictado por voz) */}
          <button
            type="button"
            onClick={toggleVoz}
            title={listening ? "Detener dictado" : "Hablarle a la IA"}
            className={`flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg ${listening ? "lipai-mic-on" : ""}`}
            style={{
              color: listening ? "#fff" : "#7fbdcf",
              background: listening ? "#e5484d" : "rgba(255,255,255,.05)",
            }}
          >
            <Mic className="h-[15px] w-[15px]" />
          </button>

          {/* Preguntar / Detener */}
          {isThinking ? (
            <button
              type="button"
              onClick={() => stop()}
              title="Detener"
              className="flex h-[34px] flex-none items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-bold"
              style={{ background: "rgba(255,255,255,.14)", color: "#eaf7fb" }}
            >
              <Square className="h-3.5 w-3.5 fill-current" /> Detener
            </button>
          ) : (
            <button
              type="button"
              onClick={() => enviar(input)}
              disabled={!input.trim()}
              className="flex h-[34px] flex-none items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-bold disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#3fe0ee,#00c2dc)", color: "#04222a", boxShadow: "0 4px 14px rgba(0,194,220,.4)" }}
            >
              <ArrowUp className="h-[15px] w-[15px]" /> Preguntar
            </button>
          )}
        </div>

        {/* Sugerencias contextuales del módulo (solo antes de la primera pregunta) */}
        {messages.length === 0 && (
          <div className="lipai-sugs relative z-[2] mt-3 flex flex-wrap gap-2">
            {sugs.map((s) => (
              <button
                key={s}
                onClick={() => enviar(s)}
                className="lipai-sug rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{ color: "#cbe7f1", background: "rgba(255,255,255,.06)", border: "1px solid rgba(150,210,240,.16)" }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Atención del día — la IA prioriza lo que requiere foco (datos reales). */}
        {alertas && alertas.length > 0 && (
          <div
            className="lipai-alertas relative z-[2] mt-3.5 flex gap-3 rounded-xl px-3 py-3"
            style={{ background: "rgba(0,194,220,.08)", border: "1px solid rgba(0,194,220,.22)" }}
          >
            <span
              className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg"
              style={{ background: "rgba(0,194,220,.18)", color: "#3fe0ee" }}
            >
              <Lightbulb className="h-[15px] w-[15px]" />
            </span>
            <div className="min-w-0 text-[12.5px]" style={{ color: "#dcecf3" }}>
              <b style={{ color: "#fff" }}>
                Hoy detecté {alertas.length} cosa{alertas.length !== 1 ? "s" : ""} que requieren tu atención
              </b>{" "}
              — priorizadas por impacto.
              <div className="mt-2 flex flex-wrap gap-1.5">
                {alertas.map((a, i) => (
                  <button
                    key={i}
                    onClick={() => onAlerta?.(a)}
                    className="rounded-md px-2 py-1 text-[10.5px] font-semibold transition-transform hover:scale-[1.03]"
                    style={SEV[a.sev]}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Burbuja compacta para el hilo inline (fondo oscuro de la tarjeta). */
function InlineBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user"
  const text = getMessageText(message)
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-[13px] leading-relaxed"
        style={
          isUser
            ? { background: "linear-gradient(135deg,#3fe0ee,#00c2dc)", color: "#04222a" }
            : { background: "rgba(255,255,255,.08)", color: "#eaf7fb", border: "1px solid rgba(150,210,240,.15)" }
        }
      >
        {text || "…"}
      </div>
    </div>
  )
}

/** Extrae el texto plano de un UIMessage (AI SDK 6 usa `parts`, no `content`). */
function getMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof (p as any).text === "string")
    .map((p) => p.text)
    .join("")
}

const SEV: Record<AtencionItem["sev"], { background: string; color: string }> = {
  crit: { background: "rgba(255,122,114,.16)", color: "#ff7a72" },
  warn: { background: "rgba(255,207,94,.16)", color: "#ffcf5e" },
  info: { background: "rgba(0,194,220,.16)", color: "#3fe0ee" },
}
